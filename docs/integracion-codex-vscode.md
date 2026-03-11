# Integracion Codex + MCP (VSCode)

Guia practica para que Codex use este servidor MCP de forma consistente y con foco en calidad.

## 1) Configuracion del servidor MCP

Este repositorio ya incluye la configuracion en `.vscode/mcp.json`:

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

Requisitos:

- Node.js 20+
- Dependencias instaladas (`npm install`)

## 2) Verificacion rapida

1. Abre el workspace en VSCode.
2. Asegura que el servidor MCP `sapui5` aparezca disponible en la extension de Codex.
3. Lanza una prueba simple pidiendo:
   - `analyze_ui5_project`
   - `search_project_files` con `query: "onInit"`

Si ambas respuestas vuelven datos estructurados, la integracion esta operativa.

## 3) Flujo recomendado para maximo rendimiento

Usar este orden en tareas reales:

1. Descubrimiento:
   - `analyze_ui5_project`
   - `search_project_files`
   - `analyze_current_file`
2. Diseno/cambios:
   - `generate_ui5_*` o tools `javascript/*` segun tarea
   - `sync_manifest_json` para routing/models/targets
3. Seguridad de cambios:
   - `write_project_file_preview`
   - `apply_project_patch`
   - `rollback_project_patch` si hace falta revertir
4. Calidad final:
   - `validate_ui5_code`
   - `analyze_ui5_performance`
   - `manage_ui5_i18n` (`report` o `fix` con `dryRun`)
   - `npm run check`

## 4) Prompt base recomendado para Codex

Puedes reutilizar este prompt al iniciar tareas:

```text
Usa el MCP sapui5 en modo MCP-first para esta tarea.
Primero ejecuta analyze_ui5_project y analiza los archivos relevantes con search_project_files/analyze_current_file.
Antes de escribir, genera preview con write_project_file_preview.
Para aplicar cambios usa apply_project_patch.
Valida al final con validate_ui5_code, analyze_ui5_performance y npm run check.
Si hay riesgo de regresion, prepara rollback_project_patch.
```

## 5) Convenciones para mantener calidad alta

- Preferir `dryRun: true` en tools de escritura cuando sea posible.
- No editar `manifest.json` manualmente si el cambio cabe en `sync_manifest_json`.
- Incluir siempre validacion y pruebas en el cierre de la tarea.
