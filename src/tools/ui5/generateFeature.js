import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readJsonFile, readTextFile } from "../../utils/fileSystem.js";
import { synchronizeManifest, validateManifestStructure } from "../../utils/manifestSync.js";

const DEFAULT_VIEW_DIR = "webapp/view";
const DEFAULT_CONTROLLER_DIR = "webapp/controller";
const DEFAULT_FRAGMENT_DIR = "webapp/view/fragments";
const DEFAULT_I18N_PATH = "webapp/i18n/i18n.properties";
const LIFECYCLE_METHODS = [
  "onInit",
  "onBeforeRendering",
  "onAfterRendering",
  "onExit"
];

const inputSchema = z.object({
  featureName: z.string().min(1),
  namespace: z.string().min(1).optional(),
  manifestPath: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
  allowOverwrite: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional(),
  withFragment: z.boolean().optional(),
  controllerMethods: z.array(z.string().min(1)).optional(),
  paths: z.object({
    viewDir: z.string().min(1).optional(),
    controllerDir: z.string().min(1).optional(),
    fragmentDir: z.string().min(1).optional()
  }).strict().optional(),
  routing: z.object({
    routeName: z.string().min(1).optional(),
    pattern: z.string().optional(),
    targetName: z.string().min(1).optional(),
    targetDefinition: z.record(z.any()).optional()
  }).strict().optional(),
  i18n: z.object({
    filePath: z.string().min(1).optional(),
    titleKey: z.string().min(1).optional(),
    titleText: z.string().min(1).optional(),
    descriptionKey: z.string().min(1).optional(),
    descriptionText: z.string().min(1).optional(),
    actionKey: z.string().min(1).optional(),
    actionText: z.string().min(1).optional(),
    entries: z.record(z.string()).optional()
  }).strict().optional()
}).strict();

const validationSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string())
});

const filePreviewSchema = z.object({
  path: z.string(),
  role: z.enum(["controller", "view", "fragment", "manifest", "i18n"]),
  existsBefore: z.boolean(),
  changed: z.boolean(),
  oldHash: z.string().nullable(),
  newHash: z.string(),
  lineSummary: z.object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative()
  }),
  diffPreview: z.string(),
  diffTruncated: z.boolean()
});

const outputSchema = z.object({
  dryRun: z.boolean(),
  changed: z.boolean(),
  feature: z.object({
    featureName: z.string(),
    namespace: z.string(),
    routeName: z.string(),
    routePattern: z.string(),
    targetName: z.string(),
    controllerName: z.string(),
    fragmentName: z.string().nullable(),
    paths: z.object({
      controller: z.string(),
      view: z.string(),
      fragment: z.string().nullable(),
      manifest: z.string(),
      i18n: z.string()
    })
  }),
  fileSummary: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative()
  }),
  manifestValidation: z.object({
    pre: validationSchema,
    post: validationSchema
  }),
  manifestSummary: z.object({
    modelsAdded: z.number().int().nonnegative(),
    modelsUpdated: z.number().int().nonnegative(),
    modelsRemoved: z.number().int().nonnegative(),
    routesAdded: z.number().int().nonnegative(),
    routesUpdated: z.number().int().nonnegative(),
    routesRemoved: z.number().int().nonnegative(),
    targetsAdded: z.number().int().nonnegative(),
    targetsUpdated: z.number().int().nonnegative(),
    targetsRemoved: z.number().int().nonnegative()
  }),
  i18nSummary: z.object({
    keysAdded: z.number().int().nonnegative(),
    keysUpdated: z.number().int().nonnegative(),
    keysUnchanged: z.number().int().nonnegative()
  }),
  previews: z.array(filePreviewSchema),
  applyResult: z.object({
    patchId: z.string().nullable(),
    appliedAt: z.string(),
    reason: z.string().nullable(),
    changedFiles: z.array(
      z.object({
        path: z.string(),
        changed: z.boolean(),
        oldHash: z.string().nullable(),
        newHash: z.string(),
        bytesBefore: z.number().int().nonnegative(),
        bytesAfter: z.number().int().nonnegative()
      })
    ),
    skippedFiles: z.array(z.string())
  }).nullable()
});

