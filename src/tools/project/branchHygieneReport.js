import { z } from "zod";
import { auditGitWorktreeStateTool } from "./auditGitWorktreeState.js";
import { runGitInRepository } from "../../utils/git.js";

const CHECK_STATUS = ["pass", "warn", "fail"];
const CHECK_SEVERITY = ["low", "medium", "high"];
const HYGIENE_LEVELS = ["healthy", "warning", "risky"];

const inputSchema = z.object({
  targetRef: z.string().min(1).optional(),
  includeUntracked: z.boolean().optional(),
  maxFiles: z.number().int().min(10).max(2000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  staleDaysThreshold: z.number().int().min(3).max(180).optional()
}).strict();

const checkSchema = z.object({
  id: z.string(),
  status: z.enum(CHECK_STATUS),
  severity: z.enum(CHECK_SEVERITY),
  message: z.string(),
  suggestion: z.string()
});

const outputSchema = z.object({
  repository: z.object({
    gitAvailable: z.boolean(),
    isGitRepository: z.boolean(),
    branch: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    headSha: z.string().nullable()
  }),
  target: z.object({
    ref: z.string().nullable(),
    exists: z.boolean(),
    commitsAheadOfTarget: z.number().int().nonnegative(),
    commitsBehindTarget: z.number().int().nonnegative()
  }),
  workingTree: z.object({
    clean: z.boolean(),
    stagedChanges: z.number().int().nonnegative(),
    unstagedChanges: z.number().int().nonnegative(),
    untrackedFiles: z.number().int().nonnegative(),
    conflictedFiles: z.number().int().nonnegative()
  }),
  branchActivity: z.object({
    latestCommitAt: z.string().nullable(),
    daysSinceLatestCommit: z.number().int().nonnegative()
  }),
  hygiene: z.object({
    score: z.number().int().min(0).max(100),
    level: z.enum(HYGIENE_LEVELS),
    checks: z.array(checkSchema),
    recommendedActions: z.array(z.string())
  }),
  automationPolicy: z.object({
    allowsAutomaticCommit: z.boolean(),
    allowsAutomaticPush: z.boolean(),
    requiresExplicitUserConsent: z.boolean(),
    note: z.string()
  })
});

export const branchHygieneReportTool = {
  name: "branch_hygiene_report",
  description: "Assess branch hygiene (divergence, worktree cleanliness, staleness, and target alignment) before merge/PR.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const staleDaysThreshold = parsed.staleDaysThreshold ?? 30;
    const audit = await auditGitWorktreeStateTool.handler(
      {
        includeUntracked: parsed.includeUntracked,
        maxFiles: parsed.maxFiles,
        timeoutMs: parsed.timeoutMs
      },
      { context }
    );

    const repository = {
      gitAvailable: audit.repository.gitAvailable,
      isGitRepository: audit.repository.isGitRepository,
      branch: audit.repository.branch,
      upstream: audit.repository.upstream,
      ahead: audit.repository.ahead,
      behind: audit.repository.behind,
      headSha: audit.repository.headSha
    };

    const checks = [];
    const actions = new Set();
    let score = 100;

    if (!repository.gitAvailable) {
      checks.push({
        id: "git-not-available",
        status: "fail",
        severity: "high",
        message: "Git is not available in this environment.",
        suggestion: "Install Git before using branch hygiene checks."
      });
      return outputSchema.parse(buildOutput({
        repository,
        target: {
          ref: null,
          exists: false,
          commitsAheadOfTarget: 0,
          commitsBehindTarget: 0
        },
        workingTree: audit.workingTree,
        branchActivity: {
          latestCommitAt: null,
          daysSinceLatestCommit: 0
        },
        checks,
        actions,
        score
      }));
    }

    if (!repository.isGitRepository) {
      checks.push({
        id: "not-a-repository",
        status: "fail",
        severity: "high",
        message: "Current workspace is not a Git repository.",
        suggestion: "Open a Git repository workspace or initialize one with `git init`."
      });
      return outputSchema.parse(buildOutput({
        repository,
        target: {
          ref: null,
          exists: false,
          commitsAheadOfTarget: 0,
          commitsBehindTarget: 0
        },
        workingTree: audit.workingTree,
        branchActivity: {
          latestCommitAt: null,
          daysSinceLatestCommit: 0
        },
        checks,
        actions,
        score
      }));
    }

    const targetRef = parsed.targetRef ?? repository.upstream ?? await resolveTargetRef(context.rootDir, parsed.timeoutMs);
    const targetExists = targetRef
      ? await refExists(context.rootDir, targetRef, parsed.timeoutMs)
      : false;
    const [aheadOfTarget, behindTarget] = targetExists
      ? await Promise.all([
        countCommits(context.rootDir, `${targetRef}..HEAD`, parsed.timeoutMs),
        countCommits(context.rootDir, `HEAD..${targetRef}`, parsed.timeoutMs)
      ])
      : [0, 0];

    if (!targetRef || !targetExists) {
      score -= 15;
      checks.push({
        id: "target-ref-missing",
        status: "warn",
        severity: "medium",
        message: "No valid target reference was found for branch comparison.",
        suggestion: "Provide `targetRef` explicitly for more accurate hygiene checks."
      });
    } else {
      checks.push({
        id: "target-ref-detected",
        status: "pass",
        severity: "low",
        message: `Target reference resolved: ${targetRef}.`,
        suggestion: "Keep target reference stable across the branch lifecycle."
      });
    }

    if (repository.behind > 0) {
      score -= 25;
      checks.push({
        id: "behind-upstream",
        status: "warn",
        severity: "high",
        message: `Branch is behind upstream by ${repository.behind} commit(s).`,
        suggestion: "Rebase/merge from upstream before opening or updating PR."
      });
      actions.add("Update branch with upstream before final validation.");
    }

    if (repository.ahead > 0) {
      checks.push({
        id: "ahead-upstream",
        status: "pass",
        severity: "low",
        message: `Branch has ${repository.ahead} local commit(s) ahead of upstream.`,
        suggestion: "Ensure commit history is clean and intentional."
      });
    }

    if (targetExists && behindTarget > 0) {
      score -= 15;
      checks.push({
        id: "behind-target",
        status: "warn",
        severity: "medium",
        message: `Branch is behind target ref (${behindTarget} commit(s)).`,
        suggestion: "Re-sync with target branch to reduce integration surprises."
      });
      actions.add("Rebase or merge target branch before merge request.");
    }

    if (targetExists && aheadOfTarget > 40) {
      score -= 15;
      checks.push({
        id: "ahead-target-large",
        status: "warn",
        severity: "medium",
        message: `Branch diverges significantly from target (${aheadOfTarget} commits ahead).`,
        suggestion: "Consider splitting large branches into smaller mergeable slices."
      });
    }

    if (audit.workingTree.conflictedFiles > 0) {
      score -= 40;
      checks.push({
        id: "conflicts-present",
        status: "fail",
        severity: "high",
        message: "Merge conflicts detected in working tree.",
        suggestion: "Resolve conflicts before continuing with PR or commit flow."
      });
      actions.add("Resolve merge conflicts first.");
    }

    if (!audit.workingTree.clean) {
      score -= 10;
      checks.push({
        id: "worktree-not-clean",
        status: "warn",
        severity: "medium",
        message: "Working tree has pending changes.",
        suggestion: "Stage or stash unrelated changes before final PR checks."
      });
    } else {
      checks.push({
        id: "worktree-clean",
        status: "pass",
        severity: "low",
        message: "Working tree is clean.",
        suggestion: "Keep changes isolated and explicit."
      });
    }

    const latestCommitAt = await resolveLatestCommitDate(context.rootDir, parsed.timeoutMs);
    const daysSinceLatestCommit = latestCommitAt
      ? Math.max(0, Math.floor((Date.now() - new Date(latestCommitAt).getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    if (latestCommitAt && daysSinceLatestCommit > staleDaysThreshold) {
      score -= 15;
      checks.push({
        id: "stale-branch",
        status: "warn",
        severity: "medium",
        message: `Last commit is ${daysSinceLatestCommit} day(s) old (threshold: ${staleDaysThreshold}).`,
        suggestion: "Refresh and validate the branch against current target state."
      });
      actions.add("Run a fresh validation pass before merge.");
    }

    actions.add("Run `npm run check` before merge.");

    return outputSchema.parse(buildOutput({
      repository,
      target: {
        ref: targetRef ?? null,
        exists: targetExists,
        commitsAheadOfTarget: aheadOfTarget,
        commitsBehindTarget: behindTarget
      },
      workingTree: {
        clean: audit.workingTree.clean,
        stagedChanges: audit.workingTree.stagedChanges,
        unstagedChanges: audit.workingTree.unstagedChanges,
        untrackedFiles: audit.workingTree.untrackedFiles,
        conflictedFiles: audit.workingTree.conflictedFiles
      },
      branchActivity: {
        latestCommitAt,
        daysSinceLatestCommit
      },
      checks,
      actions,
      score
    }));
  }
};

async function resolveTargetRef(rootDir, timeoutMs) {
  const candidates = ["origin/main", "origin/master", "main", "master", "develop"];
  for (const candidate of candidates) {
    if (await refExists(rootDir, candidate, timeoutMs)) {
      return candidate;
    }
  }
  return null;
}

async function refExists(rootDir, ref, timeoutMs) {
  try {
    await runGitInRepository(["rev-parse", "--verify", ref], {
      cwd: rootDir,
      timeoutMs
    });
    return true;
  } catch {
    return false;
  }
}

async function countCommits(rootDir, rangeExpr, timeoutMs) {
  try {
    const output = await runGitInRepository(["rev-list", "--count", rangeExpr], {
      cwd: rootDir,
      timeoutMs
    });
    const parsed = Number.parseInt(output.trim(), 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  } catch {
    return 0;
  }
}

async function resolveLatestCommitDate(rootDir, timeoutMs) {
  try {
    const output = await runGitInRepository(["log", "-1", "--format=%cI"], {
      cwd: rootDir,
      timeoutMs
    });
    const value = output.trim();
    return value || null;
  } catch {
    return null;
  }
}

function inferLevel(score) {
  if (score >= 75) {
    return "healthy";
  }
  if (score >= 45) {
    return "warning";
  }
  return "risky";
}

function buildOutput(input) {
  const boundedScore = Math.max(0, Math.min(100, input.score));
  return {
    repository: input.repository,
    target: input.target,
    workingTree: input.workingTree,
    branchActivity: input.branchActivity,
    hygiene: {
      score: boundedScore,
      level: inferLevel(boundedScore),
      checks: input.checks,
      recommendedActions: Array.from(input.actions)
    },
    automationPolicy: {
      allowsAutomaticCommit: false,
      allowsAutomaticPush: false,
      requiresExplicitUserConsent: true,
      note: "This tool only audits branch hygiene. Never run commit/push without explicit user consent."
    }
  };
}
