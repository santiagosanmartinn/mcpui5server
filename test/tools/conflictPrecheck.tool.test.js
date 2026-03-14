import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { conflictPrecheckTool } from "../../src/tools/project/conflictPrecheck.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("conflict_precheck", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-conflict-precheck-"));
    await initGitRepo(tempRoot);
    await fs.writeFile(path.join(tempRoot, "src.js"), "const value = 1;\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "initial"], { cwd: tempRoot });
    await git(["branch", "-M", "main"], { cwd: tempRoot });
    await git(["checkout", "-b", "feature"], { cwd: tempRoot });
    await fs.writeFile(path.join(tempRoot, "src.js"), "const value = 2;\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "feature change"], { cwd: tempRoot });
    await git(["checkout", "main"], { cwd: tempRoot });
    await fs.writeFile(path.join(tempRoot, "src.js"), "const value = 3;\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "main change"], { cwd: tempRoot });
    await git(["checkout", "feature"], { cwd: tempRoot });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("detects overlap risk between source and target refs", async () => {
    const result = await conflictPrecheckTool.handler(
      {
        sourceRef: "HEAD",
        targetRef: "main"
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.comparison.overlappingFiles).toBeGreaterThanOrEqual(1);
    expect(result.risk.overlapFiles.some((item) => item.path === "src.js")).toBe(true);
    expect(result.automationPolicy.performsMerge).toBe(false);
    expect(result.automationPolicy.modifiesWorkingTree).toBe(false);
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
