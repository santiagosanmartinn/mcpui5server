# Guia para nuevos desarrolladores

## 1. Primeros pasos

1. Ejecuta `npm install`.
2. Ejecuta `npm run check`.
3. Ejecuta `npm run start`.
4. Conecta un cliente MCP al `src/index.js`.

## 2. Que revisar primero en el codigo

1. `src/index.js` para entender el arranque.
2. `src/server/mcpServer.js` para ver composicion y contexto.
3. `src/server/toolRegistry.js` para el flujo de registro y errores.
4. `src/tools/index.js` para el catalogo completo de tools.
5. `src/utils/fileSystem.js` para seguridad del acceso a archivos.

## 3. Flujo de una llamada de tool

1. El cliente MCP invoca una tool por nombre.
2. MCP SDK valida argumentos con `inputSchema`.
3. `ToolRegistry` ejecuta `handler`.
4. La tool usa utilidades (`fileSystem`, `parser`, `validator`, `http`).
5. La respuesta vuelve como `structuredContent` y `content`.
6. Si falla, se serializa error estructurado (`ToolError` o normalizado).

## 4. Convenciones de implementacion

- Mantener herramientas por dominio (`ui5`, `javascript`, `project`, `documentation`).
- Siempre usar schemas `zod` con `.strict()`.
- Para I/O de archivos, usar solo `utils/fileSystem.js`.
- Para errores de negocio, lanzar `ToolError` con `code` estable.
- Evitar logica duplicada: reutilizar `parser.js` y `validator.js`.

## 5. Seguridad y limites

- Nunca acceder fuera de `context.rootDir`.
- No usar rutas absolutas directas en handlers.
- Limitar resultados en busquedas (`maxResults`).
- Mantener respuestas deterministas y JSON serializable.

## 6. Checklist para cambios

1. Nueva tool agregada a `src/tools/index.js`.
2. `inputSchema` y `outputSchema` definidos.
3. Errores estructurados.
4. Ejemplo documentado en `docs/referencia-tools.md`.
5. `npm run check` en verde.

## 7. Mejoras recomendadas (siguientes pasos)

- Agregar tests unitarios por tool.
- Agregar tests de integracion para respuestas MCP reales.
- Reforzar parser JS con AST (sin romper simplicidad actual).
- Versionar salida de tools para compatibilidad futura.

