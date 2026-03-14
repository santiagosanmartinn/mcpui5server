import { promptIntakeWizardTool } from "../../src/tools/project/promptIntakeWizard.js";

describe("prompt_intake_wizard", () => {
  it("returns missing critical fields and improvement questions", async () => {
    const result = await promptIntakeWizardTool.handler(
      {
        goal: "Actualizar flujo de detalle en UI5"
      },
      { context: { rootDir: process.cwd() } }
    );

    expect(result.readiness.status).toBe("insufficient");
    expect(result.readiness.missingCritical).toContain("acceptanceCriteria");
    expect(result.nextQuestions.length).toBeGreaterThan(0);
    expect(result.automationPolicy.readOnlyAnalysis).toBe(true);
  });

  it("marks intake as ready when required fields are complete", async () => {
    const result = await promptIntakeWizardTool.handler(
      {
        taskType: "feature",
        goal: "Implementar validacion de filtros en Main.controller.js",
        deliverable: "Patch aplicado y resumen corto",
        contextSummary: "Proyecto SAPUI5 con OData V2 en webapp",
        constraints: ["No tocar routing del manifest"],
        acceptanceCriteria: ["npm run check en verde", "Sin errores en consola"],
        inScope: ["webapp/controller/Main.controller.js"],
        outOfScope: ["webapp/manifest.json"]
      },
      { context: { rootDir: process.cwd() } }
    );

    expect(result.readiness.status).toBe("ready");
    expect(result.readiness.missingCritical).toHaveLength(0);
    expect(result.readiness.score).toBeGreaterThanOrEqual(80);
  });
});
