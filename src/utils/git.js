import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ToolError } from "./errors.js";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

export async function tryResolveGitRepository(rootDir, options = {}) {
  const cwd = path.resolve(rootDir);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const version = await runGitCommand(["--version"], {
    cwd,
    timeoutMs
  });
  if (!version.ok) {
    return {
      gitAvailable: false,
      isGitRepository: false,
      rootPath: null,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      headSha: null
    };
  }

  const inside = await runGitCommand(["rev-parse", "--is-inside-work-tree"], {
    cwd,
    timeoutMs
  });
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return {
      gitAvailable: true,
      isGitRepository: false,
      rootPath: null,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      headSha: null
    };
  }

  const [rootPathResult, statusResult, headResult] = await Promise.all([
    runGitCommand(["rev-parse", "--show-toplevel"], { cwd, timeoutMs }),
    runGitCommand(["status", "--porcelain", "--branch"], { cwd, timeoutMs }),
    runGitCommand(["rev-parse", "--short", "HEAD"], { cwd, timeoutMs })
  ]);
  const branchMetadata = parseBranchMetadata(statusResult.stdout);

  return {
    gitAvailable: true,
    isGitRepository: true,
    rootPath: rootPathResult.ok ? rootPathResult.stdout.trim() : null,
    branch: branchMetadata.branch,
    upstream: branchMetadata.upstream,
    ahead: branchMetadata.ahead,
    behind: branchMetadata.behind,
    headSha: headResult.ok ? headResult.stdout.trim() : null
  };
}

export async function runGitInRepository(args, options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const result = await runGitCommand(args, {
    cwd,
    timeoutMs
  });

  if (result.ok) {
    return result.stdout;
  }

  if (result.notFound) {
    throw new ToolError("Git is not available on this machine.", {
      code: "GIT_NOT_AVAILABLE"
    });
  }

  if (result.notRepository) {
    throw new ToolError("Current workspace is not a Git repository.", {
      code: "GIT_NOT_REPOSITORY"
    });
  }

  throw new ToolError(`Git command failed: ${result.errorMessage}`, {
    code: "GIT_COMMAND_FAILED",
    details: {
      args
    }
  });
}

async function runGitCommand(args, options) {
  const { cwd, timeoutMs } = options;
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: DEFAULT_MAX_BUFFER
    });
    return {
      ok: true,
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      notFound: false,
      notRepository: false,
      errorMessage: null
    };
  } catch (error) {
    const stderr = `${error?.stderr ?? ""}`.trim();
    const message = `${error?.message ?? String(error)}`.trim();
    const notFound = error?.code === "ENOENT";
    return {
      ok: false,
      stdout: `${error?.stdout ?? ""}`,
      stderr,
      notFound,
      notRepository: /not a git repository/i.test(stderr) || /not a git repository/i.test(message),
      errorMessage: stderr || message
    };
  }
}

function parseBranchMetadata(statusOutput) {
  const header = `${statusOutput ?? ""}`
    .split(/\r?\n/)
    .find((line) => line.startsWith("## "));
  if (!header) {
    return {
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0
    };
  }

  const raw = header.slice(3).trim();
  const [branchPart, trackingPartRaw] = raw.split("...");
  const branch = branchPart?.trim() || null;
  const trackingPart = trackingPartRaw ?? "";

  let upstream = null;
  let ahead = 0;
  let behind = 0;

  const trackingMatch = trackingPart.match(/^([^[]+)(?:\s+\[(.+)\])?$/);
  if (trackingMatch) {
    upstream = trackingMatch[1].trim() || null;
    const trackingDetails = trackingMatch[2] ?? "";
    const aheadMatch = trackingDetails.match(/ahead\s+(\d+)/);
    const behindMatch = trackingDetails.match(/behind\s+(\d+)/);
    ahead = aheadMatch ? Number.parseInt(aheadMatch[1], 10) : 0;
    behind = behindMatch ? Number.parseInt(behindMatch[1], 10) : 0;
  }

  return {
    branch,
    upstream,
    ahead,
    behind
  };
}
