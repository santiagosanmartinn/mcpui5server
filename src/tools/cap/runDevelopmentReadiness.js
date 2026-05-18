import { z } from "zod";
import { analyzeCapPerformanceHotspotsTool } from "./analyzePerformanceHotspots.js";
import { buildCapAiContextPackTool } from "./buildAiContextPack.js";
import { generateCapTestPlanTool } from "./generateTestPlan.js";
import { runCapOfficialQualityGateTool } from "./runOfficialQualityGate.js";
import { validateUi5CapContractAlignmentTool } from "./validateUi5CapAlignment.js";

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  ui5SourceDir: z.string().min(1).optional(),
  manifestPath: z.string().min(1).optional(),
  changeRequest: z.string().min(1).optional(),
  qualityProfile: z.enum(["dev", "prod"]).optional(),
  includeUi5: z.boolean().optional(),
  includeContextPack: z.boolean().optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  maxFindings: z.number().int().min(10).max(2000).optional()
}).strict();

const checkSchema = z.object({
  id: z.string(),
  pass: z.boolean(),
  severity: z.enum(["error", "warn"]),
  message: z.string()
});

const outputSchema = z.object({
  pass: z.boolean(),
  score: z.number().int().min(0).max(100),
  sourceDir: z.string(),
  ui5SourceDir: z.string(),
  qualityProfile: z.enum(["dev", "prod"]),
  checks: z.array(checkSchema),
  summary: z.object({
    failedChecks: z.number().int().nonnegative(),
    errorChecks: z.number().int().nonnegative(),
    warningChecks: z.number().int().nonnegative(),
    officialGatePass: z.boolean(),
    alignmentPass: z.boolean(),
    performanceScore: z.number().int().min(0).max(100),
    testPlanHighPriorityCases: z.number().int().nonnegative(),
    contextPackIncluded: z.boolean()
  }),
  reports: z.object({
    officialGate: z.object({
      pass: z.boolean(),
      failedChecks: z.number().int().nonnegative()
    }),
    alignment: z.object({
      pass: z.boolean(),
      unknownEntitySets: z.number().int().nonnegative()
    }),
    performance: z.object({
      score: z.number().int().min(0).max(100),
      high: z.number().int().nonnegative(),
      medium: z.number().int().nonnegative(),
      low: z.number().int().nonnegative()
    }),
    testPlan: z.object({
      suites: z.number().int().nonnegative(),
      cases: z.number().int().nonnegative(),
      highPriority: z.number().int().nonnegative(),
      gaps: z.number().int().nonnegative()
    }),
    contextPack: z.object({
      included: z.boolean(),
      files: z.number().int().nonnegative(),
      usedChars: z.number().int().nonnegative(),
      truncated: z.boolean()
    })
  }),
  nextActions: z.array(z.string()),
  recommendedTools: z.array(z.string()),
  validationCommands: z.array(z.string())
});

