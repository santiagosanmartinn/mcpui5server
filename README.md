# SAPUI5 MCP Server

Specialized MCP server for SAPUI5/Fiori JavaScript development with modular tools for project analysis, code generation, refactoring, validation, and documentation lookup.

## Architecture

```text
src/
  index.js
  server/
    mcpServer.js
    toolRegistry.js
  tools/
    ui5/
      generateController.js
      generateFragment.js
      generateFormatter.js
      generateViewLogic.js
      generateFeature.js
      manageI18n.js
      analyzePerformance.js
      validateUi5Code.js
    javascript/
      generateFunction.js
      refactorCode.js
      lintCode.js
      securityCheck.js
    project/
      analyzeProject.js
      readFile.js
      searchFiles.js
      analyzeCurrentFile.js
      syncManifest.js
      writePreview.js
      applyPatch.js
      rollbackPatch.js
    documentation/
      cacheStore.js
      searchUI5SDK.js
      searchMDN.js
    index.js
  utils/
    fileSystem.js
    manifestSync.js
    parser.js
    refactor.js
    patchWriter.js
    xmlParser.js
    validator.js
    logger.js
    errors.js
    http.js
```

## Implemented MCP Tools

1. `analyze_ui5_project`
2. `generate_ui5_controller`
3. `generate_ui5_fragment`
4. `generate_ui5_formatter`
5. `generate_ui5_view_logic`
6. `generate_ui5_feature`
7. `manage_ui5_i18n`
8. `analyze_ui5_performance`
9. `read_project_file`
10. `search_project_files`
11. `analyze_current_file`
12. `sync_manifest_json`
13. `write_project_file_preview`
14. `apply_project_patch`
15. `rollback_project_patch`
16. `search_ui5_sdk`
17. `search_mdn`
18. `generate_javascript_function`
19. `refactor_javascript_code`
20. `lint_javascript_code`
21. `security_check_javascript`
22. `validate_ui5_code`

All tools are dynamically discovered through the central registry in `src/tools/index.js` and registered with MCP `registerTool(...)` including:

- name
- description
- input schema
- output schema

## Reliability and Safety

- JSON-RPC and MCP-compatible tool registration via `@modelcontextprotocol/sdk`.
- Structured input/output validation with `zod`.
- Deterministic tool output shape via `structuredContent`.
- Sandboxed file access to workspace root only.
- Path traversal protection (`..` and out-of-root resolution blocked).
- Structured error responses with machine-readable `code` and `message`.
- Centralized logging for tool failures and lifecycle events.

## Run

```bash
npm install
npm run start
```

## Example Tool Calls

### `analyze_ui5_project`

```json
{
  "tool": "analyze_ui5_project",
  "arguments": {}
}
```

### `generate_ui5_controller`

```json
{
  "tool": "generate_ui5_controller",
  "arguments": {
    "controllerName": "demo.app.controller.Main",
    "methods": ["onPressSave", "onNavBack"]
  }
}
```

### `read_project_file`

```json
{
  "tool": "read_project_file",
  "arguments": {
    "path": "webapp/controller/Main.controller.js"
  }
}
```

### `generate_javascript_function`

```json
{
  "tool": "generate_javascript_function",
  "arguments": {
    "description": "create a cache-aware fetch wrapper",
    "runtime": "node",
    "typescript": false
  }
}
```

## Codex MCP Configuration

```json
{
  "mcpServers": {
    "sapui5": {
      "command": "node",
      "args": ["/absolute/path/to/MCPServerUI5/src/index.js"]
    }
  }
}
```

## Documentacion ampliada

Consulta la documentacion para onboarding y mantenimiento en [`docs/README.md`](./docs/README.md).
