import { analyzeUi5ProjectTool } from "./project/analyzeProject.js";
import { readProjectFileTool } from "./project/readFile.js";
import { searchProjectFilesTool } from "./project/searchFiles.js";
import { analyzeCurrentFileTool } from "./project/analyzeCurrentFile.js";
import { generateUi5ControllerTool } from "./ui5/generateController.js";
import { generateUi5FragmentTool } from "./ui5/generateFragment.js";
import { generateUi5FormatterTool } from "./ui5/generateFormatter.js";
import { generateUi5ViewLogicTool } from "./ui5/generateViewLogic.js";
import { validateUi5CodeTool } from "./ui5/validateUi5Code.js";
import { generateJavaScriptFunctionTool } from "./javascript/generateFunction.js";
import { refactorJavaScriptCodeTool } from "./javascript/refactorCode.js";
import { lintJavaScriptCodeTool } from "./javascript/lintCode.js";
import { securityCheckJavaScriptTool } from "./javascript/securityCheck.js";
import { searchUi5SdkTool } from "./documentation/searchUI5SDK.js";
import { searchMdnTool } from "./documentation/searchMDN.js";

export const allTools = [
  // Project intelligence
  analyzeUi5ProjectTool,
  // UI5 generation and validation
  generateUi5ControllerTool,
  generateUi5FragmentTool,
  generateUi5FormatterTool,
  generateUi5ViewLogicTool,
  readProjectFileTool,
  searchProjectFilesTool,
  analyzeCurrentFileTool,
  // External documentation lookup
  searchUi5SdkTool,
  searchMdnTool,
  // JavaScript assistant tools
  generateJavaScriptFunctionTool,
  refactorJavaScriptCodeTool,
  lintJavaScriptCodeTool,
  securityCheckJavaScriptTool,
  validateUi5CodeTool
];
