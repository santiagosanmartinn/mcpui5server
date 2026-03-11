import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { fileExists, readJsonFile } from "../../utils/fileSystem.js";
import {
  DEFAULT_MCP_STATE_PATH,
  LEGACY_ARTIFACTS,
  MANAGED_ARTIFACTS,
  MCP_LAYOUT_VERSION
} from "../../utils/mcpProjectLayout.js";

const STATUS_VALUES = ["up-to-date", "needs-upgrade", "not-initialized"];
const ACTION_VALUES = ["create", "migrate", "update-state", "none"];

const inputSchema = z.object({
  statePath: z.string().min(1).optional(),
  includeLegacyScan: z.boolean().optional()
}).strict();

const managedArtifactSchema = z.object({
  id: z.string(),
  path: z.string(),
  required: z.boolean(),
  exists: z.boolean(),
  status: z.enum(["present", "missing"])
});

const legacyArtifactSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  targetPath: z.string().nullable()
});

const migrationStepSchema = z.object({
  action: z.enum(ACTION_VALUES),
  targetPath: z.string(),
  sourcePath: z.string().nullable(),
  reason: z.string()
});

const outputSchema = z.object({
  statePath: z.string(),
  currentLayoutVersion: z.string(),
  state: z.object({
    exists: z.boolean(),
    layoutVersion: z.string().nullable(),
    lastUpgradedAt: z.string().nullable(),
    toolVersion: z.string().nullable()
  }),
  artifacts: z.object({
    managed: z.array(managedArtifactSchema),
    legacy: z.array(legacyArtifactSchema)
  }),
  summary: z.object({
    managedRequired: z.number().int().nonnegative(),
    managedPresent: z.number().int().nonnegative(),
    managedMissing: z.number().int().nonnegative(),
    legacyDetected: z.number().int().nonnegative()
  }),
  status: z.enum(STATUS_VALUES),
  migrationPlan: z.array(migrationStepSchema),
  recommendedActions: z.array(z.string())
});

export const auditProjectMcpStateTool = {
  name: "audit_project_mcp_state",
  description: "Audit MCP project artifacts/layout version and produce a migration plan to the current managed structure.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { statePath, includeLegacyScan } = inputSchema.parse(args);
    const selectedStatePath = normalizeRelativePath(statePath ?? DEFAULT_MCP_STATE_PATH);
    enforceManagedSubtree(selectedStatePath, ".codex/mcp", "statePath");

    const report = await collectProjectMcpAudit({
      root: context.rootDir,
      statePath: selectedStatePath,
      includeLegacyScan: includeLegacyScan ?? true
    });

    return outputSchema.parse(report);
  }
};

export async function collectProjectMcpAudit(options) {
  const { root, statePath, includeLegacyScan } = options;
  const stateInfo = await readStateInfo(root, statePath);
  const managed = await readManagedArtifacts(root);
  const legacy = includeLegacyScan ? await readLegacyArtifacts(root) : [];
  const summary = summarizeAudit(managed, legacy);
  const migrationPlan = buildMigrationPlan({
    statePath,
    stateInfo,
    managed,
    legacy
  });
  const status = resolveStatus({
    summary,
    stateInfo
  });

  return {
    statePath,
    currentLayoutVersion: MCP_LAYOUT_VERSION,
    state: stateInfo,
    artifacts: {
      managed,
      legacy
    },
    summary,
    status,
    migrationPlan,
    recommendedActions: buildRecommendedActions({
      summary,
      stateInfo,
      status,
      migrationPlan
    })
  };
}

async function readStateInfo(root, statePath) {
  const exists = await fileExists(statePath, root);
  if (!exists) {
    return {
      exists: false,
      layoutVersion: null,
      lastUpgradedAt: null,
      toolVersion: null
    };
  }

  try {
    const state = await readJsonFile(statePath, root);
    return {
      exists: true,
      layoutVersion: typeof state?.layoutVersion === "string" ? state.layoutVersion : null,
      lastUpgradedAt: typeof state?.lastUpgradedAt === "string" ? state.lastUpgradedAt : null,
      toolVersion: typeof state?.toolVersion === "string" ? state.toolVersion : null
    };
  } catch {
    return {
      exists: true,
      layoutVersion: null,
      lastUpgradedAt: null,
      toolVersion: null
    };
  }
}

