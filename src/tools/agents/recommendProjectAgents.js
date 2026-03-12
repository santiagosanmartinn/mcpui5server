import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { fileExists, readJsonFile } from "../../utils/fileSystem.js";
import { DEFAULT_AGENT_POLICY_PATH, loadAgentPolicy, normalizePackSlugSet } from "../../utils/agentPolicy.js";
import { analyzeUi5ProjectTool } from "../project/analyzeProject.js";
import { rankAgentPacksTool } from "./rankAgentPacks.js";
import { prepareLegacyProjectForAiTool } from "./prepareLegacyProjectForAi.js";

const PROJECT_TYPES = ["sapui5", "node", "generic"];
const DEFAULT_SOURCE_DIR = "webapp";
const DEFAULT_MAX_FILES = 1200;
const DEFAULT_MAX_RECOMMENDATIONS = 8;
const DEFAULT_PACK_CATALOG_PATH = ".codex/mcp/packs/catalog.json";
const IGNORED_DIRS = new Set(["node_modules", ".git", ".mcp-backups", ".mcp-cache", "dist", "coverage"]);

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  maxFiles: z.number().int().min(50).max(5000).optional(),
  maxRecommendations: z.number().int().min(2).max(20).optional(),
  includePackCatalog: z.boolean().optional(),
  packCatalogPath: z.string().min(1).optional(),
  includePackFeedbackRanking: z.boolean().optional(),
  feedbackMetricsPath: z.string().min(1).optional(),
  policyPath: z.string().min(1).optional(),
  respectPolicy: z.boolean().optional(),
  autoPrepareProjectContext: z.boolean().optional(),
  autoPrepareApply: z.boolean().optional(),
  autoPrepareRefreshBaseline: z.boolean().optional(),
  autoPrepareRefreshContextIndex: z.boolean().optional(),
  autoPrepareAskForMissingContext: z.boolean().optional(),
  autoPrepareRunEnsure: z.boolean().optional()
}).strict();

const recommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  score: z.number().min(0).max(1),
  source: z.enum(["heuristic", "pack"]),
  rationale: z.string(),
  agent: z.object({
    id: z.string(),
    title: z.string(),
    goal: z.string(),
    allowedTools: z.array(z.string())
  }),
  pack: z.object({
    name: z.string(),
    slug: z.string(),
    version: z.string(),
    fingerprint: z.string()
  }).nullable()
});

const outputSchema = z.object({
  policy: z.object({
    path: z.string(),
    loaded: z.boolean(),
    enforcedSections: z.array(z.enum(["ranking", "recommendation"]))
  }),
  project: z.object({
    name: z.string(),
    type: z.enum(PROJECT_TYPES),
    namespace: z.string().nullable()
  }),
  projectContextSync: z.object({
    executed: z.boolean(),
    readyForAutopilot: z.boolean(),
    needsUserInput: z.boolean(),
    missingContext: z.array(z.string()),
    nextActions: z.array(z.string()),
    error: z.string().nullable()
  }),
  signals: z.object({
    sourceDir: z.string(),
    scannedFiles: z.number().int().nonnegative(),
    jsFiles: z.number().int().nonnegative(),
    xmlFiles: z.number().int().nonnegative(),
    controllerFiles: z.number().int().nonnegative(),
    viewFiles: z.number().int().nonnegative(),
    fragmentFiles: z.number().int().nonnegative(),
    hasManifest: z.boolean(),
    hasI18n: z.boolean(),
    hasBlueprint: z.boolean(),
    routingDetected: z.boolean()
  }),
  recommendations: z.array(recommendationSchema),
  suggestedMaterializationArgs: z.object({
    agentDefinitions: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        goal: z.string(),
        allowedTools: z.array(z.string())
      })
    ),
    qualityGates: z.object({
      requiredTools: z.array(z.string()),
      requiredCommands: z.array(z.string()),
      minimumReviewAgents: z.number().int().positive()
    }),
    recommendationMeta: z.object({
      source: z.string(),
      selectedRecommendationIds: z.array(z.string())
    })
  }),
  packsMatched: z.number().int().nonnegative()
});

