# 04 - Guia Rapida Codex (Instrucciones y atajos)

Usa estas instrucciones para trabajar mas rapido y con buena calidad.

Si no entiendes algun termino tecnico, revisa:
- [00-conceptos-clave.md](./00-conceptos-clave.md)

## 1) Instruccion base para cualquier tarea

```text
Usa el MCP sapui5 en modo MCP-first.
Primero analiza con analyze_ui5_project y search_project_files.
Propone plan minimo.
Antes de escribir usa write_project_file_preview.
Para aplicar cambios usa apply_project_patch.
Valida con run_project_quality_gate y npm run check.
Si hay regresion, usa rollback_project_patch.
```

## 2) Instruccion para proyecto heredado

```text
Prepara primero el proyecto heredado con prepare_legacy_project_for_ai.
Si falta contexto (needsUserInput=true), deten y lista preguntas pendientes.
Despues recomienda y materializa agentes.
Mantener siempre compatibilidad UI5 y seguridad.
```

## 3) Instruccion para funcionalidad UI5

```text
Analiza impacto en webapp y manifest.
Genera implementacion minima, segura y compatible con la version UI5 del proyecto.
Usa sync_manifest_json para routing/targets.
No apliques sin preview.
```

## 4) Instruccion para correccion rapida

```text
Haz diagnostico minimo del bug.
Limita el cambio al menor alcance posible.
Muestra preview del patch.
Aplica y ejecuta la puerta de calidad.
Si algo empeora, rollback inmediato.
```

## 5) Instruccion para mejorar agentes

```text
Recomienda agentes segun estado actual del proyecto.
Materializa en dryRun, revisa y aplica.
Valida blueprint en strict.
Registra feedback de ejecucion y re-rankea packs.
```

## 6) Atajos de decision

- "No conozco el proyecto": `prepare_legacy_project_for_ai`
- "Quiero crear agentes ya": `materialize_recommended_agents`
- "Solo quiero corregir algo": `write_project_file_preview -> apply_project_patch -> run_project_quality_gate`
- "Quiero asegurar calidad": `run_project_quality_gate` + `npm run check`
