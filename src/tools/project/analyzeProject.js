import { z } from "zod";
import { fileExists, readJsonFile, readTextFile, searchFiles } from "../../utils/fileSystem.js";
import { ToolError } from "../../utils/errors.js";

const outputSchema = z.object({
  detectedFiles: z.object({
    ui5Yaml: z.boolean(),
    manifestJson: z.boolean(),
    packageJson: z.boolean()
  }),
  ui5Version: z.string().nullable(),
  models: z.array(z.string()),
  routing: z.object({
    hasRouting: z.boolean(),
    routes: z.number().int().nonnegative(),
    targets: z.number().int().nonnegative()
  }),
  namespace: z.string().nullable(),
  controllerPattern: z.string()
});

export const analyzeUi5ProjectTool = {
  name: "analyze_ui5_project",
  description: "Analyze SAPUI5 project configuration from ui5.yaml, manifest.json, and package.json.",
  inputSchema: z.object({}).strict(),
  outputSchema,
  async handler(_args, { context }) {
    const root = context.rootDir;
    // Manifest can exist at project root or under webapp in typical UI5 layouts.
    const ui5YamlExists = await fileExists("ui5.yaml", root);
    const manifestPath = (await fileExists("webapp/manifest.json", root)) ? "webapp/manifest.json" : "manifest.json";
    const manifestExists = await fileExists(manifestPath, root);
    const packageJsonExists = await fileExists("package.json", root);

    let ui5Yaml = "";
    let manifest = {};
    let packageJson = {};
    if (ui5YamlExists) {
      ui5Yaml = await readTextFile("ui5.yaml", root);
    }
    if (manifestExists) {
      manifest = await readJsonFile(manifestPath, root);
    }
    if (packageJsonExists) {
      packageJson = await readJsonFile("package.json", root);
    }

    const models = Object.keys(manifest?.["sap.ui5"]?.models ?? {});
    const routingConfig = manifest?.["sap.ui5"]?.routing ?? {};
    const routes = Array.isArray(routingConfig.routes) ? routingConfig.routes.length : 0;
    const targets = routingConfig.targets ? Object.keys(routingConfig.targets).length : 0;

    const ui5Version =
      // Resolution priority keeps output deterministic across project variants.
      extractUi5VersionFromYaml(ui5Yaml) ??
      manifest?.["sap.ui5"]?.dependencies?.minUI5Version ??
      packageJson?.ui5?.version ??
      packageJson?.dependencies?.["@openui5/sap.ui.core"] ??
      null;

    const namespace =
      manifest?.["sap.app"]?.id ??
      packageJson?.name ??
      null;

    const controllerPattern = await detectControllerPattern(root);

    return outputSchema.parse({
      detectedFiles: {
        ui5Yaml: ui5YamlExists,
        manifestJson: manifestExists,
        packageJson: packageJsonExists
      },
      ui5Version,
      models,
      routing: {
        hasRouting: routes > 0 || targets > 0,
        routes,
        targets
      },
      namespace,
      controllerPattern
    });
  }
};

function extractUi5VersionFromYaml(ui5Yaml) {
  if (!ui5Yaml) {
    return null;
  }

  const versionMatch = ui5Yaml.match(/version:\s*["']?([0-9]+\.[0-9]+(?:\.[0-9]+)?|latest)["']?/i);
  return versionMatch?.[1] ?? null;
}

async function detectControllerPattern(rootDir) {
  try {
    // Lightweight project-level detection by searching source text patterns.
    const extendMatches = await searchFiles("Controller.extend(", {
      root: rootDir,
      maxResults: 1,
      fileExtensions: [".js"]
    });
    if (extendMatches.length > 0) {
      return "Controller.extend";
    }

    const classMatches = await searchFiles("extends Controller", {
      root: rootDir,
      maxResults: 1,
      fileExtensions: [".js"]
    });
    if (classMatches.length > 0) {
      return "ES6 class extends Controller";
    }
  } catch (error) {
    throw new ToolError(`Failed to inspect controller patterns: ${error.message}`, {
      code: "ANALYZE_PROJECT_FAILED"
    });
  }

  return "unknown";
}
