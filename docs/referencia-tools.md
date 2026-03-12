# Referencia de herramientas MCP

Listado de herramientas registradas en `src/tools/index.js`.

Como leer este documento:

1. busca la herramienta por dominio
2. revisa "Objetivo" y "Entrada destacada"
3. para payload real, ve a [ejemplos-tools.md](./ejemplos-tools.md)

Ruta recomendada para nuevos usuarios:
- [00-conceptos-clave.md](./00-conceptos-clave.md)
- [01-getting-started.md](./01-getting-started.md)
- [02-flujos-operativos.md](./02-flujos-operativos.md)

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

### `analyze_odata_metadata`

- Objetivo: analizar metadata OData V2/V4 desde XML inline, archivo del workspace o endpoint remoto (`metadataUrl` / `serviceUrl`).
- Entrada destacada:
  - fuentes excluyentes: `metadataXml` o `metadataPath` o `metadataUrl` o `serviceUrl`
  - `timeoutMs` para consultas remotas
  - `maxEntities` para limitar volumen de salida
- Salida:
  - `protocol` (`edmxVersion`, `odataVersion`)
  - `model` con:
    - `namespaces`
    - `entityTypes` (keys, properties, navigationProperties)
    - `entitySets` / `singletons`
    - `actions` / `functions`
    - `actionImports` / `functionImports`
  - `summary` con contadores agregados
  - `diagnostics` (informacion y avisos)

### `validate_ui5_odata_usage`

- Objetivo: validar uso OData de extremo a extremo en UI5 (manifest, bindings XML/JS, uso de modelo y cruce opcional con metadata).
- Guia de estado/roadmap OData: [05-odata-mvp-y-avanzado.md](./05-odata-mvp-y-avanzado.md)
- Entrada destacada:
  - `code` o `path` o `sourceDir` (si no se indica, usa `webapp`)
  - `manifestPath` (opcional para rutas no estandar)
  - metadata opcional excluyente: `metadataXml` o `metadataPath` o `metadataUrl` o `serviceUrl`
  - `ui5Version` (opcional; si no viene intenta deteccion del proyecto)
- Cobertura:
  - revisa coherencia entre `sap.app.dataSources` y `sap.ui5.models`
  - detecta mezclas odataVersion/tipo de modelo (V2 vs V4)
  - detecta patrones de riesgo en JS (`setUseBatch(false)`, llamadas HTTP directas a endpoints OData, construccion insegura de `$filter`)
  - detecta modelos de binding no declarados
  - cruza entity sets usados en codigo con metadata cuando se aporta
- Salida:
  - `summary` con errores/avisos/info y estado `pass`
  - `findings` por regla con categoria, severidad, archivo y sugerencia
  - bloque `manifest` y `metadata` para trazabilidad de contexto analizado

### `scaffold_ui5_odata_feature`

- Objetivo: generar base UI5 OData end-to-end (controller, view, manifest e i18n) a partir de metadata.
- Entrada destacada:
  - `entitySet` (obligatorio)
  - metadata obligatoria excluyente: `metadataXml` o `metadataPath` o `metadataUrl` o `serviceUrl`
  - `enforceIntakeContext` (opcional, por defecto `true`)
  - `featureName`, `modelName`, `dataSourceName`, `serviceUri` (opcionales)
  - `dryRun`, `allowOverwrite`, `routing`, `paths`, `i18n` (opcionales)
- Comportamiento:
  - aplica hard gate de contexto: exige intake completo (`.codex/mcp/project/intake.json` con `missingContext=[]`) antes de generar
  - si falta contexto, bloquea con error `ODATA_CONTEXT_GATE_BLOCKED` y devuelve `missingContext` + `questions`
  - resuelve `EntitySet` + `EntityType` desde metadata
  - genera binding base para lista + busqueda
  - sincroniza `dataSource`, `model`, `route` y `target` en `manifest`
  - actualiza claves i18n de la feature
- Salida:
  - `contextGate` (estado de enforcement/contexto)
  - plan de binding (`keyField`, `titleField`, etc.)
  - resumen de cambios en manifest/i18n
  - previews por archivo y `applyResult` si `dryRun: false`

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

### `validate_ui5_version_compatibility`

- Objetivo: validar que controles/modulos UI5 usados sean compatibles con la version del proyecto.
- Entrada destacada:
  - `code` o `path` o `sourceDir`
  - `ui5Version` (opcional; si no viene, intenta detectarla del proyecto)
  - `sourceType` (opcional para modo `code/path`)
