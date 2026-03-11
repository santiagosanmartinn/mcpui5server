import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = typeof traverseModule === "function"
  ? traverseModule
  : traverseModule.default;

const AST_PLUGINS = [
  "typescript",
  "jsx",
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "decorators-legacy",
  "objectRestSpread"
];

export function extractImports(code) {
  const astAnalysis = analyzeWithAst(code);
  if (astAnalysis) {
    return {
      // ESM imports and UI5 AMD dependencies are tracked separately.
      esmImports: astAnalysis.esmImports,
      sapUiDefineDependencies: astAnalysis.sapUiDefineDependencies
    };
  }

  return {
    esmImports: fallbackExtractEsmImports(code),
    sapUiDefineDependencies: fallbackExtractSapUiDefineDependencies(code)
  };
}

export function extractSapUiDefineDependencies(code) {
  const astAnalysis = analyzeWithAst(code);
  if (astAnalysis) {
    return astAnalysis.sapUiDefineDependencies;
  }
  return fallbackExtractSapUiDefineDependencies(code);
}

export function extractControllerMethods(code) {
  const astAnalysis = analyzeWithAst(code);
  if (astAnalysis) {
    return astAnalysis.controllerMethods;
  }
  return fallbackExtractControllerMethods(code);
}

export function detectControllerPattern(code) {
  const astAnalysis = analyzeWithAst(code);
  if (astAnalysis) {
    if (astAnalysis.hasControllerExtendPattern) {
      return "Controller.extend";
    }
    if (astAnalysis.hasClassExtendsControllerPattern) {
      return "ES6 class extends Controller";
    }
    return "unknown";
  }

  if (/Controller\.extend\s*\(/.test(code)) {
    return "Controller.extend";
  }
  if (/class\s+\w+\s+extends\s+Controller/.test(code)) {
    return "ES6 class extends Controller";
  }
  return "unknown";
}

export function analyzeFileStructure(code) {
  const astAnalysis = analyzeWithAst(code);
  if (astAnalysis) {
    return {
      imports: {
        esmImports: astAnalysis.esmImports,
        sapUiDefineDependencies: astAnalysis.sapUiDefineDependencies
      },
      classNames: astAnalysis.classNames,
      controllerMethods: astAnalysis.controllerMethods
    };
  }

  return {
    imports: {
      esmImports: fallbackExtractEsmImports(code),
      sapUiDefineDependencies: fallbackExtractSapUiDefineDependencies(code)
    },
    classNames: fallbackExtractClassNames(code),
    controllerMethods: fallbackExtractControllerMethods(code)
  };
}

function analyzeWithAst(code) {
  const ast = parseCodeToAst(code);
  if (!ast || !traverse) {
    return null;
  }

  const esmImports = [];
  const sapUiDefineDependencies = [];
  const controllerMethods = [];
  const classNames = [];
  const seenImports = new Set();
  const seenDependencies = new Set();
  const seenMethods = new Set();
  const seenClasses = new Set();
  let hasControllerExtendPattern = false;
  let hasClassExtendsControllerPattern = false;

  traverse(ast, {
    ImportDeclaration(traversalPath) {
      const source = traversalPath.node.source?.value;
      if (typeof source === "string") {
        pushUnique(esmImports, seenImports, source);
      }
    },
    CallExpression(traversalPath) {
      const { node } = traversalPath;

      if (isSapUiDefineCallee(node.callee) && sapUiDefineDependencies.length === 0) {
        const dependencies = extractDependenciesFromDefineCall(node);
        for (const dependency of dependencies) {
          pushUnique(sapUiDefineDependencies, seenDependencies, dependency);
        }
      }

      if (isControllerExtendCall(node)) {
        hasControllerExtendPattern = true;
        const methods = extractMethodsFromControllerExtend(node);
        for (const methodName of methods) {
          pushUnique(controllerMethods, seenMethods, methodName);
        }
      }
    },
    ClassDeclaration(traversalPath) {
      const { node } = traversalPath;
      if (node.id?.name) {
        pushUnique(classNames, seenClasses, node.id.name);
      }
      if (extendsController(node.superClass)) {
        hasClassExtendsControllerPattern = true;
      }
      const methods = extractMethodsFromClass(node);
      for (const methodName of methods) {
        pushUnique(controllerMethods, seenMethods, methodName);
      }
    },
    ClassExpression(traversalPath) {
      const { node } = traversalPath;
      if (node.id?.name) {
        pushUnique(classNames, seenClasses, node.id.name);
      }
      if (extendsController(node.superClass)) {
        hasClassExtendsControllerPattern = true;
      }
      const methods = extractMethodsFromClass(node);
      for (const methodName of methods) {
        pushUnique(controllerMethods, seenMethods, methodName);
      }
    }
  });

  return {
    esmImports,
    sapUiDefineDependencies,
    controllerMethods,
    classNames,
    hasControllerExtendPattern,
    hasClassExtendsControllerPattern
  };
}

function parseCodeToAst(code) {
  if (typeof code !== "string") {
    return null;
  }

  try {
    return parse(code, {
      sourceType: "unambiguous",
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      plugins: AST_PLUGINS
    });
  } catch {
    return null;
  }
}

function isSapUiDefineCallee(callee) {
  return (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.property?.type === "Identifier" &&
    callee.property.name === "define" &&
    callee.object?.type === "MemberExpression" &&
    !callee.object.computed &&
    callee.object.property?.type === "Identifier" &&
    callee.object.property.name === "ui" &&
    callee.object.object?.type === "Identifier" &&
    callee.object.object.name === "sap"
  );
}

function extractDependenciesFromDefineCall(callExpression) {
  const [firstArg] = callExpression.arguments;
  if (!firstArg || firstArg.type !== "ArrayExpression") {
    return [];
  }

  return firstArg.elements
    .map((element) => (element?.type === "StringLiteral" ? element.value : null))
    .filter(Boolean);
}

function isControllerExtendCall(callExpression) {
  const callee = callExpression.callee;
  return (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.property?.type === "Identifier" &&
    callee.property.name === "extend" &&
    callee.object?.type === "Identifier" &&
    callee.object.name === "Controller"
  );
}

function extractMethodsFromControllerExtend(callExpression) {
  const objectArg = callExpression.arguments.find((arg) => arg?.type === "ObjectExpression");
  if (!objectArg || objectArg.type !== "ObjectExpression") {
    return [];
  }

  const methods = [];
  for (const property of objectArg.properties) {
    if (property.type === "ObjectMethod") {
      if (property.kind !== "method") {
        continue;
      }
      const methodName = propertyNameFromKey(property.key);
      if (methodName) {
        methods.push(methodName);
      }
      continue;
    }

    if (property.type === "ObjectProperty") {
      const isFunctionValue = property.value?.type === "FunctionExpression" || property.value?.type === "ArrowFunctionExpression";
      if (!isFunctionValue) {
        continue;
      }
      const methodName = propertyNameFromKey(property.key);
      if (methodName) {
        methods.push(methodName);
      }
    }
  }

  return methods;
}

function extractMethodsFromClass(classNode) {
  const methods = [];
  if (!classNode.body?.body) {
    return methods;
  }

  for (const member of classNode.body.body) {
    if (member.type !== "ClassMethod") {
      continue;
    }
    if (member.kind === "constructor" || member.static) {
      continue;
    }

    const methodName = propertyNameFromKey(member.key);
    if (methodName) {
      methods.push(methodName);
    }
  }

  return methods;
}

function extendsController(superClassNode) {
  return superClassNode?.type === "Identifier" && superClassNode.name === "Controller";
}

function propertyNameFromKey(keyNode) {
  if (keyNode?.type === "Identifier") {
    return keyNode.name;
  }
  if (keyNode?.type === "StringLiteral") {
    return keyNode.value;
  }
  return null;
}

function pushUnique(list, seen, value) {
  if (!value || seen.has(value)) {
    return;
  }
  seen.add(value);
  list.push(value);
}

function fallbackExtractEsmImports(code) {
  const importLines = [];
  const importRegex = /^\s*import\s+.+?from\s+["'](.+?)["'];?/gm;
  let match = importRegex.exec(code);
  while (match) {
    importLines.push(match[1]);
    match = importRegex.exec(code);
  }
  return importLines;
}

function fallbackExtractSapUiDefineDependencies(code) {
  const defineRegex = /sap\.ui\.define\s*\(\s*\[([\s\S]*?)\]/m;
  const match = defineRegex.exec(code);
  if (!match) {
    return [];
  }

  return match[1]
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function fallbackExtractControllerMethods(code) {
  const methods = [];
  const objectMethodRegex = /^\s*([A-Za-z_$][\w$]*)\s*:\s*function\s*\(/gm;
  let match = objectMethodRegex.exec(code);
  while (match) {
    methods.push(match[1]);
    match = objectMethodRegex.exec(code);
  }
  return Array.from(new Set(methods));
}

function fallbackExtractClassNames(code) {
  const classNames = [];
  const classRegex = /class\s+([A-Za-z_$][\w$]*)\s+/gm;
  let classMatch = classRegex.exec(code);
  while (classMatch) {
    classNames.push(classMatch[1]);
    classMatch = classRegex.exec(code);
  }
  return classNames;
}
