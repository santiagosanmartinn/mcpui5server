# Ejemplos de herramientas MCP

Este documento incluye un ejemplo minimo de entrada y salida por cada herramienta registrada.

## Empieza por aqui (top 14)

Si eres nuevo, primero usa estos ejemplos:

1. `analyze_ui5_project` (seccion 1)
2. `search_project_files` (seccion 3)
3. `write_project_file_preview` (seccion 5)
4. `apply_project_patch` (seccion 6)
5. `rollback_project_patch` (seccion 7)
6. `validate_ui5_version_compatibility` (seccion 35)
7. `security_check_ui5_app` (seccion 36)
8. `run_project_quality_gate` (seccion 37)
9. `recommend_project_agents` (seccion 29)
10. `materialize_recommended_agents` (seccion 30)
11. `ensure_project_mcp_current` (seccion 43)
12. `prepare_legacy_project_for_ai` (seccion 47)
13. `analyze_odata_metadata` (seccion 25)
14. `scaffold_ui5_odata_feature` (seccion 27)

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
    "policyPreset": "starter",
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

## 71) `cf_deploy_precheck`

Entrada:
```json
{
  "tool": "cf_deploy_precheck",
  "arguments": {
    "strictRoutes": true,
    "checkSecrets": true
  }
}
```

Salida (ejemplo):
```json
{
  "scope": {
    "deploymentMode": "mixed",
    "manifestPath": "manifest.yml",
    "mtaPath": "mta.yaml",
    "packageJsonPath": "package.json"
  },
  "summary": {
    "ready": false,
    "failCount": 1,
    "warnCount": 2,
    "passCount": 6,
    "infoCount": 1
  },
  "checks": [
    {
      "id": "manifest_inline_secrets",
      "status": "fail",
      "title": "Riesgo de secretos en claro"
    }
  ],
  "recommendedCommands": [
    "npm run check",
    "npm run build",
    "cf push -f manifest.yml",
    "mbt build -p cf"
  ]
}
```

## 72) `onprem_deploy_checklist`

Entrada:
```json
{
  "tool": "onprem_deploy_checklist",
  "arguments": {
    "targetSystem": "QAS",
    "transportStrategy": "cts",
    "appId": "demo.app",
    "rollbackOwner": "team-ui5",
    "ui5RuntimeVersion": "1.108.0"
  }
}
```

Salida (ejemplo):
```json
{
  "context": {
    "runtimeLandscape": "onprem",
    "targetSystem": "QAS",
    "transportStrategy": "cts",
    "ui5RuntimeVersion": "1.108.0",
    "appId": "demo.app",
    "rollbackOwner": "team-ui5"
  },
  "readiness": {
    "level": "ready",
    "score": 92,
    "blockers": [],
    "warnings": []
  },
  "checklist": {
    "predeploy": [
      {
        "id": "confirm-target-system",
        "status": "todo"
      }
    ],
    "deploy": [],
    "postdeploy": []
  }
}
```

## 73) `deploy_runbook_generator`

Entrada:
```json
{
  "tool": "deploy_runbook_generator",
  "arguments": {
    "platform": "cloud_foundry",
    "dryRun": true,
    "includeRollback": true,
    "includeValidation": true
  }
}
```

Salida (ejemplo):
```json
{
  "dryRun": true,
  "changed": true,
  "platform": "cloud_foundry",
  "outputPath": "docs/mcp/runbooks/deploy-cloud-foundry.md",
  "precheckSummary": {
    "ready": false,
    "level": "needs_attention",
    "keyFindings": [
      "[warn] Definicion de rutas: No se detectaron rutas explicitas."
    ]
  },
  "runbook": {
    "title": "Runbook de despliegue Cloud Foundry",
    "sections": ["overview", "precheck-summary", "steps", "validation", "rollback"]
  },
  "applyResult": null
}
```

## 52) `prompt_intake_wizard`

Entrada:
```json
{
  "tool": "prompt_intake_wizard",
  "arguments": {
    "taskType": "feature",
    "goal": "Implementar validacion de filtros en Main.controller.js",
    "constraints": ["No tocar manifest routing"],
    "maxQuestions": 3
  }
}
```

Salida (ejemplo):
```json
{
  "readiness": {
    "score": 55,
    "status": "insufficient",
    "missingCritical": ["acceptanceCriteria"],
    "missingRecommended": ["deliverable", "inScope", "contextSummary"]
  },
  "nextQuestions": [
    {
      "id": "acceptanceCriteria",
      "priority": "high",
      "question": "Que criterios objetivos definen que la tarea esta terminada?"
    }
  ],
  "tips": [
    "Completa primero campos criticos (objetivo y criterios de aceptacion) antes de ejecutar la tarea."
  ]
}
```

## 53) `prompt_quality_gate`

