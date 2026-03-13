import { z } from "zod";
import { scaffoldProjectAgentsOutputSchema, scaffoldProjectAgentsTool } from "./scaffoldProjectAgents.js";
import { recommendProjectAgentsTool } from "./recommendProjectAgents.js";
import { ensureProjectMcpCurrentTool } from "./ensureProjectMcpCurrent.js";
import { prepareLegacyProjectForAiTool } from "./prepareLegacyProjectForAi.js";
import { DEFAULT_AGENT_POLICY_PATH, loadAgentPolicy } from "../../utils/agentPolicy.js";

const recommendationInputSchema = z.object({
  id: z.string().min(1),
  score: z.number().min(0).max(1),
  agent: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    goal: z.string().min(1),
    allowedTools: z.array(z.string().min(1)).min(1)
  }).strict()
}).strict();

const inputSchema = z.object({
  recommendations: z.array(recommendationInputSchema).optional(),
  sourceDir: z.string().min(1).optional(),
  maxFiles: z.number().int().min(50).max(5000).optional(),
  maxRecommendations: z.number().int().min(2).max(20).optional(),
  includePackCatalog: z.boolean().optional(),
  packCatalogPath: z.string().min(1).optional(),
  includeSkillCatalog: z.boolean().optional(),
  skillCatalogPath: z.string().min(1).optional(),
  includeSkillFeedbackRanking: z.boolean().optional(),
  skillMetricsPath: z.string().min(1).optional(),
  minSkillExecutions: z.number().int().min(0).max(1000).optional(),
  maxSkillSignals: z.number().int().min(1).max(20).optional(),
  requiredSkillTags: z.array(z.string().min(1)).max(20).optional(),
  skillSignalMode: z.enum(["off", "prefer", "strict"]).optional(),
  skillSignalMinConfidence: z.number().min(0).max(1).optional(),
  skillSignalMinRoleBoost: z.number().min(0).max(0.2).optional(),
  policyPath: z.string().min(1).optional(),
  respectPolicy: z.boolean().optional(),
  autoEnsureProjectMcp: z.boolean().optional(),
  autoEnsureApply: z.boolean().optional(),
  autoPrepareProjectContext: z.boolean().optional(),
  autoPrepareApply: z.boolean().optional(),
  autoPrepareRefreshBaseline: z.boolean().optional(),
  autoPrepareRefreshContextIndex: z.boolean().optional(),
  autoPrepareAskForMissingContext: z.boolean().optional(),
  projectName: z.string().min(1).optional(),
  projectType: z.enum(["sapui5", "node", "generic"]).optional(),
  namespace: z.string().min(1).optional(),
  outputDir: z.string().min(1).optional(),
  includeVscodeMcp: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  allowOverwrite: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional()
}).strict();

const outputSchema = z.object({
  source: z.enum(["input", "auto-recommend"]),
  policy: z.object({
    path: z.string(),
    loaded: z.boolean(),
    enforcedSections: z.array(z.enum(["recommendation"]))
  }),
  projectMcpSync: z.object({
    executed: z.boolean(),
    actionTaken: z.enum(["none", "upgrade-dry-run", "upgrade-applied"]).nullable(),
    statusBefore: z.enum(["up-to-date", "needs-upgrade", "not-initialized"]).nullable(),
    statusAfter: z.enum(["up-to-date", "needs-upgrade", "not-initialized"]).nullable()
  }),
  projectContextSync: z.object({
    executed: z.boolean(),
    readyForAutopilot: z.boolean(),
    needsUserInput: z.boolean(),
    missingContext: z.array(z.string()),
    nextActions: z.array(z.string()),
    error: z.string().nullable()
  }),
  usedRecommendations: z.number().int().positive(),
  droppedRecommendations: z.array(z.string()),
  selectedRecommendationIds: z.array(z.string()),
  selectionPolicy: z.object({
    source: z.enum(["none", "auto-recommend"]),
    mode: z.enum(["off", "prefer", "strict"]),
    signalsReady: z.boolean(),
    strictApplied: z.boolean(),
    autoPromotedToStrict: z.boolean(),
    promotionReason: z.string().nullable(),
    minConfidence: z.number().min(0).max(1),
    minRoleBoost: z.number().min(0).max(0.2),
    filteredRecommendationIds: z.array(z.string()),
    reweightedRecommendationIds: z.array(z.string())
  }),
  scaffoldResult: scaffoldProjectAgentsOutputSchema
});

