import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { cfDeployPrecheckTool } from "../../src/tools/project/cfDeployPrecheck.js";

describe("cf_deploy_precheck", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-cf-precheck-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("flags inline secrets in manifest as blocking issue", async () => {
    await fs.writeFile(
      path.join(tempRoot, "manifest.yml"),
      [
        "applications:",
        "  - name: demo-app",
        "    memory: 256M",
        "    routes:",
        "      - route: demo.cfapps.example.com",
        "    env:",
        "      PASSWORD: plain-secret"
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify({
        name: "demo",
        scripts: {
          build: "echo build",
          check: "echo check"
        }
      }),
      "utf8"
    );

    const result = await cfDeployPrecheckTool.handler(
      {},
      { context: { rootDir: tempRoot } }
    );

    expect(result.scope.deploymentMode).toBe("cf_manifest");
    expect(result.summary.ready).toBe(false);
    expect(result.checks.some((item) => item.id === "manifest_inline_secrets" && item.status === "fail")).toBe(true);
  });

  it("flags missing MTA module paths as fail", async () => {
    await fs.writeFile(
      path.join(tempRoot, "mta.yaml"),
      [
        "ID: demo.app",
        "version: 1.0.0",
        "modules:",
        "  - name: demo-ui",
        "    type: html5",
        "    path: app/missing-module"
      ].join("\n"),
      "utf8"
    );

    const result = await cfDeployPrecheckTool.handler(
      {},
      { context: { rootDir: tempRoot } }
    );

    expect(result.scope.deploymentMode).toBe("mta");
    expect(result.checks.some((item) => item.id === "mta_module_paths" && item.status === "fail")).toBe(true);
  });
});
