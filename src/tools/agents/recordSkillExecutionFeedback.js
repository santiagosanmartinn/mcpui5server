import crypto from "node:crypto";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readTextFile } from "../../utils/fileSystem.js";
import {
  DEFAULT_SKILL_CATALOG_PATH,
  DEFAULT_SKILL_FEEDBACK_PATH,
  DEFAULT_SKILL_METRICS_PATH,
  SKILL_OUTCOMES,
  enforceManagedSubtree,
  normalizePath,
  readOrCreateSkillCatalog,
  readOrCreateSkillMetrics,
  skillMetricsSchema,
  unique
} from "../../utils/projectSkills.js";

const inputSchema = z.object({
  skillId: z.string().min(2).max(80),
  outcome: z.enum(SKILL_OUTCOMES),
  qualityGatePass: z.boolean().optional(),
  usefulnessScore: z.number().int().min(1).max(5).optional(),
  timeSavedMinutes: z.number().int().min(0).optional(),
  tokenDeltaEstimate: z.number().int().optional(),
  whatWorked: z.string().max(2000).optional(),
  whatFailed: z.string().max(2000).optional(),
  rootCause: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
  catalogPath: z.string().min(1).optional(),
  feedbackPath: z.string().min(1).optional(),
  metricsPath: z.string().min(1).optional(),
  recordedAt: z.string().datetime().optional(),
  dryRun: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional()
}).strict();

