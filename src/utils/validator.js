import { extractControllerMethods, extractSapUiDefineDependencies } from "./parser.js";

const UI5_CONTROLLER_NAME = /^[A-Z][A-Za-z0-9_]*$/;

export function validateUi5CodeQuality(code, options = {}) {
  const issues = [];
  const { expectedControllerName } = options;

  if (!/sap\.ui\.define\s*\(/.test(code)) {
    issues.push(issue("error", "MISSING_SAP_UI_DEFINE", "sap.ui.define wrapper is missing."));
  }

  const dependencies = extractSapUiDefineDependencies(code);
  if (dependencies.length === 0) {
    issues.push(issue("warn", "NO_DEPENDENCIES", "No sap.ui.define dependencies were detected."));
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
          "Dependency count does not match factory function parameter count."
        )
      );
    }
  }

  if (/new\s+XMLView\s*\(/.test(code)) {
    issues.push(issue("warn", "MVC_MIXING", "Controller appears to instantiate views directly."));
  }

  if (expectedControllerName && !UI5_CONTROLLER_NAME.test(expectedControllerName)) {
    issues.push(
      issue("warn", "CONTROLLER_NAME_STYLE", "Controller name should be PascalCase according to UI5 conventions.")
    );
  }

  return {
    isValid: !issues.some((item) => item.severity === "error"),
    issues
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
  const methods = extractControllerMethods(code);
  const required = ["onInit"];
  const missing = required.filter((method) => !methods.includes(method));
  return { methods, missing };
}

function issue(severity, code, message) {
  return { severity, code, message };
}

