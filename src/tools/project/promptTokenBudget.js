import { z } from "zod";
import { resolveLanguage, t } from "../../utils/language.js";

const PRIORITIES = ["high", "medium", "low"];
const DEFAULT_MAX_TOKENS = 1400;
const DEFAULT_RESERVED_RESPONSE_TOKENS = 450;

const inputSchema = z.object({
  prompt: z.string().min(20).max(50000),
  maxTokens: z.number().int().min(200).max(32000).optional(),
  reservedForResponseTokens: z.number().int().min(50).max(16000).optional(),
  dedupeLines: z.boolean().optional(),
  preserveChecklist: z.boolean().optional(),
  contextCandidates: z.array(
    z.object({
      path: z.string().min(1),
      estimatedTokens: z.number().int().min(1).max(8000).optional(),
      priority: z.enum(PRIORITIES).optional(),
      reason: z.string().max(240).optional()
    }).strict()
  ).max(200).optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

const outputSchema = z.object({
  budget: z.object({
    maxTokens: z.number().int().nonnegative(),
    reservedForResponseTokens: z.number().int().nonnegative(),
    targetPromptTokens: z.number().int().nonnegative(),
    estimatedTokensBefore: z.number().int().nonnegative(),
    estimatedTokensAfter: z.number().int().nonnegative(),
    reductionTokens: z.number().int().nonnegative(),
    reductionRate: z.number().min(0).max(1)
  }),
  optimized: z.object({
    prompt: z.string(),
    strategy: z.array(z.string()),
    removedLines: z.number().int().nonnegative(),
    truncatedSections: z.array(z.string())
  }),
  contextSelection: z.object({
    availableTokens: z.number().int().nonnegative(),
    selected: z.array(
      z.object({
        path: z.string(),
        estimatedTokens: z.number().int().nonnegative(),
        priority: z.enum(PRIORITIES),
        reason: z.string().nullable()
      })
    ),
    dropped: z.array(
      z.object({
        path: z.string(),
        estimatedTokens: z.number().int().nonnegative(),
        priority: z.enum(PRIORITIES),
        reason: z.string().nullable(),
        dropReason: z.string()
      })
    ),
    totals: z.object({
      selectedTokens: z.number().int().nonnegative(),
      droppedTokens: z.number().int().nonnegative()
    })
  }),
  nextActions: z.array(z.string()),
  automationPolicy: z.object({
    readOnlyOptimization: z.boolean(),
    note: z.string()
  })
});

export const promptTokenBudgetTool = {
  name: "prompt_token_budget",
  description: "Optimize prompt size against a token budget and prioritize context files to minimize unnecessary token consumption.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const maxTokens = parsed.maxTokens ?? DEFAULT_MAX_TOKENS;
    const reservedForResponseTokens = parsed.reservedForResponseTokens ?? DEFAULT_RESERVED_RESPONSE_TOKENS;
    const targetPromptTokens = Math.max(80, maxTokens - reservedForResponseTokens);
    const dedupeLines = parsed.dedupeLines ?? true;
    const preserveChecklist = parsed.preserveChecklist ?? true;
    const estimatedTokensBefore = estimateTokens(parsed.prompt);

    const optimization = optimizePrompt({
      prompt: parsed.prompt,
      targetPromptTokens,
      dedupeLines,
      preserveChecklist
    });
    const estimatedTokensAfter = estimateTokens(optimization.prompt);
    const reductionTokens = Math.max(0, estimatedTokensBefore - estimatedTokensAfter);
    const reductionRate = estimatedTokensBefore > 0
      ? roundRate(reductionTokens / estimatedTokensBefore)
      : 0;
    const availableContextTokens = Math.max(0, targetPromptTokens - estimatedTokensAfter);

    const contextSelection = selectContextCandidates({
      candidates: parsed.contextCandidates ?? [],
      availableTokens: availableContextTokens,
      language
    });

    return outputSchema.parse({
      budget: {
        maxTokens,
        reservedForResponseTokens,
        targetPromptTokens,
        estimatedTokensBefore,
        estimatedTokensAfter,
        reductionTokens,
        reductionRate
      },
      optimized: {
        prompt: optimization.prompt,
        strategy: optimization.strategy,
        removedLines: optimization.removedLines,
        truncatedSections: optimization.truncatedSections
      },
      contextSelection,
      nextActions: buildNextActions({
        language,
        estimatedTokensAfter,
        targetPromptTokens,
        selectedContexts: contextSelection.selected.length
      }),
      automationPolicy: {
        readOnlyOptimization: true,
        note: t(
          language,
          "Esta tool solo compacta texto y prioriza contexto. No modifica archivos ni ejecuta operaciones Git.",
          "This tool only compacts text and prioritizes context. It does not modify files or execute Git operations."
        )
      }
    });
  }
};

function optimizePrompt(input) {
  const strategy = [];
  const originalLines = String(input.prompt ?? "").replaceAll("\r\n", "\n").split("\n");
  let lines = originalLines.map((line) => line.trimEnd());

  if (input.dedupeLines) {
    const seen = new Set();
    const deduped = [];
    for (const line of lines) {
      const key = line.trim();
      if (!key) {
        deduped.push(line);
        continue;
      }
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(line);
    }
    if (deduped.length < lines.length) {
      strategy.push("dedupe-lines");
      lines = deduped;
    }
  }

  const rows = lines.map((line, index) => ({
    index,
    line,
    normalized: line.trim(),
    priority: classifyPriority(line, input.preserveChecklist),
    critical: isCriticalLine(line, input.preserveChecklist),
    sectionHeader: /:\s*$/.test(line.trim()) && line.trim().length <= 80
  }));
  const keep = rows.map(() => true);

  const dropUntilBudget = (priorities, excludeCritical) => {
    let changed = false;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (!keep[i]) {
        continue;
      }
      if (!priorities.includes(row.priority)) {
        continue;
      }
      if (excludeCritical && row.critical) {
        continue;
      }
      keep[i] = false;
      changed = true;
      if (estimateTokens(composePrompt(rows, keep)) <= input.targetPromptTokens) {
        return changed;
      }
    }
    return changed;
  };

  if (estimateTokens(composePrompt(rows, keep)) > input.targetPromptTokens) {
    const removedLow = dropUntilBudget(["low"], true);
    if (removedLow) {
      strategy.push("drop-low-priority-lines");
    }
  }
  if (estimateTokens(composePrompt(rows, keep)) > input.targetPromptTokens) {
    const removedMedium = dropUntilBudget(["medium"], true);
    if (removedMedium) {
      strategy.push("drop-medium-priority-lines");
    }
  }
  if (estimateTokens(composePrompt(rows, keep)) > input.targetPromptTokens) {
    const removedHighNonCritical = dropUntilBudget(["high"], true);
    if (removedHighNonCritical) {
      strategy.push("drop-high-noncritical-lines");
    }
  }

  let optimizedPrompt = composePrompt(rows, keep);
  if (estimateTokens(optimizedPrompt) > input.targetPromptTokens) {
    optimizedPrompt = hardTrimToBudget(optimizedPrompt, input.targetPromptTokens);
    strategy.push("hard-trim");
  }

  if (strategy.length === 0) {
    strategy.push("no-trim-needed");
  }

  const removedLines = keep.filter((value) => !value).length;
  const truncatedSections = rows
    .filter((row, index) => row.sectionHeader && !keep[index])
    .map((row) => row.normalized);

  return {
    prompt: optimizedPrompt,
    strategy,
    removedLines,
    truncatedSections
  };
}

