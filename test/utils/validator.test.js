import {
  lintJavaScript,
  securityScanJavaScript,
  validateControllerMethods,
  validateUi5CodeQuality
} from "../../src/utils/validator.js";

describe("validator utils", () => {
  it("reports errors when sap.ui.define wrapper is missing", () => {
    const report = validateUi5CodeQuality("const x = 1;");
    const codes = report.issues.map((item) => item.code);
    expect(report.isValid).toBe(false);
    expect(report.rulesVersion).toBe("2.0.0");
    expect(report.sourceType).toBe("javascript");
    expect(codes).toContain("MISSING_SAP_UI_DEFINE");
    expect(report.issuesByCategory.structure.length).toBeGreaterThan(0);
  });

  it("reports dependency/parameter mismatch in sap.ui.define", () => {
    const code = `
      sap.ui.define(["sap/m/Text"], function (Text, Extra) {
        void Text;
        void Extra;
      });
    `;
    const report = validateUi5CodeQuality(code);
    const mismatch = report.issues.find((item) => item.code === "DEPENDENCY_PARAMETER_MISMATCH");
    expect(Boolean(mismatch)).toBe(true);
    expect(mismatch?.severity).toBe("error");
  });

  it("warns when expected controller name does not follow convention", () => {
    const code = `
      sap.ui.define([], function () {
        return {};
      });
    `;
    const report = validateUi5CodeQuality(code, { expectedControllerName: "mainController" });
    const style = report.issues.find((item) => item.code === "CONTROLLER_NAME_STYLE");
    expect(Boolean(style)).toBe(true);
    expect(style?.severity).toBe("warn");
    expect(report.issueDetails.some((item) => item.category === "naming")).toBe(true);
  });

  it("extracts controller methods and missing lifecycle requirements", () => {
    const code = `
      return Controller.extend("demo.Main", {
        onPress: function () {}
      });
    `;
    const report = validateControllerMethods(code);
    expect(report.methods).toContain("onPress");
    expect(report.missing).toContain("onInit");
  });

  it("returns lint warnings and suggestions for common JS smells", () => {
    const code = `
      var value = 1;
      function demo(callback) {
        callback(value);
      }
    `;
    const lint = lintJavaScript(code);
    expect(lint.warnings.length).toBeGreaterThan(0);
    expect(lint.suggestions.length).toBeGreaterThan(0);
  });

  it("flags risky patterns in security scan", () => {
    const code = `
      const cp = require("node:child_process");
      eval("2+2");
      cp.exec("echo insecure");
    `;
    const report = securityScanJavaScript(code);
    expect(report.safe).toBe(false);
    expect(report.findings.some((item) => item.severity === "HIGH")).toBe(true);
  });

  it("validates XML with categorized rules in v2 engine", () => {
    const xml = `
      <mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m">
        <Button text="{i18n>save}" press="handleSave" />
      </mvc:View>
    `;

    const report = validateUi5CodeQuality(xml, { sourceType: "xml" });
    expect(report.sourceType).toBe("xml");
    expect(report.rulesVersion).toBe("2.0.0");
    expect(report.issues.some((item) => item.code === "XML_EVENT_HANDLER_STYLE")).toBe(true);
    expect(report.issuesByCategory.mvc.length).toBeGreaterThan(0);
  });
});