Entrada:
```json
{
  "tool": "prompt_quality_gate",
  "arguments": {
    "goal": "Implementar validacion de filtros en Main.controller.js",
    "contextSummary": "Proyecto SAPUI5 con OData V2",
    "constraints": ["No tocar manifest routing"],
    "acceptanceCriteria": ["npm run check en verde", "Sin errores de consola"],
    "inScope": ["webapp/controller/Main.controller.js"],
    "strictMode": true
  }
}
```

Salida (ejemplo):
```json
{
  "summary": {
    "score": 90,
    "status": "pass",
    "ready": true
  },
  "blockingIssues": [],
  "improvements": [],
  "normalizedPrompt": {
    "estimatedTokens": 120,
    "chars": 478,
    "lines": 7,
    "hasChecklist": false
  }
}
```

## 54) `prompt_builder`

Entrada:
```json
{
  "tool": "prompt_builder",
  "arguments": {
    "taskType": "feature",
    "goal": "Implementar validacion de filtros en Main.controller.js",
    "contextSummary": "Proyecto SAPUI5 con OData V2",
    "constraints": ["No tocar manifest routing"],
    "acceptanceCriteria": ["npm run check en verde"],
    "inScope": ["webapp/controller/Main.controller.js"],
    "deliverable": "Patch aplicado y resumen corto",
    "style": "both",
    "targetAi": "codex"
  }
}
```

Salida (ejemplo):
```json
{
  "prompt": {
    "full": "Eres un asistente tecnico orientado a ejecutar esta tarea...",
    "compact": "Tarea (feature): Implementar validacion...",
    "recommended": "Eres un asistente tecnico orientado a ejecutar esta tarea..."
  },
  "metadata": {
    "taskType": "feature",
    "targetAi": "codex",
    "style": "both",
    "sectionsIncluded": ["goal", "context", "inScope", "constraints", "acceptanceCriteria", "deliverable", "responseFormat", "checklist"],
    "estimatedTokens": {
      "full": 210,
      "compact": 74
    }
  }
}
```

## 55) `prompt_token_budget`

Entrada:
```json
{
  "tool": "prompt_token_budget",
  "arguments": {
    "prompt": "Objetivo: ... (prompt largo)",
    "maxTokens": 900,
    "reservedForResponseTokens": 300,
    "contextCandidates": [
      { "path": "webapp/controller/Main.controller.js", "estimatedTokens": 120, "priority": "high" },
      { "path": "webapp/manifest.json", "estimatedTokens": 200, "priority": "medium" }
    ]
  }
}
```

## 56) `prompt_context_selector`

Entrada:
```json
{
  "tool": "prompt_context_selector",
  "arguments": {
    "taskType": "bugfix",
    "goal": "Corregir bug de busqueda en Main.controller.js",
    "queryTerms": ["search", "controller"],
    "includeGitDiff": true,
    "includeContextIndex": true,
    "maxFiles": 6
  }
}
```

Salida (ejemplo):
```json
{
  "scope": {
    "taskType": "bugfix",
    "queryTerms": ["search", "controller"],
    "maxFiles": 6
  },
  "strategy": {
    "usedGitDiff": true,
    "usedContextIndex": true,
    "usedKeywordSearch": true,
    "contextIndexPath": ".codex/mcp/context/context-index.json"
  },
  "selectedPaths": [
    {
      "path": "webapp/controller/Main.controller.js",
      "score": 241,
      "estimatedTokens": 180,
      "sources": ["git_diff", "context_index", "keyword_match"]
    }
  ]
}
```

## 57) `prompt_template_catalog`

Entrada:
```json
{
  "tool": "prompt_template_catalog",
  "arguments": {
    "taskType": "feature",
    "includeExamples": true,
    "includeCompactVariant": true
  }
}
```

Salida (ejemplo):
```json
{
  "catalogVersion": "1.0.0",
  "language": "es",
  "templates": [
    {
      "id": "template-feature",
      "taskType": "feature",
      "title": "Plantilla de nueva funcionalidad",
      "requiredFields": ["goal", "acceptanceCriteria"],
      "template": {
        "full": "Tipo de tarea: feature\nObjetivo: <resultado funcional a implementar>\n...",
        "compact": "[feature] Objetivo: <resultado funcional a implementar>\n..."
      }
    }
  ]
}
```

## 58) `prompt_retrospective`

Entrada:
```json
{
  "tool": "prompt_retrospective",
  "arguments": {
    "taskType": "bugfix",
    "promptUsed": "Objetivo: corregir bug en Main.controller.js...",
    "outcome": "partial",
    "qualityGatePassed": false,
    "iterations": 3,
    "issues": ["faltaron criterios de aceptacion"],
    "tokenEstimate": 1800,
    "expectedTokenBudget": 1200,
    "dryRun": true
  }
}
```

Salida (ejemplo):
```json
{
  "dryRun": true,
  "changed": true,
  "retrospectivePath": ".codex/mcp/prompts/retrospectives.jsonl",
  "assessment": {
    "score": 38,
    "efficiency": "poor",
    "outcome": "partial"
  },
  "improvements": {
    "nextPromptAdjustments": [
      "Definir objetivo y criterios de aceptacion en formato medible antes de ejecutar."
    ],
    "questionsForUser": [
      "Que archivo/modulo no debe tocarse bajo ningun caso?"
    ]
  },
  "applyResult": null
}
```

