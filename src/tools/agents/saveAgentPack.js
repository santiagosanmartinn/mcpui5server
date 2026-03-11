import crypto from "node:crypto";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readJsonFile, readTextFile } from "../../utils/fileSystem.js";
import { validateProjectAgentsTool } from "./validateProjectAgents.js";

const DEFAULT_BLUEPRINT_PATH = ".codex/mcp/agents/agent.blueprint.json";
const DEFAULT_AGENTS_GUIDE_PATH = ".codex/mcp/agents/AGENTS.generated.md";
const DEFAULT_BOOTSTRAP_PROMPT_PATH = ".codex/mcp/agents/prompts/task-bootstrap.txt";
const DEFAULT_PACK_ROOT_DIR = ".codex/mcp/packs";
const DEFAULT_PACK_CATALOG_PATH = `${DEFAULT_PACK_ROOT_DIR}/catalog.json`;

const inputSchema = z.object({
  packName: z.string().min(1),
  packVersion: z.string().min(1).optional(),
  blueprintPath: z.string().min(1).optional(),
  agentsGuidePath: z.string().min(1).optional(),
  bootstrapPromptPath: z.string().min(1).optional(),
  packRootDir: z.string().min(1).optional(),
  packCatalogPath: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
  allowOverwrite: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional()
}).strict();

const previewSchema = z.object({
  path: z.string(),
  role: z.enum(["pack-blueprint", "pack-guide", "pack-prompt", "pack-manifest", "pack-catalog"]),
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
  pack: z.object({
    name: z.string(),
    slug: z.string(),
    version: z.string(),
    path: z.string(),
    fingerprint: z.string(),
    projectType: z.string()
  }),
  validation: z.object({
    valid: z.boolean(),
    errorCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative()
  }),
  fileSummary: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative()
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

export const saveAgentPackTool = {
  name: "save_agent_pack",
  description: "Save generated agent artifacts into a reusable pack catalog with strict validation and fingerprinting.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      packName,
      packVersion,
      blueprintPath,
      agentsGuidePath,
      bootstrapPromptPath,
      packRootDir,
      packCatalogPath,
      dryRun,
      allowOverwrite,
      reason,
      maxDiffLines
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const selectedBlueprintPath = normalizePath(blueprintPath ?? DEFAULT_BLUEPRINT_PATH);
    const selectedGuidePath = normalizePath(agentsGuidePath ?? DEFAULT_AGENTS_GUIDE_PATH);
    const selectedPromptPath = normalizePath(bootstrapPromptPath ?? DEFAULT_BOOTSTRAP_PROMPT_PATH);
    const selectedPackRoot = normalizePath(packRootDir ?? DEFAULT_PACK_ROOT_DIR);
    const selectedCatalogPath = normalizePath(packCatalogPath ?? DEFAULT_PACK_CATALOG_PATH);
    enforceManagedSubtree(selectedPackRoot, ".codex/mcp", "packRootDir");
    enforceManagedSubtree(selectedCatalogPath, ".codex/mcp", "packCatalogPath");
    const selectedPackVersion = packVersion ?? "1.0.0";
    const shouldDryRun = dryRun ?? true;
    const shouldAllowOverwrite = allowOverwrite ?? false;
    const packSlug = toSlug(packName);
    const packFolderName = `${packSlug}-${selectedPackVersion}`;
    const packPath = joinPath(selectedPackRoot, packFolderName);

    const validationReport = await validateProjectAgentsTool.handler(
      {
        blueprintPath: selectedBlueprintPath,
        agentsGuidePath: selectedGuidePath,
        strict: true
      },
      {
        context
      }
    );

    if (!validationReport.valid) {
      throw new ToolError("Cannot save agent pack because validation failed.", {
        code: "AGENT_PACK_VALIDATION_FAILED",
        details: {
          errors: validationReport.errors
        }
      });
    }

    const blueprintContent = await readTextFile(selectedBlueprintPath, root);
    const guideContent = await readTextFile(selectedGuidePath, root);
    const promptContent = await readTextFile(selectedPromptPath, root);
    const blueprint = JSON.parse(blueprintContent);
    const fingerprint = hashArtifactSet(blueprintContent, guideContent, promptContent);
    const packManifestPath = joinPath(packPath, "pack.json");
    const packBlueprintPath = joinPath(packPath, "blueprint.json");
    const packGuidePath = joinPath(packPath, "AGENTS.generated.md");
    const packPromptPath = joinPath(packPath, "task-bootstrap.txt");

    const packManifest = {
      schemaVersion: "1.0.0",
      name: packName,
      slug: packSlug,
      version: selectedPackVersion,
      fingerprint,
      project: {
        name: blueprint?.project?.name ?? null,
        type: blueprint?.project?.type ?? "generic",
        namespace: blueprint?.project?.namespace ?? null
      },
      files: {
        blueprint: packBlueprintPath,
        agentsGuide: packGuidePath,
        bootstrapPrompt: packPromptPath
      }
    };

    const catalog = await readOrCreateCatalog(selectedCatalogPath, root);
    const existing = catalog.packs.find((item) =>
      item.slug === packSlug && item.version === selectedPackVersion
    );
    if (existing && existing.fingerprint !== fingerprint && !shouldAllowOverwrite) {
      throw new ToolError("Pack with same slug/version already exists with different fingerprint.", {
        code: "AGENT_PACK_EXISTS",
        details: {
          slug: packSlug,
          version: selectedPackVersion
        }
      });
    }

    const nextCatalog = buildNextCatalog(catalog, {
      name: packName,
      slug: packSlug,
      version: selectedPackVersion,
      projectType: packManifest.project.type,
      fingerprint,
      path: packPath,
      lifecycle: normalizeLifecycle(existing?.lifecycle)
    });

    const plannedWrites = [
      {
        path: packBlueprintPath,
        role: "pack-blueprint",
        content: blueprintContent
      },
      {
        path: packGuidePath,
        role: "pack-guide",
        content: guideContent
      },
      {
        path: packPromptPath,
        role: "pack-prompt",
        content: promptContent
      },
      {
        path: packManifestPath,
        role: "pack-manifest",
        content: `${JSON.stringify(packManifest, null, 2)}\n`
      },
      {
        path: selectedCatalogPath,
        role: "pack-catalog",
        content: `${JSON.stringify(nextCatalog, null, 2)}\n`
      }
    ];

    const previews = [];
    for (const write of plannedWrites) {
      const preview = await previewFileWrite(write.path, write.content, {
        root,
        maxDiffLines
      });

      if (!shouldAllowOverwrite && preview.existsBefore && preview.changed && write.role !== "pack-catalog") {
        throw new ToolError(`Refusing to overwrite existing pack artifact without allowOverwrite: ${write.path}`, {
          code: "AGENT_PACK_FILE_EXISTS",
          details: { path: write.path }
        });
      }

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
        reason: reason ?? "save_agent_pack"
      });
    }

    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed,
      pack: {
        name: packName,
        slug: packSlug,
        version: selectedPackVersion,
        path: packPath,
        fingerprint,
        projectType: packManifest.project.type
      },
      validation: {
        valid: validationReport.valid,
        errorCount: validationReport.summary.errorCount,
        warningCount: validationReport.summary.warningCount
      },
      fileSummary: summarizeFiles(previews),
      previews,
      applyResult
    });
  }
};

