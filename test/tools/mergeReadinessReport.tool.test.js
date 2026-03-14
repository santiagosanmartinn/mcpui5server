import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mergeReadinessReportTool } from "../../src/tools/project/mergeReadinessReport.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("merge_readiness_report", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-merge-readiness-"));
    await initGitRepo(tempRoot);
    await fs.mkdir(path.join(tempRoot, "webapp", "controller"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "test"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "docs"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const value = 1;\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "webapp", "manifest.json"), "{\"sap.app\":{\"id\":\"demo.app\"}}\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "test", "main.test.js"), "expect(true).toBe(true);\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "docs", "notes.md"), "initial\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "initial"], { cwd: tempRoot });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("marks merge as blocked when commit/risk checks contain blockers", async () => {
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const value = 2;\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "webapp", "manifest.json"), "{\"sap.app\":{\"id\":\"demo.app.v2\"}}\n", "utf8");

    const result = await mergeReadinessReportTool.handler(
      {
        mode: "working_tree",
        includeUntracked: true,
        targetRef: "HEAD"
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.readiness.level).toBe("blocked");
    expect(result.readiness.readyForMerge).toBe(false);
    expect(result.readiness.blockers).toContain("commit:tests-not-updated");
    expect(result.readiness.blockers).toContain("risk:code-without-tests");
    expect(result.automationPolicy.requiresExplicitUserConsent).toBe(true);
    expect(result.automationPolicy.performsMergeOrPush).toBe(false);
  });

  it("marks merge as ready when only low-risk docs changes exist", async () => {
    await fs.writeFile(path.join(tempRoot, "docs", "notes.md"), "updated docs\n", "utf8");

    const result = await mergeReadinessReportTool.handler(
      {
        mode: "working_tree",
        includeUntracked: true,
        targetRef: "HEAD"
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.readiness.level).toBe("ready");
    expect(result.readiness.readyForMerge).toBe(true);
    expect(result.readiness.blockers).toHaveLength(0);
    expect(result.readiness.score).toBeGreaterThanOrEqual(70);
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
