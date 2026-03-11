# MVP Global Agent Hub (Local-First)

## Objetivo

Disenar la evolucion de agentes para que aprendan de multiples proyectos de forma controlada (feedback + reuse + promocion), empezando en local y con camino claro a escalar.

## Estado actual (ya disponible)

- Recomendacion de agentes por senales del proyecto: `recommend_project_agents`.
- Materializacion automatica de agentes: `materialize_recommended_agents`.
- Guardado y reutilizacion de packs: `save_agent_pack`, `list_agent_packs`, `apply_agent_pack`.
- Validacion estricta de artefactos: `validate_project_agents`.
- Refresco de contexto del proyecto: `refresh_project_context_docs`.

## Gap principal a cubrir

Actualmente el sistema reutiliza packs, pero no cierra el bucle de aprendizaje:

1. No hay registro estructurado de feedback por ejecucion.
2. No hay scoring/ranking de packs por contexto.
3. No hay politica de promocion/degradacion de packs.
4. No hay contrato comun para evolucionar de local a servicio central.

## Arquitectura recomendada (local-first, escalable)

### 1) Capa de almacenamiento

- Mantener almacenamiento gestionado bajo `.codex/mcp` (guardrail actual).
- Estructura propuesta:
  - `.codex/mcp/packs/` (existente)
  - `.codex/mcp/feedback/executions.jsonl`
  - `.codex/mcp/feedback/metrics.json`
  - `.codex/mcp/policies/agent-policy.json`

### 2) Capa de feedback

- Registrar cada ejecucion de agentes con:
  - `packSlug`, `packVersion`, `projectType`, `ui5Version`
  - resultado (`success`, `partial`, `failed`)
  - calidad (`qualityGatePass`, `issuesIntroduced`, `manualEditsNeeded`)
  - valor (`timeSavedMinutes`, `tokenDeltaEstimate`)
  - notas de dev (`whatWorked`, `whatFailed`, `rootCause`)

### 3) Capa de decision

- Calcular score por pack/contexto (heuristica transparente):
  - precision funcional
  - estabilidad (errores/regresiones)
  - coste de correccion manual
  - recencia
- Promocion automatica a `recommended` cuando supera umbral.
- Degradacion a `experimental` si cae por debajo de umbral.

### 4) Capa de ejecucion

- En recomendacion/materializacion priorizar packs `recommended` compatibles con:
  - `projectType`
  - `ui5Version` objetivo
  - politicas activas del proyecto.

## Pre-desarrollo: checklist de verificacion

1. Confirmar contrato de datos:
   - schema `feedback-execution@1.0.0`
   - schema `pack-metrics@1.0.0`
2. Definir politica inicial:
   - umbral promocion (por ejemplo score >= 75 y min 5 ejecuciones)
   - umbral degradacion (por ejemplo score < 55 en ventana reciente)
3. Confirmar guardrails:
   - sin escritura fuera de `.codex/mcp`
   - `dryRun` por defecto en operaciones de riesgo
4. Definir corpus de evaluacion:
   - minimo 5 escenarios UI5 representativos (form, list, table, routing, i18n)
5. Definir trazabilidad:
   - cada promocion/degradacion debe dejar evidencia en archivo de estado.

## Plan de implementacion por fases

### Fase 1: Contratos + feedback (base)

- Nueva tool: `record_agent_execution_feedback`.
- Salidas:
  - append a `executions.jsonl`
  - resumen incremental en `metrics.json`.

### Fase 2: Ranking + recomendacion contextual

- Nueva tool: `rank_agent_packs`.
- Integrar ranking en `recommend_project_agents` sin romper compatibilidad.

### Fase 3: Promocion/degradacion

- Nueva tool: `promote_agent_pack`.
- Estados: `experimental`, `candidate`, `recommended`, `deprecated`.

### Fase 4: Politicas por proyecto

- Extender quality gate y validacion de agentes para respetar `agent-policy.json`.

## Criterios Go/No-Go para empezar desarrollo

Go:

- Schemas cerrados y versionados.
- Reglas de scoring/politica aprobadas.
- Escenarios de test definidos.

No-Go:

- No existe acuerdo sobre umbrales de promocion.
- No hay formato de feedback estable.
- No hay estrategia de rollback para cambios de estado de packs.

## Definition of Done (MVP)

1. Feedback registrable y consultable en local.
2. Ranking reproducible y explicable por pack/contexto.
3. Recomendacion prioriza packs con mejor score.
4. Promocion/degradacion auditable.
5. `npm run check` verde + docs actualizadas.
