import { z } from "zod";
import { analyzeGitDiffTool } from "./analyzeGitDiff.js";
import { fileExists, readJsonFile, searchFiles } from "../../utils/fileSystem.js";
import { resolveLanguage, t } from "../../utils/language.js";

const TASK_TYPES = ["feature", "bugfix", "refactor", "analysis", "docs", "automation", "custom"];
const DIFF_MODES = ["working_tree", "staged", "range"];
const SOURCE_TYPES = ["git_diff", "context_index", "keyword_match", "mandatory"];
const DEFAULT_CONTEXT_INDEX_PATH = ".codex/mcp/context/context-index.json";

const inputSchema = z.object({
  taskType: z.enum(TASK_TYPES).optional(),
  goal: z.string().min(3).max(800).optional(),
  prompt: z.string().min(10).max(16000).optional(),
  queryTerms: z.array(z.string().min(2).max(80)).max(20).optional(),
  includeGitDiff: z.boolean().optional(),
  mode: z.enum(DIFF_MODES).optional(),
  baseRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  includeUntracked: z.boolean().optional(),
  includeContextIndex: z.boolean().optional(),
  contextIndexPath: z.string().min(1).optional(),
  includeKeywordSearch: z.boolean().optional(),
  maxFiles: z.number().int().min(1).max(60).optional(),
  maxKeywordMatchesPerTerm: z.number().int().min(1).max(100).optional(),
  language: z.enum(["es", "en"]).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional()
}).strict().superRefine((value, ctx) => {
  const mode = value.mode ?? "working_tree";
  if (mode === "range" && !value.baseRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "baseRef is required when mode is `range`."
    });
  }
});

const selectedPathSchema = z.object({
  path: z.string(),
  score: z.number().int().min(0).max(1000),
  estimatedTokens: z.number().int().nonnegative(),
  sources: z.array(z.enum(SOURCE_TYPES)),
  reasons: z.array(z.string())
});

const outputSchema = z.object({
  scope: z.object({
    taskType: z.enum(TASK_TYPES),
    queryTerms: z.array(z.string()),
    maxFiles: z.number().int().min(1).max(60)
  }),
  strategy: z.object({
    usedGitDiff: z.boolean(),
    usedContextIndex: z.boolean(),
    usedKeywordSearch: z.boolean(),
    contextIndexPath: z.string().nullable()
  }),
  selectedPaths: z.array(selectedPathSchema),
  droppedPaths: z.array(selectedPathSchema.extend({
    dropReason: z.string()
  })),
  suggestions: z.object({
    promptContextLines: z.array(z.string()),
    recommendedContextTokens: z.number().int().nonnegative()
  }),
  notes: z.array(z.string()),
  automationPolicy: z.object({
    readOnlyAnalysis: z.boolean(),
    note: z.string()
  })
});

