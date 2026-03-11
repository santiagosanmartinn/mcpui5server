import { ToolError } from "../../src/utils/errors.js";
import { analyzeUi5Xml } from "../../src/utils/xmlParser.js";

describe("xmlParser utils", () => {
  it("analyzes XMLView namespaces, bindings and events", () => {
    const xml = `
      <mvc:View
        xmlns:mvc="sap.ui.core.mvc"
        xmlns="sap.m"
        xmlns:core="sap.ui.core"
        controllerName="demo.app.controller.Main">
        <Page title="{i18n>homeTitle}">
          <content>
            <VBox>
              <Input value="{/query}" liveChange=".onQueryChange" />
              <Button text="{i18n>search}" press=".onSearch" />
            </VBox>
          </content>
        </Page>
      </mvc:View>
    `;

    const result = analyzeUi5Xml(xml);
    expect(result.documentType).toBe("XMLView");
    expect(result.rootTag).toBe("mvc:View");
    expect(result.namespaces).toMatchObject({
      default: "sap.m",
      mvc: "sap.ui.core.mvc",
      core: "sap.ui.core"
    });
    expect(result.events.some((event) => event.event === "press" && event.handler === ".onSearch")).toBe(true);
    expect(result.bindings.some((binding) => binding.model === "i18n" && binding.bindingPath === "homeTitle")).toBe(true);
    expect(result.bindings.some((binding) => binding.bindingPath === "/query")).toBe(true);
    expect(result.models).toContain("i18n");
  });

  it("analyzes FragmentDefinition controls and list bindings", () => {
    const xml = `
      <core:FragmentDefinition xmlns="sap.m" xmlns:core="sap.ui.core">
        <List id="ordersList" items="{/Orders}" itemPress=".onOrderPress">
          <items>
            <StandardListItem title="{OrderName}" description="{CustomerName}" />
          </items>
        </List>
      </core:FragmentDefinition>
    `;

    const result = analyzeUi5Xml(xml);
    expect(result.documentType).toBe("Fragment");
    expect(result.rootTag).toBe("core:FragmentDefinition");
    expect(result.controls.some((control) => control.tag === "List")).toBe(true);
    expect(result.bindings.some((binding) => binding.attribute === "items" && binding.bindingPath === "/Orders")).toBe(true);
    expect(result.events.some((event) => event.event === "itemPress")).toBe(true);
  });

  it("supports expression and complex path bindings", () => {
    const xml = `
      <mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m">
        <ObjectStatus
          text="{path: 'i18n>statusLabel'}"
          state="{= \${status} === 'A' ? 'Success' : 'Warning' }" />
      </mvc:View>
    `;

    const result = analyzeUi5Xml(xml);
    expect(result.bindings.some((binding) => binding.type === "complex" && binding.model === "i18n")).toBe(true);
    expect(result.bindings.some((binding) => binding.type === "expression")).toBe(true);
    expect(result.models).toContain("i18n");
  });

  it("throws ToolError with stable code for invalid XML", () => {
    const invalid = `
      <mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m">
        <Button text="Broken"></mvc:View>
    `;

    let error = null;
    try {
      analyzeUi5Xml(invalid);
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof ToolError).toBe(true);
    expect(error.code).toBe("UI5_XML_PARSE_ERROR");
  });
});
