import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { fileExists, readJsonFile, readTextFile } from "../../utils/fileSystem.js";
import { resolveLanguage, t } from "../../utils/language.js";

const DEPLOYMENT_MODES = ["unknown", "cf_manifest", "mta", "mixed"];
const CHECK_STATUS = ["pass", "warn", "fail", "info"];

const inputSchema = z.object({
  manifestPath: z.string().min(1).optional(),
  mtaPath: z.string().min(1).optional(),
  packageJsonPath: z.string().min(1).optional(),
  strictRoutes: z.boolean().optional(),
  checkSecrets: z.boolean().optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

const checkSchema = z.object({
  id: z.string(),
  status: z.enum(CHECK_STATUS),
  title: z.string(),
  message: z.string(),
  evidence: z.array(z.string()),
  recommendation: z.string()
});

const outputSchema = z.object({
  generatedAt: z.string(),
  scope: z.object({
    deploymentMode: z.enum(DEPLOYMENT_MODES),
    manifestPath: z.string().nullable(),
    mtaPath: z.string().nullable(),
    packageJsonPath: z.string().nullable()
  }),
  filesDetected: z.object({
    manifest: z.boolean(),
    mta: z.boolean(),
    packageJson: z.boolean()
  }),
  checks: z.array(checkSchema),
  summary: z.object({
    ready: z.boolean(),
    failCount: z.number().int().nonnegative(),
    warnCount: z.number().int().nonnegative(),
    passCount: z.number().int().nonnegative(),
    infoCount: z.number().int().nonnegative()
  }),
  recommendedCommands: z.array(z.string()),
  automationPolicy: z.object({
    readOnlyAnalysis: z.boolean(),
    note: z.string()
  })
});

export const cfDeployPrecheckTool = {
  name: "cf_deploy_precheck",
  description: "Run a safe pre-deployment readiness check for Cloud Foundry/MTA projects (manifest, mta, scripts, and secret-risk signals).",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const strictRoutes = parsed.strictRoutes ?? true;
    const checkSecrets = parsed.checkSecrets ?? true;
    const manifestPath = parsed.manifestPath ?? await detectFirstPath(["manifest.yml", "manifest.yaml"], context.rootDir);
    const mtaPath = parsed.mtaPath ?? await detectFirstPath(["mta.yaml", "mta.yml"], context.rootDir);
    const packageJsonPath = parsed.packageJsonPath ?? ((await fileExists("package.json", context.rootDir)) ? "package.json" : null);

    const filesDetected = {
      manifest: Boolean(manifestPath),
      mta: Boolean(mtaPath),
      packageJson: Boolean(packageJsonPath)
    };
    const deploymentMode = resolveDeploymentMode(filesDetected);
    const checks = [];

    let manifest = null;
    let mta = null;
    let packageJson = null;

    if (manifestPath) {
      manifest = await readTextFile(manifestPath, context.rootDir);
    }
    if (mtaPath) {
      mta = await readTextFile(mtaPath, context.rootDir);
    }
    if (packageJsonPath) {
      packageJson = await safeReadPackageJson(packageJsonPath, context.rootDir);
    }

    if (!filesDetected.manifest && !filesDetected.mta) {
      checks.push(createCheck({
        id: "deploy_config_presence",
        status: "fail",
        title: t(language, "No hay descriptor de despliegue", "No deployment descriptor found"),
        message: t(language, "No se detecto ni manifest.yml ni mta.yaml.", "Neither manifest.yml nor mta.yaml was detected."),
        evidence: [],
        recommendation: t(
          language,
          "Anade manifest.yml o mta.yaml antes de preparar despliegue.",
          "Add manifest.yml or mta.yaml before preparing deployment."
        )
      }));
    }

    if (filesDetected.manifest) {
      checks.push(...runManifestChecks({
        manifest,
        language,
        strictRoutes,
        checkSecrets
      }));
    }
    if (filesDetected.mta) {
      checks.push(...await runMtaChecks({
        mta,
        language,
        rootDir: context.rootDir
      }));
    }
    if (filesDetected.packageJson) {
      checks.push(...runPackageChecks({
        packageJson,
        language
      }));
    } else {
      checks.push(createCheck({
        id: "package_json_missing",
        status: "warn",
        title: t(language, "No hay package.json", "Missing package.json"),
        message: t(language, "No se encontro package.json para validar scripts de build/check.", "package.json was not found to validate build/check scripts."),
        evidence: [],
        recommendation: t(language, "Confirma el flujo de build/deploy manual.", "Confirm manual build/deploy flow.")
      }));
    }

    if (deploymentMode === "mixed") {
      checks.push(createCheck({
        id: "mixed_strategy_detected",
        status: "info",
        title: t(language, "Se detectaron manifest y mta", "Manifest and MTA both detected"),
        message: t(
          language,
          "El proyecto contiene ambos descriptores; conviene definir estrategia principal por entorno.",
          "Project contains both descriptors; define the primary strategy by environment."
        ),
        evidence: [manifestPath, mtaPath].filter(Boolean),
        recommendation: t(
          language,
          "Documenta cuando usar `cf push` (manifest) y cuando usar `cf deploy` (MTA).",
          "Document when to use `cf push` (manifest) and when to use `cf deploy` (MTA)."
        )
      }));
    }

    const summary = summarizeChecks(checks);
    const recommendedCommands = buildCommands({
      deploymentMode,
      hasBuildScript: Boolean(packageJson?.scripts?.build),
      hasCheckScript: Boolean(packageJson?.scripts?.check),
      language
    });

    return outputSchema.parse({
      generatedAt: new Date().toISOString(),
      scope: {
        deploymentMode,
        manifestPath,
        mtaPath,
        packageJsonPath
      },
      filesDetected,
      checks,
      summary,
      recommendedCommands,
      automationPolicy: {
        readOnlyAnalysis: true,
        note: t(
          language,
          "Esta tool solo ejecuta prechecks de despliegue y no lanza cf push/cf deploy automaticamente.",
          "This tool only runs deployment prechecks and does not execute cf push/cf deploy automatically."
        )
      }
    });
  }
};

async function detectFirstPath(candidates, rootDir) {
  for (const candidate of candidates) {
    if (await fileExists(candidate, rootDir)) {
      return candidate;
    }
  }
  return null;
}

function resolveDeploymentMode(filesDetected) {
  if (filesDetected.manifest && filesDetected.mta) {
    return "mixed";
  }
  if (filesDetected.mta) {
    return "mta";
  }
  if (filesDetected.manifest) {
    return "cf_manifest";
  }
  return "unknown";
}

function runManifestChecks(input) {
  const { manifest, language, strictRoutes, checkSecrets } = input;
  const checks = [];
  const hasApps = /^\s*(applications|apps)\s*:/m.test(manifest);
  const hasRoutes = /^\s*routes\s*:/m.test(manifest);
  const hasMemory = /^\s*memory\s*:/m.test(manifest);
  const placeholders = manifest.match(/\(\([^)]+\)\)|\$\{[^}]+\}/g) ?? [];

  checks.push(createCheck({
    id: "manifest_apps",
    status: hasApps ? "pass" : "fail",
    title: t(language, "Definicion de apps en manifest", "Manifest app definition"),
    message: hasApps
      ? t(language, "Se detecto bloque de aplicaciones.", "Applications block was detected.")
      : t(language, "No se detecto bloque `applications/apps`.", "No `applications/apps` block was detected."),
    evidence: hasApps ? [t(language, "Bloque de apps presente", "Apps block present")] : [],
    recommendation: t(language, "Incluye al menos una app con nombre y recursos.", "Include at least one app with name and resources.")
  }));

  checks.push(createCheck({
    id: "manifest_routes",
    status: !strictRoutes || hasRoutes ? "pass" : "warn",
    title: t(language, "Definicion de rutas", "Route definition"),
    message: hasRoutes
      ? t(language, "Se detectaron rutas en manifest.", "Routes were detected in manifest.")
      : t(language, "No se detectaron rutas explicitas.", "No explicit routes were detected."),
    evidence: hasRoutes ? [t(language, "Bloque de rutas presente", "Routes block present")] : [],
    recommendation: t(language, "Define rutas explicitas o documenta el uso de random-route.", "Define explicit routes or document random-route usage.")
  }));

  checks.push(createCheck({
    id: "manifest_memory",
    status: hasMemory ? "pass" : "warn",
    title: t(language, "Cuota de memoria definida", "Memory quota defined"),
    message: hasMemory
      ? t(language, "Se detecto parametro de memoria.", "Memory parameter was detected.")
      : t(language, "No se detecto parametro de memoria.", "No memory parameter was detected."),
    evidence: hasMemory ? [t(language, "memory: ...", "memory: ...")] : [],
    recommendation: t(language, "Define `memory` para evitar defaults inesperados.", "Define `memory` to avoid unexpected defaults.")
  }));

  checks.push(createCheck({
    id: "manifest_placeholders",
    status: placeholders.length > 0 ? "pass" : "warn",
    title: t(language, "Uso de placeholders en configuracion", "Use of placeholders in configuration"),
    message: placeholders.length > 0
      ? t(language, "Se detectaron placeholders para variables de entorno.", "Placeholders for environment variables were detected.")
      : t(language, "No se detectaron placeholders de variables.", "No variable placeholders were detected."),
    evidence: placeholders.slice(0, 5),
    recommendation: t(language, "Usa placeholders para secretos y valores por entorno.", "Use placeholders for secrets and per-environment values.")
  }));

  if (checkSecrets) {
    const secretFindings = detectInlineSecrets(manifest);
    checks.push(createCheck({
      id: "manifest_inline_secrets",
      status: secretFindings.length > 0 ? "fail" : "pass",
      title: t(language, "Riesgo de secretos en claro", "Plain-text secret risk"),
      message: secretFindings.length > 0
        ? t(language, "Se detectaron posibles secretos en claro.", "Potential plain-text secrets were detected.")
        : t(language, "No se detectaron secretos en claro en manifest.", "No plain-text secrets were detected in manifest."),
      evidence: secretFindings.slice(0, 10),
      recommendation: t(
        language,
        "Mueve secretos a credenciales de servicio, variables seguras o placeholders.",
        "Move secrets to service credentials, secure variables, or placeholders."
      )
    }));
  }

  return checks;
}

