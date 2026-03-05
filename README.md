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
    documentation/
      searchUI5SDK.js
      searchMDN.js
    index.js
  utils/
    fileSystem.js
    parser.js
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
6. `read_project_file`
7. `search_project_files`
8. `analyze_current_file`
9. `search_ui5_sdk`
10. `search_mdn`
11. `generate_javascript_function`
12. `refactor_javascript_code`
13. `lint_javascript_code`
14. `security_check_javascript`
15. `validate_ui5_code`

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
