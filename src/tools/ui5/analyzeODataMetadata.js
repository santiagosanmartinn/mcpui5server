import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { readTextFile } from "../../utils/fileSystem.js";
import { fetchText } from "../../utils/http.js";

const inputSchema = z.object({
  metadataXml: z.string().min(20).optional(),
  metadataPath: z.string().min(1).optional(),
  metadataUrl: z.string().url().optional(),
  serviceUrl: z.string().url().optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxEntities: z.number().int().min(1).max(500).optional()
}).strict().superRefine((value, ctx) => {
  const sources = [
    value.metadataXml,
    value.metadataPath,
    value.metadataUrl,
    value.serviceUrl
  ].filter((item) => item !== undefined);

  if (sources.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide one metadata source: metadataXml, metadataPath, metadataUrl, or serviceUrl."
    });
  }

  if (sources.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide only one metadata source at a time."
    });
  }
});

const propertySchema = z.object({
  name: z.string(),
  type: z.string().nullable(),
  nullable: z.boolean().nullable(),
  isCollection: z.boolean(),
  maxLength: z.string().nullable(),
  precision: z.string().nullable(),
  scale: z.string().nullable()
});

const navigationSchema = z.object({
  name: z.string(),
  type: z.string().nullable(),
  isCollection: z.boolean(),
  nullable: z.boolean().nullable(),
  relationship: z.string().nullable(),
  fromRole: z.string().nullable(),
  toRole: z.string().nullable()
});

const entityTypeSchema = z.object({
  namespace: z.string(),
  name: z.string(),
  fullName: z.string(),
  keys: z.array(z.string()),
  properties: z.array(propertySchema),
  navigationProperties: z.array(navigationSchema)
});

const entitySetSchema = z.object({
  container: z.string(),
  name: z.string(),
  entityType: z.string().nullable()
});

const singletonSchema = z.object({
  container: z.string(),
  name: z.string(),
  type: z.string().nullable()
});

const operationParameterSchema = z.object({
  name: z.string(),
  type: z.string().nullable(),
  nullable: z.boolean().nullable(),
  isCollection: z.boolean()
});

const operationSchema = z.object({
  namespace: z.string(),
  name: z.string(),
  fullName: z.string(),
  isBound: z.boolean().nullable(),
  returnType: z.string().nullable(),
  parameters: z.array(operationParameterSchema)
});

const operationImportSchema = z.object({
  container: z.string(),
  name: z.string(),
  operation: z.string().nullable(),
  entitySet: z.string().nullable(),
  httpMethod: z.string().nullable()
});

const outputSchema = z.object({
  source: z.object({
    mode: z.enum(["inline", "file", "url", "service"]),
    metadataPath: z.string().nullable(),
    metadataUrl: z.string().nullable()
  }),
  protocol: z.object({
    edmxVersion: z.string().nullable(),
    odataVersion: z.enum(["2.0", "4.0", "unknown"])
  }),
  summary: z.object({
    schemas: z.number().int().nonnegative(),
    entityTypesTotal: z.number().int().nonnegative(),
    entityTypesReturned: z.number().int().nonnegative(),
    entitySets: z.number().int().nonnegative(),
    singletons: z.number().int().nonnegative(),
    actions: z.number().int().nonnegative(),
    functions: z.number().int().nonnegative(),
    actionImports: z.number().int().nonnegative(),
    functionImports: z.number().int().nonnegative(),
    diagnostics: z.number().int().nonnegative()
  }),
  model: z.object({
    namespaces: z.array(z.string()),
    entityTypes: z.array(entityTypeSchema),
    entitySets: z.array(entitySetSchema),
    singletons: z.array(singletonSchema),
    actions: z.array(operationSchema),
    functions: z.array(operationSchema),
    actionImports: z.array(operationImportSchema),
    functionImports: z.array(operationImportSchema)
  }),
  diagnostics: z.array(
    z.object({
      severity: z.enum(["info", "warn"]),
      code: z.string(),
      message: z.string()
    })
  )
});

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  trimValues: true,
  parseTagValue: false,
  removeNSPrefix: true
});

