# Roadmap 30-60-90 dias

Fecha base: 2026-03-10

## Fase 1 (Dia 0-30, 2026-03-10 a 2026-04-09): Fundacion tecnica

Meta:
- Pasar de herramientas heuristicas a base robusta y testeable.

Resultados esperados:
- Parser AST JS/TS para analisis y refactor seguro.
- Parser XML para vistas y fragments UI5.
- Primeras tools de escritura segura con `preview_diff` y `apply_patch`.
- Pipeline minima de calidad (tests + lint + check + docs).

KPIs de fase:
- >= 70% de cobertura en utilidades criticas (`parser`, `validator`, `fileSystem`).
- 0 regresiones en tools existentes.
- 100% de tools con contrato de entrada/salida documentado.

## Fase 2 (Dia 31-60, 2026-04-10 a 2026-05-09): Productividad UI5 end-to-end

Meta:
- Implementar capacidades completas de generacion y sincronizacion de app UI5.

Resultados esperados:
- Generador end-to-end (view + controller + routing + manifest + i18n).
- Sincronizador de `manifest.json` (rutas, targets, modelos).
- Ingestion de metadata OData V2/V4 para scaffolding de pantallas.
- Gestor de i18n (extraer literales, detectar faltantes, normalizar claves).

KPIs de fase:
- Reducir pasos manuales de scaffolding en >= 50%.
- >= 90% de cambios en manifest aplicados via tool dedicada.
- Cobertura de pruebas de integracion para flujo end-to-end.

## Fase 3 (Dia 61-90, 2026-05-10 a 2026-06-08): Calidad operativa y escalado

Meta:
- Consolidar observabilidad, seguridad, rendimiento y mantenibilidad.

Resultados esperados:
- Analizador de rendimiento UI5 (bindings pesados, antipatrones).
- Validaciones de seguridad ampliadas y trazables por regla.
- Metricas operativas por tool (tiempo, errores, uso).
- Playbooks de soporte y mantenimiento para equipos mixtos.

KPIs de fase:
- Tiempo medio de respuesta de tools criticas <= 2s en proyectos medianos.
- >= 80% de errores categorizados con codigos accionables.
- Documentacion operativa completa y validada por terceros.

## Priorizacion global

- P0: Estabilidad, seguridad, escritura segura, parser AST, test strategy.
- P1: Funcionalidad UI5 avanzada (manifest, OData, i18n, generacion end-to-end).
- P2: Observabilidad, optimizacion avanzada, hardening operativo.

## Riesgos y mitigaciones

- Riesgo: regresiones por migracion de regex a AST.
- Mitigacion: mantener compatibilidad incremental y tests de snapshot por tool.

- Riesgo: crecimiento de complejidad en tools de generacion.
- Mitigacion: separar pipelines por dominio y agregar ADR por decision clave.

- Riesgo: dependencia de librerias no mantenidas.
- Mitigacion: aplicar politica de `herramientas-oficiales-open-source.md` antes de agregar dependencias.
