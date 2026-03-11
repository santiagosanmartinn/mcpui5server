# Roadmap de Implementacion con Codex

Este directorio define un plan ejecutable para evolucionar el servidor MCP SAPUI5 sin perder estabilidad.

Objetivos:
- Priorizar mejoras de mayor impacto para generacion, optimizacion y ampliacion de apps SAPUI5.
- Estandarizar como Codex implementa cambios (pasos, evidencia, pruebas, documentacion).
- Mantener compatibilidad y calidad durante todo el roadmap.
- Usar solo herramientas oficiales y open source.

## Como usar este paquete

1. Revisar el roadmap temporal en `roadmap-30-60-90.md`.
2. Seleccionar tareas listas en `backlog-priorizado.yaml` (sin dependencias pendientes).
3. Ejecutar cada tarea siguiendo `protocolo-ejecucion-codex.md`.
4. Validar salida con `definition-of-done.md`.
5. Si una decision afecta arquitectura, crear ADR con `plantillas/adr-template.md`.
6. Documentar cada PR usando `plantillas/pr-template.md`.
7. Para la evolucion de agentes globales local-first, revisar `mvp-global-agent-hub.md`.

## Estructura

- `roadmap-30-60-90.md`: plan por fases con fechas, resultados y metricas.
- `backlog-priorizado.yaml`: backlog ejecutable con IDs, dependencias y criterios de aceptacion.
- `protocolo-ejecucion-codex.md`: flujo estandar de implementacion para IA.
- `definition-of-done.md`: checklist minimo de calidad y salida.
- `herramientas-oficiales-open-source.md`: politica de herramientas permitidas.
- `mapa-servidor-actual.md`: explicacion del servidor actual por modulo.
- `mvp-global-agent-hub.md`: plan de pre-desarrollo y ejecucion para hub global de agentes.
- `ejecuciones/`: evidencia por tarea implementada (resultado real).
- `plantillas/`: plantillas para tareas, ADR y PR.
- `../adr/`: registro oficial de decisiones de arquitectura (ADR).

## Regla principal

Ninguna tarea se considera completada si no:
- pasa validaciones tecnicas,
- actualiza documentacion relevante,
- y deja trazabilidad clara para el siguiente desarrollador.