Salida (ejemplo):
```json
{
  "budget": {
    "maxTokens": 900,
    "reservedForResponseTokens": 300,
    "targetPromptTokens": 600,
    "estimatedTokensBefore": 980,
    "estimatedTokensAfter": 560,
    "reductionTokens": 420,
    "reductionRate": 0.429
  },
  "optimized": {
    "prompt": "Objetivo: ... (version compacta)",
    "strategy": ["dedupe-lines", "drop-low-priority-lines"],
    "removedLines": 41,
    "truncatedSections": []
  },
  "contextSelection": {
    "availableTokens": 40,
    "selected": [],
    "dropped": [
      {
        "path": "webapp/controller/Main.controller.js",
        "estimatedTokens": 120,
        "priority": "high",
        "dropReason": "Sin presupuesto restante de contexto"
      }
    ]
  }
}
```

## 52) `audit_git_worktree_state`

Entrada:
```json
{
  "tool": "audit_git_worktree_state",
  "arguments": {
    "includeUntracked": true,
    "maxFiles": 200
  }
}
```

Salida (ejemplo):
```json
{
  "repository": {
    "gitAvailable": true,
    "isGitRepository": true,
    "rootPath": "C:/repo/demo",
    "branch": "feature/mcp-git",
    "upstream": "origin/feature/mcp-git",
    "ahead": 1,
    "behind": 0,
    "headSha": "3fd9ab1"
  },
  "workingTree": {
    "clean": false,
    "stagedChanges": 2,
    "unstagedChanges": 1,
    "untrackedFiles": 1,
    "conflictedFiles": 0,
    "files": [
      {
        "path": "webapp/controller/Main.controller.js",
        "statusCode": " M",
        "stagedStatus": " ",
        "unstagedStatus": "M",
        "isUntracked": false,
        "isConflicted": false
      }
    ]
  },
  "recommendations": [
    "You have mixed staged and unstaged changes; consider splitting commits for clearer reviews."
  ]
}
```

## 53) `analyze_git_diff`

Entrada:
```json
{
  "tool": "analyze_git_diff",
  "arguments": {
    "mode": "working_tree",
    "includeUntracked": true,
    "maxFiles": 300
  }
}
```

## 54) `suggest_tests_from_git_diff`

Entrada:
```json
{
  "tool": "suggest_tests_from_git_diff",
  "arguments": {
    "mode": "working_tree",
    "includeUntracked": true
  }
}
```

Salida (ejemplo):
```json
{
  "scope": {
    "mode": "working_tree",
    "baseRef": null,
    "targetRef": null
  },
  "diffSummary": {
    "changedFiles": 5,
    "additions": 62,
    "deletions": 14,
    "touches": {
      "docs": true,
      "tests": false,
      "controllers": true,
      "views": true,
      "manifest": true,
      "i18n": false,
      "config": false
    }
  },
  "suggestions": [
    {
      "id": "ui5-controller-view-regression",
      "priority": "high",
      "title": "Validate UI5 behavior for changed controllers/views",
      "rationale": "Controller/view edits are high-impact for runtime behavior and binding integrity.",
      "relatedFiles": ["webapp/controller/Main.controller.js", "webapp/view/Main.view.xml"],
      "recommendedChecks": [
        "Run unit/integration tests that cover affected controllers and views.",
        "Execute `run_project_quality_gate` before commit."
      ]
    }
  ],
  "recommendedCommands": ["npm run test:run", "npm run check"]
}
```

## 55) `generate_commit_message_from_diff`

Entrada:
```json
{
  "tool": "generate_commit_message_from_diff",
  "arguments": {
    "mode": "working_tree",
    "style": "conventional"
  }
}
```

Salida (ejemplo):
```json
{
  "scope": {
    "mode": "working_tree",
    "baseRef": null,
    "targetRef": null
  },
  "summary": {
    "changedFiles": 4,
    "additions": 28,
    "deletions": 6
  },
  "commit": {
    "type": "feat",
    "scope": "ui5",
    "style": "conventional",
    "subject": "feat(ui5): update ui5 controllers and views",
    "bodyLines": [
      "- Files changed: 4 (+28/-6)",
      "- Status: A=1, M=3, D=0, R=0, U=0",
      "- Impacted files: webapp/controller/Main.controller.js, webapp/view/Main.view.xml"
    ],
    "fullMessage": "feat(ui5): update ui5 controllers and views\n\n- Files changed: 4 (+28/-6)\n- Status: A=1, M=3, D=0, R=0, U=0\n- Impacted files: webapp/controller/Main.controller.js, webapp/view/Main.view.xml"
  },
  "rationale": [
    "Type inferred as `feat` from diff status/touch profile.",
    "Scope inferred as `ui5`.",
    "Diff size: 4 files (+28/-6)."
  ]
}
```

