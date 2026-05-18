import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { fileExists, isIgnoredWorkspaceDirectory, readTextFile, resolveWorkspacePath } from "../../utils/fileSystem.js";
import { getSapOfficialRefsForRule } from "../documentation/sapOfficialDocs.js";
import { readCapProject } from "./common.js";
import { analyzeCdsModelContractTool } from "./analyzeCdsModelContract.js";
import { analyzeCapServiceSurfaceTool } from "./analyzeServiceSurface.js";

const inputSchema = z.object({
  changeRequest: z.string().min(1).optional(),
  targetFiles: z.array(z.string().min(1)).max(100).optional(),
  entities: z.array(z.string().min(1)).max(100).optional(),
  services: z.array(z.string().min(1)).max(100).optional(),
  entitySets: z.array(z.string().min(1)).max(100).optional(),
  sourceDir: z.string().min(1).optional(),
  ui5SourceDir: z.string().min(1).optional(),
  includeUi5: z.boolean().optional(),
  includeTests: z.boolean().optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  maxResults: z.number().int().min(5).max(500).optional()
}).strict();

const officialRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  product: z.enum(["cap", "ui5"]),
  topic: z.string()
});

const impactedFileSchema = z.object({
  path: z.string(),
  area: z.enum(["cds", "handler", "ui5", "test", "config", "docs"]),
  priority: z.enum(["high", "medium", "low"]),
  reasons: z.array(z.string()),
  matchedSignals: z.array(z.string())
});

const riskSchema = z.object({
  rule: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  area: z.enum(["model", "service", "ui5", "testing", "scope"]),
  message: z.string(),
  suggestion: z.string(),
  files: z.array(z.string()),
  officialRefs: z.array(officialRefSchema)
});

const outputSchema = z.object({
  sourceDir: z.string(),
  ui5SourceDir: z.string(),
  impact: z.object({
    level: z.enum(["low", "medium", "high"]),
    score: z.number().int().min(0).max(100),
    reason: z.string()
  }),
  signals: z.object({
    explicitFiles: z.array(z.string()),
    keywords: z.array(z.string()),
    entities: z.array(z.string()),
    services: z.array(z.string()),
    entitySets: z.array(z.string())
  }),
  impacted: z.object({
    files: z.array(impactedFileSchema),
    services: z.array(z.string()),
    entities: z.array(z.string()),
    entitySets: z.array(z.string()),
    operations: z.array(z.string())
  }),
  risks: z.array(riskSchema),
  recommendedTools: z.array(z.string()),
  validationCommands: z.array(z.string())
});

export const analyzeCapChangeImpactTool = {
  name: "analyze_cap_change_impact",
  description: "Analyze likely SAP CAP/UI5 change impact from a request, target files, entities, services, and local service/model contracts.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      changeRequest,
      targetFiles,
      entities,
      services,
      entitySets,
      sourceDir,
      ui5SourceDir,
      includeUi5,
      includeTests,
      maxFiles,
      maxResults
    } = inputSchema.parse(args);
    const selectedUi5SourceDir = normalizePath(ui5SourceDir ?? "webapp");
    const project = await readCapProject({
      root: context.rootDir,
      sourceDir,
      maxFiles
    });
    const [contract, surface] = await Promise.all([
      analyzeCdsModelContractTool.handler({ sourceDir, maxFiles }, { context }),
      analyzeCapServiceSurfaceTool.handler({ sourceDir, maxFiles }, { context })
    ]);
    const signals = buildSignals({
      changeRequest,
      targetFiles,
      entities,
      services,
      entitySets,
      contract,
      surface
    });
    const capFiles = await rankKnownFiles({
      root: context.rootDir,
      files: project.files,
      signals,
      targetFiles: signals.explicitFiles
    });
    const ui5Files = includeUi5 === false
      ? []
      : await rankUi5Files({
          root: context.rootDir,
          sourceDir: selectedUi5SourceDir,
          signals,
          maxFiles: maxFiles ?? 1200
        });
    const testFiles = includeTests === false
      ? []
      : await rankTestFiles({
          root: context.rootDir,
          signals,
          maxFiles: maxFiles ?? 1200
        });
    const impactedFiles = dedupeFiles([...capFiles, ...ui5Files, ...testFiles])
      .sort(compareImpactedFiles)
      .slice(0, maxResults ?? 100);
    const impacted = resolveImpactedContract({
      files: impactedFiles,
      contract,
      surface,
      signals
    });
    const risks = buildRisks({
      impactedFiles,
      impacted,
      contract,
      surface,
      includeUi5: includeUi5 !== false,
      includeTests: includeTests !== false,
      testFiles
    });
    const impact = calculateImpact({
      impactedFiles,
      impacted,
      risks
    });

    return outputSchema.parse({
      sourceDir: project.sourceDir,
      ui5SourceDir: selectedUi5SourceDir,
      impact,
      signals,
      impacted: {
        ...impacted,
        files: impactedFiles
      },
      risks,
      recommendedTools: [
        "analyze_cds_model_contract",
        "analyze_cap_service_surface",
        "validate_ui5_cap_contract_alignment",
        "generate_cap_test_plan",
        "run_cap_official_quality_gate"
      ],
      validationCommands: buildValidationCommands({
        impactedFiles,
        includeUi5: includeUi5 !== false,
        includeTests: includeTests !== false
      })
    });
  }
};

