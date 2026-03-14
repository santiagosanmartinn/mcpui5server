import { z } from "zod";
import { resolveLanguage, t } from "../../utils/language.js";

const TASK_TYPES = ["feature", "bugfix", "refactor", "analysis", "docs", "automation", "custom"];

const inputSchema = z.object({
  prompt: z.string().min(10).max(24000).optional(),
  taskType: z.enum(TASK_TYPES).optional(),
  goal: z.string().min(5).max(800).optional(),
  deliverable: z.string().min(3).max(240).optional(),
  contextSummary: z.string().min(5).max(2400).optional(),
  constraints: z.array(z.string().min(2).max(240)).max(40).optional(),
  acceptanceCriteria: z.array(z.string().min(2).max(240)).max(40).optional(),
  inScope: z.array(z.string().min(2).max(240)).max(40).optional(),
  outOfScope: z.array(z.string().min(2).max(240)).max(40).optional(),
  strictMode: z.boolean().optional(),
  maxImprovementQuestions: z.number().int().min(1).max(10).optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

const outputSchema = z.object({
  summary: z.object({
    score: z.number().int().min(0).max(100),
    status: z.enum(["blocked", "needs_improvement", "pass"]),
    ready: z.boolean()
  }),
  dimensions: z.array(
    z.object({
      id: z.string(),
      score: z.number().int().min(0).max(100),
      status: z.enum(["pass", "warn", "fail"]),
      evidence: z.array(z.string()),
      recommendation: z.string()
    })
  ),
  blockingIssues: z.array(z.string()),
  improvements: z.array(z.string()),
  improvementQuestions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      why: z.string()
    })
  ),
  normalizedPrompt: z.object({
    estimatedTokens: z.number().int().nonnegative(),
    chars: z.number().int().nonnegative(),
    lines: z.number().int().nonnegative(),
    hasChecklist: z.boolean()
  }),
  automationPolicy: z.object({
    readOnlyAnalysis: z.boolean(),
    note: z.string()
  })
});

export const promptQualityGateTool = {
  name: "prompt_quality_gate",
  description: "Evaluate prompt quality with deterministic scoring, blockers, and targeted improvement questions.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const strictMode = parsed.strictMode ?? true;
    const maxImprovementQuestions = parsed.maxImprovementQuestions ?? 4;
    const normalized = normalizeInput(parsed);
    const promptText = buildEvaluationPrompt(normalized);
    const estimatedTokens = estimateTokens(promptText);
    const promptSignals = inspectPrompt(promptText);

    const dimensions = [
      evaluateObjective(normalized, promptSignals, language),
      evaluateContext(normalized, promptSignals, language),
      evaluateConstraints(normalized, promptSignals, language),
      evaluateAcceptance(normalized, promptSignals, language),
      evaluateExecutionPlan(normalized, promptSignals, language),
      evaluateEfficiency(estimatedTokens, language)
    ];

    const score = calculateGlobalScore(dimensions);
    const blockingIssues = buildBlockingIssues({
      strictMode,
      dimensions,
      language,
      estimatedTokens
    });
    const status = blockingIssues.length > 0
      ? "blocked"
      : score >= 80 && dimensions.every((item) => item.status !== "fail")
        ? "pass"
        : "needs_improvement";
    const ready = status === "pass";

    const improvements = dimensions
      .filter((item) => item.status !== "pass")
      .map((item) => item.recommendation);
    const improvementQuestions = buildImprovementQuestions({
      dimensions,
      language
    }).slice(0, maxImprovementQuestions);

    return outputSchema.parse({
      summary: {
        score,
        status,
        ready
      },
      dimensions,
      blockingIssues,
      improvements,
      improvementQuestions,
      normalizedPrompt: {
        estimatedTokens,
        chars: promptText.length,
        lines: promptText ? promptText.split(/\r?\n/).length : 0,
        hasChecklist: promptSignals.hasChecklist
      },
      automationPolicy: {
        readOnlyAnalysis: true,
        note: t(
          language,
          "Esta tool solo evalua calidad del prompt. No ejecuta cambios de codigo ni operaciones Git.",
          "This tool only evaluates prompt quality. It does not perform code or Git operations."
        )
      }
    });
  }
};

