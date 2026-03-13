import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { isIgnoredWorkspaceDirectory, readTextFile, resolveWorkspacePath } from "../../utils/fileSystem.js";
import { analyzeUi5Xml } from "../../utils/xmlParser.js";

const DEFAULT_SOURCE_DIR = "webapp";
const DEFAULT_MAX_FILES = 800;
const DEFAULT_MAX_FINDINGS = 300;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".mcp-backups", ".mcp-cache", "dist", "coverage"]);
const SUPPORTED_EXTENSIONS = new Set([".xml", ".js"]);

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  maxFiles: z.number().int().min(10).max(2000).optional(),
  maxFindings: z.number().int().min(10).max(1000).optional()
}).strict();

const findingSchema = z.object({
  rule: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  file: z.string(),
  line: z.number().int().positive().nullable(),
  message: z.string(),
  suggestion: z.string(),
  category: z.enum(["xml", "javascript"])
});

const outputSchema = z.object({
  sourceDir: z.string(),
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
    byRule: z.record(z.number().int().nonnegative()),
    truncated: z.boolean()
  }),
  findings: z.array(findingSchema)
});

export const analyzeUi5PerformanceTool = {
  name: "analyze_ui5_performance",
  description: "Analyze UI5 XML/JS files with performance-focused rules and actionable recommendations.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { sourceDir, maxFiles, maxFindings } = inputSchema.parse(args);
    const root = context.rootDir;
    const resolvedSourceDir = normalizeRelativePath(sourceDir ?? DEFAULT_SOURCE_DIR);
    const files = await listTrackedFiles({
      root,
      sourceDir: resolvedSourceDir,
      maxFiles: maxFiles ?? DEFAULT_MAX_FILES
    });

    const findings = [];
    let xmlFiles = 0;
    let jsFiles = 0;
    for (const relativePath of files) {
      const extension = path.extname(relativePath).toLowerCase();
      const content = await readTextFile(relativePath, root);
      if (extension === ".xml") {
        xmlFiles += 1;
        analyzeXmlFile(relativePath, content, findings);
      } else if (extension === ".js") {
        jsFiles += 1;
        analyzeJavaScriptFile(relativePath, content, findings);
      }
    }

    const effectiveMaxFindings = maxFindings ?? DEFAULT_MAX_FINDINGS;
    const truncated = findings.length > effectiveMaxFindings;
    const slicedFindings = findings.slice(0, effectiveMaxFindings);
    const byRule = {};
    const bySeverity = { low: 0, medium: 0, high: 0 };
    for (const finding of slicedFindings) {
      bySeverity[finding.severity] += 1;
      byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
    }

    return outputSchema.parse({
      sourceDir: resolvedSourceDir,
      scanned: {
        files: files.length,
        xmlFiles,
        jsFiles
      },
      summary: {
        totalFindings: slicedFindings.length,
        bySeverity,
        byRule,
        truncated
      },
      findings: slicedFindings
    });
  }
};