Salida (ejemplo):
```json
{
  "repository": {
    "gitAvailable": true,
    "isGitRepository": true,
    "rootPath": "C:/repo/demo",
    "branch": "feature/mcp-git",
    "upstream": "origin/feature/mcp-git",
    "ahead": 1,
    "behind": 0,
    "headSha": "3fd9ab1"
  },
  "scope": {
    "mode": "working_tree",
    "baseRef": null,
    "targetRef": null
  },
  "summary": {
    "changedFiles": 4,
    "additions": 36,
    "deletions": 8,
    "byStatus": {
      "added": 1,
      "modified": 2,
      "deleted": 0,
      "renamed": 0,
      "copied": 0,
      "unmerged": 0,
      "untracked": 1,
      "unknown": 0
    },
    "byExtension": [
      { "extension": ".js", "count": 2 },
      { "extension": ".xml", "count": 1 },
      { "extension": ".md", "count": 1 }
    ],
    "touches": {
      "docs": true,
      "tests": false,
      "controllers": true,
      "views": true,
      "manifest": false,
      "i18n": false,
      "config": false
    }
  },
  "files": [
    {
      "path": "webapp/controller/Main.controller.js",
      "status": "modified",
      "additions": 3,
      "deletions": 1,
      "extension": ".js"
    }
  ],
  "recommendations": [
    "Code/config changed without test updates; consider adding focused tests before merge."
  ]
}
```

## 56) `prepare_safe_commit`

Entrada:
```json
{
  "tool": "prepare_safe_commit",
  "arguments": {
    "mode": "working_tree",
    "includeUntracked": true,
    "language": "es",
    "scanContent": true
  }
}
```

Salida (ejemplo):
```json
{
  "scope": {
    "mode": "working_tree",
    "baseRef": null,
    "targetRef": null
  },
  "repository": {
    "branch": "feature/mcp-git",
    "upstream": "origin/feature/mcp-git",
    "ahead": 0,
    "behind": 0,
    "headSha": "8a21c4f",
    "clean": false
  },
  "gate": {
    "readyForCommit": false,
    "blockingChecks": ["tests-not-updated"],
    "warningChecks": ["mixed-staged-unstaged"],
    "recommendedCommands": ["npm run test:run", "npm run check"]
  },
  "automationPolicy": {
    "allowsAutomaticCommit": false,
    "allowsAutomaticPush": false,
    "requiresExplicitUserConsent": true,
    "note": "This tool only prepares commit readiness. Never run commit/push without explicit user consent."
  }
}
```

## 57) `risk_review_from_diff`

Entrada:
```json
{
  "tool": "risk_review_from_diff",
  "arguments": {
    "mode": "working_tree",
    "includeUntracked": true
  }
}
```

Salida (ejemplo):
```json
{
  "scope": {
    "mode": "working_tree",
    "baseRef": null,
    "targetRef": null
  },
  "summary": {
    "changedFiles": 6,
    "additions": 84,
    "deletions": 12,
    "touches": {
      "docs": true,
      "tests": false,
      "controllers": true,
      "views": true,
      "manifest": true,
      "i18n": false,
      "config": false
    }
  },
  "risk": {
    "score": 68,
    "level": "high",
    "mustFixBeforeMerge": ["code-without-tests", "manifest-impact"],
    "recommendedChecks": ["npm run check", "npm run test:run"]
  }
}
```

## 58) `generate_pr_description`

Entrada:
```json
{
  "tool": "generate_pr_description",
  "arguments": {
    "mode": "working_tree",
    "language": "es",
    "includeChecklist": true,
    "includeRollbackPlan": true
  }
}
```

Salida (ejemplo):
```json
{
  "scope": {
    "mode": "working_tree",
    "baseRef": null,
    "targetRef": null
  },
  "pr": {
    "title": "Adjust UI5 controller/view behavior",
    "labelsSuggested": ["ui5", "risk:high"],
    "reviewersSuggested": ["ui5-maintainer"],
    "markdown": "# Adjust UI5 controller/view behavior\n\n## Context\n- Scope analyzed: working_tree."
  }
}
```

## 59) `branch_hygiene_report`

Entrada:
```json
{
  "tool": "branch_hygiene_report",
  "arguments": {
    "includeUntracked": true,
    "staleDaysThreshold": 30
  }
}
```

Salida (ejemplo):
```json
{
  "repository": {
    "gitAvailable": true,
    "isGitRepository": true,
    "branch": "feature/mcp-git",
    "upstream": "origin/feature/mcp-git",
    "ahead": 1,
    "behind": 0,
    "headSha": "8a21c4f"
  },
  "hygiene": {
    "score": 82,
    "level": "healthy",
    "recommendedActions": ["Run `npm run check` before merge."]
  },
  "automationPolicy": {
    "allowsAutomaticCommit": false,
    "allowsAutomaticPush": false,
    "requiresExplicitUserConsent": true,
    "note": "This tool only audits branch hygiene. Never run commit/push without explicit user consent."
  }
}
```

