import { z } from "zod";
import { fileExists, readJsonFile } from "../../utils/fileSystem.js";
import { ensureProjectMcpCurrentTool } from "./ensureProjectMcpCurrent.js";
import { collectLegacyProjectIntakeTool } from "./collectLegacyProjectIntake.js";
import { analyzeLegacyProjectBaselineTool } from "./analyzeLegacyProjectBaseline.js";
import { buildAiContextIndexTool } from "./buildAiContextIndex.js";

const DEFAULT_SOURCE_DIR = "webapp";
const DEFAULT_INTAKE_PATH = ".codex/mcp/project/intake.json";
const DEFAULT_BASELINE_PATH = ".codex/mcp/project/legacy-baseline.json";
const DEFAULT_CONTEXT_INDEX_PATH = ".codex/mcp/context/context-index.json";

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  autoApply: z.boolean().optional(),
  runEnsureProjectMcp: z.boolean().optional(),
  ensureAutoApply: z.boolean().optional(),
  includeVscodeMcp: z.boolean().optional(),
  allowOverwrite: z.boolean().optional(),
  askForMissingContext: z.boolean().optional(),
  refreshBaseline: z.boolean().optional(),
  refreshContextIndex: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional()
}).strict();

const outputSchema = z.object({
  autoApply: z.boolean(),
  sourceDir: z.string(),
  ensure: z.object({
    executed: z.boolean(),
    actionTaken: z.enum(["none", "upgrade-dry-run", "upgrade-applied"]).nullable(),
    statusBefore: z.enum(["up-to-date", "needs-upgrade", "not-initialized"]).nullable(),
    statusAfter: z.enum(["up-to-date", "needs-upgrade", "not-initialized"]).nullable()
  }),
  artifactsBefore: z.object({
    intake: z.boolean(),
    baseline: z.boolean(),
    contextIndex: z.boolean()
  }),
  artifactsAfter: z.object({
    intake: z.boolean(),
    baseline: z.boolean(),
    contextIndex: z.boolean()
  }),
  ran: z.object({
    collectIntake: z.boolean(),
    analyzeBaseline: z.boolean(),
    buildContextIndex: z.boolean()
  }),
  intake: z.object({
    needsUserInput: z.boolean(),
    missingContext: z.array(z.string()),
    questions: z.array(
      z.object({
        id: z.string(),
        question: z.string(),
        why: z.string()
      })
    )
  }),
  changed: z.object({
    intake: z.boolean(),
    baseline: z.boolean(),
    contextIndex: z.boolean()
  }),
  readyForAutopilot: z.boolean(),
  nextActions: z.array(z.string())
});

