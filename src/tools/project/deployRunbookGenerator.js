import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { resolveLanguage, t } from "../../utils/language.js";
import { cfDeployPrecheckTool } from "./cfDeployPrecheck.js";
import { onpremDeployChecklistTool } from "./onpremDeployChecklist.js";

const PLATFORMS = ["cloud_foundry", "onpremise"];

const inputSchema = z.object({
  platform: z.enum(PLATFORMS),
  title: z.string().max(160).optional(),
  objective: z.string().max(1000).optional(),
  includeRollback: z.boolean().optional(),
  includeValidation: z.boolean().optional(),
  outputPath: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional(),
  language: z.enum(["es", "en"]).optional(),
  manifestPath: z.string().min(1).optional(),
  mtaPath: z.string().min(1).optional(),
  targetSystem: z.string().min(2).max(120).optional(),
  transportStrategy: z.enum(["cts", "gcts", "manual"]).optional()
}).strict();

const outputSchema = z.object({
  dryRun: z.boolean(),
  changed: z.boolean(),
  platform: z.enum(PLATFORMS),
  outputPath: z.string(),
  precheckSummary: z.object({
    ready: z.boolean(),
    level: z.enum(["ready", "needs_attention", "blocked"]),
    keyFindings: z.array(z.string())
  }),
  runbook: z.object({
    title: z.string(),
    markdown: z.string(),
    sections: z.array(z.string())
  }),
  preview: z.object({
    path: z.string(),
    role: z.literal("deploy-runbook"),
    existsBefore: z.boolean(),
    changed: z.boolean(),
    oldHash: z.string().nullable(),
    newHash: z.string(),
    diffPreview: z.string(),
    diffTruncated: z.boolean()
  }),
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
  }).nullable(),
  automationPolicy: z.object({
    writesOnlyWithConsent: z.boolean(),
    note: z.string()
  })
});

export const deployRunbookGeneratorTool = {
  name: "deploy_runbook_generator",
  description: "Generate a deployment runbook (Cloud Foundry or On-Premise) from precheck signals, with dry-run preview and safe optional persistence.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const shouldDryRun = parsed.dryRun ?? true;
    const includeRollback = parsed.includeRollback ?? true;
    const includeValidation = parsed.includeValidation ?? true;
    const selectedOutputPath = normalizePath(parsed.outputPath ?? defaultOutputPath(parsed.platform));
    enforceRunbookPath(selectedOutputPath);

    const precheck = parsed.platform === "cloud_foundry"
      ? await cfDeployPrecheckTool.handler(
        {
          manifestPath: parsed.manifestPath,
          mtaPath: parsed.mtaPath,
          language: parsed.language
        },
        { context }
      )
      : await onpremDeployChecklistTool.handler(
        {
          targetSystem: parsed.targetSystem,
          transportStrategy: parsed.transportStrategy,
          language: parsed.language
        },
        { context }
      );

    const precheckSummary = summarizePrecheck(parsed.platform, precheck, language);
    const runbook = buildRunbook({
      platform: parsed.platform,
      language,
      title: parsed.title,
      objective: parsed.objective,
      includeRollback,
      includeValidation,
      precheckSummary,
      precheck
    });
    const content = `${runbook.markdown}\n`;
    const preview = await previewFileWrite(selectedOutputPath, content, {
      root: context.rootDir,
      maxDiffLines: parsed.maxDiffLines
    });

    let applyResult = null;
    if (!shouldDryRun && preview.changed) {
      applyResult = await applyProjectPatch(
        [
          {
            path: selectedOutputPath,
            content,
            expectedOldHash: preview.oldHash ?? undefined
          }
        ],
        {
          root: context.rootDir,
          reason: parsed.reason ?? "deploy_runbook_generator"
        }
      );
    }

    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed: preview.changed,
      platform: parsed.platform,
      outputPath: selectedOutputPath,
      precheckSummary,
      runbook,
      preview: {
        path: preview.path,
        role: "deploy-runbook",
        existsBefore: preview.existsBefore,
        changed: preview.changed,
        oldHash: preview.oldHash,
        newHash: preview.newHash,
        diffPreview: preview.diffPreview,
        diffTruncated: preview.diffTruncated
      },
      applyResult,
      automationPolicy: {
        writesOnlyWithConsent: true,
        note: t(
          language,
          "Esta tool solo genera documentacion de despliegue. Nunca ejecuta deploy automaticamente.",
          "This tool only generates deployment documentation. It never executes deployment automatically."
        )
      }
    });
  }
};

