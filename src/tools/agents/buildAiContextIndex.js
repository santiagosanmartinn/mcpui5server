import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readJsonFile, resolveWorkspacePath } from "../../utils/fileSystem.js";

const DEFAULT_SOURCE_DIR = "webapp";
const DEFAULT_BASELINE_PATH = ".codex/mcp/project/legacy-baseline.json";
const DEFAULT_INTAKE_PATH = ".codex/mcp/project/intake.json";
const DEFAULT_POLICY_PATH = ".codex/mcp/policies/agent-policy.json";
const DEFAULT_BLUEPRINT_PATH = ".codex/mcp/agents/agent.blueprint.json";
const DEFAULT_INDEX_PATH = ".codex/mcp/context/context-index.json";
const DEFAULT_INDEX_DOC_PATH = "docs/mcp/context-index.md";
const DEFAULT_EXTENSIONS = [".js", ".ts", ".xml", ".json", ".properties", ".md", ".yaml", ".yml"];
const DEFAULT_MAX_FILES = 2000;
const DEFAULT_CHUNK_CHARS = 1200;
const DEFAULT_MAX_CHUNKS = 1200;
const DEFAULT_MAX_ARTIFACT_BYTES = 2_500_000;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".mcp-backups", ".mcp-cache", "dist", "coverage", ".next"]);

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  baselinePath: z.string().min(1).optional(),
  intakePath: z.string().min(1).optional(),
  indexPath: z.string().min(1).optional(),
  indexDocPath: z.string().min(1).optional(),
  includeExtensions: z.array(z.string().min(2)).optional(),
  maxFiles: z.number().int().min(100).max(20000).optional(),
  chunkChars: z.number().int().min(400).max(4000).optional(),
  maxChunks: z.number().int().min(100).max(20000).optional(),
  maxArtifactBytes: z.number().int().min(250000).max(10000000).optional(),
  dryRun: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional()
}).strict();

const previewSchema = z.object({
  path: z.string(),
  role: z.enum(["context-index-json", "context-index-doc"]),
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
  files: z.object({
    baselinePath: z.string(),
    intakePath: z.string(),
    indexPath: z.string(),
    indexDocPath: z.string()
  }),
  qualityGuards: z.object({
    mandatoryPaths: z.array(z.string()),
    requirePolicyAndIntake: z.boolean(),
    minimumHotspotChunks: z.number().int().nonnegative()
  }),
  summary: z.object({
    indexedFiles: z.number().int().nonnegative(),
    indexedChunks: z.number().int().nonnegative(),
    hotspotChunks: z.number().int().nonnegative(),
    estimatedChars: z.number().int().nonnegative(),
    truncatedByMaxChunks: z.boolean()
  }),
  retrievalProfiles: z.array(
    z.object({
      id: z.string(),
      goal: z.string(),
      mandatoryPaths: z.array(z.string()),
      recommendedChunkLimit: z.number().int().positive(),
      queryHints: z.array(z.string())
    })
  ),
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

const baselineSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  hotspots: z.array(
    z.object({
      path: z.string(),
      score: z.number().min(0).max(1)
    })
  ).optional(),
  qualityRisks: z.array(
    z.object({
      file: z.string(),
      severity: z.enum(["high", "medium", "low"])
    })
  ).optional()
}).passthrough();

