import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { generateUi5FeatureTool } from "../../src/tools/ui5/generateFeature.js";

describe("generate_ui5_feature tool", () => {
  let tempRoot;
  let manifestPath;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-generate-ui5-feature-"));
    manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.app" },
        "sap.ui5": {
          routing: {
            routes: [],
            targets: {}
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("supports dryRun for full feature scaffolding without touching disk", async () => {
    const manifestBefore = await fs.readFile(manifestPath, "utf8");

    const result = await generateUi5FeatureTool.handler(
      {
        featureName: "Sales Order",
        dryRun: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.dryRun).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.applyResult).toBeNull();
    expect(result.feature.controllerName).toBe("demo.app.controller.SalesOrder");
    expect(result.manifestSummary.routesAdded).toBe(1);
    expect(result.manifestSummary.targetsAdded).toBe(1);
    expect(result.i18nSummary.keysAdded).toBeGreaterThanOrEqual(2);
    expect(result.previews.map((item) => item.role)).toEqual(
      expect.arrayContaining(["controller", "view", "fragment", "manifest", "i18n"])
    );

    const manifestAfter = await fs.readFile(manifestPath, "utf8");
    expect(manifestAfter).toBe(manifestBefore);
    await expect(fs.access(path.join(tempRoot, "webapp", "controller", "SalesOrder.controller.js"))).rejects.toThrow();
  });

  it("applies feature scaffolding and is idempotent on second execution", async () => {
    const first = await generateUi5FeatureTool.handler(
      {
        featureName: "SalesOrder",
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(first.changed).toBe(true);
    expect(first.applyResult?.patchId).toMatch(/^patch-/);
    expect(first.fileSummary.created).toBeGreaterThan(0);

    const controllerPath = path.join(tempRoot, "webapp", "controller", "SalesOrder.controller.js");
    const viewPath = path.join(tempRoot, "webapp", "view", "SalesOrder.view.xml");
    const fragmentPath = path.join(tempRoot, "webapp", "view", "fragments", "SalesOrder.fragment.xml");
    const i18nPath = path.join(tempRoot, "webapp", "i18n", "i18n.properties");
    const manifestContent = JSON.parse(await fs.readFile(manifestPath, "utf8"));

    await expect(fs.access(controllerPath)).resolves.toBeUndefined();
    await expect(fs.access(viewPath)).resolves.toBeUndefined();
    await expect(fs.access(fragmentPath)).resolves.toBeUndefined();
    await expect(fs.access(i18nPath)).resolves.toBeUndefined();
    expect(manifestContent["sap.ui5"].routing.routes.some((route) => route.name === "salesOrder")).toBe(true);
    expect(manifestContent["sap.ui5"].routing.targets.SalesOrder).toBeDefined();

    const second = await generateUi5FeatureTool.handler(
      {
        featureName: "SalesOrder",
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(second.changed).toBe(false);
    expect(second.applyResult).toBeNull();
    expect(second.fileSummary.updated).toBe(0);
  });

  it("rejects conflicting scaffold files unless allowOverwrite is enabled", async () => {
    const existingViewPath = path.join(tempRoot, "webapp", "view", "SalesOrder.view.xml");
    await fs.mkdir(path.dirname(existingViewPath), { recursive: true });
    await fs.writeFile(existingViewPath, "<mvc:View />\n", "utf8");

    await expect(
      generateUi5FeatureTool.handler(
        {
          featureName: "SalesOrder",
          dryRun: true
        },
        {
          context: { rootDir: tempRoot }
        }
      )
    ).rejects.toMatchObject({ code: "FEATURE_FILE_EXISTS" });
  });
});
