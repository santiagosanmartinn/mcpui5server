import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readJsonFile, readTextFile } from "../../utils/fileSystem.js";
import { synchronizeManifest, validateManifestStructure } from "../../utils/manifestSync.js";
import { collectLegacyProjectIntakeTool } from "../agents/collectLegacyProjectIntake.js";
import { analyzeODataMetadataTool } from "./analyzeODataMetadata.js";

const DEFAULT_VIEW_DIR = "webapp/view";
const DEFAULT_CONTROLLER_DIR = "webapp/controller";
const DEFAULT_I18N_PATH = "webapp/i18n/i18n.properties";
const DEFAULT_INTAKE_PATH = ".codex/mcp/project/intake.json";

const intakeQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  why: z.string()
});

const inputSchema = z.object({
  entitySet: z.string().min(1),
  featureName: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
  manifestPath: z.string().min(1).optional(),
  modelName: z.string().optional(),
  dataSourceName: z.string().min(1).optional(),
  serviceUri: z.string().min(1).optional(),
  enforceIntakeContext: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  allowOverwrite: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional(),
  maxFields: z.number().int().min(2).max(12).optional(),
  metadataXml: z.string().min(20).optional(),
  metadataPath: z.string().min(1).optional(),
  metadataUrl: z.string().url().optional(),
  serviceUrl: z.string().url().optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  paths: z.object({
    viewDir: z.string().min(1).optional(),
    controllerDir: z.string().min(1).optional()
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
    searchPlaceholderKey: z.string().min(1).optional(),
    searchPlaceholderText: z.string().min(1).optional(),
    noDataKey: z.string().min(1).optional(),
    noDataText: z.string().min(1).optional(),
    entries: z.record(z.string()).optional()
  }).strict().optional()
}).strict().superRefine((value, ctx) => {
  const metadataSources = [
    value.metadataXml,
    value.metadataPath,
    value.metadataUrl,
    value.serviceUrl
  ].filter((item) => item !== undefined);

  if (metadataSources.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide one metadata source: metadataXml, metadataPath, metadataUrl, or serviceUrl."
    });
  }

  if (metadataSources.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide only one metadata source at a time."
    });
  }
});

const validationSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string())
});

