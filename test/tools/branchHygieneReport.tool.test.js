import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { branchHygieneReportTool } from "../../src/tools/project/branchHygieneReport.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("branch_hygiene_report", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-branch-hygiene-"));
    await initGitRepo(tempRoot);
    await fs.writeFile(path.join(tempRoot, "README.md"), "initial\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "initial"], { cwd: tempRoot });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("detects non-clean worktree and keeps explicit consent policy", async () => {
    await fs.writeFile(path.join(tempRoot, "README.md"), "changed\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "notes.txt"), "temp\n", "utf8");

    const result = await branchHygieneReportTool.handler(
      {
        includeUntracked: true
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.workingTree.clean).toBe(false);
    expect(result.hygiene.checks.some((item) => item.id === "worktree-not-clean")).toBe(true);
    expect(result.automationPolicy.requiresExplicitUserConsent).toBe(true);
    expect(result.automationPolicy.allowsAutomaticCommit).toBe(false);
    expect(result.automationPolicy.allowsAutomaticPush).toBe(false);
  });
});

async function initGitRepo(rootDir) {
  await git(["init"], { cwd: rootDir });
  await git(["config", "user.email", "mcp@example.com"], { cwd: rootDir });
  await git(["config", "user.name", "MCP Test"], { cwd: rootDir });
}

async function git(args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  await execFileAsync("git", args, {
    cwd,
    windowsHide: true
  });
}
