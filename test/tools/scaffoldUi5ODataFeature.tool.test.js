import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { scaffoldUi5ODataFeatureTool } from "../../src/tools/ui5/scaffoldUi5ODataFeature.js";

const V2_METADATA_XML = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0"
  xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"
  xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <edmx:DataServices m:DataServiceVersion="2.0">
    <Schema Namespace="Demo" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="SalesOrder">
        <Key><PropertyRef Name="ID" /></Key>
        <Property Name="ID" Type="Edm.String" Nullable="false" />
        <Property Name="CustomerName" Type="Edm.String" />
        <Property Name="GrossAmount" Type="Edm.Decimal" />
      </EntityType>
      <EntityContainer Name="Container" m:IsDefaultEntityContainer="true">
        <EntitySet Name="SalesOrders" EntityType="Demo.SalesOrder" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

describe("scaffold_ui5_odata_feature tool", () => {
  let tempRoot;
  let manifestPath;
  let intakePath;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-odata-scaffold-"));
    manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    intakePath = path.join(tempRoot, ".codex", "mcp", "project", "intake.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.mkdir(path.dirname(intakePath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.odata" },
        "sap.ui5": {}
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      intakePath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        updatedAt: "2026-03-12T00:00:00.000Z",
        qualityPriority: true,
        project: {
          name: "demo.odata",
          type: "sapui5",
          namespace: "demo.odata",
          detectedUi5Version: "1.120.0"
        },
        context: {
          projectGoal: "Deliver OData features safely.",
          businessDomain: "demo",
          criticality: "high",
          runtimeLandscape: "onprem",
          ui5RuntimeVersion: "1.120.0",
          allowedRefactorScope: "incremental",
          mustKeepStableAreas: [],
          knownPainPoints: [],
          constraints: [],
          complianceRequirements: [],
          notes: null
        },
        missingContext: []
      }, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("builds dry-run previews for controller/view/manifest/i18n from metadata", async () => {
    const report = await scaffoldUi5ODataFeatureTool.handler(
      {
        entitySet: "SalesOrders",
        metadataXml: V2_METADATA_XML,
        dryRun: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.changed).toBe(true);
    expect(report.contextGate.ready).toBe(true);
    expect(report.feature.entitySet).toBe("SalesOrders");
    expect(report.bindingPlan.keyField).toBe("ID");
    expect(report.previews.some((item) => item.role === "controller")).toBe(true);
    expect(report.previews.some((item) => item.role === "view")).toBe(true);
    expect(report.previews.some((item) => item.role === "manifest")).toBe(true);
    expect(report.previews.some((item) => item.role === "i18n")).toBe(true);
  });

  it("blocks scaffolding when intake context is missing", async () => {
    await fs.rm(intakePath, { force: true });

    await expect(
      scaffoldUi5ODataFeatureTool.handler(
        {
          entitySet: "SalesOrders",
          metadataXml: V2_METADATA_XML,
          dryRun: true
        },
        {
          context: { rootDir: tempRoot }
        }
      )
    ).rejects.toMatchObject({
      code: "ODATA_CONTEXT_GATE_BLOCKED",
      details: {
        intakePath: ".codex/mcp/project/intake.json"
      }
    });
  });

  it("writes scaffold files and updates manifest when dryRun is false", async () => {
    const report = await scaffoldUi5ODataFeatureTool.handler(
      {
        entitySet: "SalesOrders",
        metadataXml: V2_METADATA_XML,
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.applyResult).not.toBeNull();
    expect(report.feature.paths.controller).toBe("webapp/controller/SalesOrders.controller.js");
    expect(report.feature.paths.view).toBe("webapp/view/SalesOrders.view.xml");

    const updatedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(updatedManifest["sap.app"].dataSources.mainService).toBeDefined();
    expect(updatedManifest["sap.ui5"].models[""]).toBeDefined();
    expect(updatedManifest["sap.ui5"].models[""].type).toBe("sap.ui.model.odata.v2.ODataModel");
    expect(Array.isArray(updatedManifest["sap.ui5"].routing.routes)).toBe(true);

    const viewPath = path.join(tempRoot, "webapp", "view", "SalesOrders.view.xml");
    const controllerPath = path.join(tempRoot, "webapp", "controller", "SalesOrders.controller.js");
    const i18nPath = path.join(tempRoot, "webapp", "i18n", "i18n.properties");
    expect(await fs.readFile(viewPath, "utf8")).toContain("/SalesOrders");
    expect(await fs.readFile(controllerPath, "utf8")).toContain("onSearch");
    expect(await fs.readFile(i18nPath, "utf8")).toContain("odata.salesOrders.title");
  });
});