async function runMtaChecks(input) {
  const { mta, language, rootDir } = input;
  const checks = [];
  const hasId = /^\s*ID\s*:/m.test(mta);
  const hasVersion = /^\s*version\s*:/m.test(mta);
  const hasModules = /^\s*modules\s*:/m.test(mta);
  const hasResources = /^\s*resources\s*:/m.test(mta);

  checks.push(createCheck({
    id: "mta_id",
    status: hasId ? "pass" : "warn",
    title: t(language, "ID de MTA", "MTA ID"),
    message: hasId
      ? t(language, "Se detecto ID en mta.yaml.", "ID was detected in mta.yaml.")
      : t(language, "No se detecto ID en mta.yaml.", "No ID was detected in mta.yaml."),
    evidence: hasId ? ["ID: ..."] : [],
    recommendation: t(language, "Define `ID` para trazabilidad del artefacto.", "Define `ID` for artifact traceability.")
  }));

  checks.push(createCheck({
    id: "mta_version",
    status: hasVersion ? "pass" : "warn",
    title: t(language, "Version de MTA", "MTA version"),
    message: hasVersion
      ? t(language, "Se detecto version en mta.yaml.", "Version was detected in mta.yaml.")
      : t(language, "No se detecto version en mta.yaml.", "No version was detected in mta.yaml."),
    evidence: hasVersion ? ["version: ..."] : [],
    recommendation: t(language, "Versiona el MTA para controlar releases.", "Version the MTA to control releases.")
  }));

  checks.push(createCheck({
    id: "mta_modules",
    status: hasModules ? "pass" : "fail",
    title: t(language, "Definicion de modulos", "Module definition"),
    message: hasModules
      ? t(language, "Se detecto bloque `modules`.", "The `modules` block was detected.")
      : t(language, "No se detecto bloque `modules`.", "No `modules` block was detected."),
    evidence: hasModules ? ["modules: ..."] : [],
    recommendation: t(language, "Incluye al menos un modulo con path/tipo.", "Include at least one module with path/type.")
  }));

  checks.push(createCheck({
    id: "mta_resources",
    status: hasResources ? "pass" : "info",
    title: t(language, "Definicion de recursos", "Resource definition"),
    message: hasResources
      ? t(language, "Se detecto bloque `resources`.", "The `resources` block was detected.")
      : t(language, "No se detectaron recursos declarados.", "No declared resources were detected."),
    evidence: hasResources ? ["resources: ..."] : [],
    recommendation: t(language, "Valida si necesitas servicios declarados en resources.", "Validate whether services should be declared under resources.")
  }));

  const modulePaths = extractMtaModulePaths(mta);
  const missingPaths = [];
  for (const modulePath of modulePaths) {
    const absolutePath = path.resolve(rootDir, modulePath);
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isDirectory()) {
        missingPaths.push(modulePath);
      }
    } catch {
      missingPaths.push(modulePath);
    }
  }

  checks.push(createCheck({
    id: "mta_module_paths",
    status: missingPaths.length > 0 ? "fail" : "pass",
    title: t(language, "Paths de modulos existentes", "Module paths exist"),
    message: missingPaths.length > 0
      ? t(language, "Hay paths de modulo que no existen.", "Some module paths do not exist.")
      : t(language, "Todos los paths de modulos detectados existen.", "All detected module paths exist."),
    evidence: missingPaths.length > 0 ? missingPaths : modulePaths,
    recommendation: t(language, "Corrige paths de modulos antes de ejecutar `mbt build`.", "Fix module paths before running `mbt build`.")
  }));

  return checks;
}

