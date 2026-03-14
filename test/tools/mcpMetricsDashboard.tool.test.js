import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { mcpMetricsDashboardTool } from "../../src/tools/project/mcpMetricsDashboard.js";

describe("mcp_metrics_dashboard", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-metrics-dashboard-"));
    await fs.mkdir(path.join(tempRoot, ".mcp-runtime", "logs"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("aggregates telemetry and highlights value, failures, and latency hotspots", async () => {
    await writeSession(tempRoot, "s1", {
      sessionId: "s1",
      startedAt: "2026-03-10T10:00:00.000Z",
      lastUpdatedAt: "2026-03-10T11:00:00.000Z",
      slowThresholdMs: 2000,
      totals: {
        toolInvocations: 20,
        successfulToolInvocations: 17,
        failedToolInvocations: 3,
        slowInvocations: 6,
        totalDurationMs: 22000
      },
      tools: {
        analyze_ui5_project: {
          count: 10,
          successCount: 10,
          errorCount: 0,
          slowCount: 1,
          totalDurationMs: 3000,
          averageDurationMs: 300,
          maxDurationMs: 900,
          errorCodes: {}
        },
        run_project_quality_gate: {
          count: 6,
          successCount: 4,
          errorCount: 2,
          slowCount: 3,
          totalDurationMs: 12000,
          averageDurationMs: 2000,
          maxDurationMs: 4200,
          errorCodes: {
            QUALITY_GATE_FAILED: 2
          }
        },
        validate_ui5_odata_usage: {
          count: 4,
          successCount: 3,
          errorCount: 1,
          slowCount: 2,
          totalDurationMs: 7000,
          averageDurationMs: 1750,
          maxDurationMs: 3500,
          errorCodes: {
            ODATA_RULE_FAILED: 1
          }
        }
      }
    });

    await writeSession(tempRoot, "s2", {
      sessionId: "s2",
      startedAt: "2026-03-11T09:00:00.000Z",
      lastUpdatedAt: "2026-03-11T10:00:00.000Z",
      slowThresholdMs: 2200,
      totals: {
        toolInvocations: 15,
        successfulToolInvocations: 13,
        failedToolInvocations: 2,
        slowInvocations: 5,
        totalDurationMs: 25000
      },
      tools: {
        analyze_ui5_project: {
          count: 8,
          successCount: 8,
          errorCount: 0,
          slowCount: 0,
          totalDurationMs: 3200,
          averageDurationMs: 400,
          maxDurationMs: 800,
          errorCodes: {}
        },
        run_project_quality_gate: {
          count: 4,
          successCount: 3,
          errorCount: 1,
          slowCount: 2,
          totalDurationMs: 13000,
          averageDurationMs: 3250,
          maxDurationMs: 5600,
          errorCodes: {
            QUALITY_GATE_FAILED: 1
          }
        },
        validate_ui5_odata_usage: {
          count: 3,
          successCount: 2,
          errorCount: 1,
          slowCount: 3,
          totalDurationMs: 8800,
          averageDurationMs: 2933,
          maxDurationMs: 4900,
          errorCodes: {
            ODATA_RULE_FAILED: 1
          }
        }
      }
    });

    const result = await mcpMetricsDashboardTool.handler(
      {
        telemetryDir: ".mcp-runtime/logs",
        minInvocations: 1,
        includeToolBreakdown: true
      },
      {
        context: {
          rootDir: tempRoot
        }
      }
    );

    expect(result.scope.sessionsAnalyzed).toBe(2);
    expect(result.dashboard.mostUsedTools[0].toolName).toBe("analyze_ui5_project");
    expect(result.dashboard.highestValueTools[0].toolName).toBe("analyze_ui5_project");
    expect(result.dashboard.failingTools[0].toolName).toBe("run_project_quality_gate");
    expect(result.dashboard.slowTools[0].toolName).toBe("validate_ui5_odata_usage");
    expect(result.dashboard.improvementAreas.some((item) => item.id === "reliability-hotspots")).toBe(true);
    expect(result.dashboard.improvementAreas.some((item) => item.id === "latency-hotspots")).toBe(true);
    expect(result.dashboard.potentialSavings.estimatedReworkTimeMs).toBeGreaterThan(0);
    expect(result.toolBreakdown.length).toBeGreaterThanOrEqual(3);
  });

  it("returns empty dashboard with warning when telemetry logs are missing", async () => {
    const result = await mcpMetricsDashboardTool.handler(
      {},
      {
        context: {
          rootDir: tempRoot
        }
      }
    );

    expect(result.scope.sessionsAnalyzed).toBe(0);
    expect(result.dashboard.mostUsedTools).toEqual([]);
    expect(result.dashboard.failingTools).toEqual([]);
    expect(result.dataQuality.warnings.length).toBeGreaterThan(0);
    expect(result.automationPolicy.readOnlyAnalysis).toBe(true);
  });
});

async function writeSession(rootDir, sessionId, payload) {
  const filePath = path.join(rootDir, ".mcp-runtime", "logs", `telemetry-session-${sessionId}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
