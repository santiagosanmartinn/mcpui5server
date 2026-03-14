import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { auditGitWorktreeStateTool } from "./auditGitWorktreeState.js";
import { analyzeGitDiffTool } from "./analyzeGitDiff.js";

const DIFF_MODES = ["working_tree", "staged", "range"];
const CHECK_LEVELS = ["blocking", "warning", "info"];
const CHECK_STATUS = ["pass", "warn", "fail"];

const inputSchema = z.object({
  mode: z.enum(DIFF_MODES).optional(),
  baseRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  includeUntracked: z.boolean().optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  largeFileThresholdKb: z.number().int().min(50).max(10240).optional(),
  scanContent: z.boolean().optional()
}).strict().superRefine((value, ctx) => {
  const mode = value.mode ?? "working_tree";
  if (mode === "range" && !value.baseRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "baseRef is required when mode is `range`."
    });
  }
});

const checkSchema = z.object({
  id: z.string(),
  level: z.enum(CHECK_LEVELS),
  status: z.enum(CHECK_STATUS),
  message: z.string(),
  evidence: z.array(z.string()),
  suggestedAction: z.string()
});

const outputSchema = z.object({
  scope: z.object({
    mode: z.enum(DIFF_MODES),
    baseRef: z.string().nullable(),
    targetRef: z.string().nullable()
  }),
  repository: z.object({
    branch: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    headSha: z.string().nullable(),
    clean: z.boolean()
  }),
  summary: z.object({
    changedFiles: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
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
  checks: z.array(checkSchema),
  gate: z.object({
    readyForCommit: z.boolean(),
    blockingChecks: z.array(z.string()),
    warningChecks: z.array(z.string()),
    recommendedCommands: z.array(z.string())
  }),
  automationPolicy: z.object({
    allowsAutomaticCommit: z.boolean(),
    allowsAutomaticPush: z.boolean(),
    requiresExplicitUserConsent: z.boolean(),
    note: z.string()
  })
});

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----/i,
  /(?:api|auth|secret|access)[-_]?key\s*[:=]\s*["'][a-z0-9_-]{16,}["']/i,
  /ghp_[a-z0-9]{30,}/i,
  /xox[baprs]-[a-z0-9-]{10,}/i
];

export const prepareSafeCommitTool = {
  name: "prepare_safe_commit",
  description: "Run a safe pre-commit readiness checklist from Git state/diff without performing commit or push operations.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
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
    const audit = await auditGitWorktreeStateTool.handler(
      {
        includeUntracked: parsed.includeUntracked,
        maxFiles: parsed.maxFiles,
        timeoutMs: parsed.timeoutMs
      },
      { context }
    );

    const checks = [];
    const commands = new Set();
    const summary = diff.summary;
    const repository = {
      branch: diff.repository.branch,
      upstream: diff.repository.upstream,
      ahead: diff.repository.ahead,
      behind: diff.repository.behind,
      headSha: diff.repository.headSha,
      clean: audit.workingTree.clean
    };

    if (!diff.repository.gitAvailable) {
      checks.push({
        id: "git-not-available",
        level: "blocking",
        status: "fail",
        message: "Git is not available in this environment.",
        evidence: [],
        suggestedAction: "Install Git before running commit readiness checks."
      });
      return outputSchema.parse(buildResponse({
        scope: diff.scope,
        repository,
        summary,
        checks,
        commands
      }));
    }

    if (!diff.repository.isGitRepository) {
      checks.push({
        id: "git-repository-missing",
        level: "blocking",
        status: "fail",
        message: "Current workspace is not a Git repository.",
        evidence: [],
        suggestedAction: "Run `git init` (or open the correct repository folder) before commit preparation."
      });
      return outputSchema.parse(buildResponse({
        scope: diff.scope,
        repository,
        summary,
        checks,
        commands
      }));
    }

    if (summary.changedFiles === 0) {
      checks.push({
        id: "no-pending-changes",
        level: "warning",
        status: "warn",
        message: "No changes detected for selected diff scope.",
        evidence: [],
        suggestedAction: "Skip commit preparation or switch diff mode."
      });
    } else {
      checks.push({
        id: "pending-changes-detected",
        level: "info",
        status: "pass",
        message: `Detected ${summary.changedFiles} changed files (+${summary.additions}/-${summary.deletions}).`,
        evidence: diff.files.slice(0, 10).map((item) => item.path),
        suggestedAction: "Proceed with the remaining checks before commit."
      });
    }

    if (audit.workingTree.conflictedFiles > 0) {
      checks.push({
        id: "conflicts-present",
        level: "blocking",
        status: "fail",
        message: "Merge conflicts are present in the worktree.",
        evidence: audit.workingTree.files
          .filter((item) => item.isConflicted)
          .slice(0, 20)
          .map((item) => item.path),
        suggestedAction: "Resolve conflicts before committing."
      });
    }

    if (audit.workingTree.stagedChanges === 0 && summary.changedFiles > 0) {
      checks.push({
        id: "nothing-staged",
        level: "warning",
        status: "warn",
        message: "There are changes but nothing staged yet.",
        evidence: diff.files.slice(0, 10).map((item) => item.path),
        suggestedAction: "Review and stage intentional files before commit."
      });
    }

    if (audit.workingTree.stagedChanges > 0 && audit.workingTree.unstagedChanges > 0) {
      checks.push({
        id: "mixed-staged-unstaged",
        level: "warning",
        status: "warn",
        message: "Mixed staged and unstaged changes detected.",
        evidence: audit.workingTree.files.slice(0, 20).map((item) => `${item.statusCode} ${item.path}`),
        suggestedAction: "Split or align changes to avoid accidental partial commits."
      });
    }

    if ((summary.touches.controllers || summary.touches.views || summary.touches.manifest || summary.touches.config) && !summary.touches.tests) {
      checks.push({
        id: "tests-not-updated",
        level: "blocking",
        status: "fail",
        message: "Code/config changed without test updates.",
        evidence: diff.files.filter((item) => isRuntimeOrConfigFile(item.path)).slice(0, 20).map((item) => item.path),
        suggestedAction: "Add or update targeted tests before commit."
      });
      commands.add("npm run test:run");
    }

    if (summary.touches.manifest || summary.touches.config || summary.touches.controllers || summary.touches.views) {
      checks.push({
        id: "quality-gate-required",
        level: "warning",
        status: "warn",
        message: "High-impact files changed; quality gate is recommended.",
        evidence: diff.files.filter((item) => isRuntimeOrConfigFile(item.path)).slice(0, 20).map((item) => item.path),
        suggestedAction: "Run full checks before commit."
      });
      commands.add("npm run check");
    }

    const scanContent = parsed.scanContent ?? true;
    if (scanContent) {
      const contentFindings = await scanDiffContent({
        files: diff.files,
        rootDir: context.rootDir,
        largeFileThresholdKb: parsed.largeFileThresholdKb ?? 250
      });

      if (contentFindings.secretMatches.length > 0) {
        checks.push({
          id: "potential-secrets",
          level: "blocking",
          status: "fail",
          message: "Potential secrets detected in changed files.",
          evidence: contentFindings.secretMatches.slice(0, 20),
          suggestedAction: "Remove/rotate secrets and replace with secure config references."
        });
      }

      if (contentFindings.debugStatements.length > 0) {
        checks.push({
          id: "debug-statements",
          level: "warning",
          status: "warn",
          message: "Debug statements found in changed files.",
          evidence: contentFindings.debugStatements.slice(0, 20),
          suggestedAction: "Remove temporary `console.log`/`debugger` statements."
        });
      }

      if (contentFindings.largeFiles.length > 0) {
        checks.push({
          id: "large-files",
          level: "warning",
          status: "warn",
          message: "Large files detected in current changes.",
          evidence: contentFindings.largeFiles.slice(0, 20),
          suggestedAction: "Confirm these files are intentionally versioned."
        });
      }
    }

    if (checks.length === 0) {
      checks.push({
        id: "baseline-ready",
        level: "info",
        status: "pass",
        message: "No blocking patterns detected in pre-commit checklist.",
        evidence: [],
        suggestedAction: "Proceed with manual review and explicit commit confirmation."
      });
    }

    commands.add("npm run check");

    return outputSchema.parse(buildResponse({
      scope: diff.scope,
      repository,
      summary,
      checks,
      commands
    }));
  }
};

async function scanDiffContent(options) {
  const { files, rootDir, largeFileThresholdKb } = options;
  const secretMatches = [];
  const debugStatements = [];
  const largeFiles = [];
  const largeThresholdBytes = largeFileThresholdKb * 1024;
  const candidates = files.filter((item) => item.status !== "deleted");

  for (const item of candidates) {
    const absolutePath = path.resolve(rootDir, item.path);
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      continue;
    }

    if (stat.size >= largeThresholdBytes) {
      largeFiles.push(`${item.path} (${Math.round(stat.size / 1024)} KB)`);
    }

    if (!shouldReadForContentScan(item.path, stat.size)) {
      continue;
    }

    let content;
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
      secretMatches.push(item.path);
    }

    if (/\bconsole\.log\s*\(/.test(content) || /\bdebugger\b/.test(content)) {
      debugStatements.push(item.path);
    }
  }

  return {
    secretMatches,
    debugStatements,
    largeFiles
  };
}

