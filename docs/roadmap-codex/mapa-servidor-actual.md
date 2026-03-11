# Mapa del servidor actual

Este documento explica que hace cada parte del servidor MCP actual para facilitar onboarding tecnico en cualquier nivel.

## Flujo general de una llamada MCP

1. `src/index.js` inicia servidor MCP por STDIO.
2. `src/server/mcpServer.js` crea instancia de servidor, contexto y registro de tools.
3. `src/server/toolRegistry.js` registra cada tool y unifica errores/respuestas.
4. La tool ejecutada consume utilidades (`src/utils/*`) y devuelve resultado.

## Modulos principales

### `src/index.js`

- Arranque del proceso.
- Conexion del transporte STDIO.
- Cierre limpio al terminar `stdin`.

### `src/server/mcpServer.js`

- Crea `McpServer`.
- Inyecta contexto compartido: `rootDir` y `logger`.
- Registra todas las tools desde `src/tools/index.js`.

### `src/server/toolRegistry.js`

- Registra metadata de tool (schemas, descripcion, anotaciones).
- Ejecuta handler y normaliza salida.
- Normaliza errores a formato estable con `code/message/details`.

## Dominio de tools

### `src/tools/project/*`

- Analisis de proyecto y archivos.
- Sincronizacion idempotente de `manifest.json` (models/routes/targets).
- Lectura y busqueda de contenido en workspace.
- Escritura segura con preview, apply de patch y rollback.

### `src/tools/ui5/*`

- Generacion de skeletons UI5.
- Generacion end-to-end de feature UI5 (view/controller/fragment/routing/i18n) con dry-run.
- Gestor i18n con reporte/fix y flujo seguro de preview/apply.
- Analizador de rendimiento UI5 para XML/JS con reglas y sugerencias accionables.
- Validaciones UI5 v2 por reglas y categorias.

### `src/tools/javascript/*`

- Generacion y refactor JS.
- Lint basico y escaneo de seguridad heuristico.

### `src/tools/documentation/*`

- Busqueda en UI5 SDK.
- Busqueda en MDN.
- Cache local opcional con trazabilidad de consulta y timeout configurable.

## Utilidades compartidas

### `src/utils/fileSystem.js`

- Sandbox por root del workspace.
- Lectura segura y busqueda textual.

### `src/utils/parser.js`

- Extraccion AST de imports, metodos y clases en JS/TS.
- Fallback seguro para codigo invalido/parcial.

### `src/utils/refactor.js`

- Refactor AST de JavaScript.
- Reglas actuales: var->let/const, Promise handlers a arrow (seguro).
- Reporte de cambios y deteccion de callback nesting.

### `src/utils/xmlParser.js`

- Analisis de XMLView y Fragment UI5.
- Deteccion de namespaces, bindings y eventos.
- Errores tipificados para XML invalido.

### `src/utils/patchWriter.js`

- Preview de cambios de archivo con hash y diff resumido.
- Aplicacion segura de patch multiarchivo con backup.
- Rollback por `patchId` con restauracion por archivo.

### `src/utils/validator.js`

- Reglas versionadas de validacion UI5 (JS/XML) por categoria.
- Checks JS de lint y seguridad heuristica.

### `src/utils/http.js`

- Fetch JSON con timeout.

### `src/utils/errors.js`

- `ToolError` y normalizacion de errores.

### `src/utils/logger.js`

- Logging estructurado por scope.

## Limites actuales identificados

- Parser XML UI5 incorporado; pendiente integracion progresiva en mas tools.
- Cobertura aun baja en utilidades no testeadas (`http`, `logger`, `errors`).
- Falta versionado de contratos de salida por tool.

## Direccion objetivo del roadmap

- Consolidar parser AST + parser XML en todas las tools que analizan codigo.
- Escritura segura con preview/apply.
- Validaciones UI5 mas profundas y trazables.
- Flujo de generacion end-to-end para SAPUI5.