export const analyzeODataMetadataTool = {
  name: "analyze_odata_metadata",
  description: "Analyze OData V2/V4 metadata from XML, file, URL, or service root and return entities, properties, navigation, and operations.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      metadataXml,
      metadataPath,
      metadataUrl,
      serviceUrl,
      timeoutMs,
      maxEntities
    } = inputSchema.parse(args);

    const root = context.rootDir;
    const selectedTimeout = timeoutMs ?? 15000;
    const selectedMaxEntities = maxEntities ?? 200;

    const source = await resolveSource({
      metadataXml,
      metadataPath,
      metadataUrl,
      serviceUrl,
      timeoutMs: selectedTimeout,
      root
    });

    const validation = XMLValidator.validate(source.xml);
    if (validation !== true) {
      const detail = validation?.err ?? {};
      throw new ToolError(`Invalid OData metadata XML: ${detail.msg ?? "Unknown parse error."}`, {
        code: "ODATA_METADATA_INVALID_XML",
        details: {
          line: detail.line ?? null,
          col: detail.col ?? null
        }
      });
    }

    let parsed;
    try {
      parsed = xmlParser.parse(source.xml);
    } catch (error) {
      throw new ToolError(`Unable to parse OData metadata XML: ${error.message}`, {
        code: "ODATA_METADATA_PARSE_FAILED"
      });
    }

    const analysis = analyzeMetadataObject(parsed, selectedMaxEntities);
    return outputSchema.parse({
      source: {
        mode: source.mode,
        metadataPath: source.metadataPath,
        metadataUrl: source.metadataUrl
      },
      protocol: analysis.protocol,
      summary: analysis.summary,
      model: analysis.model,
      diagnostics: analysis.diagnostics
    });
  }
};

async function resolveSource(input) {
  const {
    metadataXml,
    metadataPath,
    metadataUrl,
    serviceUrl,
    timeoutMs,
    root
  } = input;

  if (metadataXml) {
    return {
      mode: "inline",
      metadataPath: null,
      metadataUrl: null,
      xml: metadataXml
    };
  }

  if (metadataPath) {
    const xml = await readTextFile(metadataPath, root);
    return {
      mode: "file",
      metadataPath,
      metadataUrl: null,
      xml
    };
  }

  if (metadataUrl) {
    const xml = await fetchMetadataFromUrl(metadataUrl, timeoutMs);
    return {
      mode: "url",
      metadataPath: null,
      metadataUrl,
      xml
    };
  }

  if (serviceUrl) {
    const resolvedMetadataUrl = toMetadataUrl(serviceUrl);
    const xml = await fetchMetadataFromUrl(resolvedMetadataUrl, timeoutMs);
    return {
      mode: "service",
      metadataPath: null,
      metadataUrl: resolvedMetadataUrl,
      xml
    };
  }

  throw new ToolError("No metadata source provided.", {
    code: "ODATA_METADATA_SOURCE_REQUIRED"
  });
}

async function fetchMetadataFromUrl(url, timeoutMs) {
  try {
    return await fetchText(url, {
      timeoutMs,
      headers: {
        Accept: "application/xml,text/xml,application/atomsvc+xml,*/*",
        "User-Agent": "sapui5-mcp-server/1.0.0"
      }
    });
  } catch (error) {
    if (error instanceof ToolError) {
      throw error;
    }
    throw new ToolError(`Unable to fetch OData metadata: ${error.message}`, {
      code: "ODATA_METADATA_UNAVAILABLE"
    });
  }
}

