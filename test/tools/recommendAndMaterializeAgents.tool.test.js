import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { recommendProjectAgentsTool } from "../../src/tools/agents/recommendProjectAgents.js";
import { materializeRecommendedAgentsTool } from "../../src/tools/agents/materializeRecommendedAgents.js";
import { validateProjectAgentsTool } from "../../src/tools/agents/validateProjectAgents.js";

describe("recommend/materialize agent tools", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-recommend-agents-"));
    const manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    const viewPath = path.join(tempRoot, "webapp", "view", "Main.view.xml");
    const controllerPath = path.join(tempRoot, "webapp", "controller", "Main.controller.js");
    const i18nPath = path.join(tempRoot, "webapp", "i18n", "i18n.properties");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.mkdir(path.dirname(viewPath), { recursive: true });
    await fs.mkdir(path.dirname(controllerPath), { recursive: true });
    await fs.mkdir(path.dirname(i18nPath), { recursive: true });

    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.recommend" },
        "sap.ui5": {
          routing: {
            routes: [{ name: "main", pattern: "", target: ["main"] }],
            targets: { main: { viewName: "Main" } }
          }
        }
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
    await fs.writeFile(i18nPath, "main.title=Main\n", "utf8");
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("recommends agent profiles with materialization args", async () => {
    const report = await recommendProjectAgentsTool.handler(
      {},
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.project.type).toBe("sapui5");
    expect(report.recommendations.length).toBeGreaterThanOrEqual(3);
    expect(report.suggestedMaterializationArgs.agentDefinitions.length).toBeGreaterThanOrEqual(2);
    expect(report.signals.hasManifest).toBe(true);
  });

  it("materializes recommended agents and produces valid artifacts", async () => {
    const result = await materializeRecommendedAgentsTool.handler(
      {
        dryRun: false,
        includePackCatalog: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.source).toBe("auto-recommend");
    expect(result.scaffoldResult.changed).toBe(true);
    expect(result.scaffoldResult.applyResult?.patchId).toMatch(/^patch-/);
    const blueprintPath = path.join(tempRoot, ".codex", "mcp", "agents", "agent.blueprint.json");
    await expect(fs.access(blueprintPath)).resolves.toBeUndefined();

    const blueprint = JSON.parse(await fs.readFile(blueprintPath, "utf8"));
    expect(Array.isArray(blueprint.agents)).toBe(true);
    expect(blueprint.agents.length).toBeGreaterThanOrEqual(2);
    expect(blueprint.recommendation?.source).toBe("auto-recommend");

    const validation = await validateProjectAgentsTool.handler(
      {
        strict: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );
    expect(validation.valid).toBe(true);
  });
});
