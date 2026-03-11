import { z } from "zod";
import { applyProjectPatch } from "../../utils/patchWriter.js";

const hashPattern = /^[a-f0-9]{64}$/;

const inputSchema = z.object({
  changes: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string(),
      expectedOldHash: z.string().regex(hashPattern).optional()
    }).strict()
  ).min(1).max(50),
  reason: z.string().max(200).optional()
}).strict();

const outputSchema = z.object({
  patchId: z.string().nullable(),
  appliedAt: z.string(),
  reason: z.string().nullable(),
  changedFiles: z.array(
    z.object({
      path: z.string(),
      changed: z.boolean(),
      oldHash: z.string().nullable(),
      newHash: z.string(),
      bytesBefore: z.number().int().nonnegative(),
      bytesAfter: z.number().int().nonnegative()
    })
  ),
  skippedFiles: z.array(z.string())
});

export const applyProjectPatchTool = {
  name: "apply_project_patch",
  description: "Apply one or more safe workspace file changes and create rollback metadata for later restore.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { changes, reason } = inputSchema.parse(args);
    const result = await applyProjectPatch(changes, {
      root: context.rootDir,
      reason: reason ?? null
    });
    return outputSchema.parse(result);
  }
};
