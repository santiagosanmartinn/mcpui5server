import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { isIgnoredWorkspaceDirectory } from "../../utils/fileSystem.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readJsonFile, resolveWorkspacePath } from "../../utils/fileSystem.js";
import { analyzeUi5ProjectTool } from "../project/analyzeProject.js";

const PROJECT_TYPES = ["sapui5", "node", "generic"];
const DEFAULT_SOURCE_DIR = "webapp";
const DEFAULT_INTAKE_PATH = ".codex/mcp/project/intake.json";
const DEFAULT_BASELINE_PATH = ".codex/mcp/project/legacy-baseline.json";
const DEFAULT_BASELINE_DOC_PATH = "docs/mcp/legacy-baseline.md";
const DEFAULT_EXTENSIONS = [".js", ".xml", ".json", ".properties", ".ts"];
const DEFAULT_MAX_FILES = 2500;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".mcp-backups", ".mcp-cache", "dist", "coverage", ".next"]);

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  intakePath: z.string().min(1).optional(),
  baselinePath: z.string().min(1).optional(),
  baselineDocPath: z.string().min(1).optional(),
  includeExtensions: z.array(z.string().min(2)).optional(),
  maxFiles: z.number().int().min(100).max(10000).optional(),
  dryRun: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional()
}).strict();

const riskFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  file: z.string(),
  message: z.string(),
  suggestion: z.string()
});

const hotspotSchema = z.object({
  path: z.string(),
  score: z.number().min(0).max(1),
  lines: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  reasons: z.array(z.string())
});

const previewSchema = z.object({
  path: z.string(),
  role: z.enum(["legacy-baseline-json", "legacy-baseline-doc"]),
  existsBefore: z.boolean(),
  changed: z.boolean(),
  oldHash: z.string().nullable(),
  newHash: z.string(),
  diffPreview: z.string(),
  diffTruncated: z.boolean()
});

const outputSchema = z.object({
  dryRun: z.boolean(),
  changed: z.boolean(),
  sourceDir: z.string(),
  project: z.object({
    name: z.string(),
    type: z.enum(PROJECT_TYPES),
    namespace: z.string().nullable(),
    ui5Version: z.string().nullable(),
    routingDetected: z.boolean()
  }),
  intake: z.object({
    exists: z.boolean(),
    missingContext: z.array(z.string())
  }),
  inventory: z.object({
    scannedFiles: z.number().int().nonnegative(),
    jsFiles: z.number().int().nonnegative(),
    tsFiles: z.number().int().nonnegative(),
    xmlFiles: z.number().int().nonnegative(),
    jsonFiles: z.number().int().nonnegative(),
    propertiesFiles: z.number().int().nonnegative(),
    totalLines: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative()
  }),
  architecture: z.object({
    controllerPattern: z.string(),
    hasTests: z.boolean(),
    hasQualityScript: z.boolean(),
    hasMcpState: z.boolean()
  }),
  qualityRisks: z.array(riskFindingSchema),
  hotspots: z.array(hotspotSchema),
  recommendations: z.array(z.string()),
  files: z.object({
    baselinePath: z.string(),
    baselineDocPath: z.string()
  }),
  previews: z.array(previewSchema),
  applyResult: z.object({
    patchId: z.string().nullable(),
    appliedAt: z.string(),
    reason: z.string().nullable(),
    changedFiles: z.array(
      z.object({
        path: z.string(),
        changed: z.boolean(),
        oldHash: z.string().nullable(),
        newHash: z.string(),
        bytesBefore: z.number().int().nonnegative(),
        bytesAfter: z.number().int().nonnegative()
      })
    ),
    skippedFiles: z.array(z.string())
  }).nullable()
});

const intakeSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  missingContext: z.array(z.string()).optional()
}).passthrough();

