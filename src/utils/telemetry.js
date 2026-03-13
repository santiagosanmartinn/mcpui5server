import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

const DEFAULT_LOG_DIR = ".mcp-runtime/logs";
const DEFAULT_SLOW_THRESHOLD_MS = 2000;
const MAX_STRING_LENGTH = 240;
const MAX_ARRAY_ITEMS = 5;
const MAX_OBJECT_KEYS = 12;
const REDACTED_KEY_PATTERN = /(token|secret|password|authorization|api[-_]?key|cookie|session)/i;

export function createTelemetryRecorder(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const enabled = options.enabled ?? process.env.MCP_TELEMETRY_ENABLED !== "false";
  const logDir = path.resolve(rootDir, options.logDir ?? process.env.MCP_TELEMETRY_DIR ?? DEFAULT_LOG_DIR);
  const sessionId = options.sessionId ?? crypto.randomUUID();
  const slowThresholdMs = normalizeSlowThreshold(
    options.slowThresholdMs ?? process.env.MCP_TELEMETRY_SLOW_THRESHOLD_MS
  );
  const startedAt = new Date().toISOString();
  const eventsPath = path.join(logDir, `telemetry-events-${sessionId}.jsonl`);
  const summaryPath = path.join(logDir, `telemetry-session-${sessionId}.json`);
  const latestPath = path.join(logDir, "telemetry-session-latest.json");

  let initialized = false;
  let invocationCount = 0;
  let writeQueue = Promise.resolve();

  const summary = {
    sessionId,
    startedAt,
    lastUpdatedAt: startedAt,
    rootDir,
    logDir: toRelativePath(rootDir, logDir),
    eventsFile: toRelativePath(rootDir, eventsPath),
    slowThresholdMs,
    server: options.serverInfo ?? null,
    process: {
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version
    },
    totals: {
      serverEvents: 0,
      toolInvocations: 0,
      successfulToolInvocations: 0,
      failedToolInvocations: 0,
      totalDurationMs: 0,
      averageDurationMs: 0,
      slowInvocations: 0
    },
    tools: {}
  };

  return {
    enabled,
    sessionId,
    logDir,
    eventsPath,
    summaryPath,
    nextInvocationId,
    recordServerEvent,
    recordToolExecution,
    flush,
    getSummary: () => structuredClone(summary)
  };

  function nextInvocationId(toolName = "tool") {
    invocationCount += 1;
    return `${toolName}-${String(invocationCount).padStart(4, "0")}`;
  }

  async function recordServerEvent(eventName, details = {}) {
    if (!enabled) {
      return;
    }

    summary.totals.serverEvents += 1;
    summary.lastUpdatedAt = new Date().toISOString();

    const event = {
      type: "server_event",
      eventName,
      sessionId,
      timestamp: summary.lastUpdatedAt,
      details: summarizeValue(details)
    };

    await enqueueWrite(async () => {
      await appendEvent(event);
      await persistSummary();
    });
  }

  async function recordToolExecution(payload) {
    if (!enabled) {
      return;
    }

    const timestamp = payload.finishedAt ?? new Date().toISOString();
    const status = payload.status === "error" ? "error" : "success";
    const durationMs = Math.max(0, Math.round(Number(payload.durationMs) || 0));
    const performanceCategory = classifyDuration(durationMs, slowThresholdMs);
    const toolStats = ensureToolStats(payload.toolName);

    summary.totals.toolInvocations += 1;
    summary.totals.totalDurationMs += durationMs;
    summary.totals.averageDurationMs = averageDuration(
      summary.totals.totalDurationMs,
      summary.totals.toolInvocations
    );
    if (performanceCategory === "slow") {
      summary.totals.slowInvocations += 1;
    }
    if (status === "success") {
      summary.totals.successfulToolInvocations += 1;
    } else {
      summary.totals.failedToolInvocations += 1;
    }

    toolStats.count += 1;
    toolStats.totalDurationMs += durationMs;
    toolStats.averageDurationMs = averageDuration(toolStats.totalDurationMs, toolStats.count);
    toolStats.maxDurationMs = Math.max(toolStats.maxDurationMs, durationMs);
    toolStats.minDurationMs = Math.min(toolStats.minDurationMs, durationMs);
    toolStats.lastDurationMs = durationMs;
    toolStats.lastInvokedAt = timestamp;
    toolStats.lastStatus = status;
    toolStats.performanceCategory = performanceCategory;
    if (performanceCategory === "slow") {
      toolStats.slowCount += 1;
    }
    if (status === "success") {
      toolStats.successCount += 1;
    } else {
      toolStats.errorCount += 1;
      const errorCode = payload.error?.code ?? "UNEXPECTED_ERROR";
      toolStats.errorCodes[errorCode] = (toolStats.errorCodes[errorCode] ?? 0) + 1;
    }

    summary.lastUpdatedAt = timestamp;

    const event = {
      type: "tool_execution",
      sessionId,
      timestamp,
      invocationId: payload.invocationId,
      toolName: payload.toolName,
      status,
      durationMs,
      performanceCategory,
      startedAt: payload.startedAt ?? null,
      finishedAt: timestamp,
      argsSummary: summarizeValue(payload.args ?? {}),
      resultSummary: payload.result === undefined ? null : summarizeValue(payload.result),
      error:
        status === "error"
          ? {
              code: payload.error?.code ?? "UNEXPECTED_ERROR",
              message: payload.error?.message ?? "Unexpected error"
            }
          : null
    };

    await enqueueWrite(async () => {
      await appendEvent(event);
      await persistSummary();
    });
  }

  function ensureToolStats(toolName) {
    if (!summary.tools[toolName]) {
      summary.tools[toolName] = {
        count: 0,
        successCount: 0,
        errorCount: 0,
        slowCount: 0,
        totalDurationMs: 0,
        averageDurationMs: 0,
        maxDurationMs: 0,
        minDurationMs: Number.POSITIVE_INFINITY,
        lastDurationMs: 0,
        lastInvokedAt: null,
        lastStatus: null,
        performanceCategory: null,
        errorCodes: {}
      };
    }

    return summary.tools[toolName];
  }

  async function appendEvent(event) {
    await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
  }

  async function persistSummary() {
    const safeSummary = structuredClone(summary);
    for (const toolName of Object.keys(safeSummary.tools)) {
      if (!Number.isFinite(safeSummary.tools[toolName].minDurationMs)) {
        safeSummary.tools[toolName].minDurationMs = 0;
      }
    }
    const serialized = JSON.stringify(safeSummary, null, 2);
    await fs.writeFile(summaryPath, serialized, "utf8");
    await fs.writeFile(latestPath, serialized, "utf8");
  }

  async function ensureInitialized() {
    if (initialized) {
      return;
    }
    await fs.mkdir(logDir, { recursive: true });
    initialized = true;
  }

  async function flush() {
    await writeQueue;
  }

  function enqueueWrite(task) {
    writeQueue = writeQueue.then(async () => {
      await ensureInitialized();
      await task();
    }).catch(() => {
      // Telemetry failures must never break tool execution.
    });
    return writeQueue;
  }
}

