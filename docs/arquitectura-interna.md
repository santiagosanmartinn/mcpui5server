# Arquitectura interna

## Estructura del codigo

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
    ui5/
      catalogs/
        ui5ComponentFitRules.js
        ui5SymbolCatalog.js
      analyzePerformance.js
      analyzeODataMetadata.js
      scaffoldUi5ODataFeature.js
      validateUi5ODataUsage.js
      generateFeature.js
      manageI18n.js
      validateUi5VersionCompatibility.js
      securityCheckUi5App.js
    javascript/
    project/
      runProjectQualityGate.js
    documentation/
      cacheStore.js
      searchUI5SDK.js
      searchMDN.js
    index.js
  utils/
    fileSystem.js
    manifestSync.js
    parser.js
    patchWriter.js
    agentPolicy.js
    mcpProjectLayout.js
    refactor.js
    xmlParser.js
    validator.js
    logger.js
    errors.js
    http.js
test/
  tools/
    analyzeUi5Performance.tool.test.js
    documentationSearch.tool.test.js
    generateUi5Feature.tool.test.js
    manageUi5I18n.tool.test.js
    syncManifest.tool.test.js
    validateUi5Code.tool.test.js
  utils/
    fileSystem.test.js
    manifestSync.test.js
    patchWriter.test.js
    parser.test.js
    refactor.test.js
    xmlParser.test.js
    validator.test.js
eslint.config.js
vitest.config.js
```

## Componentes clave

## 1) Bootstrap

- Archivo: `src/index.js`
- Responsabilidad:
  - Crear transporte STDIO.
  - Conectar el `McpServer`.
  - Manejar cierre limpio al terminar `stdin`.

## 2) Servidor MCP

- Archivo: `src/server/mcpServer.js`
- Responsabilidad:
  - Construir instancia `McpServer` con metadatos del servidor.
  - Crear `ToolRegistry`.
  - Inyectar contexto compartido:
    - `rootDir` del workspace
    - logger
  - Registrar todas las tools definidas en `src/tools/index.js`.
  - Ejecutar auto-ensure de layout MCP al arranque (configurable por variables de entorno).
  - Ejecutar auto-preparacion de contexto legacy al arranque (configurable por variables de entorno).

## 3) Registro dinamico de tools

- Archivo: `src/server/toolRegistry.js`
- Responsabilidad:
  - Recibir definiciones de tools (`name`, `description`, `inputSchema`, `outputSchema`, `handler`).
  - Registrarlas con `server.registerTool(...)`.
  - Ejecutar handlers con control unificado de errores.
  - En tools con `outputSchema`, responder tanto:
    - `structuredContent` (determinista para clientes)
    - `content` en texto JSON legible.

## 4) Utilidades

- `src/utils/fileSystem.js`:
  - Sandbox al root de proyecto.
  - Bloqueo de path traversal.
  - Lectura segura de texto/JSON.
  - Busqueda de contenido por archivos.
- `src/utils/manifestSync.js`:
  - Sincronizacion idempotente de `sap.ui5.models`, `sap.ui5.routing.routes` y `sap.ui5.routing.targets`.
  - Validacion estructural pre y post sincronizacion.
  - Reporte de resumen de cambios por dominio.
- `src/utils/errors.js`:
  - `ToolError` con `code` y `details`.
  - Normalizacion de errores inesperados.
- `src/utils/logger.js`:
  - Logging estructurado por `scope`.
- `src/utils/parser.js`:
  - Extraccion AST (JS/TS) de imports, deps de `sap.ui.define`, metodos controller y estructura de clases.
  - Fallback por heuristica regex para mantener robustez en codigo invalido/parcial.
- `src/utils/patchWriter.js`:
  - Preview de escritura con hashes y diff textual resumido.
  - Aplicacion de patch multiarchivo con validacion de hash base opcional.
  - Backup local en `.mcp-backups/` y rollback idempotente por `patchId`.
- `src/utils/refactor.js`:
  - Transformaciones AST para modernizar JS (var -> let/const y handlers Promise a arrow cuando es seguro).
  - Reporte por regla aplicada y deteccion de callback nesting.
  - Errores de parseo tipificados para refactor.
- `src/utils/xmlParser.js`:
  - Parseo XML UI5 (XMLView/Fragment) con `fast-xml-parser`.
  - Extraccion estructurada de namespaces, controles, bindings y eventos.
  - Errores de parseo tipificados (`ToolError`) para flujo estable en tools.
- `src/utils/validator.js`:
  - Validaciones UI5 v2 con reglas versionadas por categoria (`structure`, `mvc`, `naming`, `performance`).
  - Soporte para codigo JS y XML UI5.
  - Lint JS basico y escaneo de seguridad.
- `src/utils/http.js`:
  - `fetchJson` con timeout y manejo de errores HTTP.
- `src/utils/agentPolicy.js`:
  - Resolucion de `agent-policy.json` por proyecto con schema versionado.
  - Enforcement declarativo para ranking, recomendacion y quality gate.
- `src/utils/mcpProjectLayout.js`:
  - Contrato de layout MCP por proyecto (version actual, artefactos gestionados y rutas legacy).
  - Base comun para auditoria y upgrade incremental del proyecto.

## 5) Calidad automatizada

- Lint: `eslint` con config plana en `eslint.config.js`.
- Testing: `vitest` con config en `vitest.config.js`.
- Cobertura: `vitest` con provider `v8` y umbrales minimos.
- Comando de control unico:
  - `npm run check` ejecuta lint + tests.
  - `npm run coverage` valida cobertura.

## Contrato de una tool

Cada tool exporta un objeto con esta forma:

```js
{
  name: "tool_name",
  description: "descripcion",
  inputSchema: z.object(...).strict(),
  outputSchema: z.object(...),
  async handler(args, { context, extra }) { ... }
}
```

## Como agregar una nueva tool

1. Crear archivo en dominio correcto (`src/tools/<dominio>/...`).
2. Definir schemas de entrada/salida con `zod`.
3. Implementar `handler`.
4. Exportar la tool.
5. Agregarla en `src/tools/index.js` dentro de `allTools`.
6. Ejecutar `npm run check`.
