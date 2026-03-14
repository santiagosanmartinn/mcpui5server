import crypto from "node:crypto";
import { z } from "zod";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readTextFile } from "../../utils/fileSystem.js";
import { ToolError } from "../../utils/errors.js";
import { resolveLanguage, t } from "../../utils/language.js";

const TASK_TYPES = ["feature", "bugfix", "refactor", "analysis", "docs", "automation", "custom"];
const OUTCOMES = ["success", "partial", "failed"];
const DEFAULT_RETROSPECTIVE_PATH = ".codex/mcp/prompts/retrospectives.jsonl";

const inputSchema = z.object({
  taskType: z.enum(TASK_TYPES).optional(),
  goal: z.string().min(5).max(800).optional(),
  promptUsed: z.string().min(10).max(24000),
  outcome: z.enum(OUTCOMES),
  qualityGatePassed: z.boolean().optional(),
  iterations: z.number().int().min(1).max(30).optional(),
  issues: z.array(z.string().min(2).max(220)).max(40).optional(),
  whatWorked: z.array(z.string().min(2).max(220)).max(40).optional(),
  whatFailed: z.array(z.string().min(2).max(220)).max(40).optional(),
  timeSpentMinutes: z.number().int().min(0).max(2000).optional(),
  tokenEstimate: z.number().int().min(0).max(500000).optional(),
  expectedTokenBudget: z.number().int().min(1).max(500000).optional(),
  retrospectivePath: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

const outputSchema = z.object({
  dryRun: z.boolean(),
  changed: z.boolean(),
  retrospectivePath: z.string(),
  assessment: z.object({
    score: z.number().int().min(0).max(100),
    efficiency: z.enum(["good", "medium", "poor"]),
    outcome: z.enum(OUTCOMES)
  }),
  signals: z.object({
    strengths: z.array(z.string()),
    rootCauses: z.array(z.string())
  }),
  improvements: z.object({
    nextPromptAdjustments: z.array(z.string()),
    questionsForUser: z.array(z.string()),
    expectedImpact: z.array(z.string())
  }),
  suggestedPromptPatch: z.object({
    add: z.array(z.string()),
    keep: z.array(z.string()),
    remove: z.array(z.string())
  }),
  preview: z.object({
    path: z.string(),
    role: z.literal("prompt-retrospective-log"),
    existsBefore: z.boolean(),
    changed: z.boolean(),
    oldHash: z.string().nullable(),
    newHash: z.string(),
    diffPreview: z.string(),
    diffTruncated: z.boolean()
  }),
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
  automationPolicy: z.object({
    writesOnlyWithConsent: z.boolean(),
    note: z.string()
  })
});

export const promptRetrospectiveTool = {
  name: "prompt_retrospective",
  description: "Analyze prompt execution outcome, suggest quality improvements, and optionally persist retrospective logs under .codex/mcp.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const shouldDryRun = parsed.dryRun ?? true;
    const selectedPath = normalizePath(parsed.retrospectivePath ?? DEFAULT_RETROSPECTIVE_PATH);
    enforceManagedSubtree(selectedPath, ".codex/mcp", "retrospectivePath");
    const taskType = parsed.taskType ?? inferTaskType(parsed.goal, parsed.promptUsed);
    const iterations = parsed.iterations ?? 1;
    const qualityGatePassed = parsed.qualityGatePassed ?? false;
    const issues = normalizeList(parsed.issues);
    const whatWorked = normalizeList(parsed.whatWorked);
    const whatFailed = normalizeList(parsed.whatFailed);

    const assessment = buildAssessment({
      outcome: parsed.outcome,
      qualityGatePassed,
      iterations,
      tokenEstimate: parsed.tokenEstimate ?? 0,
      expectedTokenBudget: parsed.expectedTokenBudget ?? null,
      issueCount: issues.length
    });
    const signals = buildSignals({
      language,
      issues,
      whatWorked,
      whatFailed,
      qualityGatePassed,
      iterations,
      outcome: parsed.outcome
    });
    const improvements = buildImprovements({
      language,
      assessment,
      signals,
      expectedTokenBudget: parsed.expectedTokenBudget ?? null,
      tokenEstimate: parsed.tokenEstimate ?? null
    });
    const suggestedPromptPatch = buildSuggestedPromptPatch({
      language,
      assessment,
      signals
    });

    const retrospectiveRecord = {
      id: createRetrospectiveId(parsed.promptUsed),
      recordedAt: new Date().toISOString(),
      taskType,
      goal: parsed.goal ?? null,
      outcome: parsed.outcome,
      qualityGatePassed,
      iterations,
      timeSpentMinutes: parsed.timeSpentMinutes ?? null,
      tokenEstimate: parsed.tokenEstimate ?? null,
      expectedTokenBudget: parsed.expectedTokenBudget ?? null,
      issues,
      whatWorked,
      whatFailed,
      assessment,
      signals,
      improvements,
      suggestedPromptPatch
    };

    const previous = await readExistingLog(selectedPath, context.rootDir);
    const nextContent = `${previous}${JSON.stringify(retrospectiveRecord)}\n`;
    const preview = await previewFileWrite(selectedPath, nextContent, {
      root: context.rootDir,
      maxDiffLines: parsed.maxDiffLines
    });

    let applyResult = null;
    if (!shouldDryRun && preview.changed) {
      applyResult = await applyProjectPatch(
        [
          {
            path: selectedPath,
            content: nextContent,
            expectedOldHash: preview.oldHash ?? undefined
          }
        ],
        {
          root: context.rootDir,
          reason: parsed.reason ?? "prompt_retrospective"
        }
      );
    }

    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed: preview.changed,
      retrospectivePath: selectedPath,
      assessment,
      signals,
      improvements,
      suggestedPromptPatch,
      preview: {
        path: preview.path,
        role: "prompt-retrospective-log",
        existsBefore: preview.existsBefore,
        changed: preview.changed,
        oldHash: preview.oldHash,
        newHash: preview.newHash,
        diffPreview: preview.diffPreview,
        diffTruncated: preview.diffTruncated
      },
      applyResult,
      automationPolicy: {
        writesOnlyWithConsent: true,
        note: t(
          language,
          "Esta tool solo persiste retrospectivas en .codex/mcp cuando dryRun=false. No toca Git ni codigo funcional.",
          "This tool only persists retrospectives under .codex/mcp when dryRun=false. It does not modify Git state or functional code."
        )
      }
    });
  }
};

