import { validateUi5VersionCompatibilityTool } from "../../src/tools/ui5/validateUi5VersionCompatibility.js";

describe("validate_ui5_version_compatibility tool", () => {
  it("detects incompatible symbols for older UI5 versions and recommends ideal date components", async () => {
    const xml = [
      "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\">",
      "  <VBox>",
      "    <DateTimePicker value=\"{path: 'orderDate'}\" />",
      "    <Input type=\"Date\" value=\"{orderDate}\" />",
      "  </VBox>",
      "</mvc:View>"
    ].join("\n");

    const report = await validateUi5VersionCompatibilityTool.handler(
      {
        code: xml,
        sourceType: "xml",
        ui5Version: "1.30.0"
      },
      {
        context: { rootDir: process.cwd() }
      }
    );

    expect(report.summary.incompatible).toBeGreaterThan(0);
    expect(report.findings.some((item) => item.symbol === "sap.m.DateTimePicker")).toBe(true);
    expect(report.componentRecommendations.some((item) => item.suggestedComponent === "sap.m.DatePicker")).toBe(true);
  });

  it("handles javascript module checks and returns compatible summary", async () => {
    const code = [
      "sap.ui.define([\"sap/ui/model/json/JSONModel\", \"sap/m/DatePicker\"], function (JSONModel, DatePicker) {",
      "  void JSONModel;",
      "  void DatePicker;",
      "});"
    ].join("\n");

    const report = await validateUi5VersionCompatibilityTool.handler(
      {
        code,
        sourceType: "javascript",
        ui5Version: "1.60.0"
      },
      {
        context: { rootDir: process.cwd() }
      }
    );

    expect(report.summary.incompatible).toBe(0);
    expect(report.summary.isCompatible).toBe(true);
  });

  it("covers common legacy symbols and avoids unknown noise for typical UI5 controllers", async () => {
    const code = [
      "sap.ui.define([",
      "  \"sap/ui/core/mvc/Controller\",",
      "  \"sap/m/MessageToast\",",
      "  \"sap/m/Button\"",
      "], function (Controller, MessageToast, Button) {",
      "  void Controller;",
      "  void MessageToast;",
      "  void Button;",
      "});"
    ].join("\n");

    const report = await validateUi5VersionCompatibilityTool.handler(
      {
        code,
        sourceType: "javascript",
        ui5Version: "1.28.0"
      },
      {
        context: { rootDir: process.cwd() }
      }
    );

    expect(report.summary.unknown).toBe(0);
    expect(report.summary.incompatible).toBe(0);
  });

  it("flags wizard as incompatible when project uses older UI5 release", async () => {
    const code = [
      "sap.ui.define([\"sap/m/Wizard\"], function (Wizard) {",
      "  void Wizard;",
      "});"
    ].join("\n");

    const report = await validateUi5VersionCompatibilityTool.handler(
      {
        code,
        sourceType: "javascript",
        ui5Version: "1.28.0"
      },
      {
        context: { rootDir: process.cwd() }
      }
    );

    expect(report.summary.incompatible).toBe(1);
    expect(report.findings[0].symbol).toBe("sap.m.Wizard");
  });

  it("recommends semantic controls for boolean and long-text inputs", async () => {
    const xml = [
      "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\">",
      "  <VBox>",
      "    <Input id=\"isActive\" value=\"{/isActive}\" />",
      "    <Input id=\"description\" value=\"{/description}\" />",
      "  </VBox>",
      "</mvc:View>"
    ].join("\n");

    const report = await validateUi5VersionCompatibilityTool.handler(
      {
        code: xml,
        sourceType: "xml",
        ui5Version: "1.60.0"
      },
      {
        context: { rootDir: process.cwd() }
      }
    );

    expect(report.componentRecommendations.some((item) => item.suggestedComponent === "sap.m.Switch")).toBe(true);
    expect(report.componentRecommendations.some((item) => item.suggestedComponent === "sap.m.TextArea")).toBe(true);
  });

  it("uses version-safe fallback recommendation when DateTimePicker is unavailable", async () => {
    const xml = [
      "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\">",
      "  <VBox>",
      "    <Input id=\"deliveryDatetime\" type=\"DateTime\" value=\"{/deliveryDatetime}\" />",
      "  </VBox>",
      "</mvc:View>"
    ].join("\n");

    const report = await validateUi5VersionCompatibilityTool.handler(
      {
        code: xml,
        sourceType: "xml",
        ui5Version: "1.30.0"
      },
      {
        context: { rootDir: process.cwd() }
      }
    );

    expect(report.componentRecommendations.some((item) => item.suggestedComponent === "sap.m.DatePicker")).toBe(true);
    expect(report.componentRecommendations.some((item) => item.suggestedComponent === "sap.m.DateTimePicker")).toBe(false);
  });

  it("recommends controls for finite values, semantic status, and structured forms", async () => {
    const xml = [
      "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\">",
      "  <VBox>",
      "    <Label text=\"Order Status\" />",
      "    <Input id=\"orderStatus\" value=\"{/status}\" />",
      "    <Label text=\"Customer Type\" />",
      "    <Input id=\"customerType\" value=\"{/type}\" />",
      "    <Label text=\"Priority\" />",
      "    <Input id=\"priority\" value=\"{/priority}\" />",
      "    <Text id=\"orderStateText\" text=\"{/status}\" />",
      "  </VBox>",
      "</mvc:View>"
    ].join("\n");

    const report = await validateUi5VersionCompatibilityTool.handler(
      {
        code: xml,
        sourceType: "xml",
        ui5Version: "1.60.0"
      },
      {
        context: { rootDir: process.cwd() }
      }
    );

    expect(report.componentRecommendations.some((item) => item.suggestedComponent === "sap.m.Select")).toBe(true);
    expect(report.componentRecommendations.some((item) => item.suggestedComponent === "sap.m.ObjectStatus")).toBe(true);
    expect(report.componentRecommendations.some((item) => item.suggestedComponent === "sap.ui.layout.form.SimpleForm")).toBe(true);
  });

  it("recommends ObjectListItem and ObjectIdentifier for business list/table patterns", async () => {
    const xml = [
      "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\">",
      "  <List items=\"{/orders}\">",
      "    <StandardListItem title=\"{OrderName}\" description=\"{OrderDescription}\" info=\"{OrderStatus}\" infoState=\"Success\" />",
      "  </List>",
      "  <Table items=\"{/orders}\">",
      "    <columns>",
      "      <Column><Text text=\"Order\" /></Column>",
      "      <Column><Text text=\"Name\" /></Column>",
      "    </columns>",
      "    <items>",
      "      <ColumnListItem>",
      "        <cells>",
      "          <Text text=\"{OrderID}\" />",
      "          <Text text=\"{OrderName}\" />",
      "        </cells>",
      "      </ColumnListItem>",
      "    </items>",
      "  </Table>",
      "</mvc:View>"
    ].join("\n");

    const report = await validateUi5VersionCompatibilityTool.handler(
      {
        code: xml,
        sourceType: "xml",
        ui5Version: "1.60.0"
      },
      {
        context: { rootDir: process.cwd() }
      }
    );

    expect(report.componentRecommendations.some((item) => item.suggestedComponent === "sap.m.ObjectListItem")).toBe(true);
    expect(report.componentRecommendations.some((item) => item.suggestedComponent === "sap.m.ObjectIdentifier")).toBe(true);
  });
});