- Cobertura:
  - comprueba disponibilidad de simbolos UI5 contra catalogo local versionado (`src/tools/ui5/catalogs/ui5SymbolCatalog.js`)
  - detecta incompatibilidades por version minima requerida
  - recomienda componentes mas adecuados segun guideline UX (fechas/horas, booleanos, valores finitos, estados semanticos, listas/tablas y estructura de formularios)
- Salida:
  - `summary` con compatibles/incompatibles/desconocidos
  - `findings` con severidad y referencia API oficial
  - `componentRecommendations` con sugerencias de componente ideal

### `security_check_ui5_app`

- Objetivo: escanear riesgos de seguridad en XML/JS UI5.
- Entrada destacada:
  - `code` o `path` o `sourceDir`
  - `sourceType`, `maxFiles`, `maxFindings`
- Reglas incluidas (resumen):
  - HTML crudo (`core:HTML`, `innerHTML`, `document.write`)
  - ejecucion dinamica de codigo (`eval`, `new Function`, etc.)
  - patrones de inyeccion HTML y enlaces peligrosos (`javascript:`)
- Salida:
  - `safe`
  - `summary` por severidad
  - `findings` accionables por archivo

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
- Layout por defecto (controlado):
  - artefactos tecnicos en `.codex/mcp/agents/...`
  - documentacion contextual en `docs/mcp/...`
- Genera:
  - blueprint JSON de agentes
  - guia operativa de agentes
  - prompt bootstrap
  - politica inicial por proyecto en `.codex/mcp/policies/agent-policy.json`
  - docs de contexto y flujos en `docs/mcp`
  - configuracion opcional MCP en `.vscode/mcp.json` (desactivado por defecto)
- Entrada destacada:
  - `projectName`, `projectType`, `namespace` (opcionales)
  - `outputDir` (opcional)
  - `docsDir` y `generateDocs` (opcionales)
  - `generatePolicy` (opcional, por defecto `true`)
  - `includeVscodeMcp` (opcional)
  - `dryRun` (opcional, por defecto `true`)
  - `allowOverwrite` (opcional, por defecto `false`)
- Salida:
  - metadata de proyecto detectada
  - resumen de archivos (`created/updated/unchanged`)
  - previews por archivo
  - `applyResult` si `dryRun: false`

### `validate_project_agents`

- Objetivo: validar blueprint y artefactos de agentes para asegurar consistencia, cobertura de herramientas y preparacion MCP.
- Entrada destacada:
  - `blueprintPath`, `agentsGuidePath`, `mcpConfigPath` (opcionales)
  - `requireMcpConfig` (opcional, por defecto `false`)
  - `strict` (opcional, por defecto `true`)
- Validaciones principales:
  - schema del blueprint (`schemaVersion`, agentes, gates)
  - unicidad de `agent.id`
  - herramientas conocidas frente a desconocidas
  - cobertura de `qualityGates.requiredTools` en allowlists
  - presencia de `npm run check` en la puerta de calidad
  - presencia de modo `MCP-first` en guia
  - entrada `sapui5` en `.vscode/mcp.json` (si `requireMcpConfig=true`)
- Salida:
  - `valid`
  - comprobaciones detalladas, errores y avisos
  - acciones recomendadas

### `recommend_project_agents`

- Objetivo: analizar senales del proyecto y recomendar agentes listos para materializar.
- Entrada destacada:
  - `sourceDir`, `maxFiles` (opcionales para escaneo)
  - `maxRecommendations` (opcional)
  - `includePackCatalog` y `packCatalogPath` (opcionales)
  - `includePackFeedbackRanking` y `feedbackMetricsPath` (opcionales para priorizar packs con feedback)
  - `policyPath` y `respectPolicy` (opcionales) para enforcement declarativo desde `agent-policy.json`
  - auto-preparacion opcional de contexto (`autoPrepareProjectContext`, `autoPrepareApply`, `autoPrepareRefreshBaseline`, `autoPrepareRefreshContextIndex`)
- Salida:
  - `policy` con trazabilidad de carga/enforcement
  - `project` detectado (`name`, `type`, `namespace`)
  - `projectContextSync` con estado de preparacion automatica de contexto IA
  - `signals` del codebase (js/xml/controllers/views/fragments, routing, i18n, blueprint existente)
  - `recommendations` priorizadas con `score`, `rationale` y `agent`
  - `suggestedMaterializationArgs` para usar directamente en materializacion