export const promptContextSelectorTool = {
  name: "prompt_context_selector",
  description: "Select the minimum high-value file context for a prompt using git diff, context-index hints, and keyword relevance.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const selectedTaskType = parsed.taskType ?? inferTaskType(parsed.goal, parsed.prompt);
    const includeGitDiff = parsed.includeGitDiff ?? true;
    const includeContextIndex = parsed.includeContextIndex ?? true;
    const includeKeywordSearch = parsed.includeKeywordSearch ?? true;
    const maxFiles = parsed.maxFiles ?? 8;
    const maxKeywordMatchesPerTerm = parsed.maxKeywordMatchesPerTerm ?? 20;
    const contextIndexPath = normalizePath(parsed.contextIndexPath ?? DEFAULT_CONTEXT_INDEX_PATH);
    const timeoutMs = parsed.timeoutMs;
    const notes = [];
    const candidates = new Map();
    const queryTerms = buildQueryTerms(parsed);
    const mandatoryPaths = new Set();

    let usedGitDiff = false;
    let usedContextIndex = false;
    let usedKeywordSearch = false;

    if (includeGitDiff) {
      try {
        const diff = await analyzeGitDiffTool.handler(
          {
            mode: parsed.mode,
            baseRef: parsed.baseRef,
            targetRef: parsed.targetRef,
            includeUntracked: parsed.includeUntracked,
            language: parsed.language,
            maxFiles: 300,
            timeoutMs
          },
          { context }
        );
        usedGitDiff = diff.repository.gitAvailable && diff.repository.isGitRepository;
        for (const file of diff.files) {
          addCandidate(candidates, {
            path: normalizePath(file.path),
            score: scoreFromGitDiff(file),
            estimatedTokens: estimateTokensFromDiffFile(file),
            source: "git_diff",
            reason: t(
              language,
              `Detectado en diff Git con estado ${file.status}.`,
              `Detected in Git diff with ${file.status} status.`
            )
          });
        }
        if (!usedGitDiff) {
          notes.push(
            t(
              language,
              "No se pudo usar diff Git (repositorio no disponible o no inicializado).",
              "Git diff could not be used (repository unavailable or not initialized)."
            )
          );
        }
      } catch {
        notes.push(
          t(
            language,
            "Falló el analisis de diff Git; se continua con otras fuentes de contexto.",
            "Git diff analysis failed; continuing with other context sources."
          )
        );
      }
    }

    if (includeContextIndex && await fileExists(contextIndexPath, context.rootDir)) {
      try {
        const index = await readJsonFile(contextIndexPath, context.rootDir);
        const parsedIndex = contextIndexSchema.safeParse(index);
        if (parsedIndex.success) {
          usedContextIndex = true;
          const profileHints = resolveProfileHints(parsedIndex.data, selectedTaskType);
          for (const mandatoryPath of profileHints.mandatoryPaths) {
            const normalized = normalizePath(mandatoryPath);
            mandatoryPaths.add(normalized);
            addCandidate(candidates, {
              path: normalized,
              score: 120,
              estimatedTokens: 110,
              source: "mandatory",
              reason: t(language, "Ruta obligatoria segun policy/context index.", "Mandatory path from policy/context index.")
            });
          }

          const chunkScores = scoreChunksFromQuery(parsedIndex.data.chunks, queryTerms);
          for (const row of chunkScores) {
            addCandidate(candidates, {
              path: row.path,
              score: row.score,
              estimatedTokens: row.estimatedTokens,
              source: "context_index",
              reason: t(language, "Relevancia detectada en context-index.", "Relevance detected in context-index.")
            });
          }
        } else {
          notes.push(
            t(
              language,
              "El context-index existe pero no cumple schema esperado.",
              "Context index exists but does not match expected schema."
            )
          );
        }
      } catch {
        notes.push(
          t(
            language,
            "No se pudo leer context-index; se usan solo fuentes restantes.",
            "Context index could not be read; using remaining sources only."
          )
        );
      }
    } else if (includeContextIndex) {
      notes.push(
        t(
          language,
          "No se encontro context-index; considera ejecutar `build_ai_context_index`.",
          "Context index not found; consider running `build_ai_context_index`."
        )
      );
    }

    if (includeKeywordSearch && queryTerms.length > 0) {
      usedKeywordSearch = true;
      for (const queryTerm of queryTerms.slice(0, 8)) {
        try {
          const matches = await searchFiles(queryTerm, {
            root: context.rootDir,
            maxResults: maxKeywordMatchesPerTerm
          });
          const limited = matches.slice(0, maxKeywordMatchesPerTerm);
          for (let index = 0; index < limited.length; index += 1) {
            const matchPath = normalizePath(limited[index]);
            const rankBoost = Math.max(0, 25 - (index * 2));
            addCandidate(candidates, {
              path: matchPath,
              score: 20 + rankBoost,
              estimatedTokens: 140,
              source: "keyword_match",
              reason: t(
                language,
                `Coincidencia por termino "${queryTerm}".`,
                `Matched by term "${queryTerm}".`
              )
            });
          }
        } catch {
          notes.push(
            t(
              language,
              `Busqueda por termino fallida: ${queryTerm}.`,
              `Search failed for term: ${queryTerm}.`
            )
          );
        }
      }
    }

    const ranked = Array.from(candidates.values())
      .map((item) => ({
        ...item,
        sources: Array.from(item.sources).sort(),
        reasons: Array.from(item.reasons).sort()
      }))
      .sort((a, b) => b.score - a.score || b.estimatedTokens - a.estimatedTokens || a.path.localeCompare(b.path));

    const selected = [];
    const dropped = [];
    for (const item of ranked) {
      if (selected.length < maxFiles || item.sources.includes("mandatory")) {
        selected.push(item);
      } else {
        dropped.push({
          ...item,
          dropReason: t(language, "Fuera de top por limite de maxFiles.", "Outside top due to maxFiles limit.")
        });
      }
    }

    const selectedSorted = selected
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, Math.max(maxFiles, mandatoryPaths.size));
    const recommendedContextTokens = selectedSorted.reduce((acc, item) => acc + item.estimatedTokens, 0);
    const promptContextLines = selectedSorted.map((item, index) =>
      `${index + 1}. ${item.path} (${item.estimatedTokens} tok aprox)`
    );

    if (selectedSorted.length === 0) {
      notes.push(
        t(
          language,
          "No se detectaron rutas candidatas; aporta `queryTerms` o `goal` para mejorar el selector.",
          "No candidate paths were detected; provide `queryTerms` or `goal` to improve selection."
        )
      );
    }

    return outputSchema.parse({
      scope: {
        taskType: selectedTaskType,
        queryTerms,
        maxFiles
      },
      strategy: {
        usedGitDiff,
        usedContextIndex,
        usedKeywordSearch,
        contextIndexPath: usedContextIndex ? contextIndexPath : null
      },
      selectedPaths: selectedSorted,
      droppedPaths: dropped.slice(0, 30),
      suggestions: {
        promptContextLines,
        recommendedContextTokens
      },
      notes,
      automationPolicy: {
        readOnlyAnalysis: true,
        note: t(
          language,
          "Esta tool solo propone contexto para prompts. No modifica archivos ni ejecuta acciones Git.",
          "This tool only suggests prompt context. It does not modify files or execute Git actions."
        )
      }
    });
  }
};