function summarizePrecheck(platform, precheck, language) {
  if (platform === "cloud_foundry") {
    const failCount = precheck.summary.failCount;
    const warnCount = precheck.summary.warnCount;
    const level = failCount > 0
      ? "blocked"
      : warnCount > 0
        ? "needs_attention"
        : "ready";
    const findings = precheck.checks
      .filter((check) => check.status === "fail" || check.status === "warn")
      .slice(0, 6)
      .map((check) => `[${check.status}] ${check.title}: ${check.message}`);
    return {
      ready: precheck.summary.ready,
      level,
      keyFindings: findings
    };
  }

  const findings = [
    ...precheck.readiness.blockers.map((item) => `[fail] ${item}`),
    ...precheck.readiness.warnings.map((item) => `[warn] ${item}`)
  ].slice(0, 6);
  return {
    ready: precheck.readiness.level === "ready",
    level: precheck.readiness.level,
    keyFindings: findings.length > 0
      ? findings
      : [t(language, "Sin hallazgos bloqueantes.", "No blocking findings.")]
  };
}

function buildRunbook(input) {
  const title = input.title ?? defaultTitle(input.platform, input.language);
  const objective = input.objective ?? defaultObjective(input.platform, input.language);
  const sections = ["overview", "precheck-summary", "steps"];
  const lines = [];

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- ${t(input.language, "Generado:", "Generated:")} ${new Date().toISOString()}`);
  lines.push(`- ${t(input.language, "Plataforma:", "Platform:")} ${platformLabel(input.platform, input.language)}`);
  lines.push("");
  lines.push(`## ${t(input.language, "Objetivo", "Objective")}`);
  lines.push(objective);
  lines.push("");
  lines.push(`## ${t(input.language, "Resumen de prechecks", "Precheck summary")}`);
  lines.push(`- ${t(input.language, "Estado", "Status")}: ${input.precheckSummary.level}`);
  lines.push(`- ${t(input.language, "Ready", "Ready")}: ${input.precheckSummary.ready}`);
  if (input.precheckSummary.keyFindings.length > 0) {
    lines.push(`- ${t(input.language, "Hallazgos clave", "Key findings")}:`);
    for (const finding of input.precheckSummary.keyFindings) {
      lines.push(`  - ${finding}`);
    }
  }
  lines.push("");
  lines.push(`## ${t(input.language, "Pasos operativos", "Operational steps")}`);

  if (input.platform === "cloud_foundry") {
    lines.push(`### ${t(input.language, "Pre-deploy", "Pre-deploy")}`);
    lines.push(`1. ${t(input.language, "Ejecutar validaciones de proyecto (`npm run check`).", "Run project validations (`npm run check`).")}`);
    lines.push(`2. ${t(input.language, "Construir artefacto (`npm run build` o `mbt build -p cf`).", "Build artifact (`npm run build` or `mbt build -p cf`).")}`);
    lines.push(`3. ${t(input.language, "Confirmar variables/servicios y placeholders por entorno.", "Confirm per-environment variables/services and placeholders.")}`);
    lines.push("");
    lines.push(`### ${t(input.language, "Deploy", "Deploy")}`);
    lines.push(`1. ${t(input.language, "Manifest: `cf push -f manifest.yml`.", "Manifest flow: `cf push -f manifest.yml`.")}`);
    lines.push(`2. ${t(input.language, "MTA: `cf deploy mta_archives/<artifact>.mtar`.", "MTA flow: `cf deploy mta_archives/<artifact>.mtar`.")}`);
    lines.push(`3. ${t(input.language, "Verificar estado con `cf app <app>`.", "Verify status with `cf app <app>`.")}`);
    lines.push("");
    lines.push(`### ${t(input.language, "Post-deploy", "Post-deploy")}`);
    lines.push(`1. ${t(input.language, "Revisar logs recientes (`cf logs <app> --recent`).", "Review recent logs (`cf logs <app> --recent`).")}`);
    lines.push(`2. ${t(input.language, "Ejecutar smoke tests funcionales.", "Run functional smoke tests.")}`);
    lines.push(`3. ${t(input.language, "Registrar evidencias de release.", "Record release evidence.")}`);
  } else {
    lines.push(`### ${t(input.language, "Pre-deploy", "Pre-deploy")}`);
    lines.push(`1. ${t(input.language, "Confirmar sistema destino y estrategia de transporte.", "Confirm target system and transport strategy.")}`);
    lines.push(`2. ${t(input.language, "Ejecutar quality checks antes de importar transporte.", "Run quality checks before transport import.")}`);
    lines.push(`3. ${t(input.language, "Validar aprobacion funcional y ventana de cambio.", "Validate functional approval and change window.")}`);
    lines.push("");
    lines.push(`### ${t(input.language, "Deploy", "Deploy")}`);
    lines.push(`1. ${t(input.language, "Importar transporte en sistema objetivo.", "Import transport into target system.")}`);
    lines.push(`2. ${t(input.language, "Activar artefactos y verificar disponibilidad de app.", "Activate artifacts and verify app availability.")}`);
    lines.push(`3. ${t(input.language, "Notificar inicio de pruebas operativas.", "Notify start of operational testing.")}`);
    lines.push("");
    lines.push(`### ${t(input.language, "Post-deploy", "Post-deploy")}`);
    lines.push(`1. ${t(input.language, "Ejecutar smoke tests de navegacion e integracion.", "Run navigation/integration smoke tests.")}`);
    lines.push(`2. ${t(input.language, "Monitorizar incidencias y performance inicial.", "Monitor incidents and initial performance.")}`);
    lines.push(`3. ${t(input.language, "Documentar cierre y evidencias.", "Document closure and evidence.")}`);
  }

  if (input.includeValidation) {
    sections.push("validation");
    lines.push("");
    lines.push(`## ${t(input.language, "Validacion final", "Final validation")}`);
    lines.push(`- ${t(input.language, "Check tecnico en verde.", "Technical check passes.")}`);
    lines.push(`- ${t(input.language, "Smoke tests ejecutados sin bloqueos.", "Smoke tests executed with no blockers.")}`);
    lines.push(`- ${t(input.language, "Evidencias registradas (logs/capturas/resultados).", "Evidence recorded (logs/screenshots/results).")}`);
  }

  if (input.includeRollback) {
    sections.push("rollback");
    lines.push("");
    lines.push(`## ${t(input.language, "Plan de rollback", "Rollback plan")}`);
    lines.push(`1. ${t(input.language, "Definir trigger de rollback (criterio de corte).", "Define rollback trigger (cutoff criterion).")}`);
    lines.push(`2. ${t(input.language, "Revertir a version estable previa.", "Revert to previous stable version.")}`);
    lines.push(`3. ${t(input.language, "Comunicar incidencia y registrar causa raiz.", "Communicate incident and log root cause.")}`);
  }

  return {
    title,
    markdown: lines.join("\n"),
    sections
  };
}