function normalizeSlowThreshold(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed);
  }
  return DEFAULT_SLOW_THRESHOLD_MS;
}

function averageDuration(totalDurationMs, count) {
  if (!count) {
    return 0;
  }
  return Math.round(totalDurationMs / count);
}

function classifyDuration(durationMs, slowThresholdMs) {
  return durationMs >= slowThresholdMs ? "slow" : "normal";
}

function summarizeValue(value, state = createState()) {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === "string") {
    if (value.length <= MAX_STRING_LENGTH) {
      return value;
    }
    return {
      kind: "string",
      length: value.length,
      preview: `${value.slice(0, MAX_STRING_LENGTH)}...`
    };
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function") {
    return "[function]";
  }

  if (value instanceof Error) {
    return {
      kind: "error",
      name: value.name,
      message: value.message
    };
  }

  if (state.depth >= 4) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
      items: value.slice(0, MAX_ARRAY_ITEMS).map((item) =>
        summarizeValue(item, { ...state, depth: state.depth + 1 })
      ),
      truncated: value.length > MAX_ARRAY_ITEMS
    };
  }

  if (typeof value === "object") {
    if (state.seen.has(value)) {
      return "[circular]";
    }
    state.seen.add(value);

    const entries = Object.entries(value);
    const sample = {};
    for (const [key, currentValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
      if (REDACTED_KEY_PATTERN.test(key)) {
        sample[key] = "[redacted]";
        continue;
      }
      sample[key] = summarizeValue(currentValue, { ...state, depth: state.depth + 1 });
    }

    return {
      kind: "object",
      keys: entries.map(([key]) => key).slice(0, MAX_OBJECT_KEYS),
      totalKeys: entries.length,
      truncated: entries.length > MAX_OBJECT_KEYS,
      sample
    };
  }

  return String(value);
}

function createState() {
  return {
    depth: 0,
    seen: new WeakSet()
  };
}

function toRelativePath(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).replaceAll("\\", "/");
}
