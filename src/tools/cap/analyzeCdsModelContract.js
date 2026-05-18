import { z } from "zod";
import { readTextFile } from "../../utils/fileSystem.js";
import { getSapOfficialRefsForRule } from "../documentation/sapOfficialDocs.js";
import { findLine, readCapProject } from "./common.js";

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  maxFindings: z.number().int().min(10).max(2000).optional(),
  includeRawSnippets: z.boolean().optional()
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
  category: z.enum(["model", "service", "contract"]),
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  target: z.string().nullable(),
  message: z.string(),
  suggestion: z.string(),
  officialRefs: z.array(officialRefSchema)
});

const fieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  key: z.boolean(),
  localized: z.boolean(),
  association: z.boolean(),
  composition: z.boolean(),
  target: z.string().nullable(),
  cardinality: z.enum(["one", "many", "unknown"]).nullable()
});

const outputSchema = z.object({
  sourceDir: z.string(),
  scanned: z.object({
    files: z.number().int().nonnegative(),
    cdsFiles: z.number().int().nonnegative()
  }),
  namespaces: z.array(z.string()),
  summary: z.object({
    entities: z.number().int().nonnegative(),
    services: z.number().int().nonnegative(),
    projections: z.number().int().nonnegative(),
    actions: z.number().int().nonnegative(),
    functions: z.number().int().nonnegative(),
    associations: z.number().int().nonnegative(),
    compositions: z.number().int().nonnegative(),
    annotations: z.number().int().nonnegative(),
    findings: z.number().int().nonnegative(),
    highFindings: z.number().int().nonnegative()
  }),
  entities: z.array(z.object({
    name: z.string(),
    kind: z.enum(["entity", "view", "aspect", "type"]),
    namespace: z.string().nullable(),
    qualifiedName: z.string(),
    source: z.string().nullable(),
    file: z.string(),
    line: z.number().int().positive().nullable(),
    hasKey: z.boolean(),
    keyFields: z.array(z.string()),
    fieldCount: z.number().int().nonnegative(),
    fields: z.array(fieldSchema),
    associations: z.array(fieldSchema),
    annotations: z.array(z.string()),
    exposedByServices: z.array(z.string()),
    rawSnippet: z.string().nullable()
  })),
  services: z.array(z.object({
    name: z.string(),
    file: z.string(),
    line: z.number().int().positive().nullable(),
    secured: z.boolean(),
    exposures: z.array(z.object({
      name: z.string(),
      source: z.string().nullable()
    })),
    actions: z.array(z.object({
      kind: z.enum(["action", "function"]),
      name: z.string()
    })),
    annotations: z.array(z.string())
  })),
  findings: z.array(findingSchema),
  recommendedCommands: z.array(z.string())
});

export const analyzeCdsModelContractTool = {
  name: "analyze_cds_model_contract",
  description: "Analyze SAP CAP CDS model contracts: entities, keys, fields, associations, services, projections, actions, and contract risks.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { sourceDir, maxFiles, maxFindings, includeRawSnippets } = inputSchema.parse(args);
    const project = await readCapProject({
      root: context.rootDir,
      sourceDir,
      maxFiles
    });
    const files = [];
    for (const file of project.cdsFiles) {
      const content = await readTextFile(file, context.rootDir);
      files.push(parseCdsContractFile({
        file,
        content,
        includeRawSnippets: includeRawSnippets ?? false
      }));
    }

    const namespaces = uniqueSorted(files.map((analysis) => analysis.namespace).filter(Boolean));
    const entities = files.flatMap((analysis) => analysis.entities);
    const services = files.flatMap((analysis) => analysis.services);
    const knownEntityNames = new Set(entities.flatMap((entity) => [entity.name, entity.qualifiedName]));
    attachServiceExposures({ entities, services });
    const findings = buildFindings({
      entities,
      services,
      knownEntityNames
    });
    const effectiveMaxFindings = maxFindings ?? 300;
    const slicedFindings = findings.slice(0, effectiveMaxFindings);
    const actions = services.flatMap((service) => service.actions);
    const associations = entities.flatMap((entity) => entity.associations);

    return outputSchema.parse({
      sourceDir: project.sourceDir,
      scanned: {
        files: project.files.length,
        cdsFiles: project.cdsFiles.length
      },
      namespaces,
      summary: {
        entities: entities.filter((entity) => entity.kind === "entity").length,
        services: services.length,
        projections: entities.filter((entity) => entity.source).length
          + services.reduce((total, service) => total + service.exposures.filter((exposure) => exposure.source).length, 0),
        actions: actions.filter((action) => action.kind === "action").length,
        functions: actions.filter((action) => action.kind === "function").length,
        associations: associations.filter((field) => field.association).length,
        compositions: associations.filter((field) => field.composition).length,
        annotations: entities.reduce((total, entity) => total + entity.annotations.length, 0)
          + services.reduce((total, service) => total + service.annotations.length, 0),
        findings: slicedFindings.length,
        highFindings: slicedFindings.filter((finding) => finding.severity === "high").length
      },
      entities,
      services,
      findings: slicedFindings,
      recommendedCommands: [
        "npx cds compile srv --to csn",
        "npx cds lint"
      ]
    });
  }
};