function buildAssessment(input) {
  let score = 0;
  if (input.outcome === "success") {
    score += 75;
  } else if (input.outcome === "partial") {
    score += 50;
  } else {
    score += 25;
  }

  score += input.qualityGatePassed ? 12 : -8;
  score -= Math.max(0, (input.iterations - 1) * 5);
  score -= Math.min(20, input.issueCount * 3);

  if (input.expectedTokenBudget && input.tokenEstimate > 0) {
    const overBudgetRate = (input.tokenEstimate - input.expectedTokenBudget) / input.expectedTokenBudget;
    if (overBudgetRate > 0) {
      score -= Math.min(20, Math.round(overBudgetRate * 35));
    } else {
      score += Math.min(8, Math.round(Math.abs(overBudgetRate) * 10));
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const efficiency = score >= 75
    ? "good"
    : score >= 45
      ? "medium"
      : "poor";
  return {
    score,
    efficiency,
    outcome: input.outcome
  };
}

function buildSignals(input) {
  const strengths = [];
  const rootCauses = [];

  if (input.qualityGatePassed) {
    strengths.push(t(input.language, "Validaciones de calidad superadas.", "Quality validations passed."));
  }
  if (input.outcome === "success") {
    strengths.push(t(input.language, "La ejecucion alcanzó el objetivo principal.", "Execution reached the primary goal."));
  }
  if (input.iterations <= 2) {
    strengths.push(t(input.language, "Iteracion baja (prompt bien enfocado).", "Low iteration count (well-focused prompt)."));
  }
  if (input.whatWorked.length > 0) {
    strengths.push(...input.whatWorked.slice(0, 3));
  }

  const failureText = `${input.issues.join(" ")} ${input.whatFailed.join(" ")}`.toLowerCase();
  if (!input.qualityGatePassed) {
    rootCauses.push(t(input.language, "Faltaron validaciones o criterios de cierre estrictos.", "Missing validations or strict completion criteria."));
  }
  if (input.iterations >= 3) {
    rootCauses.push(t(input.language, "Prompt inicial ambiguo (demasiadas iteraciones).", "Initial prompt was ambiguous (too many iterations)."));
  }
  if (/scope|alcance|fuera de alcance|out of scope/.test(failureText)) {
    rootCauses.push(t(input.language, "Alcance mal delimitado en el prompt.", "Scope boundaries were unclear in the prompt."));
  }
  if (/token|context|largo|long|coste|cost/.test(failureText)) {
    rootCauses.push(t(input.language, "Contexto excesivo o no priorizado.", "Context was excessive or not prioritized."));
  }
  if (/criterio|acceptance|done|valida|validation/.test(failureText)) {
    rootCauses.push(t(input.language, "Criterios de aceptacion insuficientes o poco medibles.", "Acceptance criteria were insufficient or not measurable."));
  }
  if (input.whatFailed.length > 0) {
    rootCauses.push(...input.whatFailed.slice(0, 3));
  }

  return {
    strengths: uniqueList(strengths, 8),
    rootCauses: uniqueList(rootCauses, 8)
  };
}

function buildImprovements(input) {
  const nextPromptAdjustments = [];
  const questionsForUser = [];
  const expectedImpact = [];

  if (input.assessment.efficiency !== "good") {
    nextPromptAdjustments.push(
      t(
        input.language,
        "Definir objetivo y criterios de aceptacion en formato medible antes de ejecutar.",
        "Define goal and acceptance criteria in measurable format before execution."
      )
    );
    expectedImpact.push(
      t(
        input.language,
        "Reduce iteraciones y retrabajo.",
        "Reduces iterations and rework."
      )
    );
  }

  if (input.signals.rootCauses.some((item) => /alcance|scope/i.test(item))) {
    nextPromptAdjustments.push(
      t(
        input.language,
        "Separar explicitamente in-scope y out-of-scope con rutas concretas.",
        "Explicitly separate in-scope and out-of-scope with concrete paths."
      )
    );
    questionsForUser.push(
      t(
        input.language,
        "Que archivo/modulo no debe tocarse bajo ningun caso?",
        "Which file/module must never be touched?"
      )
    );
  }

  if (input.expectedTokenBudget && input.tokenEstimate && input.tokenEstimate > input.expectedTokenBudget) {
    nextPromptAdjustments.push(
      t(
        input.language,
        "Aplicar presupuesto de tokens con `prompt_token_budget` antes de la siguiente ejecucion.",
        "Apply token budgeting with `prompt_token_budget` before next execution."
      )
    );
    expectedImpact.push(
      t(
        input.language,
        "Reduce coste y latencia de contexto.",
        "Reduces context cost and latency."
      )
    );
  }

  if (input.signals.rootCauses.some((item) => /criterios|acceptance/i.test(item))) {
    questionsForUser.push(
      t(
        input.language,
        "Que evidencias objetivas te confirman que la tarea esta cerrada?",
        "Which objective evidence confirms that the task is done?"
      )
    );
  }

  if (nextPromptAdjustments.length === 0) {
    nextPromptAdjustments.push(
      t(
        input.language,
        "Mantener estructura actual del prompt y repetir el flujo de validacion.",
        "Keep current prompt structure and repeat the validation flow."
      )
    );
  }
  if (expectedImpact.length === 0) {
    expectedImpact.push(
      t(
        input.language,
        "Mejora incremental de consistencia entre iteraciones.",
        "Incremental consistency improvement across iterations."
      )
    );
  }

  return {
    nextPromptAdjustments: uniqueList(nextPromptAdjustments, 8),
    questionsForUser: uniqueList(questionsForUser, 6),
    expectedImpact: uniqueList(expectedImpact, 6)
  };
}

function buildSuggestedPromptPatch(input) {
  const add = [];
  const keep = [];
  const remove = [];

  if (input.assessment.efficiency === "poor") {
    add.push(t(input.language, "Anadir bloque de criterios de aceptacion medibles.", "Add measurable acceptance criteria block."));
    add.push(t(input.language, "Anadir restricciones tecnicas no negociables.", "Add non-negotiable technical constraints."));
  } else {
    keep.push(t(input.language, "Mantener estructura principal del prompt actual.", "Keep current main prompt structure."));
  }

  if (input.signals.rootCauses.some((item) => /contexto excesivo|excessive context/i.test(item))) {
    remove.push(t(input.language, "Eliminar contexto historico no relevante para la tarea.", "Remove historical context unrelated to this task."));
    add.push(t(input.language, "Priorizar solo 3-8 rutas con `prompt_context_selector`.", "Prioritize only 3-8 paths with `prompt_context_selector`."));
  }

  if (input.signals.strengths.some((item) => /validaciones/i.test(item))) {
    keep.push(t(input.language, "Mantener bloque final de validaciones ejecutables.", "Keep final executable validations block."));
  }

  return {
    add: uniqueList(add, 8),
    keep: uniqueList(keep, 8),
    remove: uniqueList(remove, 8)
  };
}

function inferTaskType(goal, promptUsed) {
  const text = `${goal ?? ""} ${promptUsed ?? ""}`.toLowerCase();
  if (text.includes("bug") || text.includes("error") || text.includes("incidencia")) {
    return "bugfix";
  }
  if (text.includes("refactor")) {
    return "refactor";
  }
  if (text.includes("analiz")) {
    return "analysis";
  }
  if (text.includes("doc") || text.includes("readme")) {
    return "docs";
  }
  if (text.includes("automat")) {
    return "automation";
  }
  if (text.includes("feature") || text.includes("funcionalidad")) {
    return "feature";
  }
  return "custom";
}

async function readExistingLog(retrospectivePath, root) {
  if (!(await fileExists(retrospectivePath, root))) {
    return "";
  }
  return readTextFile(retrospectivePath, root);
}

function createRetrospectiveId(promptUsed) {
  return crypto
    .createHash("sha256")
    .update(`${new Date().toISOString()}::${promptUsed}`)
    .digest("hex")
    .slice(0, 16);
}

function uniqueList(values, limit) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value || seen.has(value)) {
      continue;
    }
    out.push(value);
    seen.add(value);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function normalizeList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueList(value, 40);
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
