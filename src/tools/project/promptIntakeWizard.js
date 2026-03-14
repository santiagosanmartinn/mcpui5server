import { z } from "zod";
import { resolveLanguage, t } from "../../utils/language.js";

const TASK_TYPES = ["feature", "bugfix", "refactor", "analysis", "docs", "automation", "custom"];

const inputSchema = z.object({
  taskType: z.enum(TASK_TYPES).optional(),
  goal: z.string().min(5).max(800).optional(),
  deliverable: z.string().min(3).max(240).optional(),
  contextSummary: z.string().min(5).max(2400).optional(),
  constraints: z.array(z.string().min(2).max(240)).max(40).optional(),
  acceptanceCriteria: z.array(z.string().min(2).max(240)).max(40).optional(),
  inScope: z.array(z.string().min(2).max(240)).max(40).optional(),
  outOfScope: z.array(z.string().min(2).max(240)).max(40).optional(),
  currentPrompt: z.string().min(10).max(16000).optional(),
  maxQuestions: z.number().int().min(1).max(10).optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

const outputSchema = z.object({
  readiness: z.object({
    score: z.number().int().min(0).max(100),
    status: z.enum(["insufficient", "draft", "ready"]),
    missingCritical: z.array(z.string()),
    missingRecommended: z.array(z.string())
  }),
  intake: z.object({
    taskType: z.enum(TASK_TYPES),
    goal: z.string().nullable(),
    deliverable: z.string().nullable(),
    contextSummary: z.string().nullable(),
    constraints: z.array(z.string()),
    acceptanceCriteria: z.array(z.string()),
    inScope: z.array(z.string()),
    outOfScope: z.array(z.string()),
    currentPromptProvided: z.boolean()
  }),
  nextQuestions: z.array(
    z.object({
      id: z.string(),
      priority: z.enum(["high", "medium"]),
      question: z.string(),
      why: z.string(),
      exampleAnswer: z.string()
    })
  ),
  tips: z.array(z.string()),
  automationPolicy: z.object({
    readOnlyAnalysis: z.boolean(),
    note: z.string()
  })
});

export const promptIntakeWizardTool = {
  name: "prompt_intake_wizard",
  description: "Run a lightweight interactive intake for task prompts and return missing fields/questions before execution.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const normalized = normalizeInput(parsed);
    const missingCritical = [];
    const missingRecommended = [];

    if (!normalized.goal) {
      missingCritical.push("goal");
    }
    if (normalized.acceptanceCriteria.length === 0) {
      missingCritical.push("acceptanceCriteria");
    }
    if (!normalized.deliverable) {
      missingRecommended.push("deliverable");
    }
    if (normalized.constraints.length === 0) {
      missingRecommended.push("constraints");
    }
    if (normalized.inScope.length === 0) {
      missingRecommended.push("inScope");
    }
    if (!normalized.contextSummary && !normalized.currentPromptProvided) {
      missingRecommended.push("contextSummary");
    }

    const score = calculateReadinessScore(normalized);
    const status = missingCritical.length > 0
      ? "insufficient"
      : score >= 80
        ? "ready"
        : "draft";
    const maxQuestions = parsed.maxQuestions ?? 4;

    const nextQuestions = buildQuestions({
      language,
      missingCritical,
      missingRecommended
    }).slice(0, maxQuestions);

    const tips = buildTips({
      language,
      status,
      missingCritical,
      missingRecommended,
      currentPromptLength: parsed.currentPrompt?.length ?? 0
    });

    return outputSchema.parse({
      readiness: {
        score,
        status,
        missingCritical,
        missingRecommended
      },
      intake: normalized,
      nextQuestions,
      tips,
      automationPolicy: {
        readOnlyAnalysis: true,
        note: t(
          language,
          "Esta tool solo analiza y estructura el intake del prompt. No ejecuta cambios de codigo ni acciones Git.",
          "This tool only analyzes and structures prompt intake. It does not execute code or Git changes."
        )
      }
    });
  }
};

function normalizeInput(input) {
  const currentPrompt = sanitizeText(input.currentPrompt, 16000);
  return {
    taskType: input.taskType ?? inferTaskType(currentPrompt),
    goal: sanitizeText(input.goal, 800),
    deliverable: sanitizeText(input.deliverable, 240),
    contextSummary: sanitizeText(input.contextSummary, 2400),
    constraints: normalizeList(input.constraints, 40),
    acceptanceCriteria: normalizeList(input.acceptanceCriteria, 40),
    inScope: normalizeList(input.inScope, 40),
    outOfScope: normalizeList(input.outOfScope, 40),
    currentPromptProvided: Boolean(currentPrompt)
  };
}

function inferTaskType(currentPrompt) {
  const text = String(currentPrompt ?? "").toLowerCase();
  if (!text) {
    return "custom";
  }
  if (text.includes("bug") || text.includes("error") || text.includes("incidencia")) {
    return "bugfix";
  }
  if (text.includes("refactor")) {
    return "refactor";
  }
  if (text.includes("doc") || text.includes("readme")) {
    return "docs";
  }
  if (text.includes("analiz") || text.includes("investig")) {
    return "analysis";
  }
  if (text.includes("automat")) {
    return "automation";
  }
  if (text.includes("feature") || text.includes("funcionalidad")) {
    return "feature";
  }
  return "custom";
}

function calculateReadinessScore(intake) {
  let score = 0;
  if (intake.goal) {
    score += 30;
  }
  if (intake.acceptanceCriteria.length > 0) {
    score += 25;
  }
  if (intake.constraints.length > 0) {
    score += 15;
  }
  if (intake.inScope.length > 0) {
    score += 10;
  }
  if (intake.contextSummary || intake.currentPromptProvided) {
    score += 10;
  }
  if (intake.deliverable) {
    score += 5;
  }
  if (intake.outOfScope.length > 0) {
    score += 5;
  }
  return Math.max(0, Math.min(100, score));
}

function buildQuestions(input) {
  const { language, missingCritical, missingRecommended } = input;
  const questions = [];

  if (missingCritical.includes("goal")) {
    questions.push({
      id: "goal",
      priority: "high",
      question: t(
        language,
        "Cual es el objetivo exacto de la tarea en una sola frase?",
        "What is the exact task goal in one sentence?"
      ),
      why: t(
        language,
        "Sin objetivo, la IA suele proponer cambios difusos o fuera de foco.",
        "Without a concrete goal, AI proposals tend to drift out of scope."
      ),
      exampleAnswer: t(
        language,
        "Implementar validacion de filtros en Main.controller.js sin romper rutas existentes.",
        "Implement filter validation in Main.controller.js without breaking current routes."
      )
    });
  }

  if (missingCritical.includes("acceptanceCriteria")) {
    questions.push({
      id: "acceptanceCriteria",
      priority: "high",
      question: t(
        language,
        "Que criterios objetivos definen que la tarea esta terminada?",
        "Which objective criteria define when the task is done?"
      ),
      why: t(
        language,
        "Los criterios de aceptacion reducen iteraciones y retrabajo.",
        "Acceptance criteria reduce iterations and rework."
      ),
      exampleAnswer: t(
        language,
        "1) npm run check en verde, 2) sin errores de consola, 3) flujo de busqueda validado.",
        "1) npm run check passes, 2) no console errors, 3) search flow validated."
      )
    });
  }

  if (missingRecommended.includes("constraints")) {
    questions.push({
      id: "constraints",
      priority: "medium",
      question: t(
        language,
        "Que restricciones debe respetar la solucion (versiones, arquitectura, no romper X)?",
        "What constraints must the solution respect (versions, architecture, do-not-break areas)?"
      ),
      why: t(
        language,
        "Las restricciones evitan propuestas inviables o riesgosas.",
        "Constraints prevent unfeasible or risky proposals."
      ),
      exampleAnswer: t(
        language,
        "No tocar manifest routing ni dependencias; mantener compatibilidad UI5 1.108.",
        "Do not modify manifest routing or dependencies; keep UI5 1.108 compatibility."
      )
    });
  }

  if (missingRecommended.includes("inScope")) {
    questions.push({
      id: "inScope",
      priority: "medium",
      question: t(
        language,
        "Que archivos o modulos entran en alcance directo?",
        "Which files or modules are in direct scope?"
      ),
      why: t(
        language,
        "Delimitar alcance reduce consumo y cambios colaterales.",
        "Scope boundaries reduce token usage and collateral changes."
      ),
      exampleAnswer: t(
        language,
        "webapp/controller/Main.controller.js y webapp/view/Main.view.xml.",
        "webapp/controller/Main.controller.js and webapp/view/Main.view.xml."
      )
    });
  }

  if (missingRecommended.includes("deliverable")) {
    questions.push({
      id: "deliverable",
      priority: "medium",
      question: t(
        language,
        "Que esperas recibir como salida final (patch, plan, analisis, checklist)?",
        "What final output do you expect (patch, plan, analysis, checklist)?"
      ),
      why: t(
        language,
        "Define formato de entrega y evita respuestas ambiguas.",
        "It defines output format and avoids ambiguous responses."
      ),
      exampleAnswer: t(
        language,
        "Patch aplicado + resumen corto de cambios + comandos de validacion ejecutados.",
        "Applied patch + short change summary + executed validation commands."
      )
    });
  }

  if (missingRecommended.includes("contextSummary")) {
    questions.push({
      id: "contextSummary",
      priority: "medium",
      question: t(
        language,
        "Que contexto minimo del proyecto debe conocer la IA antes de actuar?",
        "What minimum project context should AI know before acting?"
      ),
      why: t(
        language,
        "Aporta precision sin tener que enviar prompts largos repetidos.",
        "It improves precision without repeatedly sending long prompts."
      ),
      exampleAnswer: t(
        language,
        "Proyecto SAPUI5 con OData V2, rama feature/* y politica de cambios incrementales.",
        "SAPUI5 project with OData V2, feature/* branch, and incremental-change policy."
      )
    });
  }

  return questions;
}

function buildTips(input) {
  const { language, status, missingCritical, missingRecommended, currentPromptLength } = input;
  const tips = [];

  if (status === "insufficient") {
    tips.push(
      t(
        language,
        "Completa primero campos criticos (objetivo y criterios de aceptacion) antes de ejecutar la tarea.",
        "Complete critical fields first (goal and acceptance criteria) before running the task."
      )
    );
  }
  if (missingRecommended.includes("constraints")) {
    tips.push(
      t(
        language,
        "Anade limites tecnicos explicitos para evitar propuestas fuera de politica.",
        "Add explicit technical limits to avoid out-of-policy proposals."
      )
    );
  }
  if (missingRecommended.includes("inScope")) {
    tips.push(
      t(
        language,
        "Incluye rutas de archivo concretas para reducir exploracion innecesaria.",
        "Include concrete file paths to reduce unnecessary exploration."
      )
    );
  }
  if (currentPromptLength > 6000) {
    tips.push(
      t(
        language,
        "El prompt actual parece largo; usa `prompt_token_budget` para compactarlo antes de enviar.",
        "The current prompt appears long; use `prompt_token_budget` to compact it before sending."
      )
    );
  }
  if (missingCritical.length === 0 && missingRecommended.length === 0) {
    tips.push(
      t(
        language,
        "El intake esta completo; puedes pasar a `prompt_builder` para generar la version final.",
        "Intake is complete; proceed with `prompt_builder` to generate the final version."
      )
    );
  }
  return tips;
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