### `materialize_recommended_agents`

- Objetivo: autodesarrollar agentes recomendados en artefactos reales del proyecto.
- Entrada destacada:
  - `recommendations` (opcional; si no viene, ejecuta recomendacion automatica)
  - `projectName`, `projectType`, `namespace` (opcionales)
  - `dryRun`, `allowOverwrite`, `includeVscodeMcp` (opcionales)
  - `autoEnsureProjectMcp` y `autoEnsureApply` (opcionales) para sincronizar layout MCP antes de materializar
  - auto-preparacion de contexto (`autoPrepareProjectContext`, `autoPrepareApply`, `autoPrepareRefreshBaseline`, `autoPrepareRefreshContextIndex`)
- Salida:
  - fuente de recomendaciones (`input` o `auto-recommend`)
  - `projectMcpSync` con estado de auto-sincronizacion previa
  - `projectContextSync` con estado de intake/baseline/context-index
  - recomendaciones usadas/descartadas
  - `scaffoldResult` completo (previews, summary, applyResult)

### `save_agent_pack`

- Objetivo: guardar artefactos de agentes como pack reutilizable con fingerprint y catalogo.
- Incluye guardrail:
  - valida en `strict` antes de guardar.
- Entrada destacada:
  - `packName`, `packVersion` (opcional, default `1.0.0`)
  - rutas de artefactos origen (opcionales)
  - `packRootDir`/`packCatalogPath` bajo `.codex/mcp/...`
  - `dryRun`, `allowOverwrite`
- Salida:
  - metadata del pack (`slug`, `version`, `fingerprint`, `path`)
  - resumen de validacion previa
  - previews y `applyResult`

### `list_agent_packs`

- Objetivo: listar packs guardados en el catalogo.
- Entrada:
  - `packCatalogPath` (opcional, por defecto `.codex/mcp/packs/catalog.json`)
- Salida:
  - existencia de catalogo
  - listado de packs (`name`, `slug`, `version`, `projectType`, `fingerprint`, `path`, `lifecycleStatus`, `lifecycleUpdatedAt`)

### `apply_agent_pack`

- Objetivo: aplicar un pack guardado sobre el proyecto actual para reconstruir agentes sin rehacerlos.
- Entrada destacada:
  - `packSlug` o `packName`
  - `packVersion` (opcional)
  - `packCatalogPath` bajo `.codex/mcp/...`
  - parametros de scaffold (`outputDir`, `dryRun`, `allowOverwrite`, `includeVscodeMcp`, etc.)
- Guardrails:
  - verifica integridad por fingerprint antes de aplicar.
- Salida:
  - pack seleccionado
  - estado de integridad
  - `scaffoldResult` completo de la materializacion

### `refresh_project_context_docs`

- Objetivo: refrescar de forma incremental la documentacion de contexto en `docs/mcp` usando snapshot en `.codex/mcp`.
- Entrada destacada:
  - `sourceDir` (opcional, default `webapp`)
  - `docsDir` (opcional, default `docs/mcp`)
  - `cachePath` (opcional, default `.codex/mcp/context-snapshot.json`)
  - `dryRun` y `maxDiffLines` (opcionales)
- Salida:
  - resumen de `delta` contra snapshot previo (`added/modified/removed/unchanged`)
  - metricas de archivos trazados
  - previews para:
    - `docs/mcp/project-context.md`
    - `docs/mcp/agent-flows.md`
    - `.codex/mcp/context-snapshot.json`
  - `applyResult` si `dryRun: false`

### `record_agent_execution_feedback`

- Objetivo: registrar feedback estructurado de ejecuciones de agentes y mantener metricas agregadas por pack.
- Entrada destacada:
  - `packSlug`, `packVersion`
  - `projectType`, `ui5Version` (opcional)
  - resultado y calidad (`outcome`, `qualityGatePass`, `issuesIntroduced`, `manualEditsNeeded`)
  - impacto (`timeSavedMinutes`, `tokenDeltaEstimate`)
  - `feedbackPath` y `metricsPath` bajo `.codex/mcp/...` (opcionales)
  - `dryRun`, `reason`, `maxDiffLines`
- Salida:
  - registro creado (`record.id`, `packKey`, `recordedAt`)
  - snapshot de metricas globales y del pack
  - previews + `applyResult` con patch seguro

### `rank_agent_packs`

