import { z } from "zod";
import { fileExists, readTextFile } from "../../utils/fileSystem.js";
import { getSapOfficialRefsForRule } from "../documentation/sapOfficialDocs.js";
import { getDependencyVersion, readCapProject, readOptionalJson } from "./common.js";

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  targetMode: z.enum(["javascript_jsdoc", "typescript", "mixed"]).optional()
}).strict();

const officialRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  product: z.enum(["cap", "ui5"]),
  topic: z.string()
});

const checkSchema = z.object({
  id: z.string(),
  pass: z.boolean(),
  severity: z.enum(["error", "warn", "info"]),
  message: z.string(),
  suggestion: z.string(),
  officialRefs: z.array(officialRefSchema)
});

const outputSchema = z.object({
  sourceDir: z.string(),
  targetMode: z.enum(["javascript_jsdoc", "typescript", "mixed"]),
  ready: z.boolean(),
  score: z.number().int().min(0).max(100),
  detected: z.object({
    typescriptFiles: z.number().int().nonnegative(),
    javascriptHandlers: z.number().int().nonnegative(),
    typescriptHandlers: z.number().int().nonnegative(),
    tsconfig: z.boolean(),
    jsconfig: z.boolean(),
    checkJs: z.boolean(),
    cdsTyperDependency: z.string().nullable(),
    cdsTypesDependency: z.string().nullable(),
    typescriptDependency: z.string().nullable(),
    generatedTypesDir: z.boolean(),
    packageImportsForCdsModels: z.boolean(),
    typedCdsModelImports: z.number().int().nonnegative(),
    typedRequestUsage: z.number().int().nonnegative()
  }),
  checks: z.array(checkSchema),
  summary: z.object({
    blocking: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative()
  }),
  recommendedCommands: z.array(z.string()),
  recommendations: z.array(z.string())
});

export const validateCapTypescriptReadinessTool = {
  name: "validate_cap_typescript_readiness",
  description: "Validate SAP CAP Node.js readiness for TypeScript or typed JavaScript workflows with cds-typer and official CAP guidance.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { sourceDir, maxFiles, targetMode } = inputSchema.parse(args);
    const selectedTargetMode = targetMode ?? "mixed";
    const project = await readCapProject({
      root: context.rootDir,
      sourceDir,
      maxFiles
    });
    const packageJson = project.packageJson;
    const tsconfig = await readOptionalJson("tsconfig.json", context.rootDir);
    const jsconfig = await readOptionalJson("jsconfig.json", context.rootDir);
    const handlerFiles = project.jsFiles.filter(isLikelyCapHandler);
    const typedSignals = await scanTypedHandlerSignals({
      root: context.rootDir,
      files: handlerFiles
    });
    const detected = {
      typescriptFiles: project.jsFiles.filter((file) => file.endsWith(".ts")).length,
      javascriptHandlers: handlerFiles.filter((file) => file.endsWith(".js")).length,
      typescriptHandlers: handlerFiles.filter((file) => file.endsWith(".ts")).length,
      tsconfig: Boolean(tsconfig),
      jsconfig: Boolean(jsconfig),
      checkJs: Boolean(tsconfig?.compilerOptions?.checkJs || jsconfig?.compilerOptions?.checkJs),
      cdsTyperDependency: getDependencyVersion(packageJson, "@cap-js/cds-typer"),
      cdsTypesDependency: getDependencyVersion(packageJson, "@cap-js/cds-types"),
      typescriptDependency: getDependencyVersion(packageJson, "typescript"),
      generatedTypesDir: await fileExists("@cds-models", context.rootDir),
      packageImportsForCdsModels: hasCdsModelImports(packageJson),
      typedCdsModelImports: typedSignals.typedCdsModelImports,
      typedRequestUsage: typedSignals.typedRequestUsage
    };
    const checks = buildChecks({
      detected,
      targetMode: selectedTargetMode
    });
    const score = calculateScore(checks);
    const blocking = checks.filter((check) => !check.pass && check.severity === "error").length;

    return outputSchema.parse({
      sourceDir: project.sourceDir,
      targetMode: selectedTargetMode,
      ready: blocking === 0 && score >= 70,
      score,
      detected,
      checks,
      summary: {
        blocking,
        warnings: checks.filter((check) => !check.pass && check.severity === "warn").length,
        passed: checks.filter((check) => check.pass).length
      },
      recommendedCommands: buildRecommendedCommands(detected, selectedTargetMode),
      recommendations: buildRecommendations(checks)
    });
  }
};