export const materializeRecommendedAgentsTool = {
  name: "materialize_recommended_agents",
  description: "Materialize recommended agents into project artifacts by generating blueprint/guide/prompt and optional MCP config.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const selectedPolicyPath = normalizeRelativePath(parsed.policyPath ?? DEFAULT_AGENT_POLICY_PATH);
    const shouldRespectPolicy = parsed.respectPolicy ?? true;
    const policyResolution = shouldRespectPolicy
      ? await loadAgentPolicy({ root: context.rootDir, policyPath: selectedPolicyPath })
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

    const shouldAutoEnsureProjectMcp = parsed.autoEnsureProjectMcp ?? true;
    const shouldAutoEnsureApply = parsed.autoEnsureApply ?? (parsed.dryRun === false);
    const shouldAutoPrepareProjectContext = parsed.autoPrepareProjectContext ?? true;
    const shouldAutoPrepareApply = parsed.autoPrepareApply ?? (parsed.dryRun === false);
    let projectMcpSync = {
      executed: false,
      actionTaken: null,
      statusBefore: null,
      statusAfter: null
    };
    let projectContextSync = {
      executed: false,
      readyForAutopilot: false,
      needsUserInput: false,
      missingContext: [],
      nextActions: [],
      error: null
    };

    if (shouldAutoEnsureProjectMcp) {
      const ensureResult = await ensureProjectMcpCurrentTool.handler(
        {
          autoApply: shouldAutoEnsureApply,
          allowOverwrite: parsed.allowOverwrite,
          includeVscodeMcp: parsed.includeVscodeMcp,
          runPostValidation: true,
          failOnValidation: false,
          runQualityGate: false,
          reason: "materialize_recommended_agents:auto-ensure"
        },
        { context }
      );
      projectMcpSync = {
        executed: true,
        actionTaken: ensureResult.actionTaken,
        statusBefore: ensureResult.statusBefore,
        statusAfter: ensureResult.statusAfter
      };
    }
    const resolvedAllowOverwrite = parsed.allowOverwrite
      ?? (projectMcpSync.actionTaken === "upgrade-applied");

    if (shouldAutoPrepareProjectContext) {
      try {
        const preparation = await prepareLegacyProjectForAiTool.handler(
          {
            sourceDir: parsed.sourceDir,
            autoApply: shouldAutoPrepareApply,
            runEnsureProjectMcp: false,
            askForMissingContext: parsed.autoPrepareAskForMissingContext,
            refreshBaseline: parsed.autoPrepareRefreshBaseline,
            refreshContextIndex: parsed.autoPrepareRefreshContextIndex,
            reason: "materialize_recommended_agents:auto-prepare",
            maxDiffLines: parsed.maxDiffLines
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
          nextActions: ["Run prepare_legacy_project_for_ai before materializing agents to stabilize project context."],
          error: error?.message ?? String(error)
        };
      }
    }

    let recommendations = parsed.recommendations ?? [];
    let source = "input";
    let skillSignals = null;

    if (recommendations.length === 0) {
      source = "auto-recommend";
      const recommendationReport = await recommendProjectAgentsTool.handler(
        {
          sourceDir: parsed.sourceDir,
          maxFiles: parsed.maxFiles,
          maxRecommendations: parsed.maxRecommendations,
          includePackCatalog: parsed.includePackCatalog,
          packCatalogPath: parsed.packCatalogPath,
          includeSkillCatalog: parsed.includeSkillCatalog,
          skillCatalogPath: parsed.skillCatalogPath,
          includeSkillFeedbackRanking: parsed.includeSkillFeedbackRanking,
          skillMetricsPath: parsed.skillMetricsPath,
          minSkillExecutions: parsed.minSkillExecutions,
          maxSkillSignals: parsed.maxSkillSignals,
          requiredSkillTags: parsed.requiredSkillTags,
          policyPath: policyResolution.path,
          respectPolicy: shouldRespectPolicy,
          autoPrepareProjectContext: false
        },
        {
          context
        }
      );
      skillSignals = recommendationReport.skillSignals ?? null;
      recommendations = recommendationReport.recommendations.map((item) => ({
        id: item.id,
        score: item.score,
        agent: {
          id: item.agent.id,
          title: item.agent.title,
          goal: item.agent.goal,
          allowedTools: item.agent.allowedTools
        }
      }));
    }

    const resolvedSkillSelection = resolveSkillSelectionConfig({
      inputMode: parsed.skillSignalMode,
      inputMinConfidence: parsed.skillSignalMinConfidence,
      inputMinRoleBoost: parsed.skillSignalMinRoleBoost,
      recommendationPolicy,
      skillSignals
    });
    const selection = selectRecommendations(recommendations, parsed.maxRecommendations ?? 8, {
      skillSignals,
      source: source === "auto-recommend" ? "auto-recommend" : "none",
      mode: resolvedSkillSelection.mode,
      minConfidence: resolvedSkillSelection.minConfidence,
      minRoleBoost: resolvedSkillSelection.minRoleBoost,
      autoPromotedToStrict: resolvedSkillSelection.autoPromotedToStrict,
      promotionReason: resolvedSkillSelection.promotionReason
    });
    const scaffoldResult = await scaffoldProjectAgentsTool.handler(
      {
        projectName: parsed.projectName,
        projectType: parsed.projectType,
        namespace: parsed.namespace,
        outputDir: parsed.outputDir,
        includeVscodeMcp: parsed.includeVscodeMcp,
        dryRun: parsed.dryRun,
        allowOverwrite: resolvedAllowOverwrite,
        reason: parsed.reason ?? "materialize_recommended_agents",
        maxDiffLines: parsed.maxDiffLines,
        agentDefinitions: selection.agentDefinitions,
        recommendationMeta: {
          source,
          selectedRecommendationIds: selection.selectedRecommendationIds
        }
      },
      {
        context
      }
    );

    return outputSchema.parse({
      source,
      policy: {
        path: policyResolution.path,
        loaded: policyResolution.loaded,
        enforcedSections: recommendationPolicy ? ["recommendation"] : []
      },
      projectMcpSync,
      projectContextSync,
      usedRecommendations: selection.agentDefinitions.length,
      droppedRecommendations: selection.droppedRecommendationIds,
      selectedRecommendationIds: selection.selectedRecommendationIds,
      selectionPolicy: selection.selectionPolicy,
      scaffoldResult
    });
  }
};

