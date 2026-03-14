import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mergeActionPlanTool } from "../../src/tools/project/mergeActionPlan.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("merge_action_plan", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-merge-action-plan-"));
    await initGitRepo(tempRoot);
    await fs.mkdir(path.join(tempRoot, "webapp", "controller"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "docs"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "test"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const value = 1;\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "webapp", "manifest.json"), "{\"sap.app\":{\"id\":\"demo.app\"}}\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "docs", "notes.md"), "initial\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "test", "main.test.js"), "expect(true).toBe(true);\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "initial"], { cwd: tempRoot });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("recommends defer strategy when readiness is blocked", async () => {
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const value = 2;\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "webapp", "manifest.json"), "{\"sap.app\":{\"id\":\"demo.app.v2\"}}\n", "utf8");

    const result = await mergeActionPlanTool.handler(
      {
        mode: "working_tree",
        includeUntracked: true,
        targetRef: "HEAD"
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.readiness.level).toBe("blocked");
    expect(result.strategy.recommended).toBe("defer");
    expect(result.plan.integrate.some((item) => item.status === "blocked")).toBe(true);
    expect(result.commands.integrate).toHaveLength(0);
    expect(result.automationPolicy.requiresExplicitUserConsent).toBe(true);
  });

  it("keeps rebase strategy and provides integration command when change is ready", async () => {
    await fs.writeFile(path.join(tempRoot, "docs", "notes.md"), "updated docs\n", "utf8");

    const result = await mergeActionPlanTool.handler(
      {
        mode: "working_tree",
        includeUntracked: true,
        targetRef: "HEAD",
        preferredStrategy: "rebase"
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.readiness.readyForMerge).toBe(true);
    expect(result.strategy.recommended).toBe("rebase");
    expect(result.plan.integrate.every((item) => item.status === "todo")).toBe(true);
    expect(result.commands.integrate.some((cmd) => cmd.startsWith("git rebase "))).toBe(true);
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
