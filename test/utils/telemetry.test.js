import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createTelemetryRecorder } from "../../src/utils/telemetry.js";

describe("telemetry", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-telemetry-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("persists server and tool telemetry with aggregated summary", async () => {
    const telemetry = createTelemetryRecorder({
      rootDir: tempRoot,
      sessionId: "session-test",
      serverInfo: {
        name: "sapui5-mcp-server",
        version: "1.0.0"
      },
      slowThresholdMs: 10
    });

    await telemetry.recordServerEvent("server_initialized", {
      toolCount: 2
    });
    await telemetry.recordToolExecution({
      invocationId: "tool_a-0001",
      toolName: "tool_a",
      status: "success",
      startedAt: "2026-03-13T12:00:00.000Z",
      finishedAt: "2026-03-13T12:00:00.005Z",
      durationMs: 5,
      args: {
        text: "hello"
      },
      result: {
        ok: true
      }
    });
    await telemetry.recordToolExecution({
      invocationId: "tool_a-0002",
      toolName: "tool_a",
      status: "error",
      startedAt: "2026-03-13T12:00:00.010Z",
      finishedAt: "2026-03-13T12:00:00.030Z",
      durationMs: 20,
      args: {
        authorization: "Bearer x"
      },
      error: {
        code: "BOOM",
        message: "Failed"
      }
    });
    await telemetry.flush();

    const eventsPath = path.join(tempRoot, ".mcp-runtime", "logs", "telemetry-events-session-test.jsonl");
    const summaryPath = path.join(tempRoot, ".mcp-runtime", "logs", "telemetry-session-session-test.json");

    const events = (await fs.readFile(eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));

    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({
      type: "tool_execution",
      toolName: "tool_a",
      status: "success",
      performanceCategory: "normal"
    });
    expect(events[2].argsSummary.sample.authorization).toBe("[redacted]");
    expect(summary.totals).toMatchObject({
      serverEvents: 1,
      toolInvocations: 2,
      successfulToolInvocations: 1,
      failedToolInvocations: 1,
      slowInvocations: 1
    });
    expect(summary.tools.tool_a).toMatchObject({
      count: 2,
      successCount: 1,
      errorCount: 1,
      slowCount: 1,
      maxDurationMs: 20,
      minDurationMs: 5
    });
    expect(summary.tools.tool_a.errorCodes.BOOM).toBe(1);
  });
});
