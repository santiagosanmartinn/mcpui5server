import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { auditProjectMcpStateTool } from "../../src/tools/agents/auditProjectMcpState.js";
import { upgradeProjectMcpTool } from "../../src/tools/agents/upgradeProjectMcp.js";

describe("project MCP upgrade tools", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-project-upgrade-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("audits uninitialized project and proposes managed artifact creation", async () => {
    const report = await auditProjectMcpStateTool.handler(
      {},
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.status).toBe("not-initialized");
    expect(report.summary.managedMissing).toBeGreaterThan(0);
    expect(report.migrationPlan.some((step) => step.action === "create")).toBe(true);
  });

  it("detects legacy artifacts and marks migration steps", async () => {
    const legacyGuide = path.join(tempRoot, "AGENTS.generated.md");
    await fs.writeFile(legacyGuide, "# AGENTS\n\nMCP-first\n", "utf8");

    const report = await auditProjectMcpStateTool.handler(
      {},
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.summary.legacyDetected).toBeGreaterThan(0);
    expect(report.migrationPlan.some((step) => step.action === "migrate")).toBe(true);
  });

  it("upgrades project in dry-run mode with previews only", async () => {
    const report = await upgradeProjectMcpTool.handler(
      {
        dryRun: true,
        runPostValidation: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.dryRun).toBe(true);
    expect(report.changed).toBe(true);
    expect(report.applyResult).toBeNull();
    expect(report.previews.length).toBeGreaterThan(0);
    await expect(fs.access(path.join(tempRoot, ".codex", "mcp", "project", "mcp-project-state.json"))).rejects.toThrow();
  });

  it("upgrades project and migrates legacy guide into managed structure", async () => {
    const legacyGuide = path.join(tempRoot, "AGENTS.generated.md");
    await fs.writeFile(
      legacyGuide,
      "# Legacy Agents\n\nMCP-first operating mode remains enabled.\n",
      "utf8"
    );

    const report = await upgradeProjectMcpTool.handler(
      {
        dryRun: false,
        runPostValidation: true,
        failOnValidation: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.changed).toBe(true);
    expect(report.applyResult?.patchId).toMatch(/^patch-/);
    const migratedGuidePath = path.join(tempRoot, ".codex", "mcp", "agents", "AGENTS.generated.md");
    const statePath = path.join(tempRoot, ".codex", "mcp", "project", "mcp-project-state.json");
    await expect(fs.access(migratedGuidePath)).resolves.toBeUndefined();
    await expect(fs.access(statePath)).resolves.toBeUndefined();

    const migratedGuide = await fs.readFile(migratedGuidePath, "utf8");
    expect(migratedGuide).toContain("Legacy Agents");

    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    expect(state.layoutVersion).toBe("2026.03.11");
    expect(report.validation.valid).toBe(true);
  });
});
