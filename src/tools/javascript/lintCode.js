import { z } from "zod";
import { lintJavaScript } from "../../utils/validator.js";

const inputSchema = z.object({
  code: z.string().min(1)
}).strict();

const outputSchema = z.object({
  warnings: z.array(
    z.object({
      rule: z.string(),
      message: z.string(),
      line: z.number().int().positive().nullable()
    })
  ),
  suggestedFixes: z.array(z.string())
});

export const lintJavaScriptCodeTool = {
  name: "lint_javascript_code",
  description: "Run ESLint-style static checks and return warnings plus suggested fixes.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { code } = inputSchema.parse(args);
    const basic = lintJavaScript(code);
    const warnings = [];

    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/\bvar\b/.test(line)) {
        warnings.push({
          rule: "no-var",
          message: "Use let or const instead of var.",
          line: i + 1
        });
      }
      if (/console\.log\s*\(/.test(line)) {
        warnings.push({
          rule: "no-console",
          message: "Avoid console.log in production code.",
          line: i + 1
        });
      }
      if (/==[^=]/.test(line) || /!=[^=]/.test(line)) {
        warnings.push({
          rule: "eqeqeq",
          message: "Use strict equality operators (=== / !==).",
          line: i + 1
        });
      }
    }

    for (const message of basic.warnings) {
      warnings.push({
        rule: "custom-check",
        message,
        line: null
      });
    }

    return outputSchema.parse({
      warnings,
      suggestedFixes: basic.suggestions
    });
  }
};

