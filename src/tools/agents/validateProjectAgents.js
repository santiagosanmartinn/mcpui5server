import { z } from "zod";
import { fileExists, readTextFile } from "../../utils/fileSystem.js";

const PROJECT_TYPES = ["sapui5", "node", "generic"];
const DEFAULT_BLUEPRINT_PATH = ".codex/mcp/agents/agent.blueprint.json";
const DEFAULT_AGENTS_GUIDE_PATH = ".codex/mcp/agents/AGENTS.generated.md";
const DEFAULT_MCP_CONFIG_PATH = ".vscode/mcp.json";
const EXPECTED_MCP_ENTRY = {
  command: "node",
  args: ["${workspaceFolder}/src/index.js"]
};

const KNOWN_TOOLS = new Set([
  "analyze_ui5_project",
  "read_project_file",
  "search_project_files",
  "analyze_current_file",
  "sync_manifest_json",
  "write_project_file_preview",
  "apply_project_patch",
  "rollback_project_patch",
  "run_project_quality_gate",
  "generate_ui5_controller",
  "generate_ui5_fragment",
  "generate_ui5_formatter",
  "generate_ui5_view_logic",
  "generate_ui5_feature",
  "manage_ui5_i18n",
  "analyze_ui5_performance",
  "validate_ui5_code",
  "validate_ui5_version_compatibility",
  "security_check_ui5_app",
  "generate_javascript_function",
  "refactor_javascript_code",
  "lint_javascript_code",
  "security_check_javascript",
  "search_ui5_sdk",
  "search_mdn",
  "scaffold_project_agents",
  "validate_project_agents",
  "recommend_project_agents",
  "materialize_recommended_agents",
  "save_agent_pack",
  "list_agent_packs",
  "apply_agent_pack",
  "refresh_project_context_docs",
  "record_agent_execution_feedback",
  "rank_agent_packs",
  "promote_agent_pack",
  "audit_project_mcp_state",
  "upgrade_project_mcp",
  "ensure_project_mcp_current",
  "collect_legacy_project_intake",
  "analyze_legacy_project_baseline",
  "build_ai_context_index",
  "prepare_legacy_project_for_ai"
]);

const inputSchema = z.object({
  blueprintPath: z.string().min(1).optional(),
  agentsGuidePath: z.string().min(1).optional(),
  mcpConfigPath: z.string().min(1).optional(),
  requireMcpConfig: z.boolean().optional(),
  strict: z.boolean().optional()
}).strict();

const outputSchema = z.object({
  blueprintPath: z.string(),
  strict: z.boolean(),
  valid: z.boolean(),
  detected: z.object({
    projectName: z.string().nullable(),
    projectType: z.enum(PROJECT_TYPES).nullable(),
    agentCount: z.number().int().nonnegative(),
    uniqueAllowedTools: z.number().int().nonnegative(),
    requiredTools: z.number().int().nonnegative()
  }),
  summary: z.object({
    checksPassed: z.number().int().nonnegative(),
    checksFailed: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative()
  }),
  checks: z.array(
    z.object({
      id: z.string(),
      ok: z.boolean(),
      severity: z.enum(["error", "warn"]),
      message: z.string()
    })
  ),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  recommendedActions: z.array(z.string())
});

const blueprintSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  project: z.object({
    name: z.string().min(1),
    type: z.enum(PROJECT_TYPES),
    namespace: z.string().nullable().optional()
  }),
  policies: z.object({
    strategy: z.literal("mcp-first"),
    requireDryRunByDefault: z.boolean(),
    requirePatchPreview: z.boolean(),
    requireRollbackPlan: z.boolean()
  }),
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
    })
  ).min(2)
});

