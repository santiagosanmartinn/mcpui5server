# Arquitectura interna

## Estructura del codigo

```text
src/
  index.js
  server/
    mcpServer.js
    toolRegistry.js
  tools/
    ui5/
    javascript/
    project/
    documentation/
    index.js
  utils/
    fileSystem.js
    parser.js
    validator.js
    logger.js
    errors.js
    http.js
```

## Componentes clave

## 1) Bootstrap

- Archivo: `src/index.js`
- Responsabilidad:
  - Crear transporte STDIO.
  - Conectar el `McpServer`.
  - Manejar cierre limpio al terminar `stdin`.

## 2) Servidor MCP

- Archivo: `src/server/mcpServer.js`
- Responsabilidad:
  - Construir instancia `McpServer` con metadatos del servidor.
  - Crear `ToolRegistry`.
  - Inyectar contexto compartido:
    - `rootDir` del workspace
    - logger
  - Registrar todas las tools definidas en `src/tools/index.js`.

## 3) Registro dinamico de tools

- Archivo: `src/server/toolRegistry.js`
- Responsabilidad:
  - Recibir definiciones de tools (`name`, `description`, `inputSchema`, `outputSchema`, `handler`).
  - Registrarlas con `server.registerTool(...)`.
  - Ejecutar handlers con control unificado de errores.
  - En tools con `outputSchema`, responder tanto:
    - `structuredContent` (determinista para clientes)
    - `content` en texto JSON legible.

## 4) Utilidades

- `src/utils/fileSystem.js`:
  - Sandbox al root de proyecto.
  - Bloqueo de path traversal.
  - Lectura segura de texto/JSON.
  - Busqueda de contenido por archivos.
- `src/utils/errors.js`:
  - `ToolError` con `code` y `details`.
  - Normalizacion de errores inesperados.
- `src/utils/logger.js`:
  - Logging estructurado por `scope`.
- `src/utils/parser.js`:
  - Extraccion de imports, deps de `sap.ui.define`, metodos controller, estructura de clases.
- `src/utils/validator.js`:
  - Validaciones UI5 (`sap.ui.define`, dependencias, convenciones, MVC).
  - Lint JS basico y escaneo de seguridad.
- `src/utils/http.js`:
  - `fetchJson` con timeout y manejo de errores HTTP.

## Contrato de una tool

Cada tool exporta un objeto con esta forma:

```js
{
  name: "tool_name",
  description: "descripcion",
  inputSchema: z.object(...).strict(),
  outputSchema: z.object(...),
  async handler(args, { context, extra }) { ... }
}
```

## Como agregar una nueva tool

1. Crear archivo en dominio correcto (`src/tools/<dominio>/...`).
2. Definir schemas de entrada/salida con `zod`.
3. Implementar `handler`.
4. Exportar la tool.
5. Agregarla en `src/tools/index.js` dentro de `allTools`.
6. Ejecutar `npm run check`.

