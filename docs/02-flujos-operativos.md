# 02 - Flujos Operativos

Este documento define los flujos recomendados para trabajar con calidad alta y minimo retrabajo.

## Flujo A: arranque de proyecto heredado o existente

1. `prepare_legacy_project_for_ai`
2. Revisar:
   - `readyForAutopilot`
   - `needsUserInput`
   - `missingContext`
3. Si falta contexto, completar el formulario de contexto y repetir.
4. `recommend_project_agents`
5. `materialize_recommended_agents` (`dryRun: true` -> `dryRun: false`)
6. `run_project_quality_gate`
7. `npm run check`

Resultado esperado:
- proyecto con estructura MCP actualizada
- contexto IA persistido (intake/baseline/context-index)
- agentes listos para uso diario

## Flujo B: proyecto ya preparado (ciclo diario de funcionalidad)

1. Descubrimiento:
   - `analyze_ui5_project`
   - `search_project_files`
   - `analyze_current_file`
2. Implementacion:
   - `write_project_file_preview`
   - `apply_project_patch`
3. Validacion:
   - `validate_ui5_version_compatibility`
   - `validate_ui5_code`
   - `security_check_ui5_app`
   - `analyze_ui5_performance`
4. Cierre:
   - `run_project_quality_gate`
   - `npm run check`

## Flujo C: correccion urgente (minimo riesgo)

1. Analizar alcance minimo:
   - `search_project_files`
   - `read_project_file`
2. Cambiar solo lo necesario:
   - `write_project_file_preview`
   - `apply_project_patch`
3. Validar seguridad y regresion:
   - `security_check_ui5_app`
   - `run_project_quality_gate`
4. Si hay regresion:
   - `rollback_project_patch`

## Flujo D: evolucion de agentes (mejora continua)

1. `recommend_project_agents`
2. `materialize_recommended_agents`
3. `validate_project_agents`
4. `record_agent_execution_feedback`
5. `rank_agent_packs` y `promote_agent_pack`

## Flujo E: implementacion OData con control de calidad

1. Verificar contexto minimo IA:
   - `prepare_legacy_project_for_ai` (solo si falta intake/contexto)
   - confirmar `readyForAutopilot=true` o `missingContext=[]`
2. Analizar servicio:
   - `analyze_odata_metadata`
3. Generar base funcional:
   - `scaffold_ui5_odata_feature` (`dryRun: true` -> `dryRun: false`)
   - nota: si el intake no esta completo, la tool devuelve `ODATA_CONTEXT_GATE_BLOCKED`
4. Validar uso en proyecto:
   - `validate_ui5_odata_usage`
5. Implementar ajuste funcional:
   - `write_project_file_preview`
   - `apply_project_patch`
6. Validar cierre:
   - `run_project_quality_gate` (preferible `qualityProfile: "prod"` para cierre final)
   - `npm run check`

## Flujo F: mantenimiento semanal (gobierno MCP)

1. Revisar salud general:
   - `mcp_health_report` con `includeDocChecks`, `includePolicyStatus`, `includePolicyTransition`, `includeContractStatus` e `includeManagedArtifacts` en `true`
2. Revisar estado de sincronizacion:
   - `docs.referenceInSync` y `docs.examplesInSync`
   - `contracts.inSync`
3. Revisar transicion de policy:
   - `policyTransition.recommendation`
4. Actuar segun salida:
   - si hay desalineacion de contratos: `npm run contracts:snapshot`
   - si hay desalineacion de docs: actualizar `docs/referencia-tools.md` y `docs/ejemplos-tools.md`
   - si recomienda `promote-to-mature`: `scaffold_project_agents` con `policyPreset: "mature"` y `allowOverwrite: true`
5. Consolidar aprendizaje:
   - `record_skill_execution_feedback`
   - `record_agent_execution_feedback`
6. Cierre tecnico:
   - `npm run check`

## Reglas transversales

- Usar `dryRun: true` por defecto en operaciones de escritura.
- No saltarse las puertas de calidad.
- Priorizar herramientas oficiales SAP/UI5 y validadores de version/compatibilidad.