async function readOrCreateCatalog(catalogPath, root) {
  if (!(await fileExists(catalogPath, root))) {
    return {
      schemaVersion: "1.0.0",
      packs: []
    };
  }

  const catalog = await readJsonFile(catalogPath, root);
  const packs = Array.isArray(catalog?.packs) ? catalog.packs : [];
  return {
    schemaVersion: catalog?.schemaVersion ?? "1.0.0",
    packs
  };
}

function buildNextCatalog(catalog, nextEntry) {
  const filtered = catalog.packs.filter((item) => !(item.slug === nextEntry.slug && item.version === nextEntry.version));
  filtered.push(nextEntry);
  filtered.sort((a, b) => `${a.slug}@${a.version}`.localeCompare(`${b.slug}@${b.version}`));
  return {
    schemaVersion: "1.0.0",
    packs: filtered
  };
}

function normalizeLifecycle(input) {
  const now = new Date().toISOString();
  const base = {
    status: "experimental",
    updatedAt: now,
    reason: "initial-save",
    history: [
      {
        at: now,
        from: null,
        to: "experimental",
        mode: "system",
        reason: "initial-save"
      }
    ]
  };
  if (!input || typeof input !== "object") {
    return base;
  }

  const status = typeof input.status === "string" ? input.status : base.status;
  const updatedAt = typeof input.updatedAt === "string" ? input.updatedAt : base.updatedAt;
  const reason = typeof input.reason === "string" ? input.reason : base.reason;
  const history = Array.isArray(input.history) ? input.history : base.history;
  return {
    ...input,
    status,
    updatedAt,
    reason,
    history
  };
}

function hashArtifactSet(blueprintContent, guideContent, promptContent) {
  return crypto
    .createHash("sha256")
    .update(blueprintContent)
    .update("\n---\n")
    .update(guideContent)
    .update("\n---\n")
    .update(promptContent)
    .digest("hex");
}

function summarizeFiles(previews) {
  const summary = { created: 0, updated: 0, unchanged: 0 };
  for (const item of previews) {
    if (!item.changed) {
      summary.unchanged += 1;
      continue;
    }
    if (item.existsBefore) {
      summary.updated += 1;
    } else {
      summary.created += 1;
    }
  }
  return summary;
}

function toSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
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
