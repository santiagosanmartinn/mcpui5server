import path from "node:path";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readJsonFile } from "../../utils/fileSystem.js";
import { analyzeUi5ProjectTool } from "../project/analyzeProject.js";

const PROJECT_TYPES = ["sapui5", "node", "generic"];
const CRITICALITY_LEVELS = ["low", "medium", "high", "regulated"];
const REFACTOR_SCOPES = ["minimal", "incremental", "broad"];
const DEFAULT_INTAKE_PATH = ".codex/mcp/project/intake.json";

const inputSchema = z.object({
  intakePath: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional(),
  askForMissingContext: z.boolean().optional(),
  projectGoal: z.string().min(5).max(400).optional(),
  businessDomain: z.string().min(2).max(120).optional(),
  criticality: z.enum(CRITICALITY_LEVELS).optional(),
  runtimeLandscape: z.string().min(2).max(200).optional(),
  ui5RuntimeVersion: z.string().regex(/^\d+\.\d+(\.\d+)?$/).optional(),
  allowedRefactorScope: z.enum(REFACTOR_SCOPES).optional(),
  mustKeepStableAreas: z.array(z.string().min(2).max(160)).max(30).optional(),
  knownPainPoints: z.array(z.string().min(2).max(220)).max(40).optional(),
  constraints: z.array(z.string().min(2).max(220)).max(40).optional(),
  complianceRequirements: z.array(z.string().min(2).max(220)).max(40).optional(),
  notes: z.string().max(1200).optional()
}).strict();

const previewSchema = z.object({
  path: z.string(),
  role: z.literal("legacy-intake"),
  existsBefore: z.boolean(),
  changed: z.boolean(),
  oldHash: z.string().nullable(),
  newHash: z.string(),
  diffPreview: z.string(),
  diffTruncated: z.boolean()
});

const outputSchema = z.object({
  dryRun: z.boolean(),
  changed: z.boolean(),
  intakePath: z.string(),
  project: z.object({
    name: z.string(),
    type: z.enum(PROJECT_TYPES),
    namespace: z.string().nullable(),
    detectedUi5Version: z.string().nullable()
  }),
  qualityPriority: z.boolean(),
  summary: z.object({
    totalContextFields: z.number().int().nonnegative(),
    answeredContextFields: z.number().int().nonnegative(),
    missingContextFields: z.number().int().nonnegative()
  }),
  needsUserInput: z.boolean(),
  missingContext: z.array(z.string()),
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      why: z.string()
    })
  ),
  preview: previewSchema,
  applyResult: z.object({
    patchId: z.string().nullable(),
    appliedAt: z.string(),
    reason: z.string().nullable(),
    changedFiles: z.array(
      z.object({
        path: z.string(),
        changed: z.boolean(),
        oldHash: z.string().nullable(),
        newHash: z.string(),
        bytesBefore: z.number().int().nonnegative(),
        bytesAfter: z.number().int().nonnegative()
      })
    ),
    skippedFiles: z.array(z.string())
  }).nullable()
});

const STORED_INTAKE_SCHEMA = z.object({
  schemaVersion: z.literal("1.0.0"),
  updatedAt: z.string(),
  qualityPriority: z.boolean(),
  project: z.object({
    name: z.string(),
    type: z.enum(PROJECT_TYPES),
    namespace: z.string().nullable(),
    detectedUi5Version: z.string().nullable()
  }),
  context: z.object({
    projectGoal: z.string().nullable(),
    businessDomain: z.string().nullable(),
    criticality: z.enum(CRITICALITY_LEVELS).nullable(),
    runtimeLandscape: z.string().nullable(),
    ui5RuntimeVersion: z.string().nullable(),
    allowedRefactorScope: z.enum(REFACTOR_SCOPES).nullable(),
    mustKeepStableAreas: z.array(z.string()),
    knownPainPoints: z.array(z.string()),
    constraints: z.array(z.string()),
    complianceRequirements: z.array(z.string()),
    notes: z.string().nullable()
  }),
  missingContext: z.array(z.string())
});

