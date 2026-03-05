# SAPUI5 MCP Server (Node.js, STDIO)

MCP server that exposes SAPUI5 documentation and example discovery tools.

## Stack

- Node.js ESM
- MCP SDK v1 (`@modelcontextprotocol/sdk`)
- STDIO transport

## Tools

1. `search_ui5_docs`
- Searches official SAPUI5 documentation markdown files in `SAP-docs/sapui5` (`docs/` path).
- Inputs: `query`, optional `limit`.

2. `get_ui5_doc_content`
- Fetches markdown content for a documentation page from `SAP-docs/sapui5` by path.
- Inputs: `path` (with or without `docs/` and `.md`), optional `maxChars`.

3. `search_ui5_examples`
- Searches OpenUI5 demokit sample/tutorial sources in `SAP/openui5`.
- Inputs: `query`, optional `limit`, optional `ui5Version`.

4. `create_ui5_app_and_run`
- Scaffolds a SAPUI5 project using Fiori generator, installs dependencies, and starts UI5 dev server.
- Input: `projectName`.
- Executes:
  - `yo @sap/fiori:headless ui5config.json {projectName}`
  - `cd {projectName}`
  - `npm install`
  - `npx ui5 serve -o index.html`
- Returns command stdout/stderr and a server status (`running` or `not running`).

## Product-level behavior

### Source strategy

`UI5_SOURCE_STRATEGY` controls fetch behavior:

- `live` (default): always fetch fresh data.
- `cache`: keep in-memory TTL cache for HTTP responses.

`UI5_CACHE_TTL_MS` sets cache TTL (default `300000`).

### UI5 version behavior

`UI5_VERSION` controls generated UI5 SDK base links:

- `latest` (default): `https://ui5.sap.com`
- pinned version (example `1.120.0`): `https://ui5.sap.com/1.120.0`

`search_ui5_examples` can override this per call with `ui5Version`.

## Run locally

```bash
npm install
npm run start
```

## MCP client config example

```json
{
  "mcpServers": {
    "sapui5": {
      "command": "node",
      "args": ["/absolute/path/to/src/index.js"],
      "env": {
        "UI5_SOURCE_STRATEGY": "cache",
        "UI5_CACHE_TTL_MS": "300000",
        "UI5_VERSION": "latest"
      }
    }
  }
}
```

## Notes

- Data sources are official upstream repositories:
- Docs: `https://github.com/SAP-docs/sapui5`
- Examples: `https://github.com/SAP/openui5`
- GitHub unauthenticated API limits apply. If rate-limited, retry later or add token support.

## Calling from Codex

Example MCP tool call:

```json
{
  "tool": "create_ui5_app_and_run",
  "arguments": {
    "projectName": "my-ui5-app"
  }
}
```

Prerequisites on the machine where this MCP server runs:
- `yo` and `@sap/fiori` generator available
- `npm` available
- `npx ui5` available
