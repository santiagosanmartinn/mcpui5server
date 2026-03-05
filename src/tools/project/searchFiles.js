import { z } from "zod";
import { searchFiles } from "../../utils/fileSystem.js";

const inputSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(200).optional(),
  extensions: z.array(z.string().min(2)).optional()
}).strict();

const outputSchema = z.object({
  query: z.string(),
  matches: z.array(z.string())
});

export const searchProjectFilesTool = {
  name: "search_project_files",
  description: "Search workspace files by text query with optional extension filtering.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { query, maxResults, extensions } = inputSchema.parse(args);
    const fileExtensions = (extensions ?? []).map((value) => value.startsWith(".") ? value : `.${value}`);
    const matches = await searchFiles(query, {
      root: context.rootDir,
      maxResults: maxResults ?? 50,
      fileExtensions
    });

    return outputSchema.parse({
      query,
      matches
    });
  }
};

