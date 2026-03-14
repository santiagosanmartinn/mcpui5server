import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateCommitMessageFromDiffTool } from "../../src/tools/project/generateCommitMessageFromDiff.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("generate_commit_message_from_diff", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-commit-msg-"));
    await initGitRepo(tempRoot);
    await fs.mkdir(path.join(tempRoot, "docs"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "docs", "notes.md"), "initial docs\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await git(["commit", "-m", "initial"], { cwd: tempRoot });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("generates docs-style commit message for docs-only changes", async () => {
    await fs.writeFile(path.join(tempRoot, "docs", "notes.md"), "updated docs\n", "utf8");

    const result = await generateCommitMessageFromDiffTool.handler(
      {
        style: "conventional"
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.commit.type).toBe("docs");
    expect(result.commit.subject.startsWith("docs(") || result.commit.subject.startsWith("docs:")).toBe(true);
    expect(result.commit.fullMessage).toContain("Archivos cambiados");
  });

  it("supports explicit override for type/scope and plain style", async () => {
    await fs.mkdir(path.join(tempRoot, "webapp", "controller"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const x = 1;\n", "utf8");

    const result = await generateCommitMessageFromDiffTool.handler(
      {
        style: "plain",
        type: "feat",
        scope: "ui5"
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.commit.type).toBe("feat");
    expect(result.commit.scope).toBe("ui5");
    expect(result.commit.subject.startsWith("Feat:")).toBe(true);
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
