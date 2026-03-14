import { z } from "zod";
import { prepareSafeCommitTool } from "./prepareSafeCommit.js";
import { riskReviewFromDiffTool } from "./riskReviewFromDiff.js";
import { branchHygieneReportTool } from "./branchHygieneReport.js";
import { conflictPrecheckTool } from "./conflictPrecheck.js";
import { detectCommitSmellsTool } from "./detectCommitSmells.js";
import { resolveLanguage, t } from "../../utils/language.js";

const DIFF_MODES = ["working_tree", "staged", "range"];
const READINESS_LEVELS = ["ready", "needs_attention", "blocked"];

const inputSchema = z.object({
  mode: z.enum(DIFF_MODES).optional(),
  baseRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  sourceRef: z.string().min(1).optional(),
  includeUntracked: z.boolean().optional(),
  language: z.enum(["es", "en"]).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional()
}).strict().superRefine((value, ctx) => {
  const mode = value.mode ?? "working_tree";
  if (mode === "range" && !value.baseRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "baseRef is required when mode is `range`."
    });
  }
});

const outputSchema = z.object({
  scope: z.object({
    mode: z.enum(DIFF_MODES),
    baseRef: z.string().nullable(),
    targetRef: z.string().nullable()
  }),
  readiness: z.object({
    level: z.enum(READINESS_LEVELS),
    readyForMerge: z.boolean(),
    score: z.number().int().min(0).max(100),
    blockers: z.array(z.string()),
    warnings: z.array(z.string())
  }),
  checks: z.object({
    commit: z.object({
      readyForCommit: z.boolean(),
      blockingChecks: z.array(z.string()),
      warningChecks: z.array(z.string())
    }),
    risk: z.object({
      level: z.string(),
      score: z.number().int().min(0).max(100),
      mustFixBeforeMerge: z.array(z.string())
    }),
    branch: z.object({
      level: z.string(),
      score: z.number().int().min(0).max(100)
    }),
    conflict: z.object({
      level: z.string(),
      score: z.number().int().min(0).max(100),
      overlappingFiles: z.number().int().nonnegative()
    }),
    smells: z.object({
      shouldSplitCommit: z.boolean(),
      highSeverityCount: z.number().int().nonnegative(),
      mediumSeverityCount: z.number().int().nonnegative()
    })
  }),
  nextActions: z.array(z.string()),
  automationPolicy: z.object({
    performsMergeOrPush: z.boolean(),
    requiresExplicitUserConsent: z.boolean(),
    note: z.string()
  })
});

