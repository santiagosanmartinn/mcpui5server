import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { recordAgentExecutionFeedbackTool } from "../../src/tools/agents/recordAgentExecutionFeedback.js";

describe("record_agent_execution_feedback tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-feedback-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("returns deterministic previews in dryRun mode", async () => {
    const result = await recordAgentExecutionFeedbackTool.handler(
      {
        packSlug: "ui5-pack",
        packVersion: "1.0.0",
        projectType: "sapui5",
        ui5Version: "1.120.0",
        outcome: "success"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.dryRun).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.applyResult).toBeNull();
    expect(result.files.feedbackPath).toBe(".codex/mcp/feedback/executions.jsonl");
    expect(result.files.metricsPath).toBe(".codex/mcp/feedback/metrics.json");
    expect(result.previews.length).toBe(2);
    expect(result.metrics.totalExecutions).toBe(1);
  });

  it("persists feedback log and updates aggregate metrics", async () => {
    await recordAgentExecutionFeedbackTool.handler(
      {
        packSlug: "ui5-pack",
        packVersion: "1.0.0",
        projectType: "sapui5",
        ui5Version: "1.120.0",
        outcome: "success",
        qualityGatePass: true,
        issuesIntroduced: 0,
        manualEditsNeeded: 1,
        timeSavedMinutes: 12,
        tokenDeltaEstimate: 80,
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const second = await recordAgentExecutionFeedbackTool.handler(
      {
        packSlug: "ui5-pack",
        packVersion: "1.0.0",
        projectType: "sapui5",
        ui5Version: "1.120.0",
        outcome: "failed",
        qualityGatePass: false,
        issuesIntroduced: 2,
        manualEditsNeeded: 3,
        timeSavedMinutes: 0,
        tokenDeltaEstimate: -40,
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
    expect(second.metrics.pack.executions).toBe(2);
    expect(second.metrics.pack.qualityGatePasses).toBe(1);
    expect(second.metrics.pack.qualityGateFails).toBe(1);
    expect(second.metrics.pack.issuesIntroducedTotal).toBe(2);
    expect(second.metrics.pack.manualEditsNeededTotal).toBe(4);
    expect(second.metrics.pack.timeSavedMinutesTotal).toBe(12);
    expect(second.metrics.pack.tokenDeltaEstimateTotal).toBe(40);

    const feedbackPath = path.join(tempRoot, ".codex", "mcp", "feedback", "executions.jsonl");
    const metricsPath = path.join(tempRoot, ".codex", "mcp", "feedback", "metrics.json");
    const feedbackContent = await fs.readFile(feedbackPath, "utf8");
    const feedbackLines = feedbackContent.trim().split(/\r?\n/);
    expect(feedbackLines.length).toBe(2);

    const metrics = JSON.parse(await fs.readFile(metricsPath, "utf8"));
    expect(metrics.totals.executions).toBe(2);
    expect(metrics.packs["ui5-pack@1.0.0"].executions).toBe(2);
    expect(metrics.packs["ui5-pack@1.0.0"].projectTypes.sapui5).toBe(2);
  });
});
