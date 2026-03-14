import { z } from "zod";
import { fileExists, readJsonFile } from "../../utils/fileSystem.js";
import { resolveLanguage, t } from "../../utils/language.js";

const TRANSPORT_STRATEGIES = ["cts", "gcts", "manual"];
const CHECKLIST_STATUS = ["todo", "blocked", "not_needed"];
const READINESS_LEVELS = ["ready", "needs_attention", "blocked"];
const DEFAULT_INTAKE_PATH = ".codex/mcp/project/intake.json";

const inputSchema = z.object({
  targetSystem: z.string().min(2).max(120).optional(),
  transportStrategy: z.enum(TRANSPORT_STRATEGIES).optional(),
  landscape: z.string().min(2).max(200).optional(),
  ui5RuntimeVersion: z.string().regex(/^\d+\.\d+(\.\d+)?$/).optional(),
  appId: z.string().min(2).max(200).optional(),
  abapPackage: z.string().min(2).max(80).optional(),
  businessOwner: z.string().min(2).max(120).optional(),
  rollbackOwner: z.string().min(2).max(120).optional(),
  runSmokeTests: z.boolean().optional(),
  requireIntakeContext: z.boolean().optional(),
  intakePath: z.string().min(1).optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

const checklistItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  required: z.boolean(),
  status: z.enum(CHECKLIST_STATUS),
  evidence: z.array(z.string())
});

const outputSchema = z.object({
  context: z.object({
    runtimeLandscape: z.string().nullable(),
    targetSystem: z.string().nullable(),
    transportStrategy: z.enum(TRANSPORT_STRATEGIES).nullable(),
    ui5RuntimeVersion: z.string().nullable(),
    appId: z.string().nullable(),
    rollbackOwner: z.string().nullable()
  }),
  readiness: z.object({
    level: z.enum(READINESS_LEVELS),
    score: z.number().int().min(0).max(100),
    blockers: z.array(z.string()),
    warnings: z.array(z.string())
  }),
  checklist: z.object({
    predeploy: z.array(checklistItemSchema),
    deploy: z.array(checklistItemSchema),
    postdeploy: z.array(checklistItemSchema)
  }),
  missingContext: z.array(
    z.object({
      field: z.string(),
      question: z.string(),
      why: z.string()
    })
  ),
  nextActions: z.array(z.string()),
  automationPolicy: z.object({
    readOnlyGuidance: z.boolean(),
    note: z.string()
  })
});

