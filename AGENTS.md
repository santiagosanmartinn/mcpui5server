# AGENTS.md

Instrucciones de trabajo para asistentes de IA (Codex/otros) en este repositorio.

## Objetivo

Usar el servidor MCP SAPUI5 como capa principal de analisis y generacion para maximizar:

- calidad tecnica,
- trazabilidad de cambios,
- seguridad en ediciones.

## Regla principal: MCP-first

Antes de editar codigo, usar tools MCP para entender contexto y preparar cambios.

Flujo minimo recomendado por tarea:

1. `analyze_ui5_project`
2. `search_project_files` y/o `analyze_current_file`
3. Tool especifica del dominio:
   - UI5: `generate_ui5_*`, `validate_ui5_code`, `manage_ui5_i18n`, `analyze_ui5_performance`
   - JS: `refactor_javascript_code`, `lint_javascript_code`, `security_check_javascript`
   - Proyecto: `sync_manifest_json` (si aplica)
4. Si hay escritura de archivos, usar primero `write_project_file_preview`
5. Aplicar cambios con `apply_project_patch`
6. Ejecutar `npm run check`
7. Si algo falla o hay regresion, usar `rollback_project_patch`

## Politica de cambios

- Preferir `dryRun: true` en tools que modifican (`generate_ui5_feature`, `manage_ui5_i18n`, `sync_manifest_json`) para revisar antes de aplicar.
- Evitar ediciones manuales directas de `manifest.json` cuando el cambio encaje en `sync_manifest_json`.
- Mantener cambios pequenos y verificables.

## Politica de validacion

Tras cada cambio relevante:

1. Validar codigo UI5 con `validate_ui5_code` en archivos nuevos/modificados.
2. Ejecutar `analyze_ui5_performance` sobre el modulo afectado.
3. Ejecutar `manage_ui5_i18n` en modo `report` (o `fix` con `dryRun`) si se tocaron vistas XML/literales.
4. Ejecutar `npm run check` como puerta final de calidad.

## Documentacion y referencias

- Arquitectura: `docs/arquitectura-interna.md`
- Referencia tools: `docs/referencia-tools.md`
- Ejemplos de uso: `docs/ejemplos-tools.md`
- Integracion con Codex: `docs/integracion-codex-vscode.md`
