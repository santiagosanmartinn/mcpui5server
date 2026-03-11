import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readJsonFile } from "../../utils/fileSystem.js";
import { rankPackEntries } from "./rankAgentPacks.js";

const PACK_STATUSES = ["experimental", "candidate", "recommended", "deprecated"];
const DEFAULT_PACK_CATALOG_PATH = ".codex/mcp/packs/catalog.json";
const DEFAULT_METRICS_PATH = ".codex/mcp/feedback/metrics.json";

const inputSchema = z.object({
  packSlug: z.string().min(1).optional(),
  packName: z.string().min(1).optional(),
  packVersion: z.string().min(1).optional(),
  packCatalogPath: z.string().min(1).optional(),
  metricsPath: z.string().min(1).optional(),
  mode: z.enum(["auto", "manual"]).optional(),
  targetStatus: z.enum(PACK_STATUSES).optional(),
  minExecutionsForRecommended: z.number().int().min(1).max(1000).optional(),
  recommendedScoreThreshold: z.number().min(0).max(1).optional(),
  candidateScoreThreshold: z.number().min(0).max(1).optional(),
  deprecationScoreThreshold: z.number().min(0).max(1).optional(),
  deprecationFailureRateThreshold: z.number().min(0).max(1).optional(),
  dryRun: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional()
}).strict().superRefine((value, ctx) => {
  if (!value.packSlug && !value.packName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide packSlug or packName.",
      path: ["packSlug"]
    });
  }
  const mode = value.mode ?? (value.targetStatus ? "manual" : "auto");
  if (mode === "manual" && !value.targetStatus) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "targetStatus is required in manual mode.",
      path: ["targetStatus"]
    });
  }
});

