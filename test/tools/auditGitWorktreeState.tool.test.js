import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { auditGitWorktreeStateTool } from "../../src/tools/project/auditGitWorktreeState.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("audit_git_worktree_state", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-audit-git-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("reports non-repository workspace with actionable recommendation", async () => {
    const result = await auditGitWorktreeStateTool.handler(
      {},
      { context: { rootDir: tempRoot } }
    );

    expect(result.repository.gitAvailable).toBe(true);
    expect(result.repository.isGitRepository).toBe(false);
    expect(result.recommendations.join(" ")).toContain("git init");
  });

  it("reports staged, unstaged and untracked changes", async () => {
    await initGitRepo(tempRoot);
    await fs.mkdir(path.join(tempRoot, "webapp", "controller"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const a = 1;\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "initial"], { cwd: tempRoot });

    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const a = 2;\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Detail.controller.js"), "const d = 1;\n", "utf8");
    await git(["add", "webapp/controller/Detail.controller.js"], { cwd: tempRoot });
    await fs.writeFile(path.join(tempRoot, "notes.txt"), "local scratch", "utf8");

    const result = await auditGitWorktreeStateTool.handler(
      {
        includeUntracked: true
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.repository.isGitRepository).toBe(true);
    expect(result.workingTree.clean).toBe(false);
    expect(result.workingTree.stagedChanges).toBeGreaterThanOrEqual(1);
    expect(result.workingTree.unstagedChanges).toBeGreaterThanOrEqual(1);
    expect(result.workingTree.untrackedFiles).toBeGreaterThanOrEqual(1);
    expect(result.workingTree.files.some((item) => item.path.endsWith("Detail.controller.js"))).toBe(true);
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
