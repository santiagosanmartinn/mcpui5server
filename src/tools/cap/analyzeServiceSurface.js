import { z } from "zod";
import { readTextFile } from "../../utils/fileSystem.js";
import { getSapOfficialRefsForRule } from "../documentation/sapOfficialDocs.js";
import { findLine, readCapProject } from "./common.js";
import { analyzeCdsModelContractTool } from "./analyzeCdsModelContract.js";

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  maxFindings: z.number().int().min(10).max(2000).optional()
}).strict();

const officialRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  product: z.enum(["cap", "ui5"]),
  topic: z.string()
});

const findingSchema = z.object({
  rule: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  category: z.enum(["service", "security", "handler", "odata"]),
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  target: z.string().nullable(),
  message: z.string(),
  suggestion: z.string(),
  officialRefs: z.array(officialRefSchema)
});

const outputSchema = z.object({
  sourceDir: z.string(),
  scanned: z.object({
    files: z.number().int().nonnegative(),
    cdsFiles: z.number().int().nonnegative(),
    handlerFiles: z.number().int().nonnegative()
  }),
  summary: z.object({
    services: z.number().int().nonnegative(),
    entitySets: z.number().int().nonnegative(),
    actions: z.number().int().nonnegative(),
    functions: z.number().int().nonnegative(),
    securedServices: z.number().int().nonnegative(),
    handlerBindings: z.number().int().nonnegative(),
    findings: z.number().int().nonnegative(),
    highFindings: z.number().int().nonnegative()
  }),
  services: z.array(z.object({
    name: z.string(),
    file: z.string(),
    line: z.number().int().positive().nullable(),
    secured: z.boolean(),
    odataPath: z.string(),
    annotations: z.array(z.string()),
    entitySets: z.array(z.object({
      name: z.string(),
      source: z.string().nullable(),
      entityType: z.string().nullable(),
      hasHandler: z.boolean()
    })),
    operations: z.array(z.object({
      kind: z.enum(["action", "function"]),
      name: z.string(),
      httpMethod: z.enum(["POST", "GET"]),
      hasHandler: z.boolean()
    })),
    handlerFiles: z.array(z.string())
  })),
  handlerBindings: z.array(z.object({
    file: z.string(),
    line: z.number().int().positive().nullable(),
    event: z.string(),
    target: z.string().nullable()
  })),
  findings: z.array(findingSchema),
  recommendedCommands: z.array(z.string())
});

export const analyzeCapServiceSurfaceTool = {
  name: "analyze_cap_service_surface",
  description: "Analyze SAP CAP service/OData surface, exposed entity sets, actions/functions, security annotations, and handler coverage signals.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { sourceDir, maxFiles, maxFindings } = inputSchema.parse(args);
    const project = await readCapProject({
      root: context.rootDir,
      sourceDir,
      maxFiles
    });
    const contract = await analyzeCdsModelContractTool.handler({
      sourceDir,
      maxFiles,
      maxFindings
    }, { context });
    const handlerBindings = await scanHandlerBindings({
      root: context.rootDir,
      files: project.jsFiles.filter(isLikelyCapHandler)
    });
    const servicePathHints = await scanServicePathHints({
      root: context.rootDir,
      files: project.cdsFiles
    });
    const handlerTargets = new Set(handlerBindings.map((binding) => binding.target).filter(Boolean));
    const services = contract.services.map((service) => {
      const entitySets = service.exposures.map((exposure) => ({
        name: exposure.name,
        source: exposure.source,
        entityType: resolveEntityType(contract.entities, exposure),
        hasHandler: handlerTargets.has(exposure.name) || handlerTargets.has(exposure.source)
      }));
      const operations = service.actions.map((operation) => ({
        kind: operation.kind,
        name: operation.name,
        httpMethod: operation.kind === "action" ? "POST" : "GET",
        hasHandler: handlerTargets.has(operation.name)
      }));
      return {
        name: service.name,
        file: service.file,
        line: service.line,
        secured: service.secured,
        odataPath: servicePathHints.get(service.name) ?? `/odata/v4/${service.name}`,
        annotations: service.annotations,
        entitySets,
        operations,
        handlerFiles: resolveHandlerFiles(handlerBindings, [...entitySets.map((item) => item.name), ...operations.map((item) => item.name)])
      };
    });
    const findings = buildFindings(services);
    const effectiveMaxFindings = maxFindings ?? 300;
    const limitedFindings = findings.slice(0, effectiveMaxFindings);

    return outputSchema.parse({
      sourceDir: project.sourceDir,
      scanned: {
        files: project.files.length,
        cdsFiles: project.cdsFiles.length,
        handlerFiles: project.jsFiles.filter(isLikelyCapHandler).length
      },
      summary: {
        services: services.length,
        entitySets: services.reduce((total, service) => total + service.entitySets.length, 0),
        actions: services.reduce((total, service) => total + service.operations.filter((operation) => operation.kind === "action").length, 0),
        functions: services.reduce((total, service) => total + service.operations.filter((operation) => operation.kind === "function").length, 0),
        securedServices: services.filter((service) => service.secured).length,
        handlerBindings: handlerBindings.length,
        findings: limitedFindings.length,
        highFindings: limitedFindings.filter((finding) => finding.severity === "high").length
      },
      services,
      handlerBindings,
      findings: limitedFindings,
      recommendedCommands: [
        "npx cds compile srv --to edmx",
        "npx cds compile srv --to csn",
        "npm test"
      ]
    });
  }
};

