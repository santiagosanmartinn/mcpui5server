import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { buildAiContextIndexTool } from "../../src/tools/agents/buildAiContextIndex.js";

describe("build_ai_context_index tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-context-index-"));
    const manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    const controllerPath = path.join(tempRoot, "webapp", "controller", "Main.controller.js");
    const policyPath = path.join(tempRoot, ".codex", "mcp", "policies", "agent-policy.json");
    const intakePath = path.join(tempRoot, ".codex", "mcp", "project", "intake.json");
    const baselinePath = path.join(tempRoot, ".codex", "mcp", "project", "legacy-baseline.json");

    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.mkdir(path.dirname(controllerPath), { recursive: true });
    await fs.mkdir(path.dirname(policyPath), { recursive: true });
    await fs.mkdir(path.dirname(intakePath), { recursive: true });
    await fs.mkdir(path.dirname(baselinePath), { recursive: true });

    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "legacy.context" },
        "sap.ui5": {
          routing: {
            routes: [{ name: "main", pattern: "" }],
            targets: { main: { viewName: "Main" } }
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      controllerPath,
      "sap.ui.define([], function () { return { onInit: function () {}, onSave: function () {} }; });\n",
      "utf8"
    );
    await fs.writeFile(
      policyPath,
      `${JSON.stringify({ schemaVersion: "1.0.0", enabled: true }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      intakePath,
      `${JSON.stringify({ schemaVersion: "1.0.0", missingContext: [] }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      baselinePath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        hotspots: [
          {
            path: "webapp/controller/Main.controller.js",
            score: 0.9
          }
        ],
        qualityRisks: [
          {
            file: "webapp/controller/Main.controller.js",
            severity: "medium"
          }
        ]
      }, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("builds context index with retrieval profiles and quality guards", async () => {
    const report = await buildAiContextIndexTool.handler(
      {
        dryRun: false,
        chunkChars: 800
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.applyResult?.patchId).toMatch(/^patch-/);
    expect(report.summary.indexedFiles).toBeGreaterThan(0);
    expect(report.summary.indexedChunks).toBeGreaterThan(0);
    expect(report.retrievalProfiles.length).toBeGreaterThanOrEqual(3);
    expect(report.qualityGuards.mandatoryPaths).toEqual(expect.arrayContaining([
      ".codex/mcp/project/intake.json",
      ".codex/mcp/policies/agent-policy.json"
    ]));

    const indexPath = path.join(tempRoot, ".codex", "mcp", "context", "context-index.json");
    const docPath = path.join(tempRoot, "docs", "mcp", "context-index.md");
    await expect(fs.access(indexPath)).resolves.toBeUndefined();
    await expect(fs.access(docPath)).resolves.toBeUndefined();
  });
});
