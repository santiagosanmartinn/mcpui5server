# Guia de uso del servidor

## Requisitos

- Node.js 20 o superior
- Dependencias instaladas con `npm install`

## Comandos principales

- Iniciar servidor MCP por STDIO: `npm run start`
- Modo desarrollo (watch): `npm run dev`
- Lint del codigo: `npm run lint`
- Tests unitarios/integracion local: `npm run test`
- Tests en modo CI: `npm run test:run`
- Cobertura de pruebas: `npm run coverage`
- Verificacion de calidad (lint + tests): `npm run check`

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

### Previsualizar escritura segura

```json
{
  "tool": "write_project_file_preview",
  "arguments": {
    "path": "webapp/controller/Main.controller.js",
    "content": "sap.ui.define([], function () { return {}; });"
  }
}
```

### Aplicar patch y obtener rollback

```json
{
  "tool": "apply_project_patch",
  "arguments": {
    "reason": "ajuste inicial",
    "changes": [
      {
        "path": "webapp/controller/Main.controller.js",
        "content": "sap.ui.define([], function () { return {}; });"
      }
    ]
  }
}
```

### Revertir patch aplicado

```json
{
  "tool": "rollback_project_patch",
  "arguments": {
    "patchId": "patch-20260310-170000000-abc12345"
  }
}
```

### Sincronizar manifest (dry-run)

```json
{
  "tool": "sync_manifest_json",
  "arguments": {
    "dryRun": true,
    "changes": {
      "routes": {
        "upsert": [
          {
            "name": "detail",
            "pattern": "detail/{id}",
            "target": ["detail"]
          }
        ]
      },
      "targets": {
        "upsert": {
          "detail": {
            "viewName": "Detail"
          }
        }
      }
    }
  }
}
```

### Generar feature UI5 end-to-end (dry-run)

```json
{
  "tool": "generate_ui5_feature",
  "arguments": {
    "featureName": "SalesOrder",
    "dryRun": true
  }
}
```

### Gestionar i18n (reporte)

```json
{
  "tool": "manage_ui5_i18n",
  "arguments": {
    "mode": "report"
  }
}
```

### Gestionar i18n (fix con preview)

```json
{
  "tool": "manage_ui5_i18n",
  "arguments": {
    "mode": "fix",
    "dryRun": true
  }
}
```

### Analizar rendimiento UI5

```json
{
  "tool": "analyze_ui5_performance",
  "arguments": {
    "sourceDir": "webapp",
    "maxFindings": 100
  }
}
```

### Buscar en SDK UI5 con cache y timeout

```json
{
  "tool": "search_ui5_sdk",
  "arguments": {
    "query": "sap.m.Table",
    "timeoutMs": 8000,
    "cache": {
      "enabled": true,
      "ttlSeconds": 3600
    }
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

### Validar codigo UI5 (v2)

```json
{
  "tool": "validate_ui5_code",
  "arguments": {
    "sourceType": "javascript",
    "expectedControllerName": "MainController",
    "code": "sap.ui.define([], function () { return {}; });"
  }
}
```

### Validar compatibilidad UI5 por version y componente ideal

```json
{
  "tool": "validate_ui5_version_compatibility",
  "arguments": {
    "sourceDir": "webapp"
  }
}
```

### Escaneo de seguridad UI5 (XML + JS)

```json
{
  "tool": "security_check_ui5_app",
  "arguments": {
    "sourceDir": "webapp"
  }
}
```

### Scaffold de agentes de proyecto (dry-run)

```json
{
  "tool": "scaffold_project_agents",
  "arguments": {
    "dryRun": true,
    "projectType": "sapui5"
  }
}
```

Layout por defecto:
- Artefactos de agentes en `.codex/mcp/agents/...`
- Documentacion contextual en `docs/mcp/...`
- `.vscode/mcp.json` solo si `includeVscodeMcp: true`

### Validar artefactos de agentes (strict)

```json
{
  "tool": "validate_project_agents",
  "arguments": {
    "strict": true
  }
}
```

### Refrescar contexto incremental del proyecto

```json
{
  "tool": "refresh_project_context_docs",
  "arguments": {
    "sourceDir": "webapp",
    "dryRun": true
  }
}
```

### Ejecutar quality gate consolidado

```json
{
  "tool": "run_project_quality_gate",
  "arguments": {
    "sourceDir": "webapp",
    "refreshDocs": true,
    "applyDocs": false
  }
}
```

### Recomendar agentes desde analisis del proyecto

```json
{
  "tool": "recommend_project_agents",
  "arguments": {
    "sourceDir": "webapp",
    "maxRecommendations": 6,
    "includePackCatalog": true
  }
}
```

### Materializar agentes recomendados automaticamente

```json
{
  "tool": "materialize_recommended_agents",
  "arguments": {
    "sourceDir": "webapp",
    "dryRun": true,
    "includePackCatalog": true
  }
}
```

### Guardar agentes actuales como pack reutilizable

```json
{
  "tool": "save_agent_pack",
  "arguments": {
    "packName": "base-ui5-pack",
    "packVersion": "1.0.0",
    "dryRun": false
  }
}
```

### Listar packs disponibles

```json
{
  "tool": "list_agent_packs",
  "arguments": {}
}
```

### Aplicar un pack guardado en otro proyecto

```json
{
  "tool": "apply_agent_pack",
  "arguments": {
    "packSlug": "base-ui5-pack",
    "dryRun": true,
    "outputDir": ".codex/mcp/agents"
  }
}
```
