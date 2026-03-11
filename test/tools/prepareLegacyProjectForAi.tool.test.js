import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prepareLegacyProjectForAiTool } from "../../src/tools/agents/prepareLegacyProjectForAi.js";

describe("prepare_legacy_project_for_ai tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-prepare-legacy-"));
    const manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    const viewPath = path.join(tempRoot, "webapp", "view", "Main.view.xml");
    const controllerPath = path.join(tempRoot, "webapp", "controller", "Main.controller.js");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.mkdir(path.dirname(viewPath), { recursive: true });
    await fs.mkdir(path.dirname(controllerPath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "legacy.demo" },
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

  it("creates intake, baseline and context index in one call", async () => {
    const result = await prepareLegacyProjectForAiTool.handler(
      {
        autoApply: true,
        runEnsureProjectMcp: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.ran.collectIntake).toBe(true);
    expect(result.ran.analyzeBaseline).toBe(true);
    expect(result.ran.buildContextIndex).toBe(true);
    expect(result.artifactsAfter.intake).toBe(true);
    expect(result.artifactsAfter.baseline).toBe(true);
    expect(result.artifactsAfter.contextIndex).toBe(true);

    await expect(fs.access(path.join(tempRoot, ".codex", "mcp", "project", "intake.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempRoot, ".codex", "mcp", "project", "legacy-baseline.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempRoot, ".codex", "mcp", "context", "context-index.json"))).resolves.toBeUndefined();
  });

  it("skips heavy steps when artifacts already exist and refresh flags are disabled", async () => {
    await prepareLegacyProjectForAiTool.handler(
      {
        autoApply: true,
        runEnsureProjectMcp: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const secondRun = await prepareLegacyProjectForAiTool.handler(
      {
        autoApply: true,
        runEnsureProjectMcp: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(secondRun.ran.collectIntake).toBe(false);
    expect(secondRun.ran.analyzeBaseline).toBe(false);
    expect(secondRun.ran.buildContextIndex).toBe(false);
    expect(secondRun.changed.intake).toBe(false);
    expect(secondRun.changed.baseline).toBe(false);
    expect(secondRun.changed.contextIndex).toBe(false);
  });
});