const previewSchema = z.object({
  path: z.string(),
  role: z.enum(["skill-feedback-log", "skill-feedback-metrics"]),
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
  record: z.object({
    id: z.string(),
    skillId: z.string(),
    recordedAt: z.string(),
    outcome: z.enum(SKILL_OUTCOMES)
  }),
  files: z.object({
    feedbackPath: z.string(),
    metricsPath: z.string()
  }),
  metrics: z.object({
    totalExecutions: z.number().int().nonnegative(),
    totals: z.object({
      success: z.number().int().nonnegative(),
      partial: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative()
    }),
    skill: z.object({
      executions: z.number().int().nonnegative(),
      outcomes: z.object({
        success: z.number().int().nonnegative(),
        partial: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative()
      }),
      qualityGatePasses: z.number().int().nonnegative(),
      qualityGateFails: z.number().int().nonnegative(),
      usefulnessAverage: z.number().min(0).max(5),
      timeSavedMinutesTotal: z.number().int().nonnegative(),
      tokenDeltaEstimateTotal: z.number().int()
    })
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

export const recordSkillExecutionFeedbackTool = {
  name: "record_skill_execution_feedback",
  description: "Record structured execution feedback for project skills and update aggregate metrics for future ranking.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      skillId,
      outcome,
      qualityGatePass,
      usefulnessScore,
      timeSavedMinutes,
      tokenDeltaEstimate,
      whatWorked,
      whatFailed,
      rootCause,
      tags,
      catalogPath,
      feedbackPath,
      metricsPath,
      recordedAt,
      dryRun,
      reason,
      maxDiffLines
    } = inputSchema.parse(args);

    const root = context.rootDir;
    const selectedCatalogPath = normalizePath(catalogPath ?? DEFAULT_SKILL_CATALOG_PATH);
    const selectedFeedbackPath = normalizePath(feedbackPath ?? DEFAULT_SKILL_FEEDBACK_PATH);
    const selectedMetricsPath = normalizePath(metricsPath ?? DEFAULT_SKILL_METRICS_PATH);
    const safeSkillId = skillId.trim().toLowerCase();
    const shouldDryRun = dryRun ?? true;
    const safeRecordedAt = recordedAt ?? new Date().toISOString();

    enforceManagedSubtree(selectedCatalogPath, ".codex/mcp", "catalogPath");
    enforceManagedSubtree(selectedFeedbackPath, ".codex/mcp", "feedbackPath");
    enforceManagedSubtree(selectedMetricsPath, ".codex/mcp", "metricsPath");

    const catalog = await readOrCreateSkillCatalog(selectedCatalogPath, root);
    const skill = catalog.skills.find((item) => item.id === safeSkillId);
    if (!skill) {
      throw new ToolError("Skill not found in catalog. Register skill before recording feedback.", {
        code: "PROJECT_SKILL_NOT_FOUND",
        details: {
          skillId: safeSkillId
        }
      });
    }

    const feedbackRecord = {
      schemaVersion: "1.0.0",
      id: createRecordId(safeSkillId, safeRecordedAt),
      skillId: safeSkillId,
      outcome,
      qualityGatePass: qualityGatePass ?? null,
      usefulnessScore: usefulnessScore ?? null,
      timeSavedMinutes: timeSavedMinutes ?? 0,
      tokenDeltaEstimate: tokenDeltaEstimate ?? 0,
      whatWorked: whatWorked ?? null,
      whatFailed: whatFailed ?? null,
      rootCause: rootCause ?? null,
      tags: unique((tags ?? []).map((tag) => tag.trim()).filter(Boolean)),
      recordedAt: safeRecordedAt
    };

    const currentFeedback = await readOptionalText(selectedFeedbackPath, root);
    const nextFeedback = appendJsonLine(currentFeedback, feedbackRecord);
    const currentMetrics = await readOrCreateSkillMetrics(selectedMetricsPath, root);
    const nextMetrics = updateSkillMetrics(currentMetrics, feedbackRecord);
    const metricsContent = `${JSON.stringify(skillMetricsSchema.parse(nextMetrics), null, 2)}\n`;

    const writes = [
      {
        path: selectedFeedbackPath,
        role: "skill-feedback-log",
        content: nextFeedback
      },
      {
        path: selectedMetricsPath,
        role: "skill-feedback-metrics",
        content: metricsContent
      }
    ];

    const previews = [];
    for (const write of writes) {
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

    const changed = previews.some((preview) => preview.changed);
    let applyResult = null;
    if (!shouldDryRun && changed) {
      applyResult = await applyProjectPatch(
        writes.map((write) => {
          const preview = previews.find((item) => item.path === write.path);
          return {
            path: write.path,
            content: write.content,
            expectedOldHash: preview?.oldHash ?? undefined
          };
        }),
        {
          root,
          reason: reason ?? "record_skill_execution_feedback"
        }
      );
    }

    const skillMetrics = nextMetrics.skills[safeSkillId];
    const usefulnessAverage = skillMetrics.usefulnessCount > 0
      ? round(skillMetrics.usefulnessTotal / skillMetrics.usefulnessCount)
      : 0;

    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed,
      record: {
        id: feedbackRecord.id,
        skillId: safeSkillId,
        recordedAt: safeRecordedAt,
        outcome
      },
      files: {
        feedbackPath: selectedFeedbackPath,
        metricsPath: selectedMetricsPath
      },
      metrics: {
        totalExecutions: nextMetrics.totals.executions,
        totals: {
          success: nextMetrics.totals.success,
          partial: nextMetrics.totals.partial,
          failed: nextMetrics.totals.failed
        },
        skill: {
          executions: skillMetrics.executions,
          outcomes: skillMetrics.outcomes,
          qualityGatePasses: skillMetrics.qualityGatePasses,
          qualityGateFails: skillMetrics.qualityGateFails,
          usefulnessAverage,
          timeSavedMinutesTotal: skillMetrics.timeSavedMinutesTotal,
          tokenDeltaEstimateTotal: skillMetrics.tokenDeltaEstimateTotal
        }
      },
      previews,
      applyResult
    });
  }
};

function updateSkillMetrics(metrics, record) {
  const next = {
    ...metrics,
    generatedAt: new Date().toISOString(),
    totals: {
      executions: metrics.totals.executions + 1,
      success: metrics.totals.success + (record.outcome === "success" ? 1 : 0),
      partial: metrics.totals.partial + (record.outcome === "partial" ? 1 : 0),
      failed: metrics.totals.failed + (record.outcome === "failed" ? 1 : 0)
    },
    skills: {
      ...metrics.skills
    }
  };

  const current = metrics.skills[record.skillId] ?? {
    skillId: record.skillId,
    executions: 0,
    outcomes: {
      success: 0,
      partial: 0,
      failed: 0
    },
    qualityGatePasses: 0,
    qualityGateFails: 0,
    usefulnessTotal: 0,
    usefulnessCount: 0,
    timeSavedMinutesTotal: 0,
    tokenDeltaEstimateTotal: 0,
    tags: {},
    lastRecordedAt: null
  };
  const nextTags = {
    ...current.tags
  };
  for (const tag of record.tags) {
    nextTags[tag] = (nextTags[tag] ?? 0) + 1;
  }

  next.skills[record.skillId] = {
    ...current,
    executions: current.executions + 1,
    outcomes: {
      success: current.outcomes.success + (record.outcome === "success" ? 1 : 0),
      partial: current.outcomes.partial + (record.outcome === "partial" ? 1 : 0),
      failed: current.outcomes.failed + (record.outcome === "failed" ? 1 : 0)
    },
    qualityGatePasses: current.qualityGatePasses + (record.qualityGatePass === true ? 1 : 0),
    qualityGateFails: current.qualityGateFails + (record.qualityGatePass === false ? 1 : 0),
    usefulnessTotal: current.usefulnessTotal + (record.usefulnessScore ?? 0),
    usefulnessCount: current.usefulnessCount + (record.usefulnessScore ? 1 : 0),
    timeSavedMinutesTotal: current.timeSavedMinutesTotal + record.timeSavedMinutes,
    tokenDeltaEstimateTotal: current.tokenDeltaEstimateTotal + record.tokenDeltaEstimate,
    tags: nextTags,
    lastRecordedAt: record.recordedAt
  };
  return next;
}

function appendJsonLine(content, entry) {
  const line = JSON.stringify(entry);
  if (!content) {
    return `${line}\n`;
  }
  return content.endsWith("\n")
    ? `${content}${line}\n`
    : `${content}\n${line}\n`;
}

function createRecordId(skillId, recordedAt) {
  const seed = `${skillId}|${recordedAt}|${crypto.randomBytes(4).toString("hex")}`;
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

async function readOptionalText(filePath, root) {
  if (!(await fileExists(filePath, root))) {
    return "";
  }
  return readTextFile(filePath, root);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

