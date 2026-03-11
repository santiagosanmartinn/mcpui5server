import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { readTextFile, resolveWorkspacePath } from "../../utils/fileSystem.js";
import { securityScanJavaScript } from "../../utils/validator.js";

const DEFAULT_SOURCE_DIR = "webapp";
const DEFAULT_MAX_FILES = 1200;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".mcp-backups", ".mcp-cache", "dist", "coverage"]);
const SOURCE_TYPES = ["auto", "javascript", "xml"];

const inputSchema = z.object({
  code: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  sourceDir: z.string().min(1).optional(),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  maxFindings: z.number().int().min(10).max(2000).optional()
}).strict().refine((value) => Boolean(value.code || value.path || value.sourceDir), {
  message: "Provide code, path, or sourceDir."
});

const findingSchema = z.object({
  rule: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  file: z.string(),
  line: z.number().int().positive().nullable(),
  message: z.string(),
  suggestion: z.string(),
  reference: z.string().nullable()
});

const outputSchema = z.object({
  sourceMode: z.enum(["code", "file", "project"]),
  safe: z.boolean(),
  scanned: z.object({
    files: z.number().int().nonnegative(),
    xmlFiles: z.number().int().nonnegative(),
    jsFiles: z.number().int().nonnegative()
  }),
  summary: z.object({
    totalFindings: z.number().int().nonnegative(),
    bySeverity: z.object({
      low: z.number().int().nonnegative(),
      medium: z.number().int().nonnegative(),
      high: z.number().int().nonnegative()
    }),
    truncated: z.boolean()
  }),
  findings: z.array(findingSchema)
});

export const securityCheckUi5AppTool = {
  name: "security_check_ui5_app",
  description: "Scan UI5 XML/JS sources for security risks (XSS, unsafe HTML injection, dynamic code execution, insecure redirects).",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      code,
      path: filePath,
      sourceDir,
      sourceType,
      maxFiles,
      maxFindings
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const checkedFiles = [];

    if (code) {
      checkedFiles.push({
        path: "__inline__",
        type: resolveSourceType(code, sourceType ?? "auto"),
        content: code
      });
    } else if (filePath) {
      const content = await readTextFile(filePath, root);
      checkedFiles.push({
        path: normalizePath(filePath),
        type: resolveSourceType(content, sourceType ?? "auto"),
        content
      });
    } else {
      const selectedSourceDir = normalizePath(sourceDir ?? DEFAULT_SOURCE_DIR);
      const files = await listTrackedFiles({
        root,
        sourceDir: selectedSourceDir,
        maxFiles: maxFiles ?? DEFAULT_MAX_FILES
      });
      for (const relativePath of files) {
        const content = await readTextFile(relativePath, root);
        checkedFiles.push({
          path: relativePath,
          type: path.extname(relativePath).toLowerCase() === ".xml" ? "xml" : "javascript",
          content
        });
      }
    }

    const findings = [];
    let xmlFiles = 0;
    let jsFiles = 0;
    for (const file of checkedFiles) {
      if (file.type === "xml") {
        xmlFiles += 1;
        findings.push(...scanXmlSecurity(file.path, file.content));
      } else {
        jsFiles += 1;
        findings.push(...scanJavaScriptSecurity(file.path, file.content));
      }
    }

    const cap = maxFindings ?? 500;
    const truncated = findings.length > cap;
    const limited = findings.slice(0, cap);
    const summary = summarizeFindings(limited);

    return outputSchema.parse({
      sourceMode: code ? "code" : filePath ? "file" : "project",
      safe: summary.bySeverity.high === 0 && summary.bySeverity.medium === 0,
      scanned: {
        files: checkedFiles.length,
        xmlFiles,
        jsFiles
      },
      summary: {
        totalFindings: limited.length,
        bySeverity: summary.bySeverity,
        truncated
      },
      findings: limited
    });
  }
};

