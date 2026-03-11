import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { fileExists, readJsonFile } from "../../utils/fileSystem.js";
import { DEFAULT_AGENT_POLICY_PATH, loadAgentPolicy, normalizePackSlugSet } from "../../utils/agentPolicy.js";

const PROJECT_TYPES = ["sapui5", "node", "generic"];
const DEFAULT_PACK_CATALOG_PATH = ".codex/mcp/packs/catalog.json";
const DEFAULT_METRICS_PATH = ".codex/mcp/feedback/metrics.json";

const inputSchema = z.object({
  packCatalogPath: z.string().min(1).optional(),
  metricsPath: z.string().min(1).optional(),
  policyPath: z.string().min(1).optional(),
  respectPolicy: z.boolean().optional(),
  projectType: z.enum(PROJECT_TYPES).optional(),
  minExecutions: z.number().int().min(0).max(1000).optional(),
  maxResults: z.number().int().min(1).max(200).optional(),
  includeUnscored: z.boolean().optional(),
  includeDeprecated: z.boolean().optional()
}).strict();

const rankedPackSchema = z.object({
  name: z.string(),
  slug: z.string(),
  version: z.string(),
  projectType: z.string(),
  fingerprint: z.string(),
  path: z.string(),
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  status: z.enum(["ranked", "insufficient-data", "no-feedback"]),
  lifecycleStatus: z.enum(["experimental", "candidate", "recommended", "deprecated"]),
  lifecycleUpdatedAt: z.string().nullable(),
  rationale: z.string(),
  metrics: z.object({
    executions: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1),
    failureRate: z.number().min(0).max(1),
    qualityRate: z.number().min(0).max(1),
    manualEditsAvg: z.number().min(0),
    issuesIntroducedAvg: z.number().min(0),
    lastRecordedAt: z.string().nullable()
  })
});

const outputSchema = z.object({
  packCatalogPath: z.string(),
  metricsPath: z.string(),
  policy: z.object({
    path: z.string(),
    loaded: z.boolean(),
    enforced: z.boolean(),
    section: z.string().nullable()
  }),
  exists: z.object({
    catalog: z.boolean(),
    metrics: z.boolean()
  }),
  projectType: z.enum(PROJECT_TYPES).nullable(),
  summary: z.object({
    totalCatalogPacks: z.number().int().nonnegative(),
    returnedPacks: z.number().int().nonnegative(),
    rankedPacks: z.number().int().nonnegative(),
    noFeedbackPacks: z.number().int().nonnegative(),
    minExecutions: z.number().int().nonnegative()
  }),
  rankedPacks: z.array(rankedPackSchema)
});