export const analyzeLegacyProjectBaselineTool = {
  name: "analyze_legacy_project_baseline",
  description: "Build a technical baseline for legacy projects to guide high-quality AI integration with minimal context waste.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      intakePath,
      baselinePath,
      baselineDocPath,
      includeExtensions,
      maxFiles,
      dryRun,
      reason,
      maxDiffLines
    } = inputSchema.parse(args);

    const root = context.rootDir;
    const selectedSourceDir = normalizePath(sourceDir ?? DEFAULT_SOURCE_DIR);
    const selectedIntakePath = normalizePath(intakePath ?? DEFAULT_INTAKE_PATH);
    const selectedBaselinePath = normalizePath(baselinePath ?? DEFAULT_BASELINE_PATH);
    const selectedBaselineDocPath = normalizePath(baselineDocPath ?? DEFAULT_BASELINE_DOC_PATH);
    const selectedExtensions = new Set((includeExtensions ?? DEFAULT_EXTENSIONS).map(normalizeExtension));
    const selectedMaxFiles = maxFiles ?? DEFAULT_MAX_FILES;
    const shouldDryRun = dryRun ?? true;

    enforceManagedSubtree(selectedBaselinePath, ".codex/mcp", "baselinePath");
    enforceManagedSubtree(selectedBaselineDocPath, "docs", "baselineDocPath");
    enforceManagedSubtree(selectedIntakePath, ".codex/mcp", "intakePath");

    const project = await detectProjectProfile(root);
    const sourceDirExists = await fileExists(selectedSourceDir, root);
    const effectiveSourceDir = sourceDirExists ? selectedSourceDir : ".";

    const scan = await scanWorkspace({
      root,
      sourceDir: effectiveSourceDir,
      maxFiles: selectedMaxFiles,
      extensions: selectedExtensions
    });

    const intake = await readIntake(selectedIntakePath, root);
    const hasTests = await detectTests(root);
    const hasQualityScript = await detectQualityScript(root);
    const hasMcpState = await fileExists(".codex/mcp/project/mcp-project-state.json", root);

    const risks = scan.risks.slice(0, 80);
    const hotspots = buildHotspots(scan.files).slice(0, 25);
    const recommendations = buildRecommendations({
      project,
      intake,
      risks,
      hotspots,
      hasTests,
      hasQualityScript,
      hasMcpState
    });

    const baselinePayload = {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      sourceDir: effectiveSourceDir,
      project,
      intake: {
        exists: intake.exists,
        missingContext: intake.missingContext
      },
      inventory: {
        scannedFiles: scan.summary.scannedFiles,
        jsFiles: scan.summary.jsFiles,
        tsFiles: scan.summary.tsFiles,
        xmlFiles: scan.summary.xmlFiles,
        jsonFiles: scan.summary.jsonFiles,
        propertiesFiles: scan.summary.propertiesFiles,
        totalLines: scan.summary.totalLines,
        totalBytes: scan.summary.totalBytes
      },
      architecture: {
        controllerPattern: project.controllerPattern,
        hasTests,
        hasQualityScript,
        hasMcpState
      },
      qualityRisks: risks,
      hotspots,
      recommendations
    };

    const baselineDoc = renderBaselineDoc(baselinePayload);

    const plannedWrites = [
      {
        path: selectedBaselinePath,
        role: "legacy-baseline-json",
        content: `${JSON.stringify(baselinePayload, null, 2)}\n`
      },
      {
        path: selectedBaselineDocPath,
        role: "legacy-baseline-doc",
        content: baselineDoc
      }
    ];

    const previews = [];
    for (const write of plannedWrites) {
      const preview = await previewFileWrite(write.path, write.content, {
        root,
        maxDiffLines
      });
      previews.push({
        path: preview.path,
        role: write.role,
        existsBefore: preview.existsBefore,
        changed: preview.changed,
        oldHash: preview.oldHash,
        newHash: preview.newHash,
        diffPreview: preview.diffPreview,
        diffTruncated: preview.diffTruncated
      });
    }

    const changed = previews.some((item) => item.changed);
    let applyResult = null;
    if (!shouldDryRun && changed) {
      applyResult = await applyProjectPatch(
        plannedWrites.map((write) => {
          const preview = previews.find((item) => item.path === write.path);
          return {
            path: write.path,
            content: write.content,
            expectedOldHash: preview?.oldHash ?? undefined
          };
        }),
        {
          root,
          reason: reason ?? "analyze_legacy_project_baseline"
        }
      );
    }

    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed,
      sourceDir: effectiveSourceDir,
      project: {
        name: project.name,
        type: project.type,
        namespace: project.namespace,
        ui5Version: project.ui5Version,
        routingDetected: project.routingDetected
      },
      intake: {
        exists: intake.exists,
        missingContext: intake.missingContext
      },
      inventory: baselinePayload.inventory,
      architecture: baselinePayload.architecture,
      qualityRisks: risks,
      hotspots,
      recommendations,
      files: {
        baselinePath: selectedBaselinePath,
        baselineDocPath: selectedBaselineDocPath
      },
      previews,
      applyResult
    });
  }
};