function analyzeXmlFile(relativePath, content, findings) {
  let analysis;
  try {
    analysis = analyzeUi5Xml(content);
  } catch {
    return;
  }

  if (analysis.controls.length > 180) {
    findings.push(createFinding({
      rule: "UI5_PERF_XML_LARGE_VIEW",
      severity: "high",
      file: relativePath,
      line: 1,
      category: "xml",
      message: `View size is high (${analysis.controls.length} controls).`,
      suggestion: "Split the view into reusable fragments and lazy-load heavy sections."
    }));
  }

  const expressionBindings = analysis.bindings.filter((item) => item.type === "expression").length;
  if (expressionBindings > 15) {
    findings.push(createFinding({
      rule: "UI5_PERF_XML_EXCESSIVE_EXPRESSION_BINDING",
      severity: "medium",
      file: relativePath,
      line: 1,
      category: "xml",
      message: `Detected ${expressionBindings} expression bindings.`,
      suggestion: "Move complex expressions to formatters for better readability and runtime efficiency."
    }));
  }

  if (analysis.events.length > 40) {
    findings.push(createFinding({
      rule: "UI5_PERF_XML_EVENT_DENSITY",
      severity: "low",
      file: relativePath,
      line: 1,
      category: "xml",
      message: `View contains ${analysis.events.length} event handlers.`,
      suggestion: "Consider decomposing view responsibilities or delegating logic to subcomponents."
    }));
  }

  if (/<Table\b/.test(content) && /\bitems\s*=\s*"\{/.test(content) && !/\bgrowing\s*=\s*"(true|false)"/i.test(content)) {
    findings.push(createFinding({
      rule: "UI5_PERF_XML_TABLE_NO_GROWING",
      severity: "medium",
      file: relativePath,
      line: findLine(content, "<Table"),
      category: "xml",
      message: "Table with bound items does not define growing behavior.",
      suggestion: "Enable growing and tune growingThreshold to avoid rendering large datasets at once."
    }));
  }
}

function analyzeJavaScriptFile(relativePath, content, findings) {
  if (/jQuery\.ajax\s*\(\s*{[\s\S]*?async\s*:\s*false[\s\S]*?}\s*\)/m.test(content)) {
    findings.push(createFinding({
      rule: "UI5_PERF_JS_SYNC_XHR",
      severity: "high",
      file: relativePath,
      line: findLine(content, "async"),
      category: "javascript",
      message: "Synchronous XHR detected (`async: false`).",
      suggestion: "Use asynchronous request flows and promise-based handling."
    }));
  }

  if (/sap\.ui\.getCore\(\)\.byId\s*\(/.test(content)) {
    findings.push(createFinding({
      rule: "UI5_PERF_JS_GLOBAL_BYID",
      severity: "medium",
      file: relativePath,
      line: findLine(content, "sap.ui.getCore().byId"),
      category: "javascript",
      message: "Global `sap.ui.getCore().byId` access detected.",
      suggestion: "Prefer `this.byId`/view-local lookups to reduce global traversal and coupling."
    }));
  }

  if (/for\s*\([^)]*\)\s*{[\s\S]{0,500}\.byId\s*\(/m.test(content)) {
    findings.push(createFinding({
      rule: "UI5_PERF_JS_BYID_IN_LOOP",
      severity: "medium",
      file: relativePath,
      line: findLine(content, "for"),
      category: "javascript",
      message: "Repeated control lookups inside loop detected.",
      suggestion: "Cache control references outside loops to avoid repeated lookup cost."
    }));
  }

  const modelRefreshMatches = Array.from(content.matchAll(/\.refresh\s*\(\s*true\s*\)/g)).length;
  if (modelRefreshMatches > 3) {
    findings.push(createFinding({
      rule: "UI5_PERF_JS_EXCESSIVE_FORCE_REFRESH",
      severity: "low",
      file: relativePath,
      line: findLine(content, ".refresh(true)"),
      category: "javascript",
      message: `Detected ${modelRefreshMatches} forced model refresh calls.`,
      suggestion: "Batch model updates and avoid frequent force-refresh to reduce unnecessary rerenders."
    }));
  }
}

function createFinding(item) {
  return {
    rule: item.rule,
    severity: item.severity,
    file: item.file,
    line: item.line ?? null,
    message: item.message,
    suggestion: item.suggestion,
    category: item.category
  };
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
        const relativePath = path.relative(path.resolve(root), absolutePath).replaceAll("\\", "/");
        if (isIgnoredWorkspaceDirectory(entry.name, relativePath, IGNORED_DIRS)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(extension)) {
        files.push(relativePath);
      }
    }
  }
}

function normalizeRelativePath(input) {
  return input
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function findLine(content, fragment) {
  const index = content.indexOf(fragment);
  if (index < 0) {
    return null;
  }
  return content.slice(0, index).split(/\r?\n/).length;
}
