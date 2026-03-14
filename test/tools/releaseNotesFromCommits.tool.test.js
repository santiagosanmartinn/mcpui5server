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
    await git(["tag", "v1.0.0"], { cwd: tempRoot });

    await fs.writeFile(path.join(tempRoot, "feature.txt"), "new feature\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "feat(ui5): add feature module"], { cwd: tempRoot });

    await fs.writeFile(path.join(tempRoot, "bugfix.txt"), "fix bug\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "fix: resolve startup issue"], { cwd: tempRoot });
    await git(["tag", "v1.1.0"], { cwd: tempRoot });

    await fs.writeFile(path.join(tempRoot, "notes.txt"), "post release\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "docs: post release notes"], { cwd: tempRoot });
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

  it("compares tags and returns changelog format", async () => {
    const result = await releaseNotesFromCommitsTool.handler(
      {
        compareBy: "tags",
        fromTag: "v1.0.0",
        toTag: "v1.1.0",
        format: "changelog",
        language: "en",
        includeAuthors: false
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.range.mode).toBe("tag_range");
    expect(result.range.compareBy).toBe("tags");
    expect(result.range.fromTag).toBe("v1.0.0");
    expect(result.range.toTag).toBe("v1.1.0");
    expect(result.releaseNotes.format).toBe("changelog");
    expect(result.releaseNotes.markdown).toContain("# Changelog");
    expect(result.releaseNotes.markdown).toContain("## [v1.1.0]");
    expect(result.releaseNotes.markdown).toContain("### Added");
    expect(result.summary.byType.feat).toBeGreaterThanOrEqual(1);
    expect(result.summary.byType.fix).toBeGreaterThanOrEqual(1);
  });

  it("supports since_latest_tag mode for unreleased commits", async () => {
    const result = await releaseNotesFromCommitsTool.handler(
      {
        compareBy: "since_latest_tag",
        format: "changelog",
        language: "es",
        includeAuthors: false
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.range.mode).toBe("since_latest_tag");
    expect(result.range.compareBy).toBe("since_latest_tag");
    expect(result.range.fromTag).toBe("v1.1.0");
    expect(result.releaseNotes.markdown).toContain("# Changelog");
    expect(result.releaseNotes.markdown).toContain("### Documentation");
    expect(result.summary.totalCommits).toBeGreaterThanOrEqual(1);
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