function selectRecommendations(recommendations, maxRecommendations, selectionOptions) {
  const policy = resolveSkillSelectionPolicy(selectionOptions);
  const transformed = recommendations
    .map((item) => applySkillSignalAdjustment(item, policy))
    .filter((item) => !item.filteredOut);

  const deduped = [];
  const seen = new Set();
  const dropped = [...policy.filteredRecommendationIds];
  for (const recommendation of transformed
    .slice()
    .sort((a, b) => b.adjustedScore - a.adjustedScore)) {
    const key = recommendation.agent.id.trim();
    if (seen.has(key)) {
      dropped.push(recommendation.id);
      continue;
    }
    seen.add(key);
    deduped.push(recommendation);
    if (deduped.length >= maxRecommendations) {
      break;
    }
  }

  const selectedRecommendationIds = deduped.map((item) => item.id);
  const agentDefinitions = deduped.map((item) => ({
    id: item.agent.id.trim(),
    title: item.agent.title.trim(),
    goal: item.agent.goal.trim(),
      allowedTools: unique(item.agent.allowedTools.map((tool) => tool.trim()).filter(Boolean))
  }));

  if (agentDefinitions.length < 2) {
    agentDefinitions.push({
      id: "reviewer",
      title: "Default Reviewer",
      goal: "Enforce quality gates and produce final validation report.",
      allowedTools: [
        "validate_ui5_code",
        "analyze_ui5_performance",
        "lint_javascript_code",
        "security_check_javascript",
        "validate_project_agents"
      ]
    });
  }

  return {
    agentDefinitions,
    selectedRecommendationIds,
    droppedRecommendationIds: dropped,
    selectionPolicy: {
      source: policy.source,
      mode: policy.mode,
      signalsReady: policy.signalsReady,
      strictApplied: policy.strictApplied,
      autoPromotedToStrict: policy.autoPromotedToStrict,
      promotionReason: policy.promotionReason,
      minConfidence: policy.minConfidence,
      minRoleBoost: policy.minRoleBoost,
      filteredRecommendationIds: policy.filteredRecommendationIds,
      reweightedRecommendationIds: policy.reweightedRecommendationIds
    }
  };
}

function unique(values) {
  return Array.from(new Set(values));
}

function resolveSkillSelectionPolicy(options) {
  const base = {
    source: options.source ?? "none",
    mode: options.mode ?? "prefer",
    minConfidence: options.minConfidence ?? 0.35,
    minRoleBoost: options.minRoleBoost ?? 0.01,
    autoPromotedToStrict: options.autoPromotedToStrict ?? false,
    promotionReason: options.promotionReason ?? null,
    filteredRecommendationIds: [],
    reweightedRecommendationIds: [],
    strictApplied: false
  };
  const signals = options.skillSignals;
  if (!signals || !signals.executed || !signals.influence) {
    return {
      ...base,
      signalsReady: false
    };
  }
  const topSkills = Array.isArray(signals.topSkills) ? signals.topSkills : [];
  const rankedConfidences = topSkills
    .filter((item) => item.rankStatus === "ranked")
    .map((item) => Number(item.confidence ?? 0));
  const maxRankedConfidence = rankedConfidences.length > 0
    ? Math.max(...rankedConfidences)
    : 0;
  const signalsReady = rankedConfidences.length > 0 && maxRankedConfidence >= base.minConfidence;
  return {
    ...base,
    signalsReady,
    strictApplied: base.mode === "strict" && signalsReady,
    influence: {
      architect: Number(signals.influence.architectBoost ?? 0),
      implementer: Number(signals.influence.implementerBoost ?? 0),
      reviewer: Number(signals.influence.reviewerBoost ?? 0),
      i18n: Number(signals.influence.i18nBoost ?? 0)
    }
  };
}

