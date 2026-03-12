import { analyzeUi5ProjectTool } from "./project/analyzeProject.js";
import { readProjectFileTool } from "./project/readFile.js";
import { searchProjectFilesTool } from "./project/searchFiles.js";
import { analyzeCurrentFileTool } from "./project/analyzeCurrentFile.js";
import { syncManifestJsonTool } from "./project/syncManifest.js";
import { writeProjectFilePreviewTool } from "./project/writePreview.js";
import { applyProjectPatchTool } from "./project/applyPatch.js";
import { rollbackProjectPatchTool } from "./project/rollbackPatch.js";
import { runProjectQualityGateTool } from "./project/runProjectQualityGate.js";
import { mcpHealthReportTool } from "./project/mcpHealthReport.js";
import { generateUi5ControllerTool } from "./ui5/generateController.js";
import { generateUi5FragmentTool } from "./ui5/generateFragment.js";
import { generateUi5FormatterTool } from "./ui5/generateFormatter.js";
import { generateUi5ViewLogicTool } from "./ui5/generateViewLogic.js";
import { generateUi5FeatureTool } from "./ui5/generateFeature.js";
import { manageUi5I18nTool } from "./ui5/manageI18n.js";
import { analyzeUi5PerformanceTool } from "./ui5/analyzePerformance.js";
import { validateUi5CodeTool } from "./ui5/validateUi5Code.js";
import { validateUi5VersionCompatibilityTool } from "./ui5/validateUi5VersionCompatibility.js";
import { securityCheckUi5AppTool } from "./ui5/securityCheckUi5App.js";
import { analyzeODataMetadataTool } from "./ui5/analyzeODataMetadata.js";
import { validateUi5ODataUsageTool } from "./ui5/validateUi5ODataUsage.js";
import { scaffoldUi5ODataFeatureTool } from "./ui5/scaffoldUi5ODataFeature.js";
import { generateJavaScriptFunctionTool } from "./javascript/generateFunction.js";
import { refactorJavaScriptCodeTool } from "./javascript/refactorCode.js";
import { lintJavaScriptCodeTool } from "./javascript/lintCode.js";
import { securityCheckJavaScriptTool } from "./javascript/securityCheck.js";
import { searchUi5SdkTool } from "./documentation/searchUI5SDK.js";
import { searchMdnTool } from "./documentation/searchMDN.js";
import { scaffoldProjectAgentsTool } from "./agents/scaffoldProjectAgents.js";
import { validateProjectAgentsTool } from "./agents/validateProjectAgents.js";
import { recommendProjectAgentsTool } from "./agents/recommendProjectAgents.js";
import { materializeRecommendedAgentsTool } from "./agents/materializeRecommendedAgents.js";
import { saveAgentPackTool } from "./agents/saveAgentPack.js";
import { listAgentPacksTool } from "./agents/listAgentPacks.js";
import { applyAgentPackTool } from "./agents/applyAgentPack.js";
import { refreshProjectContextDocsTool } from "./agents/refreshProjectContextDocs.js";
import { recordAgentExecutionFeedbackTool } from "./agents/recordAgentExecutionFeedback.js";
import { rankAgentPacksTool } from "./agents/rankAgentPacks.js";
import { promoteAgentPackTool } from "./agents/promoteAgentPack.js";
import { auditProjectMcpStateTool } from "./agents/auditProjectMcpState.js";
import { upgradeProjectMcpTool } from "./agents/upgradeProjectMcp.js";
import { ensureProjectMcpCurrentTool } from "./agents/ensureProjectMcpCurrent.js";
import { collectLegacyProjectIntakeTool } from "./agents/collectLegacyProjectIntake.js";
import { analyzeLegacyProjectBaselineTool } from "./agents/analyzeLegacyProjectBaseline.js";
import { buildAiContextIndexTool } from "./agents/buildAiContextIndex.js";
import { prepareLegacyProjectForAiTool } from "./agents/prepareLegacyProjectForAi.js";

export const allTools = [
  // Project intelligence
  analyzeUi5ProjectTool,
  // UI5 generation and validation
  generateUi5ControllerTool,
  generateUi5FragmentTool,
  generateUi5FormatterTool,
  generateUi5ViewLogicTool,
  generateUi5FeatureTool,
  manageUi5I18nTool,
  analyzeUi5PerformanceTool,
  readProjectFileTool,
  searchProjectFilesTool,
  analyzeCurrentFileTool,
  syncManifestJsonTool,
  writeProjectFilePreviewTool,
  applyProjectPatchTool,
  rollbackProjectPatchTool,
  runProjectQualityGateTool,
  mcpHealthReportTool,
  // External documentation lookup
  searchUi5SdkTool,
  searchMdnTool,
  // JavaScript assistant tools
  generateJavaScriptFunctionTool,
  refactorJavaScriptCodeTool,
  lintJavaScriptCodeTool,
  securityCheckJavaScriptTool,
  validateUi5CodeTool,
  validateUi5VersionCompatibilityTool,
  securityCheckUi5AppTool,
  analyzeODataMetadataTool,
  validateUi5ODataUsageTool,
  scaffoldUi5ODataFeatureTool,
  // Agent factory utilities
  scaffoldProjectAgentsTool,
  validateProjectAgentsTool,
  recommendProjectAgentsTool,
  materializeRecommendedAgentsTool,
  saveAgentPackTool,
  listAgentPacksTool,
  applyAgentPackTool,
  refreshProjectContextDocsTool,
  recordAgentExecutionFeedbackTool,
  rankAgentPacksTool,
  promoteAgentPackTool,
  auditProjectMcpStateTool,
  upgradeProjectMcpTool,
  ensureProjectMcpCurrentTool,
  collectLegacyProjectIntakeTool,
  analyzeLegacyProjectBaselineTool,
  buildAiContextIndexTool,
  prepareLegacyProjectForAiTool
];