export const recommendProjectAgentsTool = {
  name: "recommend_project_agents",
  description: "Analyze project signals and recommend agent definitions with materialization-ready arguments.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      maxFiles,
      maxRecommendations,
      includePackCatalog,
      packCatalogPath,
      includePackFeedbackRanking,
      feedbackMetricsPath,
      policyPath,
      respectPolicy,
      autoPrepareProjectContext,
      autoPrepareApply,
      autoPrepareRefreshBaseline,
      autoPrepareRefreshContextIndex,
      autoPrepareAskForMissingContext,
      autoPrepareRunEnsure
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const selectedSourceDir = normalizeRelativePath(sourceDir ?? DEFAULT_SOURCE_DIR);
    const shouldAutoPrepareProjectContext = autoPrepareProjectContext ?? true;
    const shouldAutoPrepareApply = autoPrepareApply ?? true;
    let projectContextSync = {
      executed: false,
      readyForAutopilot: false,
      needsUserInput: false,
      missingContext: [],
      nextActions: [],
      error: null
    };

    if (shouldAutoPrepareProjectContext) {
      try {
        const preparation = await prepareLegacyProjectForAiTool.handler(
          {
            sourceDir: selectedSourceDir,
            autoApply: shouldAutoPrepareApply,
            runEnsureProjectMcp: autoPrepareRunEnsure,
            askForMissingContext: autoPrepareAskForMissingContext,
            refreshBaseline: autoPrepareRefreshBaseline,
            refreshContextIndex: autoPrepareRefreshContextIndex,
            reason: "recommend_project_agents:auto-prepare"
          },
          { context }
        );
        projectContextSync = {
          executed: true,
          readyForAutopilot: preparation.readyForAutopilot,
          needsUserInput: preparation.intake.needsUserInput,
          missingContext: preparation.intake.missingContext,
          nextActions: preparation.nextActions,
          error: null
        };
      } catch (error) {
        projectContextSync = {
          executed: false,
          readyForAutopilot: false,
          needsUserInput: false,
          missingContext: [],
          nextActions: ["Run prepare_legacy_project_for_ai to generate intake, baseline and context index artifacts."],
          error: error?.message ?? String(error)
        };
      }
    }

    const selectedPolicyPath = normalizeRelativePath(policyPath ?? DEFAULT_AGENT_POLICY_PATH);
    const shouldRespectPolicy = respectPolicy ?? true;
    const policyResolution = shouldRespectPolicy
      ? await loadAgentPolicy({ root, policyPath: selectedPolicyPath })
      : {
        path: selectedPolicyPath,
        loaded: false,
        enabled: false,
        policy: null
      };
    const recommendationPolicy = policyResolution.loaded
      && policyResolution.enabled
      && (policyResolution.policy?.recommendation?.enabled ?? true)
      ? (policyResolution.policy?.recommendation ?? {})
      : null;

    const selectedMaxFiles = maxFiles ?? DEFAULT_MAX_FILES;
    const selectedMaxRecommendations = recommendationPolicy?.maxRecommendations ?? maxRecommendations ?? DEFAULT_MAX_RECOMMENDATIONS;
    const useCatalog = recommendationPolicy?.includePackCatalog ?? includePackCatalog ?? true;
    const useFeedbackRanking = recommendationPolicy?.includePackFeedbackRanking ?? includePackFeedbackRanking ?? true;
    const selectedCatalogPath = normalizeRelativePath(packCatalogPath ?? DEFAULT_PACK_CATALOG_PATH);
    const selectedMetricsPath = normalizeRelativePath(feedbackMetricsPath ?? ".codex/mcp/feedback/metrics.json");
    if (useCatalog) {
      enforceManagedSubtree(selectedCatalogPath, ".codex/mcp", "packCatalogPath");
      if (useFeedbackRanking) {
        enforceManagedSubtree(selectedMetricsPath, ".codex/mcp", "feedbackMetricsPath");
      }
    }

    const project = await detectProjectProfile(root);
    const scan = await scanSourceFiles({
      root,
      sourceDir: selectedSourceDir,
      maxFiles: selectedMaxFiles
    });
    const hasManifest = await fileExists("webapp/manifest.json", root) || await fileExists("manifest.json", root);
    const hasI18n = await fileExists("webapp/i18n/i18n.properties", root);
    const hasBlueprint = await fileExists(".codex/mcp/agents/agent.blueprint.json", root);

    const signals = {
      sourceDir: selectedSourceDir,
      scannedFiles: scan.total,
      jsFiles: scan.jsFiles,
      xmlFiles: scan.xmlFiles,
      controllerFiles: scan.controllerFiles,
      viewFiles: scan.viewFiles,
      fragmentFiles: scan.fragmentFiles,
      hasManifest,
      hasI18n,
      hasBlueprint,
      routingDetected: project.routingDetected
    };

    let recommendations = buildHeuristicRecommendations(project, signals);
    let packsMatched = 0;
    if (useCatalog) {
      const catalogRecommendations = await buildCatalogRecommendations({
        context,
        catalogPath: selectedCatalogPath,
        metricsPath: selectedMetricsPath,
        projectType: project.type,
        includeFeedbackRanking: useFeedbackRanking,
        policyPath: policyResolution.path,
        respectPolicy: shouldRespectPolicy,
        recommendationPolicy
      });
      packsMatched = catalogRecommendations.length;
      recommendations = recommendations.concat(catalogRecommendations);
    }

    const selectedRecommendations = normalizeRecommendations(
      applyRecommendationFilters(recommendations, recommendationPolicy)
    )
      .slice(0, selectedMaxRecommendations);
    const agentDefinitions = selectedRecommendations.map((item) => ({
      id: item.agent.id,
      title: item.agent.title,
      goal: item.agent.goal,
      allowedTools: item.agent.allowedTools
    }));
    const requiredTools = project.type === "sapui5"
      ? ["validate_ui5_code", "analyze_ui5_performance", "lint_javascript_code", "security_check_javascript"]
      : ["lint_javascript_code", "security_check_javascript"];

    return outputSchema.parse({
      policy: {
        path: policyResolution.path,
        loaded: policyResolution.loaded,
        enforcedSections: [
          ...(recommendationPolicy ? ["recommendation"] : []),
          ...(policyResolution.loaded && policyResolution.enabled && (policyResolution.policy?.ranking?.enabled ?? true) ? ["ranking"] : [])
        ]
      },
      project: {
        name: project.name,
        type: project.type,
        namespace: project.namespace
      },
      projectContextSync,
      signals,
      recommendations: selectedRecommendations,
      suggestedMaterializationArgs: {
        agentDefinitions,
        qualityGates: {
          requiredTools,
          requiredCommands: ["npm run check"],
          minimumReviewAgents: 1
        },
        recommendationMeta: {
          source: useCatalog ? "heuristic+pack-catalog" : "heuristic",
          selectedRecommendationIds: selectedRecommendations.map((item) => item.id)
        }
      },
      packsMatched
    });
  }
};