export const collectLegacyProjectIntakeTool = {
  name: "collect_legacy_project_intake",
  description: "Collect and persist legacy-project contextual intake to improve AI guidance quality while minimizing repeated prompts/tokens.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      intakePath,
      dryRun,
      reason,
      maxDiffLines,
      askForMissingContext,
      ...providedContext
    } = inputSchema.parse(args);

    const root = context.rootDir;
    const selectedIntakePath = normalizePath(intakePath ?? DEFAULT_INTAKE_PATH);
    const shouldDryRun = dryRun ?? true;
    const shouldAskMissingContext = askForMissingContext ?? true;
    enforceManagedSubtree(selectedIntakePath, ".codex/mcp", "intakePath");

    const projectProfile = await detectProjectProfile(root);
    const existing = await readExistingIntake(selectedIntakePath, root);
    const mergedContext = mergeContext(existing?.context ?? null, providedContext, projectProfile.detectedUi5Version);
    const missingContext = resolveMissingContext(mergedContext, projectProfile.type);
    const nextIntake = STORED_INTAKE_SCHEMA.parse({
      schemaVersion: "1.0.0",
      updatedAt: new Date().toISOString(),
      qualityPriority: true,
      project: projectProfile,
      context: mergedContext,
      missingContext
    });

    const content = `${JSON.stringify(nextIntake, null, 2)}\n`;
    const preview = await previewFileWrite(selectedIntakePath, content, {
      root,
      maxDiffLines
    });

    let applyResult = null;
    if (!shouldDryRun && preview.changed) {
      applyResult = await applyProjectPatch(
        [
          {
            path: selectedIntakePath,
            content,
            expectedOldHash: preview.oldHash ?? undefined
          }
        ],
        {
          root,
          reason: reason ?? "collect_legacy_project_intake"
        }
      );
    }

    const questions = shouldAskMissingContext
      ? buildQuestions(missingContext, projectProfile.type)
      : [];

    const totalContextFields = getTrackedContextFieldCount(mergedContext);
    const answeredContextFields = countAnsweredContextFields(mergedContext);

    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed: preview.changed,
      intakePath: selectedIntakePath,
      project: projectProfile,
      qualityPriority: true,
      summary: {
        totalContextFields,
        answeredContextFields,
        missingContextFields: missingContext.length
      },
      needsUserInput: missingContext.length > 0,
      missingContext,
      questions,
      preview: {
        path: preview.path,
        role: "legacy-intake",
        existsBefore: preview.existsBefore,
        changed: preview.changed,
        oldHash: preview.oldHash,
        newHash: preview.newHash,
        diffPreview: preview.diffPreview,
        diffTruncated: preview.diffTruncated
      },
      applyResult
    });
  }
};

async function detectProjectProfile(root) {
  const fallback = {
    name: path.basename(path.resolve(root)),
    type: "generic",
    namespace: null,
    detectedUi5Version: null
  };

  try {
    const analysis = await analyzeUi5ProjectTool.handler({}, { context: { rootDir: root } });
    const type = analysis.detectedFiles.manifestJson || analysis.detectedFiles.ui5Yaml
      ? "sapui5"
      : analysis.detectedFiles.packageJson
        ? "node"
        : "generic";
    return {
      name: analysis.namespace ?? fallback.name,
      type,
      namespace: analysis.namespace,
      detectedUi5Version: analysis.ui5Version
    };
  } catch {
    if (await fileExists("package.json", root)) {
      return {
        ...fallback,
        type: "node"
      };
    }
    return fallback;
  }
}

