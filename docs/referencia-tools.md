# Referencia de tools MCP

Listado de tools actualmente registradas en `src/tools/index.js`.

## Dominio project

### `analyze_ui5_project`

- Objetivo: analizar configuracion UI5 del workspace.
- Lee: `ui5.yaml`, `manifest.json` (o `webapp/manifest.json`), `package.json`.
- Salida principal:
  - archivos detectados
  - `ui5Version`
  - `models`
  - `routing` (routes/targets)
  - `namespace`
  - `controllerPattern`

### `read_project_file`

- Objetivo: leer archivo del workspace de forma segura.
- Entrada:
  - `path` (string)
  - `maxChars` (opcional)
- Salida:
  - `path`
  - `content`
  - `truncated`

### `search_project_files`

- Objetivo: buscar texto en archivos del proyecto.
- Entrada:
  - `query`
  - `maxResults` (opcional)
  - `extensions` (opcional)
- Salida:
  - `query`
  - `matches` (rutas relativas)

### `analyze_current_file`

- Objetivo: extraer metadata estructurada de un archivo.
- Entrada:
  - `path`
- Salida:
  - imports ESM
  - dependencias `sap.ui.define`
  - nombres de clase
  - patron de controller
  - metodos controller

### `sync_manifest_json`

- Objetivo: sincronizar `manifest.json` de forma idempotente para `models`, `routes` y `targets`.
- Entrada:
  - `manifestPath` (opcional)
  - `dryRun` (opcional)
  - `reason` (opcional)
  - `maxDiffLines` (opcional)
  - `changes`:
    - `models` (`upsert`, `remove`)
    - `routes` (`upsert`, `removeByName`)
    - `targets` (`upsert`, `remove`)
- Salida:
  - `preValidation` y `postValidation`
  - `summary` de cambios (added/updated/removed)
  - `preview` con hash/diff
  - `applyResult` (si `dryRun: false` y hubo cambios)

### `write_project_file_preview`

- Objetivo: previsualizar cambios de escritura en un archivo sin modificar disco.
- Entrada:
  - `path`
  - `content`
  - `maxDiffLines` (opcional)
- Salida:
  - hash previo/nuevo
  - tamano previo/nuevo
  - resumen de lineas (added/removed/changed/unchanged)
  - `diffPreview`
  - bandera de truncado del diff

### `apply_project_patch`

- Objetivo: aplicar cambios de uno o mas archivos de forma segura y generar rollback.
- Entrada:
  - `changes` (lista de `{ path, content, expectedOldHash? }`)
  - `reason` (opcional)
- Salida:
  - `patchId` (para rollback)
  - archivos cambiados y archivos omitidos por no tener cambios
  - hashes y tamanos antes/despues por archivo aplicado

### `rollback_project_patch`

- Objetivo: revertir un patch aplicado previamente usando backup interno.
- Entrada:
  - `patchId`
- Salida:
  - estado de rollback
  - timestamp de rollback
  - acciones por archivo (`restored`, `deleted`, `noop`)

## Dominio ui5

### `generate_ui5_controller`

- Genera skeleton UI5 con:
  - `sap.ui.define`
  - `Controller.extend`
  - metodos lifecycle (`onInit`, `onBeforeRendering`, `onAfterRendering`, `onExit`)
  - JSDoc

### `generate_ui5_fragment`

- Genera fragmento XML con namespace de `sap.m` y `sap.ui.core`.
- Soporta lista de controles base para poblar el contenido.

### `generate_ui5_formatter`

- Genera modulo `formatter` en estructura UI5.
- Incluye funciones basicas con JSDoc.

### `generate_ui5_view_logic`

- Genera metodos sugeridos de eventos para controllers de vistas XML.

### `generate_ui5_feature`

- Objetivo: generar una feature UI5 end-to-end en un solo comando.
- Scaffolding incluido:
  - `view` XML
  - `controller`
  - `fragment` (opcional)
  - alta/actualizacion de `routing` y `targets` en `manifest.json`
  - claves `i18n` base
- Entrada destacada:
  - `featureName`
  - `dryRun` (opcional, por defecto `true`)
  - `allowOverwrite` (opcional, por defecto `false`)
  - `routing`, `paths`, `i18n` (opcionales para personalizacion)
- Salida:
  - metadata de feature generada (nombres/rutas resultantes)
  - resumen de archivos (`created/updated/unchanged`)
  - validacion pre/post de `manifest`
  - resumen de cambios en `manifest` y `i18n`
  - previews por archivo + `applyResult` (si `dryRun: false`)

### `manage_ui5_i18n`

- Objetivo: extraer literales UI, detectar claves faltantes/no usadas y opcionalmente aplicar fix seguro.
- Entrada destacada:
  - `mode`: `report` | `fix`
  - `dryRun` (cuando `mode=fix`)
  - `sourceDir`, `i18nPath` (opcionales)
  - `keyPrefix` para claves sugeridas
