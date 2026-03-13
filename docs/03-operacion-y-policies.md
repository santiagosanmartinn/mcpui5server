# 03 - Operacion y Politicas

Documento operativo para mantener calidad, seguridad y comportamiento consistente.

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

Perfiles recomendados:

- `starter`
  - pensado para arranque (skills en cero o poco historial)
  - `skillSignalMode: "prefer"`
  - `autoPromoteSkillSignalMode: false`
  - `qualityGate.defaultProfile: "dev"`
- `mature`
  - pensado para proyectos con feedback estable
  - `skillSignalMode: "prefer"` + autopromocion a `strict` por umbrales
  - `autoPromoteSkillSignalMode: true`
  - `qualityGate.defaultProfile: "prod"`

Como generar cada perfil:

```json
{
  "tool": "scaffold_project_agents",
  "arguments": {
    "dryRun": false,
    "policyPreset": "starter"
  }
}
```

```json
{
  "tool": "scaffold_project_agents",
  "arguments": {
    "dryRun": false,
    "policyPreset": "mature",
    "allowOverwrite": true
  }
}
```

Como decidir el cambio `starter -> mature`:

1. Ejecuta `mcp_health_report`.
2. Revisa `policyTransition`.
3. Si `recommendation` es `promote-to-mature`, aplica el preset `mature`.

Senales principales que usa `policyTransition`:

- volumen de ejecuciones de skills
- tasa de exito de skills
- numero de skills cualificadas
- evidencia de packs (si existe)

Recomendacion:

- mantener `enabled: true`
- versionar cambios de policy junto al codigo

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

## 7) Checklist semanal (10-15 min)

Objetivo: revisar salud MCP y decidir si mantener `starter` o pasar a `mature`.

1. Ejecutar health report completo:

```json
{
  "tool": "mcp_health_report",
  "arguments": {
    "includeDocChecks": true,
    "includePolicyStatus": true,
    "includePolicyTransition": true,
    "includeContractStatus": true,
    "includeManagedArtifacts": true
  }
}
```

2. Revisar en la salida:
- `docs.referenceInSync` y `docs.examplesInSync`
- `contracts.inSync`
- `policyTransition.recommendation`

3. Si hay desalineaciones:
- contrato: `npm run contracts:snapshot`
- docs: actualizar `docs/referencia-tools.md` y `docs/ejemplos-tools.md`

4. Si `policyTransition.recommendation = promote-to-mature`, aplicar:

```json
{
  "tool": "scaffold_project_agents",
  "arguments": {
    "dryRun": false,
    "policyPreset": "mature",
    "allowOverwrite": true
  }
}
```

5. Registrar feedback real de uso durante la semana (si no se esta haciendo):
- `record_skill_execution_feedback`
- `record_agent_execution_feedback`

6. Cerrar con validacion tecnica:
- `npm run check`
