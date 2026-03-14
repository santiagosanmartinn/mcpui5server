import { z } from "zod";
import { analyzeGitDiffTool } from "./analyzeGitDiff.js";
import { resolveLanguage, t } from "../../utils/language.js";

const DIFF_MODES = ["working_tree", "staged", "range"];
const COMMIT_STYLES = ["conventional", "plain"];
const COMMIT_TYPES = ["feat", "fix", "refactor", "docs", "test", "chore"];

const inputSchema = z.object({
  mode: z.enum(DIFF_MODES).optional(),
  baseRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  includeUntracked: z.boolean().optional(),
  language: z.enum(["es", "en"]).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  style: z.enum(COMMIT_STYLES).optional(),
  type: z.enum(COMMIT_TYPES).optional(),
  scope: z.string().regex(/^[a-z0-9._/-]+$/i).max(40).optional(),
  includeBody: z.boolean().optional(),
  maxSubjectLength: z.number().int().min(50).max(120).optional()
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
    deletions: z.number().int().nonnegative()
  }),
  commit: z.object({
    type: z.enum(COMMIT_TYPES),
    scope: z.string().nullable(),
    style: z.enum(COMMIT_STYLES),
    subject: z.string(),
    bodyLines: z.array(z.string()),
    fullMessage: z.string()
  }),
  rationale: z.array(z.string())
});

export const generateCommitMessageFromDiffTool = {
  name: "generate_commit_message_from_diff",
  description: "Generate a commit message proposal from Git diff impact (conventional or plain style).",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const style = parsed.style ?? "conventional";
    const includeBody = parsed.includeBody ?? true;
    const maxSubjectLength = parsed.maxSubjectLength ?? 72;
    const diffAnalysis = await analyzeGitDiffTool.handler(
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
    );
    const summary = diffAnalysis.summary;
    const scopeData = diffAnalysis.scope;

    if (!diffAnalysis.repository.gitAvailable || !diffAnalysis.repository.isGitRepository || summary.changedFiles === 0) {
      const type = parsed.type ?? "chore";
      const subject = style === "conventional"
        ? t(language, `${type}: no se detectaron cambios pendientes`, `${type}: no pending changes detected`)
        : t(language, "No se detectaron cambios pendientes", "No pending changes detected");
      return outputSchema.parse({
        scope: scopeData,
        summary: {
          changedFiles: summary.changedFiles,
          additions: summary.additions,
          deletions: summary.deletions
        },
        commit: {
          type,
          scope: parsed.scope ?? null,
          style,
          subject,
          bodyLines: [],
          fullMessage: subject
        },
        rationale: [
          !diffAnalysis.repository.gitAvailable
            ? t(language, "Git no esta disponible.", "Git is not available.")
            : !diffAnalysis.repository.isGitRepository
              ? t(language, "El workspace no es un repositorio Git.", "Workspace is not a Git repository.")
              : t(language, "No se detectaron cambios para el alcance seleccionado.", "No diff detected for selected scope.")
        ]
      });
    }

    const inferredType = parsed.type ?? inferType(summary);
    const inferredScope = parsed.scope ?? inferScope(summary);
    const subjectPhrase = inferSubjectPhrase(summary, language);
    const subject = buildSubject({
      type: inferredType,
      scope: inferredScope,
      style,
      phrase: subjectPhrase,
      maxSubjectLength
    });
    const bodyLines = includeBody
      ? buildBodyLines(summary, diffAnalysis.files, language)
      : [];
    const fullMessage = bodyLines.length > 0
      ? `${subject}\n\n${bodyLines.join("\n")}`
      : subject;

    return outputSchema.parse({
      scope: scopeData,
      summary: {
        changedFiles: summary.changedFiles,
        additions: summary.additions,
        deletions: summary.deletions
      },
      commit: {
        type: inferredType,
        scope: inferredScope,
        style,
        subject,
        bodyLines,
        fullMessage
      },
      rationale: buildRationale(summary, inferredType, inferredScope, language)
    });
  }
};

function inferType(summary) {
  const { touches, byStatus } = summary;
  const docsOnly = touches.docs
    && !touches.tests
    && !touches.controllers
    && !touches.views
    && !touches.manifest
    && !touches.i18n
    && !touches.config;
  if (docsOnly) {
    return "docs";
  }

  const testsOnly = touches.tests
    && !touches.docs
    && !touches.controllers
    && !touches.views
    && !touches.manifest
    && !touches.i18n
    && !touches.config;
  if (testsOnly) {
    return "test";
  }

  if (touches.config && !touches.controllers && !touches.views && !touches.manifest) {
    return "chore";
  }

  if (byStatus.added > 0 && summary.additions >= summary.deletions) {
    return "feat";
  }

  if (byStatus.deleted > 0 || summary.deletions > summary.additions) {
    return "refactor";
  }

  return "fix";
}

