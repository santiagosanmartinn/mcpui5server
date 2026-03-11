import { z } from "zod";
import { validateControllerMethods, validateUi5CodeQuality } from "../../utils/validator.js";

const inputSchema = z.object({
  code: z.string().min(1),
  expectedControllerName: z.string().min(1).optional(),
  sourceType: z.enum(["auto", "javascript", "xml"]).optional()
}).strict();

const issueSchema = z.object({
  severity: z.enum(["error", "warn"]),
  code: z.string(),
  message: z.string()
});

const issueDetailSchema = issueSchema.extend({
  category: z.enum(["structure", "mvc", "naming", "performance"]),
  ruleVersion: z.string()
});

const outputSchema = z.object({
  isValid: z.boolean(),
  issues: z.array(issueSchema),
  issueDetails: z.array(issueDetailSchema),
  issuesByCategory: z.object({
    structure: z.array(issueDetailSchema),
    mvc: z.array(issueDetailSchema),
    naming: z.array(issueDetailSchema),
    performance: z.array(issueDetailSchema)
  }),
  rulesVersion: z.string(),
  sourceType: z.enum(["javascript", "xml"]),
  controllerMethods: z.array(z.string()),
  missingLifecycleMethods: z.array(z.string())
});

export const validateUi5CodeTool = {
  name: "validate_ui5_code",
  description: "Validate SAPUI5 code for sap.ui.define usage, dependency order, naming, and MVC separation.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { code, expectedControllerName, sourceType } = inputSchema.parse(args);
    // Combines structural UI5 checks and lifecycle method extraction.
    const quality = validateUi5CodeQuality(code, {
      expectedControllerName,
      sourceType: sourceType ?? "auto"
    });
    const methodReport = quality.sourceType === "javascript"
      ? validateControllerMethods(code)
      : { methods: [], missing: [] };
    const missingLifecycleMethods = methodReport.missing.filter((name) =>
      ["onInit", "onBeforeRendering", "onAfterRendering", "onExit"].includes(name)
    );

    return outputSchema.parse({
      isValid: quality.isValid,
      issues: quality.issues,
      issueDetails: quality.issueDetails,
      issuesByCategory: quality.issuesByCategory,
      rulesVersion: quality.rulesVersion,
      sourceType: quality.sourceType,
      controllerMethods: methodReport.methods,
      missingLifecycleMethods
    });
  }
};
