import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { manageUi5I18nTool } from "../../src/tools/ui5/manageI18n.js";

describe("manage_ui5_i18n tool", () => {
  let tempRoot;
  let viewPath;
  let i18nPath;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-manage-i18n-"));
    viewPath = path.join(tempRoot, "webapp", "view", "Orders.view.xml");
    i18nPath = path.join(tempRoot, "webapp", "i18n", "i18n.properties");
    await fs.mkdir(path.dirname(viewPath), { recursive: true });
    await fs.mkdir(path.dirname(i18nPath), { recursive: true });
    await fs.writeFile(
      viewPath,
      [
        "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\">",
        "  <Page title=\"Orders\">",
        "    <content>",
        "      <Text text=\"{i18n>orders.description}\" />",
        "      <Button text=\"Create\" />",
        "    </content>",
        "  </Page>",
        "</mvc:View>",
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      i18nPath,
      [
        "orders.title=Orders",
        "legacy.unused=Legacy",
        ""
      ].join("\n"),
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("reports missing and unused keys by file and global summary", async () => {
    const result = await manageUi5I18nTool.handler(
      {
        mode: "report"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.mode).toBe("report");
    expect(result.summary.filesScanned).toBeGreaterThan(0);
    expect(result.summary.missingKeys).toBeGreaterThan(0);
    expect(result.unusedKeys).toContain("legacy.unused");
    expect(result.fileReports.some((report) => report.path.endsWith("Orders.view.xml"))).toBe(true);
  });

  it("supports fix mode dryRun with previews and no disk changes", async () => {
    const beforeView = await fs.readFile(viewPath, "utf8");
    const beforeI18n = await fs.readFile(i18nPath, "utf8");

    const result = await manageUi5I18nTool.handler(
      {
        mode: "fix",
        dryRun: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.mode).toBe("fix");
    expect(result.dryRun).toBe(true);
    expect(result.applyResult).toBeNull();
    expect(result.changed).toBe(true);
    expect(result.previews.length).toBeGreaterThan(0);
    expect(await fs.readFile(viewPath, "utf8")).toBe(beforeView);
    expect(await fs.readFile(i18nPath, "utf8")).toBe(beforeI18n);
  });

  it("applies fixes in disk when dryRun is false", async () => {
    const result = await manageUi5I18nTool.handler(
      {
        mode: "fix",
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.changed).toBe(true);
    expect(result.applyResult?.patchId).toMatch(/^patch-/);
    const nextView = await fs.readFile(viewPath, "utf8");
    const nextI18n = await fs.readFile(i18nPath, "utf8");

    expect(nextView).toContain("{i18n>");
    expect(nextI18n).toContain("orders.description");
  });
});
