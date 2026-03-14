import { z } from "zod";
import { analyzeGitDiffTool } from "./analyzeGitDiff.js";
import { runGitInRepository } from "../../utils/git.js";
import { resolveLanguage, t } from "../../utils/language.js";

const DIFF_MODES = ["working_tree", "staged", "range"];
const CONFIDENCE_LEVELS = ["low", "medium", "high"];

const inputSchema = z.object({
  mode: z.enum(DIFF_MODES).optional(),
  baseRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  includeUntracked: z.boolean().optional(),
  language: z.enum(["es", "en"]).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxOwners: z.number().int().min(1).max(20).optional(),
  maxReviewers: z.number().int().min(1).max(10).optional()
}).strict().superRefine((value, ctx) => {
  const mode = value.mode ?? "working_tree";
  if (mode === "range" && !value.baseRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "baseRef is required when mode is `range`."
    });
  }
});

const ownerSchema = z.object({
  name: z.string(),
  email: z.string().nullable(),
  touchedFiles: z.number().int().nonnegative(),
  weightedImpact: z.number().int().nonnegative(),
  files: z.array(z.string()),
  confidence: z.enum(CONFIDENCE_LEVELS)
});

const fileOwnershipSchema = z.object({
  path: z.string(),
  status: z.string(),
  lastAuthor: z.object({
    name: z.string(),
    email: z.string().nullable()
  }).nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS)
});

const outputSchema = z.object({
  scope: z.object({
    mode: z.enum(DIFF_MODES),
    baseRef: z.string().nullable(),
    targetRef: z.string().nullable()
  }),
  summary: z.object({
    changedFiles: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative()
  }),
  ownership: z.object({
    owners: z.array(ownerSchema),
    fileOwnership: z.array(fileOwnershipSchema),
    reviewerSuggestions: z.array(z.string()),
    notes: z.array(z.string())
  }),
  automationPolicy: z.object({
    readOnlyGitAnalysis: z.boolean(),
    note: z.string()
  })
});

export const traceChangeOwnershipTool = {
  name: "trace_change_ownership",
  description: "Trace likely code ownership for changed files to suggest reviewers using local Git history.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const maxOwners = parsed.maxOwners ?? 8;
    const maxReviewers = parsed.maxReviewers ?? 4;
    const diff = await analyzeGitDiffTool.handler(
      {
        mode: parsed.mode,
        baseRef: parsed.baseRef,
        targetRef: parsed.targetRef,
        includeUntracked: parsed.includeUntracked,
        maxFiles: parsed.maxFiles,
        timeoutMs: parsed.timeoutMs
      },
      { context }
    );

    if (!diff.repository.gitAvailable || !diff.repository.isGitRepository) {
      return outputSchema.parse({
        scope: diff.scope,
        summary: {
          changedFiles: 0,
          additions: 0,
          deletions: 0
        },
        ownership: {
          owners: [],
          fileOwnership: [],
          reviewerSuggestions: [],
          notes: [
            !diff.repository.gitAvailable
              ? t(language, "Git no esta disponible; el trazado de ownership queda desactivado.", "Git is not available; ownership tracing is disabled.")
              : t(language, "El workspace no es un repositorio Git.", "Workspace is not a Git repository.")
          ]
        },
        automationPolicy: {
          readOnlyGitAnalysis: true,
          note: t(language, "Esta tool solo lee el historial Git y nunca modifica el estado del repositorio.", "This tool only reads Git history and never modifies repository state.")
        }
      });
    }

    const ownerMap = new Map();
    const fileOwnership = [];

    for (const file of diff.files) {
      const lastAuthor = await resolveLastAuthor(context.rootDir, file.path, parsed.timeoutMs);
      const confidence = inferConfidence(file.status, lastAuthor, file.additions + file.deletions);
      fileOwnership.push({
        path: file.path,
        status: file.status,
        lastAuthor,
        confidence
      });

      if (!lastAuthor) {
        continue;
      }
      const key = `${lastAuthor.name.toLowerCase()}|${(lastAuthor.email ?? "").toLowerCase()}`;
      const current = ownerMap.get(key) ?? {
        name: lastAuthor.name,
        email: lastAuthor.email,
        touchedFiles: 0,
        weightedImpact: 0,
        files: []
      };
      current.touchedFiles += 1;
      current.weightedImpact += Math.max(1, file.additions + file.deletions);
      current.files.push(file.path);
      ownerMap.set(key, current);
    }

    const owners = Array.from(ownerMap.values())
      .map((owner) => ({
        ...owner,
        confidence: inferOwnerConfidence(owner.touchedFiles, owner.weightedImpact)
      }))
      .sort((a, b) => b.weightedImpact - a.weightedImpact || b.touchedFiles - a.touchedFiles || a.name.localeCompare(b.name))
      .slice(0, maxOwners);

    const reviewerSuggestions = owners
      .slice(0, maxReviewers)
      .map((owner) => owner.email ? `${owner.name} <${owner.email}>` : owner.name);

    const notes = [];
    if (diff.files.some((file) => file.status === "untracked")) {
      notes.push(t(language, "Los archivos untracked aun no tienen historial de ownership.", "Untracked files have no ownership history yet."));
    }
    if (reviewerSuggestions.length === 0) {
      notes.push(t(language, "No se encontro historial de ownership para el diff actual.", "No historical ownership data was found for current diff."));
    } else {
      notes.push(t(language, "Las sugerencias de reviewers se infieren por ownership reciente a nivel de archivo, no por politica de equipo.", "Reviewer suggestions are inferred from recent file-level ownership, not team policy."));
    }

    return outputSchema.parse({
      scope: diff.scope,
      summary: {
        changedFiles: diff.summary.changedFiles,
        additions: diff.summary.additions,
        deletions: diff.summary.deletions
      },
      ownership: {
        owners,
        fileOwnership,
        reviewerSuggestions,
        notes
      },
      automationPolicy: {
        readOnlyGitAnalysis: true,
        note: t(language, "Esta tool solo lee el historial Git y nunca modifica el estado del repositorio.", "This tool only reads Git history and never modifies repository state.")
      }
    });
  }
};

async function resolveLastAuthor(rootDir, relativePath, timeoutMs) {
  try {
    const output = await runGitInRepository(["log", "-1", "--format=%an|%ae", "--", relativePath], {
      cwd: rootDir,
      timeoutMs
    });
    const value = output.trim();
    if (!value) {
      return null;
    }
    const [nameRaw, emailRaw] = value.split("|");
    const name = (nameRaw ?? "").trim();
    const email = (emailRaw ?? "").trim();
    if (!name) {
      return null;
    }
    return {
      name,
      email: email || null
    };
  } catch {
    return null;
  }
}

function inferConfidence(status, lastAuthor, editCount) {
  if (!lastAuthor || status === "untracked" || status === "added") {
    return "low";
  }
  if (editCount >= 40) {
    return "high";
  }
  if (editCount >= 10) {
    return "medium";
  }
  return "medium";
}

function inferOwnerConfidence(touchedFiles, weightedImpact) {
  if (touchedFiles >= 3 || weightedImpact >= 80) {
    return "high";
  }
  if (touchedFiles >= 2 || weightedImpact >= 20) {
    return "medium";
  }
  return "low";
}