const filePreviewSchema = z.object({
  path: z.string(),
  role: z.enum(["controller", "view", "manifest", "i18n"]),
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
    entitySet: z.string(),
    entityType: z.string(),
    namespace: z.string(),
    modelName: z.string(),
    dataSourceName: z.string(),
    routeName: z.string(),
    routePattern: z.string(),
    targetName: z.string(),
    controllerName: z.string(),
    paths: z.object({
      controller: z.string(),
      view: z.string(),
      manifest: z.string(),
      i18n: z.string()
    })
  }),
  contextGate: z.object({
    enforced: z.boolean(),
    ready: z.boolean(),
    intakePath: z.string(),
    intakeExists: z.boolean(),
    missingContext: z.array(z.string()),
    questions: z.array(intakeQuestionSchema)
  }),
  metadata: z.object({
    sourceMode: z.enum(["inline", "file", "url", "service"]),
    odataVersion: z.enum(["2.0", "4.0", "unknown"]),
    entityTypes: z.number().int().nonnegative(),
    entitySets: z.number().int().nonnegative()
  }),
  bindingPlan: z.object({
    keyField: z.string(),
    titleField: z.string(),
    descriptionField: z.string().nullable(),
    numberField: z.string().nullable(),
    selectedFields: z.array(z.string())
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
    dataSourceAdded: z.boolean(),
    dataSourceUpdated: z.boolean(),
    dataSourceUnchanged: z.boolean(),
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

export const scaffoldUi5ODataFeatureTool = {
  name: "scaffold_ui5_odata_feature",
  description: "Generate a base UI5 OData feature scaffold (view/controller/manifest/i18n) from service metadata with dry-run safety.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      entitySet,
      featureName,
      namespace,
      manifestPath,
      modelName,
      dataSourceName,
      serviceUri,
      enforceIntakeContext,
      dryRun,
      allowOverwrite,
      reason,
      maxDiffLines,
      maxFields,
      metadataXml,
      metadataPath,
      metadataUrl,
      serviceUrl,
      timeoutMs,
      paths,
      routing,
      i18n
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const shouldDryRun = dryRun ?? true;
    const shouldAllowOverwrite = allowOverwrite ?? false;
    const shouldEnforceIntakeContext = enforceIntakeContext ?? true;

    const contextGate = await resolveODataScaffoldContextGate({
      root,
      context,
      enforce: shouldEnforceIntakeContext
    });
    if (contextGate.enforced && !contextGate.ready) {
      throw new ToolError("OData scaffolding is blocked until project intake context is complete.", {
        code: "ODATA_CONTEXT_GATE_BLOCKED",
        details: {
          intakePath: contextGate.intakePath,
          missingContext: contextGate.missingContext,
          questions: contextGate.questions,
          nextActions: [
            "Run collect_legacy_project_intake and answer missing fields before scaffolding OData features.",
            "Optionally run prepare_legacy_project_for_ai to automate intake/baseline/context-index creation."
          ]
        }
      });
    }

    const metadata = await analyzeODataMetadataTool.handler(
      {
        metadataXml,
        metadataPath,
        metadataUrl,
        serviceUrl,
        timeoutMs
      },
      { context }
    );

    const selectedEntitySet = selectEntitySet(metadata.model.entitySets, entitySet);
    if (!selectedEntitySet.entityType) {
      throw new ToolError(`EntitySet ${entitySet} has no resolved entityType in metadata.`, {
        code: "ODATA_ENTITYSET_TYPE_MISSING"
      });
    }
    const selectedEntityType = selectEntityType(metadata.model.entityTypes, selectedEntitySet.entityType);
    const selectedFeatureName = normalizeFeatureName(featureName ?? selectedEntitySet.name);
    const manifestTargetPath = await resolveManifestPath(manifestPath, root);
    const currentManifest = await readJsonFile(manifestTargetPath, root);
    const resolvedNamespace = resolveNamespace(namespace, currentManifest);
    const resolvedModelName = modelName ?? "";
    const resolvedDataSourceName = dataSourceName ?? "mainService";
    const resolvedServiceUri = normalizeServiceUri(serviceUri ?? serviceUrl ?? metadata.source.metadataUrl ?? `/${resolvedDataSourceName}/`);
    const viewDir = normalizeRelativePath(paths?.viewDir ?? DEFAULT_VIEW_DIR);
    const controllerDir = normalizeRelativePath(paths?.controllerDir ?? DEFAULT_CONTROLLER_DIR);
    const i18nPath = normalizeRelativePath(i18n?.filePath ?? DEFAULT_I18N_PATH);
    const routeName = routing?.routeName ?? toCamelCase(selectedFeatureName);
    const routePattern = routing?.pattern ?? toKebabCase(selectedFeatureName);
    const targetName = routing?.targetName ?? selectedFeatureName;
    const controllerPath = joinPath(controllerDir, `${selectedFeatureName}.controller.js`);
    const viewPath = joinPath(viewDir, `${selectedFeatureName}.view.xml`);
    const controllerName = `${resolvedNamespace}.controller.${selectedFeatureName}`;

    const bindingPlan = buildBindingPlan(selectedEntityType, maxFields ?? 6);
    const i18nConfig = buildI18nConfig(i18n, selectedFeatureName, selectedEntitySet.name);
    const controllerCode = renderController(controllerName, bindingPlan);
    const viewCode = renderView({
      controllerName,
      modelName: resolvedModelName,
      entitySet: selectedEntitySet.name,
      bindingPlan,
      i18nConfig
    });

    const preValidation = validateManifestStructure(currentManifest);
    if (!preValidation.valid) {
      throw new ToolError("Manifest pre-validation failed.", {
        code: "MANIFEST_PRE_VALIDATION_FAILED",
        details: preValidation
      });
    }

    const dataSourceSync = synchronizeDataSource({
      manifest: currentManifest,
      dataSourceName: resolvedDataSourceName,
      serviceUri: resolvedServiceUri,
      odataVersion: metadata.protocol.odataVersion
    });
    const modelConfig = buildModelConfig({
      modelName: resolvedModelName,
      dataSourceName: resolvedDataSourceName,
      odataVersion: metadata.protocol.odataVersion
    });
    const manifestSyncResult = synchronizeManifest(dataSourceSync.manifest, {
      models: {
        upsert: {
          [resolvedModelName]: modelConfig
        }
      },
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
            viewName: selectedFeatureName,
            viewType: "XML"
          }
        }
      }
    });

    const postValidation = validateManifestStructure(manifestSyncResult.manifest);
    if (!postValidation.valid) {
      throw new ToolError("Manifest post-validation failed after OData scaffolding.", {
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
        reason: reason ?? `scaffold_ui5_odata_feature:${selectedFeatureName}`
      });
    }

    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed,
      feature: {
        featureName: selectedFeatureName,
        entitySet: selectedEntitySet.name,
        entityType: selectedEntityType.fullName,
        namespace: resolvedNamespace,
        modelName: resolvedModelName,
        dataSourceName: resolvedDataSourceName,
        routeName,
        routePattern,
        targetName,
        controllerName,
        paths: {
          controller: controllerPath,
          view: viewPath,
          manifest: manifestTargetPath,
          i18n: i18nPath
        }
      },
      contextGate,
      metadata: {
        sourceMode: metadata.source.mode,
        odataVersion: metadata.protocol.odataVersion,
        entityTypes: metadata.summary.entityTypesTotal,
        entitySets: metadata.summary.entitySets
      },
      bindingPlan,
      fileSummary,
      manifestValidation: {
        pre: preValidation,
        post: postValidation
      },
      manifestSummary: {
        dataSourceAdded: dataSourceSync.summary.added,
        dataSourceUpdated: dataSourceSync.summary.updated,
        dataSourceUnchanged: dataSourceSync.summary.unchanged,
        ...manifestSyncResult.summary
      },
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

