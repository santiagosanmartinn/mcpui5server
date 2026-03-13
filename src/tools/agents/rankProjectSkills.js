import { z } from "zod";
import { fileExists } from "../../utils/fileSystem.js";
import {
  DEFAULT_SKILL_CATALOG_PATH,
  DEFAULT_SKILL_METRICS_PATH,
  SKILL_STATUSES,
  normalizePath,
  readOrCreateSkillCatalog,
  readOrCreateSkillMetrics
} from "../../utils/projectSkills.js";

const inputSchema = z.object({
  catalogPath: z.string().min(1).optional(),
  metricsPath: z.string().min(1).optional(),
  minExecutions: z.number().int().min(0).max(1000).optional(),
  maxResults: z.number().int().min(1).max(200).optional(),
  includeUnscored: z.boolean().optional(),
  includeDeprecated: z.boolean().optional(),
  allowedStatuses: z.array(z.enum(SKILL_STATUSES)).min(1).optional(),
  requiredTags: z.array(z.string().min(1)).max(20).optional()
}).strict();

const rankedSkillSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(SKILL_STATUSES),
  version: z.string(),
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  rankStatus: z.enum(["ranked", "insufficient-data", "no-feedback"]),
  rationale: z.string(),
  metrics: z.object({
    executions: z.number().int().nonnegative(),
    successExecutions: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1),
    failureRate: z.number().min(0).max(1),
    qualityRate: z.number().min(0).max(1),
    usefulnessAverage: z.number().min(0).max(5),
    lastRecordedAt: z.string().nullable()
  }),
  tags: z.array(z.string())
});

const outputSchema = z.object({
  catalogPath: z.string(),
  metricsPath: z.string(),
  exists: z.object({
    catalog: z.boolean(),
    metrics: z.boolean()
  }),
  summary: z.object({
    totalCatalogSkills: z.number().int().nonnegative(),
    returnedSkills: z.number().int().nonnegative(),
    rankedSkills: z.number().int().nonnegative(),
    noFeedbackSkills: z.number().int().nonnegative(),
    minExecutions: z.number().int().nonnegative()
  }),
  rankedSkills: z.array(rankedSkillSchema)
});

export const rankProjectSkillsTool = {
  name: "rank_project_skills",
  description: "Rank project skills using local feedback metrics to prioritize reliable skills in future recommendations.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      catalogPath,
      metricsPath,
      minExecutions,
      maxResults,
      includeUnscored,
      includeDeprecated,
      allowedStatuses,
      requiredTags
    } = inputSchema.parse(args);

    const root = context.rootDir;
    const selectedCatalogPath = normalizePath(catalogPath ?? DEFAULT_SKILL_CATALOG_PATH);
    const selectedMetricsPath = normalizePath(metricsPath ?? DEFAULT_SKILL_METRICS_PATH);
    const selectedMinExecutions = minExecutions ?? 1;
    const selectedMaxResults = maxResults ?? 20;
    const shouldIncludeUnscored = includeUnscored ?? true;
    const shouldIncludeDeprecated = includeDeprecated ?? false;
    const allowedStatusSet = Array.isArray(allowedStatuses) ? new Set(allowedStatuses) : null;
    const requiredTagSet = Array.isArray(requiredTags) ? new Set(requiredTags.map((item) => item.toLowerCase())) : null;

    const hasCatalog = await fileExists(selectedCatalogPath, root);
    const hasMetrics = await fileExists(selectedMetricsPath, root);
    if (!hasCatalog) {
      return outputSchema.parse({
        catalogPath: selectedCatalogPath,
        metricsPath: selectedMetricsPath,
        exists: {
          catalog: false,
          metrics: hasMetrics
        },
        summary: {
          totalCatalogSkills: 0,
          returnedSkills: 0,
          rankedSkills: 0,
          noFeedbackSkills: 0,
          minExecutions: selectedMinExecutions
        },
        rankedSkills: []
      });
    }

    const catalog = await readOrCreateSkillCatalog(selectedCatalogPath, root);
    const metrics = await readOrCreateSkillMetrics(selectedMetricsPath, root);
    const rows = [];
    for (const skill of catalog.skills) {
      if (!shouldIncludeDeprecated && skill.status === "deprecated") {
        continue;
      }
      if (allowedStatusSet && !allowedStatusSet.has(skill.status)) {
        continue;
      }
      if (requiredTagSet) {
        const lowerTags = new Set(skill.tags.map((tag) => tag.toLowerCase()));
        let hasAllTags = true;
        for (const requiredTag of requiredTagSet) {
          if (!lowerTags.has(requiredTag)) {
            hasAllTags = false;
            break;
          }
        }
        if (!hasAllTags) {
          continue;
        }
      }

      const row = createRankedSkillRow(skill, metrics.skills[skill.id], selectedMinExecutions);
      if (!shouldIncludeUnscored && row.rankStatus !== "ranked") {
        continue;
      }
      rows.push(row);
    }

    const rankedSkills = rows
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.id.localeCompare(b.id);
      })
      .slice(0, selectedMaxResults);

    return outputSchema.parse({
      catalogPath: selectedCatalogPath,
      metricsPath: selectedMetricsPath,
      exists: {
        catalog: true,
        metrics: hasMetrics
      },
      summary: {
        totalCatalogSkills: catalog.skills.length,
        returnedSkills: rankedSkills.length,
        rankedSkills: rankedSkills.filter((item) => item.rankStatus === "ranked").length,
        noFeedbackSkills: rankedSkills.filter((item) => item.rankStatus === "no-feedback").length,
        minExecutions: selectedMinExecutions
      },
      rankedSkills
    });
  }
};

