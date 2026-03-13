import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { scaffoldProjectSkillsTool } from "../../src/tools/agents/scaffoldProjectSkills.js";
import { recordSkillExecutionFeedbackTool } from "../../src/tools/agents/recordSkillExecutionFeedback.js";

describe("record_skill_execution_feedback tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-feedback-skills-"));
    const manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.feedback.skills" },
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

  it("returns deterministic preview in dryRun mode", async () => {
    const result = await recordSkillExecutionFeedbackTool.handler(
      {
        skillId: "ui5-feature-implementation-safe",
        outcome: "success"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.dryRun).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.applyResult).toBeNull();
    expect(result.files.feedbackPath).toBe(".codex/mcp/skills/feedback/executions.jsonl");
    expect(result.files.metricsPath).toBe(".codex/mcp/skills/feedback/metrics.json");
    expect(result.metrics.totalExecutions).toBe(1);
  });

  it("persists feedback and updates aggregate metrics", async () => {
    await recordSkillExecutionFeedbackTool.handler(
      {
        skillId: "ui5-feature-implementation-safe",
        outcome: "success",
        qualityGatePass: true,
        usefulnessScore: 5,
        timeSavedMinutes: 12,
        tokenDeltaEstimate: 120,
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const second = await recordSkillExecutionFeedbackTool.handler(
      {
        skillId: "ui5-feature-implementation-safe",
        outcome: "failed",
        qualityGatePass: false,
        usefulnessScore: 2,
        timeSavedMinutes: 0,
        tokenDeltaEstimate: -20,
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(second.applyResult?.patchId).toMatch(/^patch-/);
    expect(second.metrics.totalExecutions).toBe(2);
    expect(second.metrics.totals.success).toBe(1);
    expect(second.metrics.totals.failed).toBe(1);
    expect(second.metrics.skill.executions).toBe(2);
    expect(second.metrics.skill.qualityGatePasses).toBe(1);
    expect(second.metrics.skill.qualityGateFails).toBe(1);
    expect(second.metrics.skill.timeSavedMinutesTotal).toBe(12);
    expect(second.metrics.skill.tokenDeltaEstimateTotal).toBe(100);

    const feedbackPath = path.join(tempRoot, ".codex", "mcp", "skills", "feedback", "executions.jsonl");
    const metricsPath = path.join(tempRoot, ".codex", "mcp", "skills", "feedback", "metrics.json");
    const feedbackContent = await fs.readFile(feedbackPath, "utf8");
    const feedbackLines = feedbackContent.trim().split(/\r?\n/);
    expect(feedbackLines.length).toBe(2);

    const metrics = JSON.parse(await fs.readFile(metricsPath, "utf8"));
    expect(metrics.totals.executions).toBe(2);
    expect(metrics.skills["ui5-feature-implementation-safe"].executions).toBe(2);
  });
});