function defaultOutputPath(platform) {
  return platform === "cloud_foundry"
    ? "docs/mcp/runbooks/deploy-cloud-foundry.md"
    : "docs/mcp/runbooks/deploy-onpremise.md";
}

function defaultTitle(platform, language) {
  if (platform === "cloud_foundry") {
    return t(language, "Runbook de despliegue Cloud Foundry", "Cloud Foundry deployment runbook");
  }
  return t(language, "Runbook de despliegue On-Premise", "On-Premise deployment runbook");
}

function defaultObjective(platform, language) {
  if (platform === "cloud_foundry") {
    return t(
      language,
      "Guiar un despliegue controlado en Cloud Foundry con validaciones, evidencias y rollback.",
      "Guide a controlled Cloud Foundry deployment with validations, evidence, and rollback."
    );
  }
  return t(
    language,
    "Guiar un despliegue controlado en entorno on-premise con trazabilidad operativa.",
    "Guide a controlled on-premise deployment with operational traceability."
  );
}

function platformLabel(platform, language) {
  if (platform === "cloud_foundry") {
    return t(language, "Cloud Foundry", "Cloud Foundry");
  }
  return t(language, "On-Premise", "On-Premise");
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function enforceRunbookPath(pathValue) {
  if (pathValue.startsWith("docs/") || pathValue.startsWith(".codex/mcp/")) {
    return;
  }
  throw new ToolError("outputPath must be inside docs/ or .codex/mcp/.", {
    code: "INVALID_RUNBOOK_PATH",
    details: {
      outputPath: pathValue
    }
  });
}