async function resolveODataScaffoldContextGate(options) {
  const { root, context, enforce } = options;
  const intakeExists = await fileExists(DEFAULT_INTAKE_PATH, root);

  if (!enforce) {
    return {
      enforced: false,
      ready: true,
      intakePath: DEFAULT_INTAKE_PATH,
      intakeExists,
      missingContext: [],
      questions: []
    };
  }

  if (!intakeExists) {
    const intakeProbe = await collectLegacyProjectIntakeTool.handler(
      {
        dryRun: true,
        askForMissingContext: true
      },
      { context }
    );
    return {
      enforced: true,
      ready: false,
      intakePath: intakeProbe.intakePath,
      intakeExists: false,
      missingContext: intakeProbe.missingContext,
      questions: intakeProbe.questions
    };
  }

  let intakeJson;
  try {
    intakeJson = await readJsonFile(DEFAULT_INTAKE_PATH, root);
  } catch (error) {
    throw new ToolError(`Unable to read intake context at ${DEFAULT_INTAKE_PATH}: ${error.message}`, {
      code: "ODATA_CONTEXT_GATE_INVALID_INTAKE",
      details: {
        intakePath: DEFAULT_INTAKE_PATH
      }
    });
  }
  const missingContext = normalizeMissingContext(intakeJson?.missingContext);
  if (missingContext.length === 0) {
    return {
      enforced: true,
      ready: true,
      intakePath: DEFAULT_INTAKE_PATH,
      intakeExists: true,
      missingContext: [],
      questions: []
    };
  }

  const intakeProbe = await collectLegacyProjectIntakeTool.handler(
    {
      intakePath: DEFAULT_INTAKE_PATH,
      dryRun: true,
      askForMissingContext: true
    },
    { context }
  );
  return {
    enforced: true,
    ready: intakeProbe.missingContext.length === 0,
    intakePath: intakeProbe.intakePath,
    intakeExists: true,
    missingContext: intakeProbe.missingContext,
    questions: intakeProbe.questions
  };
}

function selectEntitySet(entitySets, requestedName) {
  const exact = entitySets.find((item) => item.name === requestedName);
  if (exact) {
    return exact;
  }

  const normalized = requestedName.toLowerCase();
  const fallback = entitySets.find((item) => item.name.toLowerCase() === normalized);
  if (fallback) {
    return fallback;
  }

  throw new ToolError(`EntitySet ${requestedName} not found in metadata.`, {
    code: "ODATA_ENTITYSET_NOT_FOUND"
  });
}