export const prepareLegacyProjectForAiTool = {
  name: "prepare_legacy_project_for_ai",
  description: "Prepare a legacy/existing project for high-quality AI delivery by orchestrating ensure, intake, baseline, and context index steps.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      autoApply,
      runEnsureProjectMcp,
      ensureAutoApply,
      includeVscodeMcp,
      allowOverwrite,
      askForMissingContext,
      refreshBaseline,
      refreshContextIndex,
      reason,
      maxDiffLines
    } = inputSchema.parse(args);

    const root = context.rootDir;
    const selectedSourceDir = normalizePath(sourceDir ?? DEFAULT_SOURCE_DIR);
    const shouldAutoApply = autoApply ?? true;
    const shouldRunEnsureProjectMcp = runEnsureProjectMcp ?? true;
    const shouldEnsureAutoApply = ensureAutoApply ?? shouldAutoApply;
    const shouldAskForMissingContext = askForMissingContext ?? true;
    const shouldRefreshBaseline = refreshBaseline ?? false;
    const shouldRefreshContextIndex = refreshContextIndex ?? false;

    const artifactsBefore = await readArtifactsExistence(root);

    let ensure = {
      executed: false,
      actionTaken: null,
      statusBefore: null,
      statusAfter: null
    };
    if (shouldRunEnsureProjectMcp) {
      const ensureResult = await ensureProjectMcpCurrentTool.handler(
        {
          autoApply: shouldEnsureAutoApply,
          allowOverwrite,
          includeVscodeMcp,
          runPostValidation: true,
          failOnValidation: false,
          runQualityGate: false,
          reason: reason ?? "prepare_legacy_project_for_ai:ensure"
        },
        { context }
      );
      ensure = {
        executed: true,
        actionTaken: ensureResult.actionTaken,
        statusBefore: ensureResult.statusBefore,
        statusAfter: ensureResult.statusAfter
      };
    }

    const existingMissingContext = await readExistingMissingContext(root);
    let intake = {
      needsUserInput: existingMissingContext.length > 0,
      missingContext: existingMissingContext,
      questions: buildMissingContextQuestions(existingMissingContext)
    };
    let changed = {
      intake: false,
      baseline: false,
      contextIndex: false
    };
    let ran = {
      collectIntake: false,
      analyzeBaseline: false,
      buildContextIndex: false
    };

    if (!artifactsBefore.intake) {
      ran.collectIntake = true;
      const intakeResult = await collectLegacyProjectIntakeTool.handler(
        {
          dryRun: !shouldAutoApply,
          askForMissingContext: shouldAskForMissingContext,
          reason: reason ?? "prepare_legacy_project_for_ai:intake",
          maxDiffLines
        },
        { context }
      );
      changed.intake = intakeResult.changed;
      intake = {
        needsUserInput: intakeResult.needsUserInput,
        missingContext: intakeResult.missingContext,
        questions: intakeResult.questions
      };
    }

    if (shouldRefreshBaseline || !artifactsBefore.baseline || ran.collectIntake) {
      ran.analyzeBaseline = true;
      const baselineResult = await analyzeLegacyProjectBaselineTool.handler(
        {
          sourceDir: selectedSourceDir,
          dryRun: !shouldAutoApply,
          reason: reason ?? "prepare_legacy_project_for_ai:baseline",
          maxDiffLines
        },
        { context }
      );
      changed.baseline = baselineResult.changed;
    }

    if (shouldRefreshContextIndex || !artifactsBefore.contextIndex || ran.analyzeBaseline) {
      ran.buildContextIndex = true;
      const contextIndexResult = await buildAiContextIndexTool.handler(
        {
          sourceDir: selectedSourceDir,
          dryRun: !shouldAutoApply,
          reason: reason ?? "prepare_legacy_project_for_ai:context-index",
          maxDiffLines
        },
        { context }
      );
      changed.contextIndex = contextIndexResult.changed;
    }

    const artifactsAfter = await readArtifactsExistence(root);
    const readyForAutopilot = artifactsAfter.intake
      && artifactsAfter.baseline
      && artifactsAfter.contextIndex
      && !intake.needsUserInput;

    const nextActions = [];
    if (intake.needsUserInput) {
      nextActions.push("Complete missing intake context fields before broad refactors.");
    }
    if (!artifactsAfter.baseline) {
      nextActions.push("Run analyze_legacy_project_baseline to produce technical baseline artifacts.");
    }
    if (!artifactsAfter.contextIndex) {
      nextActions.push("Run build_ai_context_index to create token-efficient retrieval context.");
    }
    if (ensure.executed && ensure.statusAfter === "needs-upgrade") {
      nextActions.push("Apply ensure_project_mcp_current with autoApply=true to align MCP managed layout.");
    }

    return outputSchema.parse({
      autoApply: shouldAutoApply,
      sourceDir: selectedSourceDir,
      ensure,
      artifactsBefore,
      artifactsAfter,
      ran,
      intake,
      changed,
      readyForAutopilot,
      nextActions: unique(nextActions)
    });
  }
};

async function readArtifactsExistence(root) {
  return {
    intake: await fileExists(DEFAULT_INTAKE_PATH, root),
    baseline: await fileExists(DEFAULT_BASELINE_PATH, root),
    contextIndex: await fileExists(DEFAULT_CONTEXT_INDEX_PATH, root)
  };
}

async function readExistingMissingContext(root) {
  if (!(await fileExists(DEFAULT_INTAKE_PATH, root))) {
    return ["projectGoal", "criticality", "allowedRefactorScope"];
  }
  try {
    const json = await readJsonFile(DEFAULT_INTAKE_PATH, root);
    if (!Array.isArray(json?.missingContext)) {
      return [];
    }
    return unique(json.missingContext.map((item) => String(item).trim()).filter(Boolean));
  } catch {
    return ["projectGoal", "criticality", "allowedRefactorScope"];
  }
}

function buildMissingContextQuestions(missingContext) {
  const questionMap = {
    projectGoal: {
      id: "projectGoal",
      question: "Cual es el objetivo principal que debe priorizar la IA?",
      why: "Permite orientar decisiones tecnicas al resultado de negocio esperado."
    },
    criticality: {
      id: "criticality",
      question: "Que criticidad tiene el proyecto (low/medium/high/regulated)?",
      why: "Ajusta el nivel de rigor para validaciones y seguridad."
    },
    allowedRefactorScope: {
      id: "allowedRefactorScope",
      question: "Que alcance de refactor esta permitido (minimal/incremental/broad)?",
      why: "Evita propuestas fuera del margen de cambio aceptado."
    },
    ui5RuntimeVersion: {
      id: "ui5RuntimeVersion",
      question: "Que version UI5 real corre en runtime?",
      why: "Evita recomendar controles/APIs incompatibles con el entorno."
    }
  };
  return missingContext
    .map((id) => questionMap[id] ?? null)
    .filter(Boolean);
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function unique(values) {
  return Array.from(new Set(values));
}
