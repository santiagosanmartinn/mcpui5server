import path from "node:path";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readJsonFile, readTextFile } from "../../utils/fileSystem.js";

const PROJECT_TYPES = ["sapui5", "node", "generic"];
const DEFAULT_OUTPUT_DIR = ".codex/mcp/agents";
const DEFAULT_DOCS_DIR = "docs/mcp";
const SAPUI5_MCP_ENTRY = {
  command: "node",
  args: ["${workspaceFolder}/src/index.js"]
};

const TOOL_GROUPS = {
  project: [
    "analyze_ui5_project",
    "read_project_file",
    "search_project_files",
    "analyze_current_file",
    "sync_manifest_json",
    "write_project_file_preview",
    "apply_project_patch",
    "rollback_project_patch",
    "run_project_quality_gate"
  ],
  ui5: [
    "generate_ui5_controller",
    "generate_ui5_fragment",
    "generate_ui5_formatter",
    "generate_ui5_view_logic",
    "generate_ui5_feature",
    "manage_ui5_i18n",
    "analyze_ui5_performance",
    "validate_ui5_code",
    "validate_ui5_version_compatibility",
    "security_check_ui5_app"
  ],
  javascript: [
    "generate_javascript_function",
    "refactor_javascript_code",
    "lint_javascript_code",
    "security_check_javascript"
  ],
  documentation: [
    "search_ui5_sdk",
    "search_mdn"
  ],
  agents: [
    "scaffold_project_agents",
    "validate_project_agents",
    "recommend_project_agents",
    "materialize_recommended_agents",
    "save_agent_pack",
    "list_agent_packs",
    "apply_agent_pack",
    "refresh_project_context_docs"
  ]
};

const agentDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  allowedTools: z.array(z.string().min(1)).min(1)
}).strict();

const qualityGatesSchema = z.object({
  requiredTools: z.array(z.string().min(1)).optional(),
  requiredCommands: z.array(z.string().min(1)).optional(),
  minimumReviewAgents: z.number().int().positive().optional()
}).strict().optional();

const recommendationMetaSchema = z.object({
  source: z.string().min(1),
  selectedRecommendationIds: z.array(z.string().min(1)).optional()
}).strict().optional();

const inputSchema = z.object({
  projectName: z.string().min(1).optional(),
  projectType: z.enum(PROJECT_TYPES).optional(),
  namespace: z.string().min(1).optional(),
  outputDir: z.string().min(1).optional(),
  docsDir: z.string().min(1).optional(),
  generateDocs: z.boolean().optional(),
  includeVscodeMcp: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  allowOverwrite: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional(),
  agentDefinitions: z.array(agentDefinitionSchema).min(2).optional(),
  qualityGates: qualityGatesSchema,
  recommendationMeta: recommendationMetaSchema
}).strict();

const filePreviewSchema = z.object({
  path: z.string(),
  role: z.enum(["blueprint", "agents-guide", "bootstrap-prompt", "mcp-config", "context-doc", "flows-doc"]),
  existsBefore: z.boolean(),
  changed: z.boolean(),
  oldHash: z.string().nullable(),
  newHash: z.string(),
  diffPreview: z.string(),
  diffTruncated: z.boolean()
});

export const scaffoldProjectAgentsOutputSchema = z.object({
  dryRun: z.boolean(),
  changed: z.boolean(),
  project: z.object({
    name: z.string(),
    type: z.enum(PROJECT_TYPES),
    namespace: z.string().nullable()
  }),
  files: z.object({
    blueprintPath: z.string(),
    agentsGuidePath: z.string(),
    bootstrapPromptPath: z.string(),
    contextDocPath: z.string().nullable(),
    flowsDocPath: z.string().nullable(),
    mcpConfigPath: z.string().nullable()
  }),
  fileSummary: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative()
  }),
  previews: z.array(filePreviewSchema),
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

