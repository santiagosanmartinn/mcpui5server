# 07 - Casos de Prueba por Complejidad

Objetivo: tener un set de pruebas practicas para evaluar servidor MCP + IA en distintos niveles.

## Nivel 1 (baja complejidad)

### Caso 1.1 - Correccion simple en XML View

- Objetivo: corregir un binding roto en una vista existente.
- Flujo recomendado:
  1. `analyze_ui5_project`
  2. `search_project_files`
  3. `analyze_current_file`
  4. `write_project_file_preview`
  5. `apply_project_patch`
  6. `run_project_quality_gate` + `npm run check`
- Exito:
  - bug corregido
  - sin regresiones
  - 1 iteracion de patch idealmente

### Caso 1.2 - I18n basico

- Objetivo: sustituir literales en vista/controlador por i18n.
- Flujo recomendado:
  1. `manage_ui5_i18n` (`mode: "report"`)
  2. `manage_ui5_i18n` (`mode: "fix"`, `dryRun: true`)
  3. `apply_project_patch`
  4. validaciones finales
- Exito:
  - cero literales nuevos
  - claves i18n consistentes

## Nivel 2 (baja-media)

### Caso 2.1 - Nueva pantalla UI5 simple

- Objetivo: crear una vista sencilla con controller y routing.
- Flujo recomendado:
  1. `generate_ui5_feature` (o flujo equivalente actual)
  2. `sync_manifest_json` para routing/targets
  3. `validate_ui5_version_compatibility`
  4. `validate_ui5_code`
  5. cierre con quality gate
- Exito:
  - navegacion funcional
  - estructura UI5 correcta
  - sin errores de compatibilidad

### Caso 2.2 - Refactor JS local

- Objetivo: modernizar un modulo JS sin cambiar comportamiento.
- Flujo recomendado:
  1. `refactor_javascript_code`
  2. `lint_javascript_code`
  3. `security_check_javascript`
  4. quality gate + check
- Exito:
  - sin cambios funcionales
  - mejora de legibilidad

## Nivel 3 (media)

### Caso 3.1 - Onboarding de proyecto heredado

- Objetivo: dejar un proyecto legacy listo para trabajo asistido por IA.
- Flujo recomendado:
  1. `prepare_legacy_project_for_ai`
  2. si falta contexto, completar intake y repetir
  3. `recommend_project_agents`
  4. `materialize_recommended_agents` (`dryRun -> apply`)
  5. `run_project_quality_gate`
- Exito:
  - `readyForAutopilot=true`
  - contexto base persistido
  - agentes utiles materializados

### Caso 3.2 - Validacion de uso UI5 por version

- Objetivo: evitar controles/API no soportados por version UI5 del proyecto.
- Flujo recomendado:
  1. `validate_ui5_version_compatibility`
  2. ajustar implementacion
  3. volver a validar
- Exito:
  - cero errores de version
  - uso de controles UI5 adecuados

## Nivel 4 (media-alta)

### Caso 4.1 - Flujo OData MVP end-to-end

- Objetivo: analizar metadata OData, generar base funcional y validar uso.
- Flujo recomendado:
  1. `analyze_odata_metadata`
  2. `scaffold_ui5_odata_feature` (`dryRun -> apply`)
  3. `validate_ui5_odata_usage`
  4. `run_project_quality_gate` (`qualityProfile: "prod"`)
- Exito:
  - modelo/bindings correctos
  - sin usos peligrosos de OData
  - documentacion minima actualizada

### Caso 4.2 - Seguridad UI5 en modulo sensible

- Objetivo: detectar riesgos en entradas, navegacion y uso de datos.
- Flujo recomendado:
  1. `security_check_ui5_app`
  2. aplicar correcciones
  3. repetir check y quality gate
- Exito:
  - hallazgos criticos resueltos
  - evidencia de mitigacion

## Nivel 5 (alta complejidad)

### Caso 5.1 - Evolucion de agentes con feedback real

- Objetivo: mejorar recomendacion de agentes y skills con datos de ejecucion.
- Flujo recomendado:
  1. `record_skill_execution_feedback`
  2. `record_agent_execution_feedback`
  3. `rank_project_skills`
  4. `rank_agent_packs`
  5. `promote_agent_pack`
- Exito:
  - ranking estable y justificado
  - promociones/degradaciones coherentes

### Caso 5.2 - Gobierno semanal y transicion starter -> mature

- Objetivo: validar que el proyecto puede operar con policy madura.
- Flujo recomendado:
  1. `mcp_health_report` (completo)
  2. revisar `policyTransition.recommendation`
  3. aplicar `scaffold_project_agents` con `policyPreset: "mature"` si procede
  4. cierre con `npm run check`
- Exito:
  - docs y contratos en sync
  - policy aplicada sin romper calidad

## Orden recomendado de ejecucion del laboratorio

1. Ejecutar Nivel 1 completo.
2. Si pasa, ejecutar Nivel 2.
3. Continuar hasta Nivel 5 en orden.
4. Registrar todos los KPI en el documento de piloto.

## Nota de evaluacion

- Si un nivel falla, no escalar al siguiente sin corregir causa raiz.
- Prioridad: calidad y trazabilidad por encima de velocidad.