async function detectProjectProfile(root) {
  const fallback = {
    name: path.basename(path.resolve(root)),
    type: "generic",
    namespace: null,
    ui5Version: null,
    routingDetected: false,
    controllerPattern: "unknown"
  };

  try {
    const analysis = await analyzeUi5ProjectTool.handler({}, { context: { rootDir: root } });
    const type = analysis.detectedFiles.manifestJson || analysis.detectedFiles.ui5Yaml
      ? "sapui5"
      : analysis.detectedFiles.packageJson
        ? "node"
        : "generic";
    return {
      name: analysis.namespace ?? fallback.name,
      type,
      namespace: analysis.namespace,
      ui5Version: analysis.ui5Version,
      routingDetected: analysis.routing.hasRouting,
      controllerPattern: analysis.controllerPattern
    };
  } catch {
    if (await fileExists("package.json", root)) {
      return {
        ...fallback,
        type: "node"
      };
    }
    return fallback;
  }
}

async function readIntake(intakePath, root) {
  if (!(await fileExists(intakePath, root))) {
    return {
      exists: false,
      missingContext: ["projectGoal", "criticality", "allowedRefactorScope"]
    };
  }

  const json = await readJsonFile(intakePath, root);
  const parsed = intakeSchema.safeParse(json);
  if (!parsed.success) {
    throw new ToolError(`Invalid intake schema at ${intakePath}`, {
      code: "INVALID_LEGACY_INTAKE",
      details: {
        intakePath,
        issue: parsed.error.issues[0] ?? null
      }
    });
  }

  return {
    exists: true,
    missingContext: parsed.data.missingContext ?? []
  };
}

async function detectTests(root) {
  return (await fileExists("test", root)) || (await fileExists("tests", root));
}

async function detectQualityScript(root) {
  if (!(await fileExists("package.json", root))) {
    return false;
  }
  try {
    const packageJson = await readJsonFile("package.json", root);
    return Boolean(packageJson?.scripts?.check);
  } catch {
    return false;
  }
}

async function scanWorkspace(options) {
  const { root, sourceDir, maxFiles, extensions } = options;
  const sourceAbsolute = resolveWorkspacePath(sourceDir, root);
  const files = [];
  const risks = [];
  const summary = {
    scannedFiles: 0,
    jsFiles: 0,
    tsFiles: 0,
    xmlFiles: 0,
    jsonFiles: 0,
    propertiesFiles: 0,
    totalLines: 0,
    totalBytes: 0
  };

  await walk(sourceAbsolute);

  files.sort((a, b) => b.lines - a.lines);
  return {
    files,
    risks,
    summary
  };

  async function walk(currentDir) {
    if (summary.scannedFiles >= maxFiles) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (summary.scannedFiles >= maxFiles) {
        break;
      }
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const relativePath = path.relative(path.resolve(root), absolutePath).replaceAll("\\", "/");
        if (isIgnoredWorkspaceDirectory(entry.name, relativePath, IGNORED_DIRS)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      const extension = normalizeExtension(path.extname(entry.name));
      if (!extensions.has(extension)) {
        continue;
      }

      const content = await fs.readFile(absolutePath, "utf8");
      const relativePath = path.relative(path.resolve(root), absolutePath).replaceAll("\\", "/");
      const lines = content.split(/\r?\n/).length;
      const bytes = Buffer.byteLength(content, "utf8");
      summary.scannedFiles += 1;
      summary.totalLines += lines;
      summary.totalBytes += bytes;
      incrementByExtension(summary, extension);

      const fileRisks = detectRisks(relativePath, content, extension);
      for (const risk of fileRisks) {
        risks.push(risk);
      }

      files.push({
        path: relativePath,
        lines,
        bytes,
        todos: countPattern(content, /\b(?:TODO|FIXME|XXX)\b/g),
        securityRiskCount: fileRisks.filter((risk) => risk.severity === "high").length,
        mediumRiskCount: fileRisks.filter((risk) => risk.severity === "medium").length
      });
    }
  }
}

