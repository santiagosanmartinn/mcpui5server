# 05 - OData: MVP Cerrado vs Fase Avanzada

Este documento resume el estado de OData en el servidor MCP y el orden recomendado para seguir mejorando sin perder calidad.

## 1) MVP OData (estado actual)

Estado: `implementado`

Checklist:
- Ingestion de metadata OData V2/V4 con `analyze_odata_metadata`:
  - XML inline
  - archivo local
  - URL remota
  - `serviceUrl` con resolucion a `$metadata`
- Validacion de uso OData UI5 con `validate_ui5_odata_usage`:
  - coherencia `manifest` (`dataSources`/`models`)
  - deteccion de mismatch V2/V4
  - deteccion de patrones de riesgo en XML/JS
  - cruce opcional de entity sets contra metadata
- Integracion en puerta de calidad:
  - `run_project_quality_gate` ejecuta validacion OData
  - soporte de metadata OData opcional en el gate
  - soporte de perfil `qualityProfile` (`dev`/`prod`)
- Politica por proyecto:
  - `qualityGate.checkODataUsage`
  - `qualityGate.failOnODataWarnings`
  - `qualityGate.defaultProfile` + `qualityGate.profiles.dev/prod`
- Scaffolding OData base con `scaffold_ui5_odata_feature`:
  - genera controller + view + i18n + sync de manifest
  - resuelve `EntitySet`/`EntityType` desde metadata
  - flujo seguro con `dryRun`/preview/apply

## 2) Fase Avanzada OData (pendiente)

Estado: `pendiente`

Checklist:
- Autofix guiado:
  - correcciones seguras de findings OData de alta confianza
  - `dryRun` por defecto y `apply` explicito
- Seguridad enterprise:
  - recomendaciones por topologia (onPrem, cloud, servicios externos)
  - checklist de autenticacion/CSRF/proxy/destination por escenario
- Golden tests OData:
  - corpus de casos reales V2/V4
  - baseline de precision para evitar regresiones
- Observabilidad OData:
  - metricas de hallazgos por regla/proyecto
  - trazabilidad de mejora de calidad por iteracion

## 3) Prioridad recomendada (orden de ejecucion)

1. Golden tests OData (blindaje de calidad para no degradar al escalar reglas).
2. Autofix guiado (reduce tiempo operativo manteniendo control).
3. Seguridad enterprise por escenario (hardening productivo).
4. Observabilidad OData (optimizacion continua basada en datos).

## 4) Criterio de "cerrado de fase"

Fase avanzada OData se considera cerrada cuando:
- existe flujo OData "analizar -> implementar -> validar -> quality gate" de una sola pasada,
- los casos V2/V4 principales pasan con tests estables,
- el gate en `prod` bloquea errores y warnings OData definidos por policy.
