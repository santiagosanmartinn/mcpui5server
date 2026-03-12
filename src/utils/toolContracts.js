import crypto from "node:crypto";

export function createToolContractSnapshot(tools) {
  const contracts = tools
    .map((tool) => ({
      name: tool.name,
      title: tool.title ?? null,
      description: tool.description ?? "",
      inputSchema: describeZodSchema(tool.inputSchema),
      outputSchema: describeZodSchema(tool.outputSchema)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    schemaVersion: "1.0.0",
    tools: contracts
  };
}

export function calculateToolContractHash(snapshot) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
}

export function describeZodSchema(schema) {
  if (!schema || typeof schema !== "object" || !schema._def) {
    return null;
  }
  return describeInternal(schema);
}

function describeInternal(schema) {
  const def = schema?._def ?? {};
  const typeName = String(def.typeName ?? "ZodUnknown");

  switch (typeName) {
    case "ZodString":
      return { kind: "string" };
    case "ZodNumber":
      return { kind: "number" };
    case "ZodBoolean":
      return { kind: "boolean" };
    case "ZodAny":
      return { kind: "any" };
    case "ZodUnknown":
      return { kind: "unknown" };
    case "ZodNever":
      return { kind: "never" };
    case "ZodNull":
      return { kind: "null" };
    case "ZodUndefined":
      return { kind: "undefined" };
    case "ZodVoid":
      return { kind: "void" };
    case "ZodLiteral":
      return {
        kind: "literal",
        value: normalizeLiteral(def.value)
      };
    case "ZodEnum":
      return {
        kind: "enum",
        values: Array.isArray(def.values) ? [...def.values] : []
      };
    case "ZodNativeEnum":
      return {
        kind: "native-enum",
        values: normalizeNativeEnumValues(def.values)
      };
    case "ZodArray":
      return {
        kind: "array",
        item: describeInternal(def.type)
      };
    case "ZodObject":
      return {
        kind: "object",
        unknownKeys: def.unknownKeys ?? "strip",
        keys: describeObjectShape(def.shape),
        catchall: def.catchall && def.catchall?._def?.typeName !== "ZodNever"
          ? describeInternal(def.catchall)
          : null
      };
    case "ZodOptional":
      return {
        kind: "optional",
        inner: describeInternal(def.innerType)
      };
    case "ZodNullable":
      return {
        kind: "nullable",
        inner: describeInternal(def.innerType)
      };
    case "ZodDefault":
      return {
        kind: "default",
        inner: describeInternal(def.innerType)
      };
    case "ZodEffects":
      return {
        kind: "effects",
        effectType: def.effect?.type ?? "unknown",
        inner: describeInternal(def.schema)
      };
    case "ZodRecord":
      return {
        kind: "record",
        key: def.keyType ? describeInternal(def.keyType) : { kind: "string" },
        value: describeInternal(def.valueType)
      };
    case "ZodUnion":
      return {
        kind: "union",
        options: Array.isArray(def.options)
          ? def.options.map((item) => describeInternal(item))
          : []
      };
    case "ZodDiscriminatedUnion":
      return {
        kind: "discriminated-union",
        discriminator: def.discriminator ?? null,
        options: normalizeDiscriminatedOptions(def.options)
      };
    case "ZodTuple":
      return {
        kind: "tuple",
        items: Array.isArray(def.items) ? def.items.map((item) => describeInternal(item)) : []
      };
    case "ZodIntersection":
      return {
        kind: "intersection",
        left: describeInternal(def.left),
        right: describeInternal(def.right)
      };
    case "ZodPipeline":
      return {
        kind: "pipeline",
        in: describeInternal(def.in),
        out: describeInternal(def.out)
      };
    case "ZodLazy":
      return {
        kind: "lazy"
      };
    case "ZodDate":
      return {
        kind: "date"
      };
    case "ZodMap":
      return {
        kind: "map",
        key: describeInternal(def.keyType),
        value: describeInternal(def.valueType)
      };
    case "ZodSet":
      return {
        kind: "set",
        value: describeInternal(def.valueType)
      };
    default:
      return {
        kind: stripZodPrefix(typeName)
      };
  }
}

function describeObjectShape(shapeDef) {
  if (!shapeDef) {
    return {};
  }
  const shape = typeof shapeDef === "function" ? shapeDef() : shapeDef;
  const keys = Object.keys(shape).sort();
  const result = {};
  for (const key of keys) {
    result[key] = describeInternal(shape[key]);
  }
  return result;
}

function normalizeLiteral(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLiteral(item));
  }
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = normalizeLiteral(value[key]);
    }
    return sorted;
  }
  return String(value);
}

function normalizeNativeEnumValues(enumObject) {
  if (!enumObject || typeof enumObject !== "object") {
    return [];
  }
  const values = Object.values(enumObject)
    .filter((item) => typeof item === "string" || typeof item === "number")
    .map((item) => String(item));
  return Array.from(new Set(values)).sort();
}

function normalizeDiscriminatedOptions(optionsMap) {
  if (!optionsMap || typeof optionsMap !== "object") {
    return [];
  }
  const values = Array.isArray(optionsMap) ? optionsMap : Array.from(optionsMap.values());
  return values.map((item) => describeInternal(item));
}

function stripZodPrefix(typeName) {
  return typeName.startsWith("Zod")
    ? typeName.slice(3).toLowerCase()
    : typeName.toLowerCase();
}

