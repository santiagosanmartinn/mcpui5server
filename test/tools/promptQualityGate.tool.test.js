import { promptQualityGateTool } from "../../src/tools/project/promptQualityGate.js";

describe("prompt_quality_gate", () => {
  it("blocks prompts without acceptance criteria in strict mode", async () => {
    const result = await promptQualityGateTool.handler(
      {
        prompt: "Necesito arreglar un bug en UI5.",
        goal: "Corregir error en carga de datos",
        constraints: ["Mantener compatibilidad con UI5 1.108"],
        strictMode: true
      },
      { context: { rootDir: process.cwd() } }
    );

    expect(result.summary.status).toBe("blocked");
    expect(result.blockingIssues.length).toBeGreaterThan(0);
    expect(result.summary.ready).toBe(false);
  });

  it("passes quality gate when prompt is well structured", async () => {
    const result = await promptQualityGateTool.handler(
      {
        goal: "Implementar validacion de filtros en Main.controller.js",
        contextSummary: "Aplicacion SAPUI5 con modelo OData V2 y rutas estables.",
        constraints: ["No modificar routing", "No anadir dependencias nuevas"],
        acceptanceCriteria: ["npm run check en verde", "Sin errores de consola"],
        inScope: ["webapp/controller/Main.controller.js"],
        outOfScope: ["webapp/manifest.json"],
        deliverable: "Patch aplicado + resumen de validaciones"
      },
      { context: { rootDir: process.cwd() } }
    );

    expect(result.summary.status).toBe("pass");
    expect(result.summary.ready).toBe(true);
    expect(result.summary.score).toBeGreaterThanOrEqual(80);
  });
});
