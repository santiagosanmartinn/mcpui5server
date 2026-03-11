import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { syncManifestJsonTool } from "../../src/tools/project/syncManifest.js";

describe("sync_manifest_json tool", () => {
  let tempRoot;
  let manifestPath;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-manifest-sync-"));
    manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.app" },
        "sap.ui5": {
          models: {
            i18n: { type: "sap.ui.model.resource.ResourceModel" }
          },
          routing: {
            routes: [{ name: "main", pattern: "", target: ["main"] }],
            targets: { main: { viewName: "Main" } }
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("supports dryRun without touching manifest file", async () => {
    const before = await fs.readFile(manifestPath, "utf8");
    const result = await syncManifestJsonTool.handler(
      {
        dryRun: true,
        changes: {
          routes: {
            upsert: [{ name: "detail", pattern: "detail/{id}", target: ["detail"] }]
          },
          targets: {
            upsert: { detail: { viewName: "Detail" } }
          }
        }
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const after = await fs.readFile(manifestPath, "utf8");
    expect(result.dryRun).toBe(true);
    expect(result.applyResult).toBeNull();
    expect(result.changed).toBe(true);
    expect(result.preValidation.valid).toBe(true);
    expect(result.postValidation.valid).toBe(true);
    expect(result.summary.routesAdded).toBe(1);
    expect(result.summary.targetsAdded).toBe(1);
    expect(after).toBe(before);
  });

  it("applies patch when dryRun is false and remains idempotent", async () => {
    const first = await syncManifestJsonTool.handler(
      {
        dryRun: false,
        changes: {
          models: {
            upsert: {
              device: { type: "sap.ui.model.json.JSONModel" }
            }
          }
        }
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(first.changed).toBe(true);
    expect(first.applyResult?.patchId).toMatch(/^patch-/);
    expect(first.summary.modelsAdded).toBe(1);

    const second = await syncManifestJsonTool.handler(
      {
        dryRun: false,
        changes: {
          models: {
            upsert: {
              device: { type: "sap.ui.model.json.JSONModel" }
            }
          }
        }
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(second.changed).toBe(false);
    expect(second.applyResult).toBeNull();
  });
});
