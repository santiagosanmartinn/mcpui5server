#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server/mcpServer.js";

async function main() {
  // Build and connect MCP server over stdio for local tool clients.
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stdin.on("close", () => {
    if (typeof server.close === "function") {
      server.close().catch(() => {
        // Best-effort shutdown.
      });
    }
  });
}

main().catch((error) => {
  console.error("Failed to start SAPUI5 MCP server:", error);
  process.exit(1);
});