async function detectProjectProfile(root) {
  let name = path.basename(path.resolve(root));
  let type = "generic";
  let namespace = null;
  let routingDetected = false;
  try {
    const analysis = await analyzeUi5ProjectTool.handler({}, { context: { rootDir: root } });
    if (analysis.detectedFiles.manifestJson || analysis.detectedFiles.ui5Yaml) {
      type = "sapui5";
      name = analysis.namespace ?? name;
      namespace = analysis.namespace ?? null;
      routingDetected = analysis.routing.hasRouting;
      return { name, type, namespace, routingDetected };
    }
  } catch {
    // Fall through to generic detection.
  }

  if (await fileExists("package.json", root)) {
    type = "node";
    try {
      const packageJson = await readJsonFile("package.json", root);
      name = packageJson?.name ?? name;
    } catch {
      // Keep fallback name.
    }
  }

  return {
    name,
    type,
    namespace,
    routingDetected
  };
}

async function scanSourceFiles(options) {
  const { root, sourceDir, maxFiles } = options;
  const absoluteSource = path.resolve(root, sourceDir);
  if (!(await existsDir(absoluteSource))) {
    return {
      total: 0,
      jsFiles: 0,
      xmlFiles: 0,
      controllerFiles: 0,
      viewFiles: 0,
      fragmentFiles: 0
    };
  }

  const counters = {
    total: 0,
    jsFiles: 0,
    xmlFiles: 0,
    controllerFiles: 0,
    viewFiles: 0,
    fragmentFiles: 0
  };
  await walk(absoluteSource);
  return counters;

  async function walk(currentDir) {
    if (counters.total >= maxFiles) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (counters.total >= maxFiles) {
        break;
      }
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      counters.total += 1;
      const extension = path.extname(entry.name).toLowerCase();
      if (extension === ".js") {
        counters.jsFiles += 1;
      }
      if (extension === ".xml") {
        counters.xmlFiles += 1;
      }
      if (entry.name.endsWith(".controller.js")) {
        counters.controllerFiles += 1;
      }
      if (entry.name.endsWith(".view.xml")) {
        counters.viewFiles += 1;
      }
      if (entry.name.endsWith(".fragment.xml")) {
        counters.fragmentFiles += 1;
      }
    }
  }
}