export const buildAiContextIndexTool = {
  name: "build_ai_context_index",
  description: "Build a token-efficient, quality-aware context index for legacy projects to minimize redundant prompts.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      baselinePath,
      intakePath,
      indexPath,
      indexDocPath,
      includeExtensions,
      maxFiles,
      chunkChars,
      maxChunks,
      maxArtifactBytes,
      dryRun,
      reason,
      maxDiffLines
    } = inputSchema.parse(args);

    const root = context.rootDir;
    const selectedSourceDir = normalizePath(sourceDir ?? DEFAULT_SOURCE_DIR);
    const selectedBaselinePath = normalizePath(baselinePath ?? DEFAULT_BASELINE_PATH);
    const selectedIntakePath = normalizePath(intakePath ?? DEFAULT_INTAKE_PATH);
    const selectedIndexPath = normalizePath(indexPath ?? DEFAULT_INDEX_PATH);
    const selectedIndexDocPath = normalizePath(indexDocPath ?? DEFAULT_INDEX_DOC_PATH);
    const selectedExtensions = new Set((includeExtensions ?? DEFAULT_EXTENSIONS).map(normalizeExtension));
    const selectedMaxFiles = maxFiles ?? DEFAULT_MAX_FILES;
    const selectedChunkChars = chunkChars ?? DEFAULT_CHUNK_CHARS;
    const selectedMaxChunks = maxChunks ?? DEFAULT_MAX_CHUNKS;
    const selectedMaxArtifactBytes = maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
    const shouldDryRun = dryRun ?? true;

    enforceManagedSubtree(selectedBaselinePath, ".codex/mcp", "baselinePath");
    enforceManagedSubtree(selectedIntakePath, ".codex/mcp", "intakePath");
    enforceManagedSubtree(selectedIndexPath, ".codex/mcp", "indexPath");
    enforceManagedSubtree(selectedIndexDocPath, "docs", "indexDocPath");

    const sourceExists = await fileExists(selectedSourceDir, root);
    const effectiveSourceDir = sourceExists ? selectedSourceDir : ".";
    const baseline = await readBaseline(selectedBaselinePath, root);
    const hotspotScores = toHotspotScoreMap(baseline?.hotspots ?? []);
    const riskMap = toRiskMap(baseline?.qualityRisks ?? []);

    const indexedFiles = await scanFiles({
      root,
      sourceDir: effectiveSourceDir,
      maxFiles: selectedMaxFiles,
      extensions: selectedExtensions
    });

    const mandatoryPaths = await resolveMandatoryPaths(root, selectedIntakePath);
    const { chunks, truncatedByMaxChunks } = buildChunks({
      files: indexedFiles,
      chunkChars: selectedChunkChars,
      maxChunks: selectedMaxChunks,
      hotspotScores,
      riskMap,
      mandatoryPaths
    });

    const estimatedChars = chunks.reduce((acc, chunk) => acc + chunk.charLength, 0);
    const hotspotChunks = chunks.filter((chunk) => chunk.priority >= 0.75).length;

    const retrievalProfiles = buildRetrievalProfiles(mandatoryPaths);
    const indexPayload = {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      sourceDir: effectiveSourceDir,
      chunkChars: selectedChunkChars,
      qualityGuards: {
        mandatoryPaths,
        requirePolicyAndIntake: mandatoryPaths.includes(DEFAULT_POLICY_PATH) && mandatoryPaths.includes(selectedIntakePath),
        minimumHotspotChunks: Math.min(20, hotspotChunks)
      },
      summary: {
        indexedFiles: indexedFiles.length,
        indexedChunks: chunks.length,
        hotspotChunks,
        estimatedChars,
        truncatedByMaxChunks
      },
      retrievalProfiles,
      chunks
    };

    const indexDoc = renderIndexDoc(indexPayload);
    const plannedWrites = [
      {
        path: selectedIndexPath,
        role: "context-index-json",
        content: `${JSON.stringify(indexPayload, null, 2)}\n`
      },
      {
        path: selectedIndexDocPath,
        role: "context-index-doc",
        content: indexDoc
      }
    ];

    const previews = [];
    for (const write of plannedWrites) {
      const preview = await previewFileWrite(write.path, write.content, {
        root,
        maxBytes: selectedMaxArtifactBytes,
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
          maxBytes: selectedMaxArtifactBytes,
          reason: reason ?? "build_ai_context_index"
        }
      );
    }

    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed,
      sourceDir: effectiveSourceDir,
      files: {
        baselinePath: selectedBaselinePath,
        intakePath: selectedIntakePath,
        indexPath: selectedIndexPath,
        indexDocPath: selectedIndexDocPath
      },
      qualityGuards: indexPayload.qualityGuards,
      summary: indexPayload.summary,
      retrievalProfiles,
      previews,
      applyResult
    });
  }
};

