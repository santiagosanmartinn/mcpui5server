import { z } from "zod";
import { resolveLanguage, t } from "../../utils/language.js";

const TASK_TYPES = ["feature", "bugfix", "refactor", "analysis", "docs", "automation", "custom"];

const inputSchema = z.object({
  taskType: z.enum(TASK_TYPES).optional(),
  includeExamples: z.boolean().optional(),
  includeCompactVariant: z.boolean().optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

const templateSchema = z.object({
  id: z.string(),
  taskType: z.enum(TASK_TYPES),
  title: z.string(),
  whenToUse: z.string(),
  requiredFields: z.array(z.string()),
  recommendedFields: z.array(z.string()),
  template: z.object({
    full: z.string(),
    compact: z.string().nullable()
  }),
  example: z.string().nullable()
});

const outputSchema = z.object({
  catalogVersion: z.string(),
  language: z.enum(["es", "en"]),
  templates: z.array(templateSchema),
  quickStart: z.array(z.string()),
  automationPolicy: z.object({
    readOnlyCatalog: z.boolean(),
    note: z.string()
  })
});

export const promptTemplateCatalogTool = {
  name: "prompt_template_catalog",
  description: "Provide reusable prompt templates by task type to standardize quality and reduce prompt drafting effort.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const includeExamples = parsed.includeExamples ?? true;
    const includeCompactVariant = parsed.includeCompactVariant ?? true;
    const allTemplates = buildTemplateCatalog(language, includeExamples, includeCompactVariant);
    const templates = parsed.taskType
      ? allTemplates.filter((item) => item.taskType === parsed.taskType)
      : allTemplates;

    return outputSchema.parse({
      catalogVersion: "1.0.0",
      language,
      templates,
      quickStart: [
        t(
          language,
          "1) Elige plantilla por tipo de tarea.",
          "1) Choose a template by task type."
        ),
        t(
          language,
          "2) Rellena objetivo, restricciones y criterios de aceptacion.",
          "2) Fill goal, constraints, and acceptance criteria."
        ),
        t(
          language,
          "3) Ejecuta `prompt_quality_gate` y, si hace falta, `prompt_token_budget`.",
          "3) Run `prompt_quality_gate` and, if needed, `prompt_token_budget`."
        )
      ],
      automationPolicy: {
        readOnlyCatalog: true,
        note: t(
          language,
          "Esta tool solo devuelve plantillas de prompt. No modifica archivos ni ejecuta acciones.",
          "This tool only returns prompt templates. It does not modify files or execute actions."
        )
      }
    });
  }
};

function buildTemplateCatalog(language, includeExamples, includeCompactVariant) {
  const templates = [];
  for (const taskType of TASK_TYPES) {
    const template = createTemplate(taskType, language, includeCompactVariant);
    templates.push({
      ...template,
      example: includeExamples ? buildExample(taskType, language) : null
    });
  }
  return templates;
}

function createTemplate(taskType, language, includeCompactVariant) {
  const baseFields = {
    requiredFields: ["goal", "acceptanceCriteria"],
    recommendedFields: ["constraints", "inScope", "outOfScope", "deliverable"]
  };
  const profile = PROFILE_BY_TASK[taskType];

  const full = [
    t(language, `Tipo de tarea: ${taskType}`, `Task type: ${taskType}`),
    t(language, `Objetivo: <${profile.goalPlaceholderEs}>`, `Goal: <${profile.goalPlaceholderEn}>`),
    t(language, "Contexto: <resumen minimo del proyecto>", "Context: <minimum project summary>"),
    t(language, "Alcance: <archivos/modulos concretos>", "Scope: <concrete files/modules>"),
    t(language, "Fuera de alcance: <lo que no se debe tocar>", "Out of scope: <what must not be touched>"),
    t(language, "Restricciones: <limites tecnicos/politicas>", "Constraints: <technical/policy limits>"),
    t(language, "Criterios de aceptacion:", "Acceptance criteria:"),
    t(language, "- <criterio 1>", "- <criterion 1>"),
    t(language, "- <criterio 2>", "- <criterion 2>"),
    t(language, "Salida esperada: <patch/analisis/checklist>", "Expected output: <patch/analysis/checklist>"),
    t(language, "Validacion final: ejecutar checks relevantes y reportar resultado.", "Final validation: run relevant checks and report results.")
  ].join("\n");

  const compact = includeCompactVariant
    ? [
      t(language, `[${taskType}] Objetivo: <${profile.goalPlaceholderEs}>`, `[${taskType}] Goal: <${profile.goalPlaceholderEn}>`),
      t(language, "Alcance: <files> | Restricciones: <limites>", "Scope: <files> | Constraints: <limits>"),
      t(language, "Aceptacion: <2-4 criterios medibles>", "Acceptance: <2-4 measurable criteria>"),
      t(language, "Entrega: <formato esperado>", "Output: <expected format>")
    ].join("\n")
    : null;

  return {
    id: `template-${taskType}`,
    taskType,
    title: t(language, profile.titleEs, profile.titleEn),
    whenToUse: t(language, profile.whenEs, profile.whenEn),
    requiredFields: baseFields.requiredFields,
    recommendedFields: baseFields.recommendedFields,
    template: {
      full,
      compact
    }
  };
}

function buildExample(taskType, language) {
  const examples = {
    feature: t(
      language,
      "Objetivo: implementar validacion de filtros en Main.controller.js sin romper rutas.",
      "Goal: implement filter validation in Main.controller.js without breaking routes."
    ),
    bugfix: t(
      language,
      "Objetivo: corregir error de binding undefined en Detail.view.xml.",
      "Goal: fix undefined binding error in Detail.view.xml."
    ),
    refactor: t(
      language,
      "Objetivo: extraer logica duplicada de formateo a formatter comun.",
      "Goal: extract duplicated formatting logic into shared formatter."
    ),
    analysis: t(
      language,
      "Objetivo: identificar causa raiz de lentitud en carga inicial.",
      "Goal: identify root cause for slow initial load."
    ),
    docs: t(
      language,
      "Objetivo: actualizar README con flujo de setup local y troubleshooting.",
      "Goal: update README with local setup and troubleshooting flow."
    ),
    automation: t(
      language,
      "Objetivo: crear script npm para validar convenciones UI5 antes de commit.",
      "Goal: create npm script to validate UI5 conventions before commit."
    ),
    custom: t(
      language,
      "Objetivo: definir tarea ad hoc con alcance y criterios medibles.",
      "Goal: define ad hoc task with scope and measurable criteria."
    )
  };
  return examples[taskType];
}

const PROFILE_BY_TASK = {
  feature: {
    titleEs: "Plantilla de nueva funcionalidad",
    titleEn: "New feature template",
    whenEs: "Cuando se incorpora comportamiento o pantalla nueva.",
    whenEn: "When adding new behavior or a new screen.",
    goalPlaceholderEs: "resultado funcional a implementar",
    goalPlaceholderEn: "functional outcome to implement"
  },
  bugfix: {
    titleEs: "Plantilla de correccion de bug",
    titleEn: "Bugfix template",
    whenEs: "Cuando hay error reproducible o regresion funcional.",
    whenEn: "When there is a reproducible error or functional regression.",
    goalPlaceholderEs: "bug exacto a corregir",
    goalPlaceholderEn: "exact bug to fix"
  },
  refactor: {
    titleEs: "Plantilla de refactor seguro",
    titleEn: "Safe refactor template",
    whenEs: "Cuando se mejora estructura sin cambiar comportamiento esperado.",
    whenEn: "When improving structure without changing expected behavior.",
    goalPlaceholderEs: "deuda tecnica a reducir",
    goalPlaceholderEn: "technical debt to reduce"
  },
  analysis: {
    titleEs: "Plantilla de analisis tecnico",
    titleEn: "Technical analysis template",
    whenEs: "Cuando se necesita diagnostico previo antes de implementar.",
    whenEn: "When diagnosis is needed before implementation.",
    goalPlaceholderEs: "pregunta tecnica a responder",
    goalPlaceholderEn: "technical question to answer"
  },
  docs: {
    titleEs: "Plantilla de documentacion",
    titleEn: "Documentation template",
    whenEs: "Cuando la tarea principal es actualizar o crear documentacion.",
    whenEn: "When the main task is updating or creating documentation.",
    goalPlaceholderEs: "documento y mejora esperada",
    goalPlaceholderEn: "document and expected improvement"
  },
  automation: {
    titleEs: "Plantilla de automatizacion",
    titleEn: "Automation template",
    whenEs: "Cuando se automatiza un flujo de validacion/generacion repetitiva.",
    whenEn: "When automating repetitive validation/generation workflows.",
    goalPlaceholderEs: "flujo a automatizar",
    goalPlaceholderEn: "workflow to automate"
  },
  custom: {
    titleEs: "Plantilla generica",
    titleEn: "Generic template",
    whenEs: "Cuando la tarea no encaja en una categoria concreta.",
    whenEn: "When the task does not match a specific category.",
    goalPlaceholderEs: "objetivo de la tarea",
    goalPlaceholderEn: "task objective"
  }
};
