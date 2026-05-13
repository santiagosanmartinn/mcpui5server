import path from "node:path";
import { z } from "zod";
import { fileExists, readTextFile } from "../../utils/fileSystem.js";
import { getSapOfficialRefsForRule } from "../documentation/sapOfficialDocs.js";
import { createSummary, findLine, getDependencyVersion, readCapProject, summarizeCdsAnalyses } from "./common.js";

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  maxFindings: z.number().int().min(10).max(2000).optional(),
  allowPublicServices: z.boolean().optional(),
  requireTestScript: z.boolean().optional(),
  checkSecrets: z.boolean().optional()
}).strict();

const findingSchema = z.object({
  rule: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  category: z.enum(["project", "model", "service", "handler", "security", "testing", "deployment"]),
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  message: z.string(),
  suggestion: z.string(),
  officialRefs: z.array(z.object({
    id: z.string(),
    title: z.string(),
    url: z.string().url(),
    product: z.enum(["cap", "ui5"]),
    topic: z.string()
  }))
});

const outputSchema = z.object({
  sourceDir: z.string(),
  scanned: z.object({
    files: z.number().int().nonnegative(),
    cdsFiles: z.number().int().nonnegative(),
    handlerFiles: z.number().int().nonnegative()
  }),
  valid: z.boolean(),
  summary: z.object({
    totalFindings: z.number().int().nonnegative(),
    bySeverity: z.object({
      low: z.number().int().nonnegative(),
      medium: z.number().int().nonnegative(),
      high: z.number().int().nonnegative()
    }),
    byCategory: z.record(z.number().int().nonnegative()),
    byRule: z.record(z.number().int().nonnegative()),
    truncated: z.boolean()
  }),
  findings: z.array(findingSchema)
});

export const validateCapProjectTool = {
  name: "validate_cap_project",
  description: "Validate SAP CAP projects for model keys, service authorization, handler security, testability, and deployment readiness.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      maxFiles,
      maxFindings,
      allowPublicServices,
      requireTestScript,
      checkSecrets
    } = inputSchema.parse(args);
    const project = await readCapProject({
      root: context.rootDir,
      sourceDir,
      maxFiles
    });
    const findings = [];
    const shouldRequireTestScript = requireTestScript ?? true;
    const shouldCheckSecrets = checkSecrets ?? true;
    const packageJson = project.packageJson;
    const cdsSummary = summarizeCdsAnalyses(project.cdsAnalyses);

    validateProjectShape({
      project,
      packageJson,
      shouldRequireTestScript,
      findings
    });
    validateCdsModel({
      cdsSummary,
      allowPublicServices: allowPublicServices ?? false,
      findings
    });
    await validateHandlers({
      root: context.rootDir,
      files: project.jsFiles,
      findings
    });
    if (shouldCheckSecrets) {
      await validateSecretFiles({
        root: context.rootDir,
        project,
        findings
      });
    }

    const effectiveMaxFindings = maxFindings ?? 300;
    const truncated = findings.length > effectiveMaxFindings;
    const slicedFindings = findings.slice(0, effectiveMaxFindings);
    const summary = createSummary(slicedFindings);

    return outputSchema.parse({
      sourceDir: project.sourceDir,
      scanned: {
        files: project.files.length,
        cdsFiles: project.cdsFiles.length,
        handlerFiles: project.jsFiles.length
      },
      valid: summary.bySeverity.high === 0,
      summary: {
        ...summary,
        truncated
      },
      findings: slicedFindings
    });
  }
};

function validateProjectShape(input) {
  const { project, packageJson, shouldRequireTestScript, findings } = input;
  const cdsVersion = getDependencyVersion(packageJson, "@sap/cds");
  if (!cdsVersion) {
    findings.push(createFinding({
      rule: "CAP_PROJECT_MISSING_CDS_DEPENDENCY",
      severity: "high",
      category: "project",
      file: "package.json",
      message: "package.json does not declare @sap/cds.",
      suggestion: "Add @sap/cds as a dependency so runtime and tooling assumptions are explicit."
    }));
  }
  if (!project.detectedFiles.srvDir) {
    findings.push(createFinding({
      rule: "CAP_PROJECT_MISSING_SRV_DIR",
      severity: "medium",
      category: "project",
      file: null,
      message: "No srv directory was detected.",
      suggestion: "Use a srv directory for service definitions and handlers in standard CAP layout."
    }));
  }
  if (shouldRequireTestScript && !packageJson?.scripts?.test) {
    findings.push(createFinding({
      rule: "CAP_TEST_SCRIPT_MISSING",
      severity: "medium",
      category: "testing",
      file: "package.json",
      message: "No npm test script is declared.",
      suggestion: "Add a repeatable CAP test command, for example using cds test or a project-specific test runner."
    }));
  }
  if ((getDependencyVersion(packageJson, "@sap/hana-client") || getDependencyVersion(packageJson, "hdb")) && !project.detectedFiles.mtaYaml) {
    findings.push(createFinding({
      rule: "CAP_HANA_DEPLOYMENT_DESCRIPTOR_MISSING",
      severity: "medium",
      category: "deployment",
      file: null,
      message: "HANA dependency detected but no mta.yaml/mta.yml was found.",
      suggestion: "Add or verify deployment descriptors before Cloud Foundry or HDI deployment."
    }));
  }
}

