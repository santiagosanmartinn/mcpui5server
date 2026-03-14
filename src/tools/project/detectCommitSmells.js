import { z } from "zod";
import { analyzeGitDiffTool } from "./analyzeGitDiff.js";
import { auditGitWorktreeStateTool } from "./auditGitWorktreeState.js";
import { smartStageChangesTool } from "./smartStageChanges.js";
import { resolveLanguage, t } from "../../utils/language.js";

const DIFF_MODES = ["working_tree", "staged", "range"];
const SEVERITIES = ["low", "medium", "high"];

const inputSchema = z.object({
  mode: z.enum(DIFF_MODES).optional(),
  baseRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  includeUntracked: z.boolean().optional(),
  language: z.enum(["es", "en"]).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxSplitGroups: z.number().int().min(2).max(10).optional()
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
  summary: z.object({
    changedFiles: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    touches: z.object({
      docs: z.boolean(),
      tests: z.boolean(),
      controllers: z.boolean(),
      views: z.boolean(),
      manifest: z.boolean(),
      i18n: z.boolean(),
      config: z.boolean()
    })
  }),
  smells: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(SEVERITIES),
      title: z.string(),
      description: z.string(),
      evidence: z.array(z.string()),
      suggestedFix: z.string()
    })
  ),
  splitProposal: z.array(
    z.object({
      groupId: z.string(),
      title: z.string(),
      files: z.array(z.string()),
      suggestedAddCommand: z.string().nullable()
    })
  ),
  gate: z.object({
    shouldSplitCommit: z.boolean(),
    blockingSmells: z.array(z.string()),
    warningSmells: z.array(z.string())
  }),
  automationPolicy: z.object({
    modifiesGitState: z.boolean(),
    requiresExplicitUserConsent: z.boolean(),
    note: z.string()
  })
});