const contextIndexSchema = z.object({
  qualityGuards: z.object({
    mandatoryPaths: z.array(z.string()).optional()
  }).optional(),
  retrievalProfiles: z.array(z.object({
    id: z.string(),
    queryHints: z.array(z.string()).optional(),
    mandatoryPaths: z.array(z.string()).optional()
  })).optional(),
  chunks: z.array(z.object({
    path: z.string(),
    charLength: z.number().int().nonnegative().optional(),
    priority: z.number().int().nonnegative().optional(),
    keywords: z.array(z.string()).optional(),
    summary: z.string().optional()
  })).optional()
}).passthrough();

function buildQueryTerms(parsed) {
  const explicit = normalizeTerms(parsed.queryTerms ?? []);
  const inferred = normalizeTerms([
    ...(parsed.goal ? tokenize(parsed.goal) : []),
    ...(parsed.prompt ? tokenize(parsed.prompt).slice(0, 20) : []),
    parsed.taskType ?? ""
  ]);
  const merged = Array.from(new Set([...explicit, ...inferred]));
  return merged.slice(0, 15);
}

function normalizeTerms(values) {
  const set = new Set();
  for (const raw of values) {
    const term = String(raw ?? "").toLowerCase().trim();
    if (!term || STOPWORDS.has(term) || term.length < 3) {
      continue;
    }
    set.add(term);
  }
  return Array.from(set);
}

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/i)
    .filter(Boolean);
}

