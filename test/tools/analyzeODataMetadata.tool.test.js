import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { vi } from "vitest";
import { analyzeODataMetadataTool } from "../../src/tools/ui5/analyzeODataMetadata.js";

const V4_METADATA_XML = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="Demo" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="SalesOrder">
        <Key>
          <PropertyRef Name="ID" />
        </Key>
        <Property Name="ID" Type="Edm.String" Nullable="false" />
        <Property Name="GrossAmount" Type="Edm.Decimal" Precision="13" Scale="2" />
        <NavigationProperty Name="Items" Type="Collection(Demo.SalesOrderItem)" />
      </EntityType>
      <EntityType Name="SalesOrderItem">
        <Key>
          <PropertyRef Name="ItemID" />
        </Key>
        <Property Name="ItemID" Type="Edm.String" Nullable="false" />
      </EntityType>
      <Action Name="SubmitOrder" IsBound="false">
        <Parameter Name="OrderId" Type="Edm.String" />
        <ReturnType Type="Edm.Boolean" />
      </Action>
      <Function Name="GetTopOrders" IsBound="false">
        <Parameter Name="Top" Type="Edm.Int32" />
        <ReturnType Type="Collection(Demo.SalesOrder)" />
      </Function>
      <EntityContainer Name="Container">
        <EntitySet Name="SalesOrders" EntityType="Demo.SalesOrder" />
        <Singleton Name="CurrentUser" Type="Demo.User" />
        <ActionImport Name="SubmitOrderImport" Action="Demo.SubmitOrder" />
        <FunctionImport Name="GetTopOrdersImport" Function="Demo.GetTopOrders" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

const V2_METADATA_XML = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0"
  xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"
  xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <edmx:DataServices m:DataServiceVersion="2.0">
    <Schema Namespace="NorthwindModel" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="Product">
        <Key>
          <PropertyRef Name="ProductID" />
        </Key>
        <Property Name="ProductID" Type="Edm.Int32" Nullable="false" />
        <Property Name="ProductName" Type="Edm.String" />
        <NavigationProperty Name="Category"
          Relationship="NorthwindModel.FK_Product_Category"
          FromRole="Product"
          ToRole="Category" />
      </EntityType>
      <EntityContainer Name="NorthwindEntities" m:IsDefaultEntityContainer="true">
        <EntitySet Name="Products" EntityType="NorthwindModel.Product" />
        <FunctionImport Name="TopProducts" ReturnType="Collection(NorthwindModel.Product)" m:HttpMethod="GET" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

describe("analyze_odata_metadata tool", () => {
  let tempRoot;
  let originalFetch;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-odata-metadata-"));
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("analyzes OData V4 metadata from inline XML", async () => {
    const report = await analyzeODataMetadataTool.handler(
      {
        metadataXml: V4_METADATA_XML
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.source.mode).toBe("inline");
    expect(report.protocol.odataVersion).toBe("4.0");
    expect(report.model.namespaces).toContain("Demo");
    expect(report.model.entityTypes.some((item) => item.name === "SalesOrder")).toBe(true);
    expect(report.model.entitySets.some((item) => item.name === "SalesOrders")).toBe(true);
    expect(report.model.actions.some((item) => item.name === "SubmitOrder")).toBe(true);
    expect(report.model.functions.some((item) => item.name === "GetTopOrders")).toBe(true);
  });

  it("analyzes OData V2 metadata from workspace file", async () => {
    const metadataPath = path.join(tempRoot, "metadata", "northwind.xml");
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(metadataPath, V2_METADATA_XML, "utf8");

    const report = await analyzeODataMetadataTool.handler(
      {
        metadataPath: "metadata/northwind.xml"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.source.mode).toBe("file");
    expect(report.protocol.odataVersion).toBe("2.0");
    expect(report.model.entityTypes.some((item) => item.name === "Product")).toBe(true);
    expect(report.model.entitySets.some((item) => item.name === "Products")).toBe(true);
    expect(report.model.functionImports.some((item) => item.name === "TopProducts")).toBe(true);
  });

  it("resolves service URL to $metadata endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => V4_METADATA_XML
    });

    const report = await analyzeODataMetadataTool.handler(
      {
        serviceUrl: "https://example.org/odata"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toBe("https://example.org/odata/$metadata");
    expect(report.source.mode).toBe("service");
    expect(report.source.metadataUrl).toBe("https://example.org/odata/$metadata");
  });
});
