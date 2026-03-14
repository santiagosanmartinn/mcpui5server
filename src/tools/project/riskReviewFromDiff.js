import { z } from "zod";
import { analyzeGitDiffTool } from "./analyzeGitDiff.js";
import { resolveLanguage, t } from "../../utils/language.js";

const DIFF_MODES = ["working_tree", "staged", "range"];
const RISK_LEVELS = ["low", "medium", "high", "critical"];
const SEVERITIES = ["low", "medium", "high"];

const inputSchema = z.object({
  mode: z.enum(DIFF_MODES).optional(),
  baseRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
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

const findingSchema = z.object({
  id: z.string(),
  severity: z.enum(SEVERITIES),
  category: z.enum(["scope", "testing", "runtime", "configuration", "workflow"]),
  title: z.string(),
  description: z.string(),
  files: z.array(z.string()),
  mitigation: z.string()
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
  risk: z.object({
    score: z.number().int().min(0).max(100),
    level: z.enum(RISK_LEVELS),
    findings: z.array(findingSchema),
    mustFixBeforeMerge: z.array(z.string()),
    recommendedChecks: z.array(z.string())
  })
});

export const riskReviewFromDiffTool = {
  name: "risk_review_from_diff",
  description: "Review Git diff risk profile and return prioritized findings with mitigation guidance before merge.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const diffAnalysis = await analyzeGitDiffTool.handler(parsed, { context });
    const summary = diffAnalysis.summary;
    const files = diffAnalysis.files;
    const findings = [];
    const recommendedChecks = new Set();
    let score = 0;

    if (!diffAnalysis.repository.gitAvailable || !diffAnalysis.repository.isGitRepository) {
      findings.push({
        id: "git-context-missing",
        severity: "medium",
        category: "workflow",
        title: t(language, "Contexto Git no disponible", "Git context unavailable"),
        description: t(
          language,
          "No se detecto repositorio Git, por lo que no se puede evaluar el riesgo del cambio con evidencia de diff.",
          "No Git repository was detected, so change risk cannot be assessed with diff evidence."
        ),
        files: [],
        mitigation: t(language, "Inicializa Git y vuelve a ejecutar la revision de riesgo antes del merge.", "Initialize Git and rerun risk review before merge.")
      });
      return outputSchema.parse({
        scope: diffAnalysis.scope,
        summary: {
          changedFiles: 0,
          additions: 0,
          deletions: 0,
          touches: summary.touches
        },
        risk: {
          score: 35,
          level: "medium",
          findings,
          mustFixBeforeMerge: ["git-context-missing"],
          recommendedChecks: ["git init", "npm run check"]
        }
      });
    }

    if (summary.changedFiles >= 120) {
      score += 25;
      findings.push({
        id: "diff-too-large",
        severity: "high",
        category: "scope",
        title: t(language, "Diff grande detectado", "Large diff detected"),
        description: t(
          language,
          `El diff toca ${summary.changedFiles} archivos, lo que aumenta riesgo de revision y regresion.`,
          `The diff touches ${summary.changedFiles} files, which raises review and regression risk.`
        ),
        files: files.slice(0, 20).map((item) => item.path),
        mitigation: t(language, "Divide este trabajo en commits o PRs mas pequenos antes de mergear.", "Split this work into smaller commits or PR slices before merge.")
      });
    } else if (summary.changedFiles >= 40) {
      score += 15;
      findings.push({
        id: "diff-medium-large",
        severity: "medium",
        category: "scope",
        title: t(language, "Diff medio-grande", "Medium-large diff"),
        description: t(
          language,
          `El diff incluye ${summary.changedFiles} archivos y debe revisarse con especial cuidado.`,
          `The diff includes ${summary.changedFiles} files and should be reviewed with extra care.`
        ),
        files: files.slice(0, 15).map((item) => item.path),
        mitigation: t(language, "Prioriza archivos de alto riesgo y ejecuta checks de regresion focalizados.", "Prioritize high-risk files and run focused regression checks.")
      });
    }

    if (summary.additions + summary.deletions >= 1500) {
      score += 20;
      findings.push({
        id: "high-churn",
        severity: "high",
        category: "scope",
        title: t(language, "Alto churn de lineas", "High line churn"),
        description: t(
          language,
          `El churn total es +${summary.additions}/-${summary.deletions}, aumentando la probabilidad de regresion.`,
          `Total churn is +${summary.additions}/-${summary.deletions}, increasing regression probability.`
        ),
        files: files.slice(0, 20).map((item) => item.path),
        mitigation: t(language, "Ejecuta validacion completa y solicita una revision mas amplia.", "Run full validation and request broader review coverage.")
      });
    } else if (summary.additions + summary.deletions >= 500) {
      score += 10;
      findings.push({
        id: "moderate-churn",
        severity: "medium",
        category: "scope",
        title: t(language, "Churn moderado de lineas", "Moderate line churn"),
        description: t(language, `El churn total es +${summary.additions}/-${summary.deletions}.`, `Total churn is +${summary.additions}/-${summary.deletions}.`),
        files: files.slice(0, 10).map((item) => item.path),
        mitigation: t(language, "Ejecuta tests focalizados sobre modulos impactados.", "Run focused tests around impacted modules.")
      });
    }

    if (summary.byStatus.unmerged > 0) {
      score += 40;
      findings.push({
        id: "merge-conflicts-present",
        severity: "high",
        category: "workflow",
        title: t(language, "Conflictos de merge sin resolver", "Merge conflicts unresolved"),
        description: t(language, "Hay archivos sin mergear en el working tree.", "Unmerged files are present in the working tree."),
        files: files.filter((item) => item.status === "unmerged").map((item) => item.path),
        mitigation: t(language, "Resuelve todos los conflictos de merge antes de validar y mergear.", "Resolve all merge conflicts before validation and merge.")
      });
    }

    if ((summary.touches.controllers || summary.touches.views || summary.touches.manifest || summary.touches.config) && !summary.touches.tests) {
      score += 20;
      findings.push({
        id: "code-without-tests",
        severity: "high",
        category: "testing",
        title: t(language, "Codigo/configuracion cambiado sin actualizar tests", "Code/config changed without test updates"),
        description: t(
          language,
          "Se cambiaron superficies de comportamiento, pero no se actualizaron archivos de test en este diff.",
          "Behavioral surfaces changed but no test files were updated in this diff."
        ),
        files: files
          .filter((item) => isRuntimeOrConfigFile(item.path))
          .slice(0, 20)
          .map((item) => item.path),
        mitigation: t(language, "Anade o actualiza tests focalizados antes de mergear.", "Add or update targeted tests before merge.")
      });
      recommendedChecks.add("npm run test:run");
    }

    if (summary.touches.manifest) {
      score += 15;
      findings.push({
        id: "manifest-impact",
        severity: "high",
        category: "configuration",
        title: t(language, "Impacto por cambios en manifest", "Manifest change impact"),
        description: t(
          language,
          "Los cambios en manifest pueden afectar routing, modelos, bootstrapping y compatibilidad.",
          "Manifest updates can affect routing, models, bootstrapping, and compatibility."
        ),
        files: files
          .filter((item) => item.path.endsWith("/manifest.json") || item.path === "webapp/manifest.json")
          .map((item) => item.path),
        mitigation: t(language, "Ejecuta quality gate UI5 y prueba manualmente la navegacion de la app.", "Run UI5 quality gate and manually smoke-test app navigation.")
      });
      recommendedChecks.add("npm run check");
    }

    if (summary.touches.config) {
      score += 10;
      findings.push({
        id: "tooling-config-change",
        severity: "medium",
        category: "configuration",
        title: t(language, "Cambio en tooling/configuracion", "Tooling/configuration changed"),
        description: t(language, "El comportamiento de CI/tooling puede variar por cambios de configuracion.", "CI/tooling behavior may shift due to config changes."),
        files: files
          .filter((item) => isConfigFile(item.path))
          .slice(0, 15)
          .map((item) => item.path),
        mitigation: t(language, "Ejecuta checks completos en local y verifica paridad con CI.", "Run full checks locally and verify CI parity.")
      });
      recommendedChecks.add("npm run check");
    }

    if ((summary.touches.controllers || summary.touches.views) && summary.changedFiles > 0) {
      score += 10;
      findings.push({
        id: "ui-runtime-surface",
        severity: "medium",
        category: "runtime",
        title: t(language, "Superficie runtime UI afectada", "UI runtime behavior affected"),
        description: t(language, "Los cambios en controller/view pueden introducir regresiones de binding o navegacion.", "Controller/view updates can introduce binding or navigation regressions."),
        files: files
          .filter((item) => isUiRuntimeFile(item.path))
          .slice(0, 20)
          .map((item) => item.path),
        mitigation: t(language, "Ejecuta smoke tests de flujo UI en pantallas impactadas.", "Run UI flow smoke tests for impacted screens.")
      });
    }

    if (summary.byStatus.deleted > 0) {
      score += 8;
      findings.push({
        id: "deleted-files",
        severity: "medium",
        category: "runtime",
        title: t(language, "Archivos eliminados en el diff", "Files removed in diff"),
        description: t(language, "Los archivos eliminados pueden romper imports/routing si quedan referencias.", "Deleted files can break imports/routing if references remain."),
        files: files.filter((item) => item.status === "deleted").slice(0, 20).map((item) => item.path),
        mitigation: t(language, "Valida imports, rutas y referencias muertas antes del merge.", "Validate imports, routes, and dead references before merge.")
      });
    }

    if (summary.changedFiles === 0) {
      findings.push({
        id: "no-changes",
        severity: "low",
        category: "workflow",
        title: t(language, "No se detectaron cambios", "No diff detected"),
        description: t(language, "No se detectaron cambios pendientes para el alcance seleccionado.", "No pending changes were detected for the selected scope."),
        files: [],
        mitigation: t(language, "Selecciona otro alcance de diff si esperabas cambios pendientes.", "Select another diff scope if you expected pending changes.")
      });
    }

    const boundedScore = Math.min(100, Math.max(0, score));
    const level = inferRiskLevel(boundedScore);
    const mustFixBeforeMerge = findings
      .filter((item) => item.id === "merge-conflicts-present" || item.id === "code-without-tests" || item.id === "manifest-impact")
      .map((item) => item.id);

    recommendedChecks.add("npm run check");
    if (summary.touches.controllers || summary.touches.views || summary.touches.manifest) {
      recommendedChecks.add("npm run test:run");
    }

    return outputSchema.parse({
      scope: diffAnalysis.scope,
      summary: {
        changedFiles: summary.changedFiles,
        additions: summary.additions,
        deletions: summary.deletions,
        touches: summary.touches
      },
      risk: {
        score: boundedScore,
        level,
        findings,
        mustFixBeforeMerge,
        recommendedChecks: Array.from(recommendedChecks)
      }
    });
  }
};

function inferRiskLevel(score) {
  if (score >= 75) {
    return "critical";
  }
  if (score >= 45) {
    return "high";
  }
  if (score >= 20) {
    return "medium";
  }
  return "low";
}

function isUiRuntimeFile(filePath) {
  const normalized = filePath.toLowerCase();
  return normalized.includes("/controller/") || normalized.includes("/view/");
}

function isConfigFile(filePath) {
  const normalized = filePath.toLowerCase();
  return normalized === "package.json"
    || normalized === "package-lock.json"
    || normalized === "ui5.yaml"
    || normalized === "eslint.config.js"
    || normalized === "vitest.config.js"
    || normalized.startsWith(".github/workflows/");
}

function isRuntimeOrConfigFile(filePath) {
  const normalized = filePath.toLowerCase();
  return isUiRuntimeFile(filePath)
    || normalized === "webapp/manifest.json"
    || normalized.endsWith("/manifest.json")
    || isConfigFile(filePath);
}
