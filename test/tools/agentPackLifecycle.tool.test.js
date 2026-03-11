import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { scaffoldProjectAgentsTool } from "../../src/tools/agents/scaffoldProjectAgents.js";
import { saveAgentPackTool } from "../../src/tools/agents/saveAgentPack.js";
import { listAgentPacksTool } from "../../src/tools/agents/listAgentPacks.js";
import { applyAgentPackTool } from "../../src/tools/agents/applyAgentPack.js";
import { validateProjectAgentsTool } from "../../src/tools/agents/validateProjectAgents.js";

describe("agent pack lifecycle tools", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-agent-pack-"));
    const manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.pack" },
        "sap.ui5": {}
      }, null, 2)}\n`,
      "utf8"
    );

    await scaffoldProjectAgentsTool.handler(
      {
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("saves, lists, and applies an agent pack", async () => {
    const saved = await saveAgentPackTool.handler(
      {
        packName: "Base UI5 Pack",
        packVersion: "1.0.0",
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(saved.changed).toBe(true);
    expect(saved.applyResult?.patchId).toMatch(/^patch-/);
    expect(saved.pack.slug).toBe("base-ui5-pack");

    const catalog = await listAgentPacksTool.handler(
      {},
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(catalog.exists).toBe(true);
    expect(catalog.packs.length).toBe(1);
    expect(catalog.packs[0].slug).toBe("base-ui5-pack");

    const applied = await applyAgentPackTool.handler(
      {
        packSlug: "base-ui5-pack",
        outputDir: ".codex/mcp/agents-from-pack",
        includeVscodeMcp: false,
        dryRun: false,
        allowOverwrite: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(applied.integrity.fingerprintMatches).toBe(true);
    expect(applied.scaffoldResult.changed).toBe(true);
    expect(applied.scaffoldResult.applyResult?.patchId).toMatch(/^patch-/);
    await expect(
      fs.access(path.join(tempRoot, ".codex", "mcp", "agents-from-pack", "agent.blueprint.json"))
    ).resolves.toBeUndefined();

    const validation = await validateProjectAgentsTool.handler(
      {
        strict: true,
        blueprintPath: ".codex/mcp/agents-from-pack/agent.blueprint.json",
        agentsGuidePath: ".codex/mcp/agents-from-pack/AGENTS.generated.md"
      },
      {
        context: { rootDir: tempRoot }
      }
    );
    expect(validation.valid).toBe(true);
  });
});
