import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { scaffoldProjectAgentsTool } from "../../src/tools/agents/scaffoldProjectAgents.js";
import { validateProjectAgentsTool } from "../../src/tools/agents/validateProjectAgents.js";

describe("validate_project_agents tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-validate-agents-"));
    const manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.validate" },
        "sap.ui5": {}
      }, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("validates scaffolded agent artifacts in strict mode", async () => {
    await scaffoldProjectAgentsTool.handler(
      {
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const report = await validateProjectAgentsTool.handler(
      {
        strict: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.valid).toBe(true);
    expect(report.summary.errorCount).toBe(0);
    expect(report.detected.projectType).toBe("sapui5");
    expect(report.summary.checksPassed).toBeGreaterThan(0);
  });

  it("reports missing blueprint as invalid without throwing", async () => {
    const report = await validateProjectAgentsTool.handler(
      {
        strict: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.valid).toBe(false);
    expect(report.summary.errorCount).toBeGreaterThan(0);
    expect(report.errors.some((item) => item.includes("Blueprint file is unavailable"))).toBe(true);
  });

  it("downgrades unknown tool checks to warnings in non-strict mode", async () => {
    await scaffoldProjectAgentsTool.handler(
      {
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const blueprintPath = path.join(tempRoot, ".codex", "mcp", "agents", "agent.blueprint.json");
    const blueprint = JSON.parse(await fs.readFile(blueprintPath, "utf8"));
    blueprint.agents[0].allowedTools.push("unknown_tool_contract");
    await fs.writeFile(blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");

    const report = await validateProjectAgentsTool.handler(
      {
        strict: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.valid).toBe(true);
    expect(report.summary.warningCount).toBeGreaterThan(0);
    expect(report.warnings.some((item) => item.includes("Unknown tools detected"))).toBe(true);
  });
});
