import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { analyzeUi5ProjectTool } from "../project/analyzeProject.js";
import {
  fileExists,
  isIgnoredWorkspaceDirectory,
  readJsonFile,
  readTextFile,
  resolveWorkspacePath
} from "../../utils/fileSystem.js";
import { analyzeUi5Xml } from "../../utils/xmlParser.js";
import { extractImports } from "../../utils/parser.js";
import { analyzeODataMetadataTool } from "./analyzeODataMetadata.js";
import { UI5_SYMBOL_CATALOG } from "./catalogs/ui5SymbolCatalog.js";

const DEFAULT_SOURCE_DIR = "webapp";
const DEFAULT_MAX_FILES = 1200;
const DEFAULT_MAX_FINDINGS = 600;
const DEFAULT_TIMEOUT_MS = 15000;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".mcp-backups", ".mcp-cache", "dist", "coverage"]);
const SOURCE_TYPES = ["auto", "javascript", "xml"];
const SPECIAL_MODEL_NAMES = new Set(["$this", "$source", "$parameters", "$count", "undefined", "null", "i18n", "device"]);

const inputSchema = z.object({
  code: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  sourceDir: z.string().min(1).optional(),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  manifestPath: z.string().min(1).optional(),
  ui5Version: z.string().regex(/^\d+\.\d+(\.\d+)?$/).optional(),
  metadataXml: z.string().min(20).optional(),
  metadataPath: z.string().min(1).optional(),
  metadataUrl: z.string().url().optional(),
  serviceUrl: z.string().url().optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  maxFindings: z.number().int().min(20).max(2000).optional()
}).strict().superRefine((value, ctx) => {
  const codeSources = [value.code, value.path, value.sourceDir].filter((item) => item !== undefined);
  if (codeSources.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide only one source: code, path, or sourceDir."
    });
  }

  const metadataSources = [
    value.metadataXml,
    value.metadataPath,
    value.metadataUrl,
    value.serviceUrl
  ].filter((item) => item !== undefined);

  if (metadataSources.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide only one metadata source: metadataXml, metadataPath, metadataUrl, or serviceUrl."
    });
  }
});

const findingSchema = z.object({
  rule: z.string(),
  severity: z.enum(["error", "warn", "info"]),
  category: z.enum(["manifest", "model", "binding", "request", "security", "metadata"]),
  file: z.string(),
  line: z.number().int().positive().nullable(),
  message: z.string(),
  suggestion: z.string(),
  reference: z.string().nullable()
});

const outputSchema = z.object({
  sourceMode: z.enum(["code", "file", "project"]),
  ui5Version: z.string().nullable(),
  manifest: z.object({
    path: z.string().nullable(),
    exists: z.boolean(),
    odataDataSources: z.number().int().nonnegative(),
    odataModels: z.number().int().nonnegative(),
    issues: z.number().int().nonnegative()
  }),
  metadata: z.object({
    provided: z.boolean(),
    sourceMode: z.enum(["none", "inline", "file", "url", "service"]),
    odataVersion: z.enum(["2.0", "4.0", "unknown"]).nullable(),
    entitySets: z.number().int().nonnegative(),
    entityTypes: z.number().int().nonnegative(),
    diagnostics: z.number().int().nonnegative()
  }),
  scanned: z.object({
    files: z.number().int().nonnegative(),
    xmlFiles: z.number().int().nonnegative(),
    jsFiles: z.number().int().nonnegative()
  }),
  summary: z.object({
    totalFindings: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    infos: z.number().int().nonnegative(),
    manifestIssues: z.number().int().nonnegative(),
    metadataMismatches: z.number().int().nonnegative(),
    securityIssues: z.number().int().nonnegative(),
    pass: z.boolean(),
    truncated: z.boolean()
  }),
  findings: z.array(findingSchema),
  references: z.array(
    z.object({
      title: z.string(),
      url: z.string()
    })
  )
});