function buildSignals(input) {
  const explicitFiles = unique((input.targetFiles ?? []).map(normalizePath));
  const requestTokens = tokenize(input.changeRequest ?? "");
  const entities = unique([
    ...(input.entities ?? []),
    ...input.contract.entities
      .filter((entity) => requestTokens.some((token) => matchesToken(entity.name, token)))
      .map((entity) => entity.name)
  ]);
  const services = unique([
    ...(input.services ?? []),
    ...input.surface.services
      .filter((service) => requestTokens.some((token) => matchesToken(service.name, token)))
      .map((service) => service.name)
  ]);
  const entitySets = unique([
    ...(input.entitySets ?? []),
    ...input.surface.services
      .flatMap((service) => service.entitySets)
      .filter((entitySet) => requestTokens.some((token) => matchesToken(entitySet.name, token)))
      .map((entitySet) => entitySet.name)
  ]);
  const keywords = unique([
    ...requestTokens,
    ...entities,
    ...services,
    ...entitySets,
    ...explicitFiles.map((file) => path.basename(file, path.extname(file)))
  ]).slice(0, 60);
  return {
    explicitFiles,
    keywords,
    entities,
    services,
    entitySets
  };
}

async function rankKnownFiles(input) {
  const { root, files, signals, targetFiles } = input;
  const ranked = [];
  for (const file of files) {
    const area = classifyProjectFile(file);
    if (!area) {
      continue;
    }
    const content = await safeRead(file, root);
    const result = scoreFile({
      file,
      content,
      area,
      signals,
      explicit: targetFiles.includes(file)
    });
    if (result) {
      ranked.push(result);
    }
  }
  return ranked;
}

async function rankUi5Files(input) {
  const { root, sourceDir, signals, maxFiles } = input;
  const files = await listFiles({
    root,
    sourceDir,
    maxFiles,
    extensions: new Set([".xml", ".js", ".json", ".properties"])
  });
  const ranked = [];
  for (const file of files) {
    const content = await safeRead(file, root);
    const result = scoreFile({
      file,
      content,
      area: "ui5",
      signals,
      explicit: signals.explicitFiles.includes(file)
    });
    if (result) {
      ranked.push(result);
    }
  }
  return ranked;
}

async function rankTestFiles(input) {
  const files = await listFiles({
    root: input.root,
    sourceDir: ".",
    maxFiles: input.maxFiles,
    extensions: new Set([".js", ".ts", ".cds", ".json"])
  });
  const ranked = [];
  for (const file of files.filter(isTestFile)) {
    const content = await safeRead(file, input.root);
    const result = scoreFile({
      file,
      content,
      area: "test",
      signals: input.signals,
      explicit: input.signals.explicitFiles.includes(file)
    });
    if (result) {
      ranked.push(result);
    }
  }
  return ranked;
}