export const onpremDeployChecklistTool = {
  name: "onprem_deploy_checklist",
  description: "Generate a safe on-premise deployment checklist with readiness scoring, missing-context questions, and rollout/rollback guidance.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const runSmokeTests = parsed.runSmokeTests ?? true;
    const requireIntakeContext = parsed.requireIntakeContext ?? true;
    const intakePath = parsed.intakePath ?? DEFAULT_INTAKE_PATH;
    const intake = await loadIntake(intakePath, context.rootDir);

    const merged = {
      runtimeLandscape: normalizeValue(parsed.landscape) ?? normalizeValue(intake?.context?.runtimeLandscape),
      targetSystem: normalizeValue(parsed.targetSystem),
      transportStrategy: parsed.transportStrategy ?? normalizeTransport(intake?.context?.transportStrategy),
      ui5RuntimeVersion: normalizeValue(parsed.ui5RuntimeVersion) ?? normalizeValue(intake?.context?.ui5RuntimeVersion),
      appId: normalizeValue(parsed.appId) ?? normalizeValue(intake?.project?.namespace),
      rollbackOwner: normalizeValue(parsed.rollbackOwner),
      abapPackage: normalizeValue(parsed.abapPackage),
      businessOwner: normalizeValue(parsed.businessOwner)
    };

    const blockers = [];
    const warnings = [];

    if (!merged.targetSystem) {
      blockers.push(t(language, "Falta sistema objetivo de despliegue.", "Missing deployment target system."));
    }
    if (!merged.transportStrategy) {
      blockers.push(t(language, "Falta estrategia de transporte (CTS/gCTS/manual).", "Missing transport strategy (CTS/gCTS/manual)."));
    }
    if (!merged.appId) {
      blockers.push(t(language, "Falta identificador de app para trazabilidad.", "Missing app identifier for traceability."));
    }
    if (!merged.rollbackOwner) {
      blockers.push(t(language, "Falta responsable de rollback.", "Missing rollback owner."));
    }
    if (requireIntakeContext && !intake) {
      warnings.push(t(language, "No se encontro intake del proyecto; se recomienda completarlo.", "Project intake was not found; completing it is recommended."));
    }
    if (!merged.ui5RuntimeVersion) {
      warnings.push(t(language, "No se indico version runtime UI5.", "UI5 runtime version was not provided."));
    }
    if (!merged.businessOwner) {
      warnings.push(t(language, "No se indico business owner para aprobacion funcional.", "No business owner was provided for functional approval."));
    }

    const checklist = buildChecklist({
      language,
      blockers,
      warnings,
      runSmokeTests,
      hasTransport: Boolean(merged.transportStrategy),
      hasTarget: Boolean(merged.targetSystem)
    });
    const missingContext = buildMissingContext({
      language,
      merged
    });

    const score = Math.max(0, Math.min(100, 100 - (blockers.length * 20) - (warnings.length * 8)));
    const level = blockers.length > 0
      ? "blocked"
      : warnings.length > 0
        ? "needs_attention"
        : "ready";
    const nextActions = buildNextActions({
      language,
      blockers,
      warnings,
      missingContext
    });

    return outputSchema.parse({
      context: {
        runtimeLandscape: merged.runtimeLandscape,
        targetSystem: merged.targetSystem,
        transportStrategy: merged.transportStrategy,
        ui5RuntimeVersion: merged.ui5RuntimeVersion,
        appId: merged.appId,
        rollbackOwner: merged.rollbackOwner
      },
      readiness: {
        level,
        score,
        blockers,
        warnings
      },
      checklist,
      missingContext,
      nextActions,
      automationPolicy: {
        readOnlyGuidance: true,
        note: t(
          language,
          "Esta tool solo genera checklist y readiness para on-prem. No ejecuta transportes ni despliegues.",
          "This tool only generates on-prem checklist/readiness guidance. It does not execute transports or deployments."
        )
      }
    });
  }
};

function buildChecklist(input) {
  const blocked = input.blockers.length > 0;
  const hasWarnings = input.warnings.length > 0;
  return {
    predeploy: [
      checklistItem({
        id: "confirm-target-system",
        title: t(input.language, "Confirmar sistema destino y ventana de cambio", "Confirm target system and change window"),
        required: true,
        status: input.hasTarget ? "todo" : "blocked",
        evidence: []
      }),
      checklistItem({
        id: "confirm-transport-strategy",
        title: t(input.language, "Confirmar estrategia de transporte", "Confirm transport strategy"),
        required: true,
        status: input.hasTransport ? "todo" : "blocked",
        evidence: []
      }),
      checklistItem({
        id: "run-quality-checks",
        title: t(input.language, "Ejecutar validaciones (npm run check / quality gate)", "Run validations (npm run check / quality gate)"),
        required: true,
        status: blocked ? "blocked" : "todo",
        evidence: []
      }),
      checklistItem({
        id: "stakeholder-approval",
        title: t(input.language, "Validar aprobacion funcional/negocio", "Validate business/functional approval"),
        required: true,
        status: hasWarnings ? "todo" : "todo",
        evidence: []
      })
    ],
    deploy: [
      checklistItem({
        id: "import-transport",
        title: t(input.language, "Importar transporte en sistema objetivo", "Import transport into target system"),
        required: true,
        status: blocked ? "blocked" : "todo",
        evidence: []
      }),
      checklistItem({
        id: "activate-and-verify",
        title: t(input.language, "Activar artefactos y verificar app", "Activate artifacts and verify app"),
        required: true,
        status: blocked ? "blocked" : "todo",
        evidence: []
      })
    ],
    postdeploy: [
      checklistItem({
        id: "smoke-test",
        title: t(input.language, "Ejecutar smoke tests de navegacion y datos", "Run smoke tests for navigation and data"),
        required: input.runSmokeTests,
        status: input.runSmokeTests
          ? blocked ? "blocked" : "todo"
          : "not_needed",
        evidence: []
      }),
      checklistItem({
        id: "monitor-incidents",
        title: t(input.language, "Monitorizar incidencias post-despliegue", "Monitor post-deployment incidents"),
        required: true,
        status: blocked ? "blocked" : "todo",
        evidence: []
      }),
      checklistItem({
        id: "rollback-readiness",
        title: t(input.language, "Confirmar plan de rollback operativo", "Confirm operational rollback plan"),
        required: true,
        status: blocked ? "blocked" : "todo",
        evidence: []
      })
    ]
  };
}

