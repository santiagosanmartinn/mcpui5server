import { z } from "zod";
import { analyzeGitDiffTool } from "./analyzeGitDiff.js";

const DIFF_MODES = ["working_tree", "staged", "range"];
const PRIORITIES = ["high", "medium", "low"];

const inputSchema = z.object({
  mode: z.enum(DIFF_MODES).optional(),
  baseRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  includeUntracked: z.boolean().optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional()
}).strict();

const suggestionSchema = z.object({
  id: z.string(),
  priority: z.enum(PRIORITIES),
  title: z.string(),
  rationale: z.string(),
  relatedFiles: z.array(z.string()),
  recommendedChecks: z.array(z.string())
});

const outputSchema = z.object({
  scope: z.object({
    mode: z.enum(DIFF_MODES),
    baseRef: z.string().nullable(),
    targetRef: z.string().nullable()
  }),
  diffSummary: z.object({
    changedFiles: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    touches: z.object({
      docs: z.boolean(),
      tests: z.boolean(),
      controllers: z.boolean(),
      views: z.boolean(),
      manifest: z.boolean(),
      i18n: z.boolean(),
      config: z.boolean()
    })
  }),
  suggestions: z.array(suggestionSchema),
  recommendedCommands: z.array(z.string())
});

export const suggestTestsFromGitDiffTool = {
  name: "suggest_tests_from_git_diff",
  description: "Suggest focused tests/checks based on current Git diff impact (UI5, manifest, config, docs, and test coverage gaps).",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const diffAnalysis = await analyzeGitDiffTool.handler(parsed, { context });
    const scope = diffAnalysis.scope;
    const summary = diffAnalysis.summary;
    const files = diffAnalysis.files;

    if (!diffAnalysis.repository.gitAvailable || !diffAnalysis.repository.isGitRepository) {
      return outputSchema.parse({
        scope,
        diffSummary: {
          changedFiles: 0,
          additions: 0,
          deletions: 0,
          touches: summary.touches
        },
        suggestions: [
          {
            id: "git-unavailable",
            priority: "medium",
            title: "Enable Git-aware test suggestions",
            rationale: "No Git repository was detected, so diff-driven recommendations are unavailable.",
            relatedFiles: [],
            recommendedChecks: ["Initialize Git in this workspace and rerun the tool."]
          }
        ],
        recommendedCommands: []
      });
    }

    const suggestions = [];
    const commands = new Set();
    const controllerFiles = files.filter((item) => item.path.includes("/controller/")).map((item) => item.path);
    const viewFiles = files.filter((item) => item.path.includes("/view/")).map((item) => item.path);
    const manifestFiles = files.filter((item) => item.path.endsWith("/manifest.json") || item.path === "webapp/manifest.json")
      .map((item) => item.path);
    const i18nFiles = files.filter((item) => item.path.includes("/i18n/") || item.path.endsWith(".properties"))
      .map((item) => item.path);
    const testFiles = files.filter(isTestFile).map((item) => item.path);
    const docsOnlyChange = summary.touches.docs
      && !summary.touches.tests
      && !summary.touches.controllers
      && !summary.touches.views
      && !summary.touches.manifest
      && !summary.touches.i18n
      && !summary.touches.config;

    if (docsOnlyChange) {
      suggestions.push({
        id: "docs-change-smoke-check",
        priority: "low",
        title: "Run docs consistency smoke check",
        rationale: "Diff contains documentation changes only, so lightweight checks are usually enough.",
        relatedFiles: files.map((item) => item.path),
        recommendedChecks: ["Run documentation sync check via `npm run check` before merge."]
      });
      commands.add("npm run check");
    }

    if (controllerFiles.length > 0 || viewFiles.length > 0) {
      suggestions.push({
        id: "ui5-controller-view-regression",
        priority: "high",
        title: "Validate UI5 behavior for changed controllers/views",
        rationale: "Controller/view edits are high-impact for runtime behavior and binding integrity.",
        relatedFiles: [...controllerFiles, ...viewFiles].slice(0, 15),
        recommendedChecks: [
          "Run unit/integration tests that cover affected controllers and views.",
          "Execute `run_project_quality_gate` before commit."
        ]
      });
      commands.add("npm run test:run");
      commands.add("npm run check");
    }

    if (manifestFiles.length > 0) {
      suggestions.push({
        id: "manifest-routing-model-safety",
        priority: "high",
        title: "Re-check routing/model compatibility after manifest changes",
        rationale: "Manifest updates can silently break navigation, model wiring, or version compatibility.",
        relatedFiles: manifestFiles,
        recommendedChecks: [
          "Run `run_project_quality_gate` with OData checks enabled.",
          "Verify navigation and bootstrapping smoke flow in app."
        ]
      });
      commands.add("npm run check");
    }

    if (i18nFiles.length > 0) {
      suggestions.push({
        id: "i18n-consistency",
        priority: "medium",
        title: "Validate i18n usage and missing keys",
        rationale: "i18n updates often require key-usage checks in XML/JS bindings.",
        relatedFiles: i18nFiles.slice(0, 15),
        recommendedChecks: [
          "Run `manage_ui5_i18n` in report mode to detect missing/unused keys.",
          "Run `npm run check`."
        ]
      });
      commands.add("npm run check");
    }

    if (summary.touches.config) {
      suggestions.push({
        id: "config-change-ci-sanity",
        priority: "medium",
        title: "Run CI-equivalent checks after tooling/config changes",
        rationale: "Config updates can alter lint/test behavior and should be validated end-to-end.",
        relatedFiles: files.filter(isConfigFile).map((item) => item.path).slice(0, 15),
        recommendedChecks: [
          "Run full quality gate (`npm run check`).",
          "If contracts/docs changed, regenerate and verify snapshots."
        ]
      });
      commands.add("npm run check");
    }

    const codeTouched = summary.touches.controllers
      || summary.touches.views
      || summary.touches.manifest
      || summary.touches.i18n
      || summary.touches.config;
    if (codeTouched && testFiles.length === 0) {
      suggestions.push({
        id: "no-tests-updated",
        priority: "high",
        title: "Add or update tests for changed behavior",
        rationale: "Code and configuration changed without test updates, increasing regression risk.",
        relatedFiles: [...controllerFiles, ...viewFiles, ...manifestFiles, ...i18nFiles].slice(0, 20),
        recommendedChecks: [
          "Add targeted tests for changed modules before merge.",
          "Run `npm run test:run` to confirm baseline remains green."
        ]
      });
      commands.add("npm run test:run");
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: "baseline-check",
        priority: "low",
        title: "Run baseline validation",
        rationale: "No specific risk pattern detected; baseline verification is still recommended.",
        relatedFiles: [],
        recommendedChecks: ["Run `npm run check`."]
      });
      commands.add("npm run check");
    }

    return outputSchema.parse({
      scope,
      diffSummary: {
        changedFiles: summary.changedFiles,
        additions: summary.additions,
        deletions: summary.deletions,
        touches: summary.touches
      },
      suggestions,
      recommendedCommands: Array.from(commands)
    });
  }
};

function isTestFile(file) {
  const normalized = file.path.toLowerCase();
  return normalized.startsWith("test/")
    || normalized.includes(".test.")
    || normalized.includes(".spec.")
    || normalized.includes("__tests__/");
}

function isConfigFile(file) {
  const normalized = file.path.toLowerCase();
  return normalized === "package.json"
    || normalized === "package-lock.json"
    || normalized === "ui5.yaml"
    || normalized === "eslint.config.js"
    || normalized === "vitest.config.js"
    || normalized.startsWith(".github/workflows/");
}