export const detectCommitSmellsTool = {
  name: "detect_commit_smells",
  description: "Detect commit quality smells (size, mixed concerns, test gaps) and suggest a safer split plan.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const maxSplitGroups = parsed.maxSplitGroups ?? 5;
    const [diff, audit, splitPlan] = await Promise.all([
      analyzeGitDiffTool.handler(parsed, { context }),
      auditGitWorktreeStateTool.handler(
        {
          includeUntracked: parsed.includeUntracked,
          language: parsed.language,
          maxFiles: parsed.maxFiles,
          timeoutMs: parsed.timeoutMs
        },
        { context }
      ),
      smartStageChangesTool.handler(
        {
          mode: parsed.mode,
          baseRef: parsed.baseRef,
          targetRef: parsed.targetRef,
          includeUntracked: parsed.includeUntracked,
          language: parsed.language,
          maxFiles: parsed.maxFiles,
          timeoutMs: parsed.timeoutMs,
          maxGroups: maxSplitGroups
        },
        { context }
      )
    ]);

    const smells = [];
    const churn = diff.summary.additions + diff.summary.deletions;
    const dimensionCount = countConcernDimensions(diff.summary.touches);

    if (diff.summary.changedFiles > 30 || churn > 1000) {
      smells.push({
        id: "oversized-commit",
        severity: "high",
        title: t(language, "Commit demasiado grande", "Oversized commit"),
        description: t(
          language,
          `El commit propuesto toca ${diff.summary.changedFiles} archivos (+${diff.summary.additions}/-${diff.summary.deletions}).`,
          `Proposed commit touches ${diff.summary.changedFiles} files (+${diff.summary.additions}/-${diff.summary.deletions}).`
        ),
        evidence: diff.files.slice(0, 15).map((item) => item.path),
        suggestedFix: t(language, "Dividir en varios commits logicos pequenos.", "Split into smaller logical commits.")
      });
    }

    if (dimensionCount >= 3) {
      smells.push({
        id: "mixed-concerns",
        severity: "medium",
        title: t(language, "Mezcla de responsabilidades", "Mixed concerns"),
        description: t(
          language,
          "El cambio mezcla varias dimensiones (runtime, config, docs, tests, etc.) en un unico commit.",
          "Change mixes several dimensions (runtime, config, docs, tests, etc.) in a single commit."
        ),
        evidence: describeTouchDimensions(diff.summary.touches, language),
        suggestedFix: t(language, "Separar commits por intencion funcional.", "Separate commits by functional intent.")
      });
    }

    const runtimeTouched = diff.summary.touches.controllers
      || diff.summary.touches.views
      || diff.summary.touches.manifest
      || diff.summary.touches.config;
    if (runtimeTouched && !diff.summary.touches.tests) {
      smells.push({
        id: "code-without-tests",
        severity: "high",
        title: t(language, "Codigo/configuracion sin tests asociados", "Code/config without tests"),
        description: t(
          language,
          "Se detectaron cambios de comportamiento sin actualizar pruebas automatizadas.",
          "Behavior-impacting changes were detected without updated automated tests."
        ),
        evidence: diff.files
          .filter((item) => isRuntimeOrConfig(item.path))
          .slice(0, 15)
          .map((item) => item.path),
        suggestedFix: t(language, "Anadir o actualizar tests focalizados antes de commit.", "Add or update focused tests before committing.")
      });
    }

    if (audit.workingTree.conflictedFiles > 0) {
      smells.push({
        id: "unresolved-conflicts",
        severity: "high",
        title: t(language, "Conflictos sin resolver", "Unresolved conflicts"),
        description: t(language, "Hay archivos en estado de conflicto (`unmerged`).", "There are files in conflict (`unmerged`) state."),
        evidence: audit.workingTree.files.filter((item) => item.isConflicted).slice(0, 10).map((item) => item.path),
        suggestedFix: t(language, "Resolver conflictos antes de continuar.", "Resolve conflicts before proceeding.")
      });
    }

    if (audit.workingTree.stagedChanges > 0 && audit.workingTree.unstagedChanges > 0) {
      smells.push({
        id: "mixed-staged-unstaged",
        severity: "medium",
        title: t(language, "Staged y unstaged mezclados", "Mixed staged and unstaged"),
        description: t(language, "Hay cambios parciales que pueden provocar commit accidental incompleto.", "Partial changes may cause accidental incomplete commit."),
        evidence: audit.workingTree.files.slice(0, 10).map((item) => `${item.statusCode} ${item.path}`),
        suggestedFix: t(language, "Revisar staging y alinear el estado antes del commit.", "Review staging and align state before commit.")
      });
    }

    if (smells.length === 0) {
      smells.push({
        id: "no-major-smells",
        severity: "low",
        title: t(language, "Sin olores relevantes", "No major smells"),
        description: t(language, "No se detectaron patrones criticos de calidad de commit.", "No critical commit quality patterns were detected."),
        evidence: [],
        suggestedFix: t(language, "Mantener revision manual y ejecutar `npm run check`.", "Keep manual review and run `npm run check`.")
      });
    }

    const splitProposal = splitPlan.stagingPlan.groups
      .slice(0, maxSplitGroups)
      .map((group) => ({
        groupId: group.id,
        title: group.title,
        files: group.files,
        suggestedAddCommand: group.suggestedAddCommand
      }));

    const blockingSmells = smells
      .filter((item) => item.severity === "high")
      .map((item) => item.id);
    const warningSmells = smells
      .filter((item) => item.severity === "medium")
      .map((item) => item.id);

    return outputSchema.parse({
      scope: diff.scope,
      summary: {
        changedFiles: diff.summary.changedFiles,
        additions: diff.summary.additions,
        deletions: diff.summary.deletions,
        touches: diff.summary.touches
      },
      smells,
      splitProposal,
      gate: {
        shouldSplitCommit: blockingSmells.includes("oversized-commit") || warningSmells.includes("mixed-concerns"),
        blockingSmells,
        warningSmells
      },
      automationPolicy: {
        modifiesGitState: false,
        requiresExplicitUserConsent: true,
        note: t(
          language,
          "Esta tool solo detecta olores y propone particion. No modifica estado Git.",
          "This tool only detects smells and proposes split. It does not modify Git state."
        )
      }
    });
  }
};

function countConcernDimensions(touches) {
  const dimensions = [
    touches.docs,
    touches.tests,
    touches.controllers || touches.views,
    touches.manifest || touches.config,
    touches.i18n
  ];
  return dimensions.filter(Boolean).length;
}

function describeTouchDimensions(touches, language) {
  const values = [];
  if (touches.controllers || touches.views) {
    values.push(t(language, "runtime-ui5", "ui5-runtime"));
  }
  if (touches.manifest || touches.config) {
    values.push(t(language, "manifest-config", "manifest-config"));
  }
  if (touches.tests) {
    values.push(t(language, "tests", "tests"));
  }
  if (touches.docs) {
    values.push(t(language, "docs", "docs"));
  }
  if (touches.i18n) {
    values.push(t(language, "i18n", "i18n"));
  }
  return values;
}

function isRuntimeOrConfig(relativePath) {
  const normalized = relativePath.toLowerCase();
  return normalized.includes("/controller/")
    || normalized.includes("/view/")
    || normalized === "webapp/manifest.json"
    || normalized.endsWith("/manifest.json")
    || normalized === "package.json"
    || normalized === "package-lock.json"
    || normalized === "ui5.yaml"
    || normalized === "eslint.config.js"
    || normalized === "vitest.config.js"
    || normalized.startsWith(".github/workflows/");
}