function buildMissingContext(input) {
  const items = [];
  if (!input.merged.targetSystem) {
    items.push({
      field: "targetSystem",
      question: t(input.language, "Cual es el sistema on-prem objetivo?", "What is the target on-prem system?"),
      why: t(input.language, "Define ruta de import y validacion final.", "Defines import route and final validation.")
    });
  }
  if (!input.merged.transportStrategy) {
    items.push({
      field: "transportStrategy",
      question: t(input.language, "Se usara CTS, gCTS o flujo manual?", "Will you use CTS, gCTS, or manual flow?"),
      why: t(input.language, "Afecta pasos de despliegue y evidencias requeridas.", "Affects deployment steps and required evidence.")
    });
  }
  if (!input.merged.appId) {
    items.push({
      field: "appId",
      question: t(input.language, "Cual es el appId tecnico a desplegar?", "What is the technical appId to deploy?"),
      why: t(input.language, "Necesario para trazabilidad y verificacion.", "Required for traceability and verification.")
    });
  }
  if (!input.merged.rollbackOwner) {
    items.push({
      field: "rollbackOwner",
      question: t(input.language, "Quien es responsable del rollback si falla el despliegue?", "Who owns rollback if deployment fails?"),
      why: t(input.language, "Evita bloqueos operativos en incidencias.", "Prevents operational blockers during incidents.")
    });
  }
  return items;
}

function buildNextActions(input) {
  const actions = [];
  if (input.blockers.length > 0) {
    actions.push(
      t(
        input.language,
        "Resolver blockers de contexto antes de abrir ventana de despliegue.",
        "Resolve context blockers before opening deployment window."
      )
    );
  }
  if (input.warnings.length > 0) {
    actions.push(
      t(
        input.language,
        "Cerrar warnings de readiness para reducir riesgo operativo.",
        "Close readiness warnings to reduce operational risk."
      )
    );
  }
  if (input.missingContext.length > 0) {
    actions.push(
      t(
        input.language,
        "Completar campos faltantes y volver a ejecutar checklist.",
        "Fill missing fields and rerun checklist."
      )
    );
  }
  if (actions.length === 0) {
    actions.push(
      t(
        input.language,
        "Checklist listo: ejecutar despliegue controlado y registrar evidencias.",
        "Checklist ready: run controlled deployment and record evidence."
      )
    );
  }
  return actions;
}

function checklistItem(item) {
  return checklistItemSchema.parse(item);
}

async function loadIntake(intakePath, rootDir) {
  if (!(await fileExists(intakePath, rootDir))) {
    return null;
  }
  try {
    return await readJsonFile(intakePath, rootDir);
  } catch {
    return null;
  }
}

function normalizeValue(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeTransport(value) {
  if (value === "cts" || value === "gcts" || value === "manual") {
    return value;
  }
  return null;
}