export const validateUi5ODataUsageTool = {
  name: "validate_ui5_odata_usage",
  description: "Validate UI5 OData usage across manifest, XML/JS bindings, model APIs, and optional metadata cross-checks.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      code,
      path: filePath,
      sourceDir,
      sourceType,
      manifestPath,
      ui5Version,
      metadataXml,
      metadataPath,
      metadataUrl,
      serviceUrl,
      timeoutMs,
      maxFiles,
      maxFindings
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const selectedMaxFindings = maxFindings ?? DEFAULT_MAX_FINDINGS;
    const selectedTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const findings = [];
    const referencedEntitySets = [];
    const modelSymbols = new Set();

    const sourceMode = code ? "code" : filePath ? "file" : "project";
    const files = await resolveSourceFiles({
      root,
      code,
      filePath,
      sourceDir: sourceDir ?? DEFAULT_SOURCE_DIR,
      sourceType: sourceType ?? "auto",
      maxFiles: maxFiles ?? DEFAULT_MAX_FILES
    });

    const ui5VersionResolved = ui5Version ?? await detectUi5Version(root);
    const manifestReport = await analyzeManifest({
      root,
      manifestPath
    });
    findings.push(...manifestReport.findings);

    for (const model of manifestReport.odataModels) {
      if (model.type) {
        modelSymbols.add(model.type);
      }
    }

    let metadataReport = {
      provided: false,
      sourceMode: "none",
      odataVersion: null,
      entitySets: 0,
      entityTypes: 0,
      diagnostics: 0,
      entitySetNames: new Set()
    };

    if (metadataXml || metadataPath || metadataUrl || serviceUrl) {
      const metadata = await analyzeODataMetadataTool.handler(
        {
          metadataXml,
          metadataPath,
          metadataUrl,
          serviceUrl,
          timeoutMs: selectedTimeout
        },
        { context }
      );

      metadataReport = {
        provided: true,
        sourceMode: metadata.source.mode,
        odataVersion: metadata.protocol.odataVersion,
        entitySets: metadata.summary.entitySets,
        entityTypes: metadata.summary.entityTypesTotal,
        diagnostics: metadata.summary.diagnostics,
        entitySetNames: new Set(metadata.model.entitySets.map((item) => item.name))
      };

      findings.push(...crossCheckManifestAgainstMetadata({
        models: manifestReport.odataModels,
        metadataVersion: metadataReport.odataVersion
      }));
    } else if (manifestReport.odataModels.length > 0) {
      findings.push(createFinding({
        rule: "ODATA_METADATA_NOT_PROVIDED",
        severity: "info",
        category: "metadata",
        file: manifestReport.path ?? "__project__",
        message: "No OData metadata source provided; entity/path validation depth is limited.",
        suggestion: "Provide metadataXml, metadataPath, metadataUrl, or serviceUrl for strict path/entity validation.",
        reference: null
      }));
    }

    let xmlFiles = 0;
    let jsFiles = 0;

    for (const file of files) {
      if (file.type === "xml") {
        xmlFiles += 1;
        const xmlResult = analyzeXmlFile({
          content: file.content,
          filePath: file.path,
          knownModels: manifestReport.modelNames
        });
        findings.push(...xmlResult.findings);
        referencedEntitySets.push(...xmlResult.entitySetRefs);
      } else {
        jsFiles += 1;
        const jsResult = analyzeJavaScriptFile({
          code: file.content,
          filePath: file.path
        });
        findings.push(...jsResult.findings);
        referencedEntitySets.push(...jsResult.entitySetRefs);
        for (const symbol of jsResult.modelSymbols) {
          modelSymbols.add(symbol);
        }
      }
    }

    if (metadataReport.provided) {
      findings.push(...crossCheckEntitySetReferences({
        references: referencedEntitySets,
        metadataEntitySets: metadataReport.entitySetNames
      }));
    }

    findings.push(...checkModelSymbolCompatibility({
      symbols: Array.from(modelSymbols),
      ui5Version: ui5VersionResolved
    }));

    const dedupedFindings = dedupeFindings(findings);
    const truncated = dedupedFindings.length > selectedMaxFindings;
    const limitedFindings = dedupedFindings.slice(0, selectedMaxFindings);
    const summary = summarizeFindings(limitedFindings, truncated);

    return outputSchema.parse({
      sourceMode,
      ui5Version: ui5VersionResolved,
      manifest: {
        path: manifestReport.path,
        exists: manifestReport.exists,
        odataDataSources: manifestReport.odataDataSources.length,
        odataModels: manifestReport.odataModels.length,
        issues: manifestReport.findings.length
      },
      metadata: {
        provided: metadataReport.provided,
        sourceMode: metadataReport.sourceMode,
        odataVersion: metadataReport.odataVersion,
        entitySets: metadataReport.entitySets,
        entityTypes: metadataReport.entityTypes,
        diagnostics: metadataReport.diagnostics
      },
      scanned: {
        files: files.length,
        xmlFiles,
        jsFiles
      },
      summary,
      findings: limitedFindings,
      references: collectReferences(limitedFindings)
    });
  }
};

