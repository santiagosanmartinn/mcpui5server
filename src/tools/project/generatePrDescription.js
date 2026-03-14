import { z } from "zod";
import { analyzeGitDiffTool } from "./analyzeGitDiff.js";
import { riskReviewFromDiffTool } from "./riskReviewFromDiff.js";
import { resolveLanguage, t } from "../../utils/language.js";

const DIFF_MODES = ["working_tree", "staged", "range"];

const inputSchema = z.object({
  mode: z.enum(DIFF_MODES).optional(),
  baseRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  includeUntracked: z.boolean().optional(),
  language: z.enum(["es", "en"]).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  title: z.string().min(5).max(120).optional(),
  includeChecklist: z.boolean().optional(),
  includeRollbackPlan: z.boolean().optional(),
  includeRiskSection: z.boolean().optional(),
  maxHighlights: z.number().int().min(3).max(25).optional()
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
  pr: z.object({
    title: z.string(),
    labelsSuggested: z.array(z.string()),
    reviewersSuggested: z.array(z.string()),
    sections: z.object({
      context: z.array(z.string()),
      highlights: z.array(z.string()),
      testing: z.array(z.string()),
      risks: z.array(z.string()),
      rollback: z.array(z.string()),
      checklist: z.array(z.string())
    }),
    markdown: z.string()
  })
});

export const generatePrDescriptionTool = {
  name: "generate_pr_description",
  description: "Generate a structured PR description from Git diff context, including testing, risk, and rollback guidance.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const diffArgs = {
      mode: parsed.mode,
      baseRef: parsed.baseRef,
      targetRef: parsed.targetRef,
      includeUntracked: parsed.includeUntracked,
      language: parsed.language,
      maxFiles: parsed.maxFiles,
      timeoutMs: parsed.timeoutMs
    };
    const includeChecklist = parsed.includeChecklist ?? true;
    const includeRollbackPlan = parsed.includeRollbackPlan ?? true;
    const includeRiskSection = parsed.includeRiskSection ?? true;
    const maxHighlights = parsed.maxHighlights ?? 10;

    const [diff, riskReview] = await Promise.all([
      analyzeGitDiffTool.handler(diffArgs, { context }),
      riskReviewFromDiffTool.handler(diffArgs, { context })
    ]);

    const summary = diff.summary;
    const inferredTitle = parsed.title ?? inferTitle(diff, language);
    const labelsSuggested = inferLabels(summary, riskReview.risk.level);
    const reviewersSuggested = inferReviewers(summary);

    const contextLines = [
      t(language, `Alcance analizado: ${formatScope(diff.scope, language)}.`, `Scope analyzed: ${formatScope(diff.scope, language)}.`),
      t(
        language,
        `Tamano del diff: ${summary.changedFiles} archivos (+${summary.additions}/-${summary.deletions}).`,
        `Diff size: ${summary.changedFiles} files (+${summary.additions}/-${summary.deletions}).`
      ),
      t(
        language,
        "Esta propuesta no ejecuta acciones Git (commit/push) de forma automatica.",
        "This proposal does not execute Git actions (commit/push) automatically."
      )
    ];
    const highlights = buildHighlights(diff.files, maxHighlights, language);
    const testingLines = buildTestingLines(summary, riskReview.risk.recommendedChecks, language);
    const riskLines = includeRiskSection
      ? riskReview.risk.findings.slice(0, 8).map((item) => `- [${item.severity}] ${item.title}: ${item.mitigation}`)
      : [];
    const rollbackLines = includeRollbackPlan
      ? buildRollbackLines(diff.files, language)
      : [];
    const checklistLines = includeChecklist
      ? buildChecklist(summary, riskReview.risk.mustFixBeforeMerge, language)
      : [];

    const sections = {
      context: contextLines,
      highlights,
      testing: testingLines,
      risks: riskLines,
      rollback: rollbackLines,
      checklist: checklistLines
    };
    const markdown = toMarkdown({
      title: inferredTitle,
      sections,
      language
    });

    return outputSchema.parse({
      scope: diff.scope,
      summary: {
        changedFiles: summary.changedFiles,
        additions: summary.additions,
        deletions: summary.deletions,
        touches: summary.touches
      },
      pr: {
        title: inferredTitle,
        labelsSuggested,
        reviewersSuggested,
        sections,
        markdown
      }
    });
  }
};

function inferTitle(diff, language) {
  const touches = diff.summary.touches;
  if (touches.manifest) {
    return t(language, "Actualizar manifest UI5 y wiring runtime", "Update UI5 manifest and runtime wiring");
  }
  if (touches.controllers || touches.views) {
    return t(language, "Ajustar comportamiento de controllers/views UI5", "Adjust UI5 controller/view behavior");
  }
  if (touches.config) {
    return t(language, "Actualizar configuracion de tooling del proyecto", "Update project tooling configuration");
  }
  if (touches.docs && !touches.controllers && !touches.views && !touches.manifest && !touches.config) {
    return t(language, "Actualizar documentacion del proyecto", "Refresh project documentation");
  }
  return t(language, "Aplicar actualizaciones del proyecto", "Apply project updates");
}