function shouldReadForContentScan(filePath, fileSizeBytes) {
  if (fileSizeBytes > 2 * 1024 * 1024) {
    return false;
  }
  const normalized = filePath.toLowerCase();
  return normalized.endsWith(".js")
    || normalized.endsWith(".ts")
    || normalized.endsWith(".json")
    || normalized.endsWith(".xml")
    || normalized.endsWith(".properties")
    || normalized.endsWith(".md")
    || normalized.endsWith(".env")
    || normalized.includes("config");
}

function isRuntimeOrConfigFile(filePath) {
  const normalized = filePath.toLowerCase();
  return normalized.includes("/controller/")
    || normalized.includes("/view/")
    || normalized === "webapp/manifest.json"
    || normalized.endsWith("/manifest.json")
    || normalized === "package.json"
    || normalized === "package-lock.json"
    || normalized === "ui5.yaml"
    || normalized === "eslint.config.js"
    || normalized === "vitest.config.js"
    || normalized.startsWith(".github/workflows/");
}

function buildResponse(input) {
  const blockingChecks = input.checks.filter((item) => item.level === "blocking" && item.status === "fail");
  const warningChecks = input.checks.filter((item) => item.level === "warning" && item.status !== "pass");

  return {
    scope: input.scope,
    repository: input.repository,
    summary: {
      changedFiles: input.summary.changedFiles,
      additions: input.summary.additions,
      deletions: input.summary.deletions,
      touches: input.summary.touches
    },
    checks: input.checks,
    gate: {
      readyForCommit: blockingChecks.length === 0,
      blockingChecks: blockingChecks.map((item) => item.id),
      warningChecks: warningChecks.map((item) => item.id),
      recommendedCommands: Array.from(input.commands)
    },
    automationPolicy: {
      allowsAutomaticCommit: false,
      allowsAutomaticPush: false,
      requiresExplicitUserConsent: true,
      note: "This tool only prepares commit readiness. Never run commit/push without explicit user consent."
    }
  };
}
