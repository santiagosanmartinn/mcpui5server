import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { fileExists, isIgnoredWorkspaceDirectory, readJsonFile, readTextFile, resolveWorkspacePath } from "../../utils/fileSystem.js";
import { analyzeUi5Xml } from "../../utils/xmlParser.js";
import { getSapOfficialRefsForRule } from "../documentation/sapOfficialDocs.js";
import { analyzeCapServiceSurfaceTool } from "./analyzeServiceSurface.js";

const inputSchema = z.object({
  capSourceDir: z.string().min(1).optional(),
  ui5SourceDir: z.string().min(1).optional(),
  manifestPath: z.string().min(1).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  maxFindings: z.number().int().min(10).max(2000).optional()
}).strict();

const officialRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  product: z.enum(["cap", "ui5"]),
  topic: z.string()
});

const findingSchema = z.object({
  rule: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  category: z.enum(["manifest", "binding", "service", "version"]),
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  target: z.string().nullable(),
  message: z.string(),
  suggestion: z.string(),
  officialRefs: z.array(officialRefSchema)
});

const outputSchema = z.object({
  capSourceDir: z.string(),
  ui5SourceDir: z.string(),
  pass: z.boolean(),
  scanned: z.object({
    ui5Files: z.number().int().nonnegative(),
    xmlFiles: z.number().int().nonnegative(),
    jsFiles: z.number().int().nonnegative()
  }),
  manifest: z.object({
    path: z.string().nullable(),
    exists: z.boolean(),
    odataDataSources: z.array(z.object({
      name: z.string(),
      uri: z.string().nullable(),
      odataVersion: z.string().nullable(),
      matchedCapService: z.string().nullable()
    })),
    odataModels: z.array(z.object({
      name: z.string(),
      dataSource: z.string().nullable(),
      type: z.string().nullable(),
      odataVersion: z.string().nullable()
    }))
  }),
  cap: z.object({
    services: z.number().int().nonnegative(),
    entitySets: z.array(z.string()),
    servicePaths: z.array(z.string())
  }),
  usage: z.object({
    referencedEntitySets: z.array(z.object({
      entitySet: z.string(),
      file: z.string(),
      line: z.number().int().positive().nullable()
    })),
    referencedModels: z.array(z.string())
  }),
  summary: z.object({
    totalFindings: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
    unmatchedDataSources: z.number().int().nonnegative(),
    unknownEntitySets: z.number().int().nonnegative(),
    truncated: z.boolean()
  }),
  findings: z.array(findingSchema),
  recommendedCommands: z.array(z.string())
});

export const validateUi5CapContractAlignmentTool = {
  name: "validate_ui5_cap_contract_alignment",
  description: "Validate UI5 manifest/bindings against the local SAP CAP service surface before coding or refactoring.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { capSourceDir, ui5SourceDir, manifestPath, maxFiles, maxFindings } = inputSchema.parse(args);
    const selectedUi5SourceDir = normalizePath(ui5SourceDir ?? "webapp");
    const capSurface = await analyzeCapServiceSurfaceTool.handler({
      sourceDir: capSourceDir,
      maxFiles,
      maxFindings
    }, { context });
    const manifest = await analyzeManifest({
      root: context.rootDir,
      manifestPath
    });
    const ui5Files = await readUi5SourceFiles({
      root: context.rootDir,
      sourceDir: selectedUi5SourceDir,
      maxFiles: maxFiles ?? 1200
    });
    const usage = collectUsage(ui5Files);
    const capEntitySets = new Set(capSurface.services.flatMap((service) => service.entitySets.map((entitySet) => entitySet.name)));
    const capServicePaths = capSurface.services.map((service) => service.odataPath);
    const findings = [
      ...validateManifest({ manifest, capSurface }),
      ...validateUsage({ usage, capEntitySets, manifest })
    ];
    const effectiveMaxFindings = maxFindings ?? 300;
    const truncated = findings.length > effectiveMaxFindings;
    const limitedFindings = findings.slice(0, effectiveMaxFindings);
    const summary = summarizeFindings(limitedFindings, truncated);

    return outputSchema.parse({
      capSourceDir: capSurface.sourceDir,
      ui5SourceDir: selectedUi5SourceDir,
      pass: summary.high === 0,
      scanned: {
        ui5Files: ui5Files.length,
        xmlFiles: ui5Files.filter((file) => file.type === "xml").length,
        jsFiles: ui5Files.filter((file) => file.type === "js").length
      },
      manifest: {
        path: manifest.path,
        exists: manifest.exists,
        odataDataSources: manifest.odataDataSources.map((dataSource) => ({
          ...dataSource,
          matchedCapService: matchCapService(dataSource.uri, capSurface.services)?.name ?? null
        })),
        odataModels: manifest.odataModels
      },
      cap: {
        services: capSurface.services.length,
        entitySets: Array.from(capEntitySets).sort((a, b) => a.localeCompare(b)),
        servicePaths: capServicePaths
      },
      usage: {
        referencedEntitySets: usage.referencedEntitySets,
        referencedModels: Array.from(usage.referencedModels).sort((a, b) => a.localeCompare(b))
      },
      summary,
      findings: limitedFindings,
      recommendedCommands: [
        "npx cds compile srv --to edmx",
        "npm test",
        "npm run lint"
      ]
    });
  }
};

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
      odataModels: []
    };
  }
  const manifest = await readJsonFile(resolvedPath, root);
  const dataSources = manifest?.["sap.app"]?.dataSources ?? {};
  const models = manifest?.["sap.ui5"]?.models ?? {};
  const odataDataSources = Object.entries(dataSources)
    .map(([name, config]) => ({
      name,
      uri: typeof config?.uri === "string" ? config.uri : null,
      type: typeof config?.type === "string" ? config.type.toLowerCase() : null,
      odataVersion: normalizeODataVersion(config?.settings?.odataVersion)
    }))
    .filter((item) => item.type === "odata")
    .map(({ name, uri, odataVersion }) => ({ name, uri, odataVersion }));
  const dataSourceNames = new Set(odataDataSources.map((item) => item.name));
  const odataModels = Object.entries(models)
    .map(([name, config]) => ({
      name,
      dataSource: typeof config?.dataSource === "string" ? config.dataSource : null,
      type: typeof config?.type === "string" ? config.type : null,
      odataVersion: normalizeODataVersion(config?.settings?.odataVersion)
    }))
    .filter((model) => model.type?.startsWith("sap.ui.model.odata") || (model.dataSource && dataSourceNames.has(model.dataSource)));
  return {
    path: resolvedPath,
    exists: true,
    odataDataSources,
    odataModels
  };
}