## 60) `conflict_precheck`

Entrada:
```json
{
  "tool": "conflict_precheck",
  "arguments": {
    "sourceRef": "HEAD",
    "targetRef": "origin/main"
  }
}
```

Salida (ejemplo):
```json
{
  "comparison": {
    "sourceRef": "HEAD",
    "targetRef": "origin/main",
    "mergeBase": "ad3f6c42fd0a",
    "sourceChangedFiles": 7,
    "targetChangedFiles": 9,
    "overlappingFiles": 2
  },
  "risk": {
    "level": "medium",
    "score": 36,
    "recommendations": [
      "Review overlapping files before merge to reduce manual conflict resolution.",
      "Run `npm run check` after merging target changes."
    ]
  },
  "automationPolicy": {
    "performsMerge": false,
    "modifiesWorkingTree": false,
    "note": "This tool is read-only and never performs merge/rebase operations."
  }
}
```

## 61) `trace_change_ownership`

Entrada:
```json
{
  "tool": "trace_change_ownership",
  "arguments": {
    "mode": "working_tree",
    "includeUntracked": true,
    "maxReviewers": 3,
    "useBlame": true,
    "maxRangesPerFile": 8
  }
}
```

Salida (ejemplo):
```json
{
  "ownership": {
    "owners": [
      {
        "name": "Alice",
        "email": "alice@example.com",
        "touchedFiles": 2,
        "weightedImpact": 146,
        "blamedLines": 7,
        "recencyScore": 72,
        "lastTouchedAt": "2026-03-12T09:30:00.000Z",
        "confidence": "medium"
      }
    ],
    "reviewerSuggestions": ["Alice <alice@example.com>"],
    "notes": [
      "Se priorizo ownership por zonas cambiadas (`git blame`) y recencia."
    ]
  },
  "automationPolicy": {
    "readOnlyGitAnalysis": true,
    "note": "This tool only reads Git history and never modifies repository state."
  }
}
```

## 62) `smart_stage_changes`

Entrada:
```json
{
  "tool": "smart_stage_changes",
  "arguments": {
    "mode": "working_tree",
    "includeUntracked": true,
    "language": "es",
    "maxGroups": 6
  }
}
```

Salida (ejemplo):
```json
{
  "scope": {
    "mode": "working_tree",
    "baseRef": null,
    "targetRef": null
  },
  "stagingPlan": {
    "strategy": "Agrupacion por intencion de cambio (runtime, manifest/config, tests, docs, i18n, misc).",
    "groups": [
      {
        "id": "ui5-runtime",
        "title": "Runtime UI5",
        "risk": "high",
        "files": ["webapp/controller/Main.controller.js"],
        "suggestedAddCommand": "git add -- \"webapp/controller/Main.controller.js\""
      }
    ],
    "warnings": []
  },
  "automationPolicy": {
    "appliesGitAdd": false,
    "requiresExplicitUserConsent": true
  }
}
```

## 63) `detect_commit_smells`

Entrada:
```json
{
  "tool": "detect_commit_smells",
  "arguments": {
    "mode": "working_tree",
    "includeUntracked": true,
    "language": "es"
  }
}
```

Salida (ejemplo):
```json
{
  "summary": {
    "changedFiles": 12,
    "additions": 210,
    "deletions": 54
  },
  "smells": [
    {
      "id": "mixed-concerns",
      "severity": "medium",
      "title": "Mezcla de responsabilidades"
    },
    {
      "id": "code-without-tests",
      "severity": "high",
      "title": "Codigo/configuracion sin tests asociados"
    }
  ],
  "gate": {
    "shouldSplitCommit": true,
    "blockingSmells": ["code-without-tests"],
    "warningSmells": ["mixed-concerns"]
  },
  "automationPolicy": {
    "modifiesGitState": false,
    "requiresExplicitUserConsent": true
  }
}
```

## 64) `release_notes_from_commits`

Entrada:
```json
{
  "tool": "release_notes_from_commits",
  "arguments": {
    "compareBy": "tags",
    "fromTag": "v1.4.0",
    "toTag": "v1.5.0",
    "format": "changelog",
    "maxCommits": 100,
    "includeAuthors": true,
    "language": "es"
  }
}
```

Salida (ejemplo):
```json
{
  "range": {
    "fromRef": "v1.4.0",
    "toRef": "v1.5.0",
    "fromTag": "v1.4.0",
    "toTag": "v1.5.0",
    "mode": "tag_range",
    "compareBy": "tags"
  },
  "summary": {
    "totalCommits": 18,
    "breakingChanges": 1,
    "byType": {
      "feat": 5,
      "fix": 6,
      "perf": 1,
      "refactor": 2,
      "docs": 2,
      "test": 1,
      "chore": 1,
      "other": 0
    }
  },
  "releaseNotes": {
    "format": "changelog",
    "highlights": [
      "Comparativa de tags: v1.4.0..v1.5.0.",
      "Cambios breaking detectados: 1.",
      "Nuevas funcionalidades: 5.",
      "Correcciones: 6."
    ],
    "markdown": "# Changelog\n\n## [v1.5.0] - 2026-03-14\n_Comparado con v1.4.0_\n\n### Added\n- ..."
  },
  "automationPolicy": {
    "readOnlyGitAnalysis": true
  }
}
```

