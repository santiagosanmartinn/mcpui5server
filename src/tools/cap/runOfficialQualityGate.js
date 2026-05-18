import { z } from "zod";
import { sapOfficialDocumentationCatalogTool } from "../documentation/sapOfficialDocs.js";
import { analyzeCapProjectTool } from "./analyzeProject.js";
import { analyzeCdsModelContractTool } from "./analyzeCdsModelContract.js";
import { runCapQualityGateTool } from "./runQualityGate.js";
import { validateCapTypescriptReadinessTool } from "./validateTypescriptReadiness.js";

const QUALITY_PROFILES = ["dev", "prod"];

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  qualityProfile: z.enum(QUALITY_PROFILES).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  maxFindings: z.number().int().min(10).max(2000).optional(),
  requireTypescriptReadiness: z.boolean().optional(),
  allowPublicServices: z.boolean().optional(),
  requireTestScript: z.boolean().optional()
}).strict();

const officialRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  product: z.enum(["cap", "ui5"]),
  topic: z.string()
});

const checkSchema = z.object({
  id: z.string(),
  pass: z.boolean(),
  severity: z.enum(["error", "warn"]),
  message: z.string(),
  officialRefs: z.array(officialRefSchema)
});

const outputSchema = z.object({
  pass: z.boolean(),
  sourceDir: z.string(),
  qualityProfile: z.enum(QUALITY_PROFILES),
  officialOnly: z.boolean(),
  checks: z.array(checkSchema),
  summary: z.object({
    failedChecks: z.number().int().nonnegative(),
    errorChecks: z.number().int().nonnegative(),
    warningChecks: z.number().int().nonnegative(),
    capHighFindings: z.number().int().nonnegative(),
    modelHighFindings: z.number().int().nonnegative(),
    typescriptScore: z.number().int().min(0).max(100)
  }),
  reports: z.object({
    cap: z.object({
      detected: z.boolean(),
      services: z.number().int().nonnegative(),
      entities: z.number().int().nonnegative()
    }),
    capQualityGate: z.object({
      pass: z.boolean(),
      failedChecks: z.number().int().nonnegative()
    }),
    modelContract: z.object({
      findings: z.number().int().nonnegative(),
      highFindings: z.number().int().nonnegative(),
      services: z.number().int().nonnegative(),
      entities: z.number().int().nonnegative()
    }),
    typescriptReadiness: z.object({
      ready: z.boolean(),
      score: z.number().int().min(0).max(100),
      blocking: z.number().int().nonnegative(),
      warnings: z.number().int().nonnegative()
    }),
    documentationCatalog: z.object({
      valid: z.boolean(),
      references: z.number().int().nonnegative(),
      invalidReferences: z.number().int().nonnegative(),
      staleReferences: z.number().int().nonnegative()
    })
  }),
  recommendedCommands: z.array(z.string())
});

