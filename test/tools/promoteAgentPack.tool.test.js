import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { promoteAgentPackTool } from "../../src/tools/agents/promoteAgentPack.js";

describe("promote_agent_pack tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-promote-pack-"));
    const catalogPath = path.join(tempRoot, ".codex", "mcp", "packs", "catalog.json");
    const metricsPath = path.join(tempRoot, ".codex", "mcp", "feedback", "metrics.json");
    await fs.mkdir(path.dirname(catalogPath), { recursive: true });
    await fs.mkdir(path.dirname(metricsPath), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("auto-promotes pack to recommended when score and evidence are strong", async () => {
    await writeCatalog(tempRoot, {
      schemaVersion: "1.0.0",
      packs: [
        {
          name: "Pack Alpha",
          slug: "pack-alpha",
          version: "1.0.0",
          projectType: "sapui5",
          fingerprint: "a1",
          path: ".codex/mcp/packs/pack-alpha-1.0.0",
          lifecycle: {
            status: "experimental",
            updatedAt: "2026-03-10T10:00:00.000Z",
            reason: "initial-save",
            history: []
          }
        }
      ]
    });
    await writeMetrics(tempRoot, {
      schemaVersion: "1.0.0",
      generatedAt: "2026-03-11T10:00:00.000Z",
      totals: {
        executions: 7,
        success: 6,
        partial: 1,
        failed: 0
      },
      packs: {
        "pack-alpha@1.0.0": {
          packSlug: "pack-alpha",
          packVersion: "1.0.0",
          executions: 7,
          outcomes: { success: 6, partial: 1, failed: 0 },
          qualityGatePasses: 6,
          qualityGateFails: 1,
          issuesIntroducedTotal: 1,
          manualEditsNeededTotal: 3,
          timeSavedMinutesTotal: 90,
          tokenDeltaEstimateTotal: 1200,
          projectTypes: { sapui5: 7 },
          lastRecordedAt: "2026-03-11T09:00:00.000Z"
        }
      }
    });

    const result = await promoteAgentPackTool.handler(
      {
        packSlug: "pack-alpha",
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.selectedPack.previousStatus).toBe("experimental");
    expect(result.selectedPack.nextStatus).toBe("recommended");
    expect(result.applyResult?.patchId).toMatch(/^patch-/);

    const updated = await readCatalog(tempRoot);
    expect(updated.packs[0].lifecycle.status).toBe("recommended");
    expect(updated.packs[0].lifecycle.history.length).toBe(1);
  });

  it("auto-deprecates pack when failures are high", async () => {
    await writeCatalog(tempRoot, {
      schemaVersion: "1.0.0",
      packs: [
        {
          name: "Pack Beta",
          slug: "pack-beta",
          version: "1.0.0",
          projectType: "sapui5",
          fingerprint: "b1",
          path: ".codex/mcp/packs/pack-beta-1.0.0",
          lifecycle: {
            status: "recommended",
            updatedAt: "2026-03-10T10:00:00.000Z",
            reason: "manual",
            history: []
          }
        }
      ]
    });
    await writeMetrics(tempRoot, {
      schemaVersion: "1.0.0",
      generatedAt: "2026-03-11T10:00:00.000Z",
      totals: {
        executions: 6,
        success: 2,
        partial: 1,
        failed: 3
      },
      packs: {
        "pack-beta@1.0.0": {
          packSlug: "pack-beta",
          packVersion: "1.0.0",
          executions: 6,
          outcomes: { success: 2, partial: 1, failed: 3 },
          qualityGatePasses: 2,
          qualityGateFails: 4,
          issuesIntroducedTotal: 9,
          manualEditsNeededTotal: 12,
          timeSavedMinutesTotal: 10,
          tokenDeltaEstimateTotal: 50,
          projectTypes: { sapui5: 6 },
          lastRecordedAt: "2026-03-11T09:00:00.000Z"
        }
      }
    });

    const result = await promoteAgentPackTool.handler(
      {
        packSlug: "pack-beta",
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.selectedPack.previousStatus).toBe("recommended");
    expect(result.selectedPack.nextStatus).toBe("deprecated");
    expect(result.decision.failureRate).toBeGreaterThanOrEqual(0.45);
  });
});

async function writeCatalog(root, content) {
  const filePath = path.join(root, ".codex", "mcp", "packs", "catalog.json");
  await fs.writeFile(filePath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
}

async function writeMetrics(root, content) {
  const filePath = path.join(root, ".codex", "mcp", "feedback", "metrics.json");
  await fs.writeFile(filePath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
}

async function readCatalog(root) {
  const filePath = path.join(root, ".codex", "mcp", "packs", "catalog.json");
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}