## 65) `merge_readiness_report`

Entrada:
```json
{
  "tool": "merge_readiness_report",
  "arguments": {
    "mode": "working_tree",
    "includeUntracked": true,
    "targetRef": "origin/main",
    "sourceRef": "HEAD",
    "language": "es"
  }
}
```

Salida (ejemplo):
```json
{
  "scope": {
    "mode": "working_tree",
    "baseRef": null,
    "targetRef": "origin/main"
  },
  "readiness": {
    "level": "needs_attention",
    "readyForMerge": false,
    "score": 62,
    "blockers": ["risk:code-without-tests"],
    "warnings": ["commit:mixed-staged-unstaged", "smells:split-recommended"]
  },
  "checks": {
    "commit": {
      "readyForCommit": false,
      "blockingChecks": ["tests-not-updated"],
      "warningChecks": ["mixed-staged-unstaged"]
    },
    "risk": {
      "level": "high",
      "score": 58,
      "mustFixBeforeMerge": ["code-without-tests"]
    },
    "branch": {
      "level": "warning",
      "score": 68
    },
    "conflict": {
      "level": "low",
      "score": 12,
      "overlappingFiles": 1
    },
    "smells": {
      "shouldSplitCommit": true,
      "highSeverityCount": 1,
      "mediumSeverityCount": 1
    }
  },
  "nextActions": [
    "Resolver checks bloqueantes de commit antes de continuar.",
    "Abordar los riesgos marcados como obligatorios (`mustFixBeforeMerge`).",
    "Ejecutar `npm run check` como puerta final."
  ],
  "automationPolicy": {
    "performsMergeOrPush": false,
    "requiresExplicitUserConsent": true
  }
}
```

## 66) `merge_action_plan`

Entrada:
```json
{
  "tool": "merge_action_plan",
  "arguments": {
    "mode": "working_tree",
    "includeUntracked": true,
    "targetRef": "origin/main",
    "sourceRef": "HEAD",
    "preferredStrategy": "auto",
    "language": "es"
  }
}
```

Salida (ejemplo):
```json
{
  "scope": {
    "mode": "working_tree",
    "baseRef": null,
    "targetRef": "origin/main"
  },
  "readiness": {
    "level": "needs_attention",
    "readyForMerge": false,
    "score": 62,
    "blockers": ["risk:code-without-tests"],
    "warnings": ["smells:split-recommended"]
  },
  "signals": {
    "riskLevel": "high",
    "branchLevel": "warning",
    "conflictLevel": "low",
    "shouldSplitCommit": true
  },
  "strategy": {
    "requested": "auto",
    "recommended": "merge",
    "rationale": [
      "Se prioriza merge por simplicidad y menor friccion operativa."
    ]
  },
  "plan": {
    "premerge": [
      { "id": "resolve-blockers", "required": true, "status": "blocked" }
    ],
    "sync": [
      { "id": "fetch-target", "required": true, "status": "todo" }
    ],
    "validate": [
      { "id": "run-quality-checks", "required": true, "status": "todo" }
    ],
    "integrate": [
      { "id": "execute-merge-or-rebase", "required": true, "status": "blocked" }
    ],
    "postmerge": [
      { "id": "push-with-consent", "required": true, "status": "blocked" }
    ]
  },
  "commands": {
    "premerge": ["git status --short"],
    "sync": ["git fetch --all --prune"],
    "validate": ["npm run check"],
    "integrate": [],
    "postmerge": []
  },
  "automationPolicy": {
    "performsMergeOrPush": false,
    "requiresExplicitUserConsent": true
  }
}
```

## 24) `mcp_health_report`

Entrada:
```json
{
  "tool": "mcp_health_report",
  "arguments": {
    "includeToolNames": false,
    "includeDocChecks": true,
    "includePolicyStatus": true,
    "includePolicyTransition": true,
    "includeContractStatus": true,
    "includeManagedArtifacts": true,
    "skillMetricsPath": ".codex/mcp/skills/feedback/metrics.json",
    "packMetricsPath": ".codex/mcp/feedback/metrics.json"
  }
}
```

