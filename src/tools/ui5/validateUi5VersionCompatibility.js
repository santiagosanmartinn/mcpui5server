import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { isIgnoredWorkspaceDirectory, readTextFile, resolveWorkspacePath } from "../../utils/fileSystem.js";
import { analyzeUi5ProjectTool } from "../project/analyzeProject.js";
import { analyzeUi5Xml } from "../../utils/xmlParser.js";
import { extractImports } from "../../utils/parser.js";
import { UI5_SYMBOL_CATALOG } from "./catalogs/ui5SymbolCatalog.js";
import {
  recommendComponentFitFromJavaScript,
  recommendComponentFitFromXml
} from "./catalogs/ui5ComponentFitRules.js";

const DEFAULT_SOURCE_DIR = "webapp";
const DEFAULT_MAX_FILES = 1000;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".mcp-backups", ".mcp-cache", "dist", "coverage"]);
const SOURCE_TYPES = ["auto", "javascript", "xml"];

const inputSchema = z.object({
  code: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  sourceDir: z.string().min(1).optional(),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  ui5Version: z.string().regex(/^\d+\.\d+(\.\d+)?$/).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  includeUnknownSymbols: z.boolean().optional()
}).strict().refine((value) => Boolean(value.code || value.path || value.sourceDir), {
  message: "Provide code, path, or sourceDir."
});

const findingSchema = z.object({
  symbol: z.string(),
  kind: z.enum(["control", "module", "unknown"]),
  file: z.string(),
  line: z.number().int().positive().nullable(),
  introducedIn: z.string().nullable(),
  status: z.enum(["compatible", "incompatible", "unknown"]),
  severity: z.enum(["error", "warn"]),
  message: z.string(),
  reference: z.string().nullable()
});

const recommendationSchema = z.object({
  rule: z.string(),
  file: z.string(),
  line: z.number().int().positive().nullable(),
  currentComponent: z.string(),
  suggestedComponent: z.string(),
  reason: z.string(),
  confidence: z.enum(["high", "medium"]),
  guideline: z.string().optional()
});

const outputSchema = z.object({
  sourceMode: z.enum(["code", "file", "project"]),
  ui5Version: z.string().nullable(),
  summary: z.object({
    checkedSymbols: z.number().int().nonnegative(),
    compatible: z.number().int().nonnegative(),
    incompatible: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
    recommendations: z.number().int().nonnegative(),
    isCompatible: z.boolean()
  }),
  scanned: z.object({
    files: z.number().int().nonnegative(),
    xmlFiles: z.number().int().nonnegative(),
    jsFiles: z.number().int().nonnegative()
  }),
  findings: z.array(findingSchema),
  componentRecommendations: z.array(recommendationSchema),
  references: z.array(
    z.object({
      title: z.string(),
      url: z.string()
    })
  )
});

export const validateUi5VersionCompatibilityTool = {
  name: "validate_ui5_version_compatibility",
  description: "Validate UI5 control/module compatibility against project version and recommend better-fit components (e.g. dedicated date controls).",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      code,
      path: filePath,
      sourceDir,
      sourceType,
      ui5Version,
      maxFiles,
      includeUnknownSymbols
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const detectedVersion = ui5Version ?? await detectUi5Version(root);
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
    const recommendations = [];
    const seenSymbols = new Set();
    let xmlFiles = 0;
    let jsFiles = 0;

    for (const file of checkedFiles) {
      if (file.type === "xml") {
        xmlFiles += 1;
        const xmlSymbols = extractSymbolsFromXml(file.content);
        for (const symbol of xmlSymbols) {
          seenSymbols.add(`${file.path}::${symbol.symbol}`);
          const compatibility = evaluateSymbolCompatibility(symbol.symbol, detectedVersion, includeUnknownSymbols ?? true);
          if (compatibility) {
            findings.push({
              symbol: symbol.symbol,
              kind: compatibility.kind,
              file: file.path,
              line: symbol.line,
              introducedIn: compatibility.introducedIn,
              status: compatibility.status,
              severity: compatibility.severity,
              message: compatibility.message,
              reference: compatibility.reference
            });
          }
        }
        recommendations.push(...recommendComponentFitFromXml(file.path, file.content));
      } else {
        jsFiles += 1;
        const jsSymbols = extractSymbolsFromJavaScript(file.content);
        for (const symbol of jsSymbols) {
          seenSymbols.add(`${file.path}::${symbol.symbol}`);
          const compatibility = evaluateSymbolCompatibility(symbol.symbol, detectedVersion, includeUnknownSymbols ?? true);
          if (compatibility) {
            findings.push({
              symbol: symbol.symbol,
              kind: compatibility.kind,
              file: file.path,
              line: symbol.line,
              introducedIn: compatibility.introducedIn,
              status: compatibility.status,
              severity: compatibility.severity,
              message: compatibility.message,
              reference: compatibility.reference
            });
          }
        }
        recommendations.push(...recommendComponentFitFromJavaScript(file.path, file.content));
      }
    }

    const versionAwareRecommendations = reconcileRecommendationsWithUi5Version(recommendations, detectedVersion);
    const compatibilityFindings = findings.filter((item) => item.status !== "compatible");
    const summary = summarizeFindings(findings, versionAwareRecommendations);

    return outputSchema.parse({
      sourceMode: code ? "code" : filePath ? "file" : "project",
      ui5Version: detectedVersion,
      summary,
      scanned: {
        files: checkedFiles.length,
        xmlFiles,
        jsFiles
      },
      findings: compatibilityFindings,
      componentRecommendations: versionAwareRecommendations,
      references: buildReferences(compatibilityFindings, versionAwareRecommendations)
    });
  }
};

