import crypto from "node:crypto";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readJsonFile, readTextFile } from "../../utils/fileSystem.js";

const PROJECT_TYPES = ["sapui5", "node", "generic"];
const OUTCOMES = ["success", "partial", "failed"];
const DEFAULT_FEEDBACK_PATH = ".codex/mcp/feedback/executions.jsonl";
const DEFAULT_METRICS_PATH = ".codex/mcp/feedback/metrics.json";

const inputSchema = z.object({
  packSlug: z.string().min(1),
  packVersion: z.string().min(1).optional(),
  projectType: z.enum(PROJECT_TYPES),
  ui5Version: z.string().regex(/^\d+\.\d+(\.\d+)?$/).optional(),
  outcome: z.enum(OUTCOMES),
  qualityGatePass: z.boolean().optional(),
  issuesIntroduced: z.number().int().min(0).optional(),
  manualEditsNeeded: z.number().int().min(0).optional(),
  timeSavedMinutes: z.number().int().min(0).optional(),
  tokenDeltaEstimate: z.number().int().optional(),
  whatWorked: z.string().max(2000).optional(),
  whatFailed: z.string().max(2000).optional(),
  rootCause: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1)).max(20).optional(),
  feedbackPath: z.string().min(1).optional(),
  metricsPath: z.string().min(1).optional(),
  recordedAt: z.string().datetime().optional(),
  dryRun: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional()
}).strict();

const previewSchema = z.object({
  path: z.string(),
  role: z.enum(["feedback-log", "feedback-metrics"]),
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
    packKey: z.string(),
    recordedAt: z.string(),
    outcome: z.enum(OUTCOMES)
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
    pack: z.object({
      executions: z.number().int().nonnegative(),
      outcomes: z.object({
        success: z.number().int().nonnegative(),
        partial: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative()
      }),
      qualityGatePasses: z.number().int().nonnegative(),
      qualityGateFails: z.number().int().nonnegative(),
      issuesIntroducedTotal: z.number().int().nonnegative(),
      manualEditsNeededTotal: z.number().int().nonnegative(),
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

const metricsPackSchema = z.object({
  packSlug: z.string(),
  packVersion: z.string(),
  executions: z.number().int().nonnegative(),
  outcomes: z.object({
    success: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative()
  }),
  qualityGatePasses: z.number().int().nonnegative(),
  qualityGateFails: z.number().int().nonnegative(),
  issuesIntroducedTotal: z.number().int().nonnegative(),
  manualEditsNeededTotal: z.number().int().nonnegative(),
  timeSavedMinutesTotal: z.number().int().nonnegative(),
  tokenDeltaEstimateTotal: z.number().int(),
  projectTypes: z.record(z.string(), z.number().int().nonnegative()),
  lastRecordedAt: z.string()
}).strict();

const metricsFileSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  generatedAt: z.string(),
  totals: z.object({
    executions: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative()
  }),
  packs: z.record(z.string(), metricsPackSchema)
}).strict();

export const recordAgentExecutionFeedbackTool = {
  name: "record_agent_execution_feedback",
  description: "Record agent execution feedback in local JSONL log and update aggregate pack metrics for future ranking and promotion.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      packSlug,
      packVersion,
      projectType,
      ui5Version,
      outcome,
      qualityGatePass,
      issuesIntroduced,
      manualEditsNeeded,
      timeSavedMinutes,
      tokenDeltaEstimate,
      whatWorked,
      whatFailed,
      rootCause,
      tags,
      feedbackPath,
      metricsPath,
      recordedAt,
      dryRun,
      reason,
      maxDiffLines
    } = inputSchema.parse(args);

    const root = context.rootDir;
    const selectedFeedbackPath = normalizePath(feedbackPath ?? DEFAULT_FEEDBACK_PATH);
    const selectedMetricsPath = normalizePath(metricsPath ?? DEFAULT_METRICS_PATH);
    enforceManagedSubtree(selectedFeedbackPath, ".codex/mcp", "feedbackPath");
    enforceManagedSubtree(selectedMetricsPath, ".codex/mcp", "metricsPath");

    const shouldDryRun = dryRun ?? true;
    const safeRecordedAt = recordedAt ?? new Date().toISOString();
    const safePackVersion = packVersion ?? "1.0.0";
    const packKey = `${packSlug}@${safePackVersion}`;
    const recordId = createRecordId(packKey, safeRecordedAt);
    const feedbackRecord = {
      schemaVersion: "1.0.0",
      id: recordId,
      packSlug,
      packVersion: safePackVersion,
      projectType,
      ui5Version: ui5Version ?? null,
      outcome,
      qualityGatePass: qualityGatePass ?? null,
      issuesIntroduced: issuesIntroduced ?? 0,
      manualEditsNeeded: manualEditsNeeded ?? 0,
      timeSavedMinutes: timeSavedMinutes ?? 0,
      tokenDeltaEstimate: tokenDeltaEstimate ?? 0,
      whatWorked: whatWorked ?? null,
      whatFailed: whatFailed ?? null,
      rootCause: rootCause ?? null,
      tags: unique(tags ?? []),
      recordedAt: safeRecordedAt
    };

    const previousFeedback = await readOptionalText(selectedFeedbackPath, root);
    const nextFeedback = appendJsonLine(previousFeedback, feedbackRecord);
    const currentMetrics = await readOrCreateMetrics(selectedMetricsPath, root);
    const nextMetrics = applyFeedbackToMetrics(currentMetrics, feedbackRecord);
    const nextMetricsContent = `${JSON.stringify(nextMetrics, null, 2)}\n`;

    const plannedWrites = [
      {
        path: selectedFeedbackPath,
        role: "feedback-log",
        content: nextFeedback
      },
      {
        path: selectedMetricsPath,
        role: "feedback-metrics",
        content: nextMetricsContent
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
        reason: reason ?? "record_agent_execution_feedback"
      });
    }

    const packMetrics = nextMetrics.packs[packKey];
    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed,
      record: {
        id: recordId,
        packKey,
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
        pack: {
          executions: packMetrics.executions,
          outcomes: packMetrics.outcomes,
          qualityGatePasses: packMetrics.qualityGatePasses,
          qualityGateFails: packMetrics.qualityGateFails,
          issuesIntroducedTotal: packMetrics.issuesIntroducedTotal,
          manualEditsNeededTotal: packMetrics.manualEditsNeededTotal,
          timeSavedMinutesTotal: packMetrics.timeSavedMinutesTotal,
          tokenDeltaEstimateTotal: packMetrics.tokenDeltaEstimateTotal
        }
      },
      previews,
      applyResult
    });
  }
};

