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
  maxReviewers: z.number().int().min(1).max(10).optional(),
  useBlame: z.boolean().optional(),
  maxRangesPerFile: z.number().int().min(1).max(20).optional(),
  maxFilesWithBlame: z.number().int().min(1).max(500).optional()
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
  blamedLines: z.number().int().nonnegative(),
  recencyScore: z.number().int().nonnegative(),
  lastTouchedAt: z.string().nullable(),
  files: z.array(z.string()),
  confidence: z.enum(CONFIDENCE_LEVELS)
});

const zoneOwnerSchema = z.object({
  name: z.string(),
  email: z.string().nullable(),
  lines: z.number().int().nonnegative(),
  lastTouchedAt: z.string().nullable()
});

const fileOwnershipSchema = z.object({
  path: z.string(),
  status: z.string(),
  lastAuthor: z.object({
    name: z.string(),
    email: z.string().nullable()
  }).nullable(),
  lastActivityAt: z.string().nullable(),
  topZoneOwners: z.array(zoneOwnerSchema),
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
  description: "Trace likely code ownership for changed files using Git history + blame recency to suggest more accurate reviewers.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const maxOwners = parsed.maxOwners ?? 8;
    const maxReviewers = parsed.maxReviewers ?? 4;
    const useBlame = parsed.useBlame ?? true;
    const maxRangesPerFile = parsed.maxRangesPerFile ?? 8;
    const maxFilesWithBlame = parsed.maxFilesWithBlame ?? 80;
    const nowMs = Date.now();
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
    let blameSkippedByLimit = 0;

    for (let index = 0; index < diff.files.length; index += 1) {
      const file = diff.files[index];
      const lastAuthor = await resolveLastAuthor(context.rootDir, file.path, parsed.timeoutMs);
      const shouldRunBlame = useBlame
        && index < maxFilesWithBlame
        && canRunBlame({
          mode: diff.scope.mode,
          status: file.status
        });
      if (useBlame && !shouldRunBlame && index >= maxFilesWithBlame) {
        blameSkippedByLimit += 1;
      }
      const zoneOwners = shouldRunBlame
        ? await resolveZoneOwners({
          rootDir: context.rootDir,
          filePath: file.path,
          mode: diff.scope.mode,
          status: file.status,
          baseRef: parsed.baseRef ?? null,
          targetRef: parsed.targetRef ?? "HEAD",
          timeoutMs: parsed.timeoutMs,
          maxRangesPerFile
        })
        : [];
      const confidence = inferConfidence({
        status: file.status,
        lastAuthor,
        editCount: file.additions + file.deletions,
        zoneOwners
      });
      fileOwnership.push({
        path: file.path,
        status: file.status,
        lastAuthor: lastAuthor
          ? {
            name: lastAuthor.name,
            email: lastAuthor.email
          }
          : null,
        lastActivityAt: lastAuthor?.committedAt ?? null,
        topZoneOwners: zoneOwners
          .slice(0, 3)
          .map((owner) => ({
            name: owner.name,
            email: owner.email,
            lines: owner.lines,
            lastTouchedAt: owner.lastTouchedAt
          })),
        confidence
      });

      const baseImpact = Math.max(1, file.additions + file.deletions);
      if (zoneOwners.length > 0) {
        const baseImpactShare = Math.max(1, Math.floor(baseImpact / zoneOwners.length));
        for (const owner of zoneOwners) {
          addOwnerContribution({
            ownerMap,
            filePath: file.path,
            owner,
            baseImpact: baseImpactShare,
            nowMs
          });
        }
      } else if (lastAuthor) {
        addOwnerContribution({
          ownerMap,
          filePath: file.path,
          owner: {
            name: lastAuthor.name,
            email: lastAuthor.email,
            lines: 0,
            timestamp: lastAuthor.timestamp,
            lastTouchedAt: lastAuthor.committedAt
          },
          baseImpact,
          nowMs
        });
      }
    }

    const owners = Array.from(ownerMap.values())
      .map((owner) => ({
        name: owner.name,
        email: owner.email,
        touchedFiles: owner.fileSet.size,
        weightedImpact: owner.weightedImpact,
        blamedLines: owner.blamedLines,
        recencyScore: owner.recencyScore,
        lastTouchedAt: owner.lastTouchedTs ? new Date(owner.lastTouchedTs).toISOString() : null,
        files: Array.from(owner.fileSet).sort((a, b) => a.localeCompare(b)),
        confidence: inferOwnerConfidence(owner.fileSet.size, owner.weightedImpact, owner.recencyScore)
      }))
      .sort((a, b) => (
        b.weightedImpact - a.weightedImpact
        || b.recencyScore - a.recencyScore
        || b.touchedFiles - a.touchedFiles
        || a.name.localeCompare(b.name)
      ))
      .slice(0, maxOwners);

    const reviewerSuggestions = owners
      .slice(0, maxReviewers)
      .map((owner) => owner.email ? `${owner.name} <${owner.email}>` : owner.name);

    const notes = [];
    if (diff.files.some((file) => file.status === "untracked")) {
      notes.push(t(language, "Los archivos untracked aun no tienen historial de ownership.", "Untracked files have no ownership history yet."));
    }
    if (useBlame) {
      notes.push(t(language, "Se priorizo ownership por zonas cambiadas (`git blame`) y recencia.", "Ownership was prioritized by changed zones (`git blame`) and recency."));
      if (blameSkippedByLimit > 0) {
        notes.push(
          t(
            language,
            `Se omitio blame en ${blameSkippedByLimit} archivo(s) por limite de rendimiento (maxFilesWithBlame=${maxFilesWithBlame}).`,
            `Blame was skipped for ${blameSkippedByLimit} file(s) due to performance limit (maxFilesWithBlame=${maxFilesWithBlame}).`
          )
        );
      }
    } else {
      notes.push(t(language, "Blame desactivado: se uso solo historial de archivo.", "Blame disabled: file-level history only was used."));
    }
    if (reviewerSuggestions.length === 0) {
      notes.push(t(language, "No se encontro historial de ownership para el diff actual.", "No historical ownership data was found for current diff."));
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
    const output = await runGitInRepository(["log", "-1", "--format=%an|%ae|%cI|%ct", "--", relativePath], {
      cwd: rootDir,
      timeoutMs
    });
    const value = output.trim();
    if (!value) {
      return null;
    }
    const [nameRaw, emailRaw, committedAtRaw, timestampRaw] = value.split("|");
    const name = (nameRaw ?? "").trim();
    const email = (emailRaw ?? "").trim();
    if (!name) {
      return null;
    }
    const committedAt = (committedAtRaw ?? "").trim() || null;
    const timestampSeconds = Number.parseInt((timestampRaw ?? "").trim(), 10);
    return {
      name,
      email: email || null,
      committedAt,
      timestamp: Number.isFinite(timestampSeconds) ? timestampSeconds * 1000 : null
    };
  } catch {
    return null;
  }
}

function inferConfidence(input) {
  if (!input.lastAuthor || input.status === "untracked" || input.status === "added") {
    return "low";
  }
  const topZone = input.zoneOwners[0] ?? null;
  if (topZone && topZone.lines >= 8) {
    return "high";
  }
  if (input.editCount >= 10 || input.zoneOwners.length > 0) {
    return "medium";
  }
  return "medium";
}

function inferOwnerConfidence(touchedFiles, weightedImpact, recencyScore) {
  if (touchedFiles >= 3 || weightedImpact >= 140 || recencyScore >= 90) {
    return "high";
  }
  if (touchedFiles >= 2 || weightedImpact >= 45 || recencyScore >= 30) {
    return "medium";
  }
  return "low";
}

function canRunBlame(input) {
  if (input.status === "untracked" || input.status === "unknown") {
    return false;
  }
  if (input.mode === "range" && input.status === "deleted") {
    return false;
  }
  return true;
}

async function resolveZoneOwners(options) {
  const ranges = await resolveChangedRanges(options);
  if (ranges.length === 0) {
    return [];
  }
  const side = options.mode === "range" ? "new" : "old";
  const blameRef = side === "new" ? options.targetRef : "HEAD";
  const aggregate = new Map();

  for (const range of ranges) {
    const blamedLines = await blameRange({
      rootDir: options.rootDir,
      filePath: options.filePath,
      ref: blameRef,
      range,
      timeoutMs: options.timeoutMs
    });
    for (const line of blamedLines) {
      if (!line.name) {
        continue;
      }
      const key = `${line.name.toLowerCase()}|${(line.email ?? "").toLowerCase()}`;
      const current = aggregate.get(key) ?? {
        name: line.name,
        email: line.email,
        lines: 0,
        lastTouchedTs: null
      };
      current.lines += 1;
      if (line.timestamp && (!current.lastTouchedTs || line.timestamp > current.lastTouchedTs)) {
        current.lastTouchedTs = line.timestamp;
      }
      aggregate.set(key, current);
    }
  }

  return Array.from(aggregate.values())
    .map((item) => ({
      name: item.name,
      email: item.email,
      lines: item.lines,
      timestamp: item.lastTouchedTs,
      lastTouchedAt: item.lastTouchedTs ? new Date(item.lastTouchedTs).toISOString() : null
    }))
    .sort((a, b) => b.lines - a.lines || (b.timestamp ?? 0) - (a.timestamp ?? 0) || a.name.localeCompare(b.name));
}

async function resolveChangedRanges(options) {
  const diffArgs = ["diff", "--unified=0"];
  if (options.mode === "staged") {
    diffArgs.push("--cached", "--", options.filePath);
  } else if (options.mode === "working_tree") {
    diffArgs.push("HEAD", "--", options.filePath);
  } else {
    diffArgs.push(`${options.baseRef}...${options.targetRef}`, "--", options.filePath);
  }

  try {
    const output = await runGitInRepository(diffArgs, {
      cwd: options.rootDir,
      timeoutMs: options.timeoutMs
    });
    const side = options.mode === "range" ? "new" : "old";
    return parseHunkRanges(output, side, options.maxRangesPerFile);
  } catch {
    return [];
  }
}

function parseHunkRanges(diffText, side, maxRangesPerFile) {
  const ranges = [];
  const regex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  let match;
  while ((match = regex.exec(diffText)) !== null) {
    const oldStart = Number.parseInt(match[1], 10);
    const oldCount = match[2] ? Number.parseInt(match[2], 10) : 1;
    const newStart = Number.parseInt(match[3], 10);
    const newCount = match[4] ? Number.parseInt(match[4], 10) : 1;
    const start = side === "new" ? newStart : oldStart;
    const count = side === "new" ? newCount : oldCount;
    if (!Number.isFinite(start) || !Number.isFinite(count) || count <= 0) {
      continue;
    }
    ranges.push({
      start,
      end: start + count - 1
    });
    if (ranges.length >= maxRangesPerFile) {
      break;
    }
  }
  return ranges;
}

async function blameRange(options) {
  try {
    const output = await runGitInRepository(
      ["blame", "--line-porcelain", "-L", `${options.range.start},${options.range.end}`, options.ref, "--", options.filePath],
      {
        cwd: options.rootDir,
        timeoutMs: options.timeoutMs
      }
    );
    return parseBlamePorcelain(output);
  } catch {
    return [];
  }
}

function parseBlamePorcelain(output) {
  const records = [];
  let author = null;
  let email = null;
  let timestamp = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("author ")) {
      author = line.slice("author ".length).trim();
      continue;
    }
    if (line.startsWith("author-mail ")) {
      const raw = line.slice("author-mail ".length).trim();
      email = raw.replace(/^<|>$/g, "") || null;
      continue;
    }
    if (line.startsWith("author-time ")) {
      const raw = Number.parseInt(line.slice("author-time ".length).trim(), 10);
      timestamp = Number.isFinite(raw) ? raw * 1000 : null;
      continue;
    }
    if (line.startsWith("\t")) {
      if (author) {
        records.push({
          name: author,
          email,
          timestamp
        });
      }
      author = null;
      email = null;
      timestamp = null;
    }
  }
  return records;
}

