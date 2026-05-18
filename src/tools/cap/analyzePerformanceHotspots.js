import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { fileExists, isIgnoredWorkspaceDirectory, readTextFile, resolveWorkspacePath } from "../../utils/fileSystem.js";
import { getSapOfficialRefsForRule } from "../documentation/sapOfficialDocs.js";
import { findLine, readCapProject } from "./common.js";
import { analyzeCdsModelContractTool } from "./analyzeCdsModelContract.js";

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  ui5SourceDir: z.string().min(1).optional(),
  includeUi5: z.boolean().optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  maxFindings: z.number().int().min(10).max(2000).optional()
}).strict();

const officialRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  product: z.enum(["cap", "ui5"]),
  topic: z.string()
});

const hotspotSchema = z.object({
  rule: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  category: z.enum(["query", "model", "handler", "ui5", "batch"]),
  file: z.string(),
  line: z.number().int().positive().nullable(),
  message: z.string(),
  suggestion: z.string(),
  officialRefs: z.array(officialRefSchema)
});

const outputSchema = z.object({
  sourceDir: z.string(),
  ui5SourceDir: z.string(),
  score: z.number().int().min(0).max(100),
  scanned: z.object({
    capFiles: z.number().int().nonnegative(),
    handlerFiles: z.number().int().nonnegative(),
    cdsFiles: z.number().int().nonnegative(),
    ui5Files: z.number().int().nonnegative()
  }),
  summary: z.object({
    totalHotspots: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    byCategory: z.record(z.number().int().nonnegative()),
    truncated: z.boolean()
  }),
  hotspots: z.array(hotspotSchema),
  recommendedCommands: z.array(z.string())
});

export const analyzeCapPerformanceHotspotsTool = {
  name: "analyze_cap_performance_hotspots",
  description: "Analyze SAP CAP and UI5 sources for common performance hotspots in CDS models, handlers, OData usage, batching, and list bindings.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { sourceDir, ui5SourceDir, includeUi5, maxFiles, maxFindings } = inputSchema.parse(args);
    const selectedUi5SourceDir = normalizePath(ui5SourceDir ?? "webapp");
    const project = await readCapProject({
      root: context.rootDir,
      sourceDir,
      maxFiles
    });
    const contract = await analyzeCdsModelContractTool.handler({ sourceDir, maxFiles }, { context });
    const hotspots = [];
    for (const file of project.jsFiles.filter(isLikelyCapHandler)) {
      hotspots.push(...await analyzeHandlerFile({
        root: context.rootDir,
        file
      }));
    }
    hotspots.push(...analyzeModelHotspots(contract));
    const ui5Files = includeUi5 === false
      ? []
      : await readUi5Files({
          root: context.rootDir,
          sourceDir: selectedUi5SourceDir,
          maxFiles: maxFiles ?? 1200
        });
    for (const file of ui5Files) {
      hotspots.push(...analyzeUi5File(file));
    }
    const effectiveMaxFindings = maxFindings ?? 500;
    const truncated = hotspots.length > effectiveMaxFindings;
    const limitedHotspots = hotspots.slice(0, effectiveMaxFindings);
    const summary = summarize(limitedHotspots, truncated);

    return outputSchema.parse({
      sourceDir: project.sourceDir,
      ui5SourceDir: selectedUi5SourceDir,
      score: calculateScore(summary),
      scanned: {
        capFiles: project.files.length,
        handlerFiles: project.jsFiles.filter(isLikelyCapHandler).length,
        cdsFiles: project.cdsFiles.length,
        ui5Files: ui5Files.length
      },
      summary,
      hotspots: limitedHotspots,
      recommendedCommands: [
        "npx cds compile srv --to csn",
        "npx cds lint",
        "npm test"
      ]
    });
  }
};

