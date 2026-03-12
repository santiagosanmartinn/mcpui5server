# Ejemplos de herramientas MCP

Este documento incluye un ejemplo minimo de entrada y salida por cada herramienta registrada.

## Empieza por aqui (top 14)

Si eres nuevo, primero usa estos ejemplos:

1. `analyze_ui5_project` (seccion 1)
2. `search_project_files` (seccion 3)
3. `write_project_file_preview` (seccion 5)
4. `apply_project_patch` (seccion 6)
5. `rollback_project_patch` (seccion 7)
6. `validate_ui5_version_compatibility` (seccion 31)
7. `security_check_ui5_app` (seccion 32)
8. `run_project_quality_gate` (seccion 33)
9. `recommend_project_agents` (seccion 25)
10. `materialize_recommended_agents` (seccion 26)
11. `ensure_project_mcp_current` (seccion 39)
12. `prepare_legacy_project_for_ai` (seccion 43)
13. `analyze_odata_metadata` (seccion 44)
14. `scaffold_ui5_odata_feature` (seccion 46)

Rutas de aprendizaje:
- Inicio rapido: [01-getting-started.md](./01-getting-started.md)
- Flujos operativos: [02-flujos-operativos.md](./02-flujos-operativos.md)

## 1) `analyze_ui5_project`

Entrada:
```json
{
  "tool": "analyze_ui5_project",
  "arguments": {}
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
    "policyPath": ".codex/mcp/policies/agent-policy.json",
    "contextDocPath": "docs/mcp/project-context.md",
    "flowsDocPath": "docs/mcp/agent-flows.md",
    "mcpConfigPath": null
  },
  "fileSummary": {
    "created": 5,
    "updated": 0,
    "unchanged": 0
  },
  "applyResult": null
}
```

## 44) `analyze_odata_metadata`

Entrada:
```json
{
  "tool": "analyze_odata_metadata",
  "arguments": {
    "serviceUrl": "https://example.org/sap/opu/odata/sap/Z_SALESORDER_SRV",
    "timeoutMs": 12000,
    "maxEntities": 100
  }
}
```

Salida (ejemplo):
```json
{
  "source": {
    "mode": "service",
    "metadataPath": null,
    "metadataUrl": "https://example.org/sap/opu/odata/sap/Z_SALESORDER_SRV/$metadata"
  },
  "protocol": {
    "edmxVersion": "4.0",
    "odataVersion": "4.0"
  },
  "summary": {
    "schemas": 1,
    "entityTypesTotal": 6,
    "entityTypesReturned": 6,
    "entitySets": 4,
    "singletons": 1,
    "actions": 2,
    "functions": 1,
    "actionImports": 2,
    "functionImports": 1,
    "diagnostics": 0
  },
  "model": {
    "namespaces": ["Z_SALESORDER_SRV"],
    "entityTypes": [
      {
        "fullName": "Z_SALESORDER_SRV.SalesOrder",
        "keys": ["SalesOrder"],
        "properties": [
          { "name": "SalesOrder", "type": "Edm.String" },
          { "name": "CreatedAt", "type": "Edm.DateTimeOffset" }
        ]
      }
    ],
    "entitySets": [
      {
        "container": "Container",
        "name": "SalesOrders",
        "entityType": "Z_SALESORDER_SRV.SalesOrder"
      }
    ]
  },
  "diagnostics": []
}
```

## 45) `validate_ui5_odata_usage`

Entrada:
```json
{
  "tool": "validate_ui5_odata_usage",
  "arguments": {
    "sourceDir": "webapp",
    "metadataPath": "docs/metadata/service.xml"
  }
}
```

Salida (ejemplo):
```json
{
  "sourceMode": "project",
  "ui5Version": "1.120.0",
  "manifest": {
    "path": "webapp/manifest.json",
    "exists": true,
    "odataDataSources": 1,
    "odataModels": 1,
    "issues": 0
  },
  "metadata": {
    "provided": true,
    "sourceMode": "file",
    "odataVersion": "2.0",
    "entitySets": 5,
    "entityTypes": 6,
    "diagnostics": 0
  },
  "summary": {
    "totalFindings": 2,
    "errors": 0,
    "warnings": 2,
    "infos": 0,
    "pass": true
  },
  "findings": [
    {
      "rule": "ODATA_JS_BATCH_DISABLED",
      "severity": "warn",
      "category": "request",
      "file": "webapp/controller/Main.controller.js",
      "line": 41
    }
  ]
}
```