export const validateProjectAgentsTool = {
  name: "validate_project_agents",
  description: "Validate generated agent blueprint and guardrail artifacts for consistency, tool coverage, and MCP integration readiness.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      blueprintPath,
      agentsGuidePath,
      mcpConfigPath,
      requireMcpConfig,
      strict
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const selectedBlueprintPath = normalizeRelativePath(blueprintPath ?? DEFAULT_BLUEPRINT_PATH);
    const selectedGuidePath = normalizeRelativePath(agentsGuidePath ?? DEFAULT_AGENTS_GUIDE_PATH);
    const selectedMcpConfigPath = normalizeRelativePath(mcpConfigPath ?? DEFAULT_MCP_CONFIG_PATH);
    const strictMode = strict ?? true;
    const shouldRequireMcpConfig = requireMcpConfig ?? false;

    const checks = [];
    const errors = [];
    const warnings = [];
    let parsedBlueprint = null;
    let uniqueAllowedTools = new Set();

    const blueprintRead = await safeReadFile(selectedBlueprintPath, root);
    if (!blueprintRead.ok) {
      pushCheck({
        checks,
        errors,
        warnings
      }, {
        id: "blueprint_file_exists",
        ok: false,
        severity: "error",
        message: `Blueprint file is unavailable: ${selectedBlueprintPath}`
      });

      return formatOutput({
        blueprintPath: selectedBlueprintPath,
        strictMode,
        checks,
        errors,
        warnings,
        parsedBlueprint,
        uniqueAllowedTools
      });
    }

    let blueprintJson;
    try {
      blueprintJson = JSON.parse(blueprintRead.content);
      pushCheck({
        checks,
        errors,
        warnings
      }, {
        id: "blueprint_json",
        ok: true,
        severity: "error",
        message: "Blueprint JSON parsed successfully."
      });
    } catch (error) {
      pushCheck({
        checks,
        errors,
        warnings
      }, {
        id: "blueprint_json",
        ok: false,
        severity: "error",
        message: `Blueprint JSON parsing failed: ${error.message}`
      });
      return formatOutput({
        blueprintPath: selectedBlueprintPath,
        strictMode,
        checks,
        errors,
        warnings,
        parsedBlueprint,
        uniqueAllowedTools
      });
    }

    const schemaValidation = blueprintSchema.safeParse(blueprintJson);
    if (!schemaValidation.success) {
      pushCheck({
        checks,
        errors,
        warnings
      }, {
        id: "blueprint_schema",
        ok: false,
        severity: "error",
        message: `Blueprint schema validation failed: ${schemaValidation.error.issues[0]?.message ?? "invalid schema"}`
      });
      return formatOutput({
        blueprintPath: selectedBlueprintPath,
        strictMode,
        checks,
        errors,
        warnings,
        parsedBlueprint,
        uniqueAllowedTools
      });
    }

    parsedBlueprint = schemaValidation.data;
    pushCheck({
      checks,
      errors,
      warnings
    }, {
      id: "blueprint_schema",
      ok: true,
      severity: "error",
      message: "Blueprint schema is valid."
    });

    const duplicateAgentIds = findDuplicates(parsedBlueprint.agents.map((agent) => agent.id));
    pushCheck({
      checks,
      errors,
      warnings
    }, {
      id: "agent_ids_unique",
      ok: duplicateAgentIds.length === 0,
      severity: "error",
      message: duplicateAgentIds.length === 0
        ? "Agent IDs are unique."
        : `Duplicate agent IDs found: ${duplicateAgentIds.join(", ")}`
    });

    for (const agent of parsedBlueprint.agents) {
      for (const tool of agent.allowedTools) {
        uniqueAllowedTools.add(tool);
      }
    }

    const unknownTools = Array.from(uniqueAllowedTools).filter((tool) => !KNOWN_TOOLS.has(tool)).sort();
    pushCheck({
      checks,
      errors,
      warnings
    }, {
      id: "known_tools_only",
      ok: unknownTools.length === 0,
      severity: strictMode ? "error" : "warn",
      message: unknownTools.length === 0
        ? "All declared tools are known by the MCP contract."
        : `Unknown tools detected in agent allowlists: ${unknownTools.join(", ")}`
    });

    const missingRequiredTools = parsedBlueprint.qualityGates.requiredTools
      .filter((tool) => !uniqueAllowedTools.has(tool));
    pushCheck({
      checks,
      errors,
      warnings
    }, {
      id: "quality_tools_covered",
      ok: missingRequiredTools.length === 0,
      severity: strictMode ? "error" : "warn",
      message: missingRequiredTools.length === 0
        ? "All quality gate tools are covered by at least one agent allowlist."
        : `Quality gate tools not covered by any agent: ${missingRequiredTools.join(", ")}`
    });

    const hasNpmCheck = parsedBlueprint.qualityGates.requiredCommands.includes("npm run check");
    pushCheck({
      checks,
      errors,
      warnings
    }, {
      id: "quality_command_npm_check",
      ok: hasNpmCheck,
      severity: strictMode ? "error" : "warn",
      message: hasNpmCheck
        ? "Quality gate includes npm run check."
        : "Quality gate is missing npm run check."
    });

    const guideRead = await safeReadFile(selectedGuidePath, root);
    if (!guideRead.ok) {
      pushCheck({
        checks,
        errors,
        warnings
      }, {
        id: "agents_guide_exists",
        ok: false,
        severity: strictMode ? "error" : "warn",
        message: `Agents guide file is unavailable: ${selectedGuidePath}`
      });
    } else {
      pushCheck({
        checks,
        errors,
        warnings
      }, {
        id: "agents_guide_mcp_first",
        ok: /MCP-first/i.test(guideRead.content),
        severity: strictMode ? "error" : "warn",
        message: /MCP-first/i.test(guideRead.content)
          ? "Agents guide includes MCP-first operating mode."
          : "Agents guide does not mention MCP-first mode."
      });
    }

    const mcpRead = await safeReadFile(selectedMcpConfigPath, root);
    if (!mcpRead.ok) {
      pushCheck({
        checks,
        errors,
        warnings
      }, {
        id: "mcp_config_exists",
        ok: false,
        severity: strictMode && shouldRequireMcpConfig ? "error" : "warn",
        message: `MCP config file is unavailable: ${selectedMcpConfigPath}`
      });
    } else {
      let parsedMcp = null;
      try {
        parsedMcp = JSON.parse(mcpRead.content);
        pushCheck({
          checks,
          errors,
          warnings
        }, {
          id: "mcp_config_json",
          ok: true,
          severity: "error",
          message: "MCP config JSON parsed successfully."
        });
      } catch (error) {
        pushCheck({
          checks,
          errors,
          warnings
        }, {
          id: "mcp_config_json",
          ok: false,
          severity: strictMode && shouldRequireMcpConfig ? "error" : "warn",
          message: `MCP config parsing failed: ${error.message}`
        });
      }

      if (parsedMcp) {
        const sapui5Entry = parsedMcp?.mcpServers?.sapui5;
        pushCheck({
          checks,
          errors,
          warnings
        }, {
          id: "mcp_sapui5_entry",
          ok: isExpectedMcpEntry(sapui5Entry),
          severity: strictMode && shouldRequireMcpConfig ? "error" : "warn",
          message: isExpectedMcpEntry(sapui5Entry)
            ? "MCP config contains expected sapui5 server entry."
            : "MCP config does not contain expected sapui5 server entry."
        });
      }
    }

    return formatOutput({
      blueprintPath: selectedBlueprintPath,
      strictMode,
      checks,
      errors,
      warnings,
      parsedBlueprint,
      uniqueAllowedTools
    });
  }
};