function createRankedSkillRow(skill, metrics, minExecutions) {
  if (!metrics || typeof metrics !== "object") {
    return {
      id: skill.id,
      title: skill.title,
      status: skill.status,
      version: skill.version,
      score: 0.5,
      confidence: 0,
      rankStatus: "no-feedback",
      rationale: "Skill has no feedback history yet; neutral candidate.",
      metrics: {
        executions: 0,
        successExecutions: 0,
        successRate: 0,
        failureRate: 0,
        qualityRate: 0.5,
        usefulnessAverage: 0,
        lastRecordedAt: null
      },
      tags: skill.tags
    };
  }

  const executions = asInt(metrics.executions);
  const success = asInt(metrics?.outcomes?.success);
  const partial = asInt(metrics?.outcomes?.partial);
  const failed = asInt(metrics?.outcomes?.failed);
  const qualityPasses = asInt(metrics.qualityGatePasses);
  const qualityFails = asInt(metrics.qualityGateFails);
  const usefulnessCount = asInt(metrics.usefulnessCount);
  const usefulnessAverage = usefulnessCount > 0
    ? metrics.usefulnessTotal / usefulnessCount
    : 0;
  const successRate = executions > 0 ? ((success + (partial * 0.5)) / executions) : 0;
  const failureRate = executions > 0 ? (failed / executions) : 0;
  const qualityChecks = qualityPasses + qualityFails;
  const qualityRate = qualityChecks > 0 ? (qualityPasses / qualityChecks) : 0.5;
  const confidence = clamp(executions / 10, 0, 1);
  const usefulnessNormalized = clamp(usefulnessAverage / 5, 0, 1);
  const score = clamp(
    (successRate * 0.45) +
    (qualityRate * 0.2) +
    (usefulnessNormalized * 0.2) +
    (confidence * 0.15) -
    (failureRate * 0.2),
    0,
    1
  );

  const rankStatus = executions >= minExecutions ? "ranked" : "insufficient-data";
  return {
    id: skill.id,
    title: skill.title,
    status: skill.status,
    version: skill.version,
    score: round(rankStatus === "ranked" ? score : 0.56),
    confidence: round(confidence),
    rankStatus,
    rationale: rankStatus === "ranked"
      ? `score=${round(score)} from success=${round(successRate)}, quality=${round(qualityRate)}, usefulness=${round(usefulnessAverage)}.`
      : "Skill has feedback but not enough executions for confident ranking.",
    metrics: {
      executions,
      successExecutions: success,
      successRate: round(successRate),
      failureRate: round(failureRate),
      qualityRate: round(qualityRate),
      usefulnessAverage: round(usefulnessAverage),
      lastRecordedAt: typeof metrics.lastRecordedAt === "string" ? metrics.lastRecordedAt : null
    },
    tags: skill.tags
  };
}

function asInt(value) {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
