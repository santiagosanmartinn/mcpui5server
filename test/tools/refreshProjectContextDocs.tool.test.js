import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { refreshProjectContextDocsTool } from "../../src/tools/agents/refreshProjectContextDocs.js";

describe("refresh_project_context_docs tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-refresh-context-"));
    const manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    const viewPath = path.join(tempRoot, "webapp", "view", "Main.view.xml");
    const controllerPath = path.join(tempRoot, "webapp", "controller", "Main.controller.js");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.mkdir(path.dirname(viewPath), { recursive: true });
    await fs.mkdir(path.dirname(controllerPath), { recursive: true });

    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.refresh" },
        "sap.ui5": {}
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      viewPath,
      "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\"><Page title=\"Main\" /></mvc:View>\n",
      "utf8"
    );
    await fs.writeFile(
      controllerPath,
      "sap.ui.define([], function () { return {}; });\n",
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("supports dryRun without writing docs or snapshot", async () => {
    const result = await refreshProjectContextDocsTool.handler(
      {
        dryRun: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.dryRun).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.applyResult).toBeNull();
    await expect(fs.access(path.join(tempRoot, "docs", "mcp", "project-context.md"))).rejects.toThrow();
    await expect(fs.access(path.join(tempRoot, ".codex", "mcp", "context-snapshot.json"))).rejects.toThrow();
  });

  it("applies refresh and remains idempotent on second run", async () => {
    const first = await refreshProjectContextDocsTool.handler(
      {
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(first.changed).toBe(true);
    expect(first.applyResult?.patchId).toMatch(/^patch-/);
    await expect(fs.access(path.join(tempRoot, "docs", "mcp", "project-context.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempRoot, "docs", "mcp", "agent-flows.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempRoot, ".codex", "mcp", "context-snapshot.json"))).resolves.toBeUndefined();

    const second = await refreshProjectContextDocsTool.handler(
      {
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(second.changed).toBe(false);
    expect(second.applyResult).toBeNull();
    expect(second.delta.modified).toBe(0);
  });

  it("rejects docsDir outside docs subtree", async () => {
    await expect(
      refreshProjectContextDocsTool.handler(
        {
          docsDir: ".codex/mcp/invalid",
          dryRun: true
        },
        {
          context: { rootDir: tempRoot }
        }
      )
    ).rejects.toMatchObject({ code: "INVALID_ARTIFACT_LAYOUT" });
  });
});
