import { promptTemplateCatalogTool } from "../../src/tools/project/promptTemplateCatalog.js";

describe("prompt_template_catalog", () => {
  it("returns full catalog when no task filter is provided", async () => {
    const result = await promptTemplateCatalogTool.handler(
      {},
      { context: { rootDir: process.cwd() } }
    );

    expect(result.catalogVersion).toBe("1.0.0");
    expect(result.templates.length).toBeGreaterThanOrEqual(7);
    expect(result.templates.some((item) => item.taskType === "feature")).toBe(true);
  });

  it("filters by task type", async () => {
    const result = await promptTemplateCatalogTool.handler(
      {
        taskType: "bugfix",
        includeExamples: false
      },
      { context: { rootDir: process.cwd() } }
    );

    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].taskType).toBe("bugfix");
    expect(result.templates[0].example).toBeNull();
  });
});