- Salida:
  - reporte por archivo (`fileReports`) con literales y claves faltantes
  - resumen global (`summary`)
  - listado `missingKeys` y `unusedKeys`
  - `previews` y `applyResult` en modo fix

### `analyze_ui5_performance`

- Objetivo: ejecutar reglas de rendimiento sobre XML/JS UI5 y devolver hallazgos accionables.
- Entrada destacada:
  - `sourceDir` (opcional)
  - `maxFiles` (opcional)
  - `maxFindings` (opcional)
- Salida:
  - `findings` con:
    - `rule`
    - `severity` (`low`/`medium`/`high`)
    - `message`
    - `suggestion`
    - `file` y `line`
  - resumen agregado por severidad y regla

### `validate_ui5_code`

- Motor v2 de validacion con reglas versionadas y categorias.
- Entrada:
  - `code`
  - `expectedControllerName` (opcional)
  - `sourceType` (opcional: `auto`, `javascript`, `xml`)
- Categorias de reglas:
  - `structure`
  - `mvc`
  - `naming`
  - `performance`
- Devuelve (compatibilidad + extension v2):
  - `isValid`
  - `issues` (`error`/`warn`) [compatible hacia atras]
  - `issueDetails` (incluye `category` y `ruleVersion`)
  - `issuesByCategory`
  - `rulesVersion`
  - `sourceType`
  - metodos detectados
  - lifecycle faltante (solo aplica para `javascript`)

## Dominio javascript

### `generate_javascript_function`

- Genera funcion ES2022 para `browser` o `node`.
- Puede generar JS o TypeScript (`typescript: true`).
- Incluye JSDoc y validacion basica de input.

### `refactor_javascript_code`

- Refactor basado en AST:
  - `var` -> `let`/`const` segun analisis de binding
  - callbacks `then/catch` a arrow function cuando no usan `this`/`arguments`
  - normaliza trailing whitespace
- Devuelve codigo refactorizado y lista de cambios aplicados.

### `lint_javascript_code`

- Reglas implementadas:
  - `no-var`
  - `no-console`
  - `eqeqeq`
  - checks basicos adicionales desde `utils/validator.js`
- Devuelve warnings y sugerencias.

### `security_check_javascript`

- Detecciones:
  - `eval`
  - `new Function`
  - `child_process.exec/execSync`
  - import dinamico no literal
  - patrones de prototype pollution
- Salida:
  - `safe`
  - `findings` con severidad

## Dominio documentation

### `search_ui5_sdk`

- Consulta indice oficial del SDK UI5:
  - `https://ui5.sap.com/test-resources/sap/ui/documentation/sdk/inverted-index.json`
- Soporta:
  - `timeoutMs` configurable
  - cache local opcional (`cache.enabled`, `ttlSeconds`, `forceRefresh`)
- Devuelve:
  - resultados
  - `trace` con fecha/hora de consulta y origen de datos (cache/red)

### `search_mdn`

- Consulta API de busqueda MDN:
  - `https://developer.mozilla.org/api/v1/search`
- Soporta:
  - `timeoutMs` configurable
  - cache local opcional (`cache.enabled`, `ttlSeconds`, `forceRefresh`)
- Devuelve:
  - resultados
  - `trace` con fecha/hora de consulta y origen de datos (cache/red)

## Dominio agents

### `scaffold_project_agents`

- Objetivo: generar artefactos base para agentes autocontenidos del proyecto con flujo seguro (`dryRun` + `preview` + `apply`).
- Genera:
  - blueprint JSON de agentes
  - guia operativa de agentes
  - prompt bootstrap
  - configuracion opcional MCP en `.vscode/mcp.json`
- Entrada destacada:
  - `projectName`, `projectType`, `namespace` (opcionales)
  - `outputDir` (opcional)
  - `includeVscodeMcp` (opcional)
  - `dryRun` (opcional, por defecto `true`)
  - `allowOverwrite` (opcional, por defecto `false`)
- Salida:
  - metadata de proyecto detectada
  - resumen de archivos (`created/updated/unchanged`)
  - previews por archivo
  - `applyResult` si `dryRun: false`

### `validate_project_agents`

- Objetivo: validar blueprint y artefactos de agentes para asegurar consistencia, cobertura de tools y readiness MCP.
- Entrada destacada:
  - `blueprintPath`, `agentsGuidePath`, `mcpConfigPath` (opcionales)
  - `strict` (opcional, por defecto `true`)
- Validaciones principales:
  - schema del blueprint (`schemaVersion`, agentes, gates)
  - unicidad de `agent.id`
  - tools conocidas vs desconocidas
  - cobertura de `qualityGates.requiredTools` en allowlists
  - presencia de `npm run check` en quality gate
  - presencia de modo `MCP-first` en guia
  - entrada `sapui5` en `.vscode/mcp.json`
- Salida:
  - `valid`
  - checks detallados, errores y warnings
  - acciones recomendadas
