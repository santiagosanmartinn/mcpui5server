import { z } from "zod";

const inputSchema = z.object({
  controllerName: z.string().min(1),
  methods: z.array(z.string().min(1)).default([])
}).strict();

const outputSchema = z.object({
  controllerName: z.string(),
  code: z.string()
});

const LIFECYCLE_METHODS = [
  "onInit",
  "onBeforeRendering",
  "onAfterRendering",
  "onExit"
];

export const generateUi5ControllerTool = {
  name: "generate_ui5_controller",
  description: "Generate a SAPUI5 controller skeleton with lifecycle hooks and JSDoc.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { controllerName, methods } = inputSchema.parse(args);
    // Always include lifecycle methods, then merge caller-provided custom methods.
    const normalizedMethods = normalizeMethods(methods);
    const allMethods = Array.from(new Set([...LIFECYCLE_METHODS, ...normalizedMethods]));

    const code = [
      "sap.ui.define([",
      "  \"sap/ui/core/mvc/Controller\"",
      "], function (Controller) {",
      "  \"use strict\";",
      "",
      `  return Controller.extend("${controllerName}", {`,
      ...allMethods.flatMap((methodName, index) => {
        const block = [
          "    /**",
          `     * ${describeMethod(methodName)}`,
          "     */",
          `    ${methodName}: function () {`,
          "    }"
        ];
        if (index < allMethods.length - 1) {
          block[block.length - 1] += ",";
        }
        return block.concat("");
      }),
      "  });",
      "});",
      ""
    ].join("\n");

    return outputSchema.parse({
      controllerName,
      code
    });
  }
};

function normalizeMethods(methods) {
  return methods
    .map((name) => name.trim())
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

function describeMethod(name) {
  switch (name) {
    case "onInit":
      return "Lifecycle hook called when the controller is instantiated.";
    case "onBeforeRendering":
      return "Lifecycle hook called before the view is rendered.";
    case "onAfterRendering":
      return "Lifecycle hook called after the view is rendered.";
    case "onExit":
      return "Lifecycle hook called when the controller is destroyed.";
    default:
      return `Custom controller method: ${name}.`;
  }
}
