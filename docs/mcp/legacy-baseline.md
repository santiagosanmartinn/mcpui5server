# Legacy Baseline

Generated at: 2026-03-12T13:13:16.918Z
Source dir: .

## Project

- Name: sapui5-mcp-server
- Type: node
- Namespace: sapui5-mcp-server
- UI5 version: unknown
- Routing detected: false
- Controller pattern: Controller.extend

## Inventory

- Files scanned: 124
- JS: 115
- TS: 0
- XML: 0
- JSON: 9
- Properties: 0
- Total lines: 41975

## Intake

- Intake exists: true
- Missing context fields: projectGoal, criticality, allowedRefactorScope

## Top Hotspots

- docs/contracts/tool-contracts.snapshot.json (score 1, lines 11929, reasons: large-file)
- package-lock.json (score 1, lines 3671, reasons: large-file)
- src/tools/agents/analyzeLegacyProjectBaseline.js (score 0.815, lines 682, reasons: large-file, todo-debt, medium-risk)
- src/tools/agents/recommendProjectAgents.js (score 0.763, lines 1144, reasons: large-file)
- src/tools/ui5/validateUi5ODataUsage.js (score 0.718, lines 1077, reasons: large-file)
- src/tools/ui5/scaffoldUi5ODataFeature.js (score 0.661, lines 991, reasons: large-file)
- src/tools/agents/scaffoldProjectAgents.js (score 0.605, lines 907, reasons: large-file)
- test/tools/securityCheckUi5App.tool.test.js (score 0.592, lines 48, reasons: security-risk)
- src/utils/validator.js (score 0.564, lines 246, reasons: security-risk, medium-risk)
- src/tools/project/mcpHealthReport.js (score 0.503, lines 755, reasons: large-file)

## Key Risks

- [medium] src/tools/agents/analyzeLegacyProjectBaseline.js: Synchronous async:false pattern detected.
- [low] src/tools/agents/analyzeLegacyProjectBaseline.js: Pending TODO/FIXME markers detected.
- [low] src/tools/documentation/searchUI5SDK.js: Pending TODO/FIXME markers detected.
- [medium] src/tools/ui5/analyzePerformance.js: Synchronous async:false pattern detected.
- [low] src/tools/ui5/manageI18n.js: Pending TODO/FIXME markers detected.
- [high] src/utils/validator.js: Use of eval detected.
- [medium] src/utils/validator.js: Synchronous async:false pattern detected.
- [high] test/tools/analyzeLegacyProjectBaseline.tool.test.js: Use of eval detected.
- [low] test/tools/analyzeLegacyProjectBaseline.tool.test.js: console.log usage detected in source.
- [medium] test/tools/analyzeUi5Performance.tool.test.js: Synchronous async:false pattern detected.
- [high] test/tools/runProjectQualityGate.tool.test.js: Use of eval detected.
- [high] test/tools/securityCheckUi5App.tool.test.js: Use of eval detected.

## Recommendations

- Complete collect_legacy_project_intake to capture runtime constraints and reduce ambiguous AI proposals.
- Prioritize remediation of high-severity security patterns before major modernization.
- Use build_ai_context_index after this baseline to focus prompts on hotspot files and mandatory architecture artifacts.
