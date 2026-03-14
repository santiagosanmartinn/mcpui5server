import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { analyzeGitDiffTool } from "../../src/tools/project/analyzeGitDiff.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("analyze_git_diff", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-git-diff-"));
    await initGitRepo(tempRoot);
    await fs.mkdir(path.join(tempRoot, "webapp", "controller"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const v = 1;\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "initial"], { cwd: tempRoot });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("analyzes working tree diff including untracked files", async () => {
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const v = 2;\n", "utf8");
    await fs.mkdir(path.join(tempRoot, "webapp", "view"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "webapp", "view", "Main.view.xml"), "<mvc:View></mvc:View>\n", "utf8");
    await git(["add", "webapp/view/Main.view.xml"], { cwd: tempRoot });
    await fs.mkdir(path.join(tempRoot, "docs"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "docs", "notes.md"), "notes", "utf8");

    const result = await analyzeGitDiffTool.handler(
      {
        mode: "working_tree",
        includeUntracked: true
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.summary.changedFiles).toBeGreaterThanOrEqual(3);
    expect(result.summary.touches.controllers).toBe(true);
    expect(result.summary.touches.views).toBe(true);
    expect(result.summary.touches.docs).toBe(true);
    expect(result.summary.byStatus.modified).toBeGreaterThanOrEqual(1);
    expect(result.summary.byStatus.added).toBeGreaterThanOrEqual(1);
    expect(result.summary.byStatus.untracked).toBeGreaterThanOrEqual(1);
  });

  it("analyzes range diff between commits", async () => {
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const v = 3;\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "second"], { cwd: tempRoot });

    const result = await analyzeGitDiffTool.handler(
      {
        mode: "range",
        baseRef: "HEAD~1",
        targetRef: "HEAD"
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.scope.mode).toBe("range");
    expect(result.summary.changedFiles).toBeGreaterThanOrEqual(1);
    expect(result.summary.additions).toBeGreaterThan(0);
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
