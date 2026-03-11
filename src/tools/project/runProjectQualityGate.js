import { z } from "zod";
import { analyzeUi5ProjectTool } from "./analyzeProject.js";
import { analyzeUi5PerformanceTool } from "../ui5/analyzePerformance.js";
import { validateUi5VersionCompatibilityTool } from "../ui5/validateUi5VersionCompatibility.js";
import { securityCheckUi5AppTool } from "../ui5/securityCheckUi5App.js";
import { refreshProjectContextDocsTool } from "../agents/refreshProjectContextDocs.js";
import { DEFAULT_AGENT_POLICY_PATH, loadAgentPolicy } from "../../utils/agentPolicy.js";

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  ui5Version: z.string().regex(/^\d+\.\d+(\.\d+)?$/).optional(),
  maxFiles: z.number().int().min(50).max(5000).optional(),
  maxPerformanceFindings: z.number().int().min(10).max(2000).optional(),
  maxSecurityFindings: z.number().int().min(10).max(2000).optional(),
  failOnUnknownSymbols: z.boolean().optional(),
  failOnMediumSecurity: z.boolean().optional(),
  maxHighPerformanceFindings: z.number().int().min(0).max(500).optional(),
  refreshDocs: z.boolean().optional(),
  applyDocs: z.boolean().optional(),
  failOnDocDrift: z.boolean().optional(),
  policyPath: z.string().min(1).optional(),
  respectPolicy: z.boolean().optional()
}).strict();

const checkSchema = z.object({
  id: z.string(),
  pass: z.boolean(),
  severity: z.enum(["error", "warn"]),
  message: z.string()
});

const outputSchema = z.object({
  pass: z.boolean(),
  sourceDir: z.string(),
  ui5Version: z.string().nullable(),
  policy: z.object({
    path: z.string(),
    loaded: z.boolean(),
    enforced: z.boolean(),
    section: z.string().nullable()
  }),
  checks: z.array(checkSchema),
  summary: z.object({
    failedChecks: z.number().int().nonnegative(),
    errorChecks: z.number().int().nonnegative(),
    warningChecks: z.number().int().nonnegative(),
    incompatibleSymbols: z.number().int().nonnegative(),
    unknownSymbols: z.number().int().nonnegative(),
    highSecurityFindings: z.number().int().nonnegative(),
    mediumSecurityFindings: z.number().int().nonnegative(),
    highPerformanceFindings: z.number().int().nonnegative(),
    docsChanged: z.boolean()
  }),
  reports: z.object({
    compatibility: z.object({
      isCompatible: z.boolean(),
      incompatible: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
      recommendations: z.number().int().nonnegative()
    }),
    security: z.object({
      safe: z.boolean(),
      high: z.number().int().nonnegative(),
      medium: z.number().int().nonnegative(),
      low: z.number().int().nonnegative()
    }),
    performance: z.object({
      total: z.number().int().nonnegative(),
      high: z.number().int().nonnegative(),
      medium: z.number().int().nonnegative(),
      low: z.number().int().nonnegative()
    }),
    docs: z.object({
      refreshed: z.boolean(),
      changed: z.boolean()
    })
  })
});

