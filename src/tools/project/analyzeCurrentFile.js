import { z } from "zod";
import { readTextFile } from "../../utils/fileSystem.js";
import { analyzeFileStructure, detectControllerPattern } from "../../utils/parser.js";

const inputSchema = z.object({
  path: z.string().min(1)
}).strict();

const outputSchema = z.object({
  path: z.string(),
  imports: z.object({
    esmImports: z.array(z.string()),
    sapUiDefineDependencies: z.array(z.string())
  }),
  classNames: z.array(z.string()),
  controllerPattern: z.string(),
  controllerMethods: z.array(z.string())
});

export const analyzeCurrentFileTool = {
  name: "analyze_current_file",
  description: "Analyze the current file for imports, class structure, and controller methods.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { path } = inputSchema.parse(args);
    const code = await readTextFile(path, context.rootDir);
    // AST-backed parser utilities expose metadata for IDE automation and audits.
    const analysis = analyzeFileStructure(code);

    return outputSchema.parse({
      path,
      imports: analysis.imports,
      classNames: analysis.classNames,
      controllerPattern: detectControllerPattern(code),
      controllerMethods: analysis.controllerMethods
    });
  }
};
