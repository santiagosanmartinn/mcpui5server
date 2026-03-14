import path from "node:path";
import { z } from "zod";
import { runGitInRepository, tryResolveGitRepository } from "../../utils/git.js";

const DIFF_MODES = ["working_tree", "staged", "range"];
const DEFAULT_MAX_FILES = 300;

const inputSchema = z.object({
  mode: z.enum(DIFF_MODES).optional(),
  baseRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  includeUntracked: z.boolean().optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
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

const fileSchema = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted", "renamed", "copied", "unmerged", "untracked", "unknown"]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  extension: z.string()
});

const outputSchema = z.object({
  repository: z.object({
    gitAvailable: z.boolean(),
    isGitRepository: z.boolean(),
    rootPath: z.string().nullable(),
    branch: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    headSha: z.string().nullable()
  }),
  scope: z.object({
    mode: z.enum(DIFF_MODES),
    baseRef: z.string().nullable(),
    targetRef: z.string().nullable()
  }),
  summary: z.object({
    changedFiles: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    byStatus: z.object({
      added: z.number().int().nonnegative(),
      modified: z.number().int().nonnegative(),
      deleted: z.number().int().nonnegative(),
      renamed: z.number().int().nonnegative(),
      copied: z.number().int().nonnegative(),
      unmerged: z.number().int().nonnegative(),
      untracked: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative()
    }),
    byExtension: z.array(
      z.object({
        extension: z.string(),
        count: z.number().int().nonnegative()
      })
    ),
    touches: z.object({
      docs: z.boolean(),
      tests: z.boolean(),
      controllers: z.boolean(),
      views: z.boolean(),
      manifest: z.boolean(),
      i18n: z.boolean(),
      config: z.boolean()
    })
  }),
  files: z.array(fileSchema),
  recommendations: z.array(z.string())
});

export const analyzeGitDiffTool = {
  name: "analyze_git_diff",
  description: "Analyze current Git diff scope and return structured impact summary by file, status, extension, and risk hints.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      mode,
      baseRef,
      targetRef,
      includeUntracked,
      maxFiles,
      timeoutMs
    } = inputSchema.parse(args);
    const selectedMode = mode ?? "working_tree";
    const includeUntrackedFiles = includeUntracked ?? true;
    const maxListedFiles = maxFiles ?? DEFAULT_MAX_FILES;
    const repository = await tryResolveGitRepository(context.rootDir, { timeoutMs });

    if (!repository.gitAvailable) {
      return outputSchema.parse(createEmptyResponse({
        repository,
        mode: selectedMode,
        baseRef: baseRef ?? null,
        targetRef: targetRef ?? null,
        recommendations: ["Install Git to enable diff-aware MCP tooling."]
      }));
    }

    if (!repository.isGitRepository) {
      return outputSchema.parse(createEmptyResponse({
        repository,
        mode: selectedMode,
        baseRef: baseRef ?? null,
        targetRef: targetRef ?? null,
        recommendations: ["Initialize Git (`git init`) before running diff analysis tools."]
      }));
    }

    const files = await collectDiffFiles({
      rootDir: context.rootDir,
      mode: selectedMode,
      baseRef: baseRef ?? null,
      targetRef: targetRef ?? "HEAD",
      includeUntrackedFiles,
      maxListedFiles,
      timeoutMs
    });

    const summary = buildSummary(files);
    const recommendations = buildRecommendations(summary);

    return outputSchema.parse({
      repository,
      scope: {
        mode: selectedMode,
        baseRef: selectedMode === "range" ? baseRef ?? null : null,
        targetRef: selectedMode === "range" ? (targetRef ?? "HEAD") : null
      },
      summary,
      files,
      recommendations
    });
  }
};

