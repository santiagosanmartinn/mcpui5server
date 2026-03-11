import { synchronizeManifest, validateManifestStructure } from "../../src/utils/manifestSync.js";

describe("manifestSync utils", () => {
  it("is idempotent when no changes are provided", () => {
    const manifest = {
      "sap.ui5": {
        models: {},
        routing: {
          routes: [],
          targets: {}
        }
      }
    };

    const result = synchronizeManifest(manifest, {});
    expect(result.changed).toBe(false);
    expect(result.summary).toEqual({
      modelsAdded: 0,
      modelsUpdated: 0,
      modelsRemoved: 0,
      routesAdded: 0,
      routesUpdated: 0,
      routesRemoved: 0,
      targetsAdded: 0,
      targetsUpdated: 0,
      targetsRemoved: 0
    });
    expect(result.manifest).toEqual(manifest);
  });

  it("applies add/update/remove across models, routes and targets", () => {
    const manifest = {
      "sap.ui5": {
        models: {
          i18n: { type: "sap.ui.model.resource.ResourceModel" }
        },
        routing: {
          routes: [{ name: "main", pattern: "", target: ["main"] }],
          targets: {
            main: { viewName: "Main" }
          }
        }
      }
    };

    const result = synchronizeManifest(manifest, {
      models: {
        upsert: {
          i18n: { type: "sap.ui.model.resource.ResourceModel", settings: { bundleName: "demo.i18n.i18n" } },
          device: { type: "sap.ui.model.json.JSONModel" }
        }
      },
      routes: {
        upsert: [
          { name: "main", pattern: "home", target: ["main"] },
          { name: "detail", pattern: "detail/{id}", target: ["detail"] }
        ]
      },
      targets: {
        upsert: {
          detail: { viewName: "Detail" }
        }
      }
    });

    expect(result.changed).toBe(true);
    expect(result.summary.modelsAdded).toBe(1);
    expect(result.summary.modelsUpdated).toBe(1);
    expect(result.summary.routesAdded).toBe(1);
    expect(result.summary.routesUpdated).toBe(1);
    expect(result.summary.targetsAdded).toBe(1);
  });

  it("removes existing sections idempotently", () => {
    const manifest = {
      "sap.ui5": {
        models: {
          i18n: { type: "sap.ui.model.resource.ResourceModel" }
        },
        routing: {
          routes: [{ name: "main", pattern: "", target: ["main"] }],
          targets: {
            main: { viewName: "Main" }
          }
        }
      }
    };

    const result = synchronizeManifest(manifest, {
      models: { remove: ["i18n"] },
      routes: { removeByName: ["main"] },
      targets: { remove: ["main"] }
    });

    expect(result.summary.modelsRemoved).toBe(1);
    expect(result.summary.routesRemoved).toBe(1);
    expect(result.summary.targetsRemoved).toBe(1);
    expect(result.manifest["sap.ui5"].models).toEqual({});
    expect(result.manifest["sap.ui5"].routing.routes).toEqual([]);
    expect(result.manifest["sap.ui5"].routing.targets).toEqual({});
  });

  it("validates malformed manifest structures", () => {
    const invalid = {
      "sap.ui5": {
        routing: {
          routes: [{ pattern: "missing-name" }]
        }
      }
    };

    const report = validateManifestStructure(invalid);
    expect(report.valid).toBe(false);
    expect(report.errors.some((message) => message.includes("route"))).toBe(true);
  });
});
