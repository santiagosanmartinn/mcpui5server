import { z } from "zod";
import { securityScanJavaScript } from "../../utils/validator.js";

const inputSchema = z.object({
  code: z.string().min(1)
}).strict();

const outputSchema = z.object({
  safe: z.boolean(),
  findings: z.array(
    z.object({
      severity: z.enum(["LOW", "MEDIUM", "HIGH"]),
      description: z.string()
    })
  )
});

export const securityCheckJavaScriptTool = {
  name: "security_check_javascript",
  description: "Detect risky JavaScript patterns including eval, command injection, and prototype pollution.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { code } = inputSchema.parse(args);
    const report = securityScanJavaScript(code);
    return outputSchema.parse(report);
  }
};

