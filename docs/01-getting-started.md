# 01 - Puesta en Marcha (Codex + MCP en VSCode)

Objetivo: que cualquier desarrollador pueda empezar a trabajar con buena calidad en menos de 15 minutos.

Si algun termino no te resulta familiar, consulta primero:
- [00-conceptos-clave.md](./00-conceptos-clave.md)

## 1) Requisitos

- Node.js 20 o superior.
- VSCode con la extension de Codex.
- Dependencias instaladas:
  - `npm install`

## 2) Comprobar el servidor MCP

1. Inicia el servidor:
   - `npm run start`
2. Verifica que en VSCode exista `.vscode/mcp.json` con:

```json
{
  "mcpServers": {
    "sapui5": {
      "command": "node",
      "args": ["${workspaceFolder}/src/index.js"]
    }
  }
}
```

## 3) Primera comprobacion en Codex

Pide a Codex esta secuencia:

1. `analyze_ui5_project`
2. `search_project_files` con `query: "onInit"`
3. `recommend_project_agents`

Si devuelve resultados estructurados, la integracion esta funcionando.

## 4) Verificar logs de observabilidad

Tras unas cuantas invocaciones, revisa:

- `.mcp-runtime/logs/telemetry-session-latest.json`
- `.mcp-runtime/logs/telemetry-events-<sessionId>.jsonl`

Si no quieres generar estos logs en una sesion concreta, arranca el servidor con `MCP_TELEMETRY_ENABLED=false`.

## 5) Ruta recomendada segun tipo de proyecto

### Proyecto nuevo o ya preparado

1. `materialize_recommended_agents` con `dryRun: true`
2. Revisar salida y aplicar con `dryRun: false`
3. Cerrar la tarea con `run_project_quality_gate` y `npm run check`

### Proyecto heredado o existente

1. `prepare_legacy_project_for_ai`
2. Si `needsUserInput=true`, completar contexto faltante
3. `materialize_recommended_agents`
4. Cerrar la tarea con puerta de calidad + `npm run check`

## 6) Regla de oro

- Primero `dryRun`, despues `apply`.
- Si algo falla tras aplicar: `rollback_project_patch`.
- No cerrar tareas sin validacion final.

## 7) Siguiente lectura

- Flujos completos: [02-flujos-operativos.md](./02-flujos-operativos.md)
- Operacion y politicas: [03-operacion-y-policies.md](./03-operacion-y-policies.md)
- Atajos de instrucciones para Codex: [04-cheatsheet-codex.md](./04-cheatsheet-codex.md)
- Referencia tecnica de herramientas: [referencia-tools.md](./referencia-tools.md)
- Observabilidad: [08-observabilidad.md](./08-observabilidad.md)