async function readBaseline(pathValue, root) {
  if (!(await fileExists(pathValue, root))) {
    return null;
  }
  const json = await readJsonFile(pathValue, root);
  const parsed = baselineSchema.safeParse(json);
  if (!parsed.success) {
    throw new ToolError(`Invalid baseline file schema: ${pathValue}`, {
      code: "INVALID_LEGACY_BASELINE",
      details: {
        path: pathValue,
        issue: parsed.error.issues[0] ?? null
      }
    });
  }
  return parsed.data;
}

function toHotspotScoreMap(hotspots) {
  const map = new Map();
  for (const hotspot of hotspots) {
    map.set(hotspot.path, hotspot.score);
  }
  return map;
}

function toRiskMap(risks) {
  const map = new Map();
  for (const risk of risks) {
    const current = map.get(risk.file) ?? 0;
    const weight = risk.severity === "high" ? 0.35 : risk.severity === "medium" ? 0.18 : 0.08;
    map.set(risk.file, current + weight);
  }
  return map;
}

async function scanFiles(options) {
  const { root, sourceDir, maxFiles, extensions } = options;
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

      const content = await fs.readFile(absolutePath, "utf8");
      const relativePath = path.relative(path.resolve(root), absolutePath).replaceAll("\\", "/");
      files.push({
        path: relativePath,
        extension,
        content,
        bytes: Buffer.byteLength(content, "utf8")
      });
    }
  }
}

async function resolveMandatoryPaths(root, intakePath) {
  const mandatory = [
    intakePath,
    DEFAULT_POLICY_PATH,
    DEFAULT_BLUEPRINT_PATH,
    "webapp/manifest.json",
    "ui5.yaml"
  ];

  const existing = [];
  for (const item of mandatory) {
    if (await fileExists(item, root)) {
      existing.push(item);
    }
  }
  return existing;
}

function buildChunks(input) {
  const { files, chunkChars, maxChunks, hotspotScores, riskMap, mandatoryPaths } = input;
  const chunks = [];
  for (const file of files) {
    const chunksForFile = splitIntoChunks(file.content, chunkChars);
    for (const part of chunksForFile) {
      if (chunks.length >= maxChunks) {
        return {
          chunks: sortChunks(chunks),
          truncatedByMaxChunks: true
        };
      }
      const basePriority = resolveFilePriority(file.path, file.extension);
      const hotspotBoost = hotspotScores.get(file.path) ?? 0;
      const riskBoost = riskMap.get(file.path) ?? 0;
      const mandatoryBoost = mandatoryPaths.includes(file.path) ? 0.35 : 0;
      const priority = clamp(basePriority + hotspotBoost + riskBoost + mandatoryBoost, 0, 1);

      chunks.push({
        id: hashText(`${file.path}#${part.index}#${part.startOffset}#${part.content}`),
        path: file.path,
        extension: file.extension,
        chunkIndex: part.index,
        startOffset: part.startOffset,
        endOffset: part.endOffset,
        charLength: part.content.length,
        priority: round(priority),
        keywords: extractKeywords(part.content, file.extension),
        summary: summarizeChunk(part.content),
        hash: hashText(part.content)
      });
    }
  }

  return {
    chunks: sortChunks(chunks),
    truncatedByMaxChunks: false
  };
}

function splitIntoChunks(content, chunkChars) {
  const chunks = [];
  let cursor = 0;
  let index = 0;
  while (cursor < content.length) {
    const nextCursor = Math.min(content.length, cursor + chunkChars);
    const value = content.slice(cursor, nextCursor);
    chunks.push({
      index,
      startOffset: cursor,
      endOffset: nextCursor,
      content: value
    });
    cursor = nextCursor;
    index += 1;
  }
  if (chunks.length === 0) {
    chunks.push({
      index: 0,
      startOffset: 0,
      endOffset: 0,
      content: ""
    });
  }
  return chunks;
}

