# Ejemplos de tools MCP

Este documento incluye un ejemplo minimo de entrada y salida por cada tool registrada.

## 1) `analyze_ui5_project`

Entrada:
```json
{
  "tool": "analyze_ui5_project",
  "arguments": {}
}
```

Salida (ejemplo):
```json
{
  "detectedFiles": {
    "ui5Yaml": true,
    "manifestJson": true,
    "packageJson": true
  },
  "ui5Version": "1.120.0",
  "models": ["i18n", ""],
  "routing": {
    "hasRouting": true,
    "routes": 3,
    "targets": 4
  },
  "namespace": "demo.app",
  "controllerPattern": "Controller.extend"
}
```

## 2) `read_project_file`

Entrada:
```json
{
  "tool": "read_project_file",
  "arguments": {
    "path": "webapp/controller/Main.controller.js",
    "maxChars": 4000
  }
}
```

Salida (ejemplo):
```json
{
  "path": "webapp/controller/Main.controller.js",
  "content": "sap.ui.define([...]);",
  "truncated": false
}
```

## 3) `search_project_files`

Entrada:
```json
{
  "tool": "search_project_files",
  "arguments": {
    "query": "onInit",
    "extensions": ["js"],
    "maxResults": 20
  }
}
```

Salida (ejemplo):
```json
{
  "query": "onInit",
  "matches": [
    "webapp/controller/Main.controller.js",
    "webapp/controller/App.controller.js"
  ]
}
```

## 4) `analyze_current_file`

Entrada:
```json
{
  "tool": "analyze_current_file",
  "arguments": {
    "path": "webapp/controller/Main.controller.js"
  }
}
```

Salida (ejemplo):
```json
{
  "path": "webapp/controller/Main.controller.js",
  "imports": {
    "esmImports": [],
    "sapUiDefineDependencies": ["sap/ui/core/mvc/Controller"]
  },
  "classNames": [],
  "controllerPattern": "Controller.extend",
  "controllerMethods": ["onInit", "onSearch"]
}
```

## 5) `write_project_file_preview`

Entrada:
```json
{
  "tool": "write_project_file_preview",
  "arguments": {
    "path": "webapp/controller/Main.controller.js",
    "content": "sap.ui.define([], function () { return {}; });",
    "maxDiffLines": 60
  }
}
```

Salida (ejemplo):
```json
{
  "path": "webapp/controller/Main.controller.js",
  "existsBefore": true,
  "changed": true,
  "oldHash": "8f4d...",
  "newHash": "ab91...",
  "bytesBefore": 1321,
  "bytesAfter": 58,
  "lineSummary": {
    "added": 1,
    "removed": 4,
    "changed": 2,
    "unchanged": 18
  },
  "diffPreview": "- 10: old line\n+ 10: new line",
  "diffTruncated": false
}
```

## 6) `apply_project_patch`

Entrada:
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

Salida (ejemplo):
```json
{
  "patchId": "patch-20260310-171500123-a1b2c3d4",
  "appliedAt": "2026-03-10T17:15:00.000Z",
  "reason": "ajuste inicial",
  "changedFiles": [
    {
      "path": "webapp/controller/Main.controller.js",
      "changed": true,
      "oldHash": "8f4d...",
      "newHash": "ab91...",
      "bytesBefore": 1321,
      "bytesAfter": 58
    }
  ],
  "skippedFiles": []
}
```

## 7) `rollback_project_patch`

Entrada:
```json
{
  "tool": "rollback_project_patch",
  "arguments": {
    "patchId": "patch-20260310-171500123-a1b2c3d4"
  }
}
```

Salida (ejemplo):
```json
{
  "patchId": "patch-20260310-171500123-a1b2c3d4",
  "alreadyRolledBack": false,
  "rolledBackAt": "2026-03-10T17:16:00.000Z",
  "restoredFiles": [
    {
      "path": "webapp/controller/Main.controller.js",
      "action": "restored"
    }
  ]
}
```

## 8) `generate_ui5_controller`

Entrada:
```json
{
  "tool": "generate_ui5_controller",
  "arguments": {
    "controllerName": "demo.app.controller.Main",
    "methods": ["onSearch", "onReset"]
  }
}
```