export const rankAgentPacksTool = {
  name: "rank_agent_packs",
  description: "Rank saved agent packs using execution feedback metrics to prioritize recommendations for the current context.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      packCatalogPath,
      metricsPath,
      policyPath,
      respectPolicy,
      projectType,
      minExecutions,
      maxResults,
      includeUnscored,
      includeDeprecated
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const selectedCatalogPath = normalizePath(packCatalogPath ?? DEFAULT_PACK_CATALOG_PATH);
    const selectedMetricsPath = normalizePath(metricsPath ?? DEFAULT_METRICS_PATH);
    const selectedPolicyPath = normalizePath(policyPath ?? DEFAULT_AGENT_POLICY_PATH);
    const shouldRespectPolicy = respectPolicy ?? true;

    const policyResolution = shouldRespectPolicy
      ? await loadAgentPolicy({ root, policyPath: selectedPolicyPath })
      : {
        path: selectedPolicyPath,
        loaded: false,
        enabled: false,
        policy: null
      };
    const rankingPolicy = policyResolution.loaded
      && policyResolution.enabled
      && (policyResolution.policy?.ranking?.enabled ?? true)
      ? (policyResolution.policy?.ranking ?? {})
      : null;

    const selectedMinExecutions = rankingPolicy?.minExecutions ?? minExecutions ?? 1;
    const selectedMaxResults = rankingPolicy?.maxResults ?? maxResults ?? 20;
    const shouldIncludeUnscored = rankingPolicy?.includeUnscored ?? includeUnscored ?? true;
    const shouldIncludeDeprecated = rankingPolicy?.includeDeprecated ?? includeDeprecated ?? true;
    const allowedLifecycleStatuses = Array.isArray(rankingPolicy?.allowedLifecycle)
      ? rankingPolicy.allowedLifecycle
      : null;
    const blockedPackSlugs = normalizePackSlugSet(rankingPolicy?.blockedPackSlugs);

    enforceManagedSubtree(selectedCatalogPath, ".codex/mcp", "packCatalogPath");
    enforceManagedSubtree(selectedMetricsPath, ".codex/mcp", "metricsPath");

    const hasCatalog = await fileExists(selectedCatalogPath, root);
    const hasMetrics = await fileExists(selectedMetricsPath, root);
    if (!hasCatalog) {
      return outputSchema.parse({
        packCatalogPath: selectedCatalogPath,
        metricsPath: selectedMetricsPath,
        policy: {
          path: policyResolution.path,
          loaded: policyResolution.loaded,
          enforced: Boolean(rankingPolicy),
          section: rankingPolicy ? "ranking" : null
        },
        exists: {
          catalog: false,
          metrics: hasMetrics
        },
        projectType: projectType ?? null,
        summary: {
          totalCatalogPacks: 0,
          returnedPacks: 0,
          rankedPacks: 0,
          noFeedbackPacks: 0,
          minExecutions: selectedMinExecutions
        },
        rankedPacks: []
      });
    }

    const catalog = await readJsonFile(selectedCatalogPath, root);
    const catalogPacks = Array.isArray(catalog?.packs) ? catalog.packs : [];
    let metrics = null;
    if (hasMetrics) {
      try {
        metrics = await readJsonFile(selectedMetricsPath, root);
      } catch {
        metrics = null;
      }
    }

    const ranked = rankPackEntries({
      packs: catalogPacks,
      metrics,
      projectType: projectType ?? null,
      minExecutions: selectedMinExecutions,
      includeUnscored: shouldIncludeUnscored,
      includeDeprecated: shouldIncludeDeprecated,
      allowedLifecycleStatuses,
      blockedPackSlugs
    })
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return `${a.slug}@${a.version}`.localeCompare(`${b.slug}@${b.version}`);
      })
      .slice(0, selectedMaxResults);

    return outputSchema.parse({
      packCatalogPath: selectedCatalogPath,
      metricsPath: selectedMetricsPath,
      policy: {
        path: policyResolution.path,
        loaded: policyResolution.loaded,
        enforced: Boolean(rankingPolicy),
        section: rankingPolicy ? "ranking" : null
      },
      exists: {
        catalog: true,
        metrics: hasMetrics
      },
      projectType: projectType ?? null,
      summary: {
        totalCatalogPacks: catalogPacks.length,
        returnedPacks: ranked.length,
        rankedPacks: ranked.filter((item) => item.status === "ranked").length,
        noFeedbackPacks: ranked.filter((item) => item.status === "no-feedback").length,
        minExecutions: selectedMinExecutions
      },
      rankedPacks: ranked
    });
  }
};

export function rankPackEntries(input) {
  const {
    packs,
    metrics,
    projectType,
    minExecutions,
    includeUnscored,
    includeDeprecated,
    allowedLifecycleStatuses,
    blockedPackSlugs
  } = input;
  const feedbackByPack = ensureObject(metrics?.packs);
  const allowedLifecycleSet = Array.isArray(allowedLifecycleStatuses)
    ? new Set(allowedLifecycleStatuses)
    : null;
  const blockedSlugSet = blockedPackSlugs instanceof Set
    ? blockedPackSlugs
    : normalizePackSlugSet(blockedPackSlugs);
  const rows = [];

  for (const pack of packs) {
    if (projectType && pack.projectType && pack.projectType !== projectType) {
      continue;
    }
    const normalizedSlug = String(pack.slug ?? "").trim().toLowerCase();
    if (blockedSlugSet.has(normalizedSlug)) {
      continue;
    }
    const lifecycleStatus = normalizeLifecycleStatus(pack?.lifecycle?.status);
    if (allowedLifecycleSet && !allowedLifecycleSet.has(lifecycleStatus)) {
      continue;
    }
    if (lifecycleStatus === "deprecated" && !includeDeprecated) {
      continue;
    }

    const packKey = `${pack.slug ?? ""}@${pack.version ?? "1.0.0"}`;
    const feedback = feedbackByPack[packKey];
    if (!feedback || typeof feedback !== "object") {
      if (!includeUnscored) {
        continue;
      }
      rows.push(createUnscoredPack(pack));
      continue;
    }

    const executions = asInt(feedback.executions);
    if (executions < minExecutions) {
      if (!includeUnscored) {
        continue;
      }
      rows.push(createInsufficientDataPack(pack, feedback));
      continue;
    }

    rows.push(createRankedPack(pack, feedback, projectType));
  }

  return rows;
}