export const scaffoldProjectAgentsTool = {
  name: "scaffold_project_agents",
  description: "Scaffold reusable project agent artifacts (blueprint, guide, bootstrap prompt, optional MCP config) with dry-run and patch safety.",
  inputSchema,
  outputSchema: scaffoldProjectAgentsOutputSchema,
  async handler(args, { context }) {
    const {
      projectName,
      projectType,
      namespace,
      outputDir,
      docsDir,
      generateDocs,
      includeVscodeMcp,
      dryRun,
      allowOverwrite,
      reason,
      maxDiffLines,
      agentDefinitions,
      qualityGates,
      recommendationMeta
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const selectedOutputDir = normalizeRelativePath(outputDir ?? DEFAULT_OUTPUT_DIR);
    const selectedDocsDir = normalizeRelativePath(docsDir ?? DEFAULT_DOCS_DIR);
    enforceManagedSubtree(selectedOutputDir, ".codex/mcp", "outputDir");
    enforceManagedSubtree(selectedDocsDir, "docs", "docsDir");
    const shouldGenerateDocs = generateDocs ?? true;
    const shouldIncludeMcp = includeVscodeMcp ?? false;
    const shouldDryRun = dryRun ?? true;
    const shouldAllowOverwrite = allowOverwrite ?? false;
    const projectProfile = await resolveProjectProfile({
      root,
      projectName,
      projectType,
      namespace
    });

    const files = {
      blueprintPath: joinPath(selectedOutputDir, "agent.blueprint.json"),
      agentsGuidePath: joinPath(selectedOutputDir, "AGENTS.generated.md"),
      bootstrapPromptPath: joinPath(selectedOutputDir, "prompts/task-bootstrap.txt"),
      contextDocPath: shouldGenerateDocs ? joinPath(selectedDocsDir, "project-context.md") : null,
      flowsDocPath: shouldGenerateDocs ? joinPath(selectedDocsDir, "agent-flows.md") : null,
      mcpConfigPath: shouldIncludeMcp ? ".vscode/mcp.json" : null
    };

    const blueprint = buildBlueprint(projectProfile, {
      agentDefinitions,
      qualityGates,
      recommendationMeta
    });
    const plannedWrites = [
      {
        path: files.blueprintPath,
        role: "blueprint",
        content: `${JSON.stringify(blueprint, null, 2)}\n`
      },
      {
        path: files.agentsGuidePath,
        role: "agents-guide",
        content: renderAgentsGuide(projectProfile, files)
      },
      {
        path: files.bootstrapPromptPath,
        role: "bootstrap-prompt",
        content: renderBootstrapPrompt(projectProfile, files)
      }
    ];

    if (shouldGenerateDocs) {
      plannedWrites.push({
        path: files.contextDocPath,
        role: "context-doc",
        content: renderContextDoc(projectProfile, files)
      });
      plannedWrites.push({
        path: files.flowsDocPath,
        role: "flows-doc",
        content: renderFlowsDoc(projectProfile, files)
      });
    }

    if (shouldIncludeMcp) {
      const mcpConfig = await resolveMcpConfigWrite({
        root,
        allowOverwrite: shouldAllowOverwrite
      });
      plannedWrites.push({
        path: files.mcpConfigPath,
        role: "mcp-config",
        content: mcpConfig
      });
    }

    const previews = [];
    for (const write of plannedWrites) {
      const preview = await previewFileWrite(write.path, write.content, {
        root,
        maxDiffLines
      });

      if (!shouldAllowOverwrite && preview.existsBefore && preview.changed && write.role !== "mcp-config") {
        throw new ToolError(`Refusing to overwrite managed agent artifact without allowOverwrite: ${write.path}`, {
          code: "AGENT_FILE_EXISTS",
          details: {
            path: write.path,
            role: write.role
          }
        });
      }

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
      const changes = plannedWrites.map((write) => {
        const preview = previews.find((item) => item.path === write.path);
        return {
          path: write.path,
          content: write.content,
          expectedOldHash: preview?.oldHash ?? undefined
        };
      });

      applyResult = await applyProjectPatch(changes, {
        root,
        reason: reason ?? "scaffold_project_agents"
      });
    }

    return scaffoldProjectAgentsOutputSchema.parse({
      dryRun: shouldDryRun,
      changed,
      project: projectProfile,
      files,
      fileSummary: summarizeFiles(previews),
      previews,
      applyResult
    });
  }
};

async function resolveProjectProfile(options) {
  const { root, projectName, projectType, namespace } = options;
  let packageJson = null;
  let manifest = null;

  if (await fileExists("package.json", root)) {
    packageJson = await readJsonFile("package.json", root);
  }

  const manifestPath = await resolveManifestPath(root);
  if (manifestPath) {
    manifest = await readJsonFile(manifestPath, root);
  }

  const detectedType = detectProjectType({
    manifest,
    packageJson
  });
  const selectedType = projectType ?? detectedType;
  const selectedName = projectName
    ?? manifest?.["sap.app"]?.id
    ?? packageJson?.name
    ?? path.basename(path.resolve(root));

  const selectedNamespace = namespace
    ?? manifest?.["sap.app"]?.id
    ?? (selectedType === "sapui5" ? packageJson?.name ?? null : null);

  return {
    name: selectedName,
    type: selectedType,
    namespace: selectedNamespace
  };
}

function buildBlueprint(projectProfile, options = {}) {
  const { agentDefinitions, qualityGates, recommendationMeta } = options;
  const { name, type, namespace } = projectProfile;
  const defaultRequiredTools = type === "sapui5"
    ? [
      "validate_ui5_code",
      "analyze_ui5_performance",
      "lint_javascript_code",
      "security_check_javascript"
    ]
    : [
      "lint_javascript_code",
      "security_check_javascript"
    ];

  const resolvedQualityGates = {
    requiredTools: unique(qualityGates?.requiredTools ?? defaultRequiredTools),
    requiredCommands: unique(qualityGates?.requiredCommands ?? ["npm run check"]),
    minimumReviewAgents: qualityGates?.minimumReviewAgents ?? 1
  };
  const resolvedAgents = agentDefinitions
    ? normalizeAgentDefinitions(agentDefinitions)
    : buildAgentsByProjectType(type, name);

  const blueprint = {
    schemaVersion: "1.0.0",
    project: {
      name,
      type,
      namespace
    },
    policies: {
      strategy: "mcp-first",
      requireDryRunByDefault: true,
      requirePatchPreview: true,
      requireRollbackPlan: true
    },
    qualityGates: resolvedQualityGates,
    agents: resolvedAgents
  };
  if (recommendationMeta) {
    blueprint.recommendation = {
      source: recommendationMeta.source,
      selectedRecommendationIds: recommendationMeta.selectedRecommendationIds ?? []
    };
  }
  return blueprint;
}

function buildAgentsByProjectType(projectType, projectName) {
  if (projectType === "sapui5") {
    return [
      {
        id: "architect",
        title: `${projectName} Architect`,
        goal: "Design safe UI5 implementation plans based on real workspace context.",
        allowedTools: unique([
          ...TOOL_GROUPS.project,
          "search_ui5_sdk",
          "search_mdn",
          "validate_project_agents"
        ])
      },
      {
        id: "implementer",
        title: `${projectName} Implementer`,
        goal: "Deliver scoped changes with deterministic patch preview and rollback path.",
        allowedTools: unique([
          ...TOOL_GROUPS.project,
          ...TOOL_GROUPS.ui5,
          ...TOOL_GROUPS.javascript,
          "scaffold_project_agents"
        ])
      },
      {
        id: "reviewer",
        title: `${projectName} Reviewer`,
        goal: "Detect regressions and enforce quality gates before completion.",
        allowedTools: unique([
          ...TOOL_GROUPS.project,
          "validate_ui5_code",
          "analyze_ui5_performance",
          "lint_javascript_code",
          "security_check_javascript",
          "validate_project_agents"
        ])
      }
    ];
  }

  return [
    {
      id: "architect",
      title: `${projectName} Architect`,
      goal: "Plan implementation scope from concrete project signals.",
      allowedTools: unique([
        ...TOOL_GROUPS.project,
        ...TOOL_GROUPS.documentation,
        "validate_project_agents"
      ])
    },
    {
      id: "implementer",
      title: `${projectName} Implementer`,
      goal: "Implement isolated code changes with preview/apply patch workflow.",
      allowedTools: unique([
        ...TOOL_GROUPS.project,
        ...TOOL_GROUPS.javascript,
        "scaffold_project_agents"
      ])
    },
    {
      id: "reviewer",
      title: `${projectName} Reviewer`,
      goal: "Run lint/security validation and verify quality gates.",
      allowedTools: unique([
        ...TOOL_GROUPS.project,
        "lint_javascript_code",
        "security_check_javascript",
        "validate_project_agents"
      ])
    }
  ];
}

function renderAgentsGuide(projectProfile, files) {
  const { name, type } = projectProfile;
  const qualityChecks = type === "sapui5"
    ? [
      "validate_ui5_code on modified source",
      "analyze_ui5_performance on impacted UI module",
      "lint_javascript_code + security_check_javascript"
    ]
    : [
      "lint_javascript_code on modified source",
      "security_check_javascript on risky flows"
    ];

  return [
    "# AGENTS.generated.md",
    "",
    `Autogenerated multi-agent workflow for project: ${name}.`,
    "",
    "## Mandatory operating mode",
    "",
    "- MCP-first: inspect context with MCP tools before proposing or writing code.",
    "- Default dry-run for write-capable tools; apply only after diff review.",
    "- Every applied patch must have rollback capability.",
    "",
    "## Execution protocol",
    "",
    "1. Discovery",
    "- Run analyze/search tools to locate real impact and constraints.",
    "2. Plan",
    "- Scope minimal change-set and expected validation outcomes.",
    "3. Execute",
    "- Preview writes, apply patch, and track changed paths.",
    "4. Validate",
    ...qualityChecks.map((item) => `- ${item}`),
    "- Execute npm run check before closing task.",
    "5. Review",
    "- Confirm no unresolved high-severity findings remain.",
    "",
    "## Generated artifacts",
    "",
    `- Blueprint: ${files.blueprintPath}`,
    `- Bootstrap prompt: ${files.bootstrapPromptPath}`,
    "",
    "## Guardrails",
    "",
    "- Do not skip validation gates even for small edits.",
    "- Do not bypass patch preview for multi-file changes.",
    "- Use rollback_project_patch when post-apply checks fail.",
    ""
  ].join("\n");
}

function renderBootstrapPrompt(projectProfile, files) {
  const { name, type } = projectProfile;
  const domainLine = type === "sapui5"
    ? "Prioritize UI5 tools for generation, i18n, validation, and performance."
    : "Prioritize JavaScript quality and security tools for each modified module.";

  return [
    `Project: ${name}`,
    `Project type: ${type}`,
    `Blueprint: ${files.blueprintPath}`,
    "",
    "Instruction:",
    "Use MCP-first workflow.",
    "Start with discovery tools, then plan minimal edits.",
    "Before applying writes, generate previews.",
    "Apply via apply_project_patch, validate with required tools, and finish with npm run check.",
    domainLine,
    ""
  ].join("\n");
}

function renderContextDoc(projectProfile, files) {
  return [
    "# Contexto del Proyecto",
    "",
    `Proyecto: ${projectProfile.name}`,
    `Tipo: ${projectProfile.type}`,
    `Namespace: ${projectProfile.namespace ?? "n/a"}`,
    "",
    "## Artefactos MCP",
    "",
    `- Blueprint: ${files.blueprintPath}`,
    `- Guia de agentes: ${files.agentsGuidePath}`,
    `- Prompt bootstrap: ${files.bootstrapPromptPath}`,
    "",
    "## Reglas operativas",
    "",
    "- Aplicar estrategia MCP-first.",
    "- Ejecutar dry-run por defecto para cambios de escritura.",
    "- Mantener quality gates y validacion estricta al cerrar tareas.",
    ""
  ].join("\n");
}

function renderFlowsDoc(projectProfile, files) {
  return [
    "# Flujos de Agentes",
    "",
    `Proyecto: ${projectProfile.name}`,
    "",
    "## Flujo recomendado",
    "",
    "1. Analisis inicial del proyecto.",
    "2. Planificacion del cambio minimo viable.",
    "3. Preview y aplicacion de patch.",
    "4. Validacion de calidad y seguridad.",
    "5. Cierre con rollback disponible.",
    "",
    "## Referencias",
    "",
    `- Blueprint: ${files.blueprintPath}`,
    `- Guia: ${files.agentsGuidePath}`,
    ""
  ].join("\n");
}

async function resolveMcpConfigWrite(options) {
  const { root, allowOverwrite } = options;
  const targetPath = ".vscode/mcp.json";
  if (!(await fileExists(targetPath, root))) {
    return `${JSON.stringify({
      mcpServers: {
        sapui5: SAPUI5_MCP_ENTRY
      }
    }, null, 2)}\n`;
  }

  const currentText = await readTextFile(targetPath, root);
  let parsed;
  try {
    parsed = JSON.parse(currentText);
  } catch (error) {
    throw new ToolError(`Invalid JSON in ${targetPath}: ${error.message}`, {
      code: "INVALID_MCP_CONFIG"
    });
  }

  const currentEntry = parsed?.mcpServers?.sapui5;
  if (currentEntry && !isSameMcpEntry(currentEntry, SAPUI5_MCP_ENTRY) && !allowOverwrite) {
    throw new ToolError("Existing sapui5 MCP server entry differs from expected configuration.", {
      code: "MCP_SERVER_CONFLICT",
      details: {
        path: targetPath
      }
    });
  }

  if (currentEntry && isSameMcpEntry(currentEntry, SAPUI5_MCP_ENTRY)) {
    return currentText;
  }

  const next = {
    ...ensureObject(parsed),
    mcpServers: {
      ...ensureObject(parsed?.mcpServers),
      sapui5: SAPUI5_MCP_ENTRY
    }
  };

  return `${JSON.stringify(next, null, 2)}\n`;
}

async function resolveManifestPath(root) {
  if (await fileExists("webapp/manifest.json", root)) {
    return "webapp/manifest.json";
  }
  if (await fileExists("manifest.json", root)) {
    return "manifest.json";
  }
  return null;
}

function detectProjectType(options) {
  const { manifest, packageJson } = options;
  if (manifest?.["sap.ui5"] || manifest?.["sap.app"]) {
    return "sapui5";
  }
  if (packageJson) {
    return "node";
  }
  return "generic";
}

function isSameMcpEntry(a, b) {
  if (!a || typeof a !== "object") {
    return false;
  }
  if (a.command !== b.command) {
    return false;
  }
  if (!Array.isArray(a.args) || a.args.length !== b.args.length) {
    return false;
  }
  return a.args.every((item, index) => item === b.args[index]);
}

function summarizeFiles(previews) {
  const summary = {
    created: 0,
    updated: 0,
    unchanged: 0
  };

  for (const item of previews) {
    if (!item.changed) {
      summary.unchanged += 1;
      continue;
    }
    if (item.existsBefore) {
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

function joinPath(...segments) {
  return segments
    .filter(Boolean)
    .join("/")
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/");
}

function unique(values) {
  return Array.from(new Set(values));
}

function normalizeAgentDefinitions(agentDefinitions) {
  const ids = new Set();
  const normalized = [];
  for (const definition of agentDefinitions) {
    const id = definition.id.trim();
    if (ids.has(id)) {
      throw new ToolError(`Duplicate custom agent id: ${id}`, {
        code: "DUPLICATE_AGENT_ID"
      });
    }
    ids.add(id);
    normalized.push({
      id,
      title: definition.title.trim(),
      goal: definition.goal.trim(),
      allowedTools: unique(definition.allowedTools.map((tool) => tool.trim()).filter(Boolean))
    });
  }
  return normalized;
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
