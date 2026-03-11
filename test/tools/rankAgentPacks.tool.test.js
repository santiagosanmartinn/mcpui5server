import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { rankAgentPacksTool } from "../../src/tools/agents/rankAgentPacks.js";

describe("rank_agent_packs tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-rank-packs-"));
    const catalogPath = path.join(tempRoot, ".codex", "mcp", "packs", "catalog.json");
    const metricsPath = path.join(tempRoot, ".codex", "mcp", "feedback", "metrics.json");
    await fs.mkdir(path.dirname(catalogPath), { recursive: true });
    await fs.mkdir(path.dirname(metricsPath), { recursive: true });

    await fs.writeFile(
      catalogPath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        packs: [
          {
            name: "Pack Alpha",
            slug: "pack-alpha",
            version: "1.0.0",
            projectType: "sapui5",
            fingerprint: "a1",
            path: ".codex/mcp/packs/pack-alpha-1.0.0"
          },
          {
            name: "Pack Beta",
            slug: "pack-beta",
            version: "1.0.0",
            projectType: "sapui5",
            fingerprint: "b1",
            path: ".codex/mcp/packs/pack-beta-1.0.0"
          }
        ]
      }, null, 2)}\n`,
      "utf8"
    );

    await fs.writeFile(
      metricsPath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        generatedAt: "2026-03-11T10:00:00.000Z",
        totals: {
          executions: 10,
          success: 7,
          partial: 2,
          failed: 1
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
            manualEditsNeededTotal: 4,
            timeSavedMinutesTotal: 120,
            tokenDeltaEstimateTotal: 1800,
            projectTypes: { sapui5: 7 },
            lastRecordedAt: "2026-03-11T09:00:00.000Z"
          },
          "pack-beta@1.0.0": {
            packSlug: "pack-beta",
            packVersion: "1.0.0",
            executions: 3,
            outcomes: { success: 1, partial: 1, failed: 1 },
            qualityGatePasses: 1,
            qualityGateFails: 2,
            issuesIntroducedTotal: 5,
            manualEditsNeededTotal: 8,
            timeSavedMinutesTotal: 20,
            tokenDeltaEstimateTotal: 200,
            projectTypes: { sapui5: 3 },
            lastRecordedAt: "2026-03-10T09:00:00.000Z"
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("ranks packs by feedback score for project context", async () => {
    const result = await rankAgentPacksTool.handler(
      {
        projectType: "sapui5"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.exists.catalog).toBe(true);
    expect(result.exists.metrics).toBe(true);
    expect(result.rankedPacks.length).toBe(2);
    expect(result.rankedPacks[0].slug).toBe("pack-alpha");
    expect(result.rankedPacks[0].score).toBeGreaterThan(result.rankedPacks[1].score);
    expect(result.summary.rankedPacks).toBe(2);
  });

  it("returns neutral candidates when there is no feedback history", async () => {
    const result = await rankAgentPacksTool.handler(
      {
        projectType: "sapui5",
        metricsPath: ".codex/mcp/feedback/missing.json",
        includeUnscored: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.exists.catalog).toBe(true);
    expect(result.exists.metrics).toBe(false);
    expect(result.rankedPacks.every((item) => item.status === "no-feedback")).toBe(true);
  });

  it("enforces ranking policy from agent-policy.json", async () => {
    const policyPath = path.join(tempRoot, ".codex", "mcp", "policies", "agent-policy.json");
    await fs.mkdir(path.dirname(policyPath), { recursive: true });
    await fs.writeFile(
      policyPath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        enabled: true,
        ranking: {
          enabled: true,
          blockedPackSlugs: ["pack-alpha"],
          maxResults: 1
        }
      }, null, 2)}\n`,
      "utf8"
    );

    const result = await rankAgentPacksTool.handler(
      {
        projectType: "sapui5"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.policy.loaded).toBe(true);
    expect(result.policy.enforced).toBe(true);
    expect(result.rankedPacks.length).toBe(1);
    expect(result.rankedPacks[0].slug).toBe("pack-beta");
  });
});