async function detectUi5Version(root) {
  try {
    const project = await analyzeUi5ProjectTool.handler({}, {
      context: { rootDir: root }
    });
    return project.ui5Version ?? null;
  } catch {
    return null;
  }
}

function extractSymbolsFromXml(content) {
  let analysis;
  try {
    analysis = analyzeUi5Xml(content);
  } catch {
    return [];
  }

  const symbols = [];
  for (const control of analysis.controls) {
    const namespace = control.namespacePrefix === "default"
      ? analysis.namespaces.default
      : analysis.namespaces[control.namespacePrefix];
    if (!namespace || !isUi5Namespace(namespace)) {
      continue;
    }
    symbols.push({
      symbol: `${namespace}.${control.localName}`,
      line: findLine(content, `<${control.namespacePrefix === "default" ? "" : `${control.namespacePrefix}:`}${control.localName}`)
    });
  }
  return dedupeSymbols(symbols);
}

function extractSymbolsFromJavaScript(code) {
  const imports = extractImports(code);
  const modulePaths = [...imports.esmImports, ...imports.sapUiDefineDependencies];
  const symbols = modulePaths
    .filter((modulePath) => modulePath.startsWith("sap/"))
    .map((modulePath) => ({
      symbol: modulePath.replaceAll("/", "."),
      line: findLine(code, modulePath)
    }));
  return dedupeSymbols(symbols);
}

function dedupeSymbols(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = `${item.symbol}::${item.line ?? 0}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function evaluateSymbolCompatibility(symbol, ui5Version, includeUnknownSymbols) {
  const entry = UI5_SYMBOL_CATALOG[symbol];
  if (!entry) {
    if (!includeUnknownSymbols) {
      return null;
    }
    return {
      kind: "unknown",
      introducedIn: null,
      status: "unknown",
      severity: "warn",
      message: `Symbol ${symbol} is not covered by local compatibility catalog.`,
      reference: null
    };
  }

  if (!ui5Version) {
    return {
      kind: entry.kind,
      introducedIn: entry.introducedIn,
      status: "unknown",
      severity: "warn",
      message: `Cannot verify ${symbol} without resolved UI5 version.`,
      reference: toUi5Reference(symbol)
    };
  }

  const compatible = compareUi5Versions(ui5Version, entry.introducedIn) >= 0;
  return {
    kind: entry.kind,
    introducedIn: entry.introducedIn,
    status: compatible ? "compatible" : "incompatible",
    severity: compatible ? "warn" : "error",
    message: compatible
      ? `${symbol} is compatible with UI5 ${ui5Version}.`
      : `${symbol} requires at least UI5 ${entry.introducedIn}, current project is ${ui5Version}.`,
    reference: toUi5Reference(symbol)
  };
}

function reconcileRecommendationsWithUi5Version(recommendations, ui5Version) {
  if (!ui5Version) {
    return dedupeRecommendations(recommendations);
  }

  const reconciled = [];
  for (const recommendation of recommendations) {
    if (isSymbolCompatibleWithVersion(recommendation.suggestedComponent, ui5Version)) {
      reconciled.push(recommendation);
      continue;
    }

    if (recommendation.suggestedComponent === "sap.m.DateTimePicker" &&
      isSymbolCompatibleWithVersion("sap.m.DatePicker", ui5Version)) {
      reconciled.push({
        ...recommendation,
        rule: "UI5_COMP_PREFER_DATE_PICKER_FALLBACK",
        suggestedComponent: "sap.m.DatePicker",
        reason: `DateTimePicker is unavailable in UI5 ${ui5Version}; use DatePicker and complement time handling in controller.`,
        confidence: "medium"
      });
    }
  }
  return dedupeRecommendations(reconciled);
}

function summarizeFindings(findings, recommendations) {
  let compatible = 0;
  let incompatible = 0;
  let unknown = 0;
  for (const finding of findings) {
    if (finding.status === "compatible") {
      compatible += 1;
    } else if (finding.status === "incompatible") {
      incompatible += 1;
    } else {
      unknown += 1;
    }
  }

  return {
    checkedSymbols: findings.length,
    compatible,
    incompatible,
    unknown,
    recommendations: recommendations.length,
    isCompatible: incompatible === 0
  };
}

function buildReferences(findings, recommendations) {
  const refs = new Map();
  for (const finding of findings) {
    if (finding.reference) {
      refs.set(finding.reference, {
        title: `SAPUI5 API: ${finding.symbol}`,
        url: finding.reference
      });
    }
  }
  for (const recommendation of recommendations) {
    const url = toUi5Reference(recommendation.suggestedComponent);
    refs.set(url, {
      title: `SAPUI5 API: ${recommendation.suggestedComponent}`,
      url
    });
  }
  return Array.from(refs.values());
}

function dedupeRecommendations(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = `${item.file}::${item.line ?? 0}::${item.rule}::${item.suggestedComponent}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
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

function toUi5Reference(symbol) {
  return `https://ui5.sap.com/#/api/${encodeURIComponent(symbol)}`;
}

function isUi5Namespace(namespace) {
  return namespace.startsWith("sap.");
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

function compareUi5Versions(a, b) {
  const left = normalizeVersion(a).split(".").map((part) => Number.parseInt(part, 10));
  const right = normalizeVersion(b).split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < 3; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function isSymbolCompatibleWithVersion(symbol, ui5Version) {
  const entry = UI5_SYMBOL_CATALOG[symbol];
  if (!entry) {
    return true;
  }
  return compareUi5Versions(ui5Version, entry.introducedIn) >= 0;
}

function normalizeVersion(version) {
  const clean = String(version).trim();
  const parts = clean.split(".");
  if (parts.length === 2) {
    return `${parts[0]}.${parts[1]}.0`;
  }
  if (parts.length >= 3) {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  return `${parts[0] ?? "0"}.0.0`;
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}