export const generateUi5FeatureTool = {
  name: "generate_ui5_feature",
  description: "Generate an end-to-end UI5 feature scaffold (view/controller/fragment/routing/i18n) with dry-run support.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      featureName,
      namespace,
      manifestPath,
      dryRun,
      allowOverwrite,
      reason,
      maxDiffLines,
      withFragment,
      controllerMethods,
      paths,
      routing,
      i18n
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const shouldDryRun = dryRun ?? true;
    const shouldAllowOverwrite = allowOverwrite ?? false;
    const includeFragment = withFragment ?? true;

    const normalizedFeatureName = normalizeFeatureName(featureName);
    const manifestTargetPath = await resolveManifestPath(manifestPath, root);
    const currentManifest = await readJsonFile(manifestTargetPath, root);
    const resolvedNamespace = resolveNamespace(namespace, currentManifest);
    const routeName = routing?.routeName ?? toCamelCase(normalizedFeatureName);
    const routePattern = routing?.pattern ?? toKebabCase(normalizedFeatureName);
    const targetName = routing?.targetName ?? normalizedFeatureName;

    const viewDir = normalizeRelativePath(paths?.viewDir ?? DEFAULT_VIEW_DIR);
    const controllerDir = normalizeRelativePath(paths?.controllerDir ?? DEFAULT_CONTROLLER_DIR);
    const fragmentDir = normalizeRelativePath(paths?.fragmentDir ?? DEFAULT_FRAGMENT_DIR);
    const i18nPath = normalizeRelativePath(i18n?.filePath ?? DEFAULT_I18N_PATH);

    const controllerPath = joinPath(controllerDir, `${normalizedFeatureName}.controller.js`);
    const viewPath = joinPath(viewDir, `${normalizedFeatureName}.view.xml`);
    const fragmentPath = includeFragment
      ? joinPath(fragmentDir, `${normalizedFeatureName}.fragment.xml`)
      : null;
    const controllerName = `${resolvedNamespace}.controller.${normalizedFeatureName}`;
    const fragmentName = includeFragment
      ? `${resolvedNamespace}.view.fragments.${normalizedFeatureName}`
      : null;

    const customMethods = normalizeMethods(controllerMethods ?? []);
    const defaultActionMethod = `on${normalizedFeatureName}Press`;
    const actionMethodName = customMethods[0] ?? defaultActionMethod;
    const controllerCode = renderController(controllerName, customMethods, includeFragment ? actionMethodName : null);

    const i18nConfig = buildI18nConfig(i18n, normalizedFeatureName, includeFragment);
    const viewCode = renderXmlView({
      controllerName,
      fragmentName,
      titleKey: i18nConfig.titleKey,
      descriptionKey: i18nConfig.descriptionKey
    });
    const fragmentCode = includeFragment
      ? renderFragment({
        descriptionKey: i18nConfig.descriptionKey,
        actionKey: i18nConfig.actionKey,
        actionMethodName
      })
      : null;

    const preValidation = validateManifestStructure(currentManifest);
    if (!preValidation.valid) {
      throw new ToolError("Manifest pre-validation failed.", {
        code: "MANIFEST_PRE_VALIDATION_FAILED",
        details: preValidation
      });
    }

    const manifestSyncResult = synchronizeManifest(currentManifest, {
      routes: {
        upsert: [{
          name: routeName,
          pattern: routePattern,
          target: [targetName]
        }]
      },
      targets: {
        upsert: {
          [targetName]: routing?.targetDefinition ?? {
            viewName: normalizedFeatureName,
            viewType: "XML"
          }
        }
      }
    });

    const postValidation = validateManifestStructure(manifestSyncResult.manifest);
    if (!postValidation.valid) {
      throw new ToolError("Manifest post-validation failed after feature generation.", {
        code: "MANIFEST_POST_VALIDATION_FAILED",
        details: postValidation
      });
    }

    const currentI18n = await readOptionalTextFile(i18nPath, root);
    const i18nSyncResult = synchronizeI18nContent(currentI18n, i18nConfig.entries);
    const plannedWrites = [
      {
        path: controllerPath,
        role: "controller",
        content: controllerCode
      },
      {
        path: viewPath,
        role: "view",
        content: viewCode
      },
      ...(fragmentPath
        ? [{
          path: fragmentPath,
          role: "fragment",
          content: fragmentCode
        }]
        : []),
      {
        path: manifestTargetPath,
        role: "manifest",
        content: `${JSON.stringify(manifestSyncResult.manifest, null, 2)}\n`
      },
      {
        path: i18nPath,
        role: "i18n",
        content: i18nSyncResult.content
      }
    ];

    const previews = [];
    for (const write of plannedWrites) {
      const preview = await previewFileWrite(write.path, write.content, {
        root,
        maxDiffLines
      });

      if (!shouldAllowOverwrite && isScaffoldRole(write.role) && preview.existsBefore && preview.changed) {
        throw new ToolError(
          `Scaffold file already exists and differs: ${write.path}. Use allowOverwrite=true to replace it.`,
          {
            code: "FEATURE_FILE_EXISTS",
            details: {
              path: write.path
            }
          }
        );
      }

      previews.push({
        ...preview,
        role: write.role
      });
    }

    const changed = previews.some((preview) => preview.changed);
    const fileSummary = {
      created: previews.filter((preview) => !preview.existsBefore && preview.changed).length,
      updated: previews.filter((preview) => preview.existsBefore && preview.changed).length,
      unchanged: previews.filter((preview) => !preview.changed).length
    };

    let applyResult = null;
    if (!shouldDryRun && changed) {
      const applyChanges = plannedWrites.map((write) => {
        const matchingPreview = previews.find((preview) => preview.path === write.path);
        return {
          path: write.path,
          content: write.content,
          expectedOldHash: matchingPreview?.oldHash ?? undefined
        };
      });
      applyResult = await applyProjectPatch(applyChanges, {
        root,
        reason: reason ?? `generate_ui5_feature:${normalizedFeatureName}`
      });
    }

    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed,
      feature: {
        featureName: normalizedFeatureName,
        namespace: resolvedNamespace,
        routeName,
        routePattern,
        targetName,
        controllerName,
        fragmentName,
        paths: {
          controller: controllerPath,
          view: viewPath,
          fragment: fragmentPath,
          manifest: manifestTargetPath,
          i18n: i18nPath
        }
      },
      fileSummary,
      manifestValidation: {
        pre: preValidation,
        post: postValidation
      },
      manifestSummary: manifestSyncResult.summary,
      i18nSummary: i18nSyncResult.summary,
      previews: previews.map((preview) => ({
        path: preview.path,
        role: preview.role,
        existsBefore: preview.existsBefore,
        changed: preview.changed,
        oldHash: preview.oldHash,
        newHash: preview.newHash,
        lineSummary: preview.lineSummary,
        diffPreview: preview.diffPreview,
        diffTruncated: preview.diffTruncated
      })),
      applyResult
    });
  }
};