function resolveSkillSelectionConfig(options) {
  const {
    inputMode,
    inputMinConfidence,
    inputMinRoleBoost,
    recommendationPolicy,
    skillSignals
  } = options;
  const mode = inputMode
    ?? recommendationPolicy?.skillSignalMode
    ?? "prefer";
  const minConfidence = inputMinConfidence
    ?? recommendationPolicy?.skillSignalMinConfidence
    ?? 0.35;
  const minRoleBoost = inputMinRoleBoost
    ?? recommendationPolicy?.skillSignalMinRoleBoost
    ?? 0.01;

  const autoPromoteEnabled = recommendationPolicy?.autoPromoteSkillSignalMode ?? false;
  const autoPromoteMinSuccessExecutions = recommendationPolicy?.autoPromoteMinSuccessExecutions ?? 3;
  const autoPromoteMinSuccessRate = recommendationPolicy?.autoPromoteMinSuccessRate ?? 0.8;
  const autoPromoteMinQualifiedSkills = recommendationPolicy?.autoPromoteMinQualifiedSkills ?? 1;

  if (mode !== "prefer" || !autoPromoteEnabled) {
    return {
      mode,
      minConfidence,
      minRoleBoost,
      autoPromotedToStrict: false,
      promotionReason: null
    };
  }

  const promotion = shouldAutoPromoteToStrict(skillSignals, {
    minSuccessExecutions: autoPromoteMinSuccessExecutions,
    minSuccessRate: autoPromoteMinSuccessRate,
    minQualifiedSkills: autoPromoteMinQualifiedSkills
  });
  if (!promotion.promote) {
    return {
      mode,
      minConfidence,
      minRoleBoost,
      autoPromotedToStrict: false,
      promotionReason: null
    };
  }
  return {
    mode: "strict",
    minConfidence,
    minRoleBoost,
    autoPromotedToStrict: true,
    promotionReason: promotion.reason
  };
}

function shouldAutoPromoteToStrict(skillSignals, thresholds) {
  if (!skillSignals || !skillSignals.executed) {
    return { promote: false, reason: null };
  }
  const rankedSkills = Array.isArray(skillSignals.topSkills)
    ? skillSignals.topSkills.filter((item) => item.rankStatus === "ranked")
    : [];
  const qualified = rankedSkills.filter((item) => {
    const successExecutions = Number(item.successExecutions ?? 0);
    const successRate = Number(item.successRate ?? 0);
    return successExecutions >= thresholds.minSuccessExecutions
      && successRate >= thresholds.minSuccessRate;
  });
  if (qualified.length < thresholds.minQualifiedSkills) {
    return { promote: false, reason: null };
  }
  return {
    promote: true,
    reason: `auto-promoted-to-strict qualifiedSkills=${qualified.length} minSuccessExecutions=${thresholds.minSuccessExecutions} minSuccessRate=${thresholds.minSuccessRate}`
  };
}

function applySkillSignalAdjustment(recommendation, policy) {
  if (policy.mode === "off" || !policy.signalsReady || !policy.influence) {
    return {
      ...recommendation,
      adjustedScore: recommendation.score,
      filteredOut: false
    };
  }

  const role = resolveRecommendationRole(recommendation);
  if (!role) {
    return {
      ...recommendation,
      adjustedScore: recommendation.score,
      filteredOut: false
    };
  }

  const boost = Number(policy.influence[role] ?? 0);
  if (policy.strictApplied && boost < policy.minRoleBoost) {
    policy.filteredRecommendationIds.push(recommendation.id);
    return {
      ...recommendation,
      adjustedScore: recommendation.score,
      filteredOut: true
    };
  }

  const adjustedScore = clamp(recommendation.score + boost, 0, 1);
  if (adjustedScore !== recommendation.score) {
    policy.reweightedRecommendationIds.push(recommendation.id);
  }
  return {
    ...recommendation,
    adjustedScore,
    filteredOut: false
  };
}

function resolveRecommendationRole(recommendation) {
  const recId = String(recommendation.id ?? "").toLowerCase();
  const agentId = String(recommendation.agent?.id ?? "").toLowerCase();
  if (recId.includes("architect") || agentId === "architect") {
    return "architect";
  }
  if (recId.includes("implementer") || agentId === "implementer") {
    return "implementer";
  }
  if (recId.includes("reviewer") || agentId === "reviewer") {
    return "reviewer";
  }
  if (recId.includes("i18n") || agentId.includes("i18n")) {
    return "i18n";
  }
  return null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}
