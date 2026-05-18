import { z } from "zod";
import { deriveCapUiBacklogTool } from "./deriveBacklog.js";
import { backlogSchema, estimateTokens, unique } from "./common.js";

const inputSchema = z.object({
  backlog: z.unknown().optional(),
  analysis: z.unknown().optional(),
  sourcePaths: z.array(z.string().min(1)).max(100).optional(),
  specRoot: z.string().min(1).optional(),
  targetAi: z.enum(["codex", "claude", "generic"]).optional(),
  tokenBudget: z.number().int().min(1000).max(128000).optional(),
  maxTasksPerIteration: z.number().int().min(1).max(12).optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

const outputSchema = z.object({
  targetAi: z.enum(["codex", "claude", "generic"]),
  tokenBudget: z.number().int().positive(),
  summary: z.object({
    iterations: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
    estimatedPromptTokens: z.number().int().nonnegative()
  }),
  iterations: z.array(z.object({
    id: z.string(),
    title: z.string(),
    agent: z.enum(["codex", "claude", "generic"]),
    taskIds: z.array(z.string()),
    traceIds: z.array(z.string()),
    contextPaths: z.array(z.string()),
    prompt: z.string(),
    estimatedTokens: z.number().int().nonnegative(),
    checks: z.array(z.string())
  }))
});

export const planAiCodingIterationsTool = {
  name: "plan_ai_coding_iterations",
  description: "Plan token-efficient coding-agent iterations from a validated CAP/UI SDD backlog.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const backlog = parsed.backlog
      ? backlogSchema.parse(parsed.backlog)
      : await deriveCapUiBacklogTool.handler(
          {
            analysis: parsed.analysis,
            sourcePaths: parsed.sourcePaths,
            specRoot: parsed.specRoot,
            language: parsed.language
          },
          { context }
        );
    const targetAi = parsed.targetAi ?? "codex";
    const tokenBudget = parsed.tokenBudget ?? 12000;
    const maxTasksPerIteration = parsed.maxTasksPerIteration ?? 4;
    const iterations = buildIterations({
      backlog,
      targetAi,
      tokenBudget,
      maxTasksPerIteration
    });

    return outputSchema.parse({
      targetAi,
      tokenBudget,
      summary: {
        iterations: iterations.length,
        tasks: backlog.tasks.length,
        estimatedPromptTokens: iterations.reduce((acc, iteration) => acc + iteration.estimatedTokens, 0)
      },
      iterations
    });
  }
};

function buildIterations(input) {
  const { backlog, targetAi, tokenBudget, maxTasksPerIteration } = input;
  const sortedTasks = [...backlog.tasks].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.id.localeCompare(b.id));
  const groups = [];
  for (let index = 0; index < sortedTasks.length; index += maxTasksPerIteration) {
    groups.push(sortedTasks.slice(index, index + maxTasksPerIteration));
  }
  return groups.map((tasks, index) => {
    const traceIds = unique(tasks.flatMap((task) => task.traceIds));
    const contextPaths = unique(tasks.flatMap((task) => task.contextHints)).slice(0, 8);
    const checks = unique(tasks.flatMap((task) => task.recommendedChecks));
    const prompt = renderPrompt({
      backlog,
      tasks,
      traceIds,
      checks,
      targetAi,
      tokenBudget
    });
    return {
      id: `ITER-${String(index + 1).padStart(3, "0")}`,
      title: buildIterationTitle(tasks),
      agent: targetAi,
      taskIds: tasks.map((task) => task.id),
      traceIds,
      contextPaths,
      prompt,
      estimatedTokens: estimateTokens(prompt),
      checks
    };
  });
}

function renderPrompt(input) {
  const { backlog, tasks, traceIds, checks, targetAi, tokenBudget } = input;
  return [
    `Target AI: ${targetAi}`,
    `Token budget: ${tokenBudget}`,
    "Goal: implement this CAP Node + UI5/Fiori backlog slice with small, verifiable changes.",
    "",
    "Tasks:",
    ...tasks.map((task) => `- ${task.id} [${task.type}/${task.priority}]: ${task.title} (trace: ${task.traceIds.join(", ")})`),
    "",
    "Acceptance criteria:",
    ...tasks.flatMap((task) => task.acceptanceCriteria.map((criterion) => `- ${task.id}: ${criterion}`)),
    "",
    "Relevant trace IDs:",
    traceIds.join(", ") || "none",
    "",
    "Recommended checks:",
    ...checks.map((check) => `- ${check}`),
    "",
    `Backlog mode: ${backlog.mode}. Keep implementation aligned with official SAP CAP/UI5 validation gates.`
  ].join("\n");
}

function buildIterationTitle(tasks) {
  const types = unique(tasks.map((task) => task.type));
  return `${types.join(" + ")} (${tasks.length} task${tasks.length === 1 ? "" : "s"})`;
}

function priorityRank(priority) {
  if (priority === "high") {
    return 0;
  }
  if (priority === "medium") {
    return 1;
  }
  return 2;
}
