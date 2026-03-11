import { ToolError } from "../../src/utils/errors.js";
import { refactorJavaScriptWithAst } from "../../src/utils/refactor.js";

describe("refactor utils", () => {
  it("refactors var declarations and Promise handlers using AST", () => {
    const input = `
      var stable = 1;
      var mutable = 0;
      mutable = mutable + 1;
      Promise.resolve(stable)
        .then(function (value) { return value + mutable; })
        .catch(function (err) { throw err; });
    `;

    const result = refactorJavaScriptWithAst(input);

    expect(result.refactoredCode).toMatch(/\bconst stable\b/);
    expect(result.refactoredCode).toMatch(/\blet mutable\b/);
    expect(result.refactoredCode).toMatch(/\.then\(\(?value\)? =>/);
    expect(result.refactoredCode).toMatch(/\.catch\(\(?err\)? =>/);
    expect(result.changes.some((item) => item.includes("Converted var declarations using AST"))).toBe(true);
    expect(result.changes.some((item) => item.includes("Promise handler"))).toBe(true);
  });

  it("keeps function expression when Promise callback uses lexical bindings", () => {
    const input = `
      promise.then(function () {
        return this.value + arguments.length;
      });
    `;

    const result = refactorJavaScriptWithAst(input);
    expect(result.refactoredCode).toContain("function ()");
    expect(result.changes.some((item) => item.includes("Promise handler"))).toBe(false);
  });

  it("converts loop initializer var to let when reassigned", () => {
    const input = `
      for (var i = 0; i < 3; i++) {
        console.log(i);
      }
    `;

    const result = refactorJavaScriptWithAst(input);
    expect(result.refactoredCode).toContain("for (let i = 0; i < 3; i++)");
  });

  it("detects callback-style nesting and reports recommendation", () => {
    const input = `
      function loadData(callback) {
        fetchThing(function () {
          callback();
        });
      }
    `;

    const result = refactorJavaScriptWithAst(input);
    expect(result.changes).toContain("Detected callback nesting; consider extracting async helper functions.");
  });

  it("throws ToolError when code cannot be parsed", () => {
    let captured = null;
    try {
      refactorJavaScriptWithAst("function () {");
    } catch (error) {
      captured = error;
    }

    expect(captured instanceof ToolError).toBe(true);
    expect(captured.code).toBe("REFACTOR_PARSE_ERROR");
  });
});