async function resolveSourceFiles(input) {
  const {
    root,
    code,
    filePath,
    sourceDir,
    sourceType,
    maxFiles
  } = input;

  if (code) {
    return [{
      path: "__inline__",
      type: resolveSourceType(code, sourceType),
      content: code
    }];
  }

  if (filePath) {
    const content = await readTextFile(filePath, root);
    return [{
      path: normalizePath(filePath),
      type: resolveSourceType(content, sourceType),
      content
    }];
  }

  const selectedSourceDir = normalizePath(sourceDir);
  const sourceAbsolute = resolveWorkspacePath(selectedSourceDir, root);
  const files = [];
  await walk(sourceAbsolute);
  return files.sort((a, b) => a.path.localeCompare(b.path));

  async function walk(currentDir) {
    if (files.length >= maxFiles) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        break;
      }
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const relativePath = path.relative(path.resolve(root), absolutePath).replaceAll("\\", "/");
        if (isIgnoredWorkspaceDirectory(entry.name, relativePath, IGNORED_DIRS)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (extension !== ".xml" && extension !== ".js") {
        continue;
      }

      const relativePath = path.relative(path.resolve(root), absolutePath).replaceAll("\\", "/");
      const content = await readTextFile(relativePath, root);
      files.push({
        path: relativePath,
        type: extension === ".xml" ? "xml" : "javascript",
        content
      });
    }
  }
}