function parseCdsContractFile(input) {
  const { file, content, includeRawSnippets } = input;
  const cleanContent = stripComments(content);
  const namespace = cleanContent.match(/\bnamespace\s+([A-Za-z_][\w.]*)\s*;/)?.[1] ?? null;
  const services = parseServices({ file, content, cleanContent });
  const entities = parseDefinitions({
    file,
    content,
    cleanContent,
    namespace,
    includeRawSnippets
  });

  return {
    file,
    namespace,
    entities,
    services
  };
}

function parseDefinitions(input) {
  const { file, content, cleanContent, namespace, includeRawSnippets } = input;
  const definitions = [];
  const definitionPattern = /((?:\s*@[\w.:-]+(?:\s*:\s*[^\n]+)?\n)*)\b(entity|view|aspect|type)\s+([A-Za-z_][\w.]*)\s*(?:as\s+(?:projection\s+on|select\s+from)\s+([A-Za-z_][\w.]*))?\s*\{/g;
  let match;
  while ((match = definitionPattern.exec(cleanContent))) {
    const openingBraceIndex = cleanContent.indexOf("{", match.index);
    const closingBraceIndex = findBlockEnd(cleanContent, openingBraceIndex);
    const body = cleanContent.slice(openingBraceIndex + 1, closingBraceIndex);
    const fields = parseFields(body);
    const name = match[3];
    const entityNamespace = name.includes(".") ? name.split(".").slice(0, -1).join(".") : namespace;
    const qualifiedName = name.includes(".") || !namespace ? name : `${namespace}.${name}`;
    definitions.push({
      name,
      kind: match[2],
      namespace: entityNamespace,
      qualifiedName,
      source: match[4] ?? null,
      file,
      line: findLine(content, match.index),
      hasKey: fields.some((field) => field.key),
      keyFields: fields.filter((field) => field.key).map((field) => field.name),
      fieldCount: fields.length,
      fields,
      associations: fields.filter((field) => field.association || field.composition),
      annotations: parseAnnotations(match[1]),
      exposedByServices: [],
      rawSnippet: includeRawSnippets
        ? cleanContent.slice(match.index, Math.min(closingBraceIndex + 1, match.index + 1200))
        : null
    });
  }

  return definitions;
}

function parseServices(input) {
  const { file, content, cleanContent } = input;
  const services = [];
  const servicePattern = /((?:\s*@[\w.:-]+(?:\s*:\s*[^\n]+)?\n)*)\bservice\s+([A-Za-z_][\w.]*)\s*\{/g;
  let match;
  while ((match = servicePattern.exec(cleanContent))) {
    const openingBraceIndex = cleanContent.indexOf("{", match.index);
    const closingBraceIndex = findBlockEnd(cleanContent, openingBraceIndex);
    const body = cleanContent.slice(openingBraceIndex + 1, closingBraceIndex);
    services.push({
      name: match[2],
      file,
      line: findLine(content, match.index),
      secured: hasSecurityAnnotationNear(cleanContent, match.index),
      exposures: parseServiceExposures(body),
      actions: parseServiceActions(body),
      annotations: parseAnnotations(match[1])
    });
  }
  return services;
}

function parseFields(body) {
  return splitCdsStatements(body)
    .map((statement) => statement.replace(/^\s*@[\w.:-]+(?:\s*:\s*[^\n]+)?\s*$/gm, "").trim())
    .map((statement) => statement.match(/^(key\s+)?([A-Za-z_][\w.]*)\s*:\s*(.+)$/s))
    .filter(Boolean)
    .map((match) => {
      const type = normalizeType(match[3]);
      const composition = /^Composition\s+of\b/i.test(type);
      const association = composition || /^Association\s+to\b/i.test(type);
      return {
        name: match[2],
        type,
        key: Boolean(match[1]),
        localized: /^localized\s+/i.test(type),
        association,
        composition,
        target: association ? type.match(/\bto\s+(?:many\s+)?([A-Za-z_][\w.]*)/i)?.[1] ?? null : null,
        cardinality: association ? (/to\s+many\b/i.test(type) ? "many" : "one") : null
      };
    });
}

function parseServiceExposures(body) {
  return Array.from(body.matchAll(/\bentity\s+([A-Za-z_][\w.]*)\s*(?:as\s+(?:projection\s+on|select\s+from)\s+([A-Za-z_][\w.]*))?/g))
    .map((match) => ({
      name: match[1],
      source: match[2] ?? null
    }));
}

function parseServiceActions(body) {
  return Array.from(body.matchAll(/\b(action|function)\s+([A-Za-z_][\w.]*)\s*\(/g))
    .map((match) => ({
      kind: match[1],
      name: match[2]
    }));
}

function attachServiceExposures(input) {
  const { entities, services } = input;
  for (const entity of entities) {
    const exposures = [];
    for (const service of services) {
      if (service.exposures.some((exposure) => namesMatch(entity, exposure.name) || namesMatch(entity, exposure.source))) {
        exposures.push(service.name);
      }
    }
    entity.exposedByServices = uniqueSorted(exposures);
  }
}

function buildFindings(input) {
  const { entities, services, knownEntityNames } = input;
  const findings = [];
  for (const entity of entities) {
    if (entity.kind === "entity" && !entity.source && !entity.hasKey) {
      findings.push(createFinding({
        rule: "CDS_CONTRACT_ENTITY_KEY_MISSING",
        severity: "high",
        category: "model",
        file: entity.file,
        line: entity.line,
        target: entity.qualifiedName,
        message: `Entity ${entity.qualifiedName} does not declare a key field.`,
        suggestion: "Define a stable key or include a CAP common aspect such as cuid where it fits the domain model."
      }));
    }
    for (const field of entity.fields) {
      if (isUnboundedString(field)) {
        findings.push(createFinding({
          rule: "CDS_CONTRACT_STRING_LENGTH_UNBOUNDED",
          severity: "medium",
          category: "model",
          file: entity.file,
          line: entity.line,
          target: `${entity.qualifiedName}.${field.name}`,
          message: `Field ${entity.qualifiedName}.${field.name} uses String without an explicit length.`,
          suggestion: "Confirm the persistence contract and prefer an explicit String length for bounded business attributes."
        }));
      }
      if ((field.association || field.composition) && field.target && !resolvesKnownEntity(field.target, knownEntityNames)) {
        findings.push(createFinding({
          rule: "CDS_CONTRACT_ASSOC_TARGET_UNKNOWN",
          severity: "medium",
          category: "contract",
          file: entity.file,
          line: entity.line,
          target: `${entity.qualifiedName}.${field.name}`,
          message: `Association ${entity.qualifiedName}.${field.name} targets ${field.target}, which was not found in scanned CDS files.`,
          suggestion: "Verify using aliases/sourceDir or add the missing target model before generating handlers or UI bindings."
        }));
      }
    }
  }
  for (const service of services) {
    if (service.exposures.length === 0 && service.actions.length === 0) {
      findings.push(createFinding({
        rule: "CDS_CONTRACT_SERVICE_EMPTY",
        severity: "medium",
        category: "service",
        file: service.file,
        line: service.line,
        target: service.name,
        message: `Service ${service.name} does not expose entities, actions, or functions.`,
        suggestion: "Expose at least one projection/action or remove the placeholder service before implementation planning."
      }));
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

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function splitCdsStatements(body) {
  const statements = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "{") {
      depth += 1;
    } else if (body[index] === "}") {
      depth -= 1;
    } else if (body[index] === ";" && depth === 0) {
      statements.push(body.slice(start, index));
      start = index + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
}

function findBlockEnd(content, openingBraceIndex) {
  let depth = 0;
  for (let index = openingBraceIndex; index < content.length; index += 1) {
    if (content[index] === "{") {
      depth += 1;
    } else if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return content.length;
}

function normalizeType(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*@.*$/g, "")
    .trim();
}

function parseAnnotations(value) {
  return Array.from(value.matchAll(/@[\w.:-]+/g)).map((match) => match[0]);
}

function hasSecurityAnnotationNear(content, index) {
  const before = content.slice(Math.max(0, index - 300), index);
  const serviceLine = content.slice(index, content.indexOf("{", index) + 1);
  return /@(requires|restrict|readonly|insertonly)/.test(`${before}\n${serviceLine}`);
}

function isUnboundedString(field) {
  return /^localized\s+String$/i.test(field.type) || /^String$/i.test(field.type);
}

function resolvesKnownEntity(target, knownEntityNames) {
  return Array.from(knownEntityNames).some((name) => name === target || name.endsWith(`.${target}`));
}

function namesMatch(entity, value) {
  if (!value) {
    return false;
  }
  return entity.name === value
    || entity.qualifiedName === value
    || entity.name.endsWith(`.${value}`)
    || value.endsWith(`.${entity.name}`);
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
