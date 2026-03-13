# ADR-001 - Fundamentos tecnicos de fase P0

## Estado

Aprobado

## Contexto

La fase P0 del roadmap busca convertir el servidor MCP en una base robusta para evolucion futura sin romper compatibilidad.

Problemas detectados al inicio:
- parser JS basado en regex,
- falta de parser XML para UI5,
- ausencia de escritura segura en workspace,
- refactor JS textual,
- validaciones UI5 no categorizadas ni versionadas.

## Decision

Se aprueban estas decisiones de arquitectura:

1. Parser JS/TS basado en AST (Babel):
- usar `@babel/parser` y `@babel/traverse`.
- mantener fallback para codigo parcial/invalido.

2. Parser XML UI5 dedicado:
- usar `fast-xml-parser`.
- exponer analisis estructurado de namespaces, bindings, eventos y controles.

3. Escritura segura por patch:
- implementar `preview -> apply -> rollback`.
- guardar backups en `.codex/mcp/backups/` con `patchId`.
- validar hash base opcional para evitar sobrescrituras inesperadas.

4. Refactor JavaScript basado en AST:
- mover `refactor_javascript_code` a transformaciones AST.
- mantener contrato publico existente.

5. Validacion UI5 v2:
- reglas versionadas (`rulesVersion`).
- categorias (`structure`, `mvc`, `naming`, `performance`).
- compatibilidad hacia atras con `issues` legacy.

## Alternativas evaluadas

1. Mantener enfoque regex:
- descartado por fragilidad y falsos positivos.

2. Usar parser cerrado/no open source:
- descartado por politica de herramientas.

3. Aplicar cambios de archivo sin backup:
- descartado por riesgo operativo.

## Consecuencias

Positivas:
- mayor confiabilidad tecnica,
- mejor trazabilidad por reglas y versiones,
- rollback real para cambios en archivos.

Negativas:
- mayor complejidad interna de utilidades,
- mayor costo de mantenimiento de tests.

Mitigaciones:
- cobertura automatizada,
- documentacion por tareas ejecutadas,
- guia por niveles para onboarding.

## Impacto

Modulos afectados:
- `src/utils/parser.js`
- `src/utils/xmlParser.js`
- `src/utils/patchWriter.js`
- `src/utils/refactor.js`
- `src/utils/validator.js`
- tools asociadas de `project`, `javascript`, `ui5`

Compatibilidad:
- mantenida en contratos legacy.

Testing:
- ampliado con suites de utilidades y tests de tools.

Documentacion:
- actualizada en `docs/` y `docs/roadmap-codex/ejecuciones/`.

## Referencias

- Task IDs:
  - P0-001
  - P0-002
  - P0-003
  - P0-004
  - P0-005
  - P0-006
  - P0-007