function addOwnerContribution(input) {
  const key = `${input.owner.name.toLowerCase()}|${(input.owner.email ?? "").toLowerCase()}`;
  const current = input.ownerMap.get(key) ?? {
    name: input.owner.name,
    email: input.owner.email,
    fileSet: new Set(),
    weightedImpact: 0,
    blamedLines: 0,
    recencyScore: 0,
    lastTouchedTs: null
  };
  current.fileSet.add(input.filePath);
  current.blamedLines += Math.max(0, input.owner.lines);
  const recencyPoints = computeRecencyPoints(input.owner.timestamp, input.nowMs);
  current.recencyScore += recencyPoints;
  current.weightedImpact += input.baseImpact + (Math.max(1, input.owner.lines) * 12) + recencyPoints;
  if (input.owner.timestamp && (!current.lastTouchedTs || input.owner.timestamp > current.lastTouchedTs)) {
    current.lastTouchedTs = input.owner.timestamp;
  }
  input.ownerMap.set(key, current);
}

function computeRecencyPoints(timestampMs, nowMs) {
  if (!timestampMs) {
    return 6;
  }
  const days = Math.max(0, Math.floor((nowMs - timestampMs) / (1000 * 60 * 60 * 24)));
  if (days <= 7) {
    return 48;
  }
  if (days <= 30) {
    return 30;
  }
  if (days <= 90) {
    return 18;
  }
  if (days <= 180) {
    return 10;
  }
  return 4;
}
