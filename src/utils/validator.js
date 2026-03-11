import { extractControllerMethods, extractSapUiDefineDependencies } from "./parser.js";
import { analyzeUi5Xml } from "./xmlParser.js";

const UI5_CONTROLLER_NAME = /^[A-Z][A-Za-z0-9_]*$/;
const RULES_VERSION = "2.0.0";
const ISSUE_CATEGORIES = ["structure", "mvc", "naming", "performance"];

export function validateUi5CodeQuality(code, options = {}) {
  const { expectedControllerName, sourceType = "auto" } = options;
  const issues = [];
  const resolvedSourceType = resolveSourceType(code, sourceType);
  const controllerMethods = resolvedSourceType === "javascript" ? extractControllerMethods(code) : [];

  if (resolvedSourceType === "javascript") {
    applyJavaScriptRules(code, expectedControllerName, controllerMethods, issues);
  } else {
    applyXmlRules(code, expectedControllerName, issues);
  }

  const issuesByCategory = groupIssuesByCategory(issues);

  return {
    isValid: !issues.some((item) => item.severity === "error"),
    issues: issues.map(toLegacyIssue),
    issueDetails: issues,
    issuesByCategory,
    rulesVersion: RULES_VERSION,
    sourceType: resolvedSourceType
  };
}