async function analyzeManifest(input) {
  const { root, manifestPath } = input;
  const resolvedPath = manifestPath
    ? normalizePath(manifestPath)
    : await resolveDefaultManifestPath(root);

  if (!resolvedPath) {
    return {
      path: null,
      exists: false,
      odataDataSources: [],
      odataModels: [],
      modelNames: new Set(),
      findings: [createFinding({
        rule: "ODATA_MANIFEST_NOT_FOUND",
        severity: "warn",
        category: "manifest",
        file: "__project__",
        message: "manifest.json was not found; OData model validation is limited.",
        suggestion: "Ensure the project exposes webapp/manifest.json or provide manifestPath explicitly.",
        reference: null
      })]
    };
  }

  const manifest = await readJsonFile(resolvedPath, root);
  const findings = [];
  const dataSources = manifest?.["sap.app"]?.dataSources ?? {};
  const models = manifest?.["sap.ui5"]?.models ?? {};

  const odataDataSources = Object.entries(dataSources)
    .map(([name, config]) => ({
      name,
      uri: typeof config?.uri === "string" ? config.uri : null,
      type: normalizeLower(config?.type),
      odataVersion: normalizeODataVersion(config?.settings?.odataVersion)
    }))
    .filter((item) => item.type === "odata");

  for (const dataSource of odataDataSources) {
    if (!dataSource.uri) {
      findings.push(createFinding({
        rule: "ODATA_DATASOURCE_URI_MISSING",
        severity: "error",
        category: "manifest",
        file: resolvedPath,
        message: `OData dataSource "${dataSource.name}" is missing uri.`,
        suggestion: "Declare a valid dataSource.uri for each OData service in sap.app.dataSources.",
        reference: "https://ui5.sap.com/#/topic/be0cf40f61184b358b5faedaec98b2da"
      }));
    } else if (/^http:\/\//i.test(dataSource.uri)) {
      findings.push(createFinding({
        rule: "ODATA_DATASOURCE_INSECURE_HTTP",
        severity: "warn",
        category: "security",
        file: resolvedPath,
        message: `OData dataSource "${dataSource.name}" uses insecure http URI.`,
        suggestion: "Use HTTPS or destination/proxy configuration for productive environments.",
        reference: null
      }));
    }

    if (!dataSource.odataVersion) {
      findings.push(createFinding({
        rule: "ODATA_DATASOURCE_VERSION_MISSING",
        severity: "warn",
        category: "manifest",
        file: resolvedPath,
        message: `OData dataSource "${dataSource.name}" does not declare settings.odataVersion.`,
        suggestion: "Set settings.odataVersion explicitly to 2.0 or 4.0 for deterministic runtime behavior.",
        reference: null
      }));
    }
  }

  const odataDataSourceNames = new Set(odataDataSources.map((item) => item.name));
  const odataModels = [];
  for (const [name, config] of Object.entries(models)) {
    const modelType = typeof config?.type === "string" ? config.type : null;
    const dataSource = typeof config?.dataSource === "string" ? config.dataSource : null;
    const inferredByType = inferODataVersionFromModelType(modelType);
    const versionFromModelSettings = normalizeODataVersion(config?.settings?.odataVersion);
    const versionFromDataSource = dataSource
      ? odataDataSources.find((item) => item.name === dataSource)?.odataVersion ?? null
      : null;
    const resolvedVersion = versionFromModelSettings ?? versionFromDataSource;
    const isOData = isODataModelType(modelType) || (dataSource ? odataDataSourceNames.has(dataSource) : false);

    if (!isOData) {
      continue;
    }

    const model = {
      name,
      type: modelType,
      dataSource,
      odataVersion: resolvedVersion,
      inferredVersionFromType: inferredByType
    };
    odataModels.push(model);

    if (!dataSource) {
      findings.push(createFinding({
        rule: "ODATA_MODEL_DATASOURCE_MISSING",
        severity: "warn",
        category: "manifest",
        file: resolvedPath,
        message: `Model ${formatModelName(name)} looks like OData but dataSource is missing.`,
        suggestion: "Bind OData models to a sap.app.dataSources entry for stable service configuration.",
        reference: null
      }));
    } else if (!odataDataSourceNames.has(dataSource)) {
      findings.push(createFinding({
        rule: "ODATA_MODEL_DATASOURCE_UNKNOWN",
        severity: "error",
        category: "manifest",
        file: resolvedPath,
        message: `Model ${formatModelName(name)} references unknown or non-OData dataSource "${dataSource}".`,
        suggestion: "Create the dataSource in sap.app.dataSources with type OData and link the model to it.",
        reference: null
      }));
    }

    if (modelType === "sap.ui.model.odata.ODataModel") {
      findings.push(createFinding({
        rule: "ODATA_MODEL_LEGACY_TYPE",
        severity: "warn",
        category: "model",
        file: resolvedPath,
        message: `Model ${formatModelName(name)} uses legacy sap.ui.model.odata.ODataModel.`,
        suggestion: "Prefer sap.ui.model.odata.v2.ODataModel or sap.ui.model.odata.v4.ODataModel.",
        reference: "https://ui5.sap.com/#/api/sap.ui.model.odata.v2.ODataModel"
      }));
    }

    if (!resolvedVersion) {
      findings.push(createFinding({
        rule: "ODATA_MODEL_VERSION_MISSING",
        severity: "warn",
        category: "manifest",
        file: resolvedPath,
        message: `Model ${formatModelName(name)} does not resolve an OData version.`,
        suggestion: "Set settings.odataVersion on model or dataSource.",
        reference: null
      }));
    }

    if (inferredByType && resolvedVersion && inferredByType !== resolvedVersion) {
      findings.push(createFinding({
        rule: "ODATA_MANIFEST_MODEL_VERSION_MISMATCH",
        severity: "error",
        category: "manifest",
        file: resolvedPath,
        message: `Model ${formatModelName(name)} type/version mismatch (type implies ${inferredByType}, config declares ${resolvedVersion}).`,
        suggestion: "Align model type and odataVersion to the same protocol generation.",
        reference: null
      }));
    }

    if (modelType === "sap.ui.model.odata.v4.ODataModel") {
      const synchronizationMode = config?.settings?.synchronizationMode;
      if (synchronizationMode && synchronizationMode !== "None") {
        findings.push(createFinding({
          rule: "ODATA_V4_SYNCHRONIZATION_MODE",
          severity: "warn",
          category: "model",
          file: resolvedPath,
          message: `Model ${formatModelName(name)} sets synchronizationMode="${synchronizationMode}".`,
          suggestion: "Use synchronizationMode=\"None\" for sap.ui.model.odata.v4.ODataModel.",
          reference: "https://ui5.sap.com/#/api/sap.ui.model.odata.v4.ODataModel"
        }));
      }
    }
  }

  if (odataDataSources.length > 0 && odataModels.length === 0) {
    findings.push(createFinding({
      rule: "ODATA_DATASOURCES_WITHOUT_MODELS",
      severity: "warn",
      category: "manifest",
      file: resolvedPath,
      message: "OData dataSources exist but no OData model is declared in sap.ui5.models.",
      suggestion: "Declare an OData model and link it to the intended OData dataSource.",
      reference: null
    }));
  }

  return {
    path: resolvedPath,
    exists: true,
    odataDataSources,
    odataModels,
    modelNames: new Set(Object.keys(models)),
    findings
  };
}