async function readManagedArtifacts(root) {
  const managed = [];
  for (const artifact of MANAGED_ARTIFACTS) {
    const exists = await fileExists(artifact.path, root);
    managed.push({
      id: artifact.id,
      path: artifact.path,
      required: artifact.required,
      exists,
      status: exists ? "present" : "missing"
    });
  }
  return managed;
}

async function readLegacyArtifacts(root) {
  const legacy = [];
  for (const artifact of LEGACY_ARTIFACTS) {
    const exists = await fileExists(artifact.path, root);
    legacy.push({
      path: artifact.path,
      exists,
      targetPath: artifact.targetPath ?? null
    });
  }
  return legacy;
}

function summarizeAudit(managed, legacy) {
  const required = managed.filter((item) => item.required);
  const managedPresent = required.filter((item) => item.exists).length;
  const managedMissing = required.length - managedPresent;
  const legacyDetected = legacy.filter((item) => item.exists).length;

  return {
    managedRequired: required.length,
    managedPresent,
    managedMissing,
    legacyDetected
  };
}

function resolveStatus(input) {
  const { summary, stateInfo } = input;
  const hasRequiredArtifacts = summary.managedMissing === 0;
  const stateCurrent = stateInfo.exists && stateInfo.layoutVersion === MCP_LAYOUT_VERSION;

  if (hasRequiredArtifacts && stateCurrent) {
    return "up-to-date";
  }
  if (summary.managedPresent === 0) {
    return "not-initialized";
  }
  return "needs-upgrade";
}

function buildMigrationPlan(input) {
  const { statePath, stateInfo, managed, legacy } = input;
  const steps = [];
  const legacyByTarget = new Map();
  for (const item of legacy) {
    if (item.exists && item.targetPath && !legacyByTarget.has(item.targetPath)) {
      legacyByTarget.set(item.targetPath, item.path);
    }
  }

  for (const artifact of managed.filter((item) => item.required)) {
    if (artifact.exists) {
      continue;
    }
    const sourcePath = legacyByTarget.get(artifact.path) ?? null;
    steps.push({
      action: sourcePath ? "migrate" : "create",
      targetPath: artifact.path,
      sourcePath,
      reason: sourcePath
        ? `Legacy artifact detected at ${sourcePath}.`
        : "Required managed artifact is missing."
    });
  }

  if (!stateInfo.exists || stateInfo.layoutVersion !== MCP_LAYOUT_VERSION) {
    steps.push({
      action: "update-state",
      targetPath: statePath,
      sourcePath: null,
      reason: stateInfo.exists
        ? `Layout version mismatch (${stateInfo.layoutVersion ?? "unknown"} -> ${MCP_LAYOUT_VERSION}).`
        : "MCP project state file is missing."
    });
  }

  if (steps.length === 0) {
    steps.push({
      action: "none",
      targetPath: statePath,
      sourcePath: null,
      reason: "Project already matches current managed MCP layout."
    });
  }

  return steps;
}

function buildRecommendedActions(input) {
  const { summary, stateInfo, status, migrationPlan } = input;
  const actions = [];
  if (status === "up-to-date") {
    actions.push("No migration required. Keep using validate_project_agents and run_project_quality_gate in CI.");
    return actions;
  }

  if (!stateInfo.exists || stateInfo.layoutVersion !== MCP_LAYOUT_VERSION) {
    actions.push("Run upgrade_project_mcp to persist the latest layout state metadata.");
  }
  if (summary.managedMissing > 0) {
    actions.push("Run upgrade_project_mcp with dryRun first to preview missing artifact creation/migration.");
  }
  if (summary.legacyDetected > 0) {
    actions.push("After migration, review and optionally remove legacy artifact locations.");
  }
  if (migrationPlan.some((item) => item.action === "create")) {
    actions.push("If custom agent artifacts are required, rerun upgrade_project_mcp with allowOverwrite=true after backup.");
  }
  actions.push("Validate upgraded artifacts with validate_project_agents (strict=true).");
  return Array.from(new Set(actions));
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
