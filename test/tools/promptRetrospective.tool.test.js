import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { promptRetrospectiveTool } from "../../src/tools/project/promptRetrospective.js";

describe("prompt_retrospective", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-prompt-retro-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("returns dry-run preview without writing files", async () => {
    const result = await promptRetrospectiveTool.handler(
      {
        promptUsed: "Objetivo: corregir bug. Restricciones: no tocar manifest.",
        outcome: "partial",
        issues: ["falto criterio de aceptacion"],
        dryRun: true
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.dryRun).toBe(true);
    expect(result.preview.changed).toBe(true);
    expect(result.applyResult).toBeNull();
    const exists = await fs.access(path.join(tempRoot, ".codex", "mcp", "prompts", "retrospectives.jsonl"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("persists retrospective record when dryRun is false", async () => {
    const result = await promptRetrospectiveTool.handler(
      {
        taskType: "bugfix",
        promptUsed: "Objetivo: corregir bug en Main.controller.js.",
        outcome: "success",
        qualityGatePassed: true,
        iterations: 1,
        dryRun: false
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.dryRun).toBe(false);
    expect(result.applyResult?.patchId).toBeTruthy();
    const logPath = path.join(tempRoot, ".codex", "mcp", "prompts", "retrospectives.jsonl");
    const content = await fs.readFile(logPath, "utf8");
    expect(content.trim().length).toBeGreaterThan(0);
    const last = JSON.parse(content.trim().split(/\r?\n/).at(-1));
    expect(last.outcome).toBe("success");
    expect(last.taskType).toBe("bugfix");
  });
});