export const mergeReadinessReportTool = {
  name: "merge_readiness_report",
  description: "Aggregate Git quality checks into a single merge-readiness decision (ready, needs_attention, blocked).",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const common = {
      mode: parsed.mode,
      baseRef: parsed.baseRef,
      targetRef: parsed.targetRef,
      includeUntracked: parsed.includeUntracked,
      language: parsed.language,
      maxFiles: parsed.maxFiles,
      timeoutMs: parsed.timeoutMs
    };

    const [commitGate, risk, branch, conflict, smells] = await Promise.all([
      prepareSafeCommitTool.handler(common, { context }),
      riskReviewFromDiffTool.handler(common, { context }),
      branchHygieneReportTool.handler(
        {
          targetRef: parsed.targetRef,
          includeUntracked: parsed.includeUntracked,
          language: parsed.language,
          maxFiles: parsed.maxFiles,
          timeoutMs: parsed.timeoutMs
        },
        { context }
      ),
      conflictPrecheckTool.handler(
        {
          sourceRef: parsed.sourceRef,
          targetRef: parsed.targetRef,
          language: parsed.language,
          maxFiles: parsed.maxFiles,
          timeoutMs: parsed.timeoutMs
        },
        { context }
      ),
      detectCommitSmellsTool.handler(
        {
          mode: parsed.mode,
          baseRef: parsed.baseRef,
          targetRef: parsed.targetRef,
          includeUntracked: parsed.includeUntracked,
          language: parsed.language,
          maxFiles: parsed.maxFiles,
          timeoutMs: parsed.timeoutMs
        },
        { context }
      )
    ]);

    const blockers = [];
    const warnings = [];
    let score = 100;

    if (!commitGate.gate.readyForCommit) {
      blockers.push(...commitGate.gate.blockingChecks.map((id) => `commit:${id}`));
      score -= 30;
    }
    warnings.push(...commitGate.gate.warningChecks.map((id) => `commit:${id}`));

    if (risk.risk.level === "critical") {
      blockers.push("risk:critical");
      score -= 35;
    } else if (risk.risk.level === "high") {
      score -= 20;
    } else if (risk.risk.level === "medium") {
      score -= 10;
    }
    blockers.push(...risk.risk.mustFixBeforeMerge.map((id) => `risk:${id}`));

    if (branch.hygiene.level === "risky") {
      score -= 20;
      warnings.push("branch:risky");
    } else if (branch.hygiene.level === "warning") {
      score -= 10;
      warnings.push("branch:warning");
    }

    if (conflict.risk.level === "high") {
      blockers.push("conflict:high");
      score -= 25;
    } else if (conflict.risk.level === "medium") {
      warnings.push("conflict:medium");
      score -= 10;
    }

    const highSmells = smells.smells.filter((item) => item.severity === "high").length;
    const mediumSmells = smells.smells.filter((item) => item.severity === "medium").length;
    if (highSmells > 0) {
      warnings.push("smells:high");
      score -= Math.min(20, highSmells * 8);
    }
    if (mediumSmells > 0) {
      warnings.push("smells:medium");
      score -= Math.min(10, mediumSmells * 4);
    }
    if (smells.gate.shouldSplitCommit) {
      warnings.push("smells:split-recommended");
      score -= 8;
    }

    const boundedScore = Math.max(0, Math.min(100, score));
    const readyForMerge = blockers.length === 0 && boundedScore >= 70;
    const level = blockers.length > 0
      ? "blocked"
      : readyForMerge
        ? "ready"
        : "needs_attention";

    const nextActions = buildNextActions({
      language,
      commitGate,
      risk,
      branch,
      conflict,
      smells
    });

    return outputSchema.parse({
      scope: commitGate.scope,
      readiness: {
        level,
        readyForMerge,
        score: boundedScore,
        blockers: unique(blockers),
        warnings: unique(warnings)
      },
      checks: {
        commit: {
          readyForCommit: commitGate.gate.readyForCommit,
          blockingChecks: commitGate.gate.blockingChecks,
          warningChecks: commitGate.gate.warningChecks
        },
        risk: {
          level: risk.risk.level,
          score: risk.risk.score,
          mustFixBeforeMerge: risk.risk.mustFixBeforeMerge
        },
        branch: {
          level: branch.hygiene.level,
          score: branch.hygiene.score
        },
        conflict: {
          level: conflict.risk.level,
          score: conflict.risk.score,
          overlappingFiles: conflict.comparison.overlappingFiles
        },
        smells: {
          shouldSplitCommit: smells.gate.shouldSplitCommit,
          highSeverityCount: highSmells,
          mediumSeverityCount: mediumSmells
        }
      },
      nextActions,
      automationPolicy: {
        performsMergeOrPush: false,
        requiresExplicitUserConsent: true,
        note: t(
          language,
          "Esta tool solo consolida analisis de readiness. No ejecuta merge ni push automaticamente.",
          "This tool only consolidates readiness analysis. It does not perform merge or push automatically."
        )
      }
    });
  }
};

function buildNextActions(input) {
  const actions = [];
  if (!input.commitGate.gate.readyForCommit) {
    actions.push(
      t(
        input.language,
        "Resolver checks bloqueantes de commit antes de continuar.",
        "Resolve blocking commit checks before continuing."
      )
    );
  }
  if (input.risk.risk.mustFixBeforeMerge.length > 0) {
    actions.push(
      t(
        input.language,
        "Abordar los riesgos marcados como obligatorios (`mustFixBeforeMerge`).",
        "Address risks marked as mandatory (`mustFixBeforeMerge`)."
      )
    );
  }
  if (input.conflict.risk.level !== "low") {
    actions.push(
      t(
        input.language,
        "Sincronizar rama y revisar ficheros solapados antes de merge.",
        "Sync branch and review overlapping files before merge."
      )
    );
  }
  if (input.smells.gate.shouldSplitCommit) {
    actions.push(
      t(
        input.language,
        "Dividir el commit usando la propuesta de `smart_stage_changes`.",
        "Split the commit using `smart_stage_changes` proposal."
      )
    );
  }
  actions.push(t(input.language, "Ejecutar `npm run check` como puerta final.", "Run `npm run check` as final gate."));
  return unique(actions);
}

function unique(values) {
  return Array.from(new Set(values));
}
