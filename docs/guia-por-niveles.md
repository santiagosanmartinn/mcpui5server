# Guia por niveles

Esta guia explica como trabajar con el servidor MCP segun nivel tecnico.

## Nivel junior

Objetivo:
- ejecutar el servidor,
- entender que hace cada tool,
- validar cambios sin romper calidad.

Flujo recomendado:
1. Ejecutar `npm install`.
2. Ejecutar `npm run check`.
3. Ejecutar `npm run start`.
4. Revisar [Referencia de tools](./referencia-tools.md).
5. Probar ejemplos de [Ejemplos de tools](./ejemplos-tools.md).

Reglas practicas:
- No editar `src/server/*` en primeras tareas.
- Hacer cambios pequenos y aislados.
- Si agregas una tool, documentar input y output.

## Nivel medio

Objetivo:
- implementar mejoras por dominio (`project`, `ui5`, `javascript`, `documentation`),
- extender validaciones y generacion,
- mantener contratos MCP.

Flujo recomendado:
1. Leer [Arquitectura interna](./arquitectura-interna.md).
2. Crear una tarea con plantilla:
   - `docs/roadmap-codex/plantillas/task-template.md`
3. Implementar cambio en modulo objetivo.
4. Agregar/actualizar tests.
5. Ejecutar:
   - `npm run check`
   - `npm run coverage`
6. Actualizar docs afectadas.

Reglas practicas:
- Mantener `inputSchema` y `outputSchema` estrictos.
- Usar `ToolError` con `code` estable.
- No romper salida existente sin documentar compatibilidad.

## Nivel senior

Objetivo:
- disenar cambios de arquitectura,
- definir compatibilidad y estrategia de evolucion,
- guiar integracion de roadmap.

Flujo recomendado:
1. Evaluar impacto de cambio en tools existentes.
2. Registrar decision en ADR:
   - `docs/adr/`
3. Planificar rollout por lotes con `docs/roadmap-codex/lotes-ejecucion.md`.
4. Definir metricas tecnicas (latencia, errores, cobertura, compatibilidad).
5. Revisar riesgos y plan de rollback.

Reglas practicas:
- Priorizar compatibilidad hacia atras.
- Evitar deuda tecnica estructural.
- Mantener trazabilidad entre tarea, PR, ADR y documentacion.

## Mapa de progresion

De junior a medio:
- dominar ciclo `implementacion -> tests -> docs`.

De medio a senior:
- dominar decisiones de arquitectura y versionado de contratos.