const outputSchema = z.object({
  dryRun: z.boolean(),
  changed: z.boolean(),
  mode: z.enum(["auto", "manual"]),
  selectedPack: z.object({
    name: z.string(),
    slug: z.string(),
    version: z.string(),
    previousStatus: z.enum(PACK_STATUSES),
    nextStatus: z.enum(PACK_STATUSES)
  }),
  decision: z.object({
    reason: z.string(),
    rankingStatus: z.enum(["ranked", "insufficient-data", "no-feedback"]),
    score: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    executions: z.number().int().nonnegative(),
    failureRate: z.number().min(0).max(1),
    qualityRate: z.number().min(0).max(1)
  }),
  lifecycle: z.object({
    status: z.enum(PACK_STATUSES),
    updatedAt: z.string(),
    reason: z.string(),
    historyLength: z.number().int().nonnegative()
  }),
  preview: z.object({
    path: z.string(),
    existsBefore: z.boolean(),
    changed: z.boolean(),
    oldHash: z.string().nullable(),
    newHash: z.string(),
    diffPreview: z.string(),
    diffTruncated: z.boolean()
  }),
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

export const promoteAgentPackTool = {
  name: "promote_agent_pack",
  description: "Promote/degrade pack lifecycle status (experimental/candidate/recommended/deprecated) using automatic rules over feedback metrics or manual override.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      packSlug,
      packName,
      packVersion,
      packCatalogPath,
      metricsPath,
      mode,
      targetStatus,
      minExecutionsForRecommended,
      recommendedScoreThreshold,
      candidateScoreThreshold,
      deprecationScoreThreshold,
      deprecationFailureRateThreshold,
      dryRun,
      reason,
      maxDiffLines
    } = inputSchema.parse(args);

    const root = context.rootDir;
    const selectedCatalogPath = normalizePath(packCatalogPath ?? DEFAULT_PACK_CATALOG_PATH);
    const selectedMetricsPath = normalizePath(metricsPath ?? DEFAULT_METRICS_PATH);
    const selectedMode = mode ?? (targetStatus ? "manual" : "auto");
    const shouldDryRun = dryRun ?? true;

    const rules = {
      minExecutionsForRecommended: minExecutionsForRecommended ?? 5,
      recommendedScoreThreshold: recommendedScoreThreshold ?? 0.75,
      candidateScoreThreshold: candidateScoreThreshold ?? 0.55,
      deprecationScoreThreshold: deprecationScoreThreshold ?? 0.4,
      deprecationFailureRateThreshold: deprecationFailureRateThreshold ?? 0.45
    };

    enforceManagedSubtree(selectedCatalogPath, ".codex/mcp", "packCatalogPath");
    enforceManagedSubtree(selectedMetricsPath, ".codex/mcp", "metricsPath");
    if (!(await fileExists(selectedCatalogPath, root))) {
      throw new ToolError("Agent pack catalog does not exist.", {
        code: "AGENT_PACK_CATALOG_NOT_FOUND",
        details: { packCatalogPath: selectedCatalogPath }
      });
    }

    const catalog = await readCatalog(selectedCatalogPath, root);
    const selected = selectPack(catalog.packs, {
      packSlug,
      packName,
      packVersion
    });
    if (!selected) {
      throw new ToolError("Requested pack was not found in catalog.", {
        code: "AGENT_PACK_NOT_FOUND",
        details: {
          packSlug: packSlug ?? null,
          packName: packName ?? null,
          packVersion: packVersion ?? null
        }
      });
    }

    const metrics = await readOptionalJson(selectedMetricsPath, root);
    const ranking = rankPackEntries({
      packs: [selected],
      metrics,
      projectType: selected.projectType ?? null,
      minExecutions: 1,
      includeUnscored: true,
      includeDeprecated: true
    })[0] ?? createFallbackRanking(selected);

    const previousStatus = normalizeLifecycleStatus(selected?.lifecycle?.status);
    const autoDecision = decideStatusFromRules(previousStatus, ranking, rules);
    const nextStatus = selectedMode === "manual" ? targetStatus : autoDecision.status;
    const decisionReason = selectedMode === "manual"
      ? (reason ?? `manual-set:${previousStatus}->${nextStatus}`)
      : autoDecision.reason;

    const now = new Date().toISOString();
    const nextLifecycle = updateLifecycle({
      current: selected.lifecycle,
      previousStatus,
      nextStatus,
      at: now,
      mode: selectedMode,
      reason: decisionReason,
      ranking
    });

    const nextPacks = catalog.packs.map((pack) => {
      if (pack.slug === selected.slug && pack.version === selected.version) {
        return {
          ...pack,
          lifecycle: nextLifecycle
        };
      }
      return pack;
    });
    const nextCatalog = {
      schemaVersion: catalog.schemaVersion,
      packs: nextPacks
    };

    const catalogContent = `${JSON.stringify(nextCatalog, null, 2)}\n`;
    const preview = await previewFileWrite(selectedCatalogPath, catalogContent, {
      root,
      maxDiffLines
    });
    const changed = preview.changed;

    let applyResult = null;
    if (!shouldDryRun && preview.changed) {
      applyResult = await applyProjectPatch([
        {
          path: selectedCatalogPath,
          content: catalogContent,
          expectedOldHash: preview.oldHash ?? undefined
        }
      ], {
        root,
        reason: reason ?? "promote_agent_pack"
      });
    }

    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed,
      mode: selectedMode,
      selectedPack: {
        name: selected.name ?? "Unnamed pack",
        slug: selected.slug ?? "",
        version: selected.version ?? "1.0.0",
        previousStatus,
        nextStatus
      },
      decision: {
        reason: decisionReason,
        rankingStatus: ranking.status,
        score: ranking.score,
        confidence: ranking.confidence,
        executions: ranking.metrics.executions,
        failureRate: ranking.metrics.failureRate,
        qualityRate: ranking.metrics.qualityRate
      },
      lifecycle: {
        status: nextLifecycle.status,
        updatedAt: nextLifecycle.updatedAt,
        reason: nextLifecycle.reason,
        historyLength: Array.isArray(nextLifecycle.history) ? nextLifecycle.history.length : 0
      },
      preview: {
        path: preview.path,
        existsBefore: preview.existsBefore,
        changed: preview.changed,
        oldHash: preview.oldHash,
        newHash: preview.newHash,
        diffPreview: preview.diffPreview,
        diffTruncated: preview.diffTruncated
      },
      applyResult
    });
  }
};