function validateCdsModel(input) {
  const { cdsSummary, allowPublicServices, findings } = input;
  for (const service of cdsSummary.services) {
    if (!allowPublicServices && !service.secured) {
      findings.push(createFinding({
        rule: "CAP_SERVICE_AUTH_MISSING",
        severity: "high",
        category: "service",
        file: service.path,
        line: service.line,
        message: `Service ${service.name} has no nearby @requires/@restrict annotation.`,
        suggestion: "Add explicit authorization annotations or pass allowPublicServices=true for intentional public APIs."
      }));
    }
  }

  for (const entity of cdsSummary.entities) {
    if (entity.kind === "entity" && !entity.source && !entity.hasKey) {
      findings.push(createFinding({
        rule: "CAP_ENTITY_KEY_MISSING",
        severity: "high",
        category: "model",
        file: entity.file,
        line: entity.line,
        message: `Entity ${entity.name} has no key field.`,
        suggestion: "Define a stable key field or include cuid/managed aspects where appropriate."
      }));
    }
  }
}

async function validateHandlers(input) {
  const { root, files, findings } = input;
  for (const file of files) {
    if (!isLikelyCapHandler(file)) {
      continue;
    }
    const content = await readTextFile(file, root);
    const rawSqlTemplate = /(?:cds|db|tx)\.run\s*\(\s*`[\s\S]*?\$\{[\s\S]*?`/m;
    const rawSqlConcat = /(?:cds|db|tx)\.run\s*\(\s*["'`](?:SELECT|UPDATE|DELETE|INSERT)[\s\S]{0,200}\+/im;
    if (rawSqlTemplate.test(content) || rawSqlConcat.test(content)) {
      findings.push(createFinding({
        rule: "CAP_HANDLER_DYNAMIC_SQL",
        severity: "high",
        category: "security",
        file,
        line: findLine(content, rawSqlTemplate.test(content) ? content.match(rawSqlTemplate).index : content.match(rawSqlConcat).index),
        message: "Dynamic SQL construction was detected in a CAP handler.",
        suggestion: "Use CQN builders, parameterized queries, or cds.ql tagged templates with bound values."
      }));
    }

    if (/\.on\s*\(\s*["']READ["'][\s\S]{0,250}SELECT\.from\s*\([^)]*\)(?![\s\S]{0,250}\.limit\s*\()/m.test(content)) {
      findings.push(createFinding({
        rule: "CAP_HANDLER_UNBOUNDED_READ",
        severity: "medium",
        category: "handler",
        file,
        line: findLine(content, "READ"),
        message: "Custom READ handler appears to query without an explicit limit nearby.",
        suggestion: "Respect request paging or apply a defensive limit for custom reads over large entity sets."
      }));
    }

    if (/req\.data\.[A-Za-z_$][\w$]*\s*=/.test(content)) {
      findings.push(createFinding({
        rule: "CAP_HANDLER_MUTATES_REQ_DATA",
        severity: "low",
        category: "handler",
        file,
        line: findLine(content, "req.data"),
        message: "Handler mutates req.data directly.",
        suggestion: "Prefer before handlers with explicit validation/defaulting and document intentional mutations."
      }));
    }
  }
}

async function validateSecretFiles(input) {
  const { root, project, findings } = input;
  const candidateFiles = [
    ".env",
    "default-env.json",
    ".cdsrc-private.json"
  ];
  for (const file of candidateFiles) {
    if (!await fileExists(file, root)) {
      continue;
    }
    const content = await readTextFile(file, root);
    if (/(password|passwd|clientsecret|secret|token)\s*[:=]\s*["']?[^"'\s{}]{6,}/i.test(content)) {
      findings.push(createFinding({
        rule: "CAP_SECRET_FILE_CONTAINS_CREDENTIAL",
        severity: project.detectedFiles.defaultEnvJson && file === "default-env.json" ? "medium" : "high",
        category: "security",
        file,
        line: findLine(content, content.match(/password|passwd|clientsecret|secret|token/i)?.index ?? 0),
        message: `Potential credential detected in ${file}.`,
        suggestion: "Keep local credentials out of commits and use environment bindings or secret management."
      }));
    }
  }
}

function isLikelyCapHandler(file) {
  const normalized = file.replaceAll("\\", "/");
  return (normalized.startsWith("srv/") || normalized.includes("/srv/"))
    && [".js", ".ts"].includes(path.extname(normalized).toLowerCase());
}

function createFinding(item) {
  const officialRefs = getSapOfficialRefsForRule(item.rule).map((reference) => ({
    id: reference.id,
    title: reference.title,
    url: reference.url,
    product: reference.product,
    topic: reference.topic
  }));

  return {
    rule: item.rule,
    severity: item.severity,
    category: item.category,
    file: item.file ?? null,
    line: item.line ?? null,
    message: item.message,
    suggestion: item.suggestion,
    officialRefs
  };
}