## 46) `scaffold_ui5_odata_feature`

Entrada:
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

Salida (ejemplo):
```json
{
  "dryRun": true,
  "changed": true,
  "contextGate": {
    "enforced": true,
    "ready": true,
    "intakePath": ".codex/mcp/project/intake.json",
    "intakeExists": true,
    "missingContext": [],
    "questions": []
  },
  "feature": {
    "featureName": "SalesOrders",
    "entitySet": "SalesOrders",
    "entityType": "Z_SALESORDER_SRV.SalesOrder",
    "namespace": "demo.app",
    "modelName": "",
    "dataSourceName": "mainService",
    "routeName": "salesOrders",
    "routePattern": "sales-orders",
    "targetName": "SalesOrders"
  },
  "bindingPlan": {
    "keyField": "SalesOrder",
    "titleField": "SalesOrder",
    "descriptionField": "CustomerName",
    "numberField": "GrossAmount"
  },
  "manifestSummary": {
    "dataSourceAdded": true,
    "dataSourceUpdated": false,
    "dataSourceUnchanged": false,
    "routesAdded": 1,
    "targetsAdded": 1
  },
  "previews": [
    {
      "path": "webapp/controller/SalesOrders.controller.js",
      "role": "controller",
      "changed": true
    },
    {
      "path": "webapp/view/SalesOrders.view.xml",
      "role": "view",
      "changed": true
    }
  ],
  "applyResult": null
}
```

Si el intake no esta completo, la tool bloquea la generacion con `ODATA_CONTEXT_GATE_BLOCKED` e indica:
- `missingContext`
- `questions`
- `nextActions`

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
  "policy": {
    "path": ".codex/mcp/policies/agent-policy.json",
    "loaded": true,
    "enforcedSections": ["ranking", "recommendation"]
  },
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

## 31) `validate_ui5_version_compatibility`

Entrada:
```json
{
  "tool": "validate_ui5_version_compatibility",
  "arguments": {
    "sourceDir": "webapp"
  }
}
```

Salida (ejemplo):
```json
{
  "ui5Version": "1.60.0",
  "summary": {
    "incompatible": 0,
    "recommendations": 2
  },
  "componentRecommendations": [
    {
      "currentComponent": "sap.m.Input",
      "suggestedComponent": "sap.m.DatePicker"
    }
  ]
}
```

## 32) `security_check_ui5_app`

Entrada:
```json
{
  "tool": "security_check_ui5_app",
  "arguments": {
    "sourceDir": "webapp"
  }
}
```

Salida (ejemplo):
```json
{
  "safe": false,
  "summary": {
    "totalFindings": 3,
    "bySeverity": {
      "high": 1,
      "medium": 1,
      "low": 1
    }
  }
}
```

## 33) `run_project_quality_gate`

Entrada:
```json
{
  "tool": "run_project_quality_gate",
  "arguments": {
    "sourceDir": "webapp",
    "qualityProfile": "prod",
    "checkODataUsage": true,
    "odataMetadataPath": "docs/metadata/service.xml",
    "refreshDocs": true,
    "applyDocs": false,
    "respectPolicy": true
  }
}
```