async function readExistingIntake(intakePath, root) {
  if (!(await fileExists(intakePath, root))) {
    return null;
  }
  const json = await readJsonFile(intakePath, root);
  const parsed = STORED_INTAKE_SCHEMA.safeParse(json);
  if (!parsed.success) {
    throw new ToolError(`Existing intake file has invalid schema: ${intakePath}`, {
      code: "INVALID_LEGACY_INTAKE",
      details: {
        intakePath,
        issue: parsed.error.issues[0] ?? null
      }
    });
  }
  return parsed.data;
}

function mergeContext(existing, provided, detectedUi5Version) {
  const base = {
    projectGoal: null,
    businessDomain: null,
    criticality: null,
    runtimeLandscape: null,
    ui5RuntimeVersion: detectedUi5Version ?? null,
    allowedRefactorScope: null,
    mustKeepStableAreas: [],
    knownPainPoints: [],
    constraints: [],
    complianceRequirements: [],
    notes: null
  };

  const merged = {
    ...base,
    ...(existing ?? {})
  };

  for (const [key, value] of Object.entries(provided)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      merged[key] = unique(value.map((item) => item.trim()).filter(Boolean));
      continue;
    }
    if (typeof value === "string") {
      merged[key] = value.trim() || null;
      continue;
    }
    merged[key] = value;
  }

  if (!merged.ui5RuntimeVersion && detectedUi5Version) {
    merged.ui5RuntimeVersion = detectedUi5Version;
  }

  return merged;
}

function resolveMissingContext(context, projectType) {
  const missing = [];
  if (!context.projectGoal) {
    missing.push("projectGoal");
  }
  if (!context.criticality) {
    missing.push("criticality");
  }
  if (!context.allowedRefactorScope) {
    missing.push("allowedRefactorScope");
  }
  if (projectType === "sapui5" && !context.ui5RuntimeVersion) {
    missing.push("ui5RuntimeVersion");
  }
  return missing;
}

function buildQuestions(missingContext, projectType) {
  const questions = [];
  if (missingContext.includes("projectGoal")) {
    questions.push({
      id: "projectGoal",
      question: "Cual es el objetivo principal de negocio/tecnico que debe priorizar la IA en este proyecto legacy?",
      why: "Permite orientar decisiones de implementacion y evitar cambios irrelevantes."
    });
  }
  if (missingContext.includes("criticality")) {
    questions.push({
      id: "criticality",
      question: "Que nivel de criticidad tiene este proyecto (low/medium/high/regulated)?",
      why: "Ajusta el rigor de validaciones y reduce riesgo operativo."
    });
  }
  if (missingContext.includes("allowedRefactorScope")) {
    questions.push({
      id: "allowedRefactorScope",
      question: "Que alcance de refactor esta permitido (minimal/incremental/broad)?",
      why: "Evita propuestas de cambios fuera del margen aceptado por el equipo."
    });
  }
  if (projectType === "sapui5" && missingContext.includes("ui5RuntimeVersion")) {
    questions.push({
      id: "ui5RuntimeVersion",
      question: "Que version UI5 se ejecuta realmente en runtime (si difiere del manifest/ui5.yaml)?",
      why: "La compatibilidad de controles y APIs depende de la version runtime real."
    });
  }
  return questions;
}

function getTrackedContextFieldCount(context) {
  return Object.keys(context).length;
}

function countAnsweredContextFields(context) {
  let count = 0;
  for (const value of Object.values(context)) {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        count += 1;
      }
      continue;
    }
    if (value !== null && value !== undefined && value !== "") {
      count += 1;
    }
  }
  return count;
}

function unique(values) {
  return Array.from(new Set(values));
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function enforceManagedSubtree(pathValue, rootPrefix, label) {
  if (!pathValue.startsWith(`${rootPrefix}/`) && pathValue !== rootPrefix) {
    throw new ToolError(`${label} must stay inside ${rootPrefix}.`, {
      code: "INVALID_ARTIFACT_LAYOUT",
      details: {
        label,
        path: pathValue,
        expectedPrefix: rootPrefix
      }
    });
  }
}