async function collectDiffFiles(options) {
  const {
    rootDir,
    mode,
    baseRef,
    targetRef,
    includeUntrackedFiles,
    maxListedFiles,
    timeoutMs
  } = options;

  const merged = new Map();

  if (mode === "working_tree") {
    await mergeDiffSet(merged, await collectDiffSet({
      rootDir,
      diffArgs: ["--find-renames=50%"],
      timeoutMs
    }));
    await mergeDiffSet(merged, await collectDiffSet({
      rootDir,
      diffArgs: ["--cached", "--find-renames=50%"],
      timeoutMs
    }));
  } else if (mode === "staged") {
    await mergeDiffSet(merged, await collectDiffSet({
      rootDir,
      diffArgs: ["--cached", "--find-renames=50%"],
      timeoutMs
    }));
  } else {
    await mergeDiffSet(merged, await collectDiffSet({
      rootDir,
      diffArgs: ["--find-renames=50%", `${baseRef}...${targetRef}`],
      timeoutMs
    }));
  }

  if (mode === "working_tree" && includeUntrackedFiles) {
    const untrackedOutput = await runGitInRepository(["ls-files", "--others", "--exclude-standard"], {
      cwd: rootDir,
      timeoutMs
    });
    const untrackedPaths = untrackedOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const relativePath of untrackedPaths) {
      const normalizedPath = relativePath.replaceAll("\\", "/");
      if (!merged.has(normalizedPath)) {
        merged.set(normalizedPath, {
          path: normalizedPath,
          status: "untracked",
          additions: 0,
          deletions: 0,
          extension: normalizeExtension(normalizedPath)
        });
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, maxListedFiles);
}

async function collectDiffSet(options) {
  const { rootDir, diffArgs, timeoutMs } = options;
  const [numstatOutput, statusOutput] = await Promise.all([
    runGitInRepository(["diff", "--numstat", ...diffArgs], {
      cwd: rootDir,
      timeoutMs
    }),
    runGitInRepository(["diff", "--name-status", ...diffArgs], {
      cwd: rootDir,
      timeoutMs
    })
  ]);

  const set = new Map();
  for (const line of numstatOutput.split(/\r?\n/).filter(Boolean)) {
    const parsed = parseNumstatLine(line);
    if (!parsed) {
      continue;
    }
    const entry = set.get(parsed.path) ?? createEmptyEntry(parsed.path);
    entry.additions += parsed.additions;
    entry.deletions += parsed.deletions;
    set.set(parsed.path, entry);
  }

  for (const line of statusOutput.split(/\r?\n/).filter(Boolean)) {
    const parsed = parseNameStatusLine(line);
    if (!parsed) {
      continue;
    }
    const entry = set.get(parsed.path) ?? createEmptyEntry(parsed.path);
    entry.status = parsed.status;
    set.set(parsed.path, entry);
  }

  return Array.from(set.values());
}

async function mergeDiffSet(target, items) {
  for (const item of items) {
    const current = target.get(item.path);
    if (!current) {
      target.set(item.path, { ...item });
      continue;
    }
    current.additions += item.additions;
    current.deletions += item.deletions;
    current.status = mergeStatus(current.status, item.status);
  }
}

function parseNumstatLine(line) {
  const parts = line.split("\t");
  if (parts.length < 3) {
    return null;
  }
  const additions = parts[0] === "-" ? 0 : Number.parseInt(parts[0], 10);
  const deletions = parts[1] === "-" ? 0 : Number.parseInt(parts[1], 10);
  const rawPath = parts[parts.length - 1];
  const normalizedPath = rawPath.replaceAll("\\", "/");

  return {
    path: normalizedPath,
    additions: Number.isFinite(additions) ? additions : 0,
    deletions: Number.isFinite(deletions) ? deletions : 0
  };
}

function parseNameStatusLine(line) {
  const parts = line.split("\t");
  if (parts.length < 2) {
    return null;
  }
  const statusCode = parts[0];
  const rawPath = statusCode.startsWith("R") || statusCode.startsWith("C")
    ? parts[parts.length - 1]
    : parts[1];
  const normalizedPath = rawPath.replaceAll("\\", "/");
  return {
    path: normalizedPath,
    status: normalizeStatus(statusCode)
  };
}

function createEmptyEntry(relativePath) {
  return {
    path: relativePath,
    status: "modified",
    additions: 0,
    deletions: 0,
    extension: normalizeExtension(relativePath)
  };
}

function mergeStatus(previous, next) {
  if (previous === "unmerged" || next === "unmerged") {
    return "unmerged";
  }
  if (previous === "deleted" || next === "deleted") {
    return "deleted";
  }
  if (previous === "renamed" || next === "renamed") {
    return "renamed";
  }
  if (previous === "copied" || next === "copied") {
    return "copied";
  }
  if (previous === "added" || next === "added") {
    return "added";
  }
  if (previous === "untracked" || next === "untracked") {
    return "untracked";
  }
  if (previous === "unknown") {
    return next;
  }
  return previous;
}

function normalizeStatus(code) {
  const first = `${code ?? ""}`.charAt(0);
  if (first === "A") {
    return "added";
  }
  if (first === "M") {
    return "modified";
  }
  if (first === "D") {
    return "deleted";
  }
  if (first === "R") {
    return "renamed";
  }
  if (first === "C") {
    return "copied";
  }
  if (first === "U") {
    return "unmerged";
  }
  return "unknown";
}

function normalizeExtension(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  return extension || "[no_ext]";
}

function buildSummary(files) {
  const byStatus = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    unmerged: 0,
    untracked: 0,
    unknown: 0
  };
  const byExtensionMap = new Map();
  const touches = {
    docs: false,
    tests: false,
    controllers: false,
    views: false,
    manifest: false,
    i18n: false,
    config: false
  };
  let additions = 0;
  let deletions = 0;

  for (const file of files) {
    byStatus[file.status] += 1;
    additions += file.additions;
    deletions += file.deletions;
    byExtensionMap.set(file.extension, (byExtensionMap.get(file.extension) ?? 0) + 1);
    flagTouches(file.path, touches);
  }

  const byExtension = Array.from(byExtensionMap.entries())
    .map(([extension, count]) => ({ extension, count }))
    .sort((a, b) => b.count - a.count || a.extension.localeCompare(b.extension));

  return {
    changedFiles: files.length,
    additions,
    deletions,
    byStatus,
    byExtension,
    touches
  };
}