function buildHeuristicRecommendations(project, signals) {
  if (project.type === "sapui5") {
    return [
      createRecommendation({
        id: "ui5-architect",
        title: "UI5 Architecture Agent",
        priority: "high",
        score: 0.98,
        rationale: "UI5 project detected with structured routing/config signals.",
        agent: {
          id: "architect",
          title: `${project.name} Architect`,
          goal: "Design safe UI5 implementation plans with dependency and routing awareness.",
          allowedTools: unique([
            "analyze_ui5_project",
            "search_project_files",
            "analyze_current_file",
            "read_project_file",
            "search_ui5_sdk",
            "search_mdn",
            "mcp_health_report",
            "refresh_project_context_docs",
            "rank_agent_packs",
            "promote_agent_pack",
            "audit_project_mcp_state",
            "upgrade_project_mcp",
            "ensure_project_mcp_current",
            "collect_legacy_project_intake",
            "analyze_legacy_project_baseline",
            "build_ai_context_index",
            "prepare_legacy_project_for_ai",
            "record_agent_execution_feedback",
            "validate_project_agents",
            "recommend_project_agents",
            "validate_ui5_version_compatibility",
            "analyze_odata_metadata",
            "validate_ui5_odata_usage",
            "scaffold_ui5_odata_feature"
          ])
        }
      }),
      createRecommendation({
        id: "ui5-feature-implementer",
        title: "UI5 Feature Implementer",
        priority: "high",
        score: clamp(0.92 + (signals.controllerFiles > 2 ? 0.03 : 0), 0, 1),
        rationale: "Project has UI5 source files suitable for scaffold-driven feature delivery.",
        agent: {
          id: "implementer",
          title: `${project.name} Implementer`,
          goal: "Generate and evolve UI5 features with preview/apply patch safety.",
          allowedTools: unique([
            "generate_ui5_feature",
            "generate_ui5_controller",
            "generate_ui5_fragment",
            "generate_ui5_formatter",
            "generate_ui5_view_logic",
            "manage_ui5_i18n",
            "validate_ui5_version_compatibility",
            "analyze_odata_metadata",
            "validate_ui5_odata_usage",
            "scaffold_ui5_odata_feature",
            "security_check_ui5_app",
            "run_project_quality_gate",
            "mcp_health_report",
            "sync_manifest_json",
            "write_project_file_preview",
            "apply_project_patch",
            "rollback_project_patch",
            "refresh_project_context_docs",
            "collect_legacy_project_intake",
            "analyze_legacy_project_baseline",
            "build_ai_context_index",
            "prepare_legacy_project_for_ai",
            "materialize_recommended_agents",
            "save_agent_pack",
            "record_agent_execution_feedback"
          ])
        }
      }),
      createRecommendation({
        id: "ui5-quality-reviewer",
        title: "UI5 Quality Reviewer",
        priority: "high",
        score: clamp(0.9 + (signals.jsFiles > 20 || signals.xmlFiles > 10 ? 0.05 : 0), 0, 1),
        rationale: "UI5 codebase size suggests dedicated validation and performance review role.",
        agent: {
          id: "reviewer",
          title: `${project.name} Reviewer`,
          goal: "Enforce quality gates, security, and performance checks before merge.",
          allowedTools: unique([
            "validate_ui5_code",
            "analyze_ui5_performance",
            "validate_ui5_version_compatibility",
            "analyze_odata_metadata",
            "validate_ui5_odata_usage",
            "scaffold_ui5_odata_feature",
            "security_check_ui5_app",
            "run_project_quality_gate",
            "mcp_health_report",
            "lint_javascript_code",
            "security_check_javascript",
            "refresh_project_context_docs",
            "rank_agent_packs",
            "audit_project_mcp_state",
            "upgrade_project_mcp",
            "ensure_project_mcp_current",
            "collect_legacy_project_intake",
            "analyze_legacy_project_baseline",
            "build_ai_context_index",
            "prepare_legacy_project_for_ai",
            "record_agent_execution_feedback",
            "read_project_file",
            "search_project_files",
            "validate_project_agents"
          ])
        }
      }),
      createRecommendation({
        id: "ui5-i18n-curator",
        title: "I18n Curator",
        priority: signals.hasI18n ? "medium" : "low",
        score: signals.hasI18n ? 0.8 : 0.55,
        rationale: signals.hasI18n
          ? "i18n bundle detected; maintain localization quality proactively."
          : "No i18n bundle detected yet, but localization automation is recommended.",
        agent: {
          id: "i18nCurator",
          title: `${project.name} I18n Curator`,
          goal: "Keep i18n keys complete, consistent, and free of unused literals.",
          allowedTools: unique([
            "manage_ui5_i18n",
            "search_project_files",
            "read_project_file",
            "write_project_file_preview",
            "apply_project_patch"
          ])
        }
      })
    ];
  }

  return [
    createRecommendation({
      id: "js-architect",
      title: "JavaScript Architect",
      priority: "high",
      score: 0.9,
      rationale: "Non-UI5 project detected; architecture role should focus on JS delivery flow.",
      agent: {
        id: "architect",
        title: `${project.name} Architect`,
        goal: "Plan incremental implementation paths and maintain project consistency.",
        allowedTools: unique([
          "search_project_files",
          "analyze_current_file",
          "read_project_file",
          "search_mdn",
          "mcp_health_report",
          "refresh_project_context_docs",
          "rank_agent_packs",
          "promote_agent_pack",
          "audit_project_mcp_state",
          "upgrade_project_mcp",
          "ensure_project_mcp_current",
          "collect_legacy_project_intake",
          "analyze_legacy_project_baseline",
          "build_ai_context_index",
          "prepare_legacy_project_for_ai",
          "record_agent_execution_feedback",
          "recommend_project_agents",
          "validate_project_agents",
          "run_project_quality_gate",
          "mcp_health_report"
        ])
      }
    }),
    createRecommendation({
      id: "js-implementer",
      title: "JavaScript Implementer",
      priority: "high",
      score: 0.88,
      rationale: "Source analysis indicates JavaScript-centric implementation workflow.",
      agent: {
        id: "implementer",
        title: `${project.name} Implementer`,
        goal: "Implement scoped changes with safe preview/apply patch flow.",
        allowedTools: unique([
          "generate_javascript_function",
          "refactor_javascript_code",
          "lint_javascript_code",
          "security_check_ui5_app",
          "write_project_file_preview",
          "apply_project_patch",
          "rollback_project_patch",
          "refresh_project_context_docs",
          "collect_legacy_project_intake",
          "analyze_legacy_project_baseline",
          "build_ai_context_index",
          "prepare_legacy_project_for_ai",
          "materialize_recommended_agents",
          "save_agent_pack",
          "record_agent_execution_feedback"
        ])
      }
    }),
    createRecommendation({
      id: "js-reviewer",
      title: "JavaScript Reviewer",
      priority: "high",
      score: 0.9,
      rationale: "Quality and security checks should be isolated as a dedicated reviewer role.",
      agent: {
        id: "reviewer",
        title: `${project.name} Reviewer`,
        goal: "Validate lint and security constraints before task closure.",
        allowedTools: unique([
          "lint_javascript_code",
          "security_check_javascript",
          "refresh_project_context_docs",
          "rank_agent_packs",
          "audit_project_mcp_state",
          "upgrade_project_mcp",
          "ensure_project_mcp_current",
          "collect_legacy_project_intake",
          "analyze_legacy_project_baseline",
          "build_ai_context_index",
          "prepare_legacy_project_for_ai",
          "record_agent_execution_feedback",
          "search_project_files",
          "read_project_file",
          "validate_project_agents"
        ])
      }
    })
  ];
}