function selectEntityType(entityTypes, fullName) {
  const exact = entityTypes.find((item) => item.fullName === fullName);
  if (exact) {
    return exact;
  }

  const simpleName = fullName.split(".").pop();
  const fallback = entityTypes.find((item) => item.name === simpleName);
  if (fallback) {
    return fallback;
  }

  throw new ToolError(`EntityType ${fullName} not found in metadata.`, {
    code: "ODATA_ENTITYTYPE_NOT_FOUND"
  });
}

function buildBindingPlan(entityType, maxFields) {
  const properties = Array.isArray(entityType?.properties) ? entityType.properties : [];
  if (properties.length === 0) {
    throw new ToolError(`EntityType ${entityType?.fullName ?? ""} has no properties to scaffold bindings.`, {
      code: "ODATA_ENTITYTYPE_NO_PROPERTIES"
    });
  }

  const keyField = entityType.keys?.[0] ?? properties[0].name;
  const nonKey = properties.filter((item) => item.name !== keyField);
  const titleField = keyField;
  const descriptionField = nonKey.find((item) => isStringType(item.type))?.name ?? nonKey[0]?.name ?? null;
  const numberField = nonKey.find((item) => isNumericType(item.type))?.name ?? null;
  const selectedFields = unique([
    titleField,
    descriptionField,
    numberField,
    ...nonKey.map((item) => item.name)
  ]).filter(Boolean).slice(0, maxFields);

  return {
    keyField,
    titleField,
    descriptionField,
    numberField,
    selectedFields
  };
}

function renderController(controllerName, bindingPlan) {
  const filterFields = unique([bindingPlan.titleField, bindingPlan.descriptionField].filter(Boolean));
  const searchLogic = filterFields.length > 0
    ? [
      "      if (sQuery) {",
      `        aFilters.push(${filterFields.map((field) => `new Filter("${field}", FilterOperator.Contains, sQuery)`).join(", ")});`,
      "      }",
      "",
      "      oBinding.filter(aFilters.length > 0 ? [new Filter({ filters: aFilters, and: false })] : []);"
    ]
    : [
      "      if (!sQuery) {",
      "        oBinding.filter([]);",
      "      }"
    ];

  return [
    "sap.ui.define([",
    "  \"sap/ui/core/mvc/Controller\",",
    "  \"sap/ui/model/Filter\",",
    "  \"sap/ui/model/FilterOperator\"",
    "], function (Controller, Filter, FilterOperator) {",
    "  \"use strict\";",
    "",
    `  return Controller.extend("${controllerName}", {`,
    "    onInit: function () {",
    "    },",
    "",
    "    onSearch: function (oEvent) {",
    "      const sQuery = oEvent.getParameter(\"query\") || oEvent.getParameter(\"newValue\") || \"\";",
    "      const oList = this.byId(\"odataList\");",
    "      if (!oList) {",
    "        return;",
    "      }",
    "",
    "      const oBinding = oList.getBinding(\"items\");",
    "      if (!oBinding) {",
    "        return;",
    "      }",
    "",
    "      const aFilters = [];",
    ...searchLogic,
    "    },",
    "",
    "    onRefresh: function () {",
    "      const oList = this.byId(\"odataList\");",
    "      const oBinding = oList ? oList.getBinding(\"items\") : null;",
    "      if (oBinding) {",
    "        oBinding.refresh();",
    "      }",
    "    },",
    "",
    "    onItemPress: function () {",
    "    }",
    "  });",
    "});",
    ""
  ].join("\n");
}

function renderView(config) {
  const { controllerName, modelName, entitySet, bindingPlan, i18nConfig } = config;
  const listPath = bindingExpression(modelName, `/${entitySet}`);
  const title = bindingExpression(modelName, `/${bindingPlan.titleField}`);
  const description = bindingPlan.descriptionField
    ? bindingExpression(modelName, `/${bindingPlan.descriptionField}`)
    : "";
  const number = bindingPlan.numberField
    ? bindingExpression(modelName, `/${bindingPlan.numberField}`)
    : "";

  return [
    "<mvc:View",
    `  controllerName="${controllerName}"`,
    "  xmlns:mvc=\"sap.ui.core.mvc\"",
    "  xmlns=\"sap.m\">",
    `  <Page title="{i18n>${i18nConfig.titleKey}}">`,
    "    <subHeader>",
    "      <Toolbar>",
    `        <SearchField width="100%" search=".onSearch" placeholder="{i18n>${i18nConfig.searchPlaceholderKey}}" />`,
    "        <Button icon=\"sap-icon://refresh\" press=\".onRefresh\" />",
    "      </Toolbar>",
    "    </subHeader>",
    "    <content>",
    `      <List id="odataList" items="${listPath}" noDataText="{i18n>${i18nConfig.noDataKey}}" growing="true" growingScrollToLoad="true">`,
    "        <ObjectListItem",
    `          title="${title}"`,
    ...(description ? [`          intro="${description}"`] : []),
    ...(number ? [`          number="${number}"`] : []),
    "          type=\"Active\"",
    "          press=\".onItemPress\" />",
    "      </List>",
    "    </content>",
    "  </Page>",
    "</mvc:View>",
    ""
  ].join("\n");
}