function analyzeMetadataObject(parsed, maxEntities) {
  const diagnostics = [];
  const edmx = resolveEdmxNode(parsed);
  const schemas = resolveSchemas(parsed, edmx);

  if (schemas.length === 0) {
    diagnostics.push({
      severity: "warn",
      code: "NO_SCHEMAS_FOUND",
      message: "No Schema nodes were found in metadata."
    });
  }

  const namespaces = unique(
    schemas.map((schema) => getAttribute(schema, "Namespace")).filter(Boolean)
  );

  const allEntityTypes = [];
  const entitySets = [];
  const singletons = [];
  const actions = [];
  const functions = [];
  const actionImports = [];
  const functionImports = [];

  for (const schema of schemas) {
    const namespace = getAttribute(schema, "Namespace") ?? "default";

    for (const entityType of asArray(schema.EntityType)) {
      allEntityTypes.push(parseEntityType(entityType, namespace));
    }

    for (const action of asArray(schema.Action)) {
      actions.push(parseOperation(action, namespace));
    }

    for (const operation of asArray(schema.Function)) {
      functions.push(parseOperation(operation, namespace));
    }

    for (const container of asArray(schema.EntityContainer)) {
      const containerName = getAttribute(container, "Name") ?? "default";
      for (const entitySet of asArray(container.EntitySet)) {
        entitySets.push({
          container: containerName,
          name: getAttribute(entitySet, "Name") ?? "UnnamedEntitySet",
          entityType: getAttribute(entitySet, "EntityType")
        });
      }
      for (const singleton of asArray(container.Singleton)) {
        singletons.push({
          container: containerName,
          name: getAttribute(singleton, "Name") ?? "UnnamedSingleton",
          type: getAttribute(singleton, "Type")
        });
      }
      for (const actionImport of asArray(container.ActionImport)) {
        actionImports.push(parseOperationImport(actionImport, containerName, "Action"));
      }
      for (const functionImport of asArray(container.FunctionImport)) {
        functionImports.push(parseOperationImport(functionImport, containerName, "Function"));
      }
    }
  }

  const returnedEntityTypes = allEntityTypes.slice(0, maxEntities);
  if (allEntityTypes.length > returnedEntityTypes.length) {
    diagnostics.push({
      severity: "info",
      code: "ENTITY_TYPES_TRUNCATED",
      message: `Entity types truncated to ${maxEntities} items.`
    });
  }

  if (entitySets.length === 0) {
    diagnostics.push({
      severity: "warn",
      code: "NO_ENTITY_SETS",
      message: "No EntitySet definitions found."
    });
  }

  const protocol = detectProtocol(edmx);

  return {
    protocol,
    summary: {
      schemas: schemas.length,
      entityTypesTotal: allEntityTypes.length,
      entityTypesReturned: returnedEntityTypes.length,
      entitySets: entitySets.length,
      singletons: singletons.length,
      actions: actions.length,
      functions: functions.length,
      actionImports: actionImports.length,
      functionImports: functionImports.length,
      diagnostics: diagnostics.length
    },
    model: {
      namespaces,
      entityTypes: returnedEntityTypes,
      entitySets,
      singletons,
      actions,
      functions,
      actionImports,
      functionImports
    },
    diagnostics
  };
}

function resolveEdmxNode(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  if (parsed.Edmx) {
    return parsed.Edmx;
  }
  return null;
}

function resolveSchemas(parsed, edmx) {
  const schemas = [];
  if (edmx?.DataServices?.Schema) {
    schemas.push(...asArray(edmx.DataServices.Schema));
  }
  if (edmx?.Schema) {
    schemas.push(...asArray(edmx.Schema));
  }
  if (parsed?.Schema) {
    schemas.push(...asArray(parsed.Schema));
  }
  return schemas.filter((schema) => schema && typeof schema === "object");
}