- Objetivo: priorizar packs reutilizables usando feedback historico para mejorar recomendacion automatica.
- Entrada destacada:
  - `packCatalogPath` y `metricsPath` bajo `.codex/mcp/...` (opcionales)
  - `policyPath` y `respectPolicy` (opcionales)
  - `projectType` para ranking contextual
  - `minExecutions`, `maxResults`, `includeUnscored`, `includeDeprecated`
- Salida:
  - `policy` con estado de enforcement
  - listado `rankedPacks` con `score`, `confidence`, `status`, `lifecycleStatus` y rationale
  - resumen de packs rankeados vs sin feedback
  - trazabilidad de existencia de catalogo y metricas

### `promote_agent_pack`

- Objetivo: promover/degradar estado de lifecycle del pack (`experimental`, `candidate`, `recommended`, `deprecated`).
- Modos:
  - `auto`: aplica reglas sobre score/ejecuciones/fallos/calidad.
  - `manual`: fija `targetStatus` explicitamente.
- Entrada destacada:
  - `packSlug` o `packName` (opcional `packVersion`)
  - `packCatalogPath`, `metricsPath`
  - reglas de decision (`recommendedScoreThreshold`, `candidateScoreThreshold`, etc.)
  - `dryRun`, `reason`, `maxDiffLines`
- Salida:
  - estado anterior/nuevo del pack
  - decision con metricas de soporte (score, failureRate, qualityRate, executions)
  - preview y `applyResult` de actualizacion de catalogo

### `audit_project_mcp_state`

- Objetivo: auditar el estado MCP del proyecto y detectar brechas frente al layout gestionado actual.
- Entrada destacada:
  - `statePath` (opcional, default `.codex/mcp/project/mcp-project-state.json`)
  - `includeLegacyScan` (opcional, default `true`)
- Salida:
  - `status` (`up-to-date`, `needs-upgrade`, `not-initialized`)
  - inventario de artefactos gestionados y legacy detectados
  - `migrationPlan` accionable (`create`, `migrate`, `update-state`)
  - `recommendedActions`

### `upgrade_project_mcp`

- Objetivo: actualizar el proyecto al layout MCP actual con flujo seguro (`dryRun`, preview diff y rollback via patch).
- Entrada destacada:
  - `dryRun`, `allowOverwrite`, `preferLegacyArtifacts`
  - `includeVscodeMcp` (opcional)
  - `statePath` (opcional)
  - validacion post-upgrade: `runPostValidation`, `failOnValidation`
  - quality gate opcional: `runQualityGate`, `failOnQualityGate`
- Comportamiento:
  - crea o migra artefactos en `.codex/mcp/...` y `docs/mcp/...`
  - migra desde rutas legacy conocidas cuando existe fuente
  - actualiza `mcp-project-state.json` con version de layout
- Salida:
  - `statusBefore`/`statusAfter`
  - acciones de migracion aplicadas u omitidas
  - previews y `applyResult`
  - estado de validacion y quality gate (si se ejecutan)

### `ensure_project_mcp_current`

- Objetivo: automatizar en una sola llamada el flujo `audit + upgrade` cuando el proyecto no esta actualizado.
- Entrada destacada:
  - `autoApply` (default `true`) para aplicar upgrade automaticamente o solo dry-run.
  - `force` para ejecutar upgrade incluso si el audit indica `up-to-date`.
  - parametros de upgrade (`allowOverwrite`, validacion, puerta de calidad, etc.).
- Salida:
  - `actionTaken` (`none`, `upgrade-dry-run`, `upgrade-applied`)
  - `statusBefore`/`statusAfter`
  - resumen de auditoria y datos de ejecucion del upgrade (si aplica)

### `collect_legacy_project_intake`

- Objetivo: capturar contexto funcional/operativo de un proyecto heredado para mejorar la precision de la IA y reducir repeticion de instrucciones.
- Entrada destacada:
  - datos de contexto (`projectGoal`, `criticality`, `allowedRefactorScope`, `ui5RuntimeVersion`, etc.)
  - `askForMissingContext` para devolver preguntas guiadas cuando falte informacion clave
  - `intakePath` bajo `.codex/mcp/...`, `dryRun`, `maxDiffLines`
- Salida:
  - `needsUserInput`, `missingContext` y `questions`
  - resumen de cobertura de contexto
  - previsualizacion y `applyResult` del intake persistido

### `analyze_legacy_project_baseline`

