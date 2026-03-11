import { z } from "zod";
import { refactorJavaScriptWithAst } from "../../utils/refactor.js";

const inputSchema = z.object({
  code: z.string().min(1)
}).strict();

const outputSchema = z.object({
  refactoredCode: z.string(),
  changes: z.array(z.string())
});

export const refactorJavaScriptCodeTool = {
  name: "refactor_javascript_code",
  description: "Refactor JavaScript code using modern syntax while preserving readability.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { code } = inputSchema.parse(args);
    const result = refactorJavaScriptWithAst(code);
    return outputSchema.parse(result);
  }
};
