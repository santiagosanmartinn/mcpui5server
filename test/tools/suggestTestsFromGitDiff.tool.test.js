import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { suggestTestsFromGitDiffTool } from "../../src/tools/project/suggestTestsFromGitDiff.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("suggest_tests_from_git_diff", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-suggest-tests-"));
    await initGitRepo(tempRoot);
    await fs.mkdir(path.join(tempRoot, "webapp", "controller"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const v = 1;\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "initial"], { cwd: tempRoot });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("suggests high-priority tests when UI/controller changes have no tests", async () => {
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const v = 2;\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "webapp", "manifest.json"), "{\"sap.app\":{}}\n", "utf8");

    const result = await suggestTestsFromGitDiffTool.handler(
      {
        mode: "working_tree",
        includeUntracked: true
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.diffSummary.changedFiles).toBeGreaterThanOrEqual(2);
    expect(result.suggestions.some((item) => item.id === "ui5-controller-view-regression")).toBe(true);
    expect(result.suggestions.some((item) => item.id === "no-tests-updated")).toBe(true);
    expect(result.recommendedCommands).toContain("npm run test:run");
    expect(result.recommendedCommands).toContain("npm run check");
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
