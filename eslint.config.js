import js from "@eslint/js";

const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  fetch: "readonly",
  AbortController: "readonly",
  URL: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly"
};

const testGlobals = {
  describe: "readonly",
  it: "readonly",
  expect: "readonly",
  beforeEach: "readonly",
  afterEach: "readonly"
};

export default [
  {
    ignores: ["node_modules/**", "coverage/**", "dist/**"]
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: nodeGlobals
    }
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...nodeGlobals,
        ...testGlobals
      }
    }
  }
];
