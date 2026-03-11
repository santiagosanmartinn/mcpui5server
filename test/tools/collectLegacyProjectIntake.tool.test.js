import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { collectLegacyProjectIntakeTool } from "../../src/tools/agents/collectLegacyProjectIntake.js";

describe("collect_legacy_project_intake tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-legacy-intake-"));
    const manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "legacy.demo" },
        "sap.ui5": {
          dependencies: {
            minUI5Version: "1.84.0"
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("returns missing-context questions when intake is incomplete", async () => {
    const report = await collectLegacyProjectIntakeTool.handler(
      {
        projectGoal: "Stabilize order approval flow",
        dryRun: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.project.type).toBe("sapui5");
    expect(report.needsUserInput).toBe(true);
    expect(report.missingContext).toEqual(expect.arrayContaining(["criticality", "allowedRefactorScope"]));
    expect(report.questions.length).toBeGreaterThanOrEqual(2);
  });

  it("persists intake and clears mandatory missing context when provided", async () => {
    const report = await collectLegacyProjectIntakeTool.handler(
      {
        projectGoal: "Stabilize order approval flow",
        criticality: "high",
        allowedRefactorScope: "incremental",
        ui5RuntimeVersion: "1.84.0",
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.needsUserInput).toBe(false);
    expect(report.applyResult?.patchId).toMatch(/^patch-/);

    const intakePath = path.join(tempRoot, ".codex", "mcp", "project", "intake.json");
    await expect(fs.access(intakePath)).resolves.toBeUndefined();
    const intake = JSON.parse(await fs.readFile(intakePath, "utf8"));
    expect(intake.context.criticality).toBe("high");
    expect(intake.context.allowedRefactorScope).toBe("incremental");
  });
});
