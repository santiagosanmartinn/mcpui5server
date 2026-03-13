# Servidor MCP SAPUI5

Servidor MCP especializado para desarrollo SAPUI5/Fiori en JavaScript, con herramientas modulares para analisis de proyectos, generacion de codigo, refactorizacion, validacion y consulta de documentacion.

## Arquitectura

```text
src/
  index.js
  server/
    mcpServer.js
    toolRegistry.js
  tools/
    agents/
      recommendProjectAgents.js
      materializeRecommendedAgents.js
      scaffoldProjectAgents.js
      validateProjectAgents.js
      saveAgentPack.js
      listAgentPacks.js
      applyAgentPack.js
      refreshProjectContextDocs.js
      recordAgentExecutionFeedback.js
      rankAgentPacks.js
      promoteAgentPack.js
      auditProjectMcpState.js
      upgradeProjectMcp.js
      ensureProjectMcpCurrent.js
      collectLegacyProjectIntake.js
      analyzeLegacyProjectBaseline.js
      buildAiContextIndex.js
      prepareLegacyProjectForAi.js
      scaffoldProjectSkills.js
      validateProjectSkills.js
      recordSkillExecutionFeedback.js
      rankProjectSkills.js
    ui5/
      catalogs/
        ui5ComponentFitRules.js
        ui5SymbolCatalog.js
      generateController.js
      generateFragment.js
      generateFormatter.js
      generateViewLogic.js
      generateFeature.js
      manageI18n.js
      analyzePerformance.js
      analyzeODataMetadata.js
      validateUi5Code.js
      validateUi5VersionCompatibility.js
      validateUi5ODataUsage.js
      scaffoldUi5ODataFeature.js
      securityCheckUi5App.js
    javascript/
      generateFunction.js
      refactorCode.js
      lintCode.js
      securityCheck.js
    project/
      analyzeProject.js
      readFile.js
      searchFiles.js
      analyzeCurrentFile.js
      syncManifest.js
      writePreview.js
      applyPatch.js
      rollbackPatch.js
      runProjectQualityGate.js
      mcpHealthReport.js
    documentation/
      cacheStore.js
      searchUI5SDK.js
      searchMDN.js
    index.js
  utils/
    fileSystem.js
    manifestSync.js
    parser.js
    refactor.js
    patchWriter.js
    agentPolicy.js
    mcpProjectLayout.js
    xmlParser.js
    validator.js
    logger.js
    telemetry.js
    errors.js
    http.js
```

## Herramientas MCP implementadas

1. `analyze_ui5_project`
2. `generate_ui5_controller`
3. `generate_ui5_fragment`
4. `generate_ui5_formatter`
5. `generate_ui5_view_logic`
6. `generate_ui5_feature`
7. `manage_ui5_i18n`
8. `analyze_ui5_performance`
9. `read_project_file`
10. `search_project_files`
11. `analyze_current_file`
12. `sync_manifest_json`
13. `write_project_file_preview`
14. `apply_project_patch`
15. `rollback_project_patch`
16. `run_project_quality_gate`
17. `mcp_health_report`
18. `search_ui5_sdk`
19. `search_mdn`
20. `generate_javascript_function`
21. `refactor_javascript_code`
22. `lint_javascript_code`
23. `security_check_javascript`
24. `validate_ui5_code`
25. `validate_ui5_version_compatibility`
26. `security_check_ui5_app`
27. `analyze_odata_metadata`
28. `validate_ui5_odata_usage`
29. `scaffold_ui5_odata_feature`
30. `scaffold_project_agents`
31. `validate_project_agents`
32. `recommend_project_agents`
33. `materialize_recommended_agents`
34. `save_agent_pack`
35. `list_agent_packs`
36. `apply_agent_pack`
37. `refresh_project_context_docs`
38. `record_agent_execution_feedback`
39. `rank_agent_packs`
40. `promote_agent_pack`
41. `audit_project_mcp_state`
42. `upgrade_project_mcp`
43. `ensure_project_mcp_current`
44. `collect_legacy_project_intake`
45. `analyze_legacy_project_baseline`
46. `build_ai_context_index`
47. `prepare_legacy_project_for_ai`
48. `scaffold_project_skills`
49. `validate_project_skills`
50. `record_skill_execution_feedback`
51. `rank_project_skills`

Todas las herramientas se descubren dinamicamente a traves del registro central en `src/tools/index.js` y se registran en MCP con `registerTool(...)`, incluyendo:

- `name`
- `description`
- `input schema`
- `output schema`

## Fiabilidad y seguridad

- Registro de herramientas compatible con JSON-RPC y MCP mediante `@modelcontextprotocol/sdk`.
- Validacion estructurada de entrada y salida con `zod`.
- Forma de salida determinista mediante `structuredContent`.
- Acceso a archivos limitado en sandbox a la raiz del workspace.
- Proteccion frente a path traversal (bloqueo de `..` y de resoluciones fuera de la raiz).
- Respuestas de error estructuradas con `code` y `message` legibles por maquina.
- Registro centralizado para fallos de herramientas y eventos del ciclo de vida.
- Aplicacion de politicas a nivel de proyecto mediante `.codex/mcp/policies/agent-policy.json` en flujos de ranking, recomendacion y puerta de calidad.
- Verificacion automatica del proyecto MCP al arrancar el servidor (se desactiva con `MCP_AUTO_ENSURE_PROJECT=false`).
- Preparacion automatica del contexto legacy al arrancar (se desactiva con `MCP_AUTO_PREPARE_CONTEXT=false`).

## Ejecucion

```bash
npm install
npm run start
```

## Observabilidad y logs

El servidor genera telemetria estructurada de uso y rendimiento para analizar la adopcion inicial y detectar cuellos de botella.

- Eventos por sesion en `.mcp-runtime/logs/telemetry-events-<sessionId>.jsonl`
- Resumen agregado en `.mcp-runtime/logs/telemetry-session-latest.json`
- Variables de entorno soportadas:
  - `MCP_TELEMETRY_ENABLED=false`
  - `MCP_TELEMETRY_DIR=.mcp-runtime/logs`
  - `MCP_TELEMETRY_SLOW_THRESHOLD_MS=2000`

## Ejemplos de llamadas a herramientas

### `analyze_ui5_project`

```json
{
  "tool": "analyze_ui5_project",
  "arguments": {}
}
```

### `generate_ui5_controller`

```json
{
  "tool": "generate_ui5_controller",
  "arguments": {
    "controllerName": "demo.app.controller.Main",
    "methods": ["onPressSave", "onNavBack"]
  }
}
```

### `read_project_file`

```json
{
  "tool": "read_project_file",
  "arguments": {
    "path": "webapp/controller/Main.controller.js"
  }
}
```

### `generate_javascript_function`

```json
{
  "tool": "generate_javascript_function",
  "arguments": {
    "description": "crear un envoltorio fetch con cache",
    "runtime": "node",
    "typescript": false
  }
}
```

## Configuracion MCP para Codex

```json
{
  "mcpServers": {
    "sapui5": {
      "command": "node",
      "args": ["/ruta/absoluta/a/MCPServerUI5/src/index.js"]
    }
  }
}
```

## Documentacion ampliada

Consulta la documentacion para puesta en marcha y mantenimiento en [`docs/README.md`](./docs/README.md).
