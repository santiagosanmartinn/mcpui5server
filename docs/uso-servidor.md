# Guia de uso del servidor

Este documento es la version corta y operativa.

Ruta recomendada:
- [00-conceptos-clave.md](./00-conceptos-clave.md)
- [01-getting-started.md](./01-getting-started.md)
- [02-flujos-operativos.md](./02-flujos-operativos.md)
- [03-operacion-y-policies.md](./03-operacion-y-policies.md)
- [04-cheatsheet-codex.md](./04-cheatsheet-codex.md)

Para detalle completo:
- [referencia-tools.md](./referencia-tools.md)
- [ejemplos-tools.md](./ejemplos-tools.md)

## 1) Requisitos

- Node.js 20 o superior
- Dependencias instaladas con `npm install`

## 2) Comandos clave

- iniciar servidor MCP: `npm run start`
- desarrollo: `npm run dev`
- validar calidad: `npm run check`
- pruebas en CI: `npm run test:run`

## 3) Integracion con Codex en VSCode

`.vscode/mcp.json`:

```json
{
  "mcpServers": {
    "sapui5": {
      "command": "node",
      "args": ["${workspaceFolder}/src/index.js"]
    }
  }
}
```

## 4) Flujos minimos por escenario

### Escenario A: proyecto nuevo

1. `recommend_project_agents`
2. `materialize_recommended_agents` (`dryRun: true` -> `dryRun: false`)
3. `run_project_quality_gate`
4. `npm run check`

### Escenario B: proyecto heredado

1. `prepare_legacy_project_for_ai`
2. revisar `needsUserInput`
3. `materialize_recommended_agents`
4. `run_project_quality_gate`
5. `npm run check`

### Escenario C: cambio puntual seguro

1. `analyze_ui5_project`
2. `search_project_files`
3. `write_project_file_preview`
4. `apply_project_patch`
5. `run_project_quality_gate`

## 5) Snippets minimos (copiar/pegar)

### Analisis inicial

```json
{
  "tool": "analyze_ui5_project",
  "arguments": {}
}
```

### Buscar impacto en codigo

```json
{
  "tool": "search_project_files",
  "arguments": {
    "query": "onInit",
    "extensions": ["js", "xml"],
    "maxResults": 30
  }
}
```

### Analizar metadata OData

```json
{
  "tool": "analyze_odata_metadata",
  "arguments": {
    "serviceUrl": "https://example.org/sap/opu/odata/sap/Z_SRV",
    "timeoutMs": 12000,
    "maxEntities": 120
  }
}
```

### Validar uso OData en UI5

```json
{
  "tool": "validate_ui5_odata_usage",
  "arguments": {
    "sourceDir": "webapp",
    "metadataPath": "docs/metadata/service.xml"
  }
}
```

### Scaffold OData end-to-end (base)

```json
{
  "tool": "scaffold_ui5_odata_feature",
  "arguments": {
    "entitySet": "SalesOrders",
    "metadataPath": "docs/metadata/service.xml",
    "dryRun": true
  }
}
```

### Preparar proyecto heredado para IA

```json
{
  "tool": "prepare_legacy_project_for_ai",
  "arguments": {
    "sourceDir": "webapp",
    "autoApply": true,
    "runEnsureProjectMcp": true
  }
}
```

### Recomendar agentes

```json
{
  "tool": "recommend_project_agents",
  "arguments": {
    "sourceDir": "webapp",
    "maxRecommendations": 6
  }
}
```

### Materializar agentes

```json
{
  "tool": "materialize_recommended_agents",
  "arguments": {
    "sourceDir": "webapp",
    "dryRun": true
  }
}
```

### Previsualizar cambio de archivo

```json
{
  "tool": "write_project_file_preview",
  "arguments": {
    "path": "webapp/controller/Main.controller.js",
    "content": "sap.ui.define([], function () { return {}; });"
  }
}
```

### Aplicar patch

```json
{
  "tool": "apply_project_patch",
  "arguments": {
    "reason": "feature-change",
    "changes": [
      {
        "path": "webapp/controller/Main.controller.js",
        "content": "sap.ui.define([], function () { return {}; });"
      }
    ]
  }
}
```

### Rollback si algo falla

```json
{
  "tool": "rollback_project_patch",
  "arguments": {
    "patchId": "patch-20260310-170000000-abc12345"
  }
}
```

### Quality gate consolidado

```json
{
  "tool": "run_project_quality_gate",
  "arguments": {
    "sourceDir": "webapp",
    "qualityProfile": "prod",
    "respectPolicy": true,
    "checkODataUsage": true,
    "odataMetadataPath": "docs/metadata/service.xml"
  }
}
```

## 6) Automatizaciones de arranque

- `MCP_AUTO_ENSURE_PROJECT=false`
  - desactiva sincronizacion MCP en startup
- `MCP_AUTO_ENSURE_PROJECT_APPLY=false`
  - deja sincronizacion MCP en dry-run
- `MCP_AUTO_PREPARE_CONTEXT=false`
  - desactiva preparacion de contexto en startup
- `MCP_AUTO_PREPARE_CONTEXT_APPLY=false`
  - deja preparacion de contexto en dry-run

## 7) Regla sencilla de calidad

1. primero `dryRun`
2. luego `apply`
3. cerrar con `run_project_quality_gate` + `npm run check`