Salida (ejemplo):
```json
{
  "pass": false,
  "policy": {
    "path": ".codex/mcp/policies/agent-policy.json",
    "loaded": true,
    "enforced": true,
    "section": "qualityGate",
    "profile": "prod"
  },
  "summary": {
    "incompatibleSymbols": 1,
    "highSecurityFindings": 1,
    "odataErrors": 1,
    "odataWarnings": 2
  },
  "reports": {
    "compatibility": {
      "isCompatible": false
    },
    "odata": {
      "executed": true,
      "errors": 1,
      "warnings": 2
    },
    "security": {
      "safe": false
    }
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

## 34) `record_agent_execution_feedback`

Entrada:
```json
{
  "tool": "record_agent_execution_feedback",
  "arguments": {
    "packSlug": "base-ui5-pack",
    "packVersion": "1.0.0",
    "projectType": "sapui5",
    "ui5Version": "1.120.0",
    "outcome": "success",
    "qualityGatePass": true,
    "issuesIntroduced": 0,
    "manualEditsNeeded": 1,
    "timeSavedMinutes": 15,
    "tokenDeltaEstimate": 220,
    "dryRun": true
  }
}
```

Salida (ejemplo):
```json
{
  "dryRun": true,
  "changed": true,
  "record": {
    "id": "c2a82b96fd43acb1",
    "packKey": "base-ui5-pack@1.0.0",
    "recordedAt": "2026-03-11T11:30:00.000Z",
    "outcome": "success"
  },
  "files": {
    "feedbackPath": ".codex/mcp/feedback/executions.jsonl",
    "metricsPath": ".codex/mcp/feedback/metrics.json"
  },
  "metrics": {
    "totalExecutions": 14,
    "totals": {
      "success": 11,
      "partial": 2,
      "failed": 1
    },
    "pack": {
      "executions": 6,
      "outcomes": {
        "success": 5,
        "partial": 1,
        "failed": 0
      },
      "qualityGatePasses": 5,
      "qualityGateFails": 1,
      "issuesIntroducedTotal": 2,
      "manualEditsNeededTotal": 7,
      "timeSavedMinutesTotal": 96,
      "tokenDeltaEstimateTotal": 1180
    }
  },
  "previews": [
    {
      "path": ".codex/mcp/feedback/executions.jsonl",
      "role": "feedback-log",
      "existsBefore": true,
      "changed": true
    },
    {
      "path": ".codex/mcp/feedback/metrics.json",
      "role": "feedback-metrics",
      "existsBefore": true,
      "changed": true
    }
  ],
  "applyResult": null
}
```

## 35) `rank_agent_packs`

Entrada:
```json
{
  "tool": "rank_agent_packs",
  "arguments": {
    "projectType": "sapui5",
    "minExecutions": 1,
    "maxResults": 3,
    "includeUnscored": true,
    "respectPolicy": true
  }
}
```

Salida (ejemplo):
```json
{
  "packCatalogPath": ".codex/mcp/packs/catalog.json",
  "metricsPath": ".codex/mcp/feedback/metrics.json",
  "policy": {
    "path": ".codex/mcp/policies/agent-policy.json",
    "loaded": true,
    "enforced": true,
    "section": "ranking"
  },
  "exists": {
    "catalog": true,
    "metrics": true
  },
  "projectType": "sapui5",
  "summary": {
    "totalCatalogPacks": 4,
    "returnedPacks": 3,
    "rankedPacks": 2,
    "noFeedbackPacks": 1,
    "minExecutions": 1
  },
  "rankedPacks": [
    {
      "name": "base-ui5-pack",
      "slug": "base-ui5-pack",
      "version": "1.0.0",
      "projectType": "sapui5",
      "score": 0.912,
      "confidence": 0.8,
      "status": "ranked",
      "lifecycleStatus": "recommended"
    }
  ]
}
```

## 36) `promote_agent_pack`

Entrada:
```json
{
  "tool": "promote_agent_pack",
  "arguments": {
    "packSlug": "base-ui5-pack",
    "mode": "auto",
    "dryRun": true
  }
}
```

Salida (ejemplo):
```json
{
  "dryRun": true,
  "changed": true,
  "mode": "auto",
  "selectedPack": {
    "name": "base-ui5-pack",
    "slug": "base-ui5-pack",
    "version": "1.0.0",
    "previousStatus": "candidate",
    "nextStatus": "recommended"
  },
  "decision": {
    "reason": "auto:promote-recommended score=0.83 executions=8 qualityRate=0.88",
    "rankingStatus": "ranked",
    "score": 0.83,
    "confidence": 0.8,
    "executions": 8,
    "failureRate": 0.12,
    "qualityRate": 0.88
  },
  "lifecycle": {
    "status": "recommended",
    "updatedAt": "2026-03-11T13:00:00.000Z",
    "reason": "auto:promote-recommended score=0.83 executions=8 qualityRate=0.88",
    "historyLength": 3
  },
  "preview": {
    "path": ".codex/mcp/packs/catalog.json",
    "existsBefore": true,
    "changed": true
  },
  "applyResult": null
}
```

Salida (ejemplo):
```json
{
  "packCatalogPath": ".codex/mcp/packs/catalog.json",
  "metricsPath": ".codex/mcp/feedback/metrics.json",
  "exists": {
    "catalog": true,
    "metrics": true
  },
  "projectType": "sapui5",
  "summary": {
    "totalCatalogPacks": 4,
    "returnedPacks": 3,
    "rankedPacks": 2,
    "noFeedbackPacks": 1,
    "minExecutions": 1
  },
  "rankedPacks": [
    {
      "name": "base-ui5-pack",
      "slug": "base-ui5-pack",
      "version": "1.0.0",
      "projectType": "sapui5",
      "score": 0.912,
      "confidence": 0.8,
      "status": "ranked",
      "rationale": "score=0.912 from success=0.9, quality=1, confidence=0.8."
    },
    {
      "name": "legacy-ui5-pack",
      "slug": "legacy-ui5-pack",
      "version": "1.2.0",
      "projectType": "sapui5",
      "score": 0.604,
      "confidence": 0.4,
      "status": "ranked"
    },
    {
      "name": "candidate-pack",
      "slug": "candidate-pack",
      "version": "0.9.0",
      "projectType": "sapui5",
      "score": 0.5,
      "confidence": 0,
      "status": "no-feedback"
    }
  ]
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



## 37) `audit_project_mcp_state`

Entrada:
```json
{
  "tool": "audit_project_mcp_state",
  "arguments": {}
}
```

Salida (ejemplo):
```json
{
  "statePath": ".codex/mcp/project/mcp-project-state.json",
  "currentLayoutVersion": "2026.03.11",
  "status": "needs-upgrade",
  "summary": {
    "managedRequired": 7,
    "managedPresent": 4,
    "managedMissing": 3,
    "legacyDetected": 1
  },
  "migrationPlan": [
    {
      "action": "migrate",
      "targetPath": ".codex/mcp/agents/AGENTS.generated.md",
      "sourcePath": "AGENTS.generated.md",
      "reason": "Legacy artifact detected at AGENTS.generated.md."
    },
    {
      "action": "update-state",
      "targetPath": ".codex/mcp/project/mcp-project-state.json",
      "sourcePath": null,
      "reason": "MCP project state file is missing."
    }
  ]
}
```

## 38) `upgrade_project_mcp`

Entrada:
```json
{
  "tool": "upgrade_project_mcp",
  "arguments": {
    "dryRun": true,
    "preferLegacyArtifacts": true,
    "runPostValidation": true
  }
}
```

Salida (ejemplo):
```json
{
  "dryRun": true,
  "changed": true,
  "statePath": ".codex/mcp/project/mcp-project-state.json",
  "statusBefore": "needs-upgrade",
  "statusAfter": "up-to-date",
  "migration": {
    "planned": 8,
    "applied": 0,
    "skipped": 0,
    "actions": [
      {
        "action": "migrate",
        "targetPath": ".codex/mcp/agents/AGENTS.generated.md",
        "sourcePath": "AGENTS.generated.md",
        "reason": "Migrating legacy artifact from AGENTS.generated.md.",
        "applied": false
      },
      {
        "action": "update-state",
        "targetPath": ".codex/mcp/project/mcp-project-state.json",
        "sourcePath": null,
        "reason": "Creating MCP project state metadata.",
        "applied": false
      }
    ]
  },
  "validation": {
    "executed": true,
    "valid": true,
    "errorCount": 0,
    "warningCount": 0
  },
  "applyResult": null
}
```

## 39) `ensure_project_mcp_current`

Entrada:
```json
{
  "tool": "ensure_project_mcp_current",
  "arguments": {
    "autoApply": true,
    "runPostValidation": true,
    "runQualityGate": false
  }
}
```

Salida (ejemplo):
```json
{
  "autoApply": true,
  "forced": false,
  "needsUpgrade": true,
  "actionTaken": "upgrade-applied",
  "statusBefore": "needs-upgrade",
  "statusAfter": "up-to-date",
  "statePath": ".codex/mcp/project/mcp-project-state.json",
  "audit": {
    "summary": {
      "managedRequired": 7,
      "managedPresent": 3,
      "managedMissing": 4,
      "legacyDetected": 1
    },
    "migrationPlanSteps": 5,
    "recommendedActions": [
      "Run upgrade_project_mcp with dryRun first to preview missing artifact creation/migration."
    ]
  },
  "upgrade": {
    "dryRun": false,
    "changed": true,
    "statusAfter": "up-to-date",
    "migration": {
      "planned": 8,
      "applied": 7,
      "skipped": 1
    },
    "validation": {
      "executed": true,
      "valid": true,
      "errorCount": 0,
      "warningCount": 0
    },
    "qualityGate": {
      "executed": false,
      "pass": null,
      "errorChecks": 0,
      "warningChecks": 0
    }
  }
}
```

## 40) `collect_legacy_project_intake`

Entrada:
```json
{
  "tool": "collect_legacy_project_intake",
  "arguments": {
    "projectGoal": "Stabilize approval flow without functional regressions",
    "criticality": "high",
    "allowedRefactorScope": "incremental",
    "ui5RuntimeVersion": "1.84.0",
    "dryRun": true
  }
}
```

Salida (ejemplo):
```json
{
  "dryRun": true,
  "changed": true,
  "intakePath": ".codex/mcp/project/intake.json",
  "project": {
    "name": "legacy.demo",
    "type": "sapui5",
    "namespace": "legacy.demo",
    "detectedUi5Version": "1.84.0"
  },
  "qualityPriority": true,
  "summary": {
    "totalContextFields": 11,
    "answeredContextFields": 5,
    "missingContextFields": 0
  },
  "needsUserInput": false,
  "missingContext": [],
  "questions": [],
  "preview": {
    "path": ".codex/mcp/project/intake.json",
    "role": "legacy-intake",
    "existsBefore": false,
    "changed": true
  },
  "applyResult": null
}
```

## 41) `analyze_legacy_project_baseline`

Entrada:
```json
{
  "tool": "analyze_legacy_project_baseline",
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
  "project": {
    "name": "legacy.demo",
    "type": "sapui5",
    "namespace": "legacy.demo",
    "ui5Version": "1.84.0",
    "routingDetected": true
  },
  "inventory": {
    "scannedFiles": 96,
    "jsFiles": 41,
    "tsFiles": 0,
    "xmlFiles": 18,
    "jsonFiles": 22,
    "propertiesFiles": 15,
    "totalLines": 13740,
    "totalBytes": 586920
  },
  "qualityRisks": [
    {
      "id": "LEGACY_SEC_EVAL",
      "severity": "high",
      "file": "webapp/controller/Approval.controller.js"
    }
  ],
  "hotspots": [
    {
      "path": "webapp/controller/Approval.controller.js",
      "score": 0.83,
      "lines": 890,
      "reasons": ["large-file", "security-risk"]
    }
  ],
  "recommendations": [
    "Use build_ai_context_index after this baseline to focus prompts on hotspot files and mandatory architecture artifacts."
  ]
}
```

## 42) `build_ai_context_index`

Entrada:
```json
{
  "tool": "build_ai_context_index",
  "arguments": {
    "sourceDir": "webapp",
    "chunkChars": 1200,
    "maxChunks": 4000,
    "dryRun": true
  }
}
```

## 43) `prepare_legacy_project_for_ai`

Entrada:
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

Salida (ejemplo):
```json
{
  "autoApply": true,
  "sourceDir": "webapp",
  "ensure": {
    "executed": true,
    "actionTaken": "none",
    "statusBefore": "up-to-date",
    "statusAfter": "up-to-date"
  },
  "artifactsBefore": {
    "intake": false,
    "baseline": false,
    "contextIndex": false
  },
  "artifactsAfter": {
    "intake": true,
    "baseline": true,
    "contextIndex": true
  },
  "ran": {
    "collectIntake": true,
    "analyzeBaseline": true,
    "buildContextIndex": true
  },
  "intake": {
    "needsUserInput": true,
    "missingContext": ["projectGoal", "criticality", "allowedRefactorScope"]
  },
  "readyForAutopilot": false,
  "nextActions": [
    "Complete missing intake context fields before broad refactors."
  ]
}
```

Salida (ejemplo):
```json
{
  "dryRun": true,
  "changed": true,
  "files": {
    "baselinePath": ".codex/mcp/project/legacy-baseline.json",
    "intakePath": ".codex/mcp/project/intake.json",
    "indexPath": ".codex/mcp/context/context-index.json",
    "indexDocPath": "docs/mcp/context-index.md"
  },
  "qualityGuards": {
    "mandatoryPaths": [
      ".codex/mcp/project/intake.json",
      ".codex/mcp/policies/agent-policy.json",
      "webapp/manifest.json"
    ],
    "requirePolicyAndIntake": true,
    "minimumHotspotChunks": 12
  },
  "summary": {
    "indexedFiles": 102,
    "indexedChunks": 381,
    "hotspotChunks": 26,
    "estimatedChars": 454320,
    "truncatedByMaxChunks": false
  },
  "retrievalProfiles": [
    {
      "id": "feature-implementation",
      "recommendedChunkLimit": 45
    },
    {
      "id": "bugfix-targeted",
      "recommendedChunkLimit": 28
    }
  ],
  "applyResult": null
}
```
