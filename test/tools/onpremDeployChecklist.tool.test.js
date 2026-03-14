import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { onpremDeployChecklistTool } from "../../src/tools/project/onpremDeployChecklist.js";

describe("onprem_deploy_checklist", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-onprem-checklist-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("returns blocked readiness when critical context is missing", async () => {
    const result = await onpremDeployChecklistTool.handler(
      {},
      { context: { rootDir: tempRoot } }
    );

    expect(result.readiness.level).toBe("blocked");
    expect(result.missingContext.length).toBeGreaterThan(0);
    expect(result.checklist.predeploy.some((item) => item.status === "blocked")).toBe(true);
  });

  it("returns ready when required on-prem context is provided", async () => {
    const result = await onpremDeployChecklistTool.handler(
      {
        targetSystem: "QAS",
        transportStrategy: "cts",
        appId: "demo.app",
        rollbackOwner: "team-ui5",
        ui5RuntimeVersion: "1.108.0",
        businessOwner: "owner-app",
        requireIntakeContext: false
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.readiness.level).toBe("ready");
    expect(result.readiness.blockers).toHaveLength(0);
  });
});