async function buildCatalogRecommendations(options) {
  const {
    context,
    catalogPath,
    metricsPath,
    projectType,
    includeFeedbackRanking,
    policyPath,
    respectPolicy,
    recommendationPolicy
  } = options;

  const ranked = await rankAgentPacksTool.handler(
    {
      packCatalogPath: catalogPath,
      metricsPath,
      policyPath,
      respectPolicy,
      projectType,
      minExecutions: includeFeedbackRanking ? 1 : 1000,
      includeUnscored: true,
      includeDeprecated: false,
      maxResults: 3
    },
    { context }
  );

  if (!ranked.exists.catalog) {
    return [];
  }

  const allowedLifecycleSet = Array.isArray(recommendationPolicy?.allowedLifecycle)
    ? new Set(recommendationPolicy.allowedLifecycle)
    : null;
  const blockedPackSlugs = normalizePackSlugSet(recommendationPolicy?.blockedPackSlugs);

  return ranked.rankedPacks
    .filter((pack) => {
      if (blockedPackSlugs.has(String(pack.slug ?? "").trim().toLowerCase())) {
        return false;
      }
      if (allowedLifecycleSet && !allowedLifecycleSet.has(pack.lifecycleStatus)) {
        return false;
      }
      return true;
    })
    .map((pack, index) => createRecommendation({
      id: `pack-${pack.slug || `saved-${index + 1}`}`,
      title: `Reuse Pack: ${pack.name || pack.slug || "saved pack"}`,
      priority: "medium",
      score: clamp(pack.score + lifecycleBoost(pack.lifecycleStatus), 0, 1),
      source: "pack",
      rationale: `Saved pack compatible with detected project type (${pack.status}, lifecycle=${pack.lifecycleStatus}). ${pack.rationale}`,
      agent: {
        id: `packAdvisor${index + 1}`,
        title: `Pack Advisor ${index + 1}`,
        goal: `Apply and adapt saved pack ${pack.name || pack.slug || ""} to current project.`,
        allowedTools: unique([
          "list_agent_packs",
          "rank_agent_packs",
          "promote_agent_pack",
          "audit_project_mcp_state",
          "upgrade_project_mcp",
          "ensure_project_mcp_current",
          "prepare_legacy_project_for_ai",
          "apply_agent_pack",
          "validate_project_agents",
          "save_agent_pack",
          "record_agent_execution_feedback"
        ])
      },
      pack: {
        name: pack.name || "Unnamed pack",
        slug: pack.slug || `saved-${index + 1}`,
        version: pack.version || "1.0.0",
        fingerprint: pack.fingerprint || "unknown"
      }
    }));
}