export function lintJavaScript(code) {
  const warnings = [];
  const suggestions = [];

  if (/\bvar\b/.test(code)) {
    warnings.push("Use let/const instead of var.");
    suggestions.push("Replace var with const where values are not reassigned.");
  }

  if (/function\s*\(([^)]*)\)\s*{\s*return\s+new\s+Promise/m.test(code)) {
    warnings.push("Avoid manual Promise constructors when async/await can be used.");
    suggestions.push("Refactor to async function and await asynchronous calls.");
  }

  if (/callback\s*\(/.test(code)) {
    warnings.push("Potential callback style detected.");
    suggestions.push("Prefer Promise-based APIs to reduce callback nesting.");
  }

  if (/[^\n]{121,}/.test(code)) {
    warnings.push("Very long lines detected.");
    suggestions.push("Wrap long statements to improve readability.");
  }

  return { warnings, suggestions };
}

export function securityScanJavaScript(code) {
  const findings = [];
  // Heuristic scan for common high-risk JavaScript patterns.
  pushIfMatch(/\beval\s*\(/, "HIGH", "Use of eval() can enable arbitrary code execution.");
  pushIfMatch(/\bnew\s+Function\s*\(/, "HIGH", "Use of Function constructor can execute dynamic code.");
  pushIfMatch(/child_process\.(exec|execSync)\s*\(/, "HIGH", "Command execution API detected.");
  pushIfMatch(/import\s*\(\s*[^'"]/m, "MEDIUM", "Dynamic import from non-literal source detected.");
  pushIfMatch(/Object\.assign\s*\(\s*.*__proto__/m, "MEDIUM", "Possible prototype pollution pattern detected.");

  return {
    safe: findings.length === 0,
    findings
  };

  function pushIfMatch(pattern, severity, description) {
    if (pattern.test(code)) {
      findings.push({ severity, description });
    }
  }
}

export function validateControllerMethods(code) {
  // Minimal lifecycle coverage currently required by project rules.
  const methods = extractControllerMethods(code);
  const required = ["onInit"];
  const missing = required.filter((method) => !methods.includes(method));
  return { methods, missing };
}

function applyJavaScriptRules(code, expectedControllerName, controllerMethods, issues) {
  const hasSapUiDefine = /sap\.ui\.define\s*\(/.test(code);
  if (!hasSapUiDefine) {
    issues.push(issue("error", "MISSING_SAP_UI_DEFINE", "sap.ui.define wrapper is missing.", "structure"));
  }

  const dependencies = extractSapUiDefineDependencies(code);
  if (dependencies.length === 0) {
    issues.push(issue("warn", "NO_DEPENDENCIES", "No sap.ui.define dependencies were detected.", "structure"));
  }

  const dependencyCountMatch = /sap\.ui\.define\s*\(\s*\[[\s\S]*?\]\s*,\s*function\s*\(([\s\S]*?)\)/m.exec(code);
  if (dependencyCountMatch) {
    const parameters = dependencyCountMatch[1]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (parameters.length !== dependencies.length) {
      issues.push(
        issue(
          "error",
          "DEPENDENCY_PARAMETER_MISMATCH",
          "Dependency count does not match factory function parameter count.",
          "structure"
        )
      );
    }
  }

  if (/new\s+XMLView\s*\(/.test(code)) {
    issues.push(issue("warn", "MVC_MIXING", "Controller appears to instantiate views directly.", "mvc"));
  }

  if (expectedControllerName && !UI5_CONTROLLER_NAME.test(expectedControllerName)) {
    issues.push(
      issue("warn", "CONTROLLER_NAME_STYLE", "Controller name should be PascalCase according to UI5 conventions.", "naming")
    );
  }

  if (/jQuery\.ajax\s*\(\s*{[\s\S]*?async\s*:\s*false[\s\S]*?}\s*\)/m.test(code)) {
    issues.push(issue("warn", "SYNC_XHR_DETECTED", "Synchronous XHR pattern detected (async: false).", "performance"));
  }

  if (controllerMethods.length > 25) {
    issues.push(
      issue(
        "warn",
        "LARGE_CONTROLLER",
        `Controller exposes ${controllerMethods.length} methods; consider splitting responsibilities.`,
        "performance"
      )
    );
  }
}

function applyXmlRules(code, expectedControllerName, issues) {
  let xmlAnalysis;
  try {
    xmlAnalysis = analyzeUi5Xml(code);
  } catch (error) {
    issues.push(
      issue(
        "error",
        "XML_PARSE_FAILED",
        `XML parsing failed: ${error.message}`,
        "structure"
      )
    );
    return;
  }

  const invalidEventHandlers = xmlAnalysis.events.filter((event) => {
    const handler = event.handler?.trim() ?? "";
    if (!handler) {
      return true;
    }
    return !handler.startsWith(".") && !/^on[A-Z][A-Za-z0-9_]*$/.test(handler);
  });

  if (invalidEventHandlers.length > 0) {
    issues.push(
      issue(
        "warn",
        "XML_EVENT_HANDLER_STYLE",
        `${invalidEventHandlers.length} XML event handler(s) do not follow recommended naming (.onXxx/onXxx).`,
        "mvc"
      )
    );
  }

  if (expectedControllerName && !UI5_CONTROLLER_NAME.test(expectedControllerName)) {
    issues.push(
      issue("warn", "CONTROLLER_NAME_STYLE", "Controller name should be PascalCase according to UI5 conventions.", "naming")
    );
  }

  if (xmlAnalysis.controls.length > 200) {
    issues.push(
      issue(
        "warn",
        "LARGE_XML_VIEW",
        `XML contains ${xmlAnalysis.controls.length} controls; consider splitting the view or fragment.`,
        "performance"
      )
    );
  }

  const expressionBindings = xmlAnalysis.bindings.filter((binding) => binding.type === "expression").length;
  if (expressionBindings > 20) {
    issues.push(
      issue(
        "warn",
        "EXCESSIVE_EXPRESSION_BINDINGS",
        `XML contains ${expressionBindings} expression bindings; consider formatter reuse for readability/performance.`,
        "performance"
      )
    );
  }
}

function resolveSourceType(code, sourceType) {
  if (sourceType === "javascript" || sourceType === "xml") {
    return sourceType;
  }

  const trimmed = code.trimStart();
  if (trimmed.startsWith("<")) {
    return "xml";
  }

  return "javascript";
}

function toLegacyIssue(item) {
  return {
    severity: item.severity,
    code: item.code,
    message: item.message
  };
}

function groupIssuesByCategory(issues) {
  const grouped = Object.fromEntries(ISSUE_CATEGORIES.map((category) => [category, []]));
  for (const item of issues) {
    grouped[item.category].push(item);
  }
  return grouped;
}

function issue(severity, code, message, category) {
  return {
    severity,
    code,
    message,
    category,
    ruleVersion: RULES_VERSION
  };
}