async function analyzeHandlerFile(input) {
  const { root, file } = input;
  const content = await readTextFile(file, root);
  const hotspots = [];
  addRegexHotspots({
    hotspots,
    content,
    file,
    pattern: /SELECT\s+\*\s+FROM|SELECT\.from\s*\([^)]*\)(?![\s\S]{0,250}\.columns\s*\()/gi,
    rule: "CAP_PERF_SELECT_STAR_OR_WIDE_READ",
    severity: "medium",
    category: "query",
    message: "Potential wide SELECT detected in CAP handler.",
    suggestion: "Select only the required columns or rely on request projections where possible."
  });
  addRegexHotspots({
    hotspots,
    content,
    file,
    pattern: /SELECT\.from\s*\([^)]*\)(?![\s\S]{0,250}\.limit\s*\()/g,
    rule: "CAP_PERF_UNBOUNDED_SELECT",
    severity: "high",
    category: "query",
    message: "Custom SELECT appears to run without an explicit limit nearby.",
    suggestion: "Respect OData paging or apply a defensive limit for custom reads over large entity sets."
  });
  addRegexHotspots({
    hotspots,
    content,
    file,
    pattern: /(?:cds|db|tx)\.run\s*\(\s*[`"']\s*SELECT[\s\S]{0,220}\bFROM\b(?![\s\S]{0,250}\bLIMIT\b)/gi,
    rule: "CAP_PERF_UNBOUNDED_SELECT",
    severity: "high",
    category: "query",
    message: "Raw SELECT appears to run without an explicit LIMIT.",
    suggestion: "Use CQN with paging/limits or ensure raw SQL has a bounded result set."
  });
  addRegexHotspots({
    hotspots,
    content,
    file,
    pattern: /(?:for\s*\([^)]*\)|\.forEach\s*\([^)]*=>[\s\S]{0,120})[\s\S]{0,240}\bawait\b/g,
    rule: "CAP_PERF_AWAIT_IN_LOOP",
    severity: "medium",
    category: "handler",
    message: "Await inside a loop-like construct can serialize database or remote calls.",
    suggestion: "Batch independent reads/writes, use set-based queries, or collect promises intentionally."
  });
  addRegexHotspots({
    hotspots,
    content,
    file,
    pattern: /\$expand\s*=|\.expand\s*\(/g,
    rule: "CAP_PERF_EXPAND_IN_HANDLER",
    severity: "low",
    category: "query",
    message: "Explicit expand handling detected in custom code.",
    suggestion: "Verify cardinality and payload size; prefer narrow projections for list scenarios."
  });
  return hotspots;
}

function analyzeModelHotspots(contract) {
  const hotspots = [];
  for (const entity of contract.entities) {
    for (const association of entity.associations) {
      if (association.cardinality === "many" && entity.exposedByServices.length > 0) {
        hotspots.push(createHotspot({
          rule: "CAP_PERF_TO_MANY_EXPOSED_ASSOCIATION",
          severity: "medium",
          category: "model",
          file: entity.file,
          line: entity.line,
          message: `Entity ${entity.qualifiedName} exposes to-many association ${association.name}.`,
          suggestion: "Review default UI expansions and service projections to avoid unexpectedly large payloads."
        }));
      }
    }
    if (entity.fields.some((field) => field.localized && /^localized\s+String$/i.test(field.type))) {
      hotspots.push(createHotspot({
        rule: "CAP_PERF_LOCALIZED_UNBOUNDED_TEXT",
        severity: "low",
        category: "model",
        file: entity.file,
        line: entity.line,
        message: `Entity ${entity.qualifiedName} uses localized String without explicit length.`,
        suggestion: "Confirm search/sort behavior and persistence footprint for localized text fields."
      }));
    }
  }
  return hotspots;
}

function analyzeUi5File(file) {
  const hotspots = [];
  addRegexHotspots({
    hotspots,
    content: file.content,
    file: file.path,
    pattern: /setUseBatch\s*\(\s*false\s*\)/g,
    rule: "UI5_PERF_ODATA_BATCH_DISABLED",
    severity: "medium",
    category: "batch",
    message: "OData batch processing is disabled in UI5 code.",
    suggestion: "Keep batching enabled unless a documented service constraint requires otherwise."
  });
  if (file.path.endsWith(".xml")) {
    addRegexHotspots({
      hotspots,
      content: file.content,
      file: file.path,
      pattern: /<(?:List|Table|TreeTable|GridTable)\b(?=[^>]*\bitems\s*=)(?![^>]*\bgrowing\s*=\s*["']true["'])[^>]*>/g,
      rule: "UI5_PERF_LIST_GROWING_MISSING",
      severity: "low",
      category: "ui5",
      message: "List/Table binding has no growing=true signal.",
      suggestion: "For large OData collections, use growing or a Fiori elements table pattern with server-side paging."
    });
  }
  addRegexHotspots({
    hotspots,
    content: file.content,
    file: file.path,
    pattern: /(?:for\s*\([^)]*\)|\.forEach\s*\([^)]*=>[\s\S]{0,120})[\s\S]{0,240}\.(?:read|create|update|remove)\s*\(/g,
    rule: "UI5_PERF_ODATA_CALL_IN_LOOP",
    severity: "medium",
    category: "ui5",
    message: "OData model operation appears inside a loop-like construct.",
    suggestion: "Batch requests or redesign the flow to reduce OData roundtrips."
  });
  return hotspots;
}

async function readUi5Files(input) {
  const { root, sourceDir, maxFiles } = input;
  if (!await fileExists(sourceDir, root)) {
    return [];
  }
  const resolvedRoot = path.resolve(root);
  const sourceAbsolute = resolveWorkspacePath(sourceDir, root);
  const files = [];
  await walk(sourceAbsolute);
  return files;

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
      const relativePath = path.relative(resolvedRoot, absolutePath).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (isIgnoredWorkspaceDirectory(entry.name, relativePath)) {
          continue;
        }
        await walk(absolutePath);
      } else if (entry.isFile() && [".js", ".xml"].includes(path.extname(entry.name).toLowerCase())) {
        files.push({
          path: relativePath,
          content: await readTextFile(relativePath, root)
        });
      }
    }
  }
}

function addRegexHotspots(input) {
  const { hotspots, content, file, pattern, rule, severity, category, message, suggestion } = input;
  let match = pattern.exec(content);
  while (match) {
    hotspots.push(createHotspot({
      rule,
      severity,
      category,
      file,
      line: findLine(content, match.index),
      message,
      suggestion
    }));
    match = pattern.exec(content);
  }
}

function createHotspot(input) {
  return {
    rule: input.rule,
    severity: input.severity,
    category: input.category,
    file: input.file,
    line: input.line ?? null,
    message: input.message,
    suggestion: input.suggestion,
    officialRefs: getSapOfficialRefsForRule(input.rule).map((reference) => ({
      id: reference.id,
      title: reference.title,
      url: reference.url,
      product: reference.product,
      topic: reference.topic
    }))
  };
}

function summarize(hotspots, truncated) {
  const byCategory = {};
  for (const hotspot of hotspots) {
    byCategory[hotspot.category] = (byCategory[hotspot.category] ?? 0) + 1;
  }
  return {
    totalHotspots: hotspots.length,
    high: hotspots.filter((hotspot) => hotspot.severity === "high").length,
    medium: hotspots.filter((hotspot) => hotspot.severity === "medium").length,
    low: hotspots.filter((hotspot) => hotspot.severity === "low").length,
    byCategory,
    truncated
  };
}

function calculateScore(summary) {
  return Math.max(0, 100 - summary.high * 25 - summary.medium * 10 - summary.low * 3);
}

function isLikelyCapHandler(file) {
  const normalized = file.replaceAll("\\", "/");
  return (normalized.startsWith("srv/") || normalized.includes("/srv/"))
    && [".js", ".ts"].some((extension) => normalized.endsWith(extension));
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}