function decideStatusFromRules(previousStatus, ranking, rules) {
  const executions = ranking.metrics.executions;
  const failureRate = ranking.metrics.failureRate;
  const qualityRate = ranking.metrics.qualityRate;
  const score = ranking.score;

  if (ranking.status === "no-feedback") {
    return {
      status: "experimental",
      reason: "auto:no-feedback->experimental"
    };
  }

  if (ranking.status === "insufficient-data") {
    return {
      status: executions > 0 ? "candidate" : "experimental",
      reason: executions > 0
        ? "auto:insufficient-data->candidate"
        : "auto:insufficient-data->experimental"
    };
  }

  if (failureRate >= rules.deprecationFailureRateThreshold || score < rules.deprecationScoreThreshold) {
    return {
      status: "deprecated",
      reason: `auto:deprecate failureRate=${failureRate} score=${score}`
    };
  }

  if (
    score >= rules.recommendedScoreThreshold &&
    executions >= rules.minExecutionsForRecommended &&
    qualityRate >= 0.7
  ) {
    return {
      status: "recommended",
      reason: `auto:promote-recommended score=${score} executions=${executions} qualityRate=${qualityRate}`
    };
  }

  if (score >= rules.candidateScoreThreshold) {
    return {
      status: "candidate",
      reason: `auto:promote-candidate score=${score}`
    };
  }

  if (previousStatus === "recommended") {
    return {
      status: "candidate",
      reason: `auto:downgrade-recommended score=${score}`
    };
  }

  return {
    status: "experimental",
    reason: `auto:default-experimental score=${score}`
  };
}

function updateLifecycle(input) {
  const { current, previousStatus, nextStatus, at, mode, reason, ranking } = input;
  const safeCurrent = current && typeof current === "object" ? current : {};
  const history = Array.isArray(safeCurrent.history) ? safeCurrent.history.slice() : [];
  if (previousStatus !== nextStatus) {
    history.push({
      at,
      from: previousStatus,
      to: nextStatus,
      mode,
      reason,
      score: ranking.score,
      confidence: ranking.confidence,
      rankingStatus: ranking.status
    });
  }

  const trimmedHistory = history.slice(-100);
  return {
    ...safeCurrent,
    status: nextStatus,
    updatedAt: at,
    reason,
    score: ranking.score,
    confidence: ranking.confidence,
    rankingStatus: ranking.status,
    history: trimmedHistory
  };
}

function createFallbackRanking(pack) {
  return {
    name: pack.name ?? "Unnamed pack",
    slug: pack.slug ?? "",
    version: pack.version ?? "1.0.0",
    projectType: pack.projectType ?? "generic",
    fingerprint: pack.fingerprint ?? "",
    path: pack.path ?? "",
    score: 0.5,
    confidence: 0,
    status: "no-feedback",
    lifecycleStatus: normalizeLifecycleStatus(pack?.lifecycle?.status),
    lifecycleUpdatedAt: typeof pack?.lifecycle?.updatedAt === "string" ? pack.lifecycle.updatedAt : null,
    rationale: "No ranking data available.",
    metrics: {
      executions: 0,
      successRate: 0,
      failureRate: 0,
      qualityRate: 0.5,
      manualEditsAvg: 0,
      issuesIntroducedAvg: 0,
      lastRecordedAt: null
    }
  };
}

async function readCatalog(catalogPath, root) {
  const parsed = await readJsonFile(catalogPath, root);
  return {
    schemaVersion: parsed?.schemaVersion ?? "1.0.0",
    packs: Array.isArray(parsed?.packs) ? parsed.packs : []
  };
}

async function readOptionalJson(filePath, root) {
  if (!(await fileExists(filePath, root))) {
    return null;
  }
  try {
    return await readJsonFile(filePath, root);
  } catch {
    return null;
  }
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
  return matching.slice().sort((a, b) => `${b.version}`.localeCompare(`${a.version}`))[0];
}

function normalizeLifecycleStatus(value) {
  return value === "candidate" || value === "recommended" || value === "deprecated"
    ? value
    : "experimental";
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
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