function detectRisks(filePath, content, extension) {
  const findings = [];
  if (countPattern(content, /\beval\s*\(/g) > 0) {
    findings.push({
      id: "LEGACY_SEC_EVAL",
      severity: "high",
      file: filePath,
      message: "Use of eval detected.",
      suggestion: "Replace dynamic execution with deterministic mapping/functions."
    });
  }
  if (countPattern(content, /new\s+Function\s*\(/g) > 0) {
    findings.push({
      id: "LEGACY_SEC_NEW_FUNCTION",
      severity: "high",
      file: filePath,
      message: "new Function detected.",
      suggestion: "Avoid runtime code construction; use explicit control flow."
    });
  }
  if (countPattern(content, /innerHTML\s*=|document\.write\s*\(/g) > 0) {
    findings.push({
      id: "LEGACY_SEC_HTML_INJECTION",
      severity: "high",
      file: filePath,
      message: "Potential unsafe HTML injection pattern detected.",
      suggestion: "Use escaped text bindings/UI5 controls and sanitize any trusted HTML."
    });
  }
  if (countPattern(content, /async\s*:\s*false/g) > 0) {
    findings.push({
      id: "LEGACY_PERF_SYNC_IO",
      severity: "medium",
      file: filePath,
      message: "Synchronous async:false pattern detected.",
      suggestion: "Refactor to asynchronous flow to avoid UI blocking."
    });
  }
  if (countPattern(content, /\bconsole\.log\s*\(/g) > 0) {
    findings.push({
      id: "LEGACY_QUALITY_CONSOLE",
      severity: "low",
      file: filePath,
      message: "console.log usage detected in source.",
      suggestion: "Replace ad-hoc logs with controlled logger or remove debug noise."
    });
  }
  if (countPattern(content, /\b(?:TODO|FIXME|XXX)\b/g) > 0) {
    findings.push({
      id: "LEGACY_MAINTENANCE_TODO",
      severity: "low",
      file: filePath,
      message: "Pending TODO/FIXME markers detected.",
      suggestion: "Track in backlog and close critical items before major refactors."
    });
  }
  if (extension === ".xml" && countPattern(content, /<(?:\w+:)?HTML\b/g) > 0) {
    findings.push({
      id: "LEGACY_UI5_RAW_HTML",
      severity: "medium",
      file: filePath,
      message: "Raw HTML control detected in XML.",
      suggestion: "Prefer native UI5 controls aligned with SAP UX guidelines."
    });
  }
  return findings;
}

function buildHotspots(files) {
  return files
    .map((file) => {
      const reasons = [];
      if (file.lines > 500) {
        reasons.push("large-file");
      }
      if (file.todos > 0) {
        reasons.push("todo-debt");
      }
      if (file.securityRiskCount > 0) {
        reasons.push("security-risk");
      }
      if (file.mediumRiskCount > 0) {
        reasons.push("medium-risk");
      }
      const score = clamp(
        (file.lines / 1500) +
        (file.todos * 0.03) +
        (file.securityRiskCount * 0.28) +
        (file.mediumRiskCount * 0.12),
        0,
        1
      );
      return {
        path: file.path,
        score: round(score),
        lines: file.lines,
        bytes: file.bytes,
        reasons
      };
    })
    .filter((item) => item.score >= 0.2)
    .sort((a, b) => b.score - a.score || b.lines - a.lines);
}

function buildRecommendations(input) {
  const { project, intake, risks, hotspots, hasTests, hasQualityScript, hasMcpState } = input;
  const recommendations = [];

  if (!hasMcpState) {
    recommendations.push("Run ensure_project_mcp_current before feature work to align managed MCP artifacts.");
  }
  if (!intake.exists || intake.missingContext.length > 0) {
    recommendations.push("Complete collect_legacy_project_intake to capture runtime constraints and reduce ambiguous AI proposals.");
  }
  if (!hasQualityScript) {
    recommendations.push("Add npm run check script to enforce deterministic lint/test quality gates.");
  }
  if (!hasTests) {
    recommendations.push("Create a baseline test suite for critical flows before broad refactoring.");
  }
  if (risks.some((risk) => risk.severity === "high")) {
    recommendations.push("Prioritize remediation of high-severity security patterns before major modernization.");
  }
  if (project.type === "sapui5" && !project.ui5Version) {
    recommendations.push("Confirm effective UI5 runtime version to avoid incompatible component recommendations.");
  }
  if (hotspots.length > 0) {
    recommendations.push("Use build_ai_context_index after this baseline to focus prompts on hotspot files and mandatory architecture artifacts.");
  }

  return unique(recommendations).slice(0, 12);
}

function renderBaselineDoc(payload) {
  return [
    "# Legacy Baseline",
    "",
    `Generated at: ${payload.generatedAt}`,
    `Source dir: ${payload.sourceDir}`,
    "",
    "## Project",
    "",
    `- Name: ${payload.project.name}`,
    `- Type: ${payload.project.type}`,
    `- Namespace: ${payload.project.namespace ?? "n/a"}`,
    `- UI5 version: ${payload.project.ui5Version ?? "unknown"}`,
    `- Routing detected: ${payload.project.routingDetected}`,
    `- Controller pattern: ${payload.project.controllerPattern}`,
    "",
    "## Inventory",
    "",
    `- Files scanned: ${payload.inventory.scannedFiles}`,
    `- JS: ${payload.inventory.jsFiles}`,
    `- TS: ${payload.inventory.tsFiles}`,
    `- XML: ${payload.inventory.xmlFiles}`,
    `- JSON: ${payload.inventory.jsonFiles}`,
    `- Properties: ${payload.inventory.propertiesFiles}`,
    `- Total lines: ${payload.inventory.totalLines}`,
    "",
    "## Intake",
    "",
    `- Intake exists: ${payload.intake.exists}`,
    `- Missing context fields: ${payload.intake.missingContext.join(", ") || "none"}`,
    "",
    "## Top Hotspots",
    "",
    ...payload.hotspots.slice(0, 10).map((item) => `- ${item.path} (score ${item.score}, lines ${item.lines}, reasons: ${item.reasons.join(", ") || "n/a"})`),
    "",
    "## Key Risks",
    "",
    ...payload.qualityRisks.slice(0, 12).map((risk) => `- [${risk.severity}] ${risk.file}: ${risk.message}`),
    "",
    "## Recommendations",
    "",
    ...payload.recommendations.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function incrementByExtension(summary, extension) {
  if (extension === ".js") {
    summary.jsFiles += 1;
    return;
  }
  if (extension === ".ts") {
    summary.tsFiles += 1;
    return;
  }
  if (extension === ".xml") {
    summary.xmlFiles += 1;
    return;
  }
  if (extension === ".json") {
    summary.jsonFiles += 1;
    return;
  }
  if (extension === ".properties") {
    summary.propertiesFiles += 1;
  }
}

function countPattern(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function normalizeExtension(value) {
  const normalized = value.toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function unique(values) {
  return Array.from(new Set(values));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function enforceManagedSubtree(pathValue, rootPrefix, label) {
  if (!pathValue.startsWith(`${rootPrefix}/`) && pathValue !== rootPrefix) {
    throw new ToolError(`${label} must stay inside ${rootPrefix}.`, {
      code: "INVALID_ARTIFACT_LAYOUT",
      details: {
        label,
        path: pathValue,
        expectedPrefix: rootPrefix
      }
    });
  }
}
