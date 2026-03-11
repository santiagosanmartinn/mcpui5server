import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import generateModule from "@babel/generator";
import * as t from "@babel/types";
import { ToolError } from "./errors.js";

const traverse = typeof traverseModule === "function"
  ? traverseModule
  : traverseModule.default;

const generate = typeof generateModule === "function"
  ? generateModule
  : generateModule.default;

const AST_PLUGINS = [
  "typescript",
  "jsx",
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "decorators-legacy",
  "objectRestSpread"
];

export function refactorJavaScriptWithAst(code) {
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new ToolError("Code must be a non-empty string.", {
      code: "INVALID_REFACTOR_INPUT"
    });
  }

  const trailingWhitespaceCount = countTrailingWhitespaceLines(code);
  const normalizedInput = code.replace(/[ \t]+$/gm, "");
  const ast = parseRefactorAst(normalizedInput);

  const counters = {
    varToConst: 0,
    varToLet: 0,
    promiseHandlersToArrow: 0
  };

  convertVarDeclarations(ast, counters);
  convertPromiseHandlers(ast, counters);
  const callbackNestingDetected = detectCallbackStyleNesting(ast);

  const generated = generate(ast, {
    comments: true,
    compact: false,
    retainLines: false
  }).code;

  const refactoredCode = generated.replace(/[ \t]+$/gm, "");
  const changes = [];

  if (counters.varToConst > 0 || counters.varToLet > 0) {
    changes.push(
      `Converted var declarations using AST (${counters.varToConst} to const, ${counters.varToLet} to let).`
    );
  }

  if (counters.promiseHandlersToArrow > 0) {
    changes.push(`Converted ${counters.promiseHandlersToArrow} Promise handler function(s) to arrow syntax.`);
  }

  if (callbackNestingDetected) {
    changes.push("Detected callback nesting; consider extracting async helper functions.");
  }

  if (trailingWhitespaceCount > 0) {
    changes.push(`Removed trailing whitespace from ${trailingWhitespaceCount} line(s).`);
  }

  return {
    refactoredCode,
    changes
  };
}

function parseRefactorAst(code) {
  try {
    return parse(code, {
      sourceType: "unambiguous",
      errorRecovery: false,
      allowReturnOutsideFunction: true,
      plugins: AST_PLUGINS
    });
  } catch (error) {
    throw new ToolError(`Unable to parse JavaScript for refactor: ${error.message}`, {
      code: "REFACTOR_PARSE_ERROR"
    });
  }
}

function convertVarDeclarations(ast, counters) {
  traverse(ast, {
    VariableDeclaration(path) {
      if (path.node.kind !== "var") {
        return;
      }

      if (isLoopInitializer(path)) {
        const inForInOrForOf = path.parentPath.isForInStatement() || path.parentPath.isForOfStatement();
        const canAllBeConst = path.node.declarations.every((declarator) =>
          declaratorCanBeConst(path, declarator, { allowWithoutInit: inForInOrForOf })
        );
        path.node.kind = canAllBeConst ? "const" : "let";
        if (canAllBeConst) {
          counters.varToConst += path.node.declarations.length;
        } else {
          counters.varToLet += path.node.declarations.length;
        }
        return;
      }

      const replacements = [];
      for (const declarator of path.node.declarations) {
        const canBeConst = declaratorCanBeConst(path, declarator, { allowWithoutInit: false });
        const kind = canBeConst ? "const" : "let";
        replacements.push(t.variableDeclaration(kind, [t.cloneNode(declarator, true)]));
        if (canBeConst) {
          counters.varToConst += 1;
        } else {
          counters.varToLet += 1;
        }
      }

      if (replacements.length === 1) {
        path.replaceWith(replacements[0]);
      } else {
        path.replaceWithMultiple(replacements);
      }
      path.skip();
    }
  });
}

function convertPromiseHandlers(ast, counters) {
  traverse(ast, {
    CallExpression(path) {
      const propertyName = memberPropertyName(path.node.callee);
      if (propertyName !== "then" && propertyName !== "catch") {
        return;
      }

      const argumentPaths = path.get("arguments");
      for (const argumentPath of argumentPaths) {
        if (!argumentPath.isFunctionExpression()) {
          continue;
        }
        if (argumentPath.node.generator) {
          continue;
        }
        if (containsLexicalBindings(argumentPath)) {
          continue;
        }

        argumentPath.replaceWith(
          t.arrowFunctionExpression(
            argumentPath.node.params,
            argumentPath.node.body,
            argumentPath.node.async
          )
        );
        counters.promiseHandlersToArrow += 1;
      }
    }
  });
}

function detectCallbackStyleNesting(ast) {
  let detected = false;
  traverse(ast, {
    Function(path) {
      const callbackParamNames = path.node.params
        .filter((param) => t.isIdentifier(param))
        .map((param) => param.name)
        .filter((name) => name.toLowerCase().includes("callback"));

      if (callbackParamNames.length === 0) {
        return;
      }

      let callbackCalled = false;
      path.traverse({
        CallExpression(callPath) {
          if (t.isIdentifier(callPath.node.callee) && callbackParamNames.includes(callPath.node.callee.name)) {
            callbackCalled = true;
            callPath.stop();
          }
        }
      });

      if (callbackCalled) {
        detected = true;
        path.stop();
      }
    }
  });
  return detected;
}

function declaratorCanBeConst(path, declarator, options = {}) {
  const { allowWithoutInit = false } = options;
  if (!allowWithoutInit && !declarator.init) {
    return false;
  }
  if (!t.isIdentifier(declarator.id)) {
    return false;
  }

  const binding = path.scope.getBinding(declarator.id.name);
  return Boolean(binding?.constant);
}

function isLoopInitializer(path) {
  return (
    (path.parentPath.isForStatement() && path.key === "init") ||
    (path.parentPath.isForInStatement() && path.key === "left") ||
    (path.parentPath.isForOfStatement() && path.key === "left")
  );
}

function memberPropertyName(callee) {
  if (!t.isMemberExpression(callee) || callee.computed) {
    return null;
  }
  return t.isIdentifier(callee.property) ? callee.property.name : null;
}

function containsLexicalBindings(functionPath) {
  let found = false;
  functionPath.traverse({
    ThisExpression(path) {
      found = true;
      path.stop();
    },
    Super(path) {
      found = true;
      path.stop();
    },
    MetaProperty(path) {
      if (path.node.meta?.name === "new" && path.node.property?.name === "target") {
        found = true;
        path.stop();
      }
    },
    Identifier(path) {
      if (path.isReferencedIdentifier({ name: "arguments" })) {
        found = true;
        path.stop();
      }
    }
  });
  return found;
}

function countTrailingWhitespaceLines(code) {
  const matches = code.match(/[ \t]+$/gm);
  return matches ? matches.length : 0;
}
