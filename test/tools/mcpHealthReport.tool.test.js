import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { mcpHealthReportTool } from "../../src/tools/project/mcpHealthReport.js";
import { calculateToolContractHash, createToolContractSnapshot } from "../../src/utils/toolContracts.js";

describe("mcp_health_report tool", () => {
  let tempRoot;
  let runtimeSnapshot;
  let runtimeHash;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-health-report-"));
    runtimeSnapshot = {
      schemaVersion: "1.0.0",
      tools: [
        {
          name: "tool_a",
          title: null,
          description: "A",
          inputSchema: {
            kind: "object",
            unknownKeys: "strip",
            keys: {},
            catchall: null
          },
          outputSchema: null
        },
        {
          name: "tool_b",
          title: null,
          description: "B",
          inputSchema: {
            kind: "object",
            unknownKeys: "strip",
            keys: {},
            catchall: null
          },
          outputSchema: null
        }
      ]
    };
    runtimeHash = calculateToolContractHash(runtimeSnapshot);

    await fs.mkdir(path.join(tempRoot, "docs", "contracts"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "docs"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "docs", "referencia-tools.md"),
      [
        "### `tool_a`",
        "",
        "### `tool_b`",
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempRoot, "docs", "ejemplos-tools.md"),
      [
        "## 1) `tool_a`",
        "",
        "## 2) `tool_b`",
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempRoot, "docs", "contracts", "tool-contracts.snapshot.json"),
      `${JSON.stringify(runtimeSnapshot, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("returns in-sync health report when docs/contracts match runtime", async () => {
    const report = await mcpHealthReportTool.handler(
      {
        includeToolNames: true
      },
      {
        context: {
          rootDir: tempRoot,
          serverInfo: {
            name: "sapui5-mcp-server",
            version: "1.0.0"
          },
          registeredToolNames: ["tool_a", "tool_b"],
          contractSnapshot: runtimeSnapshot,
          contractHash: runtimeHash
        }
      }
    );

    expect(report.tools.registered).toBe(2);
    expect(report.tools.duplicates).toEqual([]);
    expect(report.tools.names).toEqual(["tool_a", "tool_b"]);
    expect(report.docs.referenceInSync).toBe(true);
    expect(report.docs.examplesInSync).toBe(true);
    expect(report.contracts.inSync).toBe(true);
  });

  it("flags mismatches for docs and contract snapshot drift", async () => {
    await fs.writeFile(
      path.join(tempRoot, "docs", "ejemplos-tools.md"),
      "## 1) `tool_a`\n",
      "utf8"
    );
    const driftedSnapshot = createToolContractSnapshot([
      {
        name: "tool_a",
        description: "A",
        inputSchema: null,
        outputSchema: null
      }
    ]);
    await fs.writeFile(
      path.join(tempRoot, "docs", "contracts", "tool-contracts.snapshot.json"),
      `${JSON.stringify(driftedSnapshot, null, 2)}\n`,
      "utf8"
    );

    const report = await mcpHealthReportTool.handler(
      {},
      {
        context: {
          rootDir: tempRoot,
          serverInfo: {
            name: "sapui5-mcp-server",
            version: "1.0.0"
          },
          registeredToolNames: ["tool_a", "tool_b"],
          contractSnapshot: runtimeSnapshot,
          contractHash: runtimeHash
        }
      }
    );

    expect(report.docs.examplesInSync).toBe(false);
    expect(report.docs.missingFromExamples).toEqual(["tool_b"]);
    expect(report.contracts.inSync).toBe(false);
  });
});

