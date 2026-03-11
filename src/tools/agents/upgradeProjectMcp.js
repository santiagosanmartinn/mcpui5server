import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readTextFile } from "../../utils/fileSystem.js";
import {
  DEFAULT_DOCS_DIR,
  DEFAULT_OUTPUT_DIR,
  DEFAULT_POLICY_PATH,
  buildBlueprint,
  renderAgentPolicy,
  renderAgentsGuide,
  renderBootstrapPrompt,
  renderContextDoc,
  renderFlowsDoc,
  resolveMcpConfigWrite,
  resolveProjectProfile
} from "./scaffoldProjectAgents.js";
import { collectProjectMcpAudit } from "./auditProjectMcpState.js";
import { validateProjectAgentsTool } from "./validateProjectAgents.js";
import { runProjectQualityGateTool } from "../project/runProjectQualityGate.js";
import {
  DEFAULT_MCP_STATE_PATH,
  LEGACY_ARTIFACTS,
  MANAGED_ARTIFACTS,
  MCP_LAYOUT_VERSION,
  MCP_STATE_SCHEMA_VERSION
} from "../../utils/mcpProjectLayout.js";

const PROJECT_TYPES = ["sapui5", "node", "generic"];
const ACTION_VALUES = ["create", "migrate", "refresh", "update-state", "skip"];

