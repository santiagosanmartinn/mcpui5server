import { securityCheckUi5AppTool } from "../../src/tools/ui5/securityCheckUi5App.js";

describe("security_check_ui5_app tool", () => {
  it("detects high-risk patterns in javascript", async () => {
    const code = [
      "function run(userInput) {",
      "  eval(userInput);",
      "  document.getElementById('x').innerHTML = userInput;",
      "}"
    ].join("\n");

    const report = await securityCheckUi5AppTool.handler(
      {
        code,
        sourceType: "javascript"
      },
      {
        context: { rootDir: process.cwd() }
      }
    );

    expect(report.safe).toBe(false);
    expect(report.summary.bySeverity.high).toBeGreaterThan(0);
    expect(report.findings.some((item) => item.rule === "UI5_SEC_JS_INNER_HTML")).toBe(true);
  });

  it("detects raw HTML risks in xml", async () => {
    const xml = [
      "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns:core=\"sap.ui.core\" xmlns=\"sap.m\">",
      "  <core:HTML content=\"<div>unsafe</div>\" />",
      "</mvc:View>"
    ].join("\n");

    const report = await securityCheckUi5AppTool.handler(
      {
        code: xml,
        sourceType: "xml"
      },
      {
        context: { rootDir: process.cwd() }
      }
    );

    expect(report.safe).toBe(false);
    expect(report.findings.some((item) => item.rule === "UI5_SEC_XML_RAW_HTML_CONTROL")).toBe(true);
  });
});
