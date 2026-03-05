export function extractImports(code) {
  const importLines = [];
  const importRegex = /^\s*import\s+.+?from\s+["'](.+?)["'];?/gm;
  let match = importRegex.exec(code);
  while (match) {
    importLines.push(match[1]);
    match = importRegex.exec(code);
  }

  const defineDeps = extractSapUiDefineDependencies(code);
  return {
    esmImports: importLines,
    sapUiDefineDependencies: defineDeps
  };
}

export function extractSapUiDefineDependencies(code) {
  const defineRegex = /sap\.ui\.define\s*\(\s*\[([\s\S]*?)\]/m;
  const match = defineRegex.exec(code);
  if (!match) {
    return [];
  }

  const list = match[1]
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  return list;
}

export function extractControllerMethods(code) {
  const methods = [];

  const objectMethodRegex = /^\s*([A-Za-z_$][\w$]*)\s*:\s*function\s*\(/gm;
  let match = objectMethodRegex.exec(code);
  while (match) {
    methods.push(match[1]);
    match = objectMethodRegex.exec(code);
  }

  return Array.from(new Set(methods));
}

export function detectControllerPattern(code) {
  if (/Controller\.extend\s*\(/.test(code)) {
    return "Controller.extend";
  }
  if (/class\s+\w+\s+extends\s+Controller/.test(code)) {
    return "ES6 class extends Controller";
  }
  return "unknown";
}

export function analyzeFileStructure(code) {
  const imports = extractImports(code);
  const controllerMethods = extractControllerMethods(code);
  const classNames = [];
  const classRegex = /class\s+([A-Za-z_$][\w$]*)\s+/gm;
  let classMatch = classRegex.exec(code);
  while (classMatch) {
    classNames.push(classMatch[1]);
    classMatch = classRegex.exec(code);
  }

  return {
    imports,
    classNames,
    controllerMethods
  };
}