function resolveFilePriority(filePath, extension) {
  let score = 0.2;
  if (filePath.includes("/controller/") || filePath.endsWith(".controller.js")) {
    score += 0.18;
  }
  if (filePath.includes("/view/") || extension === ".xml") {
    score += 0.15;
  }
  if (filePath.endsWith("manifest.json") || filePath === "ui5.yaml") {
    score += 0.22;
  }
  if (filePath.includes(".codex/mcp")) {
    score += 0.12;
  }
  if (extension === ".properties") {
    score += 0.1;
  }
  return score;
}

function extractKeywords(content, extension) {
  const regex = extension === ".xml"
    ? /<\/?([A-Za-z][\w:.]+)/g
    : /\b[A-Za-z_][A-Za-z0-9_]{3,}\b/g;
  const counts = new Map();
  let match = regex.exec(content);
  while (match) {
    const token = (match[1] ?? match[0]).toLowerCase();
    if (!STOPWORDS.has(token)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    match = regex.exec(content);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([token]) => token);
}

function summarizeChunk(content) {
  const compact = content
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length <= 180) {
    return compact;
  }
  return `${compact.slice(0, 177)}...`;
}

function sortChunks(chunks) {
  return chunks.sort((a, b) => b.priority - a.priority || a.path.localeCompare(b.path) || a.chunkIndex - b.chunkIndex);
}

function buildRetrievalProfiles(mandatoryPaths) {
  return [
    {
      id: "feature-implementation",
      goal: "Implementar una feature nueva minimizando regresiones en legacy.",
      mandatoryPaths,
      recommendedChunkLimit: 45,
      queryHints: ["routing", "controller", "view", "manifest", "i18n"]
    },
    {
      id: "bugfix-targeted",
      goal: "Corregir bug con contexto minimo pero suficiente para no romper flujos adyacentes.",
      mandatoryPaths,
      recommendedChunkLimit: 28,
      queryHints: ["stacktrace", "error", "hotspot", "regression"]
    },
    {
      id: "security-remediation",
      goal: "Remediar riesgos de seguridad manteniendo compatibilidad funcional.",
      mandatoryPaths,
      recommendedChunkLimit: 36,
      queryHints: ["eval", "innerhtml", "xss", "sanitization", "unsafe"]
    },
    {
      id: "refactor-safe",
      goal: "Refactor incremental respetando alcance y convenciones legacy.",
      mandatoryPaths,
      recommendedChunkLimit: 34,
      queryHints: ["technical-debt", "controller-pattern", "modularization"]
    }
  ];
}

function renderIndexDoc(payload) {
  return [
    "# AI Context Index",
    "",
    `Generated at: ${payload.generatedAt}`,
    `Source dir: ${payload.sourceDir}`,
    "",
    "## Summary",
    "",
    `- Indexed files: ${payload.summary.indexedFiles}`,
    `- Indexed chunks: ${payload.summary.indexedChunks}`,
    `- Hotspot chunks: ${payload.summary.hotspotChunks}`,
    `- Estimated chars: ${payload.summary.estimatedChars}`,
    `- Truncated by max chunks: ${payload.summary.truncatedByMaxChunks}`,
    "",
    "## Quality Guards",
    "",
    `- Mandatory paths: ${payload.qualityGuards.mandatoryPaths.join(", ") || "none"}`,
    `- Require policy and intake: ${payload.qualityGuards.requirePolicyAndIntake}`,
    `- Minimum hotspot chunks: ${payload.qualityGuards.minimumHotspotChunks}`,
    "",
    "## Retrieval Profiles",
    "",
    ...payload.retrievalProfiles.map((profile) => `- ${profile.id}: ${profile.goal} (chunk limit ${profile.recommendedChunkLimit})`),
    "",
    "## Top Chunks",
    "",
    ...payload.chunks.slice(0, 20).map((chunk) => `- ${chunk.path}#${chunk.chunkIndex} (priority ${chunk.priority}) :: ${chunk.summary}`),
    ""
  ].join("\n");
}

function hashText(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function normalizeExtension(value) {
  const normalized = value.toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
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

const STOPWORDS = new Set([
  "this", "that", "with", "from", "return", "function", "const", "let", "var", "null", "true", "false", "undefined", "object", "string", "number", "array", "class", "import", "export", "default", "xmlns", "core", "view", "controller"
]);