function selectContextCandidates(input) {
  const normalized = normalizeCandidates(input.candidates);
  const selected = [];
  const dropped = [];
  let budget = input.availableTokens;

  for (const candidate of normalized) {
    if (candidate.estimatedTokens <= budget) {
      selected.push(candidate);
      budget -= candidate.estimatedTokens;
    } else {
      dropped.push({
        ...candidate,
        dropReason: t(
          input.language,
          "Sin presupuesto restante de contexto",
          "No remaining context budget"
        )
      });
    }
  }

  return {
    availableTokens: input.availableTokens,
    selected,
    dropped,
    totals: {
      selectedTokens: selected.reduce((acc, item) => acc + item.estimatedTokens, 0),
      droppedTokens: dropped.reduce((acc, item) => acc + item.estimatedTokens, 0)
    }
  };
}

function normalizeCandidates(candidates) {
  const rows = [];
  for (const raw of candidates) {
    const path = String(raw.path ?? "").trim();
    if (!path) {
      continue;
    }
    rows.push({
      path,
      estimatedTokens: raw.estimatedTokens ?? 120,
      priority: raw.priority ?? "medium",
      reason: raw.reason ? raw.reason.trim() : null
    });
  }
  return rows.sort((a, b) => {
    const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    if (a.estimatedTokens !== b.estimatedTokens) {
      return a.estimatedTokens - b.estimatedTokens;
    }
    return a.path.localeCompare(b.path);
  });
}