async function readUi5SourceFiles(input) {
  const { root, sourceDir, maxFiles } = input;
  if (!await fileExists(sourceDir, root)) {
    return [];
  }
  const resolvedRoot = path.resolve(root);
  const sourceAbsolute = resolveWorkspacePath(sourceDir, root);
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
      const relativePath = path.relative(resolvedRoot, absolutePath).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (isIgnoredWorkspaceDirectory(entry.name, relativePath)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (extension !== ".xml" && extension !== ".js") {
        continue;
      }
      files.push({
        path: relativePath,
        type: extension.slice(1),
        content: await readTextFile(relativePath, root)
      });
    }
  }
}

function collectUsage(files) {
  const referencedEntitySets = [];
  const referencedModels = new Set();
  for (const file of files) {
    if (file.type === "xml") {
      collectXmlUsage(file, referencedEntitySets, referencedModels);
    } else {
      collectJsUsage(file, referencedEntitySets);
    }
  }
  return {
    referencedEntitySets,
    referencedModels
  };
}

function collectXmlUsage(file, referencedEntitySets, referencedModels) {
  let xml;
  try {
    xml = analyzeUi5Xml(file.content);
  } catch {
    return;
  }
  for (const binding of xml.bindings) {
    if (binding.model) {
      referencedModels.add(binding.model);
    }
    const entitySet = extractEntitySetFromPath(binding.bindingPath);
    if (entitySet) {
      referencedEntitySets.push({
        entitySet,
        file: file.path,
        line: binding.expression ? findLine(file.content, binding.expression) : null
      });
    }
  }
}

function collectJsUsage(file, referencedEntitySets) {
  const pattern = /\.(read|create|update|remove|bindList|bindContext)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  let match = pattern.exec(file.content);
  while (match) {
    const entitySet = extractEntitySetFromPath(match[2]);
    if (entitySet) {
      referencedEntitySets.push({
        entitySet,
        file: file.path,
        line: findLine(file.content, match.index)
      });
    }
    match = pattern.exec(file.content);
  }
}

