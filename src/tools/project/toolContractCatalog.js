import { z } from "zod";
import { fileExists, readJsonFile } from "../../utils/fileSystem.js";
import {
  calculateToolContractHash,
  calculateSingleToolContractHash,
  DEFAULT_TOOL_CONTRACT_VERSION,
  TOOL_CONTRACT_SNAPSHOT_SCHEMA_VERSION,
  normalizeToolContractEntry
} from "../../utils/toolContracts.js";

const DEFAULT_CONTRACT_SNAPSHOT_PATH = "docs/contracts/tool-contracts.snapshot.json";
const SNAPSHOT_STATUSES = ["not_compared", "matches_snapshot", "drifted_from_snapshot", "missing_in_snapshot"];

const inputSchema = z.object({
  toolNames: z.array(z.string().min(1)).max(200).optional(),
  includeSchemas: z.boolean().optional(),
  includeHashes: z.boolean().optional(),
  includeSnapshotStatus: z.boolean().optional(),
  snapshotPath: z.string().min(1).optional()
}).strict();

const outputSchema = z.object({
  generatedAt: z.string(),
  server: z.object({
    name: z.string(),
    version: z.string()
  }),
  runtime: z.object({
    schemaVersion: z.string(),
    hash: z.string().nullable(),
    toolCount: z.number().int().nonnegative()
  }),
  snapshot: z.object({
    compared: z.boolean(),
    path: z.string(),
    exists: z.boolean(),
    schemaVersion: z.string().nullable(),
    hash: z.string().nullable(),
    inSync: z.boolean().nullable(),
    missingRequestedTools: z.array(z.string()),
    extraTools: z.array(z.string())
  }),
  summary: z.object({
    selectedTools: z.number().int().nonnegative(),
    includeSchemas: z.boolean(),
    includeHashes: z.boolean(),
    matchingTools: z.number().int().nonnegative(),
    driftedTools: z.number().int().nonnegative(),
    missingFromSnapshot: z.number().int().nonnegative()
  }),
  contracts: z.array(
    z.object({
      name: z.string(),
      title: z.string().nullable(),
      description: z.string(),
      contractVersion: z.string(),
      hash: z.string().nullable(),
      inputSchema: z.unknown().nullable(),
      outputSchema: z.unknown().nullable(),
      snapshotStatus: z.enum(SNAPSHOT_STATUSES),
      snapshotHash: z.string().nullable()
    })
  )
});

export const toolContractCatalogTool = {
  name: "tool_contract_catalog",
  description: "Inspect runtime MCP tool contracts with per-tool contract versions, hashes, and optional snapshot drift status.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      toolNames,
      includeSchemas,
      includeHashes,
      includeSnapshotStatus,
      snapshotPath
    } = inputSchema.parse(args);

    const runtimeSnapshot = normalizeSnapshot(context.contractSnapshot);
    const runtimeTools = Array.isArray(runtimeSnapshot.tools) ? runtimeSnapshot.tools : [];
    const runtimeHash = context.contractHash ?? calculateToolContractHash(runtimeSnapshot);
    const requestedNames = Array.isArray(toolNames)
      ? Array.from(new Set(toolNames.map((item) => String(item).trim()).filter(Boolean)))
      : [];
    const selectedContracts = requestedNames.length > 0
      ? runtimeTools.filter((tool) => requestedNames.includes(tool.name))
      : runtimeTools;
    const missingRequestedTools = requestedNames.filter(
      (name) => !runtimeTools.some((tool) => tool.name === name)
    );

    const shouldIncludeSchemas = includeSchemas ?? false;
    const shouldIncludeHashes = includeHashes ?? true;
    const shouldCompareSnapshot = includeSnapshotStatus ?? true;
    const selectedSnapshotPath = normalizeRelativePath(snapshotPath ?? DEFAULT_CONTRACT_SNAPSHOT_PATH);

    let snapshotExists = false;
    let snapshotSchemaVersion = null;
    let snapshotHash = null;
    let snapshotInSync = null;
    let snapshotToolsMap = new Map();
    let extraTools = [];

    if (shouldCompareSnapshot) {
      snapshotExists = await fileExists(selectedSnapshotPath, context.rootDir);
      if (snapshotExists) {
        const savedSnapshot = normalizeSnapshot(await readJsonFile(selectedSnapshotPath, context.rootDir));
        snapshotSchemaVersion = savedSnapshot.schemaVersion;
        snapshotHash = calculateToolContractHash(savedSnapshot);
        snapshotInSync = snapshotHash === runtimeHash;
        snapshotToolsMap = new Map(savedSnapshot.tools.map((tool) => [tool.name, tool]));
        extraTools = savedSnapshot.tools
          .map((tool) => tool.name)
          .filter((name) => !runtimeTools.some((tool) => tool.name === name));
      } else {
        snapshotInSync = false;
      }
    }

    const contracts = selectedContracts.map((tool) => {
      const runtimeHash = calculateSingleToolContractHash(tool);
      const snapshotTool = snapshotToolsMap.get(tool.name);
      const snapshotToolHash = snapshotTool ? calculateSingleToolContractHash(snapshotTool) : null;
      const snapshotStatus = !shouldCompareSnapshot
        ? "not_compared"
        : (!snapshotExists || !snapshotTool)
            ? "missing_in_snapshot"
            : (snapshotToolHash === runtimeHash ? "matches_snapshot" : "drifted_from_snapshot");

      return {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        contractVersion: tool.contractVersion ?? DEFAULT_TOOL_CONTRACT_VERSION,
        hash: shouldIncludeHashes ? runtimeHash : null,
        inputSchema: shouldIncludeSchemas ? tool.inputSchema : null,
        outputSchema: shouldIncludeSchemas ? tool.outputSchema : null,
        snapshotStatus,
        snapshotHash: shouldIncludeHashes ? snapshotToolHash : null
      };
    });

    return outputSchema.parse({
      generatedAt: new Date().toISOString(),
      server: {
        name: context.serverInfo?.name ?? "sapui5-mcp-server",
        version: context.serverInfo?.version ?? "unknown"
      },
      runtime: {
        schemaVersion: runtimeSnapshot.schemaVersion,
        hash: runtimeHash,
        toolCount: runtimeTools.length
      },
      snapshot: {
        compared: shouldCompareSnapshot,
        path: selectedSnapshotPath,
        exists: snapshotExists,
        schemaVersion: snapshotSchemaVersion,
        hash: snapshotHash,
        inSync: snapshotInSync,
        missingRequestedTools,
        extraTools
      },
      summary: {
        selectedTools: contracts.length,
        includeSchemas: shouldIncludeSchemas,
        includeHashes: shouldIncludeHashes,
        matchingTools: contracts.filter((contract) => contract.snapshotStatus === "matches_snapshot").length,
        driftedTools: contracts.filter((contract) => contract.snapshotStatus === "drifted_from_snapshot").length,
        missingFromSnapshot: contracts.filter((contract) => contract.snapshotStatus === "missing_in_snapshot").length
      },
      contracts
    });
  }
};

function normalizeSnapshot(snapshot) {
  return {
    schemaVersion: typeof snapshot?.schemaVersion === "string" && snapshot.schemaVersion.trim().length > 0
      ? snapshot.schemaVersion
      : TOOL_CONTRACT_SNAPSHOT_SCHEMA_VERSION,
    tools: Array.isArray(snapshot?.tools)
      ? snapshot.tools.map((tool) => normalizeToolContractEntry(tool)).sort((a, b) => a.name.localeCompare(b.name))
      : []
  };
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}