function buildNextActions(input) {
  const actions = [];
  if (input.estimatedTokensAfter > input.targetPromptTokens) {
    actions.push(
      t(
        input.language,
        "El prompt sigue por encima del objetivo; reduce contexto o divide la tarea en pasos.",
        "Prompt is still above target; reduce context or split task into steps."
      )
    );
  } else {
    actions.push(
      t(
        input.language,
        "Prompt dentro de presupuesto para enviar en una sola iteracion.",
        "Prompt is within budget for single-iteration execution."
      )
    );
  }
  if (input.selectedContexts === 0) {
    actions.push(
      t(
        input.language,
        "No quedo presupuesto para contexto adicional; prioriza 1-2 archivos criticos.",
        "No budget left for extra context; prioritize 1-2 critical files."
      )
    );
  }
  if (actions.length === 1) {
    actions.push(
      t(
        input.language,
        "Si necesitas mas calidad, ejecuta `prompt_quality_gate` sobre la version optimizada.",
        "If you need higher quality, run `prompt_quality_gate` on the optimized version."
      )
    );
  }
  return actions;
}

function classifyPriority(line, preserveChecklist) {
  const text = line.trim();
  if (!text) {
    return "low";
  }
  if (isCriticalLine(line, preserveChecklist)) {
    return "high";
  }
  if (/(scope|alcance|context|contexto|archivo|path|modulo|module|entrega|output|plan|pasos|steps)/i.test(text)) {
    return "medium";
  }
  return "low";
}

function isCriticalLine(line, preserveChecklist) {
  const text = line.trim();
  if (!text) {
    return false;
  }
  if (preserveChecklist && /^[-*]\s*\[( |x)\]/i.test(text)) {
    return true;
  }
  return /(objetivo|goal|acceptance|criterios? de aceptacion|restric|constraint|must|debe|do not|no romper|definition of done)/i.test(text);
}

function composePrompt(rows, keep) {
  const kept = [];
  for (let i = 0; i < rows.length; i += 1) {
    if (!keep[i]) {
      continue;
    }
    kept.push(rows[i].line);
  }
  return cleanupBlankLines(kept.join("\n"));
}

function cleanupBlankLines(text) {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hardTrimToBudget(text, budgetTokens) {
  const words = text.split(/\s+/).filter(Boolean);
  const keepWords = Math.max(1, Math.floor(budgetTokens * 0.75));
  const trimmed = words.slice(0, keepWords).join(" ");
  return trimmed.trim();
}

function estimateTokens(text) {
  const value = String(text ?? "");
  if (!value.trim()) {
    return 0;
  }
  return Math.max(1, Math.ceil(value.length / 4));
}

function roundRate(value) {
  return Math.round(value * 1000) / 1000;
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