Salida (ejemplo):
```json
{
  "generatedAt": "2026-03-12T10:00:00.000Z",
  "server": {
    "name": "sapui5-mcp-server",
    "version": "1.0.0",
    "autoEnsureProject": true,
    "autoEnsureProjectApply": true,
    "autoPrepareContext": true,
    "autoPrepareContextApply": true
  },
  "tools": {
    "registered": 47,
    "unique": 47,
    "duplicates": [],
    "namesIncluded": false,
    "names": []
  },
  "docs": {
    "executed": true,
    "referenceInSync": true,
    "examplesInSync": true,
    "missingFromReference": [],
    "missingFromExamples": []
  },
  "policy": {
    "executed": true,
    "path": ".codex/mcp/policies/agent-policy.json",
    "exists": true,
    "loaded": true,
    "enabled": true,
    "error": null
  },
  "policyTransition": {
    "executed": true,
    "policyPath": ".codex/mcp/policies/agent-policy.json",
    "currentPreset": "starter",
    "recommendation": "promote-to-mature",
    "readyForMature": true,
    "confidence": 0.91,
    "signals": {
      "skillExecutions": 12,
      "skillSuccessRate": 0.875,
      "qualifiedSkills": 1,
      "packExecutions": 6,
      "packSuccessRate": 0.75,
      "packEvidencePresent": true
    },
    "nextAction": "Run scaffold_project_agents with policyPreset=\"mature\" and allowOverwrite=true."
  },
  "contracts": {
    "executed": true,
    "snapshotPath": "docs/contracts/tool-contracts.snapshot.json",
    "exists": true,
    "inSync": true
  },
  "managedArtifacts": {
    "executed": true,
    "intakeExists": true,
    "baselineExists": true,
    "contextIndexExists": true,
    "policyExists": true,
    "blueprintExists": true,
    "agentsGuideExists": true
  }
}
```

## 67) `mcp_metrics_dashboard`

Entrada:
```json
{
  "tool": "mcp_metrics_dashboard",
  "arguments": {
    "telemetryDir": ".mcp-runtime/logs",
    "maxSessions": 30,
    "minInvocations": 2,
    "errorRateThreshold": 0.15,
    "slowRateThreshold": 0.25,
    "includeToolBreakdown": true,
    "language": "es"
  }
}
```

Salida (ejemplo):
```json
{
  "scope": {
    "telemetryDir": ".mcp-runtime/logs",
    "sessionsAnalyzed": 6,
    "totals": {
      "invocations": 214,
      "errors": 17,
      "slowInvocations": 41
    }
  },
  "dashboard": {
    "mostUsedTools": [
      {
        "toolName": "analyze_ui5_project",
        "invocations": 44,
        "successRate": 1,
        "valueScore": 93
      }
    ],
    "highestValueTools": [
      {
        "toolName": "analyze_ui5_project",
        "invocations": 44,
        "errorRate": 0,
        "slowRate": 0.05,
        "valueScore": 93
      }
    ],
    "failingTools": [
      {
        "toolName": "run_project_quality_gate",
        "invocations": 18,
        "errorRate": 0.278,
        "topErrorCodes": [
          { "code": "QUALITY_GATE_FAILED", "count": 5 }
        ]
      }
    ],
    "slowTools": [
      {
        "toolName": "validate_ui5_odata_usage",
        "invocations": 15,
        "slowRate": 0.533,
        "averageDurationMs": 2870
      }
    ],
    "improvementAreas": [
      {
        "id": "reliability-hotspots",
        "priority": "high",
        "targetTools": ["run_project_quality_gate"]
      },
      {
        "id": "latency-hotspots",
        "priority": "medium",
        "targetTools": ["validate_ui5_odata_usage"]
      }
    ],
    "potentialSavings": {
      "avoidableSlowTimeMs": 38000,
      "estimatedReworkTimeMs": 21000
    }
  },
  "automationPolicy": {
    "readOnlyAnalysis": true
  }
}
```

## 25) `analyze_odata_metadata`

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

## 26) `validate_ui5_odata_usage`

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

## 27) `scaffold_ui5_odata_feature`

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

## 28) `validate_project_agents`

Entrada:
```json
{
  "tool": "validate_project_agents",
  "arguments": {
    "strict": true
  }
}
```

## 29) `recommend_project_agents`