function buildModelConfig(input) {
  const { dataSourceName, odataVersion } = input;
  const base = {
    dataSource: dataSourceName
  };
  if (odataVersion === "4.0") {
    return {
      ...base,
      type: "sap.ui.model.odata.v4.ODataModel",
      settings: {
        synchronizationMode: "None",
        operationMode: "Server",
        autoExpandSelect: true
      }
    };
  }

  return {
    ...base,
    type: "sap.ui.model.odata.v2.ODataModel",
    settings: {
      useBatch: true,
      defaultBindingMode: "TwoWay",
      defaultCountMode: "Inline"
    }
  };
}

function synchronizeDataSource(input) {
  const { manifest, dataSourceName, serviceUri, odataVersion } = input;
  const next = JSON.parse(JSON.stringify(manifest));
  if (!next["sap.app"] || typeof next["sap.app"] !== "object") {
    next["sap.app"] = {};
  }
  if (!next["sap.app"].dataSources || typeof next["sap.app"].dataSources !== "object") {
    next["sap.app"].dataSources = {};
  }

  const nextDataSource = {
    uri: serviceUri,
    type: "OData",
    settings: {
      odataVersion: odataVersion === "unknown" ? "2.0" : odataVersion
    }
  };

  const previous = next["sap.app"].dataSources[dataSourceName];
  const wasDefined = previous !== undefined;
  const isSame = wasDefined && JSON.stringify(previous) === JSON.stringify(nextDataSource);
  next["sap.app"].dataSources[dataSourceName] = nextDataSource;

  return {
    manifest: next,
    summary: {
      added: !wasDefined,
      updated: wasDefined && !isSame,
      unchanged: wasDefined && isSame
    }
  };
}

function buildI18nConfig(i18n, featureName, entitySet) {
  const base = `odata.${toCamelCase(featureName)}`;
  const titleKey = i18n?.titleKey ?? `${base}.title`;
  const searchPlaceholderKey = i18n?.searchPlaceholderKey ?? `${base}.searchPlaceholder`;
  const noDataKey = i18n?.noDataKey ?? `${base}.noData`;

  return {
    titleKey,
    searchPlaceholderKey,
    noDataKey,
    entries: {
      [titleKey]: i18n?.titleText ?? toHumanLabel(featureName),
      [searchPlaceholderKey]: i18n?.searchPlaceholderText ?? `Buscar en ${entitySet}`,
      [noDataKey]: i18n?.noDataText ?? `Sin datos para ${entitySet}`,
      ...(i18n?.entries ?? {})
    }
  };
}

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

function bindingExpression(modelName, path) {
  const safePath = String(path).replaceAll('"', "&quot;");
  if (!modelName) {
    return `{${safePath}}`;
  }
  return `{${modelName}>${safePath}}`;
}

function normalizeServiceUri(value) {
  const cleaned = String(value).trim();
  if (!cleaned) {
    return "/";
  }
  return cleaned;
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

function unique(values) {
  return Array.from(new Set(values));
}

function normalizeMissingContext(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return unique(
    value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
  );
}

function isScaffoldRole(role) {
  return role === "controller" || role === "view";
}

function isStringType(type) {
  return typeof type === "string" && /(String|Guid|Date|Time)/i.test(type);
}

function isNumericType(type) {
  return typeof type === "string" && /(Decimal|Int|Double|Single|Byte)/i.test(type);
}

function toHumanLabel(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

async function readOptionalTextFile(filePath, root) {
  if (!(await fileExists(filePath, root))) {
    return "";
  }
  return readTextFile(filePath, root);
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