Salida (ejemplo):
```json
{
  "controllerName": "demo.app.controller.Main",
  "code": "sap.ui.define([...]);"
}
```

## 9) `generate_ui5_fragment`

Entrada:
```json
{
  "tool": "generate_ui5_fragment",
  "arguments": {
    "fragmentName": "demo.app.view.fragments.FilterBar",
    "controls": ["Input", "Button"]
  }
}
```

Salida (ejemplo):
```json
{
  "fragmentName": "demo.app.view.fragments.FilterBar",
  "code": "<core:FragmentDefinition ...>...</core:FragmentDefinition>"
}
```

## 10) `generate_ui5_formatter`

Entrada:
```json
{
  "tool": "generate_ui5_formatter",
  "arguments": {
    "formatterName": "formatter",
    "functions": ["toUpper", "formatBoolean"]
  }
}
```

Salida (ejemplo):
```json
{
  "formatterName": "formatter",
  "code": "sap.ui.define([], function () { ... });"
}
```

## 11) `generate_ui5_view_logic`

Entrada:
```json
{
  "tool": "generate_ui5_view_logic",
  "arguments": {
    "viewName": "Main",
    "events": ["search", "navBack"]
  }
}
```

Salida (ejemplo):
```json
{
  "viewName": "Main",
  "code": "onSearch: function (oEvent) { ... }"
}
```

## 12) `validate_ui5_code`

Entrada:
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

Salida (ejemplo):
```json
{
  "isValid": true,
  "issues": [],
  "issueDetails": [],
  "issuesByCategory": {
    "structure": [],
    "mvc": [],
    "naming": [],
    "performance": []
  },
  "rulesVersion": "2.0.0",
  "sourceType": "javascript",
  "controllerMethods": [],
  "missingLifecycleMethods": []
}
```

## 13) `generate_javascript_function`

Entrada:
```json
{
  "tool": "generate_javascript_function",
  "arguments": {
    "description": "create a cache aware fetch wrapper",
    "runtime": "node",
    "typescript": false
  }
}
```

Salida (ejemplo):
```json
{
  "functionName": "createCacheAwareFetchWrapper",
  "runtime": "node",
  "typescript": false,
  "code": "export async function createCacheAwareFetchWrapper(...) { ... }"
}
```

## 14) `refactor_javascript_code`

Entrada:
```json
{
  "tool": "refactor_javascript_code",
  "arguments": {
    "code": "var x = 1; Promise.resolve(x).then(function(v){ return v; });"
  }
}
```

Salida (ejemplo):
```json
{
  "refactoredCode": "const x = 1; Promise.resolve(x).then(v => { return v; });",
  "changes": [
    "Converted var declarations using AST (1 to const, 0 to let).",
    "Converted 1 Promise handler function(s) to arrow syntax."
  ]
}
```

## 15) `lint_javascript_code`

Entrada:
```json
{
  "tool": "lint_javascript_code",
  "arguments": {
    "code": "var x = 1; console.log(x);"
  }
}
```

Salida (ejemplo):
```json
{
  "warnings": [
    {
      "rule": "no-var",
      "message": "Use let or const instead of var.",
      "line": 1
    }
  ],
  "suggestedFixes": [
    "Replace var with const where values are not reassigned."
  ]
}
```

## 16) `security_check_javascript`

Entrada:
```json
{
  "tool": "security_check_javascript",
  "arguments": {
    "code": "eval(userInput);"
  }
}
```

Salida (ejemplo):
```json
{
  "safe": false,
  "findings": [
    {
      "severity": "HIGH",
      "description": "Use of eval() can enable arbitrary code execution."
    }
  ]
}
```

## 17) `search_ui5_sdk`

Entrada:
```json
{
  "tool": "search_ui5_sdk",
  "arguments": {
    "query": "sap.m.Table",
    "maxResults": 3,
    "timeoutMs": 8000,
    "cache": {
      "enabled": true,
      "ttlSeconds": 3600
    }
  }
}
```

