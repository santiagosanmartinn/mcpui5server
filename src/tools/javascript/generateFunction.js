import { z } from "zod";

const inputSchema = z.object({
  description: z.string().min(5),
  runtime: z.enum(["browser", "node"]),
  typescript: z.boolean().default(false)
}).strict();

const outputSchema = z.object({
  functionName: z.string(),
  runtime: z.enum(["browser", "node"]),
  typescript: z.boolean(),
  code: z.string()
});

export const generateJavaScriptFunctionTool = {
  name: "generate_javascript_function",
  description: "Generate an ES2022 JavaScript or TypeScript function with JSDoc for browser or Node runtime.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { description, runtime, typescript } = inputSchema.parse(args);
    const functionName = toFunctionName(description);

    const code = typescript
      ? buildTypeScriptFunction(functionName, description, runtime)
      : buildJavaScriptFunction(functionName, description, runtime);

    return outputSchema.parse({
      functionName,
      runtime,
      typescript,
      code
    });
  }
};

function toFunctionName(description) {
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  if (words.length === 0) {
    return "generatedFunction";
  }
  return words
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}

function buildJavaScriptFunction(functionName, description, runtime) {
  const runtimeComment = runtime === "node" ? "Node.js runtime implementation." : "Browser runtime implementation.";
  return [
    "/**",
    ` * ${description}.`,
    " * @param {Record<string, unknown>} input Input payload",
    " * @returns {Promise<Record<string, unknown>>} Processed output",
    " */",
    `export async function ${functionName}(input = {}) {`,
    `  // ${runtimeComment}`,
    "  if (input == null || typeof input !== \"object\") {",
    "    throw new TypeError(\"input must be an object\");",
    "  }",
    "",
    "  const result = {",
    "    ...input,",
    "    processed: true",
    "  };",
    "",
    "  return result;",
    "}",
    ""
  ].join("\n");
}

function buildTypeScriptFunction(functionName, description, runtime) {
  const runtimeComment = runtime === "node" ? "Node.js runtime implementation." : "Browser runtime implementation.";
  return [
    "/**",
    ` * ${description}.`,
    " */",
    `export async function ${functionName}(`,
    "  input: Record<string, unknown> = {}",
    "): Promise<Record<string, unknown>> {",
    `  // ${runtimeComment}`,
    "  const result: Record<string, unknown> = {",
    "    ...input,",
    "    processed: true",
    "  };",
    "",
    "  return result;",
    "}",
    ""
  ].join("\n");
}

