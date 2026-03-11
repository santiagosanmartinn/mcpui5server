import {
  analyzeFileStructure,
  detectControllerPattern,
  extractControllerMethods,
  extractSapUiDefineDependencies,
  extractImports
} from "../../src/utils/parser.js";

describe("parser utils", () => {
  it("extracts ESM imports and sap.ui.define dependencies", () => {
    const code = `
      import Controller from "sap/ui/core/mvc/Controller";
      import JSONModel from "sap/ui/model/json/JSONModel";
      sap.ui.define([
        "sap/m/MessageToast",
        "sap/ui/core/Fragment"
      ], function (MessageToast, Fragment) {
        void MessageToast;
        void Fragment;
      });
    `;

    const result = extractImports(code);
    expect(result.esmImports).toEqual([
      "sap/ui/core/mvc/Controller",
      "sap/ui/model/json/JSONModel"
    ]);
    expect(result.sapUiDefineDependencies).toEqual([
      "sap/m/MessageToast",
      "sap/ui/core/Fragment"
    ]);
  });

  it("extracts controller methods from object literal and deduplicates names", () => {
    const code = `
      return Controller.extend("demo.controller.Main", {
        onInit: function () {},
        onPressSave: function () {},
        onPressSave: function () {}
      });
    `;

    expect(extractControllerMethods(code)).toEqual(["onInit", "onPressSave"]);
  });

  it("detects controller pattern variants", () => {
    expect(detectControllerPattern("return Controller.extend('x', {});")).toBe("Controller.extend");
    expect(detectControllerPattern("class Main extends Controller {}")).toBe("ES6 class extends Controller");
    expect(detectControllerPattern("function helper() {}")).toBe("unknown");
  });

  it("analyzes class names and method metadata", () => {
    const code = `
      import Controller from "sap/ui/core/mvc/Controller";
      class Main extends Controller {}
      return Controller.extend("demo.Main", {
        onInit: function () {}
      });
    `;

    const result = analyzeFileStructure(code);
    expect(result.classNames).toEqual(["Main"]);
    expect(result.controllerMethods).toEqual(["onInit"]);
    expect(result.imports.esmImports).toEqual(["sap/ui/core/mvc/Controller"]);
  });

  it("extracts controller methods from ES6 class controllers", () => {
    const code = `
      import Controller from "sap/ui/core/mvc/Controller";
      export default class Main extends Controller {
        constructor() {}
        onInit() {}
        onPressSave() {}
        static helper() {}
      }
    `;

    expect(extractControllerMethods(code)).toEqual(["onInit", "onPressSave"]);
    expect(detectControllerPattern(code)).toBe("ES6 class extends Controller");
  });

  it("supports TypeScript syntax for structural analysis", () => {
    const code = `
      import type { Event } from "sap/ui/base/Event";
      import Controller from "sap/ui/core/mvc/Controller";

      export class TsController extends Controller {
        onInit(): void {}
        onAction(oEvent: Event): void {
          void oEvent;
        }
      }
    `;

    const result = analyzeFileStructure(code);
    expect(result.classNames).toEqual(["TsController"]);
    expect(result.controllerMethods).toEqual(["onInit", "onAction"]);
    expect(result.imports.esmImports).toEqual(["sap/ui/base/Event", "sap/ui/core/mvc/Controller"]);
  });

  it("keeps stable fallback behavior when code is invalid", () => {
    const invalidCode = `
      sap.ui.define(["sap/m/Text"], function (Text) {
      return Controller.extend("demo.Main", {
        onInit: function () {}
    `;

    const imports = extractImports(invalidCode);
    const dependencies = extractSapUiDefineDependencies(invalidCode);
    const methods = extractControllerMethods(invalidCode);

    expect(imports.sapUiDefineDependencies).toEqual(["sap/m/Text"]);
    expect(dependencies).toEqual(["sap/m/Text"]);
    expect(methods).toContain("onInit");
  });
});