async function readOrCreateMetrics(metricsPath, root) {
  if (!(await fileExists(metricsPath, root))) {
    return createEmptyMetrics();
  }

  try {
    const parsed = await readJsonFile(metricsPath, root);
    const result = metricsFileSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
  } catch {
    // Fallback to empty metrics when file is invalid.
  }

  return createEmptyMetrics();
}

function createEmptyMetrics() {
  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    totals: {
      executions: 0,
      success: 0,
      partial: 0,
      failed: 0
    },
    packs: {}
  };
}

function applyFeedbackToMetrics(metrics, record) {
  const next = {
    ...metrics,
    generatedAt: new Date().toISOString(),
    totals: {
      executions: metrics.totals.executions + 1,
      success: metrics.totals.success + (record.outcome === "success" ? 1 : 0),
      partial: metrics.totals.partial + (record.outcome === "partial" ? 1 : 0),
      failed: metrics.totals.failed + (record.outcome === "failed" ? 1 : 0)
    },
    packs: {
      ...metrics.packs
    }
  };

  const packKey = `${record.packSlug}@${record.packVersion}`;
  const currentPack = metrics.packs[packKey] ?? {
    packSlug: record.packSlug,
    packVersion: record.packVersion,
    executions: 0,
    outcomes: {
      success: 0,
      partial: 0,
      failed: 0
    },
    qualityGatePasses: 0,
    qualityGateFails: 0,
    issuesIntroducedTotal: 0,
    manualEditsNeededTotal: 0,
    timeSavedMinutesTotal: 0,
    tokenDeltaEstimateTotal: 0,
    projectTypes: {},
    lastRecordedAt: record.recordedAt
  };

  next.packs[packKey] = {
    ...currentPack,
    executions: currentPack.executions + 1,
    outcomes: {
      success: currentPack.outcomes.success + (record.outcome === "success" ? 1 : 0),
      partial: currentPack.outcomes.partial + (record.outcome === "partial" ? 1 : 0),
      failed: currentPack.outcomes.failed + (record.outcome === "failed" ? 1 : 0)
    },
    qualityGatePasses: currentPack.qualityGatePasses + (record.qualityGatePass === true ? 1 : 0),
    qualityGateFails: currentPack.qualityGateFails + (record.qualityGatePass === false ? 1 : 0),
    issuesIntroducedTotal: currentPack.issuesIntroducedTotal + record.issuesIntroduced,
    manualEditsNeededTotal: currentPack.manualEditsNeededTotal + record.manualEditsNeeded,
    timeSavedMinutesTotal: currentPack.timeSavedMinutesTotal + record.timeSavedMinutes,
    tokenDeltaEstimateTotal: currentPack.tokenDeltaEstimateTotal + record.tokenDeltaEstimate,
    projectTypes: {
      ...currentPack.projectTypes,
      [record.projectType]: (currentPack.projectTypes[record.projectType] ?? 0) + 1
    },
    lastRecordedAt: record.recordedAt
  };

  return next;
}

function appendJsonLine(content, entry) {
  const line = JSON.stringify(entry);
  if (!content || content.length === 0) {
    return `${line}\n`;
  }
  if (content.endsWith("\n")) {
    return `${content}${line}\n`;
  }
  return `${content}\n${line}\n`;
}

function createRecordId(packKey, recordedAt) {
  const seed = `${packKey}|${recordedAt}|${crypto.randomBytes(4).toString("hex")}`;
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

async function readOptionalText(filePath, root) {
  if (!(await fileExists(filePath, root))) {
    return "";
  }
  return readTextFile(filePath, root);
}

function unique(values) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
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