Salida (ejemplo):
```json
{
  "query": "sap.m.Table",
  "source": "https://ui5.sap.com/test-resources/sap/ui/documentation/sdk/inverted-index.json",
  "results": [
    {
      "title": "sap.m.Table",
      "url": "https://ui5.sap.com/#/api/sap.m.Table",
      "summary": "Official SAPUI5 SDK entry.",
      "example": "sap.ui.require([...]);"
    }
  ],
  "trace": {
    "provider": "sapui5-sdk",
    "queriedAt": "2026-03-10T17:00:00.000Z",
    "fetchedAt": "2026-03-10T16:59:58.000Z",
    "timeoutMs": 8000,
    "cache": {
      "enabled": true,
      "hit": false,
      "forceRefresh": false,
      "ttlSeconds": 3600,
      "key": "ui5-sdk-index-...",
      "path": ".mcp-cache/documentation/ui5-sdk-index-....json"
    }
  }
}
```

## 18) `search_mdn`

Entrada:
```json
{
  "tool": "search_mdn",
  "arguments": {
    "query": "Array.prototype.map",
    "maxResults": 3,
    "timeoutMs": 7000,
    "cache": {
      "enabled": true,
      "ttlSeconds": 3600
    }
  }
}
```

Salida (ejemplo):
```json
{
  "query": "Array.prototype.map",
  "source": "https://developer.mozilla.org/api/v1/search?q=Array.prototype.map&locale=en-US",
  "results": [
    {
      "title": "Array.prototype.map()",
      "url": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map",
      "summary": "Creates a new array with results of calling a function for every array element."
    }
  ],
  "trace": {
    "provider": "mdn",
    "queriedAt": "2026-03-10T17:00:00.000Z",
    "fetchedAt": "2026-03-10T16:59:59.000Z",
    "timeoutMs": 7000,
    "cache": {
      "enabled": true,
      "hit": false,
      "forceRefresh": false,
      "ttlSeconds": 3600,
      "key": "mdn-search-...",
      "path": ".mcp-cache/documentation/mdn-search-....json"
    }
  }
}
```

## 19) `sync_manifest_json`