function scoreFile(input) {
  const { file, content, area, signals, explicit } = input;
  const matchedSignals = signals.keywords.filter((keyword) => containsFolded(content, keyword) || containsFolded(file, keyword));
  const reasons = [];
  let score = 0;
  if (explicit) {
    score += 60;
    reasons.push("explicit target file");
  }
  if (matchedSignals.length > 0) {
    score += Math.min(40, matchedSignals.length * 8);
    reasons.push("matches change signals");
  }
  if (area === "cds" && (signals.entities.length > 0 || signals.services.length > 0 || signals.entitySets.length > 0)) {
    score += 10;
    reasons.push("CAP contract file");
  }
  if (area === "handler" && (signals.services.length > 0 || signals.entitySets.length > 0)) {
    score += 10;
    reasons.push("CAP handler candidate");
  }
  if (score === 0) {
    return null;
  }
  return {
    path: file,
    area,
    priority: score >= 60 ? "high" : score >= 25 ? "medium" : "low",
    reasons: unique(reasons),
    matchedSignals: unique(matchedSignals).slice(0, 12)
  };
}

function resolveImpactedContract(input) {
  const { files, contract, surface, signals } = input;
  const impactedFileSet = new Set(files.map((file) => file.path));
  const entities = contract.entities
    .filter((entity) => impactedFileSet.has(entity.file)
      || signals.entities.some((signal) => namesMatch(entity.name, signal))
      || signals.entitySets.some((signal) => namesMatch(entity.name, signal)))
    .map((entity) => entity.qualifiedName);
  const services = surface.services
    .filter((service) => impactedFileSet.has(service.file) || signals.services.some((signal) => namesMatch(service.name, signal)))
    .map((service) => service.name);
  const entitySets = surface.services
    .flatMap((service) => service.entitySets)
    .filter((entitySet) => signals.entitySets.some((signal) => namesMatch(entitySet.name, signal))
      || signals.entities.some((signal) => namesMatch(entitySet.source ?? entitySet.name, signal)))
    .map((entitySet) => entitySet.name);
  const operations = surface.services
    .flatMap((service) => service.operations.map((operation) => `${service.name}.${operation.name}`))
    .filter((operation) => signals.keywords.some((signal) => containsFolded(operation, signal)));
  return {
    services: unique(services),
    entities: unique(entities),
    entitySets: unique(entitySets),
    operations: unique(operations)
  };
}

function buildRisks(input) {
  const risks = [];
  const impactedPaths = input.impactedFiles.map((file) => file.path);
  if (input.impactedFiles.length === 0) {
    risks.push(createRisk({
      rule: "CAP_CHANGE_IMPACT_NO_MATCH",
      severity: "medium",
      area: "scope",
      message: "No local files matched the supplied change signals.",
      suggestion: "Provide targetFiles, entities, services, or a more specific changeRequest before delegating implementation.",
      files: []
    }));
  }
  if (input.contract.summary.highFindings > 0 && input.impacted.entities.length > 0) {
    risks.push(createRisk({
      rule: "CAP_CHANGE_IMPACT_MODEL_BLOCKERS",
      severity: "high",
      area: "model",
      message: "Impacted CDS model area already has high-severity contract findings.",
      suggestion: "Resolve model contract blockers before asking a coding agent to implement dependent service/UI changes.",
      files: impactedPaths
    }));
  }
  if (input.surface.findings.some((finding) => finding.severity === "high") && input.impacted.services.length > 0) {
    risks.push(createRisk({
      rule: "CAP_CHANGE_IMPACT_SERVICE_SECURITY",
      severity: "high",
      area: "service",
      message: "Impacted service area includes security-related service surface findings.",
      suggestion: "Run authorization checks and clarify public/private API expectations before implementation.",
      files: impactedPaths
    }));
  }
  if (input.includeUi5 && input.impactedFiles.some((file) => file.area === "cds" || file.area === "handler") && input.impactedFiles.every((file) => file.area !== "ui5")) {
    risks.push(createRisk({
      rule: "CAP_CHANGE_IMPACT_UI5_NOT_SCANNED",
      severity: "medium",
      area: "ui5",
      message: "CAP files are impacted but no matching UI5 file was identified.",
      suggestion: "Run validate_ui5_cap_contract_alignment if the change affects entity sets consumed by UI5.",
      files: impactedPaths
    }));
  }
  if (input.includeTests && input.testFiles.length === 0) {
    risks.push(createRisk({
      rule: "CAP_CHANGE_IMPACT_TEST_GAP",
      severity: "medium",
      area: "testing",
      message: "No matching test files were found for the impacted area.",
      suggestion: "Use generate_cap_test_plan to create focused service, contract, and UI5 alignment tests.",
      files: impactedPaths
    }));
  }
  return risks;
}

