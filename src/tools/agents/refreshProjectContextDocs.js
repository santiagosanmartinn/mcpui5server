import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readJsonFile, resolveWorkspacePath } from "../../utils/fileSystem.js";
import { recommendProjectAgentsTool } from "./recommendProjectAgents.js";

const DEFAULT_SOURCE_DIR = "webapp";
const DEFAULT_DOCS_DIR = "docs/mcp";
const DEFAULT_CACHE_PATH = ".codex/mcp/context-snapshot.json";
const DEFAULT_MAX_FILES = 2000;
const DEFAULT_EXTENSIONS = [".js", ".xml", ".json", ".properties", ".yaml", ".yml"];
const IGNORED_DIRS = new Set(["node_modules", ".git", ".mcp-backups", ".mcp-cache", "dist", "coverage"]);

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  docsDir: z.string().min(1).optional(),
  cachePath: z.string().min(1).optional(),
  maxFiles: z.number().int().min(100).max(10000).optional(),
  includeExtensions: z.array(z.string().min(2)).optional(),
  dryRun: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional()
}).strict();

const previewSchema = z.object({
  path: z.string(),
  role: z.enum(["context-doc", "flows-doc", "snapshot-cache"]),
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
  docsDir: z.string(),
  cachePath: z.string(),
  delta: z.object({
    hasPreviousSnapshot: z.boolean(),
    added: z.number().int().nonnegative(),
    modified: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative()
  }),
  tracked: z.object({
    totalFiles: z.number().int().nonnegative(),
    jsFiles: z.number().int().nonnegative(),
    xmlFiles: z.number().int().nonnegative()
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

const snapshotSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  sourceDir: z.string(),
  trackedFiles: z.array(
    z.object({
      path: z.string(),
      hash: z.string(),
      bytes: z.number().int().nonnegative()
    })
  ),
  summary: z.object({
    totalFiles: z.number().int().nonnegative(),
    jsFiles: z.number().int().nonnegative(),
    xmlFiles: z.number().int().nonnegative()
  }),
  project: z.object({
    name: z.string(),
    type: z.enum(["sapui5", "node", "generic"]),
    namespace: z.string().nullable()
  })
});

export const refreshProjectContextDocsTool = {
  name: "refresh_project_context_docs",
  description: "Refresh docs/mcp context files incrementally using workspace snapshot diff with deterministic output.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      docsDir,
      cachePath,
      maxFiles,
      includeExtensions,
      dryRun,
      reason,
      maxDiffLines
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const selectedSourceDir = normalizePath(sourceDir ?? DEFAULT_SOURCE_DIR);
    const selectedDocsDir = normalizePath(docsDir ?? DEFAULT_DOCS_DIR);
    const selectedCachePath = normalizePath(cachePath ?? DEFAULT_CACHE_PATH);
    const selectedMaxFiles = maxFiles ?? DEFAULT_MAX_FILES;
    const selectedExtensions = new Set((includeExtensions ?? DEFAULT_EXTENSIONS).map(normalizeExtension));
    const shouldDryRun = dryRun ?? true;

    enforceManagedSubtree(selectedDocsDir, "docs", "docsDir");
    enforceManagedSubtree(selectedCachePath, ".codex/mcp", "cachePath");

    const scan = await scanWorkspace({
      root,
      sourceDir: selectedSourceDir,
      maxFiles: selectedMaxFiles,
      extensions: selectedExtensions
    });

    const recommendation = await recommendProjectAgentsTool.handler(
      {
        sourceDir: selectedSourceDir,
        maxFiles: selectedMaxFiles,
        includePackCatalog: false
      },
      {
        context
      }
    );

    const previousSnapshot = await readSnapshotIfExists(selectedCachePath, root);
    const currentSnapshot = snapshotSchema.parse({
      schemaVersion: "1.0.0",
      sourceDir: selectedSourceDir,
      trackedFiles: scan.trackedFiles,
      summary: {
        totalFiles: scan.totalFiles,
        jsFiles: scan.jsFiles,
        xmlFiles: scan.xmlFiles
      },
      project: recommendation.project
    });

    const delta = computeDelta(previousSnapshot, currentSnapshot);
    const contextDocPath = joinPath(selectedDocsDir, "project-context.md");
    const flowsDocPath = joinPath(selectedDocsDir, "agent-flows.md");
    const contextDocContent = renderProjectContextDoc({
      project: recommendation.project,
      summary: currentSnapshot.summary,
      sourceDir: selectedSourceDir,
      docsDir: selectedDocsDir,
      cachePath: selectedCachePath,
      recommendations: recommendation.recommendations
    });
    const flowsDocContent = renderAgentFlowsDoc({
      project: recommendation.project,
      recommendations: recommendation.recommendations
    });
    const snapshotContent = `${JSON.stringify(currentSnapshot, null, 2)}\n`;

    const plannedWrites = [
      {
        path: contextDocPath,
        role: "context-doc",
        content: contextDocContent
      },
      {
        path: flowsDocPath,
        role: "flows-doc",
        content: flowsDocContent
      },
      {
        path: selectedCachePath,
        role: "snapshot-cache",
        content: snapshotContent
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
      applyResult = await applyProjectPatch(plannedWrites.map((write) => {
        const preview = previews.find((item) => item.path === write.path);
        return {
          path: write.path,
          content: write.content,
          expectedOldHash: preview?.oldHash ?? undefined
        };
      }), {
        root,
        reason: reason ?? "refresh_project_context_docs"
      });
    }

    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed,
      sourceDir: selectedSourceDir,
      docsDir: selectedDocsDir,
      cachePath: selectedCachePath,
      delta,
      tracked: currentSnapshot.summary,
      previews,
      applyResult
    });
  }
};

