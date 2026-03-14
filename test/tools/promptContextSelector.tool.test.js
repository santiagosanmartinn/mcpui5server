import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { promptContextSelectorTool } from "../../src/tools/project/promptContextSelector.js";

describe("prompt_context_selector", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-prompt-context-"));
    await fs.mkdir(path.join(tempRoot, "webapp", "controller"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, ".codex", "mcp", "context"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "webapp", "controller", "Main.controller.js"), "function onSearch() { return true; }\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "README.md"), "project notes for search flow\n", "utf8");
    await fs.writeFile(
      path.join(tempRoot, ".codex", "mcp", "context", "context-index.json"),
      JSON.stringify(
        {
          qualityGuards: {
            mandatoryPaths: [
              ".codex/mcp/project/intake.json"
            ]
          },
          retrievalProfiles: [
            {
              id: "bugfix-targeted",
              queryHints: ["search", "controller"],
              mandatoryPaths: [".codex/mcp/policies/agent-policy.json"]
            }
          ],
          chunks: [
            {
              path: "webapp/controller/Main.controller.js",
              charLength: 220,
              priority: 1,
              keywords: ["search", "controller"],
              summary: "handles search event"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("selects context from index, mandatory paths, and keyword matches", async () => {
    const result = await promptContextSelectorTool.handler(
      {
        taskType: "bugfix",
        goal: "Corregir bug en flujo de search",
        queryTerms: ["search", "controller"],
        includeGitDiff: false,
        maxFiles: 5
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.strategy.usedContextIndex).toBe(true);
    expect(result.selectedPaths.some((item) => item.path === "webapp/controller/Main.controller.js")).toBe(true);
    expect(result.selectedPaths.some((item) => item.path === ".codex/mcp/project/intake.json")).toBe(true);
  });

  it("does not fail when git diff cannot be used", async () => {
    const result = await promptContextSelectorTool.handler(
      {
        goal: "Analizar impacto de bug",
        includeGitDiff: true,
        includeContextIndex: false,
        includeKeywordSearch: true,
        queryTerms: ["search"]
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.strategy.usedGitDiff).toBe(false);
    expect(Array.isArray(result.notes)).toBe(true);
  });
});
