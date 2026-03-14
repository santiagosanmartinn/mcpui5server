import { promptBuilderTool } from "../../src/tools/project/promptBuilder.js";

describe("prompt_builder", () => {
  it("builds full and compact prompts with deterministic sections", async () => {
    const result = await promptBuilderTool.handler(
      {
        taskType: "feature",
        goal: "Implementar validacion de filtros en Main.controller.js",
        contextSummary: "Proyecto SAPUI5 con OData V2",
        constraints: ["No tocar manifest routing"],
        acceptanceCriteria: ["npm run check en verde"],
        inScope: ["webapp/controller/Main.controller.js"],
        deliverable: "Patch aplicado y resumen corto",
        targetAi: "codex",
        style: "both"
      },
      { context: { rootDir: process.cwd() } }
    );

    expect(result.prompt.full).toContain("Objetivo:");
    expect(result.prompt.compact).toContain("Tarea (feature):");
    expect(result.prompt.recommended).toBe(result.prompt.full);
    expect(result.metadata.sectionsIncluded).toContain("acceptanceCriteria");
    expect(result.metadata.estimatedTokens.full).toBeGreaterThan(0);
  });

  it("respects compact style as recommended output", async () => {
    const result = await promptBuilderTool.handler(
      {
        goal: "Actualizar README principal",
        style: "compact",
        targetAi: "generic"
      },
      { context: { rootDir: process.cwd() } }
    );

    expect(result.metadata.style).toBe("compact");
    expect(result.prompt.recommended).toBe(result.prompt.compact);
  });
});
