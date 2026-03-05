# Guia de uso del servidor

## Requisitos

- Node.js 20 o superior
- Dependencias instaladas con `npm install`

## Comandos principales

- Iniciar servidor MCP por STDIO: `npm run start`
- Modo desarrollo (watch): `npm run dev`
- Verificacion sintactica: `npm run check`

## Como se integra con Codex (MCP)

Ejemplo de configuracion:

```json
{
  "mcpServers": {
    "sapui5": {
      "command": "node",
      "args": ["/ruta/absoluta/MCPServerUI5/src/index.js"]
    }
  }
}
```

## Flujo de ejecucion

1. `src/index.js` crea transporte `StdioServerTransport`.
2. Se instancia el servidor con `createMcpServer()` en `src/server/mcpServer.js`.
3. Se cargan todas las tools desde `src/tools/index.js`.
4. Cada tool se registra dinamicamente mediante `ToolRegistry.applyToServer(...)`.
5. El cliente MCP puede descubrir y ejecutar tools con sus schemas.

## Ejemplos de llamadas

### Analizar proyecto UI5

```json
{
  "tool": "analyze_ui5_project",
  "arguments": {}
}
```

### Leer archivo del workspace de forma segura

```json
{
  "tool": "read_project_file",
  "arguments": {
    "path": "package.json"
  }
}
```

### Generar controller UI5

```json
{
  "tool": "generate_ui5_controller",
  "arguments": {
    "controllerName": "demo.app.controller.Main",
    "methods": ["onPressSave", "onNavBack"]
  }
}
```

