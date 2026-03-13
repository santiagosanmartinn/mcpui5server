import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { recommendProjectAgentsTool } from "../../src/tools/agents/recommendProjectAgents.js";
import { materializeRecommendedAgentsTool } from "../../src/tools/agents/materializeRecommendedAgents.js";
import { validateProjectAgentsTool } from "../../src/tools/agents/validateProjectAgents.js";
import { scaffoldProjectSkillsTool } from "../../src/tools/agents/scaffoldProjectSkills.js";
import { recordSkillExecutionFeedbackTool } from "../../src/tools/agents/recordSkillExecutionFeedback.js";

describe("recommend/materialize agent tools", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-recommend-agents-"));
    const manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    const viewPath = path.join(tempRoot, "webapp", "view", "Main.view.xml");
    const controllerPath = path.join(tempRoot, "webapp", "controller", "Main.controller.js");
    const i18nPath = path.join(tempRoot, "webapp", "i18n", "i18n.properties");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.mkdir(path.dirname(viewPath), { recursive: true });
    await fs.mkdir(path.dirname(controllerPath), { recursive: true });
    await fs.mkdir(path.dirname(i18nPath), { recursive: true });

    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.recommend" },
        "sap.ui5": {
          routing: {
            routes: [{ name: "main", pattern: "", target: ["main"] }],
            targets: { main: { viewName: "Main" } }
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      viewPath,
      "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\"><Page title=\"Main\" /></mvc:View>\n",
      "utf8"
    );
    await fs.writeFile(
      controllerPath,
      "sap.ui.define([], function () { return {}; });\n",
      "utf8"
    );
    await fs.writeFile(i18nPath, "main.title=Main\n", "utf8");
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("recommends agent profiles with materialization args", async () => {
    const report = await recommendProjectAgentsTool.handler(
      {},
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.project.type).toBe("sapui5");
    expect(report.projectContextSync.executed).toBe(true);
    expect(report.recommendations.length).toBeGreaterThanOrEqual(3);
    expect(report.suggestedMaterializationArgs.agentDefinitions.length).toBeGreaterThanOrEqual(2);
    expect(report.signals.hasManifest).toBe(true);
    const contextIndexPath = path.join(tempRoot, ".codex", "mcp", "context", "context-index.json");
    await expect(fs.access(contextIndexPath)).resolves.toBeUndefined();
  });

  it("materializes recommended agents and produces valid artifacts", async () => {
    const result = await materializeRecommendedAgentsTool.handler(
      {
        dryRun: false,
        includePackCatalog: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.source).toBe("auto-recommend");
    expect(result.projectMcpSync.executed).toBe(true);
    expect(result.projectContextSync.executed).toBe(true);
    expect(result.scaffoldResult.changed).toBe(true);
    expect(result.scaffoldResult.applyResult?.patchId).toMatch(/^patch-/);
    const blueprintPath = path.join(tempRoot, ".codex", "mcp", "agents", "agent.blueprint.json");
    await expect(fs.access(blueprintPath)).resolves.toBeUndefined();

    const blueprint = JSON.parse(await fs.readFile(blueprintPath, "utf8"));
    expect(Array.isArray(blueprint.agents)).toBe(true);
    expect(blueprint.agents.length).toBeGreaterThanOrEqual(2);
    expect(blueprint.recommendation?.source).toBe("auto-recommend");

    const validation = await validateProjectAgentsTool.handler(
      {
        strict: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );
    expect(validation.valid).toBe(true);
  });

  it("prioritizes pack recommendations using feedback metrics and excludes deprecated packs", async () => {
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
            path: ".codex/mcp/packs/pack-alpha-1.0.0",
            lifecycle: {
              status: "deprecated",
              updatedAt: "2026-03-11T08:00:00.000Z",
              reason: "auto-deprecated"
            }
          },
          {
            name: "Pack Beta",
            slug: "pack-beta",
            version: "1.0.0",
            projectType: "sapui5",
            fingerprint: "b1",
            path: ".codex/mcp/packs/pack-beta-1.0.0",
            lifecycle: {
              status: "candidate",
              updatedAt: "2026-03-11T08:00:00.000Z",
              reason: "auto-candidate"
            }
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
          executions: 8,
          success: 5,
          partial: 2,
          failed: 1
        },
        packs: {
          "pack-alpha@1.0.0": {
            packSlug: "pack-alpha",
            packVersion: "1.0.0",
            executions: 5,
            outcomes: { success: 4, partial: 1, failed: 0 },
            qualityGatePasses: 4,
            qualityGateFails: 1,
            issuesIntroducedTotal: 1,
            manualEditsNeededTotal: 2,
            timeSavedMinutesTotal: 60,
            tokenDeltaEstimateTotal: 800,
            projectTypes: { sapui5: 5 },
            lastRecordedAt: "2026-03-11T09:00:00.000Z"
          },
          "pack-beta@1.0.0": {
            packSlug: "pack-beta",
            packVersion: "1.0.0",
            executions: 3,
            outcomes: { success: 1, partial: 1, failed: 1 },
            qualityGatePasses: 1,
            qualityGateFails: 2,
            issuesIntroducedTotal: 4,
            manualEditsNeededTotal: 7,
            timeSavedMinutesTotal: 10,
            tokenDeltaEstimateTotal: 120,
            projectTypes: { sapui5: 3 },
            lastRecordedAt: "2026-03-10T09:00:00.000Z"
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );

    const report = await recommendProjectAgentsTool.handler(
      {
        includePackCatalog: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const packRecommendations = report.recommendations.filter((item) => item.source === "pack");
    expect(packRecommendations.length).toBeGreaterThanOrEqual(1);
    expect(packRecommendations.some((item) => item.pack?.slug === "pack-alpha")).toBe(false);
    expect(packRecommendations[0].pack?.slug).toBe("pack-beta");
  });

  it("enforces recommendation policy from agent-policy.json", async () => {
    const catalogPath = path.join(tempRoot, ".codex", "mcp", "packs", "catalog.json");
    const policyPath = path.join(tempRoot, ".codex", "mcp", "policies", "agent-policy.json");
    await fs.mkdir(path.dirname(catalogPath), { recursive: true });
    await fs.mkdir(path.dirname(policyPath), { recursive: true });

    await fs.writeFile(
      catalogPath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        packs: [
          {
            name: "Pack Policy Candidate",
            slug: "pack-policy-candidate",
            version: "1.0.0",
            projectType: "sapui5",
            fingerprint: "pp1",
            path: ".codex/mcp/packs/pack-policy-candidate-1.0.0"
          }
        ]
      }, null, 2)}\n`,
      "utf8"
    );

    await fs.writeFile(
      policyPath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        enabled: true,
        recommendation: {
          enabled: true,
          includePackCatalog: false,
          maxRecommendations: 3,
          blockedRecommendationIds: ["ui5-i18n-curator"]
        }
      }, null, 2)}\n`,
      "utf8"
    );

    const report = await recommendProjectAgentsTool.handler(
      {
        includePackCatalog: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.policy.loaded).toBe(true);
    expect(report.policy.enforcedSections).toEqual(expect.arrayContaining(["recommendation"]));
    expect(report.recommendations.length).toBeLessThanOrEqual(3);
    expect(report.recommendations.some((item) => item.source === "pack")).toBe(false);
    expect(report.recommendations.some((item) => item.id === "ui5-i18n-curator")).toBe(false);
  });

  it("uses skill ranking signals to enrich recommendation context", async () => {
    await scaffoldProjectSkillsTool.handler(
      {
        includeDefaultSkills: true,
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    await recordSkillExecutionFeedbackTool.handler(
      {
        skillId: "ui5-feature-implementation-safe",
        outcome: "success",
        qualityGatePass: true,
        usefulnessScore: 5,
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const report = await recommendProjectAgentsTool.handler(
      {
        includeSkillCatalog: true,
        includeSkillFeedbackRanking: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.skillSignals.enabled).toBe(true);
    expect(report.skillSignals.executed).toBe(true);
    expect(report.skillSignals.summary.returnedSkills).toBeGreaterThan(0);
    expect(report.skillSignals.summary.influenceApplied).toBe(true);
    expect(report.skillSignals.topSkills.some((item) => item.id === "ui5-feature-implementation-safe")).toBe(true);

    const implementer = report.recommendations.find((item) => item.id === "ui5-feature-implementer");
    expect(implementer).toBeDefined();
    expect(implementer?.rationale).toContain("Skill signals applied");
  });

  it("does not enforce strict skill filtering when skill confidence is still low", async () => {
    const result = await materializeRecommendedAgentsTool.handler(
      {
        dryRun: true,
        includePackCatalog: false,
        skillSignalMode: "strict"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.selectionPolicy.mode).toBe("strict");
    expect(result.selectionPolicy.signalsReady).toBe(false);
    expect(result.selectionPolicy.strictApplied).toBe(false);
    expect(result.selectionPolicy.filteredRecommendationIds).toEqual([]);
    expect(result.usedRecommendations).toBeGreaterThanOrEqual(2);
  });

  it("enforces strict skill filtering when confidence and role boost thresholds are met", async () => {
    await scaffoldProjectSkillsTool.handler(
      {
        includeDefaultSkills: true,
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    await recordSkillExecutionFeedbackTool.handler(
      {
        skillId: "ui5-feature-implementation-safe",
        outcome: "success",
        qualityGatePass: true,
        usefulnessScore: 5,
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const result = await materializeRecommendedAgentsTool.handler(
      {
        dryRun: true,
        includePackCatalog: false,
        skillSignalMode: "strict",
        skillSignalMinConfidence: 0.05,
        skillSignalMinRoleBoost: 0.02
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.selectionPolicy.mode).toBe("strict");
    expect(result.selectionPolicy.signalsReady).toBe(true);
    expect(result.selectionPolicy.strictApplied).toBe(true);
    expect(result.selectionPolicy.filteredRecommendationIds.length).toBeGreaterThan(0);
    expect(result.selectionPolicy.filteredRecommendationIds).toContain("ui5-i18n-curator");
    expect(result.selectionPolicy.reweightedRecommendationIds.length).toBeGreaterThan(0);
  });

  it("auto-promotes skill signal mode from prefer to strict via policy thresholds", async () => {
    const policyPath = path.join(tempRoot, ".codex", "mcp", "policies", "agent-policy.json");
    await fs.mkdir(path.dirname(policyPath), { recursive: true });
    await fs.writeFile(
      policyPath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        enabled: true,
        recommendation: {
          enabled: true,
          includeSkillCatalog: true,
          includeSkillFeedbackRanking: true,
          skillSignalMode: "prefer",
          skillSignalMinConfidence: 0.2,
          skillSignalMinRoleBoost: 0.01,
          autoPromoteSkillSignalMode: true,
          autoPromoteMinSuccessExecutions: 3,
          autoPromoteMinSuccessRate: 0.8,
          autoPromoteMinQualifiedSkills: 1
        }
      }, null, 2)}\n`,
      "utf8"
    );

    await scaffoldProjectSkillsTool.handler(
      {
        includeDefaultSkills: true,
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    for (let index = 0; index < 3; index += 1) {
      await recordSkillExecutionFeedbackTool.handler(
        {
          skillId: "ui5-feature-implementation-safe",
          outcome: "success",
          qualityGatePass: true,
          usefulnessScore: 5,
          dryRun: false
        },
        {
          context: { rootDir: tempRoot }
        }
      );
    }

    const result = await materializeRecommendedAgentsTool.handler(
      {
        dryRun: true,
        includePackCatalog: false,
        allowOverwrite: true,
        respectPolicy: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.policy.loaded).toBe(true);
    expect(result.selectionPolicy.mode).toBe("strict");
    expect(result.selectionPolicy.autoPromotedToStrict).toBe(true);
    expect(result.selectionPolicy.promotionReason).toContain("auto-promoted-to-strict");
    expect(result.selectionPolicy.strictApplied).toBe(true);
  });
});
