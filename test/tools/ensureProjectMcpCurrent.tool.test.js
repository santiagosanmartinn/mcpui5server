import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { ensureProjectMcpCurrentTool } from "../../src/tools/agents/ensureProjectMcpCurrent.js";
import { upgradeProjectMcpTool } from "../../src/tools/agents/upgradeProjectMcp.js";

describe("ensure_project_mcp_current tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-ensure-project-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("returns no action when project is already up-to-date", async () => {
    await upgradeProjectMcpTool.handler(
      {
        dryRun: false,
        runPostValidation: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const result = await ensureProjectMcpCurrentTool.handler(
      {
        autoApply: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.actionTaken).toBe("none");
    expect(result.statusBefore).toBe("up-to-date");
    expect(result.statusAfter).toBe("up-to-date");
  });

  it("runs upgrade in dry-run mode when autoApply is false", async () => {
    const result = await ensureProjectMcpCurrentTool.handler(
      {
        autoApply: false,
        runPostValidation: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.needsUpgrade).toBe(true);
    expect(result.actionTaken).toBe("upgrade-dry-run");
    expect(result.upgrade?.dryRun).toBe(true);
    await expect(fs.access(path.join(tempRoot, ".codex", "mcp", "project", "mcp-project-state.json"))).rejects.toThrow();
  });
});