function analyzeXmlFile(input) {
  const {
    content,
    filePath,
    knownModels
  } = input;
  const findings = [];
  const entitySetRefs = [];

  let xml;
  try {
    xml = analyzeUi5Xml(content);
  } catch (error) {
    return {
      findings: [createFinding({
        rule: "ODATA_XML_PARSE_FAILED",
        severity: "warn",
        category: "binding",
        file: filePath,
        line: Number.isInteger(error?.details?.line) ? error.details.line : null,
        message: `XML analysis failed: ${error.message}`,
        suggestion: "Fix malformed XML before running OData usage validation.",
        reference: null
      })],
      entitySetRefs
    };
  }

  for (const binding of xml.bindings) {
    const line = binding.expression ? findLine(content, binding.expression) : null;
    const entitySet = extractEntitySetFromPath(binding.bindingPath);
    if (entitySet && binding.model && !isSpecialModelName(binding.model) && !knownModels.has(binding.model)) {
      findings.push(createFinding({
        rule: "ODATA_BINDING_MODEL_UNKNOWN",
        severity: "warn",
        category: "binding",
        file: filePath,
        line,
        message: `Binding uses unknown model "${binding.model}".`,
        suggestion: "Ensure the model is declared in sap.ui5.models and loaded before view rendering.",
        reference: null
      }));
    }
    if (entitySet) {
      entitySetRefs.push({
        entitySet,
        file: filePath,
        line
      });
    }
  }

  return {
    findings,
    entitySetRefs
  };
}

