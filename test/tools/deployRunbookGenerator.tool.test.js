import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { deployRunbookGeneratorTool } from "../../src/tools/project/deployRunbookGenerator.js";

describe("deploy_runbook_generator", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-deploy-runbook-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("builds cloud foundry runbook preview in dryRun mode", async () => {
    await fs.writeFile(
      path.join(tempRoot, "manifest.yml"),
      [
        "applications:",
        "  - name: demo-app",
        "    memory: 256M",
        "    routes:",
        "      - route: demo.cfapps.example.com"
      ].join("\n"),
      "utf8"
    );

    const result = await deployRunbookGeneratorTool.handler(
      {
        platform: "cloud_foundry",
        dryRun: true
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.dryRun).toBe(true);
    expect(result.preview.changed).toBe(true);
    expect(result.runbook.markdown).toContain("Cloud Foundry");
    expect(result.applyResult).toBeNull();
  });

  it("writes on-prem runbook when dryRun is false", async () => {
    const result = await deployRunbookGeneratorTool.handler(
      {
        platform: "onpremise",
        targetSystem: "QAS",
        transportStrategy: "cts",
        dryRun: false
      },
      { context: { rootDir: tempRoot } }
    );

    expect(result.dryRun).toBe(false);
    expect(result.applyResult?.patchId).toBeTruthy();
    const outputPath = path.join(tempRoot, "docs", "mcp", "runbooks", "deploy-onpremise.md");
    const content = await fs.readFile(outputPath, "utf8");
    expect(content).toContain("On-Premise");
  });
});