async function resolveManifestPath(manifestPath, root) {
  if (manifestPath) {
    return normalizeRelativePath(manifestPath);
  }

  const webappManifest = "webapp/manifest.json";
  if (await fileExists(webappManifest, root)) {
    return webappManifest;
  }

  const rootManifest = "manifest.json";
  if (await fileExists(rootManifest, root)) {
    return rootManifest;
  }

  throw new ToolError("No manifest.json found in workspace (checked webapp/manifest.json and manifest.json).", {
    code: "MANIFEST_NOT_FOUND"
  });
}

function resolveNamespace(namespace, manifest) {
  const resolved = namespace ?? manifest?.["sap.app"]?.id ?? "";
  if (!resolved.trim()) {
    throw new ToolError("Namespace is required (pass namespace or define sap.app.id in manifest).", {
      code: "NAMESPACE_REQUIRED"
    });
  }
  return resolved.trim();
}

function normalizeFeatureName(input) {
  const chunks = String(input)
    .split(/[^A-Za-z0-9]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (chunks.length === 0) {
    throw new ToolError("featureName must include alphanumeric characters.", {
      code: "INVALID_FEATURE_NAME"
    });
  }
  return chunks.map((value) => value.charAt(0).toUpperCase() + value.slice(1)).join("");
}

function toCamelCase(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function toKebabCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function normalizeRelativePath(input) {
  return input
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function joinPath(dir, fileName) {
  return `${dir}/${fileName}`.replace(/\/+/g, "/");
}

function normalizeMethods(methods) {
  return methods
    .map((name) => name.trim())
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

function renderController(controllerName, customMethods, eventMethodName) {
  const mergedMethods = Array.from(
    new Set([
      ...LIFECYCLE_METHODS,
      ...(eventMethodName ? [eventMethodName] : []),
      ...customMethods
    ])
  );

  return [
    "sap.ui.define([",
    "  \"sap/ui/core/mvc/Controller\"",
    "], function (Controller) {",
    "  \"use strict\";",
    "",
    `  return Controller.extend("${controllerName}", {`,
    ...mergedMethods.flatMap((methodName, index) => {
      const isLifecycle = LIFECYCLE_METHODS.includes(methodName);
      const isEventMethod = !isLifecycle;
      const block = [
        "    /**",
        `     * ${describeMethod(methodName)}`,
        ...(isEventMethod ? ["     * @param {sap.ui.base.Event} oEvent UI5 event object"] : []),
        "     */",
        ...(isEventMethod
          ? [
            `    ${methodName}: function (oEvent) {`,
            "      void oEvent;",
            "    }"
          ]
          : [
            `    ${methodName}: function () {`,
            "    }"
          ])
      ];

      if (index < mergedMethods.length - 1) {
        block[block.length - 1] += ",";
      }
      return block.concat("");
    }),
    "  });",
    "});",
    ""
  ].join("\n");
}

function describeMethod(name) {
  switch (name) {
    case "onInit":
      return "Lifecycle hook called when the controller is instantiated.";
    case "onBeforeRendering":
      return "Lifecycle hook called before the view is rendered.";
    case "onAfterRendering":
      return "Lifecycle hook called after the view is rendered.";
    case "onExit":
      return "Lifecycle hook called when the controller is destroyed.";
    default:
      return `Custom controller method: ${name}.`;
  }
}

function renderXmlView(config) {
  const { controllerName, fragmentName, titleKey, descriptionKey } = config;
  return [
    "<mvc:View",
    `  controllerName="${controllerName}"`,
    "  xmlns:mvc=\"sap.ui.core.mvc\"",
    "  xmlns=\"sap.m\"",
    "  xmlns:core=\"sap.ui.core\">",
    `  <Page title="{i18n>${titleKey}}">`,
    "    <content>",
    ...(fragmentName
      ? [`      <core:Fragment fragmentName="${fragmentName}" type="XML" />`]
      : [`      <Text text="{i18n>${descriptionKey}}" class="sapUiSmallMargin" />`]),
    "    </content>",
    "  </Page>",
    "</mvc:View>",
    ""
  ].join("\n");
}

function renderFragment(config) {
  const { descriptionKey, actionKey, actionMethodName } = config;
  return [
    "<core:FragmentDefinition xmlns=\"sap.m\" xmlns:core=\"sap.ui.core\">",
    "  <VBox class=\"sapUiSmallMargin\">",
    `    <Text text="{i18n>${descriptionKey}}" />`,
    `    <Button text="{i18n>${actionKey}}" press=".${actionMethodName}" class="sapUiTinyMarginTop" />`,
    "  </VBox>",
    "</core:FragmentDefinition>",
    ""
  ].join("\n");
}

function buildI18nConfig(i18n, normalizedFeatureName, includeFragment) {
  const featureKeyBase = `feature.${toCamelCase(normalizedFeatureName)}`;
  const label = toHumanLabel(normalizedFeatureName);
  const titleKey = i18n?.titleKey ?? `${featureKeyBase}.title`;
  const descriptionKey = i18n?.descriptionKey ?? `${featureKeyBase}.description`;
  const actionKey = i18n?.actionKey ?? `${featureKeyBase}.action`;
  const entries = {
    [titleKey]: i18n?.titleText ?? label,
    [descriptionKey]: i18n?.descriptionText ?? `${label} screen content`,
    ...(includeFragment ? { [actionKey]: i18n?.actionText ?? `Open ${label}` } : {}),
    ...(i18n?.entries ?? {})
  };

  return {
    titleKey,
    descriptionKey,
    actionKey,
    entries
  };
}

function toHumanLabel(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

function synchronizeI18nContent(currentContent, entries) {
  const lines = currentContent.length > 0 ? currentContent.replace(/\r/g, "").split("\n") : [];
  const keyToIndex = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseI18nLine(lines[index]);
    if (!parsed) {
      continue;
    }
    keyToIndex.set(parsed.key, index);
  }

  let keysAdded = 0;
  let keysUpdated = 0;
  let keysUnchanged = 0;
  const appendedLines = [];

  for (const [key, rawValue] of Object.entries(entries)) {
    const normalizedValue = escapeI18nValue(rawValue);
    const existingIndex = keyToIndex.get(key);
    if (existingIndex === undefined) {
      appendedLines.push(`${key}=${normalizedValue}`);
      keysAdded += 1;
      continue;
    }

    const currentLine = lines[existingIndex];
    const parsedLine = parseI18nLine(currentLine);
    if (parsedLine?.value === normalizedValue) {
      keysUnchanged += 1;
      continue;
    }

    lines[existingIndex] = `${key}=${normalizedValue}`;
    keysUpdated += 1;
  }

  if (appendedLines.length > 0 && lines.length > 0 && lines[lines.length - 1].trim().length > 0) {
    lines.push("");
  }
  lines.push(...appendedLines);

  const content = `${lines.join("\n")}`.replace(/\n?$/, "\n");
  return {
    content,
    summary: {
      keysAdded,
      keysUpdated,
      keysUnchanged
    }
  };
}

function parseI18nLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
    return null;
  }

  const separatorIndex = line.indexOf("=");
  if (separatorIndex < 1) {
    return null;
  }

  const key = line.slice(0, separatorIndex).trim();
  const value = line.slice(separatorIndex + 1).trim();
  if (!key) {
    return null;
  }

  return { key, value };
}

function escapeI18nValue(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n");
}

function isScaffoldRole(role) {
  return role === "controller" || role === "view" || role === "fragment";
}

async function readOptionalTextFile(filePath, root) {
  if (!(await fileExists(filePath, root))) {
    return "";
  }
  return readTextFile(filePath, root);
}