function inferScope(summary) {
  const { touches } = summary;
  if (touches.manifest) {
    return "manifest";
  }
  if (touches.controllers || touches.views) {
    return "ui5";
  }
  if (touches.i18n) {
    return "i18n";
  }
  if (touches.config) {
    return "tooling";
  }
  if (touches.docs) {
    return "docs";
  }
  if (touches.tests) {
    return "tests";
  }
  return null;
}

function inferSubjectPhrase(summary, language) {
  const { touches } = summary;
  if (touches.manifest) {
    return t(language, "actualiza routing y configuracion de modelos en manifest", "update manifest routing and model setup");
  }
  if (touches.controllers && touches.views) {
    return t(language, "actualiza controllers y views de ui5", "update ui5 controllers and views");
  }
  if (touches.controllers) {
    return t(language, "actualiza logica de controller ui5", "update ui5 controller logic");
  }
  if (touches.views) {
    return t(language, "actualiza views y bindings de ui5", "update ui5 views and bindings");
  }
  if (touches.i18n) {
    return t(language, "actualiza recursos i18n", "refresh i18n resources");
  }
  if (touches.config) {
    return t(language, "ajusta tooling y configuracion del proyecto", "adjust tooling and project configuration");
  }
  if (touches.docs) {
    return t(language, "actualiza documentacion mcp", "refresh mcp documentation");
  }
  if (touches.tests) {
    return t(language, "amplia cobertura de tests automatizados", "expand automated test coverage");
  }
  return t(language, "aplica actualizaciones del proyecto", "apply project updates");
}

function buildSubject(input) {
  const { type, scope, style, phrase, maxSubjectLength } = input;
  const base = style === "conventional"
    ? `${type}${scope ? `(${scope})` : ""}: ${phrase}`
    : `${capitalize(type)}: ${phrase}`;
  if (base.length <= maxSubjectLength) {
    return base;
  }
  return `${base.slice(0, maxSubjectLength - 3).trimEnd()}...`;
}

function buildBodyLines(summary, files, language) {
  const lines = [];
  lines.push(
    t(
      language,
      `- Archivos cambiados: ${summary.changedFiles} (+${summary.additions}/-${summary.deletions})`,
      `- Files changed: ${summary.changedFiles} (+${summary.additions}/-${summary.deletions})`
    )
  );
  lines.push(
    t(
      language,
      `- Estado: A=${summary.byStatus.added}, M=${summary.byStatus.modified}, D=${summary.byStatus.deleted}, R=${summary.byStatus.renamed}, U=${summary.byStatus.unmerged}`,
      `- Status: A=${summary.byStatus.added}, M=${summary.byStatus.modified}, D=${summary.byStatus.deleted}, R=${summary.byStatus.renamed}, U=${summary.byStatus.unmerged}`
    )
  );

  const topFiles = files.slice(0, 5).map((item) => item.path);
  if (topFiles.length > 0) {
    lines.push(
      t(
        language,
        `- Archivos impactados: ${topFiles.join(", ")}`,
        `- Impacted files: ${topFiles.join(", ")}`
      )
    );
  }

  if ((summary.touches.controllers || summary.touches.views || summary.touches.manifest || summary.touches.config) && !summary.touches.tests) {
    lines.push(
      t(
        language,
        "- Nota: se cambio codigo/configuracion sin actualizar tests.",
        "- Note: code/config changed without test updates."
      )
    );
  }

  return lines;
}

function buildRationale(summary, type, scope, language) {
  const rationale = [
    t(
      language,
      `Tipo inferido como \`${type}\` segun estado/tipo de cambios del diff.`,
      `Type inferred as \`${type}\` from diff status/touch profile.`
    ),
    t(
      language,
      `Scope inferido como \`${scope ?? "none"}\`.`,
      `Scope inferred as \`${scope ?? "none"}\`.`
    ),
    t(
      language,
      `Tamano del diff: ${summary.changedFiles} archivos (+${summary.additions}/-${summary.deletions}).`,
      `Diff size: ${summary.changedFiles} files (+${summary.additions}/-${summary.deletions}).`
    )
  ];
  if (summary.touches.manifest) {
    rationale.push(
      t(
        language,
        "Se detectaron cambios en manifest, por eso se priorizo impacto en compatibilidad y routing.",
        "Manifest changes detected, so compatibility and routing impact were prioritized."
      )
    );
  }
  if (summary.touches.controllers || summary.touches.views) {
    rationale.push(
      t(
        language,
        "Se cambiaron archivos de comportamiento UI (controllers/views).",
        "UI behavior files changed (controllers/views)."
      )
    );
  }
  if (summary.touches.docs && !summary.touches.tests) {
    rationale.push(
      t(
        language,
        "Se toco documentacion; considera un check rapido de consistencia.",
        "Documentation touched; consider quick docs consistency check."
      )
    );
  }
  return rationale;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
