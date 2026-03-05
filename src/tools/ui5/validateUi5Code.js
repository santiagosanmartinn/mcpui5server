import { z } from "zod";
import { validateControllerMethods, validateUi5CodeQuality } from "../../utils/validator.js";

const inputSchema = z.object({
  code: z.string().min(1),
  expectedControllerName: z.string().min(1).optional()
}).strict();

const outputSchema = z.object({
  isValid: z.boolean(),
  issues: z.array(
    z.object({
      severity: z.enum(["error", "warn"]),
      code: z.string(),
      message: z.string()
    })
  ),
  controllerMethods: z.array(z.string()),
  missingLifecycleMethods: z.array(z.string())
});

export const validateUi5CodeTool = {
  name: "validate_ui5_code",
  description: "Validate SAPUI5 code for sap.ui.define usage, dependency order, naming, and MVC separation.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { code, expectedControllerName } = inputSchema.parse(args);
    // Combines structural UI5 checks and lifecycle method extraction.
    const quality = validateUi5CodeQuality(code, { expectedControllerName });
    const methodReport = validateControllerMethods(code);
    const missingLifecycleMethods = methodReport.missing.filter((name) =>
      ["onInit", "onBeforeRendering", "onAfterRendering", "onExit"].includes(name)
    );

    return outputSchema.parse({
      isValid: quality.isValid,
      issues: quality.issues,
      controllerMethods: methodReport.methods,
      missingLifecycleMethods
    });
  }
};
