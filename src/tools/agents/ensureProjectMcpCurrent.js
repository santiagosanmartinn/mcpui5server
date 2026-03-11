import { z } from "zod";
import { auditProjectMcpStateTool } from "./auditProjectMcpState.js";
import { upgradeProjectMcpTool } from "./upgradeProjectMcp.js";
import { DEFAULT_MCP_STATE_PATH } from "../../utils/mcpProjectLayout.js";

const PROJECT_TYPES = ["sapui5", "node", "generic"];
const STATUS_VALUES = ["up-to-date", "needs-upgrade", "not-initialized"];
const ACTION_VALUES = ["none", "upgrade-dry-run", "upgrade-applied"];

const inputSchema = z.object({
  autoApply: z.boolean().optional(),
  force: z.boolean().optional(),
  allowOverwrite: z.boolean().optional(),
  includeVscodeMcp: z.boolean().optional(),
  runPostValidation: z.boolean().optional(),
  failOnValidation: z.boolean().optional(),
  runQualityGate: z.boolean().optional(),
  failOnQualityGate: z.boolean().optional(),
  sourceDir: z.string().min(1).optional(),
  statePath: z.string().min(1).optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional(),
  preferLegacyArtifacts: z.boolean().optional(),
  projectName: z.string().min(1).optional(),
  projectType: z.enum(PROJECT_TYPES).optional(),
  namespace: z.string().min(1).optional()
}).strict();

const outputSchema = z.object({
  autoApply: z.boolean(),
  forced: z.boolean(),
  needsUpgrade: z.boolean(),
  actionTaken: z.enum(ACTION_VALUES),
  statusBefore: z.enum(STATUS_VALUES),
  statusAfter: z.enum(STATUS_VALUES),
  statePath: z.string(),
  audit: z.object({
    summary: z.object({
      managedRequired: z.number().int().nonnegative(),
      managedPresent: z.number().int().nonnegative(),
      managedMissing: z.number().int().nonnegative(),
      legacyDetected: z.number().int().nonnegative()
    }),
    migrationPlanSteps: z.number().int().nonnegative(),
    recommendedActions: z.array(z.string())
  }),
  upgrade: z.object({
    dryRun: z.boolean(),
    changed: z.boolean(),
    statusAfter: z.enum(STATUS_VALUES),
    migration: z.object({
      planned: z.number().int().nonnegative(),
      applied: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative()
    }),
    validation: z.object({
      executed: z.boolean(),
      valid: z.boolean().nullable(),
      errorCount: z.number().int().nonnegative(),
      warningCount: z.number().int().nonnegative()
    }),
    qualityGate: z.object({
      executed: z.boolean(),
      pass: z.boolean().nullable(),
      errorChecks: z.number().int().nonnegative(),
      warningChecks: z.number().int().nonnegative()
    })
  }).nullable()
});

export const ensureProjectMcpCurrentTool = {
  name: "ensure_project_mcp_current",
  description: "Automatically audit and upgrade MCP project artifacts to the current managed layout when needed.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      autoApply,
      force,
      allowOverwrite,
      includeVscodeMcp,
      runPostValidation,
      failOnValidation,
      runQualityGate,
      failOnQualityGate,
      sourceDir,
      statePath,
      reason,
      maxDiffLines,
      preferLegacyArtifacts,
      projectName,
      projectType,
      namespace
    } = inputSchema.parse(args);

    const shouldAutoApply = autoApply ?? true;
    const shouldForce = force ?? false;
    const selectedStatePath = normalizeRelativePath(statePath ?? DEFAULT_MCP_STATE_PATH);

    const auditReport = await auditProjectMcpStateTool.handler(
      {
        statePath: selectedStatePath,
        includeLegacyScan: true
      },
      { context }
    );

    const needsUpgrade = auditReport.status !== "up-to-date";
    if (!needsUpgrade && !shouldForce) {
      return outputSchema.parse({
        autoApply: shouldAutoApply,
        forced: shouldForce,
        needsUpgrade,
        actionTaken: "none",
        statusBefore: auditReport.status,
        statusAfter: auditReport.status,
        statePath: selectedStatePath,
        audit: {
          summary: auditReport.summary,
          migrationPlanSteps: auditReport.migrationPlan.length,
          recommendedActions: auditReport.recommendedActions
        },
        upgrade: null
      });
    }

    const upgradeReport = await upgradeProjectMcpTool.handler(
      {
        dryRun: shouldAutoApply ? false : true,
        allowOverwrite,
        includeVscodeMcp,
        runPostValidation,
        failOnValidation,
        runQualityGate,
        failOnQualityGate,
        sourceDir,
        statePath: selectedStatePath,
        reason: reason ?? "ensure_project_mcp_current",
        maxDiffLines,
        preferLegacyArtifacts,
        projectName,
        projectType,
        namespace
      },
      { context }
    );

    return outputSchema.parse({
      autoApply: shouldAutoApply,
      forced: shouldForce,
      needsUpgrade,
      actionTaken: upgradeReport.changed
        ? (upgradeReport.dryRun ? "upgrade-dry-run" : "upgrade-applied")
        : "none",
      statusBefore: auditReport.status,
      statusAfter: upgradeReport.statusAfter,
      statePath: selectedStatePath,
      audit: {
        summary: auditReport.summary,
        migrationPlanSteps: auditReport.migrationPlan.length,
        recommendedActions: auditReport.recommendedActions
      },
      upgrade: {
        dryRun: upgradeReport.dryRun,
        changed: upgradeReport.changed,
        statusAfter: upgradeReport.statusAfter,
        migration: {
          planned: upgradeReport.migration.planned,
          applied: upgradeReport.migration.applied,
          skipped: upgradeReport.migration.skipped
        },
        validation: upgradeReport.validation,
        qualityGate: upgradeReport.qualityGate
      }
    });
  }
};

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}