function scanXmlSecurity(filePath, content) {
  const findings = [];

  if (/<(?:\w+:)?HTML\b/.test(content)) {
    findings.push({
      rule: "UI5_SEC_XML_RAW_HTML_CONTROL",
      severity: "high",
      file: filePath,
      line: findLine(content, "<"),
      message: "Raw HTML control detected in XML view/fragment.",
      suggestion: "Avoid raw HTML rendering; use safe UI5 controls or sanitize trusted content explicitly.",
      reference: "https://ui5.sap.com/#/api/sap.ui.core.HTML"
    });
  }

  const formattedTextMatch = /<(?:\w+:)?FormattedText\b([^>]*)>/g;
  let match = formattedTextMatch.exec(content);
  while (match) {
    const attrs = match[1] ?? "";
    if (/htmlText\s*=/.test(attrs) || /<\{/.test(attrs)) {
      findings.push({
        rule: "UI5_SEC_XML_FORMATTED_TEXT_HTML",
        severity: "medium",
        file: filePath,
        line: findLineByIndex(content, match.index),
        message: "FormattedText with HTML payload detected.",
        suggestion: "Ensure HTML source is sanitized and trusted before binding to FormattedText/htmlText.",
        reference: "https://ui5.sap.com/#/api/sap.m.FormattedText"
      });
    }
    match = formattedTextMatch.exec(content);
  }

  const hrefJsMatch = /href\s*=\s*["']\s*javascript:/gi;
  match = hrefJsMatch.exec(content);
  while (match) {
    findings.push({
      rule: "UI5_SEC_XML_JAVASCRIPT_URI",
      severity: "high",
      file: filePath,
      line: findLineByIndex(content, match.index),
      message: "javascript: URI detected in XML attribute.",
      suggestion: "Avoid javascript: links. Use semantic navigation handlers in controller.",
      reference: null
    });
    match = hrefJsMatch.exec(content);
  }

  return findings;
}

function scanJavaScriptSecurity(filePath, code) {
  const findings = [];
  const generic = securityScanJavaScript(code);
  for (const item of generic.findings) {
    findings.push({
      rule: "UI5_SEC_JS_GENERIC",
      severity: item.severity === "HIGH" ? "high" : item.severity === "MEDIUM" ? "medium" : "low",
      file: filePath,
      line: null,
      message: item.description,
      suggestion: "Refactor the risky pattern to a safe alternative.",
      reference: null
    });
  }

  pushIfMatch({
    code,
    filePath,
    findings,
    pattern: /\binnerHTML\s*=/g,
    rule: "UI5_SEC_JS_INNER_HTML",
    severity: "high",
    message: "innerHTML assignment detected.",
    suggestion: "Avoid innerHTML with dynamic values; use text controls/bindings with escaping."
  });

  pushIfMatch({
    code,
    filePath,
    findings,
    pattern: /document\.write\s*\(/g,
    rule: "UI5_SEC_JS_DOCUMENT_WRITE",
    severity: "high",
    message: "document.write usage detected.",
    suggestion: "Avoid document.write and render through safe UI5 controls."
  });

  pushIfMatch({
    code,
    filePath,
    findings,
    pattern: /\$\s*\([^)]*\)\.html\s*\(/g,
    rule: "UI5_SEC_JS_JQUERY_HTML",
    severity: "medium",
    message: "jQuery .html() write detected.",
    suggestion: "Avoid injecting raw HTML through jQuery; use safe rendering APIs."
  });

  pushIfMatch({
    code,
    filePath,
    findings,
    pattern: /new\s+sap\.ui\.core\.HTML\s*\(/g,
    rule: "UI5_SEC_JS_CORE_HTML",
    severity: "high",
    message: "sap.ui.core.HTML constructor detected in JavaScript.",
    suggestion: "Only use sap.ui.core.HTML with trusted and sanitized content."
  });

  pushIfMatch({
    code,
    filePath,
    findings,
    pattern: /URLHelper\.redirect\s*\([^,]+,\s*true\s*\)/g,
    rule: "UI5_SEC_JS_REDIRECT_NEW_WINDOW",
    severity: "low",
    message: "URLHelper.redirect with new window detected.",
    suggestion: "Validate and whitelist target URLs before redirecting."
  });

  return findings;
}

function pushIfMatch(input) {
  const { code, filePath, findings, pattern, rule, severity, message, suggestion } = input;
  let match = pattern.exec(code);
  while (match) {
    findings.push({
      rule,
      severity,
      file: filePath,
      line: findLineByIndex(code, match.index),
      message,
      suggestion,
      reference: null
    });
    match = pattern.exec(code);
  }
}

function summarizeFindings(findings) {
  const bySeverity = {
    low: 0,
    medium: 0,
    high: 0
  };
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
  }
  return { bySeverity };
}

async function listTrackedFiles(options) {
  const { root, sourceDir, maxFiles } = options;
  const sourceAbsolute = resolveWorkspacePath(sourceDir, root);
  const files = [];
  await walk(sourceAbsolute);
  return files.sort();

  async function walk(currentDir) {
    if (files.length >= maxFiles) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        break;
      }
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(path.resolve(root), absolutePath).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (extension === ".xml" || extension === ".js") {
        files.push(relativePath);
      }
    }
  }
}

function resolveSourceType(code, sourceType) {
  if (sourceType === "javascript" || sourceType === "xml") {
    return sourceType;
  }
  return code.trimStart().startsWith("<") ? "xml" : "javascript";
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function findLine(content, fragment) {
  const index = content.indexOf(fragment);
  if (index < 0) {
    return null;
  }
  return findLineByIndex(content, index);
}

function findLineByIndex(content, index) {
  if (index < 0) {
    return null;
  }
  return content.slice(0, index).split(/\r?\n/).length;
}
