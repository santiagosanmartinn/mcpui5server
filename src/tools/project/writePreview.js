import { z } from "zod";
import { previewFileWrite } from "../../utils/patchWriter.js";

const inputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  maxDiffLines: z.number().int().min(10).max(400).optional()
}).strict();

const outputSchema = z.object({
  path: z.string(),
  existsBefore: z.boolean(),
  changed: z.boolean(),
  oldHash: z.string().nullable(),
  newHash: z.string(),
  bytesBefore: z.number().int().nonnegative(),
  bytesAfter: z.number().int().nonnegative(),
  lineSummary: z.object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative()
  }),
  diffPreview: z.string(),
  diffTruncated: z.boolean()
});

export const writeProjectFilePreviewTool = {
  name: "write_project_file_preview",
  description: "Preview a safe workspace file write with hashes, line summary, and textual diff preview.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { path, content, maxDiffLines } = inputSchema.parse(args);
    const preview = await previewFileWrite(path, content, {
      root: context.rootDir,
      maxDiffLines
    });
    return outputSchema.parse(preview);
  }
};