export const runCapDevelopmentReadinessTool = {
  name: "run_cap_development_readiness",
  description: "Run a consolidated SAP CAP/UI5 readiness gate for AI-assisted development, combining official quality, UI alignment, performance, tests, and optional context pack.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      ui5SourceDir,
      manifestPath,
      changeRequest,
      qualityProfile,
      includeUi5,
      includeContextPack,
      maxFiles,
      maxFindings
    } = inputSchema.parse(args);
    const selectedProfile = qualityProfile ?? "dev";
    const selectedIncludeUi5 = includeUi5 ?? true;
    const [officialGate, performance, testPlan] = await Promise.all([
      runCapOfficialQualityGateTool.handler({
        sourceDir,
        qualityProfile: selectedProfile,
        maxFiles,
        maxFindings
      }, { context }),
      analyzeCapPerformanceHotspotsTool.handler({
        sourceDir,
        ui5SourceDir,
        includeUi5: selectedIncludeUi5,
        maxFiles,
        maxFindings
      }, { context }),
      generateCapTestPlanTool.handler({
        sourceDir,
        ui5SourceDir,
        manifestPath,
        includeUi5Checks: selectedIncludeUi5,
        maxFiles
      }, { context })
    ]);
    const alignment = selectedIncludeUi5
      ? await validateUi5CapContractAlignmentTool.handler({
          capSourceDir: sourceDir,
          ui5SourceDir,
          manifestPath,
          maxFiles,
          maxFindings
        }, { context })
      : skippedAlignment();
    const contextPack = includeContextPack && changeRequest
      ? await buildCapAiContextPackTool.handler({
          changeRequest,
          sourceDir,
          ui5SourceDir,
          includeUi5: selectedIncludeUi5,
          maxFiles: 12,
          maxChars: 18000
        }, { context })
      : null;
    const checks = [
      {
        id: "official_quality_gate",
        pass: officialGate.pass,
        severity: "error",
        message: officialGate.pass ? "Official CAP quality gate passed." : "Official CAP quality gate failed."
      },
      {
        id: "ui5_cap_alignment",
        pass: alignment.pass,
        severity: selectedIncludeUi5 ? "error" : "warn",
        message: alignment.pass ? "UI5-CAP contract alignment passed." : "UI5-CAP contract alignment has blocking findings."
      },
      {
        id: "performance_hotspots",
        pass: performance.summary.high === 0,
        severity: "error",
        message: performance.summary.high === 0
          ? `No high-severity performance hotspots; score ${performance.score}.`
          : `${performance.summary.high} high-severity performance hotspot(s); score ${performance.score}.`
      },
      {
        id: "test_plan_gaps",
        pass: !testPlan.gaps.some((gap) => gap.severity === "high"),
        severity: "error",
        message: testPlan.gaps.some((gap) => gap.severity === "high")
          ? "Test plan includes high-severity gaps."
          : "No high-severity test plan gaps."
      }
    ];
    const failedChecks = checks.filter((check) => !check.pass);
    const errorChecks = failedChecks.filter((check) => check.severity === "error").length;
    const score = calculateReadinessScore({
      checks,
      performance,
      testPlan,
      contextPack
    });

    return outputSchema.parse({
      pass: errorChecks === 0,
      score,
      sourceDir: officialGate.sourceDir,
      ui5SourceDir: alignment.ui5SourceDir,
      qualityProfile: selectedProfile,
      checks,
      summary: {
        failedChecks: failedChecks.length,
        errorChecks,
        warningChecks: failedChecks.length - errorChecks,
        officialGatePass: officialGate.pass,
        alignmentPass: alignment.pass,
        performanceScore: performance.score,
        testPlanHighPriorityCases: testPlan.summary.highPriority,
        contextPackIncluded: Boolean(contextPack)
      },
      reports: {
        officialGate: {
          pass: officialGate.pass,
          failedChecks: officialGate.summary.failedChecks
        },
        alignment: {
          pass: alignment.pass,
          unknownEntitySets: alignment.summary.unknownEntitySets
        },
        performance: {
          score: performance.score,
          high: performance.summary.high,
          medium: performance.summary.medium,
          low: performance.summary.low
        },
        testPlan: {
          suites: testPlan.summary.suites,
          cases: testPlan.summary.cases,
          highPriority: testPlan.summary.highPriority,
          gaps: testPlan.gaps.length
        },
        contextPack: {
          included: Boolean(contextPack),
          files: contextPack?.files.length ?? 0,
          usedChars: contextPack?.budget.usedChars ?? 0,
          truncated: contextPack?.budget.truncated ?? false
        }
      },
      nextActions: buildNextActions({
        officialGate,
        alignment,
        performance,
        testPlan,
        contextPack,
        changeRequest
      }),
      recommendedTools: [
        "run_cap_official_quality_gate",
        "validate_ui5_cap_contract_alignment",
        "analyze_cap_performance_hotspots",
        "generate_cap_test_plan",
        "build_cap_ai_context_pack"
      ],
      validationCommands: unique([
        ...officialGate.recommendedCommands,
        ...performance.recommendedCommands,
        ...testPlan.recommendedCommands,
        ...(contextPack?.validationCommands ?? [])
      ])
    });
  }
};

function calculateReadinessScore(input) {
  const { checks, performance, testPlan, contextPack } = input;
  let score = 100;
  score -= checks.filter((check) => !check.pass && check.severity === "error").length * 20;
  score -= checks.filter((check) => !check.pass && check.severity === "warn").length * 8;
  score -= Math.max(0, 100 - performance.score) * 0.25;
  score -= testPlan.gaps.filter((gap) => gap.severity === "medium").length * 4;
  if (contextPack?.budget.truncated) {
    score -= 5;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildNextActions(input) {
  const actions = [];
  if (!input.officialGate.pass) {
    actions.push("Resolve official CAP quality gate failures before implementation.");
  }
  if (!input.alignment.pass) {
    actions.push("Fix UI5 manifest/bindings that do not match local CAP services.");
  }
  if (input.performance.summary.high > 0) {
    actions.push("Address high-severity CAP/UI5 performance hotspots.");
  }
  if (input.testPlan.gaps.some((gap) => gap.severity === "high")) {
    actions.push("Close high-severity test plan gaps or explicitly document accepted risk.");
  }
  if (input.changeRequest && !input.contextPack) {
    actions.push("Generate a context pack for the coding agent before delegating implementation.");
  }
  if (actions.length === 0) {
    actions.push("Proceed with a small implementation batch and run the recommended validation commands.");
  }
  return actions;
}

function skippedAlignment() {
  return {
    pass: true,
    ui5SourceDir: "webapp",
    summary: {
      unknownEntitySets: 0
    }
  };
}

function unique(values) {
  return Array.from(new Set(values));
}
