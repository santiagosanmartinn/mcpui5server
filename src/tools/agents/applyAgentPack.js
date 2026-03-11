import crypto from "node:crypto";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { fileExists, readJsonFile, readTextFile } from "../../utils/fileSystem.js";
import { scaffoldProjectAgentsOutputSchema, scaffoldProjectAgentsTool } from "./scaffoldProjectAgents.js";

const DEFAULT_PACK_CATALOG_PATH = ".codex/mcp/packs/catalog.json";

const inputSchema = z.object({
  packSlug: z.string().min(1).optional(),
  packName: z.string().min(1).optional(),
  packVersion: z.string().min(1).optional(),
  packCatalogPath: z.string().min(1).optional(),
  projectName: z.string().min(1).optional(),
  projectType: z.enum(["sapui5", "node", "generic"]).optional(),
  namespace: z.string().min(1).optional(),
  outputDir: z.string().min(1).optional(),
  includeVscodeMcp: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  allowOverwrite: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional()
}).strict().refine((value) => value.packSlug || value.packName, {
  message: "Provide packSlug or packName."
});

const outputSchema = z.object({
  selectedPack: z.object({
    name: z.string(),
    slug: z.string(),
    version: z.string(),
    fingerprint: z.string(),
    path: z.string()
  }),
  integrity: z.object({
    fingerprintMatches: z.boolean()
  }),
  scaffoldResult: scaffoldProjectAgentsOutputSchema
});

const packBlueprintSchema = z.object({
  schemaVersion: z.string(),
  project: z.object({
    name: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    namespace: z.string().nullable().optional()
  }).optional(),
  qualityGates: z.object({
    requiredTools: z.array(z.string().min(1)),
    requiredCommands: z.array(z.string().min(1)),
    minimumReviewAgents: z.number().int().positive()
  }),
  agents: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      goal: z.string().min(1),
      allowedTools: z.array(z.string().min(1)).min(1)
    }).strict()
  ).min(2)
});

export const applyAgentPackTool = {
  name: "apply_agent_pack",
  description: "Apply a saved agent pack to the current project with fingerprint verification and scaffolded materialization.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      packSlug,
      packName,
      packVersion,
      packCatalogPath,
      projectName,
      projectType,
      namespace,
      outputDir,
      includeVscodeMcp,
      dryRun,
      allowOverwrite,
      reason,
      maxDiffLines
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const selectedCatalogPath = normalizePath(packCatalogPath ?? DEFAULT_PACK_CATALOG_PATH);
    enforceManagedSubtree(selectedCatalogPath, ".codex/mcp", "packCatalogPath");
    const catalog = await readCatalog(selectedCatalogPath, root);
    const selectedPack = selectPack(catalog.packs, {
      packSlug,
      packName,
      packVersion
    });
    if (!selectedPack) {
      throw new ToolError("Requested agent pack was not found in catalog.", {
        code: "AGENT_PACK_NOT_FOUND",
        details: {
          packSlug: packSlug ?? null,
          packName: packName ?? null,
          packVersion: packVersion ?? null
        }
      });
    }

    const packManifestPath = joinPath(selectedPack.path, "pack.json");
    const packBlueprintPath = joinPath(selectedPack.path, "blueprint.json");
    const packGuidePath = joinPath(selectedPack.path, "AGENTS.generated.md");
    const packPromptPath = joinPath(selectedPack.path, "task-bootstrap.txt");
    const [manifestText, blueprintText, guideText, promptText] = await Promise.all([
      readTextFile(packManifestPath, root),
      readTextFile(packBlueprintPath, root),
      readTextFile(packGuidePath, root),
      readTextFile(packPromptPath, root)
    ]);
    const packManifest = JSON.parse(manifestText);
    const fingerprintMatches = packManifest.fingerprint === hashArtifactSet(blueprintText, guideText, promptText);
    if (!fingerprintMatches) {
      throw new ToolError("Pack fingerprint mismatch detected. Pack integrity check failed.", {
        code: "AGENT_PACK_FINGERPRINT_MISMATCH",
        details: {
          slug: selectedPack.slug,
          version: selectedPack.version
        }
      });
    }

    const blueprint = packBlueprintSchema.parse(JSON.parse(blueprintText));
    const scaffoldResult = await scaffoldProjectAgentsTool.handler(
      {
        projectName,
        projectType: projectType ?? normalizeProjectType(blueprint.project?.type),
        namespace,
        outputDir,
        includeVscodeMcp,
        dryRun,
        allowOverwrite,
        reason: reason ?? `apply_agent_pack:${selectedPack.slug}@${selectedPack.version}`,
        maxDiffLines,
        agentDefinitions: blueprint.agents,
        qualityGates: blueprint.qualityGates,
        recommendationMeta: {
          source: `pack:${selectedPack.slug}@${selectedPack.version}`,
          selectedRecommendationIds: [`pack-${selectedPack.slug}`]
        }
      },
      {
        context
      }
    );

    return outputSchema.parse({
      selectedPack: {
        name: selectedPack.name ?? packManifest.name ?? "Unnamed pack",
        slug: selectedPack.slug ?? packManifest.slug ?? "unknown-pack",
        version: selectedPack.version ?? packManifest.version ?? "1.0.0",
        fingerprint: selectedPack.fingerprint ?? packManifest.fingerprint ?? "",
        path: selectedPack.path
      },
      integrity: {
        fingerprintMatches
      },
      scaffoldResult
    });
  }
};

async function readCatalog(catalogPath, root) {
  if (!(await fileExists(catalogPath, root))) {
    throw new ToolError("Agent pack catalog does not exist.", {
      code: "AGENT_PACK_CATALOG_NOT_FOUND",
      details: { catalogPath }
    });
  }

  const catalog = await readJsonFile(catalogPath, root);
  return {
    schemaVersion: catalog?.schemaVersion ?? "1.0.0",
    packs: Array.isArray(catalog?.packs) ? catalog.packs : []
  };
}

function selectPack(packs, input) {
  const { packSlug, packName, packVersion } = input;
  const matching = packs.filter((pack) => {
    if (packSlug && pack.slug !== packSlug) {
      return false;
    }
    if (packName && pack.name !== packName) {
      return false;
    }
    return true;
  });
  if (matching.length === 0) {
    return null;
  }
  if (packVersion) {
    return matching.find((pack) => pack.version === packVersion) ?? null;
  }

  return matching
    .slice()
    .sort((a, b) => `${b.version}`.localeCompare(`${a.version}`))[0];
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

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function joinPath(...segments) {
  return segments.filter(Boolean).join("/").replaceAll("\\", "/").replace(/\/{2,}/g, "/");
}

function normalizeProjectType(value) {
  return value === "sapui5" || value === "node" || value === "generic" ? value : undefined;
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