export const runProjectQualityGateTool = {
  name: "run_project_quality_gate",
  description: "Run consolidated quality gate for UI5 projects (version compatibility, security, performance, and context docs freshness).",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      ui5Version,
      maxFiles,
      maxPerformanceFindings,
      maxSecurityFindings,
      failOnUnknownSymbols,
      failOnMediumSecurity,
      maxHighPerformanceFindings,
      refreshDocs,
      applyDocs,
      failOnDocDrift,
      policyPath,
      respectPolicy
    } = inputSchema.parse(args);
    const source = sourceDir ?? "webapp";
    const selectedPolicyPath = normalizeRelativePath(policyPath ?? DEFAULT_AGENT_POLICY_PATH);
    const shouldRespectPolicy = respectPolicy ?? true;
    const policyResolution = shouldRespectPolicy
      ? await loadAgentPolicy({ root: context.rootDir, policyPath: selectedPolicyPath })
      : {
        path: selectedPolicyPath,
        loaded: false,
        enabled: false,
        policy: null
      };
    const qualityGatePolicy = policyResolution.loaded
      && policyResolution.enabled
      && (policyResolution.policy?.qualityGate?.enabled ?? true)
      ? (policyResolution.policy?.qualityGate ?? {})
      : null;

    const shouldFailUnknownSymbols = qualityGatePolicy?.failOnUnknownSymbols ?? failOnUnknownSymbols ?? false;
    const shouldFailMediumSecurity = qualityGatePolicy?.failOnMediumSecurity ?? failOnMediumSecurity ?? false;
    const allowedHighPerformanceFindings = qualityGatePolicy?.maxHighPerformanceFindings ?? maxHighPerformanceFindings ?? 0;
    let shouldRefreshDocs = qualityGatePolicy?.refreshDocs ?? refreshDocs ?? true;
    const shouldApplyDocs = qualityGatePolicy?.applyDocs ?? applyDocs ?? false;
    const shouldFailDocDrift = qualityGatePolicy?.failOnDocDrift ?? failOnDocDrift ?? false;
    const shouldRequireUi5Version = qualityGatePolicy?.requireUi5Version ?? false;
    if (shouldApplyDocs) {
      shouldRefreshDocs = true;
    }
    const checks = [];

    const project = await analyzeUi5ProjectTool.handler({}, { context });
    const effectiveUi5Version = ui5Version ?? project.ui5Version ?? null;
    pushCheck(checks, {
      id: "ui5_version_declared",
      pass: shouldRequireUi5Version ? Boolean(effectiveUi5Version) : true,
      severity: shouldRequireUi5Version ? "error" : "warn",
      message: effectiveUi5Version
        ? `UI5 version resolved for gate execution: ${effectiveUi5Version}.`
        : "UI5 version could not be resolved for this project."
    });

    const compatibility = await validateUi5VersionCompatibilityTool.handler(
      {
        sourceDir: source,
        ui5Version: effectiveUi5Version ?? undefined,
        maxFiles,
        includeUnknownSymbols: true
      },
      { context }
    );

    const security = await securityCheckUi5AppTool.handler(
      {
        sourceDir: source,
        maxFiles,
        maxFindings: maxSecurityFindings
      },
      { context }
    );

    const performance = await analyzeUi5PerformanceTool.handler(
      {
        sourceDir: source,
        maxFiles,
        maxFindings: maxPerformanceFindings
      },
      { context }
    );

    let docs = {
      refreshed: false,
      changed: false
    };
    if (shouldRefreshDocs) {
      const docsReport = await refreshProjectContextDocsTool.handler(
        {
          sourceDir: source,
          dryRun: !shouldApplyDocs
        },
        { context }
      );
      docs = {
        refreshed: true,
        changed: docsReport.changed
      };
      pushCheck(checks, {
        id: "docs_context_freshness",
        pass: shouldFailDocDrift ? !docsReport.changed : true,
        severity: shouldFailDocDrift ? "error" : "warn",
        message: docsReport.changed
          ? "Context docs require refresh (delta detected)."
          : "Context docs are up to date."
      });
    }

    const incompatibleSymbols = compatibility.summary.incompatible;
    const unknownSymbols = compatibility.summary.unknown;
    const highSecurityFindings = security.summary.bySeverity.high;
    const mediumSecurityFindings = security.summary.bySeverity.medium;
    const highPerformanceFindings = performance.summary.bySeverity.high;

    pushCheck(checks, {
      id: "ui5_version_compatibility",
      pass: incompatibleSymbols === 0,
      severity: "error",
      message: incompatibleSymbols === 0
        ? "No incompatible UI5 symbols found for current version."
        : `${incompatibleSymbols} incompatible symbol(s) found for UI5 ${effectiveUi5Version ?? "unknown"}.`
    });

    pushCheck(checks, {
      id: "ui5_unknown_symbols",
      pass: shouldFailUnknownSymbols ? unknownSymbols === 0 : true,
      severity: shouldFailUnknownSymbols ? "error" : "warn",
      message: unknownSymbols === 0
        ? "All checked symbols are known by compatibility catalog."
        : `${unknownSymbols} symbol(s) are not covered by compatibility catalog.`
    });

    pushCheck(checks, {
      id: "ui5_security_high",
      pass: highSecurityFindings === 0,
      severity: "error",
      message: highSecurityFindings === 0
        ? "No high-severity UI5 security findings."
        : `${highSecurityFindings} high-severity UI5 security finding(s) detected.`
    });

    pushCheck(checks, {
      id: "ui5_security_medium",
      pass: shouldFailMediumSecurity ? mediumSecurityFindings === 0 : true,
      severity: shouldFailMediumSecurity ? "error" : "warn",
      message: mediumSecurityFindings === 0
        ? "No medium-severity UI5 security findings."
        : `${mediumSecurityFindings} medium-severity UI5 security finding(s) detected.`
    });

    pushCheck(checks, {
      id: "ui5_performance_high",
      pass: highPerformanceFindings <= allowedHighPerformanceFindings,
      severity: "error",
      message: highPerformanceFindings <= allowedHighPerformanceFindings
        ? "High-severity performance findings are within threshold."
        : `${highPerformanceFindings} high-severity performance finding(s) exceed threshold ${allowedHighPerformanceFindings}.`
    });

    const failedChecks = checks.filter((check) => !check.pass);
    const errorChecks = failedChecks.filter((check) => check.severity === "error").length;
    const warningChecks = failedChecks.filter((check) => check.severity === "warn").length;

    return outputSchema.parse({
      pass: errorChecks === 0,
      sourceDir: source,
      ui5Version: effectiveUi5Version,
      policy: {
        path: policyResolution.path,
        loaded: policyResolution.loaded,
        enforced: Boolean(qualityGatePolicy),
        section: qualityGatePolicy ? "qualityGate" : null
      },
      checks,
      summary: {
        failedChecks: failedChecks.length,
        errorChecks,
        warningChecks,
        incompatibleSymbols,
        unknownSymbols,
        highSecurityFindings,
        mediumSecurityFindings,
        highPerformanceFindings,
        docsChanged: docs.changed
      },
      reports: {
        compatibility: {
          isCompatible: compatibility.summary.isCompatible,
          incompatible: compatibility.summary.incompatible,
          unknown: compatibility.summary.unknown,
          recommendations: compatibility.summary.recommendations
        },
        security: {
          safe: security.safe,
          high: security.summary.bySeverity.high,
          medium: security.summary.bySeverity.medium,
          low: security.summary.bySeverity.low
        },
        performance: {
          total: performance.summary.totalFindings,
          high: performance.summary.bySeverity.high,
          medium: performance.summary.bySeverity.medium,
          low: performance.summary.bySeverity.low
        },
        docs
      }
    });
  }
};

function pushCheck(checks, check) {
  checks.push(check);
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}
