import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { scaffoldProjectAgentsTool } from "../../src/tools/agents/scaffoldProjectAgents.js";

describe("scaffold_project_agents tool", () => {
  let tempRoot;
  let manifestPath;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-scaffold-agents-"));
    manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.project" },
        "sap.ui5": {}
      }, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("supports dryRun and returns preview without writing files", async () => {
    const result = await scaffoldProjectAgentsTool.handler(
      {
        dryRun: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.dryRun).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.project.type).toBe("sapui5");
    expect(result.project.name).toBe("demo.project");
    expect(result.applyResult).toBeNull();
    expect(result.previews.map((item) => item.role)).toEqual(
      expect.arrayContaining(["blueprint", "agents-guide", "bootstrap-prompt", "context-doc", "flows-doc"])
    );
    await expect(fs.access(path.join(tempRoot, ".codex", "mcp", "agents", "agent.blueprint.json"))).rejects.toThrow();
    await expect(fs.access(path.join(tempRoot, ".vscode", "mcp.json"))).rejects.toThrow();
  });

  it("applies scaffold and remains idempotent", async () => {
    const first = await scaffoldProjectAgentsTool.handler(
      {
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(first.changed).toBe(true);
    expect(first.applyResult?.patchId).toMatch(/^patch-/);
    const blueprintPath = path.join(tempRoot, ".codex", "mcp", "agents", "agent.blueprint.json");
    const guidePath = path.join(tempRoot, ".codex", "mcp", "agents", "AGENTS.generated.md");
    const promptPath = path.join(tempRoot, ".codex", "mcp", "agents", "prompts", "task-bootstrap.txt");
    const contextPath = path.join(tempRoot, "docs", "mcp", "project-context.md");
    const mcpPath = path.join(tempRoot, ".vscode", "mcp.json");

    await expect(fs.access(blueprintPath)).resolves.toBeUndefined();
    await expect(fs.access(guidePath)).resolves.toBeUndefined();
    await expect(fs.access(promptPath)).resolves.toBeUndefined();
    await expect(fs.access(contextPath)).resolves.toBeUndefined();
    await expect(fs.access(mcpPath)).rejects.toThrow();

    const second = await scaffoldProjectAgentsTool.handler(
      {
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(second.changed).toBe(false);
    expect(second.applyResult).toBeNull();
    expect(second.fileSummary.unchanged).toBeGreaterThanOrEqual(5);
  });

  it("rejects overwrite of managed artifacts unless allowOverwrite is true", async () => {
    const blueprintPath = path.join(tempRoot, ".codex", "mcp", "agents", "agent.blueprint.json");
    await fs.mkdir(path.dirname(blueprintPath), { recursive: true });
    await fs.writeFile(blueprintPath, "{\"legacy\":true}\n", "utf8");

    await expect(
      scaffoldProjectAgentsTool.handler(
        {
          dryRun: true,
          includeVscodeMcp: true
        },
        {
          context: { rootDir: tempRoot }
        }
      )
    ).rejects.toMatchObject({ code: "AGENT_FILE_EXISTS" });
  });

  it("rejects conflicting sapui5 MCP entry unless allowOverwrite is true", async () => {
    const mcpPath = path.join(tempRoot, ".vscode", "mcp.json");
    await fs.mkdir(path.dirname(mcpPath), { recursive: true });
    await fs.writeFile(
      mcpPath,
      `${JSON.stringify({
        mcpServers: {
          sapui5: {
            command: "node",
            args: ["./other.js"]
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );

    await expect(
      scaffoldProjectAgentsTool.handler(
        {
          dryRun: true,
          includeVscodeMcp: true
        },
        {
          context: { rootDir: tempRoot }
        }
      )
    ).rejects.toMatchObject({ code: "MCP_SERVER_CONFLICT" });
  });
});
