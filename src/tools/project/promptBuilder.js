import { z } from "zod";
import { resolveLanguage, t } from "../../utils/language.js";

const TASK_TYPES = ["feature", "bugfix", "refactor", "analysis", "docs", "automation", "custom"];
const TARGETS = ["codex", "claude", "generic"];
const STYLES = ["full", "compact", "both"];

const inputSchema = z.object({
  taskType: z.enum(TASK_TYPES).optional(),
  goal: z.string().min(5).max(800),
  deliverable: z.string().min(3).max(240).optional(),
  contextSummary: z.string().min(5).max(2400).optional(),
  constraints: z.array(z.string().min(2).max(240)).max(40).optional(),
  acceptanceCriteria: z.array(z.string().min(2).max(240)).max(40).optional(),
  inScope: z.array(z.string().min(2).max(240)).max(40).optional(),
  outOfScope: z.array(z.string().min(2).max(240)).max(40).optional(),
  extraInstructions: z.string().max(2400).optional(),
  targetAi: z.enum(TARGETS).optional(),
  style: z.enum(STYLES).optional(),
  includeChecklist: z.boolean().optional(),
  includeOutputContract: z.boolean().optional(),
  maxBulletsPerSection: z.number().int().min(1).max(12).optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

const outputSchema = z.object({
  prompt: z.object({
    full: z.string(),
    compact: z.string(),
    recommended: z.string()
  }),
  metadata: z.object({
    taskType: z.enum(TASK_TYPES),
    targetAi: z.enum(TARGETS),
    style: z.enum(STYLES),
    sectionsIncluded: z.array(z.string()),
    estimatedTokens: z.object({
      full: z.number().int().nonnegative(),
      compact: z.number().int().nonnegative()
    })
  }),
  usageHints: z.array(z.string()),
  automationPolicy: z.object({
    readOnlyGeneration: z.boolean(),
    note: z.string()
  })
});

export const promptBuilderTool = {
  name: "prompt_builder",
  description: "Build complete and compact task prompts from structured intake fields with consistent output format.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const includeChecklist = parsed.includeChecklist ?? true;
    const includeOutputContract = parsed.includeOutputContract ?? true;
    const maxBulletsPerSection = parsed.maxBulletsPerSection ?? 6;

    const normalized = {
      taskType: parsed.taskType ?? "custom",
      targetAi: parsed.targetAi ?? "codex",
      style: parsed.style ?? "both",
      goal: sanitizeText(parsed.goal, 800),
      deliverable: sanitizeText(parsed.deliverable, 240),
      contextSummary: sanitizeText(parsed.contextSummary, 2400),
      constraints: normalizeList(parsed.constraints, maxBulletsPerSection),
      acceptanceCriteria: normalizeList(parsed.acceptanceCriteria, maxBulletsPerSection),
      inScope: normalizeList(parsed.inScope, maxBulletsPerSection),
      outOfScope: normalizeList(parsed.outOfScope, maxBulletsPerSection),
      extraInstructions: sanitizeText(parsed.extraInstructions, 2400)
    };

    const full = buildFullPrompt({
      language,
      includeChecklist,
      includeOutputContract,
      normalized
    });
    const compact = buildCompactPrompt({
      language,
      normalized
    });
    const recommended = normalized.style === "full"
      ? full
      : normalized.style === "compact"
        ? compact
        : full;
    const sectionsIncluded = collectSections({
      includeChecklist,
      includeOutputContract,
      normalized
    });

    return outputSchema.parse({
      prompt: {
        full,
        compact,
        recommended
      },
      metadata: {
        taskType: normalized.taskType,
        targetAi: normalized.targetAi,
        style: normalized.style,
        sectionsIncluded,
        estimatedTokens: {
          full: estimateTokens(full),
          compact: estimateTokens(compact)
        }
      },
      usageHints: buildUsageHints({
        language,
        targetAi: normalized.targetAi,
        hasAcceptance: normalized.acceptanceCriteria.length > 0,
        hasConstraints: normalized.constraints.length > 0
      }),
      automationPolicy: {
        readOnlyGeneration: true,
        note: t(
          language,
          "Esta tool solo genera texto de prompt. No ejecuta codigo, tools de escritura ni operaciones Git.",
          "This tool only generates prompt text. It does not execute code, write tools, or Git operations."
        )
      }
    });
  }
};

function buildFullPrompt(input) {
  const { language, includeChecklist, includeOutputContract, normalized } = input;
  const lines = [];

  lines.push(
    t(
      language,
      "Eres un asistente tecnico orientado a ejecutar esta tarea con cambios minimos, seguros y verificables.",
      "You are a technical assistant focused on executing this task with minimal, safe, and verifiable changes."
    )
  );
  lines.push("");
  lines.push(sectionTitle(language, "Objetivo", "Goal"));
  lines.push(`- ${normalized.goal}`);

  if (normalized.contextSummary) {
    lines.push("");
    lines.push(sectionTitle(language, "Contexto", "Context"));
    lines.push(`- ${normalized.contextSummary}`);
  }

  if (normalized.inScope.length > 0) {
    lines.push("");
    lines.push(sectionTitle(language, "Alcance", "Scope"));
    for (const item of normalized.inScope) {
      lines.push(`- ${item}`);
    }
  }

  if (normalized.outOfScope.length > 0) {
    lines.push("");
    lines.push(sectionTitle(language, "Fuera de alcance", "Out of Scope"));
    for (const item of normalized.outOfScope) {
      lines.push(`- ${item}`);
    }
  }

  if (normalized.constraints.length > 0) {
    lines.push("");
    lines.push(sectionTitle(language, "Restricciones", "Constraints"));
    for (const item of normalized.constraints) {
      lines.push(`- ${item}`);
    }
  }

  if (normalized.acceptanceCriteria.length > 0) {
    lines.push("");
    lines.push(sectionTitle(language, "Criterios de aceptacion", "Acceptance Criteria"));
    for (const item of normalized.acceptanceCriteria) {
      lines.push(`- ${item}`);
    }
  }

  if (normalized.deliverable) {
    lines.push("");
    lines.push(sectionTitle(language, "Entregable esperado", "Expected Deliverable"));
    lines.push(`- ${normalized.deliverable}`);
  }

  if (includeOutputContract) {
    lines.push("");
    lines.push(sectionTitle(language, "Formato de respuesta", "Response Format"));
    lines.push(t(language, "- Resume cambios de forma breve y directa.", "- Summarize changes briefly and directly."));
    lines.push(t(language, "- Incluye archivos tocados y validaciones ejecutadas.", "- Include touched files and executed validations."));
    lines.push(t(language, "- Si algo no se pudo ejecutar, indicalo explicitamente.", "- If something could not be executed, state it explicitly."));
  }

  if (normalized.targetAi === "codex") {
    lines.push("");
    lines.push(sectionTitle(language, "Preferencia de ejecucion", "Execution Preference"));
    lines.push(t(language, "- Usa primero herramientas MCP relevantes antes de cambios manuales.", "- Use relevant MCP tools first before manual edits."));
  }

  if (normalized.extraInstructions) {
    lines.push("");
    lines.push(sectionTitle(language, "Indicaciones adicionales", "Additional Instructions"));
    lines.push(`- ${normalized.extraInstructions}`);
  }

  if (includeChecklist) {
    lines.push("");
    lines.push(sectionTitle(language, "Checklist de cierre", "Completion Checklist"));
    lines.push(t(language, "- [ ] Cambios aplicados de forma minima y segura.", "- [ ] Changes applied in a minimal and safe way."));
    lines.push(t(language, "- [ ] Validaciones relevantes ejecutadas.", "- [ ] Relevant validations executed."));
    lines.push(t(language, "- [ ] Riesgos y limites documentados en la salida.", "- [ ] Risks and limits documented in the output."));
  }

  return lines.join("\n").trim();
}

function buildCompactPrompt(input) {
  const { language, normalized } = input;
  const lines = [];
  lines.push(
    t(
      language,
      `Tarea (${normalized.taskType}): ${normalized.goal}`,
      `Task (${normalized.taskType}): ${normalized.goal}`
    )
  );

  if (normalized.inScope.length > 0) {
    lines.push(
      t(
        language,
        `Alcance: ${normalized.inScope.join("; ")}.`,
        `Scope: ${normalized.inScope.join("; ")}.`
      )
    );
  }

  if (normalized.constraints.length > 0) {
    lines.push(
      t(
        language,
        `Restricciones: ${normalized.constraints.join("; ")}.`,
        `Constraints: ${normalized.constraints.join("; ")}.`
      )
    );
  }

  if (normalized.acceptanceCriteria.length > 0) {
    lines.push(
      t(
        language,
        `Aceptacion: ${normalized.acceptanceCriteria.join("; ")}.`,
        `Acceptance: ${normalized.acceptanceCriteria.join("; ")}.`
      )
    );
  }

  if (normalized.deliverable) {
    lines.push(
      t(
        language,
        `Entrega esperada: ${normalized.deliverable}.`,
        `Expected output: ${normalized.deliverable}.`
      )
    );
  }

  if (normalized.targetAi === "codex") {
    lines.push(
      t(
        language,
        "Usa primero las herramientas MCP relevantes y valida antes de cerrar.",
        "Use relevant MCP tools first and validate before closing."
      )
    );
  }

  return lines.join("\n").trim();
}

function collectSections(input) {
  const { includeChecklist, includeOutputContract, normalized } = input;
  const sections = ["goal"];
  if (normalized.contextSummary) {
    sections.push("context");
  }
  if (normalized.inScope.length > 0) {
    sections.push("inScope");
  }
  if (normalized.outOfScope.length > 0) {
    sections.push("outOfScope");
  }
  if (normalized.constraints.length > 0) {
    sections.push("constraints");
  }
  if (normalized.acceptanceCriteria.length > 0) {
    sections.push("acceptanceCriteria");
  }
  if (normalized.deliverable) {
    sections.push("deliverable");
  }
  if (includeOutputContract) {
    sections.push("responseFormat");
  }
  if (normalized.extraInstructions) {
    sections.push("extraInstructions");
  }
  if (includeChecklist) {
    sections.push("checklist");
  }
  return sections;
}

function buildUsageHints(input) {
  const { language, targetAi, hasAcceptance, hasConstraints } = input;
  const hints = [];
  if (targetAi === "codex") {
    hints.push(
      t(
        language,
        "Para Codex, envia primero la version compacta y usa la version full solo si falta contexto.",
        "For Codex, send compact version first and use full only if more context is required."
      )
    );
  }
  if (!hasAcceptance) {
    hints.push(
      t(
        language,
        "Anade criterios de aceptacion antes de ejecutar para reducir ida/vuelta.",
        "Add acceptance criteria before execution to reduce back-and-forth."
      )
    );
  }
  if (!hasConstraints) {
    hints.push(
      t(
        language,
        "Incluye al menos una restriccion tecnica para evitar cambios fuera de politica.",
        "Include at least one technical constraint to avoid out-of-policy changes."
      )
    );
  }
  if (hints.length === 0) {
    hints.push(
      t(
        language,
        "Prompt listo para ejecucion; si necesitas ajustar coste, usa `prompt_token_budget`.",
        "Prompt is execution-ready; if you need cost tuning, use `prompt_token_budget`."
      )
    );
  }
  return hints;
}

function sectionTitle(language, esTitle, enTitle) {
  return t(language, `${esTitle}:`, `${enTitle}:`);
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