function flagTouches(relativePath, touches) {
  const normalized = relativePath.toLowerCase();

  if (normalized.startsWith("docs/") || normalized.endsWith(".md")) {
    touches.docs = true;
  }
  if (
    normalized.startsWith("test/")
    || normalized.includes(".test.")
    || normalized.includes(".spec.")
    || normalized.includes("__tests__/")
  ) {
    touches.tests = true;
  }
  if (normalized.includes("/controller/") && normalized.endsWith(".js")) {
    touches.controllers = true;
  }
  if (normalized.includes("/view/") && normalized.endsWith(".xml")) {
    touches.views = true;
  }
  if (normalized.endsWith("/manifest.json") || normalized === "webapp/manifest.json") {
    touches.manifest = true;
  }
  if (normalized.includes("/i18n/") || normalized.endsWith(".properties")) {
    touches.i18n = true;
  }
  if (
    normalized === "package.json"
    || normalized === "package-lock.json"
    || normalized === "ui5.yaml"
    || normalized === "eslint.config.js"
    || normalized === "vitest.config.js"
    || normalized.startsWith(".github/workflows/")
  ) {
    touches.config = true;
  }
}

function buildRecommendations(summary) {
  const recommendations = [];
  if (summary.changedFiles === 0) {
    recommendations.push("No diff detected for selected scope.");
    return recommendations;
  }
  if (summary.byStatus.unmerged > 0) {
    recommendations.push("Resolve merge conflicts before asking MCP tools to apply further patches.");
  }
  if (summary.changedFiles > 120) {
    recommendations.push("Large diff detected; consider splitting into smaller commits for safer reviews.");
  }

  const codeTouched = summary.touches.controllers || summary.touches.views || summary.touches.manifest || summary.touches.config;
  if (codeTouched && !summary.touches.tests) {
    recommendations.push("Code/config changed without test updates; consider adding focused tests before merge.");
  }
  if (summary.touches.manifest) {
    recommendations.push("Manifest changes detected; run `run_project_quality_gate` and `npm run check` before commit.");
  }

  return recommendations;
}

function createEmptyResponse(input) {
  return {
    repository: input.repository,
    scope: {
      mode: input.mode,
      baseRef: input.baseRef,
      targetRef: input.targetRef
    },
    summary: {
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      byStatus: {
        added: 0,
        modified: 0,
        deleted: 0,
        renamed: 0,
        copied: 0,
        unmerged: 0,
        untracked: 0,
        unknown: 0
      },
      byExtension: [],
      touches: {
        docs: false,
        tests: false,
        controllers: false,
        views: false,
        manifest: false,
        i18n: false,
        config: false
      }
    },
    files: [],
    recommendations: input.recommendations
  };
}
