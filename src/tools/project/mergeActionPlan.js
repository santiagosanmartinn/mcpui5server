import { z } from "zod";
import { mergeReadinessReportTool } from "./mergeReadinessReport.js";
import { resolveLanguage, t } from "../../utils/language.js";

const DIFF_MODES = ["working_tree", "staged", "range"];
const STRATEGY_REQUESTED = ["auto", "merge", "rebase"];
const STRATEGY_RECOMMENDED = ["merge", "rebase", "defer"];
const ACTION_STATUS = ["todo", "blocked", "not_needed"];

const inputSchema = z.object({
  mode: z.enum(DIFF_MODES).optional(),
  baseRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  sourceRef: z.string().min(1).optional(),
  includeUntracked: z.boolean().optional(),
  language: z.enum(["es", "en"]).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  preferredStrategy: z.enum(STRATEGY_REQUESTED).optional(),
  includeCommands: z.boolean().optional()
}).strict().superRefine((value, ctx) => {
  const mode = value.mode ?? "working_tree";
  if (mode === "range" && !value.baseRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "baseRef is required when mode is `range`."
    });
  }
});

const actionSchema = z.object({
  id: z.string(),
  title: z.string(),
  required: z.boolean(),
  status: z.enum(ACTION_STATUS)
});

const outputSchema = z.object({
  scope: z.object({
    mode: z.enum(DIFF_MODES),
    baseRef: z.string().nullable(),
    targetRef: z.string().nullable()
  }),
  readiness: z.object({
    level: z.enum(["ready", "needs_attention", "blocked"]),
    readyForMerge: z.boolean(),
    score: z.number().int().min(0).max(100),
    blockers: z.array(z.string()),
    warnings: z.array(z.string())
  }),
  signals: z.object({
    riskLevel: z.string(),
    branchLevel: z.string(),
    conflictLevel: z.string(),
    shouldSplitCommit: z.boolean()
  }),
  strategy: z.object({
    requested: z.enum(STRATEGY_REQUESTED),
    recommended: z.enum(STRATEGY_RECOMMENDED),
    rationale: z.array(z.string())
  }),
  plan: z.object({
    premerge: z.array(actionSchema),
    sync: z.array(actionSchema),
    validate: z.array(actionSchema),
    integrate: z.array(actionSchema),
    postmerge: z.array(actionSchema)
  }),
  commands: z.object({
    premerge: z.array(z.string()),
    sync: z.array(z.string()),
    validate: z.array(z.string()),
    integrate: z.array(z.string()),
    postmerge: z.array(z.string())
  }),
  nextActions: z.array(z.string()),
  automationPolicy: z.object({
    performsMergeOrPush: z.boolean(),
    requiresExplicitUserConsent: z.boolean(),
    note: z.string()
  })
});

export const mergeActionPlanTool = {
  name: "merge_action_plan",
  description: "Create a safe, non-destructive merge action plan (strategy, staged checklist, and suggested commands) from merge readiness signals.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const requestedStrategy = parsed.preferredStrategy ?? "auto";
    const includeCommands = parsed.includeCommands ?? true;

    const readiness = await mergeReadinessReportTool.handler(
      {
        mode: parsed.mode,
        baseRef: parsed.baseRef,
        targetRef: parsed.targetRef,
        sourceRef: parsed.sourceRef,
        includeUntracked: parsed.includeUntracked,
        language: parsed.language,
        maxFiles: parsed.maxFiles,
        timeoutMs: parsed.timeoutMs
      },
      { context }
    );

    const strategy = inferStrategy({
      requestedStrategy,
      readiness,
      language
    });
    const plan = buildPlan({
      readiness,
      strategy,
      language
    });
    const commands = includeCommands
      ? buildCommands({
        sourceRef: parsed.sourceRef ?? "HEAD",
        targetRef: parsed.targetRef ?? "origin/main",
        strategy: strategy.recommended,
        blocked: readiness.readiness.level === "blocked",
        language
      })
      : emptyCommands();

    return outputSchema.parse({
      scope: readiness.scope,
      readiness: readiness.readiness,
      signals: {
        riskLevel: readiness.checks.risk.level,
        branchLevel: readiness.checks.branch.level,
        conflictLevel: readiness.checks.conflict.level,
        shouldSplitCommit: readiness.checks.smells.shouldSplitCommit
      },
      strategy: {
        requested: requestedStrategy,
        recommended: strategy.recommended,
        rationale: strategy.rationale
      },
      plan,
      commands,
      nextActions: readiness.nextActions,
      automationPolicy: {
        performsMergeOrPush: false,
        requiresExplicitUserConsent: true,
        note: t(
          language,
          "Esta tool solo propone un plan de merge seguro. No ejecuta merge, rebase, commit ni push.",
          "This tool only proposes a safe merge plan. It does not execute merge, rebase, commit, or push."
        )
      }
    });
  }
};

