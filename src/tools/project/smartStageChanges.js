import { z } from "zod";
import { analyzeGitDiffTool } from "./analyzeGitDiff.js";
import { auditGitWorktreeStateTool } from "./auditGitWorktreeState.js";
import { resolveLanguage, t } from "../../utils/language.js";

const DIFF_MODES = ["working_tree", "staged", "range"];
const GROUP_RISKS = ["low", "medium", "high"];

const inputSchema = z.object({
  mode: z.enum(DIFF_MODES).optional(),
  baseRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  includeUntracked: z.boolean().optional(),
  language: z.enum(["es", "en"]).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxGroups: z.number().int().min(2).max(20).optional()
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
    stagedChanges: z.number().int().nonnegative(),
    unstagedChanges: z.number().int().nonnegative(),
    untrackedFiles: z.number().int().nonnegative()
  }),
  stagingPlan: z.object({
    strategy: z.string(),
    groups: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        rationale: z.string(),
        risk: z.enum(GROUP_RISKS),
        files: z.array(z.string()),
        suggestedAddCommand: z.string().nullable()
      })
    ),
    warnings: z.array(z.string())
  }),
  automationPolicy: z.object({
    appliesGitAdd: z.boolean(),
    requiresExplicitUserConsent: z.boolean(),
    note: z.string()
  })
});

export const smartStageChangesTool = {
  name: "smart_stage_changes",
  description: "Suggest a non-destructive logical staging plan (grouped git add commands) from the current diff.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const maxGroups = parsed.maxGroups ?? 8;
    const [diff, audit] = await Promise.all([
      analyzeGitDiffTool.handler(
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
      ),
      auditGitWorktreeStateTool.handler(
        {
          includeUntracked: parsed.includeUntracked,
          language: parsed.language,
          maxFiles: parsed.maxFiles,
          timeoutMs: parsed.timeoutMs
        },
        { context }
      )
    ]);

    const warnings = [];
    if (!diff.repository.gitAvailable) {
      warnings.push(t(language, "Git no esta disponible en este entorno.", "Git is not available in this environment."));
    }
    if (!diff.repository.isGitRepository) {
      warnings.push(t(language, "El workspace no es un repositorio Git.", "Workspace is not a Git repository."));
    }
    if (diff.scope.mode === "range") {
      warnings.push(
        t(
          language,
          "Modo range detectado: se muestra agrupacion conceptual, sin comandos de `git add` ejecutables sobre el worktree.",
          "Range mode detected: plan is conceptual and `git add` commands are not applicable to worktree staging."
        )
      );
    }
    if (diff.summary.byStatus.unmerged > 0) {
      warnings.push(
        t(
          language,
          "Hay conflictos de merge (`unmerged`). Resuelvelos antes de preparar staging fino.",
          "Unmerged conflicts detected. Resolve them before fine-grained staging."
        )
      );
    }

    const groups = buildLogicalGroups(diff.files, language)
      .slice(0, maxGroups)
      .map((group) => ({
        ...group,
        suggestedAddCommand: diff.scope.mode === "range"
          ? null
          : buildAddCommand(group.files)
      }));

    if (groups.length === 0) {
      groups.push({
        id: "no-changes",
        title: t(language, "Sin cambios", "No changes"),
        rationale: t(language, "No hay cambios para generar plan de staging.", "No changes available to build staging plan."),
        risk: "low",
        files: [],
        suggestedAddCommand: null
      });
    }

    return outputSchema.parse({
      scope: diff.scope,
      summary: {
        changedFiles: diff.summary.changedFiles,
        additions: diff.summary.additions,
        deletions: diff.summary.deletions,
        stagedChanges: audit.workingTree.stagedChanges,
        unstagedChanges: audit.workingTree.unstagedChanges,
        untrackedFiles: audit.workingTree.untrackedFiles
      },
      stagingPlan: {
        strategy: t(
          language,
          "Agrupacion por intencion de cambio (runtime, manifest/config, tests, docs, i18n, misc).",
          "Grouping by change intent (runtime, manifest/config, tests, docs, i18n, misc)."
        ),
        groups,
        warnings
      },
      automationPolicy: {
        appliesGitAdd: false,
        requiresExplicitUserConsent: true,
        note: t(
          language,
          "Esta tool solo sugiere agrupaciones y comandos. Nunca aplica `git add` automaticamente.",
          "This tool only suggests grouping and commands. It never applies `git add` automatically."
        )
      }
    });
  }
};

