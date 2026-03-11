# 03 - Operacion y Politicas

Documento operativo para mantener calidad, seguridad y comportamiento consistente entre equipos.

## 1) Modo estricto (que significa)

En general, "estricto" implica:

- fallar ante errores de contrato/validacion
- no aceptar herramientas desconocidas
- exigir puertas de calidad definidas

Ejemplo:
- `validate_project_agents` con `strict: true`

## 2) Politica por proyecto

Ruta:
- `.codex/mcp/policies/agent-policy.json`

Controla, entre otros:

- ranking de packs
- recomendacion de agentes
- puerta de calidad consolidada

Recomendacion:
- mantener `enabled: true`
- versionar cambios de politica junto al codigo

## 3) Automatizaciones de arranque

Variables de entorno:

- `MCP_AUTO_ENSURE_PROJECT=false`
  - desactiva sincronizacion de layout MCP al arrancar
- `MCP_AUTO_ENSURE_PROJECT_APPLY=false`
  - deja esa sincronizacion en dry-run
- `MCP_AUTO_PREPARE_CONTEXT=false`
  - desactiva la preparacion automatica de contexto en proyectos heredados
- `MCP_AUTO_PREPARE_CONTEXT_APPLY=false`
  - deja preparacion de contexto en dry-run

## 4) Nivel minimo de calidad recomendado

Siempre antes de cerrar:

1. `run_project_quality_gate`
2. `npm run check`

Para cambios sensibles UI5:

1. `validate_ui5_version_compatibility`
2. `security_check_ui5_app`
3. `analyze_ui5_performance`

## 5) Gestion de riesgo de cambios

- Antes de aplicar: `write_project_file_preview`
- Aplicar con trazabilidad: `apply_project_patch`
- Si hay regresion: `rollback_project_patch`

## 6) Mantenimiento de documentacion

- Cambias flujo o contrato: actualiza `docs/02-flujos-operativos.md`
- Cambias una herramienta: actualiza `docs/referencia-tools.md`
- Anades una herramienta: agrega ejemplo en `docs/ejemplos-tools.md`
