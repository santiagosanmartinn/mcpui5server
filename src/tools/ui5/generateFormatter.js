import { z } from "zod";

const inputSchema = z.object({
  formatterName: z.string().min(1).default("formatter"),
  functions: z.array(z.string().min(1)).default(["toUpper", "formatBoolean"])
}).strict();

const outputSchema = z.object({
  formatterName: z.string(),
  code: z.string()
});

export const generateUi5FormatterTool = {
  name: "generate_ui5_formatter",
  description: "Generate a formatter module that follows SAPUI5 module structure.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { formatterName, functions } = inputSchema.parse(args);
    // Ensure formatter API has stable and valid JavaScript identifiers.
    const functionNames = Array.from(new Set(functions.map((name) => sanitizeIdentifier(name)).filter(Boolean)));

    const code = [
      "sap.ui.define([], function () {",
      "  \"use strict\";",
      "",
      `  const ${sanitizeIdentifier(formatterName)} = {`,
      ...functionNames.flatMap((name, index) => {
        const block = [
          "    /**",
          `     * Formatter helper: ${name}.`,
          "     * @param {any} value Input value",
          "     * @returns {any} Formatted value",
          "     */",
          `    ${name}: function (value) {`,
          ...implementationFor(name).map((line) => `      ${line}`),
          "    }"
        ];
        if (index < functionNames.length - 1) {
          block[block.length - 1] += ",";
        }
        return block.concat("");
      }),
      "  };",
      "",
      `  return ${sanitizeIdentifier(formatterName)};`,
      "});",
      ""
    ].join("\n");

    return outputSchema.parse({
      formatterName,
      code
    });
  }
};

function sanitizeIdentifier(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const identifier = trimmed.replace(/[^A-Za-z0-9_$]/g, "_");
  return /^[A-Za-z_$]/.test(identifier) ? identifier : `_${identifier}`;
}

function implementationFor(name) {
  if (name.toLowerCase().includes("upper")) {
    return [
      "if (value == null) {",
      "  return \"\";",
      "}",
      "return String(value).toUpperCase();"
    ];
  }

  if (name.toLowerCase().includes("boolean")) {
    return [
      "return value ? \"Yes\" : \"No\";"
    ];
  }

  return [
    "return value;"
  ];
}
