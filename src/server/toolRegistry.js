import { z } from "zod";
import { normalizeError } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("tool-registry");

export class ToolRegistry {
  constructor() {
    // List of tool definitions to be registered on server startup.
    this.tools = [];
    this.toolNames = new Set();
  }

  registerTool(definition) {
    if (!definition || typeof definition !== "object") {
      throw new Error("Tool definition must be an object.");
    }
    if (typeof definition.name !== "string" || definition.name.trim().length === 0) {
      throw new Error("Tool definition must include a non-empty name.");
    }
    if (typeof definition.handler !== "function") {
      throw new Error(`Tool ${definition.name} must include a handler function.`);
    }
    if (this.toolNames.has(definition.name)) {
      throw new Error(`Duplicate tool name registration is not allowed: ${definition.name}`);
    }
    this.tools.push(definition);
    this.toolNames.add(definition.name);
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