const inputSchema = z.object({
  dryRun: z.boolean().optional(),
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

const previewSchema = z.object({
  path: z.string(),
  role: z.enum(["blueprint", "agents-guide", "bootstrap-prompt", "agent-policy", "context-doc", "flows-doc", "mcp-state", "mcp-config"]),
  existsBefore: z.boolean(),
  changed: z.boolean(),
  oldHash: z.string().nullable(),
  newHash: z.string(),
  diffPreview: z.string(),
  diffTruncated: z.boolean()
});

const migrationActionSchema = z.object({
  action: z.enum(ACTION_VALUES),
  targetPath: z.string(),
  sourcePath: z.string().nullable(),
  reason: z.string(),
  applied: z.boolean()
});

const outputSchema = z.object({
  dryRun: z.boolean(),
  changed: z.boolean(),
  statePath: z.string(),
  statusBefore: z.enum(["up-to-date", "needs-upgrade", "not-initialized"]),
  statusAfter: z.enum(["up-to-date", "needs-upgrade", "not-initialized"]),
  auditBefore: z.object({
    summary: z.object({
      managedRequired: z.number().int().nonnegative(),
      managedPresent: z.number().int().nonnegative(),
      managedMissing: z.number().int().nonnegative(),
      legacyDetected: z.number().int().nonnegative()
    }),
    recommendedActions: z.array(z.string())
  }),
  migration: z.object({
    planned: z.number().int().nonnegative(),
    applied: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    actions: z.array(migrationActionSchema)
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
  }).nullable(),
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
});

export const upgradeProjectMcpTool = {
  name: "upgrade_project_mcp",
  description: "Upgrade MCP-managed project artifacts to the latest layout version with dry-run, preview, and rollback-safe patching.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      dryRun,
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

    const root = context.rootDir;
    const shouldDryRun = dryRun ?? true;
    const shouldAllowOverwrite = allowOverwrite ?? false;
    const shouldIncludeVscodeMcp = includeVscodeMcp ?? false;
    const shouldRunValidation = runPostValidation ?? true;
    const shouldFailValidation = failOnValidation ?? false;
    const shouldRunQualityGate = runQualityGate ?? false;
    const shouldFailQualityGate = failOnQualityGate ?? false;
    const shouldPreferLegacyArtifacts = preferLegacyArtifacts ?? true;
    const selectedStatePath = normalizeRelativePath(statePath ?? DEFAULT_MCP_STATE_PATH);
    enforceManagedSubtree(selectedStatePath, ".codex/mcp", "statePath");

    const auditBefore = await collectProjectMcpAudit({
      root,
      statePath: selectedStatePath,
      includeLegacyScan: true
    });

    const projectProfile = await resolveProjectProfile({
      root,
      projectName,
      projectType,
      namespace
    });

    const files = {
      blueprintPath: `${DEFAULT_OUTPUT_DIR}/agent.blueprint.json`,
      agentsGuidePath: `${DEFAULT_OUTPUT_DIR}/AGENTS.generated.md`,
      bootstrapPromptPath: `${DEFAULT_OUTPUT_DIR}/prompts/task-bootstrap.txt`,
      policyPath: DEFAULT_POLICY_PATH,
      contextDocPath: `${DEFAULT_DOCS_DIR}/project-context.md`,
      flowsDocPath: `${DEFAULT_DOCS_DIR}/agent-flows.md`
    };

    const blueprint = buildBlueprint(projectProfile, {});
    const generatedByPath = {
      [files.blueprintPath]: `${JSON.stringify(blueprint, null, 2)}\n`,
      [files.agentsGuidePath]: renderAgentsGuide(projectProfile, files),
      [files.bootstrapPromptPath]: renderBootstrapPrompt(projectProfile, files),
      [files.policyPath]: renderAgentPolicy(projectProfile),
      [files.contextDocPath]: renderContextDoc(projectProfile, files),
      [files.flowsDocPath]: renderFlowsDoc(projectProfile, files)
    };

    const plannedWrites = [];
    const migrationActions = [];

    for (const artifact of MANAGED_ARTIFACTS.filter((item) => item.id !== "projectState")) {
      const targetPath = artifact.path;
      const targetExists = await fileExists(targetPath, root);
      if (targetExists && !shouldAllowOverwrite) {
        migrationActions.push({
          action: "skip",
          targetPath,
          sourcePath: null,
          reason: "Target exists and allowOverwrite=false.",
          applied: false
        });
        continue;
      }

      let content = generatedByPath[targetPath] ?? null;
      let sourcePath = null;
      if (!targetExists && shouldPreferLegacyArtifacts) {
        sourcePath = await findLegacySourceForTarget(targetPath, root);
        if (sourcePath) {
          content = await readTextFile(sourcePath, root);
        }
      }

      if (typeof content !== "string") {
        continue;
      }

      plannedWrites.push({
        path: targetPath,
        role: artifact.role,
        content
      });

      migrationActions.push({
        action: sourcePath
          ? "migrate"
          : targetExists
            ? "refresh"
            : "create",
        targetPath,
        sourcePath,
        reason: sourcePath
          ? `Migrating legacy artifact from ${sourcePath}.`
          : targetExists
            ? "Refreshing target artifact to latest template."
            : "Creating missing managed artifact.",
        applied: false
      });
    }

    const toolVersion = process.env.npm_package_version ?? "1.0.0";
    const now = new Date().toISOString();
    const shouldWriteState = !auditBefore.state.exists
      || auditBefore.state.layoutVersion !== MCP_LAYOUT_VERSION
      || migrationActions.some((item) => item.action !== "skip");
    if (shouldWriteState) {
      const statePayload = {
        schemaVersion: MCP_STATE_SCHEMA_VERSION,
        layoutVersion: MCP_LAYOUT_VERSION,
        toolVersion,
        updatedBy: "upgrade_project_mcp",
        lastAuditAt: now,
        lastUpgradedAt: now,
        project: {
          name: projectProfile.name,
          type: projectProfile.type,
          namespace: projectProfile.namespace
        },
        summary: {
          statusBefore: auditBefore.status,
          managedMissingBefore: auditBefore.summary.managedMissing,
          legacyDetectedBefore: auditBefore.summary.legacyDetected
        },
        managedArtifacts: MANAGED_ARTIFACTS.map((item) => item.path)
      };

      plannedWrites.push({
        path: selectedStatePath,
        role: "mcp-state",
        content: `${JSON.stringify(statePayload, null, 2)}\n`
      });
      migrationActions.push({
        action: auditBefore.state.exists ? "update-state" : "create",
        targetPath: selectedStatePath,
        sourcePath: null,
        reason: auditBefore.state.exists
          ? "Refreshing MCP project state metadata."
          : "Creating MCP project state metadata.",
        applied: false
      });
    }

    if (shouldIncludeVscodeMcp) {
      const mcpContent = await resolveMcpConfigWrite({
        root,
        allowOverwrite: shouldAllowOverwrite
      });
      plannedWrites.push({
        path: ".vscode/mcp.json",
        role: "mcp-config",
        content: mcpContent
      });
      migrationActions.push({
        action: (await fileExists(".vscode/mcp.json", root)) ? "refresh" : "create",
        targetPath: ".vscode/mcp.json",
        sourcePath: null,
        reason: "Ensuring local VSCode MCP server wiring exists.",
        applied: false
      });
    }

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
        reason: reason ?? "upgrade_project_mcp"
      });
      for (const action of migrationActions) {
        const matched = applyResult.changedFiles.find((file) => file.path === action.targetPath);
        action.applied = Boolean(matched);
      }
    }

    const validation = {
      executed: false,
      valid: null,
      errorCount: 0,
      warningCount: 0
    };
    if (shouldRunValidation) {
      const validationReport = await validateProjectAgentsTool.handler(
        {
          strict: true
        },
        { context }
      );
      validation.executed = true;
      validation.valid = validationReport.valid;
      validation.errorCount = validationReport.summary.errorCount;
      validation.warningCount = validationReport.summary.warningCount;
      if (shouldFailValidation && !validationReport.valid) {
        throw new ToolError("Upgraded artifacts failed strict validation.", {
          code: "UPGRADE_VALIDATION_FAILED",
          details: {
            errors: validationReport.errors
          }
        });
      }
    }

    const qualityGate = {
      executed: false,
      pass: null,
      errorChecks: 0,
      warningChecks: 0
    };
    if (shouldRunQualityGate) {
      const qualityReport = await runProjectQualityGateTool.handler(
        {
          sourceDir: sourceDir ?? "webapp",
          refreshDocs: false,
          applyDocs: false,
          respectPolicy: true
        },
        { context }
      );
      qualityGate.executed = true;
      qualityGate.pass = qualityReport.pass;
      qualityGate.errorChecks = qualityReport.summary.errorChecks;
      qualityGate.warningChecks = qualityReport.summary.warningChecks;
      if (shouldFailQualityGate && !qualityReport.pass) {
        throw new ToolError("Quality gate failed after MCP upgrade.", {
          code: "UPGRADE_QUALITY_GATE_FAILED",
          details: {
            failedChecks: qualityReport.summary.failedChecks,
            errorChecks: qualityReport.summary.errorChecks
          }
        });
      }
    }

    const auditAfter = (!shouldDryRun && changed)
      ? await collectProjectMcpAudit({ root, statePath: selectedStatePath, includeLegacyScan: true })
      : projectAuditAfterDryRun(auditBefore, migrationActions);

    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed,
      statePath: selectedStatePath,
      statusBefore: auditBefore.status,
      statusAfter: auditAfter.status,
      auditBefore: {
        summary: auditBefore.summary,
        recommendedActions: auditBefore.recommendedActions
      },
      migration: {
        planned: migrationActions.length,
        applied: migrationActions.filter((item) => item.applied).length,
        skipped: migrationActions.filter((item) => item.action === "skip").length,
        actions: migrationActions
      },
      fileSummary: summarizePreviews(previews),
      previews,
      applyResult,
      validation,
      qualityGate
    });
  }
};