function normalizeInput(input) {
  return {
    taskType: input.taskType ?? "custom",
    prompt: sanitizeText(input.prompt, 24000),
    goal: sanitizeText(input.goal, 800),
    deliverable: sanitizeText(input.deliverable, 240),
    contextSummary: sanitizeText(input.contextSummary, 2400),
    constraints: normalizeList(input.constraints, 40),
    acceptanceCriteria: normalizeList(input.acceptanceCriteria, 40),
    inScope: normalizeList(input.inScope, 40),
    outOfScope: normalizeList(input.outOfScope, 40)
  };
}

function buildEvaluationPrompt(input) {
  const lines = [];
  if (input.prompt) {
    lines.push(input.prompt);
  }
  if (input.goal) {
    lines.push(`Goal: ${input.goal}`);
  }
  if (input.contextSummary) {
    lines.push(`Context: ${input.contextSummary}`);
  }
  if (input.deliverable) {
    lines.push(`Deliverable: ${input.deliverable}`);
  }
  if (input.constraints.length > 0) {
    lines.push(`Constraints: ${input.constraints.join("; ")}`);
  }
  if (input.acceptanceCriteria.length > 0) {
    lines.push(`Acceptance: ${input.acceptanceCriteria.join("; ")}`);
  }
  if (input.inScope.length > 0) {
    lines.push(`In scope: ${input.inScope.join("; ")}`);
  }
  if (input.outOfScope.length > 0) {
    lines.push(`Out of scope: ${input.outOfScope.join("; ")}`);
  }
  return lines.join("\n").trim();
}

function inspectPrompt(prompt) {
  const text = String(prompt ?? "");
  return {
    hasObjectiveWords: /(objetivo|goal|tarea principal|main task)/i.test(text),
    hasContextWords: /(contexto|context|arquitectura|archivo|path|modulo|module|manifest|webapp)/i.test(text),
    hasConstraintWords: /(restric|constraint|must not|do not|evitar|limite|limit)/i.test(text),
    hasAcceptanceWords: /(criterios? de aceptacion|acceptance criteria|definition of done|done when|do d)/i.test(text),
    hasPlanWords: /(pasos|steps|plan|entrega|output format|formato de salida|valida|validate)/i.test(text),
    hasChecklist: /(^|\n)\s*[-*]\s*\[( |x)\]/im.test(text) || /checklist/i.test(text)
  };
}

function evaluateObjective(input, signals, language) {
  const score = input.goal
    ? 100
    : signals.hasObjectiveWords
      ? 65
      : 20;
  return createDimension({
    id: "objective_clarity",
    score,
    evidence: [
      input.goal
        ? t(language, "Objetivo explicito recibido en el intake.", "Explicit goal found in intake.")
        : t(language, "No hay objetivo explicito en campos estructurados.", "No explicit goal in structured fields."),
      signals.hasObjectiveWords
        ? t(language, "Se detectaron senales de objetivo en el prompt libre.", "Goal-like wording detected in free prompt.")
        : t(language, "No se detectan marcadores de objetivo en el texto.", "No objective markers detected in text.")
    ],
    recommendation: t(
      language,
      "Declara objetivo en una frase concreta y verificable.",
      "Declare a concrete, verifiable one-sentence goal."
    )
  });
}

function evaluateContext(input, signals, language) {
  const hasStructuredContext = Boolean(input.contextSummary || input.inScope.length > 0 || input.outOfScope.length > 0);
  const score = hasStructuredContext
    ? 90
    : signals.hasContextWords
      ? 60
      : 25;
  return createDimension({
    id: "context_completeness",
    score,
    evidence: [
      hasStructuredContext
        ? t(language, "Contexto estructurado disponible (resumen y/o alcance).", "Structured context is available (summary and/or scope).")
        : t(language, "Falta contexto estructurado para orientar la ejecucion.", "Structured context is missing for execution guidance."),
      signals.hasContextWords
        ? t(language, "El prompt incluye palabras de contexto tecnico.", "Prompt contains technical-context wording.")
        : t(language, "El prompt libre apenas aporta contexto tecnico.", "Free prompt provides limited technical context.")
    ],
    recommendation: t(
      language,
      "Anade contexto minimo del proyecto y rutas afectadas.",
      "Add minimum project context and impacted paths."
    )
  });
}

