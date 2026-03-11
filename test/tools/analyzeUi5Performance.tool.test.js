import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { analyzeUi5PerformanceTool } from "../../src/tools/ui5/analyzePerformance.js";

describe("analyze_ui5_performance tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-ui5-performance-"));
    const xmlPath = path.join(tempRoot, "webapp", "view", "List.view.xml");
    const jsPath = path.join(tempRoot, "webapp", "controller", "List.controller.js");
    await fs.mkdir(path.dirname(xmlPath), { recursive: true });
    await fs.mkdir(path.dirname(jsPath), { recursive: true });

    await fs.writeFile(
      xmlPath,
      [
        "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\">",
        "  <Table items=\"{/Orders}\">",
        "    <columns><Column><Text text=\"Name\" /></Column></columns>",
        "  </Table>",
        "</mvc:View>",
        ""
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      jsPath,
      [
        "sap.ui.define([], function () {",
        "  \"use strict\";",
        "  return {",
        "    onInit: function () {",
        "      jQuery.ajax({ url: \"/api\", async: false });",
        "      sap.ui.getCore().byId(\"idMain\");",
        "    }",
        "  };",
        "});",
        ""
      ].join("\n"),
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("returns findings with consistent severity and actionable suggestions", async () => {
    const result = await analyzeUi5PerformanceTool.handler(
      {},
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.scanned.files).toBeGreaterThanOrEqual(2);
    expect(result.summary.totalFindings).toBeGreaterThan(0);
    expect(result.findings.every((finding) => ["low", "medium", "high"].includes(finding.severity))).toBe(true);
    expect(result.findings.every((finding) => finding.rule.length > 0 && finding.suggestion.length > 0)).toBe(true);
    expect(result.findings.some((finding) => finding.rule === "UI5_PERF_JS_SYNC_XHR")).toBe(true);
    expect(result.findings.some((finding) => finding.rule === "UI5_PERF_XML_TABLE_NO_GROWING")).toBe(true);
  });
});