function formatOutput(input) {
  const {
    blueprintPath,
    strictMode,
    checks,
    errors,
    warnings,
    parsedBlueprint,
    uniqueAllowedTools
  } = input;

  const checksPassed = checks.filter((item) => item.ok).length;
  const checksFailed = checks.length - checksPassed;
  const recommendedActions = checks
    .filter((item) => !item.ok)
    .map((item) => toRecommendedAction(item.id))
    .filter(Boolean);

  return outputSchema.parse({
    blueprintPath,
    strict: strictMode,
    valid: errors.length === 0,
    detected: {
      projectName: parsedBlueprint?.project?.name ?? null,
      projectType: parsedBlueprint?.project?.type ?? null,
      agentCount: parsedBlueprint?.agents?.length ?? 0,
      uniqueAllowedTools: uniqueAllowedTools.size,
      requiredTools: parsedBlueprint?.qualityGates?.requiredTools?.length ?? 0
    },
    summary: {
      checksPassed,
      checksFailed,
      errorCount: errors.length,
      warningCount: warnings.length
    },
    checks,
    errors,
    warnings,
    recommendedActions
  });
}

function pushCheck(state, check) {
  const { checks, errors, warnings } = state;
  checks.push(check);
  if (check.ok) {
    return;
  }
  if (check.severity === "error") {
    errors.push(check.message);
    return;
  }
  warnings.push(check.message);
}

async function safeReadFile(filePath, root) {
  if (!(await fileExists(filePath, root))) {
    return {
      ok: false,
      content: null
    };
  }
  try {
    return {
      ok: true,
      content: await readTextFile(filePath, root)
    };
  } catch {
    return {
      ok: false,
      content: null
    };
  }
}

function findDuplicates(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function isExpectedMcpEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  if (entry.command !== EXPECTED_MCP_ENTRY.command) {
    return false;
  }
  if (!Array.isArray(entry.args) || entry.args.length !== EXPECTED_MCP_ENTRY.args.length) {
    return false;
  }
  return entry.args.every((arg, index) => arg === EXPECTED_MCP_ENTRY.args[index]);
}

function toRecommendedAction(checkId) {
  const map = {
    blueprint_file_exists: "Generate the blueprint with scaffold_project_agents before running strict validation.",
    blueprint_json: "Fix blueprint JSON syntax in the generated blueprint file.",
    blueprint_schema: "Regenerate blueprint artifacts with scaffold_project_agents to restore schema compliance.",
    agent_ids_unique: "Rename duplicate agent IDs so each agent has a unique identifier.",
    known_tools_only: "Replace unknown tool names with tools exposed by src/tools/index.js.",
    quality_tools_covered: "Update agent allowlists to include all required quality gate tools.",
    quality_command_npm_check: "Add npm run check to qualityGates.requiredCommands in the blueprint.",
    agents_guide_exists: "Regenerate AGENTS.generated.md from scaffold_project_agents.",
    agents_guide_mcp_first: "Update AGENTS.generated.md and include explicit MCP-first operation policy.",
    mcp_config_exists: "Create .vscode/mcp.json with sapui5 server configuration.",
    mcp_config_json: "Fix JSON syntax in .vscode/mcp.json.",
    mcp_sapui5_entry: "Add or repair mcpServers.sapui5 entry in .vscode/mcp.json."
  };
  return map[checkId] ?? null;
}