function buildChecks(input) {
  const { detected, targetMode } = input;
  const wantsTypeScript = targetMode === "typescript" || targetMode === "mixed";
  const checks = [
    createCheck({
      id: "cap_typescript_config",
      rule: "CAP_TYPESCRIPT_CONFIG_MISSING",
      pass: detected.tsconfig || detected.jsconfig,
      severity: wantsTypeScript ? "error" : "warn",
      message: detected.tsconfig || detected.jsconfig
        ? "tsconfig.json or jsconfig.json is available for editor/type tooling."
        : "No tsconfig.json/jsconfig.json was detected.",
      suggestion: "Add the CAP TypeScript or cds-typer facet so agents can reason over generated model types."
    }),
    createCheck({
      id: "cap_cds_typer_dependency",
      rule: "CAP_TYPESCRIPT_TYPER_MISSING",
      pass: Boolean(detected.cdsTyperDependency),
      severity: "warn",
      message: detected.cdsTyperDependency
        ? `@cap-js/cds-typer is declared (${detected.cdsTyperDependency}).`
        : "@cap-js/cds-typer is not declared.",
      suggestion: "Use cds add typer to add model type generation and the related package imports configuration."
    }),
    createCheck({
      id: "cap_cds_types_dependency",
      rule: "CAP_TYPESCRIPT_CDS_TYPES_MISSING",
      pass: Boolean(detected.cdsTypesDependency) || Boolean(detected.typescriptDependency),
      severity: "info",
      message: detected.cdsTypesDependency || detected.typescriptDependency
        ? "Type declarations for CAP/TypeScript workflows are available or implied by TypeScript setup."
        : "@cap-js/cds-types or TypeScript dependency was not detected.",
      suggestion: "For stronger CAP API typing, add @cap-js/cds-types or the CAP TypeScript facet where appropriate."
    }),
    createCheck({
      id: "cap_cds_model_imports",
      rule: "CAP_TYPESCRIPT_MODEL_IMPORTS_MISSING",
      pass: detected.packageImportsForCdsModels || detected.typedCdsModelImports > 0,
      severity: "warn",
      message: detected.packageImportsForCdsModels || detected.typedCdsModelImports > 0
        ? "Generated CDS model imports are configured or already used in handlers."
        : "No #cds-models package imports or generated model imports were detected.",
      suggestion: "Configure #cds-models imports so generated model types can be consumed from service handlers."
    }),
    createCheck({
      id: "cap_typed_request_usage",
      rule: "CAP_TYPESCRIPT_TYPED_REQUESTS_MISSING",
      pass: detected.typedRequestUsage > 0 || detected.typescriptHandlers === 0,
      severity: detected.typescriptHandlers > 0 ? "warn" : "info",
      message: detected.typedRequestUsage > 0
        ? "Typed CAP request usage was detected in service handlers."
        : "Typed CAP request usage was not detected in service handlers.",
      suggestion: "Use CAP request typings or JSDoc imports for handlers that validate or transform request data."
    })
  ];

  if (detected.javascriptHandlers > 0 && !detected.checkJs && targetMode !== "typescript") {
    checks.push(createCheck({
      id: "cap_js_checkjs",
      rule: "CAP_TYPESCRIPT_JS_CHECK_DISABLED",
      pass: false,
      severity: "warn",
      message: "JavaScript CAP handlers exist but checkJs is not enabled.",
      suggestion: "Enable checkJs in jsconfig/tsconfig when staying on JavaScript with generated CDS model types."
    }));
  }

  return checks;
}

function createCheck(item) {
  return {
    id: item.id,
    pass: item.pass,
    severity: item.severity,
    message: item.message,
    suggestion: item.suggestion,
    officialRefs: getSapOfficialRefsForRule(item.rule).map((reference) => ({
      id: reference.id,
      title: reference.title,
      url: reference.url,
      product: reference.product,
      topic: reference.topic
    }))
  };
}

function calculateScore(checks) {
  const totalWeight = checks.reduce((total, check) => total + weightFor(check), 0);
  const passedWeight = checks.reduce((total, check) => total + (check.pass ? weightFor(check) : 0), 0);
  if (totalWeight === 0) {
    return 100;
  }
  return Math.max(0, Math.min(100, Math.round((passedWeight / totalWeight) * 100)));
}

function weightFor(check) {
  if (check.severity === "error") {
    return 3;
  }
  if (check.severity === "warn") {
    return 2;
  }
  return 1;
}

async function scanTypedHandlerSignals(input) {
  const { root, files } = input;
  let typedCdsModelImports = 0;
  let typedRequestUsage = 0;
  for (const file of files) {
    const content = await readTextFile(file, root);
    typedCdsModelImports += countMatches(content, /[#@]cds-models/g);
    typedRequestUsage += countMatches(content, /\bTypedRequest\b|import\(["']@sap\/cds["']\)\.Request|\bfrom\s+["']@sap\/cds["']/g);
  }
  return {
    typedCdsModelImports,
    typedRequestUsage
  };
}

function buildRecommendedCommands(detected, targetMode) {
  const commands = [];
  if (!detected.cdsTyperDependency) {
    commands.push("npx cds add typer");
  }
  if (targetMode === "typescript" && !detected.tsconfig) {
    commands.push("npx cds add typescript");
  }
  commands.push("npx @cap-js/cds-typer \"*\" --outputDirectory @cds-models");
  commands.push("npx cds compile srv --to csn");
  return unique(commands);
}

function buildRecommendations(checks) {
  return checks
    .filter((check) => !check.pass)
    .map((check) => check.suggestion);
}

function hasCdsModelImports(packageJson) {
  const imports = packageJson?.imports;
  if (!imports || typeof imports !== "object" || Array.isArray(imports)) {
    return false;
  }
  return Object.keys(imports).some((key) => key.startsWith("#cds-models"));
}

function isLikelyCapHandler(file) {
  const normalized = file.replaceAll("\\", "/");
  return (normalized.startsWith("srv/") || normalized.includes("/srv/"))
    && [".js", ".ts"].some((extension) => normalized.endsWith(extension));
}

function countMatches(content, pattern) {
  return Array.from(content.matchAll(pattern)).length;
}

function unique(values) {
  return Array.from(new Set(values));
}
