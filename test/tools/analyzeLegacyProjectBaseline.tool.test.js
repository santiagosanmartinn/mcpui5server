import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { analyzeLegacyProjectBaselineTool } from "../../src/tools/agents/analyzeLegacyProjectBaseline.js";

describe("analyze_legacy_project_baseline tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-legacy-baseline-"));
    const manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    const controllerPath = path.join(tempRoot, "webapp", "controller", "Main.controller.js");
    const viewPath = path.join(tempRoot, "webapp", "view", "Main.view.xml");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.mkdir(path.dirname(controllerPath), { recursive: true });
    await fs.mkdir(path.dirname(viewPath), { recursive: true });

    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "legacy.baseline" },
        "sap.ui5": {
          dependencies: {
            minUI5Version: "1.71.0"
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      controllerPath,
      "sap.ui.define([], function () { eval('x'); console.log('debug'); return {}; });\n",
      "utf8"
    );
    await fs.writeFile(
      viewPath,
      "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\"><HTML content=\"<b>x</b>\" /></mvc:View>\n",
      "utf8"
    );

    const intakePath = path.join(tempRoot, ".codex", "mcp", "project", "intake.json");
    await fs.mkdir(path.dirname(intakePath), { recursive: true });
    await fs.writeFile(
      intakePath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        updatedAt: "2026-03-11T00:00:00.000Z",
        qualityPriority: true,
        project: {
          name: "legacy.baseline",
          type: "sapui5",
          namespace: "legacy.baseline",
          detectedUi5Version: "1.71.0"
        },
        context: {
          projectGoal: "Stabilize approvals",
          businessDomain: "sales",
          criticality: "high",
          runtimeLandscape: null,
          ui5RuntimeVersion: "1.71.0",
          allowedRefactorScope: "incremental",
          mustKeepStableAreas: [],
          knownPainPoints: [],
          constraints: [],
          complianceRequirements: [],
          notes: null
        },
        missingContext: []
      }, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("generates legacy baseline artifacts with risks and hotspots", async () => {
    const report = await analyzeLegacyProjectBaselineTool.handler(
      {
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.applyResult?.patchId).toMatch(/^patch-/);
    expect(report.project.type).toBe("sapui5");
    expect(report.qualityRisks.some((item) => item.severity === "high")).toBe(true);
    expect(report.hotspots.length).toBeGreaterThanOrEqual(1);

    const baselinePath = path.join(tempRoot, ".codex", "mcp", "project", "legacy-baseline.json");
    const baselineDocPath = path.join(tempRoot, "docs", "mcp", "legacy-baseline.md");
    await expect(fs.access(baselinePath)).resolves.toBeUndefined();
    await expect(fs.access(baselineDocPath)).resolves.toBeUndefined();
  });
});