Entrada:
```json
{
  "tool": "sync_manifest_json",
  "arguments": {
    "dryRun": true,
    "changes": {
      "models": {
        "upsert": {
          "device": {
            "type": "sap.ui.model.json.JSONModel"
          }
        }
      },
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

Salida (ejemplo):
```json
{
  "manifestPath": "webapp/manifest.json",
  "dryRun": true,
  "changed": true,
  "preValidation": {
    "valid": true,
    "errors": [],
    "warnings": []
  },
  "postValidation": {
    "valid": true,
    "errors": [],
    "warnings": []
  },
  "summary": {
    "modelsAdded": 1,
    "modelsUpdated": 0,
    "modelsRemoved": 0,
    "routesAdded": 1,
    "routesUpdated": 0,
    "routesRemoved": 0,
    "targetsAdded": 1,
    "targetsUpdated": 0,
    "targetsRemoved": 0
  },
  "preview": {
    "oldHash": "2b8e...",
    "newHash": "3c9f...",
    "diffPreview": "- 95: old route\n+ 95: detail route",
    "diffTruncated": false
  },
  "applyResult": null
}
```

## 20) `generate_ui5_feature`

Entrada:
```json
{
  "tool": "generate_ui5_feature",
  "arguments": {
    "featureName": "SalesOrder",
    "dryRun": true
  }
}
```

## 21) `manage_ui5_i18n`

Entrada:
```json
{
  "tool": "manage_ui5_i18n",
  "arguments": {
    "mode": "fix",
    "dryRun": true,
    "keyPrefix": "app"
  }
}
```

Salida (ejemplo):
```json
{
  "mode": "fix",
  "dryRun": true,
  "changed": true,
  "sourceDir": "webapp",
  "i18nPath": "webapp/i18n/i18n.properties",
  "fileReports": [
    {
      "path": "webapp/view/Orders.view.xml",
      "literalsFound": 2,
      "usedKeys": 1,
      "missingKeys": ["orders.description"],
      "nonLocalizedLiterals": [
        {
          "line": 2,
          "attribute": "title",
          "text": "Orders",
          "suggestedKey": "app.view.orders.orders"
        }
      ]
    }
  ],
  "missingKeys": [
    {
      "key": "orders.description",
      "usageCount": 1,
      "files": ["webapp/view/Orders.view.xml"]
    }
  ],
  "unusedKeys": ["legacy.unused"],
  "summary": {
    "filesScanned": 4,
    "literalsFound": 3,
    "usedKeys": 2,
    "missingKeys": 1,
    "unusedKeys": 1,
    "keysAdded": 3,
    "keysUpdated": 0,
    "keysUnchanged": 0
  },
  "previews": [
    {
      "path": "webapp/view/Orders.view.xml",
      "changed": true,
      "existsBefore": true
    }
  ],
  "applyResult": null
}
```

## 22) `analyze_ui5_performance`

Entrada:
```json
{
  "tool": "analyze_ui5_performance",
  "arguments": {
    "sourceDir": "webapp",
    "maxFindings": 100
  }
}
```

## 23) `scaffold_project_agents`

Entrada:
```json
{
  "tool": "scaffold_project_agents",
  "arguments": {
    "projectName": "ProyectoX",
    "projectType": "sapui5",
    "dryRun": true
  }
}
```

Salida (ejemplo):
```json
{
  "dryRun": true,
  "changed": true,
  "project": {
    "name": "ProyectoX",
    "type": "sapui5",
    "namespace": "proyecto.x"
  },
  "files": {
    "blueprintPath": ".codex/mcp/agents/agent.blueprint.json",
    "agentsGuidePath": ".codex/mcp/agents/AGENTS.generated.md",
    "bootstrapPromptPath": ".codex/mcp/agents/prompts/task-bootstrap.txt",
    "contextDocPath": "docs/mcp/project-context.md",
    "flowsDocPath": "docs/mcp/agent-flows.md",
    "mcpConfigPath": null
  },
  "fileSummary": {
    "created": 4,
    "updated": 0,
    "unchanged": 0
  },
  "applyResult": null
}
```

## 24) `validate_project_agents`

Entrada:
```json
{
  "tool": "validate_project_agents",
  "arguments": {
    "strict": true
  }
}
```

## 25) `recommend_project_agents`

Entrada:
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

Salida (ejemplo):
```json
{
  "project": {
    "name": "demo.app",
    "type": "sapui5",
    "namespace": "demo.app"
  },
  "signals": {
    "jsFiles": 12,
    "xmlFiles": 5,
    "hasI18n": true
  },
  "recommendations": [
    {
      "id": "ui5-architect",
      "priority": "high",
      "score": 0.98
    }
  ],
  "suggestedMaterializationArgs": {
    "agentDefinitions": [
      {
        "id": "architect"
      }
    ]
  }
}
```

## 26) `materialize_recommended_agents`

Entrada:
```json
{
  "tool": "materialize_recommended_agents",
  "arguments": {
    "dryRun": true,
    "includePackCatalog": true
  }
}
```

Salida (ejemplo):
```json
{
  "source": "auto-recommend",
  "usedRecommendations": 4,
  "selectedRecommendationIds": [
    "ui5-architect",
    "ui5-feature-implementer"
  ],
  "scaffoldResult": {
    "dryRun": true,
    "changed": true
  }
}
```

## 27) `save_agent_pack`

Entrada:
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

Salida (ejemplo):
```json
{
  "dryRun": false,
  "changed": true,
  "pack": {
    "name": "base-ui5-pack",
    "slug": "base-ui5-pack",
    "version": "1.0.0",
    "fingerprint": "f2c1..."
  },
  "validation": {
    "valid": true,
    "errorCount": 0,
    "warningCount": 0
  }
}
```

## 28) `list_agent_packs`

Entrada:
```json
{
  "tool": "list_agent_packs",
  "arguments": {}
}
```

Salida (ejemplo):
```json
{
  "packCatalogPath": ".codex/mcp/packs/catalog.json",
  "exists": true,
  "packs": [
    {
      "name": "base-ui5-pack",
      "slug": "base-ui5-pack",
      "version": "1.0.0",
      "projectType": "sapui5"
    }
  ]
}
```

## 29) `apply_agent_pack`

Entrada:
```json
{
  "tool": "apply_agent_pack",
  "arguments": {
    "packSlug": "base-ui5-pack",
    "dryRun": true,
    "outputDir": ".codex/mcp/agents-from-pack"
  }
}
```

## 30) `refresh_project_context_docs`

Entrada:
```json
{
  "tool": "refresh_project_context_docs",
  "arguments": {
    "sourceDir": "webapp",
    "dryRun": true
  }
}
```

Salida (ejemplo):
```json
{
  "dryRun": true,
  "changed": true,
  "sourceDir": "webapp",
  "docsDir": "docs/mcp",
  "cachePath": ".codex/mcp/context-snapshot.json",
  "delta": {
    "hasPreviousSnapshot": false,
    "added": 24,
    "modified": 0,
    "removed": 0,
    "unchanged": 0
  },
  "tracked": {
    "totalFiles": 24,
    "jsFiles": 12,
    "xmlFiles": 6
  },
  "applyResult": null
}
```

Salida (ejemplo):
```json
{
  "selectedPack": {
    "slug": "base-ui5-pack",
    "version": "1.0.0"
  },
  "integrity": {
    "fingerprintMatches": true
  },
  "scaffoldResult": {
    "dryRun": true,
    "changed": true
  }
}
```

Salida (ejemplo):
```json
{
  "blueprintPath": ".codex/mcp/agents/agent.blueprint.json",
  "strict": true,
  "valid": true,
  "detected": {
    "projectName": "ProyectoX",
    "projectType": "sapui5",
    "agentCount": 3,
    "uniqueAllowedTools": 17,
    "requiredTools": 4
  },
  "summary": {
    "checksPassed": 9,
    "checksFailed": 0,
    "errorCount": 0,
    "warningCount": 0
  },
  "errors": [],
  "warnings": []
}
```

Salida (ejemplo):
```json
{
  "sourceDir": "webapp",
  "scanned": {
    "files": 25,
    "xmlFiles": 8,
    "jsFiles": 17
  },
  "summary": {
    "totalFindings": 4,
    "bySeverity": {
      "low": 1,
      "medium": 2,
      "high": 1
    },
    "byRule": {
      "UI5_PERF_JS_SYNC_XHR": 1,
      "UI5_PERF_XML_TABLE_NO_GROWING": 1
    },
    "truncated": false
  },
  "findings": [
    {
      "rule": "UI5_PERF_JS_SYNC_XHR",
      "severity": "high",
      "file": "webapp/controller/List.controller.js",
      "line": 18,
      "message": "Synchronous XHR detected (`async: false`).",
      "suggestion": "Use asynchronous request flows and promise-based handling.",
      "category": "javascript"
    }
  ]
}
```

Salida (ejemplo):
```json
{
  "dryRun": true,
  "changed": true,
  "feature": {
    "featureName": "SalesOrder",
    "namespace": "demo.app",
    "routeName": "salesOrder",
    "routePattern": "sales-order",
    "targetName": "SalesOrder",
    "controllerName": "demo.app.controller.SalesOrder",
    "fragmentName": "demo.app.view.fragments.SalesOrder",
    "paths": {
      "controller": "webapp/controller/SalesOrder.controller.js",
      "view": "webapp/view/SalesOrder.view.xml",
      "fragment": "webapp/view/fragments/SalesOrder.fragment.xml",
      "manifest": "webapp/manifest.json",
      "i18n": "webapp/i18n/i18n.properties"
    }
  },
  "fileSummary": {
    "created": 4,
    "updated": 1,
    "unchanged": 0
  },
  "manifestSummary": {
    "modelsAdded": 0,
    "modelsUpdated": 0,
    "modelsRemoved": 0,
    "routesAdded": 1,
    "routesUpdated": 0,
    "routesRemoved": 0,
    "targetsAdded": 1,
    "targetsUpdated": 0,
    "targetsRemoved": 0
  },
  "i18nSummary": {
    "keysAdded": 3,
    "keysUpdated": 0,
    "keysUnchanged": 0
  },
  "previews": [
    {
      "path": "webapp/controller/SalesOrder.controller.js",
      "role": "controller",
      "existsBefore": false,
      "changed": true
    }
  ],
  "applyResult": null
}
```