- Objetivo: generar baseline tecnico de un proyecto heredado (inventario, riesgos, hotspots y recomendaciones de integracion IA).
- Entrada destacada:
  - `sourceDir`, `intakePath`
  - salidas en `.codex/mcp/project/legacy-baseline.json` y `docs/mcp/legacy-baseline.md`
  - `dryRun`, `maxFiles`, `includeExtensions`
- Salida:
  - resumen de inventario y arquitectura
  - `qualityRisks` y `hotspots`
  - recomendaciones accionables para modernizacion segura
  - previews y `applyResult`

### `build_ai_context_index`

- Objetivo: construir un indice de contexto por chunks para reducir tokens sin degradar calidad.
- Entrada destacada:
  - `sourceDir`, `baselinePath`, `intakePath`
  - parametros de chunking (`chunkChars`, `maxChunks`, `maxFiles`)
  - salidas en `.codex/mcp/context/context-index.json` y `docs/mcp/context-index.md`
- Salida:
  - `qualityGuards` (paths obligatorios y minimos de contexto critico)
  - `summary` de files/chunks indexados y truncados
  - `retrievalProfiles` listos para feature/bugfix/security/refactor
  - previews y `applyResult`

### `prepare_legacy_project_for_ai`

- Objetivo: orquestar en una sola llamada la preparacion IA de un proyecto existente/heredado.
- Orquesta:
  - `ensure_project_mcp_current` (opcional)
  - `collect_legacy_project_intake` (si falta intake)
  - `analyze_legacy_project_baseline` (si falta o se fuerza refresh)
  - `build_ai_context_index` (si falta o se fuerza refresh)
- Entrada destacada:
  - `sourceDir`
  - `autoApply`
  - `runEnsureProjectMcp`
  - `refreshBaseline`, `refreshContextIndex`
- Salida:
  - `artifactsBefore` y `artifactsAfter`
  - `ran` (pasos ejecutados)
  - `intake` (`needsUserInput`, `missingContext`, `questions`)
  - `readyForAutopilot` y `nextActions`

## Dominio project (gates)

### `run_project_quality_gate`

- Objetivo: ejecutar una puerta de calidad consolidada para UI5.
- Orquesta:
  - `validate_ui5_version_compatibility`
  - `validate_ui5_odata_usage`
  - `security_check_ui5_app`
  - `analyze_ui5_performance`
  - `refresh_project_context_docs` (opcional)
- Entrada destacada:
  - `sourceDir`, `ui5Version`, `maxFiles`
  - `qualityProfile`: `dev` o `prod` (si no se pasa, usa policy `defaultProfile` y luego fallback por entorno)
  - umbrales y politicas (`failOnUnknownSymbols`, `failOnMediumSecurity`, `checkODataUsage`, `failOnODataWarnings`, etc.)
  - metadata OData opcional para gate estricto (`odataMetadataXml|odataMetadataPath|odataMetadataUrl|odataServiceUrl`)
  - `refreshDocs`, `applyDocs`, `failOnDocDrift`
  - `policyPath` y `respectPolicy` (opcionales)
- Profiles en policy:
  - `qualityGate.defaultProfile`
  - `qualityGate.profiles.dev`
  - `qualityGate.profiles.prod`
- Salida:
  - `pass` global
  - `policy` aplicado (si existe)
  - `checks` detallados
  - `summary` con metricas clave (incluye OData)
  - `reports` por dominio (compatibilidad, OData, seguridad, performance, docs)

### `mcp_health_report`

- Objetivo: diagnosticar salud operativa del servidor MCP y del workspace (tools publicadas, alineacion de docs, estado de policy, snapshot de contratos y artefactos gestionados).
- Entrada destacada:
  - `includeToolNames` (opcional)
  - `includeDocChecks`, `includePolicyStatus`, `includeContractStatus`, `includeManagedArtifacts` (opcionales)
  - rutas opcionales para `referenceDocPath`, `examplesDocPath`, `policyPath`, `contractSnapshotPath`
- Salida:
  - `tools` (conteo, duplicados, nombres opcionales)
  - `docs` (alineacion de `referencia-tools.md` y `ejemplos-tools.md` contra catálogo runtime)
  - `policy` (carga/habilitacion de `agent-policy.json`)
  - `contracts` (sincronizacion de contratos contra `docs/contracts/tool-contracts.snapshot.json`)
  - `managedArtifacts` (existencia de intake/baseline/context-index/blueprint/guide)