function inferStrategy(input) {
  const { requestedStrategy, readiness, language } = input;
  const rationale = [];
  const blocked = readiness.readiness.level === "blocked";
  const conflictLevel = readiness.checks.conflict.level;
  const branchLevel = readiness.checks.branch.level;
  const shouldSplit = readiness.checks.smells.shouldSplitCommit;

  if (blocked) {
    rationale.push(t(language, "Hay bloqueos activos; primero hay que resolverlos.", "Active blockers exist; resolve them first."));
    return {
      recommended: "defer",
      rationale
    };
  }

  if (requestedStrategy === "merge") {
    rationale.push(t(language, "Estrategia solicitada por el usuario: merge.", "User-requested strategy: merge."));
    return {
      recommended: "merge",
      rationale
    };
  }

  if (requestedStrategy === "rebase") {
    if (conflictLevel === "high") {
      rationale.push(t(language, "El riesgo de conflicto es alto; se recomienda no rebasear hasta resolver solapes.", "Conflict risk is high; avoid rebasing until overlap issues are resolved."));
      return {
        recommended: "defer",
        rationale
      };
    }
    rationale.push(t(language, "Estrategia solicitada por el usuario: rebase.", "User-requested strategy: rebase."));
    return {
      recommended: "rebase",
      rationale
    };
  }

  if (conflictLevel === "low" && branchLevel === "healthy" && !shouldSplit) {
    rationale.push(t(language, "Riesgo bajo y rama saludable; rebase puede mantener historial lineal.", "Low risk and healthy branch; rebase can keep history linear."));
    return {
      recommended: "rebase",
      rationale
    };
  }

  rationale.push(t(language, "Se prioriza merge por simplicidad y menor friccion operativa.", "Merge is preferred for simpler, lower-friction operation."));
  return {
    recommended: "merge",
    rationale
  };
}

function buildPlan(input) {
  const { readiness, strategy, language } = input;
  const blocked = readiness.readiness.level === "blocked";
  const needsSplit = readiness.checks.smells.shouldSplitCommit;
  const integrationBlocked = blocked || strategy.recommended === "defer";
  const syncBlocked = blocked && readiness.checks.conflict.level === "high";

  return {
    premerge: [
      {
        id: "resolve-blockers",
        title: t(language, "Resolver bloqueos del reporte de readiness", "Resolve blockers from readiness report"),
        required: true,
        status: blocked ? "blocked" : "todo"
      },
      {
        id: "split-commit-if-needed",
        title: t(language, "Separar cambios en commits logicos (si aplica)", "Split changes into logical commits (if needed)"),
        required: false,
        status: needsSplit ? "todo" : "not_needed"
      }
    ],
    sync: [
      {
        id: "fetch-target",
        title: t(language, "Sincronizar referencias remotas (`git fetch`)", "Sync remote refs (`git fetch`)"),
        required: true,
        status: syncBlocked ? "blocked" : "todo"
      },
      {
        id: "integrate-target-into-source",
        title: t(language, "Integrar rama objetivo en la rama de trabajo", "Integrate target branch into working branch"),
        required: true,
        status: integrationBlocked ? "blocked" : "todo"
      }
    ],
    validate: [
      {
        id: "run-quality-checks",
        title: t(language, "Ejecutar validaciones (`npm run check`)", "Run validations (`npm run check`)"),
        required: true,
        status: blocked ? "blocked" : "todo"
      },
      {
        id: "run-focused-tests",
        title: t(language, "Ejecutar tests focalizados del cambio", "Run focused tests for the change"),
        required: true,
        status: blocked ? "blocked" : "todo"
      }
    ],
    integrate: [
      {
        id: "execute-merge-or-rebase",
        title: strategy.recommended === "rebase"
          ? t(language, "Aplicar rebase con consentimiento explicito", "Apply rebase with explicit consent")
          : t(language, "Aplicar merge con consentimiento explicito", "Apply merge with explicit consent"),
        required: true,
        status: integrationBlocked ? "blocked" : "todo"
      }
    ],
    postmerge: [
      {
        id: "final-regression-check",
        title: t(language, "Smoke test final tras integracion", "Final smoke test after integration"),
        required: true,
        status: integrationBlocked ? "blocked" : "todo"
      },
      {
        id: "push-with-consent",
        title: t(language, "Push final solo con consentimiento explicito", "Final push only with explicit consent"),
        required: true,
        status: integrationBlocked ? "blocked" : "todo"
      }
    ]
  };
}

function buildCommands(input) {
  const { sourceRef, targetRef, strategy, blocked, language } = input;
  if (blocked || strategy === "defer") {
    return {
      premerge: [
        t(language, "Resolver primero blockers en `merge_readiness_report`.", "Resolve blockers from `merge_readiness_report` first.")
      ],
      sync: [],
      validate: ["npm run check"],
      integrate: [],
      postmerge: []
    };
  }

  const integrateCommand = strategy === "rebase"
    ? `git rebase ${targetRef}`
    : `git merge --no-ff ${targetRef}`;

  return {
    premerge: [
      "git status --short",
      "git diff --stat"
    ],
    sync: [
      "git fetch --all --prune",
      `git rev-parse --abbrev-ref ${sourceRef}`
    ],
    validate: [
      "npm run check"
    ],
    integrate: [
      integrateCommand
    ],
    postmerge: [
      "npm run check",
      "git push"
    ]
  };
}

function emptyCommands() {
  return {
    premerge: [],
    sync: [],
    validate: [],
    integrate: [],
    postmerge: []
  };
}
