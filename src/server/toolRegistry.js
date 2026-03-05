import { z } from "zod";
import { normalizeError } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("tool-registry");

export class ToolRegistry {
  constructor() {
    // List of tool definitions to be registered on server startup.
    this.tools = [];
  }

  registerTool(definition) {
    this.tools.push(definition);
  }

  registerMany(definitions) {
    for (const definition of definitions) {
      this.registerTool(definition);
    }
  }

  applyToServer(server, context) {
    for (const tool of this.tools) {
      server.registerTool(
        tool.name,
        {
          title: tool.title ?? tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema ?? z.object({}).strict(),
          outputSchema: tool.outputSchema,
          annotations: tool.annotations
        },
        async (args, extra) => {
          try {
            // Handlers receive parsed args plus shared runtime context.
            const output = await tool.handler(args ?? {}, {
              context,
              extra
            });

            if (tool.outputSchema) {
              // Structured payload enables deterministic client parsing.
              return {
                structuredContent: output,
                content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
              };
            }

            if (typeof output === "string") {
              return {
                content: [{ type: "text", text: output }]
              };
            }

            return {
              content: [{ type: "text", text: JSON.stringify(output, null, 2) }]
            };
          } catch (error) {
            // Normalize all failures to stable machine-readable error shape.
            const normalized = normalizeError(error);
            logger.error(`Tool failed: ${tool.name}`, {
              code: normalized.code,
              message: normalized.message,
              details: normalized.details
            });
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      error: {
                        code: normalized.code,
                        message: normalized.message,
                        details: normalized.details
                      }
                    },
                    null,
                    2
                  )
                }
              ]
            };
          }
        }
      );
    }
  }
}
