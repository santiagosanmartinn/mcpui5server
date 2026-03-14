import { promptTokenBudgetTool } from "../../src/tools/project/promptTokenBudget.js";

describe("prompt_token_budget", () => {
  it("reduces prompt size when over target budget", async () => {
    const longPrompt = [
      "Objetivo: Implementar feature de validacion robusta en UI5.",
      "Contexto: Proyecto SAPUI5 con varios modulos y pruebas pendientes.",
      "Restricciones: no romper manifest, no cambiar dependencias, no tocar routing.",
      "Criterios de aceptacion: npm run check en verde, sin errores de consola.",
      ...new Array(120).fill("Detalle adicional no critico para esta iteracion.")
    ].join("\n");

    const result = await promptTokenBudgetTool.handler(
      {
        prompt: longPrompt,
        maxTokens: 500,
        reservedForResponseTokens: 200
      },
      { context: { rootDir: process.cwd() } }
    );

    expect(result.budget.estimatedTokensAfter).toBeLessThan(result.budget.estimatedTokensBefore);
    expect(result.optimized.strategy.length).toBeGreaterThan(0);
  });

  it("prioritizes context candidates by priority and budget", async () => {
    const result = await promptTokenBudgetTool.handler(
      {
        prompt: "Objetivo: corregir bug.\nCriterios de aceptacion: check en verde.",
        maxTokens: 700,
        reservedForResponseTokens: 300,
        contextCandidates: [
          { path: "webapp/controller/Main.controller.js", estimatedTokens: 120, priority: "high" },
          { path: "webapp/manifest.json", estimatedTokens: 260, priority: "high" },
          { path: "docs/notes.md", estimatedTokens: 200, priority: "low" }
        ]
      },
      { context: { rootDir: process.cwd() } }
    );

    expect(result.contextSelection.selected.length).toBeGreaterThan(0);
    expect(result.contextSelection.selected[0].priority).toBe("high");
    expect(result.contextSelection.totals.selectedTokens).toBeLessThanOrEqual(result.contextSelection.availableTokens);
  });
});