function runPackageChecks(input) {
  const { packageJson, language } = input;
  const checks = [];
  const scripts = packageJson?.scripts ?? {};
  const hasBuildScript = Boolean(scripts.build || scripts["build:cf"] || scripts["mta:build"]);
  const hasCheckScript = Boolean(scripts.check || scripts.test);
  const hasNodeEngine = Boolean(packageJson?.engines?.node);

  checks.push(createCheck({
    id: "package_build_script",
    status: hasBuildScript ? "pass" : "warn",
    title: t(language, "Script de build", "Build script"),
    message: hasBuildScript
      ? t(language, "Se detecto script de build.", "A build script was detected.")
      : t(language, "No se detecto script de build en package.json.", "No build script was detected in package.json."),
    evidence: hasBuildScript ? Object.keys(scripts).filter((key) => key.includes("build")) : [],
    recommendation: t(language, "Define `npm run build` o script equivalente para despliegues.", "Define `npm run build` or equivalent script for deployments.")
  }));

  checks.push(createCheck({
    id: "package_quality_script",
    status: hasCheckScript ? "pass" : "warn",
    title: t(language, "Script de calidad", "Quality script"),
    message: hasCheckScript
      ? t(language, "Se detecto script de validacion (check/test).", "A validation script (check/test) was detected.")
      : t(language, "No se detectaron scripts de validacion previos a deploy.", "No pre-deploy validation scripts were detected."),
    evidence: hasCheckScript ? Object.keys(scripts).filter((key) => key === "check" || key === "test") : [],
    recommendation: t(language, "Incluye `npm run check` o `npm test` en el flujo de deploy.", "Include `npm run check` or `npm test` in deployment flow.")
  }));

  checks.push(createCheck({
    id: "package_node_engine",
    status: hasNodeEngine ? "pass" : "warn",
    title: t(language, "Version de Node declarada", "Declared Node version"),
    message: hasNodeEngine
      ? t(language, "Se detecto `engines.node`.", "`engines.node` was detected.")
      : t(language, "No se detecto `engines.node`.", "`engines.node` was not detected."),
    evidence: hasNodeEngine ? [String(packageJson.engines.node)] : [],
    recommendation: t(language, "Declara version de Node para evitar incompatibilidades en buildpack.", "Declare Node version to avoid buildpack incompatibilities.")
  }));

  return checks;
}

