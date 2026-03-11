# Politica de herramientas oficiales y open source

Esta politica es obligatoria para cualquier nueva dependencia o herramienta usada en implementaciones del roadmap.

## Criterios minimos de aceptacion

Una herramienta solo se puede usar si cumple todo:
- Licencia open source reconocida (MIT, Apache-2.0, BSD, MPL-2.0, ISC).
- Repositorio publico activo.
- Mantenimiento reciente (actividad en los ultimos 12 meses).
- Documentacion oficial suficiente para uso y troubleshooting.

## Base actual aprobada

- Node.js (OpenJS Foundation, open source).
- npm (open source).
- `@modelcontextprotocol/sdk` (SDK oficial del ecosistema MCP).
- `zod` (validacion de esquemas, open source).

## Herramientas recomendadas para el roadmap

- `eslint` + `@eslint/js` para lint estandar.
- `vitest` para pruebas unitarias/integracion.
- `@babel/parser` y `@babel/traverse` para AST JS/TS.
- `fast-xml-parser` para parseo XML de vistas/fragments UI5.
- `prettier` para formato consistente.
- `@ui5/cli` para tareas oficiales UI5 donde aplique.

Nota:
- Antes de incorporar una herramienta nueva, registrar decision en ADR y justificar por que no cubre la base actual.

## Herramientas no permitidas

- Dependencias sin licencia clara.
- Paquetes abandonados o sin mantenimiento comprobable.
- Herramientas cerradas cuando exista alternativa open source viable.
- Ejecutables remotos opacos sin trazabilidad.

## Proceso de aprobacion de dependencia nueva

1. Identificar necesidad tecnica concreta.
2. Evaluar alternativas open source.
3. Validar licencia, mantenimiento y seguridad.
4. Registrar decision en ADR.
5. Actualizar esta politica si la dependencia queda aprobada.

## Registro minimo por dependencia

Cada dependencia nueva debe documentar:
- nombre,
- version,
- licencia,
- repositorio,
- motivo de adopcion,
- plan de actualizacion.