async function scanWorkspace(options) {
  const { root, sourceDir, maxFiles, extensions } = options;
  const sourceAbsolute = resolveWorkspacePath(sourceDir, root);
  const trackedFiles = [];
  let jsFiles = 0;
  let xmlFiles = 0;
  await walk(sourceAbsolute);
  trackedFiles.sort((a, b) => a.path.localeCompare(b.path));
  return {
    totalFiles: trackedFiles.length,
    jsFiles,
    xmlFiles,
    trackedFiles
  };

  async function walk(currentDir) {
    if (trackedFiles.length >= maxFiles) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (trackedFiles.length >= maxFiles) {
        break;
      }
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      const extension = normalizeExtension(path.extname(entry.name));
      if (!extensions.has(extension)) {
        continue;
      }

      const buffer = await fs.readFile(absolutePath);
      const relativePath = path.relative(path.resolve(root), absolutePath).replaceAll("\\", "/");
      trackedFiles.push({
        path: relativePath,
        hash: hashBuffer(buffer),
        bytes: buffer.length
      });
      if (extension === ".js") {
        jsFiles += 1;
      }
      if (extension === ".xml") {
        xmlFiles += 1;
      }
    }
  }
}

async function readSnapshotIfExists(cachePath, root) {
  if (!(await fileExists(cachePath, root))) {
    return null;
  }
  const parsed = await readJsonFile(cachePath, root);
  const result = snapshotSchema.safeParse(parsed);
  if (!result.success) {
    throw new ToolError("Invalid context snapshot file.", {
      code: "INVALID_CONTEXT_SNAPSHOT",
      details: {
        cachePath
      }
    });
  }
  return result.data;
}

function computeDelta(previousSnapshot, currentSnapshot) {
  const previousMap = new Map((previousSnapshot?.trackedFiles ?? []).map((item) => [item.path, item.hash]));
  const currentMap = new Map(currentSnapshot.trackedFiles.map((item) => [item.path, item.hash]));
  let added = 0;
  let modified = 0;
  let unchanged = 0;
  for (const [filePath, hash] of currentMap) {
    if (!previousMap.has(filePath)) {
      added += 1;
      continue;
    }
    if (previousMap.get(filePath) !== hash) {
      modified += 1;
      continue;
    }
    unchanged += 1;
  }
  let removed = 0;
  for (const filePath of previousMap.keys()) {
    if (!currentMap.has(filePath)) {
      removed += 1;
    }
  }
  return {
    hasPreviousSnapshot: Boolean(previousSnapshot),
    added,
    modified,
    removed,
    unchanged
  };
}

function renderProjectContextDoc(input) {
  const {
    project,
    summary,
    sourceDir,
    docsDir,
    cachePath,
    recommendations
  } = input;
  return [
    "# Contexto del Proyecto",
    "",
    `Proyecto: ${project.name}`,
    `Tipo: ${project.type}`,
    `Namespace: ${project.namespace ?? "n/a"}`,
    "",
    "## Snapshot",
    "",
    `- sourceDir: ${sourceDir}`,
    `- docsDir: ${docsDir}`,
    `- cachePath: ${cachePath}`,
    `- totalFiles: ${summary.totalFiles}`,
    `- jsFiles: ${summary.jsFiles}`,
    `- xmlFiles: ${summary.xmlFiles}`,
    "",
    "## Agentes sugeridos",
    "",
    ...recommendations.slice(0, 6).map((item) => `- ${item.agent.id}: ${item.rationale} (score ${item.score})`),
    "",
    "## Mantenimiento",
    "",
    "- Ejecutar refresh_project_context_docs tras cambios estructurales.",
    "- Mantener validate_project_agents en modo strict antes de guardar packs.",
    ""
  ].join("\n");
}

function renderAgentFlowsDoc(input) {
  const { project, recommendations } = input;
  const highPriority = recommendations.filter((item) => item.priority === "high");
  return [
    "# Flujos de Agentes",
    "",
    `Proyecto: ${project.name}`,
    "",
    "## Flujo base",
    "",
    "1. Descubrimiento y analisis.",
    "2. Plan de cambio minimo.",
    "3. Preview y apply patch.",
    "4. Validaciones de calidad.",
    "5. Cierre y rollback si aplica.",
    "",
    "## Prioridad sugerida",
    "",
    ...highPriority.map((item) => `- ${item.agent.title}: ${item.agent.goal}`),
    ""
  ].join("\n");
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function normalizeExtension(value) {
  const normalized = value.toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function joinPath(...segments) {
  return segments.filter(Boolean).join("/").replaceAll("\\", "/").replace(/\/{2,}/g, "/");
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
