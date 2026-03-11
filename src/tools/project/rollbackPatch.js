import { z } from "zod";
import { rollbackProjectPatch } from "../../utils/patchWriter.js";

const inputSchema = z.object({
  patchId: z.string().min(1)
}).strict();

const outputSchema = z.object({
  patchId: z.string(),
  alreadyRolledBack: z.boolean(),
  rolledBackAt: z.string(),
  restoredFiles: z.array(
    z.object({
      path: z.string(),
      action: z.enum(["restored", "deleted", "noop"])
    })
  )
});

export const rollbackProjectPatchTool = {
  name: "rollback_project_patch",
  description: "Rollback a previously applied patch using stored backup metadata.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { patchId } = inputSchema.parse(args);
    const result = await rollbackProjectPatch(patchId, {
      root: context.rootDir
    });
    return outputSchema.parse(result);
  }
};
