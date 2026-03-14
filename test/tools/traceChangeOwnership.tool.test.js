import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { traceChangeOwnershipTool } from "../../src/tools/project/traceChangeOwnership.js";

const execFileAsync = promisify(execFile);
const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const describeIfGit = gitAvailable ? describe : describe.skip;

describeIfGit("trace_change_ownership", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-trace-ownership-"));
    await initGitRepo(tempRoot);
    await fs.mkdir(path.join(tempRoot, "webapp", "controller"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "webapp", "view"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const c = 1;\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await gitWithAuthor(["commit", "-m", "controller by alice"], {
      cwd: tempRoot,
      name: "Alice",
      email: "alice@example.com"
    });

    await fs.writeFile(path.join(tempRoot, "webapp", "view", "Main.view.xml"), "<View />\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await gitWithAuthor(["commit", "-m", "view by bob"], {
      cwd: tempRoot,
      name: "Bob",
      email: "bob@example.com"
    });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("suggests owners from git history for changed files", async () => {
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "const c = 2;\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "webapp", "view", "Main.view.xml"), "<View id=\"Main\" />\n", "utf8");

    const result = await traceChangeOwnershipTool.handler(
      {
        mode: "working_tree",
        includeUntracked: false
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.ownership.owners.length).toBeGreaterThanOrEqual(2);
    expect(result.ownership.reviewerSuggestions.some((value) => value.includes("Alice"))).toBe(true);
    expect(result.ownership.reviewerSuggestions.some((value) => value.includes("Bob"))).toBe(true);
    expect(result.automationPolicy.readOnlyGitAnalysis).toBe(true);
  });

  it("prioritizes recent zone ownership using blame data", async () => {
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Recent.controller.js"), "const x = 1;\nconst y = 1;\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await gitWithAuthor(["commit", "-m", "recent controller by alice"], {
      cwd: tempRoot,
      name: "Alice",
      email: "alice@example.com",
      date: "2024-01-01T08:00:00Z"
    });

    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Recent.controller.js"), "const x = 2;\nconst y = 2;\n", "utf8");
    await git(["add", "."], { cwd: tempRoot });
    await gitWithAuthor(["commit", "-m", "recent controller by bob"], {
      cwd: tempRoot,
      name: "Bob",
      email: "bob@example.com",
      date: "2026-03-10T09:00:00Z"
    });

    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Recent.controller.js"), "const x = 3;\nconst y = 2;\n", "utf8");

    const result = await traceChangeOwnershipTool.handler(
      {
        mode: "working_tree",
        includeUntracked: false
      },
      { context: { rootDir: tempRoot } }
    );

    const topOwner = result.ownership.owners[0];
    expect(topOwner).toBeDefined();
    expect(topOwner.name).toBe("Bob");
    const targetFile = result.ownership.fileOwnership.find((item) => item.path.endsWith("Recent.controller.js"));
    expect(targetFile).toBeDefined();
    expect(targetFile.topZoneOwners.some((item) => item.name === "Bob")).toBe(true);
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

async function gitWithAuthor(args, options) {
  const cwd = options.cwd ?? process.cwd();
  await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: options.name,
      GIT_AUTHOR_EMAIL: options.email,
      GIT_COMMITTER_NAME: options.name,
      GIT_COMMITTER_EMAIL: options.email,
      ...(options.date
        ? {
          GIT_AUTHOR_DATE: options.date,
          GIT_COMMITTER_DATE: options.date
        }
        : {})
    }
  });
}