function analyzeJavaScriptFile(input) {
  const {
    code,
    filePath
  } = input;
  const findings = [];
  const entitySetRefs = [];
  const modelSymbols = new Set();
  const imports = extractImports(code);
  const modules = [...imports.esmImports, ...imports.sapUiDefineDependencies];
  const importedV2 = modules.includes("sap/ui/model/odata/v2/ODataModel");
  const importedV4 = modules.includes("sap/ui/model/odata/v4/ODataModel");

  for (const modulePath of modules) {
    if (!modulePath.startsWith("sap/ui/model/odata")) {
      continue;
    }

    const symbol = modulePath.replaceAll("/", ".");
    modelSymbols.add(symbol);

    if (modulePath === "sap/ui/model/odata/ODataModel") {
      findings.push(createFinding({
        rule: "ODATA_JS_LEGACY_MODEL_IMPORT",
        severity: "warn",
        category: "model",
        file: filePath,
        line: findLine(code, modulePath),
        message: "Legacy ODataModel import detected (sap/ui/model/odata/ODataModel).",
        suggestion: "Prefer v2 or v4 model modules explicitly.",
        reference: "https://ui5.sap.com/#/api/sap.ui.model.odata.v2.ODataModel"
      }));
    }
  }

  if (importedV2 && importedV4) {
    findings.push(createFinding({
      rule: "ODATA_JS_MIXED_V2_V4_MODELS",
      severity: "warn",
      category: "model",
      file: filePath,
      line: null,
      message: "Both OData V2 and V4 model modules are imported in the same file.",
      suggestion: "Avoid mixing V2 and V4 APIs in the same implementation unit unless strictly needed.",
      reference: null
    }));
  }

  const operationRegex = /\.(read|create|update|remove|bindList|bindContext)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  let operationMatch = operationRegex.exec(code);
  while (operationMatch) {
    const method = operationMatch[1];
    const pathValue = operationMatch[2];
    const line = findLineByIndex(code, operationMatch.index);
    const entitySet = extractEntitySetFromPath(pathValue);
    if (entitySet) {
      entitySetRefs.push({
        entitySet,
        file: filePath,
        line
      });
    }

    if (["read", "create", "update", "remove"].includes(method) && !pathValue.startsWith("/")) {
      findings.push(createFinding({
        rule: "ODATA_JS_RELATIVE_ENTITY_PATH",
        severity: "info",
        category: "request",
        file: filePath,
        line,
        message: `Method ${method} uses relative path "${pathValue}".`,
        suggestion: "Prefer absolute entity paths (/EntitySet(...)) unless a binding context is intentionally used.",
        reference: null
      }));
    }
    operationMatch = operationRegex.exec(code);
  }

  const batchRegex = /setUseBatch\s*\(\s*false\s*\)/g;
  let batchMatch = batchRegex.exec(code);
  while (batchMatch) {
    findings.push(createFinding({
      rule: "ODATA_JS_BATCH_DISABLED",
      severity: "warn",
      category: "request",
      file: filePath,
      line: findLineByIndex(code, batchMatch.index),
      message: "setUseBatch(false) detected.",
      suggestion: "Use batched requests when possible to reduce OData roundtrips.",
      reference: null
    }));
    batchMatch = batchRegex.exec(code);
  }

  const directHttpRegex = /(?:\$\.(?:ajax|get|post)|fetch)\s*\(/g;
  let directMatch = directHttpRegex.exec(code);
  while (directMatch) {
    const window = code.slice(directMatch.index, directMatch.index + 260);
    if (/(\/sap\/opu\/odata|\/odata\/|\$metadata)/i.test(window)) {
      findings.push(createFinding({
        rule: "ODATA_JS_DIRECT_HTTP_CALL",
        severity: "warn",
        category: "request",
        file: filePath,
        line: findLineByIndex(code, directMatch.index),
        message: "Direct HTTP call to an OData endpoint detected.",
        suggestion: "Prefer ODataModel APIs to keep batching, CSRF handling, and model state consistent.",
        reference: null
      }));
    }
    directMatch = directHttpRegex.exec(code);
  }

  const lines = code.replace(/\r/g, "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index];
    if (!lineText.includes("$filter=")) {
      continue;
    }
    if (lineText.includes("+") || lineText.includes("${")) {
      findings.push(createFinding({
        rule: "ODATA_JS_UNSAFE_FILTER_BUILDING",
        severity: "warn",
        category: "security",
        file: filePath,
        line: index + 1,
        message: "Potential unsafe $filter string concatenation detected.",
        suggestion: "Encode user input and centralize filter construction to avoid injection-like query issues.",
        reference: null
      }));
    }
  }

  return {
    findings,
    entitySetRefs,
    modelSymbols
  };
}

function crossCheckManifestAgainstMetadata(input) {
  const { models, metadataVersion } = input;
  if (!metadataVersion || metadataVersion === "unknown") {
    return [];
  }

  const findings = [];
  for (const model of models) {
    if (!model.odataVersion) {
      continue;
    }
    if (model.odataVersion !== metadataVersion) {
      findings.push(createFinding({
        rule: "ODATA_MODEL_METADATA_VERSION_MISMATCH",
        severity: "error",
        category: "metadata",
        file: "__manifest__",
        message: `Model ${formatModelName(model.name)} resolves OData ${model.odataVersion}, metadata reports ${metadataVersion}.`,
        suggestion: "Align manifest model/dataSource OData version with target service metadata protocol.",
        reference: null
      }));
    }
  }
  return findings;
}

function crossCheckEntitySetReferences(input) {
  const { references, metadataEntitySets } = input;
  if (metadataEntitySets.size === 0) {
    return [];
  }

  const findings = [];
  for (const reference of references) {
    if (metadataEntitySets.has(reference.entitySet)) {
      continue;
    }
    findings.push(createFinding({
      rule: "ODATA_METADATA_ENTITYSET_UNKNOWN",
      severity: "error",
      category: "metadata",
      file: reference.file,
      line: reference.line,
      message: `Entity set "${reference.entitySet}" is not present in provided metadata.`,
      suggestion: "Use entity sets defined in service metadata or refresh metadata source if service changed.",
      reference: null
    }));
  }
  return findings;
}

function checkModelSymbolCompatibility(input) {
  const { symbols, ui5Version } = input;
  if (!ui5Version) {
    return [];
  }

  const findings = [];
  for (const symbol of symbols) {
    if (!symbol.startsWith("sap.ui.model.odata")) {
      continue;
    }
    const entry = UI5_SYMBOL_CATALOG[symbol];
    if (!entry) {
      findings.push(createFinding({
        rule: "ODATA_MODEL_UI5_VERSION_UNVERIFIED",
        severity: "info",
        category: "model",
        file: "__project__",
        message: `Model symbol ${symbol} is not covered by local UI5 catalog for version validation.`,
        suggestion: "Keep local UI5 symbol catalog updated to enforce strict version checks.",
        reference: toUi5Reference(symbol)
      }));
      continue;
    }

    const compatible = compareUi5Versions(ui5Version, entry.introducedIn) >= 0;
    if (!compatible) {
      findings.push(createFinding({
        rule: "ODATA_MODEL_UI5_VERSION_INCOMPATIBLE",
        severity: "error",
        category: "model",
        file: "__project__",
        message: `${symbol} requires at least UI5 ${entry.introducedIn}, current project is ${ui5Version}.`,
        suggestion: "Downgrade model usage or increase project UI5 version.",
        reference: toUi5Reference(symbol)
      }));
    }
  }
  return findings;
}

async function detectUi5Version(root) {
  try {
    const analysis = await analyzeUi5ProjectTool.handler({}, {
      context: { rootDir: root }
    });
    return analysis.ui5Version ?? null;
  } catch {
    return null;
  }
}

async function resolveDefaultManifestPath(root) {
  if (await fileExists("webapp/manifest.json", root)) {
    return "webapp/manifest.json";
  }
  if (await fileExists("manifest.json", root)) {
    return "manifest.json";
  }
  return null;
}

function extractEntitySetFromPath(bindingPath) {
  if (!bindingPath || typeof bindingPath !== "string") {
    return null;
  }

  const normalized = bindingPath.trim();
  if (!normalized.startsWith("/")) {
    return null;
  }

  const sanitized = normalized.slice(1).split("?")[0];
  if (!sanitized) {
    return null;
  }

  const firstSegment = sanitized.split("/")[0];
  if (!firstSegment) {
    return null;
  }

  const cleaned = firstSegment.replace(/\(.*/, "");
  if (!cleaned) {
    return null;
  }

  return cleaned;
}

function resolveSourceType(content, sourceType) {
  if (sourceType === "javascript" || sourceType === "xml") {
    return sourceType;
  }
  return content.trimStart().startsWith("<") ? "xml" : "javascript";
}

function summarizeFindings(findings, truncated) {
  const summary = {
    totalFindings: findings.length,
    errors: 0,
    warnings: 0,
    infos: 0,
    manifestIssues: 0,
    metadataMismatches: 0,
    securityIssues: 0,
    pass: true,
    truncated
  };

  for (const finding of findings) {
    if (finding.severity === "error") {
      summary.errors += 1;
      summary.pass = false;
    } else if (finding.severity === "warn") {
      summary.warnings += 1;
    } else {
      summary.infos += 1;
    }

    if (finding.category === "manifest") {
      summary.manifestIssues += 1;
    }
    if (finding.category === "metadata") {
      summary.metadataMismatches += 1;
    }
    if (finding.category === "security") {
      summary.securityIssues += 1;
    }
  }

  return summary;
}

function collectReferences(findings) {
  const map = new Map();
  for (const finding of findings) {
    if (!finding.reference) {
      continue;
    }
    map.set(finding.reference, {
      title: `Reference: ${finding.rule}`,
      url: finding.reference
    });
  }
  return Array.from(map.values());
}

function createFinding(input) {
  return findingSchema.parse({
    line: input.line ?? null,
    ...input
  });
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeLower(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function normalizeODataVersion(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("4")) {
    return "4.0";
  }
  if (normalized.startsWith("2")) {
    return "2.0";
  }
  return null;
}

function isODataModelType(value) {
  if (typeof value !== "string") {
    return false;
  }
  return value.startsWith("sap.ui.model.odata");
}

function inferODataVersionFromModelType(modelType) {
  if (modelType === "sap.ui.model.odata.v2.ODataModel") {
    return "2.0";
  }
  if (modelType === "sap.ui.model.odata.v4.ODataModel") {
    return "4.0";
  }
  return null;
}

function formatModelName(name) {
  if (!name) {
    return "<default>";
  }
  return `"${name}"`;
}

function isSpecialModelName(name) {
  if (!name) {
    return false;
  }
  return SPECIAL_MODEL_NAMES.has(String(name).trim());
}

function compareUi5Versions(a, b) {
  const left = normalizeVersion(a).split(".").map((part) => Number.parseInt(part, 10));
  const right = normalizeVersion(b).split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < 3; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function normalizeVersion(version) {
  const clean = String(version).trim();
  const parts = clean.split(".");
  if (parts.length === 2) {
    return `${parts[0]}.${parts[1]}.0`;
  }
  if (parts.length >= 3) {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  return `${parts[0] ?? "0"}.0.0`;
}

function toUi5Reference(symbol) {
  return `https://ui5.sap.com/#/api/${encodeURIComponent(symbol)}`;
}

function dedupeFindings(findings) {
  const seen = new Set();
  const deduped = [];
  for (const finding of findings) {
    const key = [
      finding.rule,
      finding.severity,
      finding.category,
      finding.file,
      finding.line ?? 0,
      finding.message
    ].join("::");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

function findLine(content, fragment) {
  const index = content.indexOf(fragment);
  if (index < 0) {
    return null;
  }
  return findLineByIndex(content, index);
}

function findLineByIndex(content, index) {
  if (index < 0) {
    return null;
  }
  return content.slice(0, index).split(/\r?\n/).length;
}