async function scanHandlerBindings(input) {
  const { root, files } = input;
  const bindings = [];
  const pattern = /\.(before|on|after)\s*\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*["'`]([^"'`]+)["'`])?/g;
  for (const file of files) {
    const content = await readTextFile(file, root);
    let match = pattern.exec(content);
    while (match) {
      bindings.push({
        file,
        line: findLine(content, match.index),
        event: match[2],
        target: match[3] ?? null
      });
      match = pattern.exec(content);
    }
  }
  return bindings;
}

async function scanServicePathHints(input) {
  const { root, files } = input;
  const hints = new Map();
  for (const file of files) {
    const content = await readTextFile(file, root);
    const clean = stripComments(content);
    const pattern = /(?:@path\s*:\s*['"]([^'"]+)['"]\s*)?service\s+([A-Za-z_][\w.]*)\s*\{/g;
    let match = pattern.exec(clean);
    while (match) {
      if (match[1]) {
        hints.set(match[2], `/odata/v4/${match[1].replace(/^\/+/, "")}`);
      }
      match = pattern.exec(clean);
    }
  }
  return hints;
}

function buildFindings(services) {
  const findings = [];
  for (const service of services) {
    if (!service.secured) {
      findings.push(createFinding({
        rule: "CAP_SERVICE_SURFACE_PUBLIC_SERVICE",
        severity: "high",
        category: "security",
        file: service.file,
        line: service.line,
        target: service.name,
        message: `Service ${service.name} is exposed without a nearby authorization annotation.`,
        suggestion: "Add @requires/@restrict or document that the service is intentionally public."
      }));
    }
    if (service.entitySets.length === 0 && service.operations.length === 0) {
      findings.push(createFinding({
        rule: "CAP_SERVICE_SURFACE_EMPTY",
        severity: "medium",
        category: "service",
        file: service.file,
        line: service.line,
        target: service.name,
        message: `Service ${service.name} has no exposed entity sets or operations.`,
        suggestion: "Expose projections/actions before using the service as a UI or API contract."
      }));
    }
    for (const operation of service.operations) {
      if (!operation.hasHandler) {
        findings.push(createFinding({
          rule: "CAP_SERVICE_SURFACE_OPERATION_HANDLER_MISSING",
          severity: "medium",
          category: "handler",
          file: service.file,
          line: service.line,
          target: `${service.name}.${operation.name}`,
          message: `${operation.kind} ${operation.name} is exposed but no matching handler binding was detected.`,
          suggestion: "Add or verify a service handler before generating client/UI flows around this operation."
        }));
      }
    }
  }
  return findings;
}

function createFinding(item) {
  return {
    rule: item.rule,
    severity: item.severity,
    category: item.category,
    file: item.file ?? null,
    line: item.line ?? null,
    target: item.target ?? null,
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

function resolveEntityType(entities, exposure) {
  const candidates = [exposure.source, exposure.name].filter(Boolean);
  const entity = entities.find((item) => candidates.some((candidate) => namesMatch(item, candidate)));
  return entity?.qualifiedName ?? exposure.source ?? null;
}

function resolveHandlerFiles(bindings, targets) {
  const targetSet = new Set(targets.filter(Boolean));
  return Array.from(new Set(bindings
    .filter((binding) => binding.target && targetSet.has(binding.target))
    .map((binding) => binding.file)))
    .sort((a, b) => a.localeCompare(b));
}

function namesMatch(entity, value) {
  return entity.name === value || entity.qualifiedName === value || entity.name.endsWith(`.${value}`) || value.endsWith(`.${entity.name}`);
}

function isLikelyCapHandler(file) {
  const normalized = file.replaceAll("\\", "/");
  return (normalized.startsWith("srv/") || normalized.includes("/srv/"))
    && [".js", ".ts"].some((extension) => normalized.endsWith(extension));
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}
