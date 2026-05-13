import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { toolContractCatalogTool } from "../../src/tools/project/toolContractCatalog.js";
import { createToolContractSnapshot } from "../../src/utils/toolContracts.js";

describe("tool_contract_catalog tool", () => {
  let tempRoot;
  let runtimeSnapshot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-tool-contract-catalog-"));
    runtimeSnapshot = createToolContractSnapshot([
      {
        name: "tool_a",
        description: "A",
        contractVersion: "1.2.0",
        inputSchema: z.object({
          query: z.string()
        }),
        outputSchema: z.object({
          ok: z.boolean()
        }),
        handler: async () => ({ ok: true })
      },
      {
        name: "tool_b",
        description: "B",
        inputSchema: z.object({
          dryRun: z.boolean().optional()
        }),
        outputSchema: z.object({
          changed: z.boolean()
        }),
        handler: async () => ({ changed: false })
      }
    ]);

    await fs.mkdir(path.join(tempRoot, "docs", "contracts"), { recursive: true });
    const savedSnapshot = createToolContractSnapshot([
      {
        name: "tool_a",
        description: "A",
        contractVersion: "1.2.0",
        inputSchema: z.object({
          query: z.string()
        }),
        outputSchema: z.object({
          ok: z.boolean()
        }),
        handler: async () => ({ ok: true })
      },
      {
        name: "tool_b",
        description: "B drifted",
        inputSchema: z.object({
          dryRun: z.boolean().optional()
        }),
        outputSchema: z.object({
          changed: z.boolean()
        }),
        handler: async () => ({ changed: false })
      }
    ]);

    await fs.writeFile(
      path.join(tempRoot, "docs", "contracts", "tool-contracts.snapshot.json"),
      `${JSON.stringify(savedSnapshot, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("returns per-tool versions, hashes, and snapshot drift details", async () => {
    const report = await toolContractCatalogTool.handler(
      {
        toolNames: ["tool_a", "tool_b", "tool_missing"],
        includeSchemas: true,
        includeHashes: true
      },
      {
        context: {
          rootDir: tempRoot,
          serverInfo: {
            name: "sapui5-mcp-server",
            version: "1.0.0"
          },
          contractSnapshot: runtimeSnapshot
        }
      }
    );

    expect(report.runtime.schemaVersion).toBe("1.1.0");
    expect(report.snapshot.exists).toBe(true);
    expect(report.snapshot.missingRequestedTools).toEqual(["tool_missing"]);
    expect(report.summary.selectedTools).toBe(2);

    const toolA = report.contracts.find((contract) => contract.name === "tool_a");
    const toolB = report.contracts.find((contract) => contract.name === "tool_b");

    expect(toolA.contractVersion).toBe("1.2.0");
    expect(toolA.snapshotStatus).toBe("matches_snapshot");
    expect(toolA.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(toolA.inputSchema).toMatchObject({
      kind: "object"
    });

    expect(toolB.contractVersion).toBe("1.0.0");
    expect(toolB.snapshotStatus).toBe("drifted_from_snapshot");
    expect(report.summary.matchingTools).toBe(1);
    expect(report.summary.driftedTools).toBe(1);
  });

  it("can skip schemas and snapshot comparison for lighter responses", async () => {
    const report = await toolContractCatalogTool.handler(
      {
        includeSchemas: false,
        includeHashes: false,
        includeSnapshotStatus: false
      },
      {
        context: {
          rootDir: tempRoot,
          contractSnapshot: runtimeSnapshot
        }
      }
    );

    expect(report.snapshot.compared).toBe(false);
    expect(report.contracts.every((contract) => contract.inputSchema === null && contract.outputSchema === null)).toBe(true);
    expect(report.contracts.every((contract) => contract.hash === null && contract.snapshotHash === null)).toBe(true);
    expect(report.contracts.every((contract) => contract.snapshotStatus === "not_compared")).toBe(true);
  });
});
