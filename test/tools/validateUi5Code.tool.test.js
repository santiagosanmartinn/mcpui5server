import { validateUi5CodeTool } from "../../src/tools/ui5/validateUi5Code.js";

describe("validate_ui5_code tool", () => {
  it("returns v2 metadata while preserving legacy fields", async () => {
    const result = await validateUi5CodeTool.handler({
      code: "const x = 1;",
      sourceType: "javascript"
    });

    expect(typeof result.isValid).toBe("boolean");
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.rulesVersion).toBe("2.0.0");
    expect(result.sourceType).toBe("javascript");
    expect(result.issuesByCategory).toHaveProperty("structure");
    expect(result).toHaveProperty("controllerMethods");
    expect(result).toHaveProperty("missingLifecycleMethods");
  });

  it("supports xml source type in v2 validation", async () => {
    const xml = `
      <mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m">
        <Button text="Save" press=".onSave" />
      </mvc:View>
    `;

    const result = await validateUi5CodeTool.handler({
      code: xml,
      sourceType: "xml"
    });

    expect(result.sourceType).toBe("xml");
    expect(result.controllerMethods).toEqual([]);
    expect(result.missingLifecycleMethods).toEqual([]);
  });
});
