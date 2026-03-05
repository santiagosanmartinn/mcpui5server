import { z } from "zod";
import { readTextFile } from "../../utils/fileSystem.js";

const inputSchema = z.object({
  path: z.string().min(1),
  maxChars: z.number().int().min(1).max(500000).optional()
}).strict();

const outputSchema = z.object({
  path: z.string(),
  content: z.string(),
  truncated: z.boolean()
});

export const readProjectFileTool = {
  name: "read_project_file",
  description: "Read a workspace file safely with project-root sandboxing.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { path, maxChars } = inputSchema.parse(args);
    const fullContent = await readTextFile(path, context.rootDir);
    const limit = maxChars ?? 120000;
    const truncated = fullContent.length > limit;
    const content = truncated ? `${fullContent.slice(0, limit)}\n\n[...truncated...]` : fullContent;

    return outputSchema.parse({
      path,
      content,
      truncated
    });
  }
};