function inferLabels(summary, riskLevel) {
  const labels = new Set();
  if (summary.touches.docs) {
    labels.add("docs");
  }
  if (summary.touches.tests) {
    labels.add("tests");
  }
  if (summary.touches.controllers || summary.touches.views || summary.touches.manifest) {
    labels.add("ui5");
  }
  if (summary.touches.config) {
    labels.add("tooling");
  }
  labels.add(`risk:${riskLevel}`);
  return Array.from(labels);
}

function inferReviewers(summary) {
  const reviewers = new Set();
  if (summary.touches.controllers || summary.touches.views || summary.touches.manifest) {
    reviewers.add("ui5-maintainer");
  }
  if (summary.touches.config) {
    reviewers.add("ci-tooling-owner");
  }
  if (summary.touches.docs) {
    reviewers.add("docs-owner");
  }
  if (reviewers.size === 0) {
    reviewers.add("project-maintainer");
  }
  return Array.from(reviewers);
}

function buildHighlights(files, maxHighlights, language) {
  if (files.length === 0) {
    return [t(language, "No se detectaron archivos cambiados en el alcance seleccionado.", "No changed files detected in selected scope.")];
  }
  return files.slice(0, maxHighlights).map((item) => {
    return `${item.path} (${item.status}, +${item.additions}/-${item.deletions})`;
  });
}

function buildTestingLines(summary, recommendedChecks, language) {
  const lines = [];
  if (summary.touches.controllers || summary.touches.views || summary.touches.manifest) {
    lines.push(t(language, "Ejecuta smoke tests de regresion UI en pantallas/rutas impactadas.", "Run UI regression smoke flows for impacted screens/routes."));
  }
  if ((summary.touches.controllers || summary.touches.views || summary.touches.manifest || summary.touches.config) && !summary.touches.tests) {
    lines.push(t(language, "Anade o actualiza tests focalizados para el comportamiento cambiado.", "Add or update targeted tests for changed behavior."));
  }
  for (const command of recommendedChecks) {
    lines.push(t(language, `Ejecuta \`${command}\`.`, `Run \`${command}\`.`));
  }
  if (lines.length === 0) {
    lines.push(t(language, "Ejecuta checks baseline del proyecto antes de mergear.", "Run baseline project checks before merge."));
  }
  return unique(lines);
}

function buildRollbackLines(files, language) {
  const impacted = files.slice(0, 5).map((item) => item.path);
  if (impacted.length === 0) {
    return [t(language, "No se requiere plan de rollback porque no se detectaron cambios.", "No rollback plan required because no changes were detected.")];
  }
  return [
    t(language, "Revierte el commit del PR si se detecta regresion.", "Revert this PR commit if regression is detected."),
    t(language, `Valida rutas de rollback para: ${impacted.join(", ")}.`, `Validate rollback paths for: ${impacted.join(", ")}.`),
    t(language, "Re-ejecuta `npm run check` tras el rollback.", "Re-run `npm run check` after rollback.")
  ];
}

function buildChecklist(summary, mustFixBeforeMerge, language) {
  const checklist = [
    t(language, "[ ] He validado manualmente los flujos impactados.", "[ ] I validated impacted flows manually."),
    t(language, "[ ] He ejecutado los checks de calidad requeridos (`npm run check`).", "[ ] I ran the required quality checks (`npm run check`)."),
    t(language, "[ ] He confirmado que no se suben credenciales/secretos.", "[ ] I confirmed no credentials/secrets are committed.")
  ];
  if (summary.changedFiles > 30) {
    checklist.push(t(language, "[ ] He considerado dividir este trabajo en PRs mas pequenos.", "[ ] I considered splitting this work into smaller PR slices."));
  }
  if (mustFixBeforeMerge.length > 0) {
    checklist.push(
      t(
        language,
        `[ ] He resuelto los riesgos obligatorios: ${mustFixBeforeMerge.join(", ")}.`,
        `[ ] I resolved required risk items: ${mustFixBeforeMerge.join(", ")}.`
      )
    );
  }
  return checklist;
}

function toMarkdown(input) {
  const lines = [];
  lines.push(`# ${input.title}`);
  lines.push("");
  lines.push(t(input.language, "## Contexto", "## Context"));
  lines.push(...input.sections.context.map((line) => `- ${line}`));
  lines.push("");
  lines.push(t(input.language, "## Cambios Principales", "## Main Changes"));
  lines.push(...input.sections.highlights.map((line) => `- ${line}`));
  lines.push("");
  lines.push(t(input.language, "## Pruebas", "## Testing"));
  lines.push(...input.sections.testing.map((line) => `- ${line}`));

  if (input.sections.risks.length > 0) {
    lines.push("");
    lines.push(t(input.language, "## Riesgos", "## Risks"));
    lines.push(...input.sections.risks);
  }

  if (input.sections.rollback.length > 0) {
    lines.push("");
    lines.push("## Rollback");
    lines.push(...input.sections.rollback.map((line) => `- ${line}`));
  }

  if (input.sections.checklist.length > 0) {
    lines.push("");
    lines.push(t(input.language, "## Checklist", "## Checklist"));
    lines.push(...input.sections.checklist.map((line) => `- ${line}`));
  }

  return lines.join("\n");
}

function formatScope(scope, language) {
  if (scope.mode === "range") {
    return `range ${scope.baseRef ?? "?"}...${scope.targetRef ?? "HEAD"}`;
  }
  return scope.mode === "working_tree"
    ? t(language, "working_tree", "working_tree")
    : scope.mode;
}

function unique(items) {
  return Array.from(new Set(items));
}
