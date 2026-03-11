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

## Reglas transversales

- Usar `dryRun: true` por defecto en operaciones de escritura.
- No saltarse las puertas de calidad.
- Priorizar herramientas oficiales SAP/UI5 y validadores de version/compatibilidad.
