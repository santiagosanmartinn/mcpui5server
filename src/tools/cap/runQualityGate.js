import { z } from "zod";
import { analyzeCapProjectTool } from "./analyzeProject.js";
import { validateCapProjectTool } from "./validateProject.js";

const QUALITY_PROFILES = ["dev", "prod"];

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  qualityProfile: z.enum(QUALITY_PROFILES).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  maxFindings: z.number().int().min(10).max(2000).optional(),
  allowPublicServices: z.boolean().optional(),
  requireTestScript: z.boolean().optional(),
  failOnMediumFindings: z.boolean().optional(),
  maxHighFindings: z.number().int().min(0).max(100).optional()
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
  qualityProfile: z.enum(QUALITY_PROFILES),
  checks: z.array(checkSchema),
  summary: z.object({
    failedChecks: z.number().int().nonnegative(),
    errorChecks: z.number().int().nonnegative(),
    warningChecks: z.number().int().nonnegative(),
    highFindings: z.number().int().nonnegative(),
    mediumFindings: z.number().int().nonnegative(),
    lowFindings: z.number().int().nonnegative()
  }),
  reports: z.object({
    analysis: z.object({
      detected: z.boolean(),
      capVersion: z.string().nullable(),
      serviceCount: z.number().int().nonnegative(),
      entityCount: z.number().int().nonnegative(),
      testScript: z.boolean()
    }),
    validation: z.object({
      valid: z.boolean(),
      totalFindings: z.number().int().nonnegative(),
      bySeverity: z.object({
        low: z.number().int().nonnegative(),
        medium: z.number().int().nonnegative(),
        high: z.number().int().nonnegative()
      }),
      byRule: z.record(z.number().int().nonnegative())
    })
  }),
  recommendedCommands: z.array(z.string())
});

export const runCapQualityGateTool = {
  name: "run_cap_quality_gate",
  description: "Run a consolidated SAP CAP quality gate for project detection, model/service validation, handler risks, and test readiness.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      qualityProfile,
      maxFiles,
      maxFindings,
      allowPublicServices,
      requireTestScript,
      failOnMediumFindings,
      maxHighFindings
    } = inputSchema.parse(args);
    const selectedProfile = qualityProfile ?? (process.env.NODE_ENV === "production" ? "prod" : "dev");
    const shouldFailMedium = failOnMediumFindings ?? selectedProfile === "prod";
    const allowedHighFindings = maxHighFindings ?? 0;
    const analysis = await analyzeCapProjectTool.handler(
      {
        sourceDir,
        maxFiles
      },
      { context }
    );
    const validation = await validateCapProjectTool.handler(
      {
        sourceDir,
        maxFiles,
        maxFindings,
        allowPublicServices,
        requireTestScript: requireTestScript ?? true
      },
      { context }
    );

    const highFindings = validation.summary.bySeverity.high;
    const mediumFindings = validation.summary.bySeverity.medium;
    const lowFindings = validation.summary.bySeverity.low;
    const checks = [
      {
        id: "cap_project_detected",
        pass: analysis.detected,
        severity: "error",
        message: analysis.detected
          ? "CAP project signals were detected."
          : "CAP project signals were not detected."
      },
      {
        id: "cap_runtime_declared",
        pass: Boolean(analysis.dependencies.cds),
        severity: "error",
        message: analysis.dependencies.cds
          ? `@sap/cds dependency resolved: ${analysis.dependencies.cds}.`
          : "@sap/cds dependency is missing."
      },
      {
        id: "cap_services_detected",
        pass: analysis.cds.services.length > 0,
        severity: "warn",
        message: analysis.cds.services.length > 0
          ? `${analysis.cds.services.length} CAP service(s) detected.`
          : "No CAP services were detected in CDS sources."
      },
      {
        id: "cap_validation_high_findings",
        pass: highFindings <= allowedHighFindings,
        severity: "error",
        message: highFindings <= allowedHighFindings
          ? "High-severity CAP findings are within threshold."
          : `${highFindings} high-severity CAP finding(s) exceed threshold ${allowedHighFindings}.`
      },
      {
        id: "cap_validation_medium_findings",
        pass: shouldFailMedium ? mediumFindings === 0 : true,
        severity: shouldFailMedium ? "error" : "warn",
        message: mediumFindings === 0
          ? "No medium-severity CAP findings."
          : `${mediumFindings} medium-severity CAP finding(s) detected.`
      },
      {
        id: "cap_test_script",
        pass: analysis.scripts.test,
        severity: "warn",
        message: analysis.scripts.test
          ? "npm test script is available."
          : "npm test script is missing."
      }
    ];
    const failedChecks = checks.filter((check) => !check.pass);
    const errorChecks = failedChecks.filter((check) => check.severity === "error").length;

    return outputSchema.parse({
      pass: errorChecks === 0,
      sourceDir: analysis.sourceDir,
      qualityProfile: selectedProfile,
      checks,
      summary: {
        failedChecks: failedChecks.length,
        errorChecks,
        warningChecks: failedChecks.length - errorChecks,
        highFindings,
        mediumFindings,
        lowFindings
      },
      reports: {
        analysis: {
          detected: analysis.detected,
          capVersion: analysis.project.capVersion,
          serviceCount: analysis.cds.services.length,
          entityCount: analysis.cds.entities,
          testScript: analysis.scripts.test
        },
        validation: {
          valid: validation.valid,
          totalFindings: validation.summary.totalFindings,
          bySeverity: validation.summary.bySeverity,
          byRule: validation.summary.byRule
        }
      },
      recommendedCommands: buildRecommendedCommands(analysis)
    });
  }
};

function buildRecommendedCommands(analysis) {
  const commands = [];
  if (analysis.scripts.test) {
    commands.push("npm test");
  }
  if (analysis.scripts.build) {
    commands.push("npm run build");
  }
  commands.push("npx cds compile srv --to csn");
  if (analysis.detectedFiles.mtaYaml) {
    commands.push("mbt build");
  }
  return commands;
}