function createRisk(input) {
  return {
    rule: input.rule,
    severity: input.severity,
    area: input.area,
    message: input.message,
    suggestion: input.suggestion,
    files: input.files,
    officialRefs: getSapOfficialRefsForRule(input.rule).map((reference) => ({
      id: reference.id,
      title: reference.title,
      url: reference.url,
      product: reference.product,
      topic: reference.topic
    }))
  };
}

function calculateImpact(input) {
  const areaCount = new Set(input.impactedFiles.map((file) => file.area)).size;
  const highFiles = input.impactedFiles.filter((file) => file.priority === "high").length;
  const highRisks = input.risks.filter((risk) => risk.severity === "high").length;
  const score = Math.min(100, areaCount * 18 + highFiles * 10 + highRisks * 20 + input.impacted.services.length * 10 + input.impacted.entitySets.length * 6);
  if (score >= 60) {
    return {
      level: "high",
      score,
      reason: "Multiple areas or high-severity risks are likely impacted."
    };
  }
  if (score >= 25) {
    return {
      level: "medium",
      score,
      reason: "The change appears localized but touches contract or service signals."
    };
  }
  return {
    level: "low",
    score,
    reason: "Few local impact signals were detected."
  };
}

function buildValidationCommands(input) {
  const commands = ["npx cds compile srv --to csn"];
  if (input.impactedFiles.some((file) => file.area === "cds" || file.area === "handler")) {
    commands.push("npx cds lint");
  }
  if (input.includeUi5 && input.impactedFiles.some((file) => file.area === "ui5")) {
    commands.push("npm run lint");
  }
  if (input.includeTests) {
    commands.push("npm test");
  }
  return unique(commands);
}

async function listFiles(input) {
  const { root, sourceDir, maxFiles, extensions } = input;
  if (!await fileExists(sourceDir, root)) {
    return [];
  }
  const resolvedRoot = path.resolve(root);
  const sourceAbsolute = resolveWorkspacePath(sourceDir, root);
  const files = [];
  await walk(sourceAbsolute);
  return files.sort((a, b) => a.localeCompare(b));

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
      if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(relativePath);
      }
    }
  }
}

async function safeRead(file, root) {
  try {
    return await readTextFile(file, root);
  } catch {
    return "";
  }
}

function classifyProjectFile(file) {
  const normalized = file.replaceAll("\\", "/");
  if (normalized.endsWith("package.json") || normalized.endsWith(".cdsrc.json")) {
    return "config";
  }
  if (normalized.endsWith(".cds")) {
    return "cds";
  }
  if ((normalized.startsWith("srv/") || normalized.includes("/srv/")) && /\.(js|ts)$/.test(normalized)) {
    return "handler";
  }
  if (isTestFile(normalized)) {
    return "test";
  }
  return null;
}

function isTestFile(file) {
  return /(^|\/)(test|tests|__tests__)\//.test(file) || /\.(test|spec)\.[cm]?[jt]s$/.test(file);
}

function compareImpactedFiles(a, b) {
  const priorityDelta = priorityRank(b.priority) - priorityRank(a.priority);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return a.path.localeCompare(b.path);
}

function priorityRank(value) {
  return { high: 3, medium: 2, low: 1 }[value] ?? 0;
}

function dedupeFiles(files) {
  const byPath = new Map();
  for (const file of files) {
    const existing = byPath.get(file.path);
    if (!existing) {
      byPath.set(file.path, file);
      continue;
    }
    byPath.set(file.path, {
      ...existing,
      priority: priorityRank(file.priority) > priorityRank(existing.priority) ? file.priority : existing.priority,
      reasons: unique([...existing.reasons, ...file.reasons]),
      matchedSignals: unique([...existing.matchedSignals, ...file.matchedSignals])
    });
  }
  return Array.from(byPath.values());
}

function tokenize(value) {
  return unique(String(value)
    .split(/[^A-Za-z0-9_.-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)
    .slice(0, 80));
}

function matchesToken(value, token) {
  return containsFolded(value, token) || containsFolded(token, value);
}

function containsFolded(value, needle) {
  return String(value).toLowerCase().includes(String(needle).toLowerCase());
}

function namesMatch(value, signal) {
  return value === signal || value.endsWith(`.${signal}`) || signal.endsWith(`.${value}`) || containsFolded(value, signal);
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