function buildLogicalGroups(files, language) {
  const buckets = new Map();
  for (const file of files) {
    const bucketId = classifyFile(file.path);
    const bucket = buckets.get(bucketId) ?? createBucket(bucketId, language);
    bucket.files.push(file.path);
    buckets.set(bucketId, bucket);
  }

  const order = ["ui5-runtime", "manifest-config", "tests", "i18n", "docs", "misc"];
  return order
    .map((id) => buckets.get(id))
    .filter(Boolean)
    .map((bucket) => ({
      id: bucket.id,
      title: bucket.title,
      rationale: bucket.rationale,
      risk: bucket.risk,
      files: bucket.files.sort((a, b) => a.localeCompare(b))
    }));
}

function classifyFile(relativePath) {
  const normalized = relativePath.toLowerCase();
  if (
    normalized.includes("/controller/")
    || normalized.includes("/view/")
    || normalized.endsWith(".fragment.xml")
    || normalized.endsWith("component.js")
  ) {
    return "ui5-runtime";
  }
  if (
    normalized === "webapp/manifest.json"
    || normalized.endsWith("/manifest.json")
    || normalized === "package.json"
    || normalized === "package-lock.json"
    || normalized === "ui5.yaml"
    || normalized === "eslint.config.js"
    || normalized === "vitest.config.js"
    || normalized.startsWith(".github/workflows/")
  ) {
    return "manifest-config";
  }
  if (
    normalized.startsWith("test/")
    || normalized.includes(".test.")
    || normalized.includes(".spec.")
    || normalized.includes("__tests__/")
  ) {
    return "tests";
  }
  if (normalized.includes("/i18n/") || normalized.endsWith(".properties")) {
    return "i18n";
  }
  if (normalized.startsWith("docs/") || normalized.endsWith(".md")) {
    return "docs";
  }
  return "misc";
}

function createBucket(id, language) {
  if (id === "ui5-runtime") {
    return {
      id,
      title: t(language, "Runtime UI5", "UI5 Runtime"),
      rationale: t(language, "Cambios funcionales en controllers/views/componentes UI5.", "Functional changes in UI5 controllers/views/components."),
      risk: "high",
      files: []
    };
  }
  if (id === "manifest-config") {
    return {
      id,
      title: t(language, "Manifest y Configuracion", "Manifest and Configuration"),
      rationale: t(language, "Cambios de routing, modelos o tooling del proyecto.", "Routing, model, or project tooling changes."),
      risk: "high",
      files: []
    };
  }
  if (id === "tests") {
    return {
      id,
      title: t(language, "Pruebas", "Tests"),
      rationale: t(language, "Cobertura y validaciones automatizadas.", "Coverage and automated validations."),
      risk: "low",
      files: []
    };
  }
  if (id === "i18n") {
    return {
      id,
      title: t(language, "i18n", "i18n"),
      rationale: t(language, "Ajustes de localizacion y claves de texto.", "Localization and text-key adjustments."),
      risk: "medium",
      files: []
    };
  }
  if (id === "docs") {
    return {
      id,
      title: t(language, "Documentacion", "Documentation"),
      rationale: t(language, "Cambios de documentacion y guias.", "Documentation and guide changes."),
      risk: "low",
      files: []
    };
  }
  return {
    id,
    title: t(language, "Miscelanea", "Misc"),
    rationale: t(language, "Archivos no clasificados en grupos principales.", "Files not classified in primary groups."),
    risk: "medium",
    files: []
  };
}

function buildAddCommand(files) {
  if (files.length === 0) {
    return null;
  }
  const quoted = files.map((file) => `"${file.replaceAll("\"", "\\\"")}"`);
  return `git add -- ${quoted.join(" ")}`;
}
