import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { validateUi5ODataUsageTool } from "../../src/tools/ui5/validateUi5ODataUsage.js";

const V2_METADATA_XML = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0"
  xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"
  xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <edmx:DataServices m:DataServiceVersion="2.0">
    <Schema Namespace="Demo" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="SalesOrder">
        <Key><PropertyRef Name="ID" /></Key>
        <Property Name="ID" Type="Edm.String" Nullable="false" />
      </EntityType>
      <EntityContainer Name="Container" m:IsDefaultEntityContainer="true">
        <EntitySet Name="SalesOrders" EntityType="Demo.SalesOrder" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

const V4_METADATA_XML = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="Demo" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="SalesOrder">
        <Key><PropertyRef Name="ID" /></Key>
        <Property Name="ID" Type="Edm.String" Nullable="false" />
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="SalesOrders" EntityType="Demo.SalesOrder" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

describe("validate_ui5_odata_usage tool", () => {
  let tempRoot;
  let manifestPath;
  let viewPath;
  let controllerPath;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-odata-usage-"));
    manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    viewPath = path.join(tempRoot, "webapp", "view", "Main.view.xml");
    controllerPath = path.join(tempRoot, "webapp", "controller", "Main.controller.js");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.mkdir(path.dirname(viewPath), { recursive: true });
    await fs.mkdir(path.dirname(controllerPath), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("detects manifest mismatches, risky request patterns, and metadata path errors", async () => {
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": {
          id: "demo.odata",
          dataSources: {
            mainService: {
              uri: "/sap/opu/odata/sap/Z_DEMO_SRV/",
              type: "OData",
              settings: {
                odataVersion: "4.0"
              }
            }
          }
        },
        "sap.ui5": {
          dependencies: {
            minUI5Version: "1.60.0"
          },
          models: {
            "": {
              type: "sap.ui.model.odata.v2.ODataModel",
              dataSource: "mainService"
            }
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );

    await fs.writeFile(
      viewPath,
      [
        "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\">",
        "  <List items=\"{/SalesOrders}\" />",
        "  <Text text=\"{missing>Name}\" />",
        "</mvc:View>"
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      controllerPath,
      [
        "sap.ui.define([\"sap/ui/model/odata/v2/ODataModel\"], function (ODataModel) {",
        "  function run(oModel, userInput) {",
        "    oModel.setUseBatch(false);",
        "    oModel.read(\"/UnknownSet\");",
        "    $.ajax(\"/sap/opu/odata/sap/Z_DEMO_SRV/Orders?$filter=\" + userInput);",
        "  }",
        "  return { run: run, model: ODataModel };",
        "});"
      ].join("\n"),
      "utf8"
    );

    const report = await validateUi5ODataUsageTool.handler(
      {
        sourceDir: "webapp",
        metadataXml: V4_METADATA_XML
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.summary.pass).toBe(false);
    expect(report.findings.some((item) => item.rule === "ODATA_MANIFEST_MODEL_VERSION_MISMATCH")).toBe(true);
    expect(report.findings.some((item) => item.rule === "ODATA_METADATA_ENTITYSET_UNKNOWN")).toBe(true);
    expect(report.findings.some((item) => item.rule === "ODATA_JS_BATCH_DISABLED")).toBe(true);
  });

  it("passes for consistent manifest, code usage, and metadata", async () => {
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": {
          id: "demo.odata",
          dataSources: {
            mainService: {
              uri: "/sap/opu/odata/sap/Z_DEMO_SRV/",
              type: "OData",
              settings: {
                odataVersion: "2.0"
              }
            }
          }
        },
        "sap.ui5": {
          dependencies: {
            minUI5Version: "1.60.0"
          },
          models: {
            "": {
              type: "sap.ui.model.odata.v2.ODataModel",
              dataSource: "mainService"
            }
          }
        }
      }, null, 2)}\n`,
      "utf8"
    );

    await fs.writeFile(
      viewPath,
      [
        "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\">",
        "  <List items=\"{/SalesOrders}\" />",
        "</mvc:View>"
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      controllerPath,
      [
        "sap.ui.define([], function () {",
        "  function run(oModel) {",
        "    oModel.read(\"/SalesOrders\");",
        "  }",
        "  return { run: run };",
        "});"
      ].join("\n"),
      "utf8"
    );

    const report = await validateUi5ODataUsageTool.handler(
      {
        sourceDir: "webapp",
        metadataXml: V2_METADATA_XML
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.summary.pass).toBe(true);
    expect(report.summary.errors).toBe(0);
    expect(report.metadata.provided).toBe(true);
    expect(report.findings.some((item) => item.rule === "ODATA_METADATA_ENTITYSET_UNKNOWN")).toBe(false);
  });
});