async function findLegacySourceForTarget(targetPath, root) {
  const candidates = LEGACY_ARTIFACTS
    .filter((item) => item.targetPath === targetPath)
    .map((item) => item.path);

  for (const candidate of candidates) {
    if (await fileExists(candidate, root)) {
      return candidate;
    }
  }
  return null;
}

function projectAuditAfterDryRun(auditBefore, migrationActions) {
  const createsRequired = migrationActions.some((item) =>
    item.action === "create" || item.action === "migrate" || item.action === "refresh"
  );
  const updatesState = migrationActions.some((item) => item.action === "update-state");
  if (auditBefore.status === "up-to-date") {
    return auditBefore;
  }

  if (createsRequired && updatesState) {
    return {
      ...auditBefore,
      status: "up-to-date"
    };
  }
  return {
    ...auditBefore,
    status: "needs-upgrade"
  };
}

function summarizePreviews(previews) {
  const summary = {
    created: 0,
    updated: 0,
    unchanged: 0
  };

  for (const preview of previews) {
    if (!preview.changed) {
      summary.unchanged += 1;
      continue;
    }
    if (preview.existsBefore) {
      summary.updated += 1;
    } else {
      summary.created += 1;
    }
  }
  return summary;
}

function normalizeRelativePath(value) {
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