function createRankedPack(pack, feedback, projectType) {
  const executions = asInt(feedback.executions);
  const success = asInt(feedback?.outcomes?.success);
  const partial = asInt(feedback?.outcomes?.partial);
  const failed = asInt(feedback?.outcomes?.failed);
  const qualityPasses = asInt(feedback.qualityGatePasses);
  const qualityFails = asInt(feedback.qualityGateFails);
  const manualEditsTotal = asInt(feedback.manualEditsNeededTotal);
  const issuesTotal = asInt(feedback.issuesIntroducedTotal);

  const successRate = executions > 0 ? ((success + (partial * 0.5)) / executions) : 0;
  const failureRate = executions > 0 ? (failed / executions) : 0;
  const qualityChecks = qualityPasses + qualityFails;
  const qualityRate = qualityChecks > 0 ? (qualityPasses / qualityChecks) : 0.5;
  const manualEditsAvg = executions > 0 ? (manualEditsTotal / executions) : 0;
  const issuesIntroducedAvg = executions > 0 ? (issuesTotal / executions) : 0;
  const projectTypeFit = resolveProjectTypeFit(feedback, projectType);
  const confidence = clamp(executions / 10, 0, 1);
  const stabilityPenalty = clamp((manualEditsAvg * 0.08) + (issuesIntroducedAvg * 0.12), 0, 0.35);
  const score = clamp(
    (successRate * 0.45) +
    (qualityRate * 0.2) +
    (projectTypeFit * 0.15) +
    (confidence * 0.2) -
    (failureRate * 0.15) -
    stabilityPenalty,
    0,
    1
  );

  return {
    name: pack.name ?? "Unnamed pack",
    slug: pack.slug ?? "",
    version: pack.version ?? "1.0.0",
    projectType: pack.projectType ?? "generic",
    fingerprint: pack.fingerprint ?? "",
    path: pack.path ?? "",
    score: round(score),
    confidence: round(confidence),
    status: "ranked",
    lifecycleStatus: normalizeLifecycleStatus(pack?.lifecycle?.status),
    lifecycleUpdatedAt: typeof pack?.lifecycle?.updatedAt === "string" ? pack.lifecycle.updatedAt : null,
    rationale: `score=${round(score)} from success=${round(successRate)}, quality=${round(qualityRate)}, confidence=${round(confidence)}.`,
    metrics: {
      executions,
      successRate: round(successRate),
      failureRate: round(failureRate),
      qualityRate: round(qualityRate),
      manualEditsAvg: round(manualEditsAvg),
      issuesIntroducedAvg: round(issuesIntroducedAvg),
      lastRecordedAt: typeof feedback.lastRecordedAt === "string" ? feedback.lastRecordedAt : null
    }
  };
}

function createInsufficientDataPack(pack, feedback) {
  return {
    name: pack.name ?? "Unnamed pack",
    slug: pack.slug ?? "",
    version: pack.version ?? "1.0.0",
    projectType: pack.projectType ?? "generic",
    fingerprint: pack.fingerprint ?? "",
    path: pack.path ?? "",
    score: 0.56,
    confidence: clamp(asInt(feedback.executions) / 10, 0, 1),
    status: "insufficient-data",
    lifecycleStatus: normalizeLifecycleStatus(pack?.lifecycle?.status),
    lifecycleUpdatedAt: typeof pack?.lifecycle?.updatedAt === "string" ? pack.lifecycle.updatedAt : null,
    rationale: "Pack has feedback data but not enough executions to be ranked with confidence.",
    metrics: {
      executions: asInt(feedback.executions),
      successRate: 0,
      failureRate: 0,
      qualityRate: 0.5,
      manualEditsAvg: 0,
      issuesIntroducedAvg: 0,
      lastRecordedAt: typeof feedback.lastRecordedAt === "string" ? feedback.lastRecordedAt : null
    }
  };
}

function createUnscoredPack(pack) {
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
    rationale: "Pack has no feedback history yet; keep as neutral candidate.",
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

function resolveProjectTypeFit(feedback, projectType) {
  if (!projectType) {
    return 0.6;
  }
  const projectTypes = ensureObject(feedback.projectTypes);
  const matched = asInt(projectTypes[projectType]);
  const total = Object.values(projectTypes).reduce((acc, value) => acc + asInt(value), 0);
  if (total === 0) {
    return 0.5;
  }
  return clamp(matched / total, 0, 1);
}

function asInt(value) {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