function evaluateConstraints(input, signals, language) {
  const score = input.constraints.length > 0
    ? 95
    : signals.hasConstraintWords
      ? 55
      : 20;
  return createDimension({
    id: "constraints_quality",
    score,
    evidence: [
      input.constraints.length > 0
        ? t(language, "Se definieron restricciones explicitas.", "Explicit constraints were defined.")
        : t(language, "No se definieron restricciones estructuradas.", "No structured constraints were defined."),
      signals.hasConstraintWords
        ? t(language, "Hay senales de restricciones en texto libre.", "Constraint-like wording detected in free text.")
        : t(language, "No hay senales claras de limites tecnicos.", "No clear technical limits detected.")
    ],
    recommendation: t(
      language,
      "Especifica limites no negociables (compatibilidad, areas intocables, politicas).",
      "Specify non-negotiable limits (compatibility, protected areas, policies)."
    )
  });
}

function evaluateAcceptance(input, signals, language) {
  const score = input.acceptanceCriteria.length > 0
    ? 100
    : signals.hasAcceptanceWords
      ? 60
      : 15;
  return createDimension({
    id: "acceptance_criteria",
    score,
    evidence: [
      input.acceptanceCriteria.length > 0
        ? t(language, "Hay criterios de aceptacion estructurados.", "Structured acceptance criteria are present.")
        : t(language, "No se indicaron criterios de aceptacion estructurados.", "No structured acceptance criteria were provided."),
      signals.hasAcceptanceWords
        ? t(language, "El texto libre incluye senales de cierre/DoD.", "Free text includes completion/DoD signals.")
        : t(language, "No se detecta definicion de exito en el prompt.", "No success definition detected in prompt.")
    ],
    recommendation: t(
      language,
      "Anade 2-4 criterios medibles para cerrar la tarea sin ambiguedad.",
      "Add 2-4 measurable criteria to close the task unambiguously."
    )
  });
}

function evaluateExecutionPlan(input, signals, language) {
  const hasStructuredPlan = Boolean(input.deliverable || input.inScope.length > 0 || input.outOfScope.length > 0);
  const score = hasStructuredPlan
    ? 90
    : signals.hasPlanWords
      ? 60
      : 30;
  return createDimension({
    id: "execution_structure",
    score,
    evidence: [
      hasStructuredPlan
        ? t(language, "Hay formato de entrega o alcance estructurado.", "Structured scope or output format is present.")
        : t(language, "Falta estructura de ejecucion/entrega en campos.", "Structured execution/output data is missing."),
      signals.hasPlanWords
        ? t(language, "El prompt libre sugiere plan o pasos.", "Free prompt suggests a plan or steps.")
        : t(language, "No se observan pasos o formato de salida claro.", "No clear steps or output format detected.")
    ],
    recommendation: t(
      language,
      "Define salida esperada y secuencia minima de trabajo.",
      "Define expected output and a minimal work sequence."
    )
  });
}

function evaluateEfficiency(estimatedTokens, language) {
  let score = 15;
  if (estimatedTokens <= 600) {
    score = 100;
  } else if (estimatedTokens <= 1000) {
    score = 80;
  } else if (estimatedTokens <= 1400) {
    score = 60;
  } else if (estimatedTokens <= 2000) {
    score = 35;
  }
  return createDimension({
    id: "token_efficiency",
    score,
    evidence: [
      t(
        language,
        `Estimacion de tokens de entrada: ${estimatedTokens}.`,
        `Estimated input tokens: ${estimatedTokens}.`
      )
    ],
    recommendation: t(
      language,
      "Si supera presupuesto, compacta con `prompt_token_budget`.",
      "If over budget, compact with `prompt_token_budget`."
    )
  });
}

function createDimension(input) {
  const status = input.score >= 70
    ? "pass"
    : input.score >= 45
      ? "warn"
      : "fail";
  return {
    id: input.id,
    score: input.score,
    status,
    evidence: input.evidence,
    recommendation: input.recommendation
  };
}