export const runCapOfficialQualityGateTool = {
  name: "run_cap_official_quality_gate",
  description: "Run a read-only SAP CAP quality gate grounded in the curated official SAP documentation catalog.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      qualityProfile,
      maxFiles,
      maxFindings,
      requireTypescriptReadiness,
      allowPublicServices,
      requireTestScript
    } = inputSchema.parse(args);
    const selectedProfile = qualityProfile ?? "dev";
    const [
      analysis,
      capGate,
      modelContract,
      typescriptReadiness,
      documentationCatalog
    ] = await Promise.all([
      analyzeCapProjectTool.handler({ sourceDir, maxFiles }, { context }),
      runCapQualityGateTool.handler({
        sourceDir,
        qualityProfile: selectedProfile,
        maxFiles,
        maxFindings,
        allowPublicServices,
        requireTestScript
      }, { context }),
      analyzeCdsModelContractTool.handler({ sourceDir, maxFiles, maxFindings }, { context }),
      validateCapTypescriptReadinessTool.handler({ sourceDir, maxFiles, targetMode: "mixed" }, { context }),
      sapOfficialDocumentationCatalogTool.handler({ product: "cap", includeValidation: true })
    ]);
    const shouldRequireTypescript = requireTypescriptReadiness ?? selectedProfile === "prod";
    const checks = [
      createCheck({
        id: "official_catalog_valid",
        pass: documentationCatalog.validation.valid,
        severity: "error",
        message: documentationCatalog.validation.valid
          ? "Official SAP documentation catalog is valid."
          : "Official SAP documentation catalog has invalid references.",
        refs: documentationCatalog.references.slice(0, 3)
      }),
      createCheck({
        id: "cap_base_quality_gate",
        pass: capGate.pass,
        severity: "error",
        message: capGate.pass
          ? "Base CAP quality gate passed."
          : "Base CAP quality gate failed.",
        refs: documentationCatalog.references.filter((reference) => [
          "sap-cap-cds",
          "sap-cap-authorization",
          "sap-cap-cds-test"
        ].includes(reference.id))
      }),
      createCheck({
        id: "cds_model_contract",
        pass: modelContract.summary.highFindings === 0,
        severity: "error",
        message: modelContract.summary.highFindings === 0
          ? "CDS model contract has no high-severity findings."
          : `${modelContract.summary.highFindings} high-severity CDS model contract finding(s) detected.`,
        refs: refsFromFindings(modelContract.findings)
      }),
      createCheck({
        id: "cap_typescript_readiness",
        pass: shouldRequireTypescript ? typescriptReadiness.ready : true,
        severity: shouldRequireTypescript ? "error" : "warn",
        message: typescriptReadiness.ready
          ? `CAP TypeScript/typed JavaScript readiness score is ${typescriptReadiness.score}.`
          : `CAP TypeScript/typed JavaScript readiness score is ${typescriptReadiness.score}.`,
        refs: refsFromChecks(typescriptReadiness.checks)
      })
    ];
    const failedChecks = checks.filter((check) => !check.pass);
    const errorChecks = failedChecks.filter((check) => check.severity === "error").length;

    return outputSchema.parse({
      pass: errorChecks === 0,
      sourceDir: analysis.sourceDir,
      qualityProfile: selectedProfile,
      officialOnly: documentationCatalog.policy.officialOnly,
      checks,
      summary: {
        failedChecks: failedChecks.length,
        errorChecks,
        warningChecks: failedChecks.length - errorChecks,
        capHighFindings: capGate.summary.highFindings,
        modelHighFindings: modelContract.summary.highFindings,
        typescriptScore: typescriptReadiness.score
      },
      reports: {
        cap: {
          detected: analysis.detected,
          services: analysis.cds.services.length,
          entities: analysis.cds.entities
        },
        capQualityGate: {
          pass: capGate.pass,
          failedChecks: capGate.summary.failedChecks
        },
        modelContract: {
          findings: modelContract.summary.findings,
          highFindings: modelContract.summary.highFindings,
          services: modelContract.summary.services,
          entities: modelContract.summary.entities
        },
        typescriptReadiness: {
          ready: typescriptReadiness.ready,
          score: typescriptReadiness.score,
          blocking: typescriptReadiness.summary.blocking,
          warnings: typescriptReadiness.summary.warnings
        },
        documentationCatalog: {
          valid: documentationCatalog.validation.valid,
          references: documentationCatalog.summary.references,
          invalidReferences: documentationCatalog.summary.invalidReferences,
          staleReferences: documentationCatalog.summary.staleReferences
        }
      },
      recommendedCommands: unique([
        ...capGate.recommendedCommands,
        ...modelContract.recommendedCommands,
        ...typescriptReadiness.recommendedCommands,
        "npx cds lint"
      ])
    });
  }
};

function createCheck(input) {
  return {
    id: input.id,
    pass: input.pass,
    severity: input.severity,
    message: input.message,
    officialRefs: normalizeRefs(input.refs)
  };
}

function refsFromFindings(findings) {
  return normalizeRefs(findings.flatMap((finding) => finding.officialRefs));
}

function refsFromChecks(checks) {
  return normalizeRefs(checks.flatMap((check) => check.officialRefs));
}

function normalizeRefs(refs) {
  const seen = new Set();
  return refs
    .filter(Boolean)
    .map((reference) => ({
      id: reference.id,
      title: reference.title,
      url: reference.url,
      product: reference.product,
      topic: reference.topic
    }))
    .filter((reference) => {
      if (seen.has(reference.id)) {
        return false;
      }
      seen.add(reference.id);
      return true;
    })
    .slice(0, 6);
}

function unique(values) {
  return Array.from(new Set(values));
}
