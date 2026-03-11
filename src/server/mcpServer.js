import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolRegistry } from "./toolRegistry.js";
import { workspaceRoot } from "../utils/fileSystem.js";
import { createLogger } from "../utils/logger.js";
import { allTools } from "../tools/index.js";
import { ensureProjectMcpCurrentTool } from "../tools/agents/ensureProjectMcpCurrent.js";
import { prepareLegacyProjectForAiTool } from "../tools/agents/prepareLegacyProjectForAi.js";

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
  runProjectAutoEnsure(context).catch((error) => {
    logger.warn("Automatic MCP project ensure failed.", {
      error: error?.message ?? String(error)
    });
  });

  return server;
}

async function runProjectAutoEnsure(context) {
  const enabled = process.env.MCP_AUTO_ENSURE_PROJECT !== "false";
  if (!enabled) {
    logger.info("Automatic MCP project ensure disabled by MCP_AUTO_ENSURE_PROJECT=false.");
    return;
  }

  const autoApply = process.env.MCP_AUTO_ENSURE_PROJECT_APPLY !== "false";
  const report = await ensureProjectMcpCurrentTool.handler(
    {
      autoApply,
      runPostValidation: true,
      failOnValidation: false,
      runQualityGate: false,
      reason: "server-startup:auto-ensure"
    },
    { context }
  );

  logger.info("Automatic MCP project ensure finished.", {
    actionTaken: report.actionTaken,
    statusBefore: report.statusBefore,
    statusAfter: report.statusAfter,
    autoApply
  });

  const autoPrepareContextEnabled = process.env.MCP_AUTO_PREPARE_CONTEXT !== "false";
  if (!autoPrepareContextEnabled) {
    logger.info("Automatic legacy context preparation disabled by MCP_AUTO_PREPARE_CONTEXT=false.");
    return;
  }

  const autoPrepareContextApply = process.env.MCP_AUTO_PREPARE_CONTEXT_APPLY !== "false";
  const prepareReport = await prepareLegacyProjectForAiTool.handler(
    {
      autoApply: autoPrepareContextApply,
      runEnsureProjectMcp: false,
      reason: "server-startup:auto-prepare-context"
    },
    { context }
  );
  logger.info("Automatic legacy context preparation finished.", {
    autoApply: autoPrepareContextApply,
    readyForAutopilot: prepareReport.readyForAutopilot,
    needsUserInput: prepareReport.intake.needsUserInput,
    collectIntake: prepareReport.ran.collectIntake,
    analyzeBaseline: prepareReport.ran.analyzeBaseline,
    buildContextIndex: prepareReport.ran.buildContextIndex
  });
}
