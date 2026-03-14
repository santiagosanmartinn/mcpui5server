import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { releaseNotesFromCommitsTool } from "../../src/tools/project/releaseNotesFromCommits.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("release_notes_from_commits", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-release-notes-"));
    await initGitRepo(tempRoot);
    await fs.writeFile(path.join(tempRoot, "README.md"), "initial\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "chore: initial"], { cwd: tempRoot });

    await fs.writeFile(path.join(tempRoot, "feature.txt"), "new feature\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "feat(ui5): add feature module"], { cwd: tempRoot });

    await fs.writeFile(path.join(tempRoot, "bugfix.txt"), "fix bug\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "fix: resolve startup issue"], { cwd: tempRoot });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("builds release notes from recent commits in spanish by default", async () => {
    const result = await releaseNotesFromCommitsTool.handler(
      {
        maxCommits: 10,
        includeAuthors: false
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.summary.totalCommits).toBeGreaterThanOrEqual(3);
    expect(result.summary.byType.feat).toBeGreaterThanOrEqual(1);
    expect(result.summary.byType.fix).toBeGreaterThanOrEqual(1);
    expect(result.releaseNotes.markdown).toContain("# Notas de Version");
    expect(result.releaseNotes.markdown).toContain("## Nuevas funcionalidades");
    expect(result.automationPolicy.readOnlyGitAnalysis).toBe(true);
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
