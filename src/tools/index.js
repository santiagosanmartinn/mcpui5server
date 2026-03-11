import { analyzeUi5ProjectTool } from "./project/analyzeProject.js";
import { readProjectFileTool } from "./project/readFile.js";
import { searchProjectFilesTool } from "./project/searchFiles.js";
import { analyzeCurrentFileTool } from "./project/analyzeCurrentFile.js";
import { syncManifestJsonTool } from "./project/syncManifest.js";
import { writeProjectFilePreviewTool } from "./project/writePreview.js";
import { applyProjectPatchTool } from "./project/applyPatch.js";
import { rollbackProjectPatchTool } from "./project/rollbackPatch.js";
import { generateUi5ControllerTool } from "./ui5/generateController.js";
import { generateUi5FragmentTool } from "./ui5/generateFragment.js";
import { generateUi5FormatterTool } from "./ui5/generateFormatter.js";
import { generateUi5ViewLogicTool } from "./ui5/generateViewLogic.js";
import { generateUi5FeatureTool } from "./ui5/generateFeature.js";
import { manageUi5I18nTool } from "./ui5/manageI18n.js";
import { analyzeUi5PerformanceTool } from "./ui5/analyzePerformance.js";
import { validateUi5CodeTool } from "./ui5/validateUi5Code.js";
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
  // External documentation lookup
  searchUi5SdkTool,
  searchMdnTool,
  // JavaScript assistant tools
  generateJavaScriptFunctionTool,
  refactorJavaScriptCodeTool,
  lintJavaScriptCodeTool,
  securityCheckJavaScriptTool,
  validateUi5CodeTool,
  // Agent factory utilities
  scaffoldProjectAgentsTool,
  validateProjectAgentsTool,
  recommendProjectAgentsTool,
  materializeRecommendedAgentsTool,
  saveAgentPackTool,
  listAgentPacksTool,
  applyAgentPackTool
];
