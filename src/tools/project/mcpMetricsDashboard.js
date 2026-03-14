import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { resolveWorkspacePath } from "../../utils/fileSystem.js";
import { resolveLanguage, t } from "../../utils/language.js";

const DEFAULT_TELEMETRY_DIR = ".mcp-runtime/logs";
const DEFAULT_MAX_SESSIONS = 30;
const DEFAULT_MIN_INVOCATIONS = 1;
const DEFAULT_ERROR_RATE_THRESHOLD = 0.15;
const DEFAULT_SLOW_RATE_THRESHOLD = 0.25;
const DEFAULT_SLOW_THRESHOLD_MS = 2000;

const inputSchema = z.object({
  telemetryDir: z.string().min(1).optional(),
  sessionIds: z.array(z.string().min(1)).max(200).optional(),
  maxSessions: z.number().int().min(1).max(500).optional(),
  minInvocations: z.number().int().min(1).max(1000).optional(),
  errorRateThreshold: z.number().min(0).max(1).optional(),
  slowRateThreshold: z.number().min(0).max(1).optional(),
  includeToolBreakdown: z.boolean().optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

const toolMetricSchema = z.object({
  toolName: z.string(),
  invocations: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  slowCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  errorRate: z.number().min(0).max(1),
  slowRate: z.number().min(0).max(1),
  averageDurationMs: z.number().int().nonnegative(),
  maxDurationMs: z.number().int().nonnegative(),
  estimatedTimeCostMs: z.number().int().nonnegative(),
  estimatedReworkCostMs: z.number().int().nonnegative(),
  valueScore: z.number().int().min(0).max(100),
  topErrorCodes: z.array(
    z.object({
      code: z.string(),
      count: z.number().int().nonnegative()
    })
  )
});

const outputSchema = z.object({
  generatedAt: z.string(),
  scope: z.object({
    telemetryDir: z.string(),
    sessionsRequested: z.number().int().nonnegative(),
    sessionsAnalyzed: z.number().int().nonnegative(),
    sessionIds: z.array(z.string()),
    window: z.object({
      startedAt: z.string().nullable(),
      endedAt: z.string().nullable()
    }),
    totals: z.object({
      invocations: z.number().int().nonnegative(),
      successes: z.number().int().nonnegative(),
      errors: z.number().int().nonnegative(),
      slowInvocations: z.number().int().nonnegative(),
      totalDurationMs: z.number().int().nonnegative(),
      averageDurationMs: z.number().int().nonnegative()
    })
  }),
  dashboard: z.object({
    mostUsedTools: z.array(toolMetricSchema),
    highestValueTools: z.array(toolMetricSchema),
    failingTools: z.array(toolMetricSchema),
    slowTools: z.array(toolMetricSchema),
    improvementAreas: z.array(
      z.object({
        id: z.string(),
        priority: z.enum(["high", "medium", "low"]),
        title: z.string(),
        rationale: z.string(),
        targetTools: z.array(z.string()),
        recommendedActions: z.array(z.string())
      })
    ),
    potentialSavings: z.object({
      avoidableSlowTimeMs: z.number().int().nonnegative(),
      estimatedReworkTimeMs: z.number().int().nonnegative(),
      note: z.string()
    })
  }),
  toolBreakdown: z.array(toolMetricSchema),
  dataQuality: z.object({
    telemetryFilesFound: z.number().int().nonnegative(),
    parseErrors: z.number().int().nonnegative(),
    warnings: z.array(z.string())
  }),
  automationPolicy: z.object({
    readOnlyAnalysis: z.boolean(),
    note: z.string()
  })
});

export const mcpMetricsDashboardTool = {
  name: "mcp_metrics_dashboard",
  description: "Build an MCP telemetry dashboard to surface high-value tools, failing/slow tools, and prioritized improvement opportunities.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const maxSessions = parsed.maxSessions ?? DEFAULT_MAX_SESSIONS;
    const minInvocations = parsed.minInvocations ?? DEFAULT_MIN_INVOCATIONS;
    const errorRateThreshold = parsed.errorRateThreshold ?? DEFAULT_ERROR_RATE_THRESHOLD;
    const slowRateThreshold = parsed.slowRateThreshold ?? DEFAULT_SLOW_RATE_THRESHOLD;
    const includeToolBreakdown = parsed.includeToolBreakdown ?? true;
    const telemetryDir = normalizePath(parsed.telemetryDir ?? DEFAULT_TELEMETRY_DIR);
    const telemetryRoot = resolveWorkspacePath(telemetryDir, context.rootDir);

    const selectedSessionIds = new Set((parsed.sessionIds ?? []).map((item) => item.trim()).filter(Boolean));
    const warnings = [];
    let parseErrors = 0;

    const files = await listTelemetrySessionFiles(telemetryRoot);
    const filtered = files.filter((item) => {
      if (selectedSessionIds.size === 0) {
        return true;
      }
      return selectedSessionIds.has(item.sessionId);
    }).slice(0, maxSessions);

    const summaries = [];
    for (const file of filtered) {
      const parsedSummary = await readTelemetrySummary(file.absolutePath);
      if (!parsedSummary) {
        parseErrors += 1;
        continue;
      }
      summaries.push(parsedSummary);
    }

    if (files.length === 0) {
      warnings.push(t(language, "No se encontraron logs de telemetria en el directorio indicado.", "No telemetry logs were found in the selected directory."));
    }
    if (parseErrors > 0) {
      warnings.push(
        t(
          language,
          `Se omitieron ${parseErrors} archivo(s) de sesion por errores de parseo.`,
          `${parseErrors} session file(s) were skipped due to parse errors.`
        )
      );
    }
    if (summaries.length === 0 && files.length > 0) {
      warnings.push(t(language, "No hubo sesiones analizables tras aplicar filtros.", "No analyzable sessions remained after applying filters."));
    }

    const aggregated = aggregateTelemetry(summaries);
    const slowThresholdRefMs = aggregated.slowThresholdAvgMs || DEFAULT_SLOW_THRESHOLD_MS;
    const metrics = buildToolMetrics({
      toolMap: aggregated.toolMap,
      minInvocations,
      slowThresholdRefMs
    });

    const mostUsedTools = metrics
      .slice()
      .sort((a, b) => b.invocations - a.invocations || b.valueScore - a.valueScore || a.toolName.localeCompare(b.toolName))
      .slice(0, 8);
    const highestValueTools = metrics
      .slice()
      .sort((a, b) => b.valueScore - a.valueScore || b.invocations - a.invocations || a.toolName.localeCompare(b.toolName))
      .slice(0, 8);
    const failingTools = metrics
      .filter((item) => item.errorCount > 0)
      .sort((a, b) => b.errorRate - a.errorRate || b.errorCount - a.errorCount || b.invocations - a.invocations || a.toolName.localeCompare(b.toolName))
      .slice(0, 8);
    const slowTools = metrics
      .filter((item) => item.slowCount > 0)
      .sort((a, b) => b.slowRate - a.slowRate || b.averageDurationMs - a.averageDurationMs || b.invocations - a.invocations || a.toolName.localeCompare(b.toolName))
      .slice(0, 8);

    const improvementAreas = buildImprovementAreas({
      language,
      mostUsedTools,
      failingTools,
      slowTools,
      highestValueTools,
      errorRateThreshold,
      slowRateThreshold
    });

    const avoidableSlowTimeMs = slowTools.reduce((acc, item) => acc + estimateAvoidableSlowTime(item, slowThresholdRefMs), 0);
    const estimatedReworkTimeMs = failingTools.reduce((acc, item) => acc + item.estimatedReworkCostMs, 0);

    return outputSchema.parse({
      generatedAt: new Date().toISOString(),
      scope: {
        telemetryDir,
        sessionsRequested: selectedSessionIds.size,
        sessionsAnalyzed: summaries.length,
        sessionIds: summaries.map((session) => session.sessionId),
        window: {
          startedAt: aggregated.startedAt,
          endedAt: aggregated.endedAt
        },
        totals: {
          invocations: aggregated.invocations,
          successes: aggregated.successes,
          errors: aggregated.errors,
          slowInvocations: aggregated.slowInvocations,
          totalDurationMs: aggregated.totalDurationMs,
          averageDurationMs: aggregated.invocations > 0
            ? Math.round(aggregated.totalDurationMs / aggregated.invocations)
            : 0
        }
      },
      dashboard: {
        mostUsedTools,
        highestValueTools,
        failingTools,
        slowTools,
        improvementAreas,
        potentialSavings: {
          avoidableSlowTimeMs,
          estimatedReworkTimeMs,
          note: t(
            language,
            "Estimaciones orientativas para priorizar mejoras; no sustituyen medicion detallada por escenario.",
            "Indicative estimates for improvement prioritization; not a substitute for scenario-level profiling."
          )
        }
      },
      toolBreakdown: includeToolBreakdown ? metrics : [],
      dataQuality: {
        telemetryFilesFound: files.length,
        parseErrors,
        warnings
      },
      automationPolicy: {
        readOnlyAnalysis: true,
        note: t(
          language,
          "Esta tool solo analiza logs de telemetria existentes. No modifica codigo, Git ni configuracion.",
          "This tool only analyzes existing telemetry logs. It does not modify code, Git, or configuration."
        )
      }
    });
  }
};

async function listTelemetrySessionFiles(telemetryRoot) {
  let entries;
  try {
    entries = await fs.readdir(telemetryRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const rows = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name === "telemetry-session-latest.json") {
      continue;
    }
    const match = entry.name.match(/^telemetry-session-(.+)\.json$/);
    if (!match) {
      continue;
    }
    const absolutePath = path.join(telemetryRoot, entry.name);
    let mtimeMs;
    try {
      const stat = await fs.stat(absolutePath);
      mtimeMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0;
    } catch {
      mtimeMs = 0;
    }
    rows.push({
      name: entry.name,
      sessionId: match[1],
      absolutePath,
      mtimeMs
    });
  }

  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
}

async function readTelemetrySummary(absolutePath) {
  let parsed;
  try {
    const content = await fs.readFile(absolutePath, "utf8");
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  if (typeof parsed.sessionId !== "string" || !parsed.sessionId.trim()) {
    return null;
  }

  const totals = ensureObject(parsed.totals);
  const toolStats = ensureObject(parsed.tools);
  return {
    sessionId: parsed.sessionId,
    startedAt: asIsoString(parsed.startedAt),
    endedAt: asIsoString(parsed.lastUpdatedAt),
    slowThresholdMs: asInt(parsed.slowThresholdMs),
    totals: {
      invocations: asInt(totals.toolInvocations),
      successes: asInt(totals.successfulToolInvocations),
      errors: asInt(totals.failedToolInvocations),
      slowInvocations: asInt(totals.slowInvocations),
      totalDurationMs: asInt(totals.totalDurationMs)
    },
    tools: Object.entries(toolStats).map(([toolName, value]) => ({
      toolName,
      count: asInt(value?.count),
      successCount: asInt(value?.successCount),
      errorCount: asInt(value?.errorCount),
      slowCount: asInt(value?.slowCount),
      totalDurationMs: asInt(value?.totalDurationMs),
      averageDurationMs: asInt(value?.averageDurationMs),
      maxDurationMs: asInt(value?.maxDurationMs),
      errorCodes: normalizeErrorCodes(value?.errorCodes)
    }))
  };
}

function aggregateTelemetry(summaries) {
  const toolMap = new Map();
  let invocations = 0;
  let successes = 0;
  let errors = 0;
  let slowInvocations = 0;
  let totalDurationMs = 0;
  let startedAt = null;
  let endedAt = null;
  let slowThresholdTotal = 0;
  let slowThresholdCount = 0;

  for (const session of summaries) {
    invocations += session.totals.invocations;
    successes += session.totals.successes;
    errors += session.totals.errors;
    slowInvocations += session.totals.slowInvocations;
    totalDurationMs += session.totals.totalDurationMs;
    startedAt = minIsoDate(startedAt, session.startedAt);
    endedAt = maxIsoDate(endedAt, session.endedAt);
    if (session.slowThresholdMs > 0) {
      slowThresholdTotal += session.slowThresholdMs;
      slowThresholdCount += 1;
    }

    for (const tool of session.tools) {
      const current = toolMap.get(tool.toolName) ?? {
        toolName: tool.toolName,
        count: 0,
        successCount: 0,
        errorCount: 0,
        slowCount: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        errorCodes: {}
      };
      current.count += tool.count;
      current.successCount += tool.successCount;
      current.errorCount += tool.errorCount;
      current.slowCount += tool.slowCount;
      current.totalDurationMs += tool.totalDurationMs;
      current.maxDurationMs = Math.max(current.maxDurationMs, tool.maxDurationMs);
      for (const [code, count] of Object.entries(tool.errorCodes)) {
        current.errorCodes[code] = (current.errorCodes[code] ?? 0) + asInt(count);
      }
      toolMap.set(tool.toolName, current);
    }
  }

  return {
    toolMap,
    invocations,
    successes,
    errors,
    slowInvocations,
    totalDurationMs,
    startedAt,
    endedAt,
    slowThresholdAvgMs: slowThresholdCount > 0
      ? Math.round(slowThresholdTotal / slowThresholdCount)
      : DEFAULT_SLOW_THRESHOLD_MS
  };
}

function buildToolMetrics(input) {
  const rows = Array.from(input.toolMap.values())
    .filter((item) => item.count >= input.minInvocations);
  const maxInvocations = rows.reduce((acc, item) => Math.max(acc, item.count), 1);

  return rows.map((item) => {
    const invocations = item.count;
    const successRate = safeRate(item.successCount, invocations);
    const errorRate = safeRate(item.errorCount, invocations);
    const slowRate = safeRate(item.slowCount, invocations);
    const averageDurationMs = invocations > 0
      ? Math.round(item.totalDurationMs / invocations)
      : 0;
    const usageScore = maxInvocations > 0 ? item.count / maxInvocations : 0;
    const reliabilityScore = successRate;
    const speedScore = clamp(1 - (averageDurationMs / Math.max(1, input.slowThresholdRefMs)), 0, 1);
    const valueScore = Math.round(((usageScore * 0.4) + (reliabilityScore * 0.4) + (speedScore * 0.2)) * 100);
    const topErrorCodes = Object.entries(item.errorCodes)
      .map(([code, count]) => ({
        code,
        count: asInt(count)
      }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, 5);

    return {
      toolName: item.toolName,
      invocations,
      successCount: item.successCount,
      errorCount: item.errorCount,
      slowCount: item.slowCount,
      successRate: roundRate(successRate),
      errorRate: roundRate(errorRate),
      slowRate: roundRate(slowRate),
      averageDurationMs,
      maxDurationMs: item.maxDurationMs,
      estimatedTimeCostMs: item.totalDurationMs,
      estimatedReworkCostMs: Math.round(averageDurationMs * item.errorCount),
      valueScore,
      topErrorCodes
    };
  });
}

function buildImprovementAreas(input) {
  const areas = [];
  const failingHot = input.failingTools.filter((item) => item.errorRate >= input.errorRateThreshold).slice(0, 3);
  if (failingHot.length > 0) {
    areas.push({
      id: "reliability-hotspots",
      priority: "high",
      title: t(input.language, "Reducir errores en tools criticas", "Reduce failures in critical tools"),
      rationale: t(
        input.language,
        `Se detectaron ${failingHot.length} tools con ratio de error >= ${Math.round(input.errorRateThreshold * 100)}%.`,
        `${failingHot.length} tools show error rate >= ${Math.round(input.errorRateThreshold * 100)}%.`
      ),
      targetTools: failingHot.map((item) => item.toolName),
      recommendedActions: [
        t(input.language, "Revisar payloads mas frecuentes que fallan y reforzar validaciones de entrada.", "Review frequent failing payloads and strengthen input validation."),
        t(input.language, "Anadir casos de test para codigos de error mas repetidos.", "Add tests for recurring error codes."),
        t(input.language, "Mejorar mensajes de error accionables para reducir retrabajo.", "Improve actionable error messages to reduce rework.")
      ]
    });
  }

  const slowHot = input.slowTools.filter((item) => item.slowRate >= input.slowRateThreshold).slice(0, 3);
  if (slowHot.length > 0) {
    areas.push({
      id: "latency-hotspots",
      priority: "medium",
      title: t(input.language, "Reducir latencia en tools lentas", "Reduce latency in slow tools"),
      rationale: t(
        input.language,
        `Se detectaron ${slowHot.length} tools con ratio de lentitud >= ${Math.round(input.slowRateThreshold * 100)}%.`,
        `${slowHot.length} tools show slow-rate >= ${Math.round(input.slowRateThreshold * 100)}%.`
      ),
      targetTools: slowHot.map((item) => item.toolName),
      recommendedActions: [
        t(input.language, "Perfilar llamadas I/O/Git y aplicar cache local donde tenga sentido.", "Profile I/O/Git paths and add local cache where appropriate."),
        t(input.language, "Limitar volumen de analisis por defecto y permitir ampliarlo bajo demanda.", "Cap default analysis scope and let users expand on demand."),
        t(input.language, "Separar rutas rapidas de rutas profundas para evitar bloqueos innecesarios.", "Split fast paths from deep analysis paths to avoid unnecessary blocking.")
      ]
    });
  }

  const highValue = input.highestValueTools.slice(0, 3);
  if (highValue.length > 0) {
    areas.push({
      id: "scale-best-practices",
      priority: "low",
      title: t(input.language, "Escalar uso de tools con alto valor", "Scale high-value tool usage"),
      rationale: t(
        input.language,
        "Algunas tools muestran buena relacion uso/fiabilidad/tiempo y conviene priorizarlas en flujos guiados.",
        "Some tools show strong usage/reliability/time ratio and should be prioritized in guided flows."
      ),
      targetTools: highValue.map((item) => item.toolName),
      recommendedActions: [
        t(input.language, "Documentar prompts/recetas que las invoquen primero.", "Document prompts/playbooks that invoke them first."),
        t(input.language, "Incluir estas tools en checklist de onboarding del equipo.", "Include these tools in team onboarding checklists.")
      ]
    });
  }

  if (areas.length === 0) {
    areas.push({
      id: "insufficient-evidence",
      priority: "low",
      title: t(input.language, "Sin evidencia suficiente para priorizar mejoras", "Insufficient evidence to prioritize improvements"),
      rationale: t(
        input.language,
        "Hace falta mas volumen de sesiones o invocaciones para detectar patrones robustos.",
        "More session volume is needed to detect robust improvement patterns."
      ),
      targetTools: [],
      recommendedActions: [
        t(input.language, "Recoger telemetria durante mas dias y volver a ejecutar el dashboard.", "Collect telemetry for more days and rerun this dashboard.")
      ]
    });
  }

  return areas;
}

function estimateAvoidableSlowTime(metric, slowThresholdRefMs) {
  if (metric.averageDurationMs <= slowThresholdRefMs || metric.slowCount === 0) {
    return 0;
  }
  const excessPerCall = metric.averageDurationMs - slowThresholdRefMs;
  return Math.max(0, Math.round(excessPerCall * metric.slowCount));
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function ensureObject(value) {
  return value && typeof value === "object" ? value : {};
}

function asInt(value) {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function asIsoString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

function normalizeErrorCodes(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  const result = {};
  for (const [key, count] of Object.entries(value)) {
    result[String(key)] = asInt(count);
  }
  return result;
}

function safeRate(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return numerator / denominator;
}

function roundRate(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function minIsoDate(current, candidate) {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return Date.parse(candidate) < Date.parse(current) ? candidate : current;
}

function maxIsoDate(current, candidate) {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}
