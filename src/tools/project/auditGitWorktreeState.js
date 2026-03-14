import { z } from "zod";
import { runGitInRepository, tryResolveGitRepository } from "../../utils/git.js";

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const DEFAULT_MAX_FILES = 200;

const inputSchema = z.object({
  includeUntracked: z.boolean().optional(),
  maxFiles: z.number().int().min(10).max(2000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional()
}).strict();

const fileSchema = z.object({
  path: z.string(),
  statusCode: z.string(),
  stagedStatus: z.string(),
  unstagedStatus: z.string(),
  isUntracked: z.boolean(),
  isConflicted: z.boolean()
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
  workingTree: z.object({
    clean: z.boolean(),
    stagedChanges: z.number().int().nonnegative(),
    unstagedChanges: z.number().int().nonnegative(),
    untrackedFiles: z.number().int().nonnegative(),
    conflictedFiles: z.number().int().nonnegative(),
    files: z.array(fileSchema)
  }),
  recommendations: z.array(z.string())
});

export const auditGitWorktreeStateTool = {
  name: "audit_git_worktree_state",
  description: "Audit current Git worktree state (staged, unstaged, untracked, conflicts, and branch divergence).",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { includeUntracked, maxFiles, timeoutMs } = inputSchema.parse(args);
    const includeUntrackedFiles = includeUntracked ?? true;
    const maxListedFiles = maxFiles ?? DEFAULT_MAX_FILES;
    const repository = await tryResolveGitRepository(context.rootDir, { timeoutMs });

    if (!repository.gitAvailable) {
      return outputSchema.parse({
        repository,
        workingTree: {
          clean: true,
          stagedChanges: 0,
          unstagedChanges: 0,
          untrackedFiles: 0,
          conflictedFiles: 0,
          files: []
        },
        recommendations: [
          "Install Git to enable worktree audits and diff analysis from MCP tools."
        ]
      });
    }

    if (!repository.isGitRepository) {
      return outputSchema.parse({
        repository,
        workingTree: {
          clean: true,
          stagedChanges: 0,
          unstagedChanges: 0,
          untrackedFiles: 0,
          conflictedFiles: 0,
          files: []
        },
        recommendations: [
          "Initialize the workspace with `git init` before using Git-oriented MCP flows."
        ]
      });
    }

    const statusOutput = await runGitInRepository(["status", "--porcelain", "--branch"], {
      cwd: context.rootDir,
      timeoutMs
    });
    const parsedStatus = parsePorcelainStatus(statusOutput, {
      includeUntrackedFiles,
      maxListedFiles
    });
    const clean = includeUntrackedFiles
      ? parsedStatus.stagedChanges === 0
        && parsedStatus.unstagedChanges === 0
        && parsedStatus.untrackedFiles === 0
        && parsedStatus.conflictedFiles === 0
      : parsedStatus.stagedChanges === 0
        && parsedStatus.unstagedChanges === 0
        && parsedStatus.conflictedFiles === 0;

    const recommendations = buildRecommendations({
      clean,
      includeUntrackedFiles,
      stagedChanges: parsedStatus.stagedChanges,
      unstagedChanges: parsedStatus.unstagedChanges,
      untrackedFiles: parsedStatus.untrackedFiles,
      conflictedFiles: parsedStatus.conflictedFiles,
      ahead: repository.ahead,
      behind: repository.behind
    });

    return outputSchema.parse({
      repository,
      workingTree: {
        clean,
        stagedChanges: parsedStatus.stagedChanges,
        unstagedChanges: parsedStatus.unstagedChanges,
        untrackedFiles: parsedStatus.untrackedFiles,
        conflictedFiles: parsedStatus.conflictedFiles,
        files: parsedStatus.files
      },
      recommendations
    });
  }
};

function parsePorcelainStatus(statusOutput, options) {
  const { includeUntrackedFiles, maxListedFiles } = options;
  const files = [];
  let stagedChanges = 0;
  let unstagedChanges = 0;
  let untrackedFiles = 0;
  let conflictedFiles = 0;

  const lines = statusOutput.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("## ")) {
      continue;
    }

    const statusCode = line.slice(0, 2);
    const stagedStatus = statusCode[0] ?? " ";
    const unstagedStatus = statusCode[1] ?? " ";
    const isUntracked = statusCode === "??";
    const isConflicted = CONFLICT_CODES.has(statusCode);
    const normalizedPath = normalizeStatusPath(line.slice(3));

    if (isUntracked) {
      untrackedFiles += 1;
    } else {
      if (stagedStatus !== " ") {
        stagedChanges += 1;
      }
      if (unstagedStatus !== " ") {
        unstagedChanges += 1;
      }
    }

    if (isConflicted) {
      conflictedFiles += 1;
    }

    if (!includeUntrackedFiles && isUntracked) {
      continue;
    }

    if (files.length < maxListedFiles) {
      files.push({
        path: normalizedPath,
        statusCode,
        stagedStatus,
        unstagedStatus,
        isUntracked,
        isConflicted
      });
    }
  }

  return {
    stagedChanges,
    unstagedChanges,
    untrackedFiles,
    conflictedFiles,
    files
  };
}

function normalizeStatusPath(rawPath) {
  const trimmed = rawPath.trim();
  const renameSeparator = " -> ";
  if (trimmed.includes(renameSeparator)) {
    const [, targetPath] = trimmed.split(renameSeparator);
    return targetPath.trim();
  }
  return trimmed;
}

function buildRecommendations(summary) {
  const recommendations = [];
  const {
    clean,
    includeUntrackedFiles,
    stagedChanges,
    unstagedChanges,
    untrackedFiles,
    conflictedFiles,
    ahead,
    behind
  } = summary;

  if (clean) {
    recommendations.push("Working tree is clean.");
  }
  if (conflictedFiles > 0) {
    recommendations.push("Resolve merge conflicts before applying MCP-generated patches.");
  }
  if (stagedChanges > 0 && unstagedChanges > 0) {
    recommendations.push("You have mixed staged and unstaged changes; consider splitting commits for clearer reviews.");
  }
  if (includeUntrackedFiles && untrackedFiles > 0) {
    recommendations.push("Review untracked files to avoid committing temporary artifacts by accident.");
  }
  if (ahead > 0 && behind > 0) {
    recommendations.push("Branch has diverged from upstream; rebase or merge before opening a PR.");
  } else if (behind > 0) {
    recommendations.push("Branch is behind upstream; pull/rebase before final validation.");
  } else if (ahead > 0) {
    recommendations.push("Branch has local commits not pushed yet.");
  }

  return recommendations;
}
