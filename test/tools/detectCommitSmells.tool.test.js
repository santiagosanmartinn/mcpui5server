import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectCommitSmellsTool } from "../../src/tools/project/detectCommitSmells.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("detect_commit_smells", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-commit-smells-"));
    await initGitRepo(tempRoot);
    await fs.mkdir(path.join(tempRoot, "webapp", "controller"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "docs"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const v = 1;\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "webapp", "manifest.json"), "{\"sap.app\":{}}\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "docs", "notes.md"), "initial\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "initial"], { cwd: tempRoot });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("detects mixed concerns and missing test updates", async () => {
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const v = 2;\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "webapp", "manifest.json"), "{\"sap.app\":{\"id\":\"demo.app\"}}\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "docs", "notes.md"), "updated docs\n", "utf8");

    const result = await detectCommitSmellsTool.handler(
      {
        mode: "working_tree",
        includeUntracked: true
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.smells.some((smell) => smell.id === "mixed-concerns")).toBe(true);
    expect(result.smells.some((smell) => smell.id === "code-without-tests")).toBe(true);
    expect(result.automationPolicy.modifiesGitState).toBe(false);
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
