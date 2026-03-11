import { z } from "zod";
import { scaffoldProjectAgentsOutputSchema, scaffoldProjectAgentsTool } from "./scaffoldProjectAgents.js";
import { recommendProjectAgentsTool } from "./recommendProjectAgents.js";
import { ensureProjectMcpCurrentTool } from "./ensureProjectMcpCurrent.js";
import { prepareLegacyProjectForAiTool } from "./prepareLegacyProjectForAi.js";

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
  scaffoldResult: scaffoldProjectAgentsOutputSchema
});

export const materializeRecommendedAgentsTool = {
  name: "materialize_recommended_agents",
  description: "Materialize recommended agents into project artifacts by generating blueprint/guide/prompt and optional MCP config.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
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

    if (recommendations.length === 0) {
      source = "auto-recommend";
      const recommendationReport = await recommendProjectAgentsTool.handler(
        {
          sourceDir: parsed.sourceDir,
          maxFiles: parsed.maxFiles,
          maxRecommendations: parsed.maxRecommendations,
          includePackCatalog: parsed.includePackCatalog,
          packCatalogPath: parsed.packCatalogPath,
          autoPrepareProjectContext: false
        },
        {
          context
        }
      );
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

    const selection = selectRecommendations(recommendations, parsed.maxRecommendations ?? 8);
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
      projectMcpSync,
      projectContextSync,
      usedRecommendations: selection.agentDefinitions.length,
      droppedRecommendations: selection.droppedRecommendationIds,
      selectedRecommendationIds: selection.selectedRecommendationIds,
      scaffoldResult
    });
  }
};

function selectRecommendations(recommendations, maxRecommendations) {
  const deduped = [];
  const seen = new Set();
  const dropped = [];
  for (const recommendation of recommendations
    .slice()
    .sort((a, b) => b.score - a.score)) {
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
    droppedRecommendationIds: dropped
  };
}

function unique(values) {
  return Array.from(new Set(values));
}
