import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { generatePrDescriptionTool } from "../../src/tools/project/generatePrDescription.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("generate_pr_description", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-pr-desc-"));
    await initGitRepo(tempRoot);
    await fs.mkdir(path.join(tempRoot, "docs"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "docs", "notes.md"), "initial\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "initial"], { cwd: tempRoot });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("generates markdown with context, testing and checklist sections", async () => {
    await fs.writeFile(path.join(tempRoot, "docs", "notes.md"), "updated docs\n", "utf8");

    const result = await generatePrDescriptionTool.handler(
      {
        mode: "working_tree"
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.pr.markdown).toContain("## Context");
    expect(result.pr.markdown).toContain("## Testing");
    expect(result.pr.markdown).toContain("## Checklist");
    expect(result.pr.markdown).toContain("does not execute Git actions");
    expect(result.pr.labelsSuggested).toContain("docs");
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
