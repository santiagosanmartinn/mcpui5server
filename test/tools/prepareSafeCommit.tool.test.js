import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareSafeCommitTool } from "../../src/tools/project/prepareSafeCommit.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("prepare_safe_commit", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-prepare-safe-"));
    await initGitRepo(tempRoot);
    await fs.mkdir(path.join(tempRoot, "webapp", "controller"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const v = 1;\n", "utf8");
    await fs.mkdir(path.join(tempRoot, "test"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "test", "main.test.js"), "expect(true).toBe(true);\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "initial"], { cwd: tempRoot });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("flags blocking checks and enforces explicit consent policy", async () => {
    await fs.writeFile(
      path.join(tempRoot, "webapp", "controller", "Main.controller.js"),
      "console.log('debug');\nconst api_key = \"abcdefghijklmnopqrstuvwxyz123456\";\n",
      "utf8"
    );

    const result = await prepareSafeCommitTool.handler(
      {
        mode: "working_tree",
        includeUntracked: true
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.gate.readyForCommit).toBe(false);
    expect(result.gate.blockingChecks).toContain("tests-not-updated");
    expect(result.gate.blockingChecks).toContain("potential-secrets");
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