Entrada:
```json
{
  "tool": "recommend_project_agents",
  "arguments": {
    "sourceDir": "webapp",
    "maxRecommendations": 6,
    "includePackCatalog": true,
    "includeSkillCatalog": true,
    "includeSkillFeedbackRanking": true,
    "minSkillExecutions": 1
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
  "skillSignals": {
    "executed": true,
    "enabled": true,
    "summary": {
      "returnedSkills": 4,
      "rankedSkills": 2,
      "influenceApplied": true
    },
    "topSkills": [
      {
        "id": "ui5-feature-implementation-safe",
        "score": 0.91,
        "rankStatus": "ranked"
      }
    ]
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

## 30) `materialize_recommended_agents`

Entrada:
```json
{
  "tool": "materialize_recommended_agents",
  "arguments": {
    "dryRun": true,
    "includePackCatalog": true,
    "includeSkillCatalog": true,
    "includeSkillFeedbackRanking": true,
    "skillSignalMode": "prefer",
    "respectPolicy": true
  }
}
```

Salida (ejemplo):
```json
{
  "source": "auto-recommend",
  "policy": {
    "path": ".codex/mcp/policies/agent-policy.json",
    "loaded": true,
    "enforcedSections": ["recommendation"]
  },
  "usedRecommendations": 4,
  "selectionPolicy": {
    "source": "auto-recommend",
    "mode": "strict",
    "signalsReady": true,
    "strictApplied": true,
    "autoPromotedToStrict": true,
    "promotionReason": "auto-promoted-to-strict qualifiedSkills=1 minSuccessExecutions=3 minSuccessRate=0.8",
    "filteredRecommendationIds": [],
    "reweightedRecommendationIds": ["ui5-feature-implementer"]
  },
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

## 31) `save_agent_pack`

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

## 32) `list_agent_packs`

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

## 33) `apply_agent_pack`

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

## 34) `refresh_project_context_docs`

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

## 35) `validate_ui5_version_compatibility`

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

## 36) `security_check_ui5_app`

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

## 37) `run_project_quality_gate`

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

## 38) `record_agent_execution_feedback`

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

## 39) `rank_agent_packs`

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

## 40) `promote_agent_pack`

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



## 41) `audit_project_mcp_state`

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

## 42) `upgrade_project_mcp`

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

## 43) `ensure_project_mcp_current`

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

## 44) `collect_legacy_project_intake`

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

## 45) `analyze_legacy_project_baseline`

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

## 46) `build_ai_context_index`

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

## 47) `prepare_legacy_project_for_ai`

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

## 48) `scaffold_project_skills`

Entrada:
```json
{
  "tool": "scaffold_project_skills",
  "arguments": {
    "includeDefaultSkills": true,
    "generateDocs": true,
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
    "name": "demo.app",
    "type": "sapui5",
    "namespace": "demo.app",
    "ui5Version": "1.120.0"
  },
  "files": {
    "skillsRootDir": ".codex/mcp/skills",
    "catalogPath": ".codex/mcp/skills/catalog.json",
    "feedbackPath": ".codex/mcp/skills/feedback/executions.jsonl",
    "metricsPath": ".codex/mcp/skills/feedback/metrics.json",
    "docsPath": "docs/mcp/skills.md"
  },
  "skillSummary": {
    "total": 5,
    "incoming": 5,
    "created": 5,
    "updated": 0,
    "unchanged": 0
  },
  "applyResult": null
}
```

## 49) `validate_project_skills`

Entrada:
```json
{
  "tool": "validate_project_skills",
  "arguments": {
    "strict": true
  }
}
```

Salida (ejemplo):
```json
{
  "catalogPath": ".codex/mcp/skills/catalog.json",
  "strict": true,
  "valid": true,
  "summary": {
    "skillCount": 5,
    "checksPassed": 6,
    "checksFailed": 0,
    "errorCount": 0,
    "warningCount": 0
  },
  "errors": [],
  "warnings": [],
  "recommendedActions": []
}
```

## 50) `record_skill_execution_feedback`

Entrada:
```json
{
  "tool": "record_skill_execution_feedback",
  "arguments": {
    "skillId": "ui5-feature-implementation-safe",
    "outcome": "success",
    "qualityGatePass": true,
    "usefulnessScore": 5,
    "timeSavedMinutes": 18,
    "tokenDeltaEstimate": 260,
    "tags": ["ui5", "feature", "quality"],
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
    "id": "f18de6a3c4dd91af",
    "skillId": "ui5-feature-implementation-safe",
    "recordedAt": "2026-03-12T10:30:00.000Z",
    "outcome": "success"
  },
  "files": {
    "feedbackPath": ".codex/mcp/skills/feedback/executions.jsonl",
    "metricsPath": ".codex/mcp/skills/feedback/metrics.json"
  },
  "metrics": {
    "totalExecutions": 14,
    "totals": {
      "success": 11,
      "partial": 2,
      "failed": 1
    },
    "skill": {
      "executions": 4,
      "qualityGatePasses": 4,
      "qualityGateFails": 0,
      "usefulnessAverage": 4.75,
      "timeSavedMinutesTotal": 67,
      "tokenDeltaEstimateTotal": 940
    }
  },
  "applyResult": null
}
```

## 51) `rank_project_skills`

Entrada:
```json
{
  "tool": "rank_project_skills",
  "arguments": {
    "minExecutions": 1,
    "maxResults": 5,
    "includeUnscored": true
  }
}
```

Salida (ejemplo):
```json
{
  "catalogPath": ".codex/mcp/skills/catalog.json",
  "metricsPath": ".codex/mcp/skills/feedback/metrics.json",
  "exists": {
    "catalog": true,
    "metrics": true
  },
  "summary": {
    "totalCatalogSkills": 5,
    "returnedSkills": 5,
    "rankedSkills": 3,
    "noFeedbackSkills": 2,
    "minExecutions": 1
  },
  "rankedSkills": [
    {
      "id": "ui5-feature-implementation-safe",
      "status": "recommended",
      "score": 0.91,
      "confidence": 0.8,
      "rankStatus": "ranked"
    }
  ]
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