function validateManifest(input) {
  const { manifest, capSurface } = input;
  const findings = [];
  if (!manifest.exists) {
    findings.push(createFinding({
      rule: "UI5_CAP_MANIFEST_MISSING",
      severity: "high",
      category: "manifest",
      file: null,
      target: null,
      message: "UI5 manifest.json was not found.",
      suggestion: "Provide manifestPath or add webapp/manifest.json before validating UI5-CAP service wiring."
    }));
    return findings;
  }
  for (const dataSource of manifest.odataDataSources) {
    if (!matchCapService(dataSource.uri, capSurface.services)) {
      findings.push(createFinding({
        rule: "UI5_CAP_DATASOURCE_UNKNOWN_SERVICE",
        severity: "high",
        category: "service",
        file: manifest.path,
        target: dataSource.name,
        message: `OData dataSource ${dataSource.name} does not match any local CAP service path.`,
        suggestion: "Align the manifest dataSource uri with a CAP service path or add the missing service."
      }));
    }
    if (!dataSource.odataVersion) {
      findings.push(createFinding({
        rule: "UI5_CAP_ODATA_VERSION_UNDECLARED",
        severity: "medium",
        category: "version",
        file: manifest.path,
        target: dataSource.name,
        message: `OData dataSource ${dataSource.name} does not declare settings.odataVersion.`,
        suggestion: "Declare OData version explicitly so UI5 model type and CAP service expectations stay deterministic."
      }));
    }
  }
  if (manifest.odataDataSources.length > 0 && manifest.odataModels.length === 0) {
    findings.push(createFinding({
      rule: "UI5_CAP_MODEL_MISSING",
      severity: "medium",
      category: "manifest",
      file: manifest.path,
      target: null,
      message: "OData dataSources exist but no OData model is configured.",
      suggestion: "Declare a sap.ui5 model linked to the CAP OData dataSource."
    }));
  }
  return findings;
}

function validateUsage(input) {
  const { usage, capEntitySets, manifest } = input;
  const findings = [];
  for (const reference of usage.referencedEntitySets) {
    if (!capEntitySets.has(reference.entitySet)) {
      findings.push(createFinding({
        rule: "UI5_CAP_ENTITYSET_UNKNOWN",
        severity: "high",
        category: "binding",
        file: reference.file,
        line: reference.line,
        target: reference.entitySet,
        message: `UI5 references entity set ${reference.entitySet}, but it is not exposed by local CAP services.`,
        suggestion: "Use an exposed CAP entity set or update the CAP service projection."
      }));
    }
  }
  for (const modelName of usage.referencedModels) {
    if (["i18n", "device", "$this", "$source", "$parameters"].includes(modelName)) {
      continue;
    }
    if (!manifest.odataModels.some((model) => model.name === modelName)) {
      findings.push(createFinding({
        rule: "UI5_CAP_BINDING_MODEL_UNKNOWN",
        severity: "medium",
        category: "binding",
        file: manifest.path,
        target: modelName,
        message: `UI5 binding references model ${modelName}, but no matching OData model was found in manifest.`,
        suggestion: "Add the model to sap.ui5.models or correct the binding model name."
      }));
    }
  }
  return findings;
}

function createFinding(item) {
  return {
    rule: item.rule,
    severity: item.severity,
    category: item.category,
    file: item.file ?? null,
    line: item.line ?? null,
    target: item.target ?? null,
    message: item.message,
    suggestion: item.suggestion,
    officialRefs: getSapOfficialRefsForRule(item.rule).map((reference) => ({
      id: reference.id,
      title: reference.title,
      url: reference.url,
      product: reference.product,
      topic: reference.topic
    }))
  };
}

function summarizeFindings(findings, truncated) {
  return {
    totalFindings: findings.length,
    high: findings.filter((finding) => finding.severity === "high").length,
    medium: findings.filter((finding) => finding.severity === "medium").length,
    low: findings.filter((finding) => finding.severity === "low").length,
    unmatchedDataSources: findings.filter((finding) => finding.rule === "UI5_CAP_DATASOURCE_UNKNOWN_SERVICE").length,
    unknownEntitySets: findings.filter((finding) => finding.rule === "UI5_CAP_ENTITYSET_UNKNOWN").length,
    truncated
  };
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

function matchCapService(uri, services) {
  if (!uri) {
    return null;
  }
  const normalizedUri = normalizeServicePath(uri);
  return services.find((service) => normalizedUri.endsWith(normalizeServicePath(service.odataPath))) ?? null;
}

function extractEntitySetFromPath(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  return trimmed.slice(1).split(/[/?(]/)[0] || null;
}

function normalizeServicePath(value) {
  return String(value).replace(/^\.?\//, "/").replace(/\/+$/, "");
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeODataVersion(value) {
  if (typeof value !== "string") {
    return null;
  }
  if (value.trim().startsWith("4")) {
    return "4.0";
  }
  if (value.trim().startsWith("2")) {
    return "2.0";
  }
  return null;
}

function findLine(content, fragmentOrIndex) {
  const index = typeof fragmentOrIndex === "number" ? fragmentOrIndex : content.indexOf(fragmentOrIndex);
  if (index < 0) {
    return null;
  }
  return content.slice(0, index).split(/\r?\n/).length;
}