function calculateGlobalScore(dimensions) {
  const weights = {
    objective_clarity: 0.25,
    context_completeness: 0.2,
    constraints_quality: 0.2,
    acceptance_criteria: 0.2,
    execution_structure: 0.1,
    token_efficiency: 0.05
  };
  let total = 0;
  for (const dimension of dimensions) {
    const weight = weights[dimension.id] ?? 0;
    total += dimension.score * weight;
  }
  return Math.max(0, Math.min(100, Math.round(total)));
}

function buildBlockingIssues(input) {
  const { strictMode, dimensions, language, estimatedTokens } = input;
  const byId = Object.fromEntries(dimensions.map((item) => [item.id, item]));
  const blockers = [];

  if (strictMode) {
    if ((byId.objective_clarity?.score ?? 0) < 60) {
      blockers.push(t(language, "Falta objetivo claro para ejecutar la tarea con seguridad.", "Missing clear task objective for safe execution."));
    }
    if ((byId.acceptance_criteria?.score ?? 0) < 60) {
      blockers.push(t(language, "Faltan criterios de aceptacion medibles.", "Missing measurable acceptance criteria."));
    }
    if ((byId.constraints_quality?.score ?? 0) < 40) {
      blockers.push(t(language, "Faltan restricciones tecnicas minimas.", "Missing minimum technical constraints."));
    }
  }

  if (estimatedTokens > 2600) {
    blockers.push(t(language, "Prompt demasiado extenso para ejecucion eficiente.", "Prompt is too large for efficient execution."));
  }
  return blockers;
}

function buildImprovementQuestions(input) {
  const { dimensions, language } = input;
  const questions = [];

  for (const dimension of dimensions) {
    if (dimension.status === "pass") {
      continue;
    }
    if (dimension.id === "objective_clarity") {
      questions.push({
        id: "objective_clarity",
        question: t(language, "Puedes resumir el objetivo en una frase verificable?", "Can you summarize the goal in one verifiable sentence?"),
        why: t(language, "Mejora precision y evita cambios no deseados.", "Improves precision and avoids unwanted changes.")
      });
    }
    if (dimension.id === "context_completeness") {
      questions.push({
        id: "context_completeness",
        question: t(language, "Que rutas/archivos exactos forman parte del contexto minimo?", "Which exact paths/files are part of minimum context?"),
        why: t(language, "Reduce exploracion y consumo de tokens.", "Reduces exploration and token consumption.")
      });
    }
    if (dimension.id === "constraints_quality") {
      questions.push({
        id: "constraints_quality",
        question: t(language, "Que limites no se pueden romper en esta tarea?", "Which limits must not be broken for this task?"),
        why: t(language, "Evita propuestas incompatibles con el proyecto.", "Avoids proposals incompatible with project constraints.")
      });
    }
    if (dimension.id === "acceptance_criteria") {
      questions.push({
        id: "acceptance_criteria",
        question: t(language, "Que 2-4 criterios medibles usaremos para cerrar la tarea?", "Which 2-4 measurable criteria define task completion?"),
        why: t(language, "Permite cierre objetivo con menos iteraciones.", "Enables objective closure with fewer iterations.")
      });
    }
    if (dimension.id === "execution_structure") {
      questions.push({
        id: "execution_structure",
        question: t(language, "Que formato de salida exacto necesitas de la IA?", "What exact output format do you need from AI?"),
        why: t(language, "Alinea entrega con expectativa desde el inicio.", "Aligns delivery with expectations from the start.")
      });
    }
    if (dimension.id === "token_efficiency") {
      questions.push({
        id: "token_efficiency",
        question: t(language, "Quieres una version compacta del prompt con presupuesto fijo?", "Do you want a compact prompt version with fixed budget?"),
        why: t(language, "Reduce coste y latencia de cada iteracion.", "Reduces cost and latency per iteration.")
      });
    }
  }

  return questions;
}

function estimateTokens(text) {
  const value = String(text ?? "");
  if (!value.trim()) {
    return 0;
  }
  return Math.max(1, Math.ceil(value.length / 4));
}

function sanitizeText(value, maxLength) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
}

function normalizeList(value, maxItems) {
  if (!Array.isArray(value)) {
    return [];
  }
  const result = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      continue;
    }
    const item = raw.trim().replace(/\s+/g, " ");
    if (!item || result.includes(item)) {
      continue;
    }
    result.push(item);
    if (result.length >= maxItems) {
      break;
    }
  }
  return result;
}