function inferTaskType(goal, prompt) {
  const text = `${goal ?? ""} ${prompt ?? ""}`.toLowerCase();
  if (!text.trim()) {
    return "custom";
  }
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
  return "feature";
}

function resolveProfileHints(index, taskType) {
  const hints = {
    mandatoryPaths: new Set(index?.qualityGuards?.mandatoryPaths ?? [])
  };

  const profileMap = {
    feature: "feature-implementation",
    bugfix: "bugfix-targeted",
    refactor: "refactor-safe",
    analysis: "bugfix-targeted",
    docs: "feature-implementation",
    automation: "refactor-safe",
    custom: "feature-implementation"
  };
  const profileId = profileMap[taskType] ?? "feature-implementation";
  const profile = (index.retrievalProfiles ?? []).find((item) => item.id === profileId);
  for (const mandatoryPath of profile?.mandatoryPaths ?? []) {
    hints.mandatoryPaths.add(mandatoryPath);
  }
  return {
    mandatoryPaths: Array.from(hints.mandatoryPaths)
      .map((item) => normalizePath(item))
      .sort()
  };
}

function scoreChunksFromQuery(chunks, queryTerms) {
  const byPath = new Map();
  for (const chunk of chunks ?? []) {
    const keywords = (chunk.keywords ?? []).map((item) => String(item).toLowerCase());
    const summary = String(chunk.summary ?? "").toLowerCase();
    let matches = 0;
    for (const queryTerm of queryTerms) {
      if (keywords.includes(queryTerm) || summary.includes(queryTerm)) {
        matches += 1;
      }
    }
    if (matches === 0) {
      continue;
    }

    const normalizedPath = normalizePath(chunk.path);
    const current = byPath.get(normalizedPath) ?? {
      path: normalizedPath,
      score: 0,
      estimatedTokens: 0
    };
    const chunkPriority = clampNumber(chunk.priority ?? 3, 1, 9);
    const priorityBoost = Math.max(0, 10 - chunkPriority);
    current.score += (matches * 18) + priorityBoost;
    current.estimatedTokens += Math.max(40, Math.ceil((chunk.charLength ?? 480) / 4));
    byPath.set(normalizedPath, current);
  }

  return Array.from(byPath.values())
    .map((row) => ({
      ...row,
      score: Math.min(300, row.score),
      estimatedTokens: Math.min(900, row.estimatedTokens)
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 40);
}

function scoreFromGitDiff(file) {
  let score = 0;
  if (file.status === "unmerged") {
    score += 120;
  } else if (file.status === "modified") {
    score += 95;
  } else if (file.status === "added" || file.status === "renamed") {
    score += 85;
  } else if (file.status === "deleted") {
    score += 65;
  } else if (file.status === "untracked") {
    score += 50;
  } else {
    score += 40;
  }
  score += Math.min(40, Math.round((file.additions + file.deletions) / 3));
  if (file.path.endsWith(".md")) {
    score -= 10;
  }
  return Math.max(1, score);
}

function estimateTokensFromDiffFile(file) {
  if (file.status === "deleted") {
    return 80;
  }
  const base = 90 + Math.round((file.additions + file.deletions) * 1.8);
  return Math.max(60, Math.min(800, base));
}

function addCandidate(map, item) {
  const key = normalizePath(item.path);
  const current = map.get(key) ?? {
    path: key,
    score: 0,
    estimatedTokens: 0,
    sources: new Set(),
    reasons: new Set()
  };

  current.score += item.score;
  current.estimatedTokens = Math.max(current.estimatedTokens, clampNumber(item.estimatedTokens, 40, 1000));
  current.sources.add(item.source);
  current.reasons.add(item.reason);
  map.set(key, current);
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "como",
  "para",
  "con",
  "una",
  "que",
  "los",
  "las",
  "del",
  "por",
  "sin",
  "sobre",
  "task",
  "prompt",
  "project"
]);
