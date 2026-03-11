import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { runProjectQualityGateTool } from "../../src/tools/project/runProjectQualityGate.js";

describe("run_project_quality_gate tool", () => {
  let tempRoot;
  let manifestPath;
  let viewPath;
  let controllerPath;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-quality-gate-"));
    manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    viewPath = path.join(tempRoot, "webapp", "view", "Main.view.xml");
    controllerPath = path.join(tempRoot, "webapp", "controller", "Main.controller.js");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.mkdir(path.dirname(viewPath), { recursive: true });
    await fs.mkdir(path.dirname(controllerPath), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("fails gate when compatibility and security checks have high-severity issues", async () => {
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.quality" },
        "sap.ui5": {
          dependencies: {
            minUI5Version: "1.30.0"
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      viewPath,
      "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\"><DateTimePicker value=\"{orderDate}\" /></mvc:View>\n",
      "utf8"
    );
    await fs.writeFile(
      controllerPath,
      "sap.ui.define([], function () { eval('x'); return {}; });\n",
      "utf8"
    );

    const report = await runProjectQualityGateTool.handler(
      {
        sourceDir: "webapp",
        refreshDocs: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.pass).toBe(false);
    expect(report.summary.incompatibleSymbols).toBeGreaterThan(0);
    expect(report.summary.highSecurityFindings).toBeGreaterThan(0);
  });

  it("passes gate for compatible and safe baseline", async () => {
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.quality" },
        "sap.ui5": {
          dependencies: {
            minUI5Version: "1.60.0"
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      viewPath,
      "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\"><DatePicker value=\"{orderDate}\" /></mvc:View>\n",
      "utf8"
    );
    await fs.writeFile(
      controllerPath,
      "sap.ui.define([], function () { return { onInit: function () {} }; });\n",
      "utf8"
    );

    const report = await runProjectQualityGateTool.handler(
      {
        sourceDir: "webapp",
        refreshDocs: true,
        applyDocs: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.pass).toBe(true);
    expect(report.summary.incompatibleSymbols).toBe(0);
    expect(report.summary.highSecurityFindings).toBe(0);
  });

  it("enforces quality gate policy from agent-policy.json", async () => {
    const policyPath = path.join(tempRoot, ".codex", "mcp", "policies", "agent-policy.json");
    await fs.mkdir(path.dirname(policyPath), { recursive: true });
    await fs.writeFile(
      policyPath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        enabled: true,
        qualityGate: {
          enabled: true,
          failOnMediumSecurity: true,
          refreshDocs: false
        }
      }, null, 2)}\n`,
      "utf8"
    );

    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.quality" },
        "sap.ui5": {
          dependencies: {
            minUI5Version: "1.60.0"
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      viewPath,
      "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\"><DatePicker value=\"{orderDate}\" /></mvc:View>\n",
      "utf8"
    );
    await fs.writeFile(
      controllerPath,
      "sap.ui.define([], function () { $(\"#x\").html(value); return {}; });\n",
      "utf8"
    );

    const report = await runProjectQualityGateTool.handler(
      {
        sourceDir: "webapp",
        failOnMediumSecurity: false,
        refreshDocs: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.policy.loaded).toBe(true);
    expect(report.policy.enforced).toBe(true);
    expect(report.summary.mediumSecurityFindings).toBeGreaterThan(0);
    expect(report.pass).toBe(false);
  });
});
