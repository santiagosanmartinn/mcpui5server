import { z } from "zod";
import { analyzeUi5ProjectTool } from "./analyzeProject.js";
import { analyzeUi5PerformanceTool } from "../ui5/analyzePerformance.js";
import { validateUi5VersionCompatibilityTool } from "../ui5/validateUi5VersionCompatibility.js";
import { securityCheckUi5AppTool } from "../ui5/securityCheckUi5App.js";
import { validateUi5ODataUsageTool } from "../ui5/validateUi5ODataUsage.js";
import { refreshProjectContextDocsTool } from "../agents/refreshProjectContextDocs.js";
import { DEFAULT_AGENT_POLICY_PATH, loadAgentPolicy } from "../../utils/agentPolicy.js";

const QUALITY_PROFILES = ["dev", "prod"];

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  ui5Version: z.string().regex(/^\d+\.\d+(\.\d+)?$/).optional(),
  qualityProfile: z.enum(QUALITY_PROFILES).optional(),
  maxFiles: z.number().int().min(50).max(5000).optional(),
  maxPerformanceFindings: z.number().int().min(10).max(2000).optional(),
  maxSecurityFindings: z.number().int().min(10).max(2000).optional(),
  checkODataUsage: z.boolean().optional(),
  failOnODataWarnings: z.boolean().optional(),
  odataMetadataXml: z.string().min(20).optional(),
  odataMetadataPath: z.string().min(1).optional(),
  odataMetadataUrl: z.string().url().optional(),
  odataServiceUrl: z.string().url().optional(),
  odataTimeoutMs: z.number().int().min(1000).max(60000).optional(),
  failOnUnknownSymbols: z.boolean().optional(),
  failOnMediumSecurity: z.boolean().optional(),
  maxHighPerformanceFindings: z.number().int().min(0).max(500).optional(),
  refreshDocs: z.boolean().optional(),
  applyDocs: z.boolean().optional(),
  failOnDocDrift: z.boolean().optional(),
  policyPath: z.string().min(1).optional(),
  respectPolicy: z.boolean().optional()
}).strict().superRefine((value, ctx) => {
  const metadataSources = [
    value.odataMetadataXml,
    value.odataMetadataPath,
    value.odataMetadataUrl,
    value.odataServiceUrl
  ].filter((item) => item !== undefined);

  if (metadataSources.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide only one OData metadata source at a time."
    });
  }
});

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
    section: z.string().nullable(),
    profile: z.enum(QUALITY_PROFILES)
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
    odataErrors: z.number().int().nonnegative(),
    odataWarnings: z.number().int().nonnegative(),
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
    odata: z.object({
      executed: z.boolean(),
      pass: z.boolean().nullable(),
      totalFindings: z.number().int().nonnegative(),
      errors: z.number().int().nonnegative(),
      warnings: z.number().int().nonnegative(),
      infos: z.number().int().nonnegative(),
      metadataProvided: z.boolean()
    }),
    docs: z.object({
      refreshed: z.boolean(),
      changed: z.boolean()
    })
  })
});

export const runProjectQualityGateTool = {
  name: "run_project_quality_gate",
  description: "Run consolidated quality gate for UI5 projects (version compatibility, security, performance, OData usage, and context docs freshness).",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      ui5Version,
      qualityProfile,
      maxFiles,
      maxPerformanceFindings,
      maxSecurityFindings,
      checkODataUsage,
      failOnODataWarnings,
      odataMetadataXml,
      odataMetadataPath,
      odataMetadataUrl,
      odataServiceUrl,
      odataTimeoutMs,
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
    const selectedQualityProfile = qualityProfile
      ?? qualityGatePolicy?.defaultProfile
      ?? (process.env.NODE_ENV === "production" ? "prod" : "dev");
    const profileOverrides = qualityGatePolicy?.profiles?.[selectedQualityProfile] ?? {};
    const effectiveQualityPolicy = {
      ...(qualityGatePolicy ?? {}),
      ...(profileOverrides ?? {})
    };

    const shouldFailUnknownSymbols = effectiveQualityPolicy?.failOnUnknownSymbols ?? failOnUnknownSymbols ?? false;
    const shouldFailMediumSecurity = effectiveQualityPolicy?.failOnMediumSecurity ?? failOnMediumSecurity ?? false;
    const shouldCheckODataUsage = effectiveQualityPolicy?.checkODataUsage ?? checkODataUsage ?? true;
    const shouldFailODataWarnings = effectiveQualityPolicy?.failOnODataWarnings ?? failOnODataWarnings ?? false;
    const allowedHighPerformanceFindings = effectiveQualityPolicy?.maxHighPerformanceFindings ?? maxHighPerformanceFindings ?? 0;
    let shouldRefreshDocs = effectiveQualityPolicy?.refreshDocs ?? refreshDocs ?? true;
    const shouldApplyDocs = effectiveQualityPolicy?.applyDocs ?? applyDocs ?? false;
    const shouldFailDocDrift = effectiveQualityPolicy?.failOnDocDrift ?? failOnDocDrift ?? false;
    const shouldRequireUi5Version = effectiveQualityPolicy?.requireUi5Version ?? false;
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
    pushCheck(checks, {
      id: "quality_profile_selected",
      pass: true,
      severity: "warn",
      message: `Quality profile selected: ${selectedQualityProfile}.`
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

    let odata = {
      executed: false,
      pass: null,
      totalFindings: 0,
      errors: 0,
      warnings: 0,
      infos: 0,
      metadataProvided: false
    };
    if (shouldCheckODataUsage) {
      const odataReport = await validateUi5ODataUsageTool.handler(
        {
          sourceDir: source,
          ui5Version: effectiveUi5Version ?? undefined,
          maxFiles,
          metadataXml: odataMetadataXml,
          metadataPath: odataMetadataPath,
          metadataUrl: odataMetadataUrl,
          serviceUrl: odataServiceUrl,
          timeoutMs: odataTimeoutMs
        },
        { context }
      );
      odata = {
        executed: true,
        pass: odataReport.summary.pass,
        totalFindings: odataReport.summary.totalFindings,
        errors: odataReport.summary.errors,
        warnings: odataReport.summary.warnings,
        infos: odataReport.summary.infos,
        metadataProvided: odataReport.metadata.provided
      };
    }

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
    const odataErrors = odata.errors;
    const odataWarnings = odata.warnings;

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

    if (shouldCheckODataUsage) {
      pushCheck(checks, {
        id: "ui5_odata_usage_errors",
        pass: odataErrors === 0,
        severity: "error",
        message: odataErrors === 0
          ? "No OData usage errors detected."
          : `${odataErrors} OData usage error(s) detected.`
      });

      pushCheck(checks, {
        id: "ui5_odata_usage_warnings",
        pass: shouldFailODataWarnings ? odataWarnings === 0 : true,
        severity: shouldFailODataWarnings ? "error" : "warn",
        message: odataWarnings === 0
          ? "No OData usage warnings detected."
          : `${odataWarnings} OData usage warning(s) detected.`
      });
    }

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
        section: qualityGatePolicy ? "qualityGate" : null,
        profile: selectedQualityProfile
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
        odataErrors,
        odataWarnings,
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
        odata,
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