function normalizeRecommendations(items) {
  const seen = new Set();
  return items
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
}

function applyRecommendationFilters(recommendations, recommendationPolicy) {
  if (!recommendationPolicy) {
    return recommendations;
  }

  const blockedRecommendationIds = new Set(recommendationPolicy.blockedRecommendationIds ?? []);
  const blockedPackSlugs = normalizePackSlugSet(recommendationPolicy.blockedPackSlugs);

  return recommendations.filter((item) => {
    if (blockedRecommendationIds.has(item.id)) {
      return false;
    }
    if (item.source === "pack") {
      const packSlug = String(item.pack?.slug ?? "").trim().toLowerCase();
      if (blockedPackSlugs.has(packSlug)) {
        return false;
      }
    }
    return true;
  });
}

function createRecommendation(input) {
  return {
    id: input.id,
    title: input.title,
    priority: input.priority,
    score: Number(input.score.toFixed(3)),
    source: input.source ?? "heuristic",
    rationale: input.rationale,
    agent: input.agent,
    pack: input.pack ?? null
  };
}

function unique(values) {
  return Array.from(new Set(values));
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lifecycleBoost(status) {
  if (status === "recommended") {
    return 0.06;
  }
  if (status === "candidate") {
    return 0.02;
  }
  if (status === "deprecated") {
    return -0.25;
  }
  return 0;
}

async function existsDir(absolutePath) {
  try {
    const stats = await fs.stat(absolutePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
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