function extractMtaModulePaths(text) {
  const matches = text.match(/^\s*path\s*:\s*([^\r\n#]+)$/gm) ?? [];
  return matches
    .map((line) => {
      const value = line.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "");
      return value;
    })
    .filter(Boolean);
}

function detectInlineSecrets(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/(password|passwd|secret|token|apikey|api_key|clientsecret)/i.test(line)) {
      continue;
    }
    if (/\(\([^)]+\)\)|\$\{[^}]+\}/.test(line)) {
      continue;
    }
    if (!/:/.test(line)) {
      continue;
    }
    findings.push(`L${index + 1}: ${line.trim()}`);
  }
  return findings;
}

function summarizeChecks(checks) {
  const counters = {
    failCount: 0,
    warnCount: 0,
    passCount: 0,
    infoCount: 0
  };
  for (const check of checks) {
    if (check.status === "fail") {
      counters.failCount += 1;
    } else if (check.status === "warn") {
      counters.warnCount += 1;
    } else if (check.status === "pass") {
      counters.passCount += 1;
    } else {
      counters.infoCount += 1;
    }
  }
  return {
    ready: counters.failCount === 0,
    ...counters
  };
}

function buildCommands(input) {
  const commands = [];
  if (input.hasCheckScript) {
    commands.push("npm run check");
  }
  if (input.hasBuildScript) {
    commands.push("npm run build");
  }

  if (input.deploymentMode === "cf_manifest" || input.deploymentMode === "mixed") {
    commands.push("cf push -f manifest.yml");
  }
  if (input.deploymentMode === "mta" || input.deploymentMode === "mixed") {
    commands.push("mbt build -p cf");
    commands.push("cf deploy mta_archives/<artifact>.mtar");
  }
  commands.push("cf logs <app-name> --recent");
  return Array.from(new Set(commands));
}

function createCheck(check) {
  return checkSchema.parse(check);
}

async function safeReadPackageJson(packageJsonPath, rootDir) {
  try {
    return await readJsonFile(packageJsonPath, rootDir);
  } catch {
    return {};
  }
}
