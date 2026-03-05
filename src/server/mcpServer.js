import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolRegistry } from "./toolRegistry.js";
import { workspaceRoot } from "../utils/fileSystem.js";
import { createLogger } from "../utils/logger.js";
import { allTools } from "../tools/index.js";

const logger = createLogger("mcp-server");

const SERVER_INFO = {
  name: "sapui5-mcp-server",
  version: "1.0.0"
};

export function createMcpServer() {
  // High-level MCP server instance exposed through stdio transport.
  const server = new McpServer(SERVER_INFO);
  // Central registry keeps tool registration logic in one place.
  const registry = new ToolRegistry();
  registry.registerMany(allTools);

  // Shared runtime context injected into every tool handler.
  const context = {
    rootDir: workspaceRoot(),
    logger
  };

  // Register tools dynamically so MCP clients can discover them.
  registry.applyToServer(server, context);
  logger.info("Server initialized", {
    toolCount: allTools.length,
    rootDir: context.rootDir
  });

  return server;
}