function parseEntityType(entityType, namespace) {
  const name = getAttribute(entityType, "Name") ?? "UnnamedEntityType";
  const keys = asArray(entityType?.Key?.PropertyRef)
    .map((key) => getAttribute(key, "Name"))
    .filter(Boolean);

  const properties = asArray(entityType.Property).map((property) => {
    const rawType = getAttribute(property, "Type");
    return {
      name: getAttribute(property, "Name") ?? "UnnamedProperty",
      type: rawType,
      nullable: parseNullableAttribute(getAttribute(property, "Nullable")),
      isCollection: isCollectionType(rawType),
      maxLength: getAttribute(property, "MaxLength"),
      precision: getAttribute(property, "Precision"),
      scale: getAttribute(property, "Scale")
    };
  });

  const navigationProperties = asArray(entityType.NavigationProperty).map((property) => {
    const rawType = getAttribute(property, "Type");
    return {
      name: getAttribute(property, "Name") ?? "UnnamedNavigationProperty",
      type: rawType,
      isCollection: isCollectionType(rawType),
      nullable: parseNullableAttribute(getAttribute(property, "Nullable")),
      relationship: getAttribute(property, "Relationship"),
      fromRole: getAttribute(property, "FromRole"),
      toRole: getAttribute(property, "ToRole")
    };
  });

  return {
    namespace,
    name,
    fullName: `${namespace}.${name}`,
    keys,
    properties,
    navigationProperties
  };
}

function parseOperation(operation, namespace) {
  const name = getAttribute(operation, "Name") ?? "UnnamedOperation";
  const parameters = asArray(operation.Parameter).map((parameter) => {
    const rawType = getAttribute(parameter, "Type");
    return {
      name: getAttribute(parameter, "Name") ?? "UnnamedParameter",
      type: rawType,
      nullable: parseNullableAttribute(getAttribute(parameter, "Nullable")),
      isCollection: isCollectionType(rawType)
    };
  });

  const returnTypeNode = operation.ReturnType;
  const returnType = returnTypeNode && typeof returnTypeNode === "object"
    ? getAttribute(returnTypeNode, "Type")
    : null;

  return {
    namespace,
    name,
    fullName: `${namespace}.${name}`,
    isBound: parseBooleanAttribute(getAttribute(operation, "IsBound")),
    returnType,
    parameters
  };
}

function parseOperationImport(operationImport, containerName, operationAttributeName) {
  return {
    container: containerName,
    name: getAttribute(operationImport, "Name") ?? "UnnamedOperationImport",
    operation: getAttribute(operationImport, operationAttributeName),
    entitySet: getAttribute(operationImport, "EntitySet"),
    httpMethod: getAttribute(operationImport, "HttpMethod")
  };
}

function detectProtocol(edmx) {
  const edmxVersion = getAttribute(edmx, "Version");
  const dataServiceVersion = getAttribute(edmx?.DataServices, "DataServiceVersion");

  if (startsWithMajor(edmxVersion, 4)) {
    return {
      edmxVersion,
      odataVersion: "4.0"
    };
  }

  if (startsWithMajor(dataServiceVersion, 2) || startsWithMajor(dataServiceVersion, 3)) {
    return {
      edmxVersion,
      odataVersion: "2.0"
    };
  }

  if (startsWithMajor(edmxVersion, 1)) {
    return {
      edmxVersion,
      odataVersion: "2.0"
    };
  }

  return {
    edmxVersion,
    odataVersion: "unknown"
  };
}

function toMetadataUrl(serviceUrl) {
  const normalized = serviceUrl.trim();
  if (normalized.includes("$metadata")) {
    return normalized;
  }
  if (normalized.endsWith("/")) {
    return `${normalized}$metadata`;
  }
  return `${normalized}/$metadata`;
}

function asArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function getAttribute(node, name) {
  if (!node || typeof node !== "object") {
    return null;
  }
  const value = node[`@_${name}`];
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

function parseNullableAttribute(value) {
  if (value === null) {
    return null;
  }
  return value.toLowerCase() !== "false";
}

function parseBooleanAttribute(value) {
  if (value === null) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return null;
}

function startsWithMajor(value, major) {
  if (!value) {
    return false;
  }
  return value.trim().startsWith(`${major}.`) || value.trim() === String(major);
}

function isCollectionType(type) {
  if (!type) {
    return false;
  }
  return type.startsWith("Collection(");
}

function unique(values) {
  return Array.from(new Set(values));
}
