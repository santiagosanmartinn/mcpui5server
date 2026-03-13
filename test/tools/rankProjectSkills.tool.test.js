import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { scaffoldProjectSkillsTool } from "../../src/tools/agents/scaffoldProjectSkills.js";
import { recordSkillExecutionFeedbackTool } from "../../src/tools/agents/recordSkillExecutionFeedback.js";
import { rankProjectSkillsTool } from "../../src/tools/agents/rankProjectSkills.js";

describe("rank_project_skills tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-rank-skills-"));
    const manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.rank.skills" },
        "sap.ui5": {}
      }, null, 2)}\n`,
      "utf8"
    );

    await scaffoldProjectSkillsTool.handler(
      {
        includeDefaultSkills: true,
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("returns neutral no-feedback entries when no executions exist", async () => {
    const result = await rankProjectSkillsTool.handler(
      {
        includeUnscored: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.exists.catalog).toBe(true);
    expect(result.summary.totalCatalogSkills).toBeGreaterThan(0);
    expect(result.rankedSkills.every((item) => item.rankStatus === "no-feedback")).toBe(true);
  });

  it("promotes scored skills to ranked status when feedback exists", async () => {
    await recordSkillExecutionFeedbackTool.handler(
      {
        skillId: "ui5-feature-implementation-safe",
        outcome: "success",
        qualityGatePass: true,
        usefulnessScore: 5,
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const result = await rankProjectSkillsTool.handler(
      {
        includeUnscored: true,
        minExecutions: 1
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const target = result.rankedSkills.find((item) => item.id === "ui5-feature-implementation-safe");
    expect(target).toBeDefined();
    expect(target?.rankStatus).toBe("ranked");
    expect(target?.score).toBeGreaterThan(0.5);
  });
});
