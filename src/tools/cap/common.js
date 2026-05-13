import path from "node:path";
import { promises as fs } from "node:fs";
import { fileExists, isIgnoredWorkspaceDirectory, readJsonFile, readTextFile, resolveWorkspacePath } from "../../utils/fileSystem.js";

export const DEFAULT_CAP_SOURCE_DIR = ".";
export const DEFAULT_CAP_MAX_FILES = 1000;
export const CAP_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".mcp-backups",
  ".mcp-cache",
  "dist",
  "coverage",
  "gen"
]);
export const CAP_SUPPORTED_EXTENSIONS = new Set([".cds", ".js", ".ts", ".json", ".env", ".yml", ".yaml"]);

export function normalizeRelativePath(input) {
  return (input ?? DEFAULT_CAP_SOURCE_DIR)
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "") || ".";
}

export async function readCapProject(options) {
  const {
    root,
    sourceDir = DEFAULT_CAP_SOURCE_DIR,
    maxFiles = DEFAULT_CAP_MAX_FILES
  } = options;
  const resolvedSourceDir = normalizeRelativePath(sourceDir);
  const files = await listCapFiles({
    root,
    sourceDir: resolvedSourceDir,
    maxFiles
  });
  const packageJson = await readOptionalJson("package.json", root);
  const cdsFiles = files.filter((file) => file.endsWith(".cds"));
  const jsFiles = files.filter((file) => file.endsWith(".js") || file.endsWith(".ts"));
  const cdsAnalyses = [];

  for (const file of cdsFiles) {
    const content = await readTextFile(file, root);
    cdsAnalyses.push(analyzeCdsFile(file, content));
  }

  return {
    sourceDir: resolvedSourceDir,
    files,
    packageJson,
    cdsFiles,
    jsFiles,
    cdsAnalyses,
    detectedFiles: {
      packageJson: Boolean(packageJson),
      cdsConfig: await hasCdsConfig(root, packageJson),
      srvDir: await fileExists("srv", root),
      dbDir: await fileExists("db", root),
      appDir: await fileExists("app", root),
      mtaYaml: await fileExists("mta.yaml", root) || await fileExists("mta.yml", root),
      defaultEnvJson: await fileExists("default-env.json", root)
    }
  };
}

export async function listCapFiles(options) {
  const { root, sourceDir, maxFiles } = options;
  const resolvedRoot = path.resolve(root);
  const sourceAbsolute = resolveWorkspacePath(sourceDir, root);
  const files = [];
  await walk(sourceAbsolute);
  return files.sort();

  async function walk(currentDir) {
    if (files.length >= maxFiles) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        break;
      }

      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(resolvedRoot, absolutePath).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (isIgnoredWorkspaceDirectory(entry.name, relativePath, CAP_IGNORED_DIRS)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (CAP_SUPPORTED_EXTENSIONS.has(extension)) {
        files.push(relativePath);
      }
    }
  }
}

export async function readOptionalJson(relativePath, root) {
  if (!await fileExists(relativePath, root)) {
    return null;
  }
  return readJsonFile(relativePath, root);
}

export function getDependencyVersion(packageJson, dependencyName) {
  return packageJson?.dependencies?.[dependencyName]
    ?? packageJson?.devDependencies?.[dependencyName]
    ?? packageJson?.peerDependencies?.[dependencyName]
    ?? null;
}

export function getCapRequires(packageJson) {
  const requires = packageJson?.cds?.requires;
  if (!requires || typeof requires !== "object" || Array.isArray(requires)) {
    return [];
  }
  return Object.entries(requires).map(([name, config]) => ({
    name,
    kind: typeof config?.kind === "string" ? config.kind : null,
    credentialsConfigured: Boolean(config?.credentials)
  }));
}

export function analyzeCdsFile(file, content) {
  const cleanContent = stripComments(content);
  const services = Array.from(cleanContent.matchAll(/\bservice\s+([A-Za-z_][\w.]*)\s*(?:@(path|protocol)\s*:\s*['"][^'"]+['"])?\s*\{/g))
    .map((match) => ({
      name: match[1],
      path: file,
      line: findLine(content, match[0]),
      secured: hasSecurityAnnotationNear(cleanContent, match.index),
      entityCount: 0,
      actionCount: 0,
      functionCount: 0
    }));
  const blockEntities = Array.from(cleanContent.matchAll(/\b(entity|view)\s+([A-Za-z_][\w.]*)\s*(?:as\s+(?:projection\s+on|select\s+from)\s+([A-Za-z_][\w.]*))?[\s\S]*?\{/g))
    .map((match) => {
      const body = readBalancedBlock(cleanContent, match.index + match[0].length - 1);
      return {
        kind: match[1],
        name: match[2],
        source: match[3] ?? null,
        file,
        line: findLine(content, match[0]),
        hasKey: /\bkey\s+[A-Za-z_][\w.]*/.test(body),
        fieldCount: countCdsFields(body)
      };
    });
  const projectionEntities = Array.from(cleanContent.matchAll(/\b(entity|view)\s+([A-Za-z_][\w.]*)\s+as\s+(?:projection\s+on|select\s+from)\s+([A-Za-z_][\w.]*)\s*;/g))
    .filter((match) => !blockEntities.some((entity) => entity.name === match[2] && entity.line === findLine(content, match[0])))
    .map((match) => ({
      kind: match[1],
      name: match[2],
      source: match[3],
      file,
      line: findLine(content, match[0]),
      hasKey: false,
      fieldCount: 0
    }));
  const entities = [...blockEntities, ...projectionEntities];
  const actions = Array.from(cleanContent.matchAll(/\b(action|function)\s+([A-Za-z_][\w.]*)\s*\(/g))
    .map((match) => ({
      kind: match[1],
      name: match[2],
      file,
      line: findLine(content, match[0])
    }));

  const serviceRanges = services.map((service) => {
    const marker = new RegExp(`\\bservice\\s+${escapeRegex(service.name)}\\s*[\\s\\S]*?\\{`, "m").exec(cleanContent);
    return marker
      ? {
          service,
          start: marker.index,
          end: findBlockEnd(cleanContent, marker.index + marker[0].length - 1)
        }
      : null;
  }).filter(Boolean);

  for (const entity of entities) {
    const serviceRange = serviceRanges.find((range) => entityPosition(cleanContent, entity) > range.start && entityPosition(cleanContent, entity) < range.end);
    if (serviceRange) {
      serviceRange.service.entityCount += 1;
    }
  }
  for (const action of actions) {
    const serviceRange = serviceRanges.find((range) => actionPosition(cleanContent, action) > range.start && actionPosition(cleanContent, action) < range.end);
    if (!serviceRange) {
      continue;
    }
    if (action.kind === "action") {
      serviceRange.service.actionCount += 1;
    } else {
      serviceRange.service.functionCount += 1;
    }
  }

  return {
    file,
    services,
    entities,
    actions,
    annotations: Array.from(cleanContent.matchAll(/@[A-Za-z_][\w.:-]*/g)).map((match) => match[0])
  };
}

export function summarizeCdsAnalyses(cdsAnalyses) {
  const services = cdsAnalyses.flatMap((analysis) => analysis.services);
  const entities = cdsAnalyses.flatMap((analysis) => analysis.entities);
  const actions = cdsAnalyses.flatMap((analysis) => analysis.actions);
  return {
    services,
    entities,
    actions,
    serviceCount: services.length,
    entityCount: entities.length,
    actionCount: actions.filter((item) => item.kind === "action").length,
    functionCount: actions.filter((item) => item.kind === "function").length,
    projectionCount: entities.filter((item) => item.source).length
  };
}

export function findLine(content, fragmentOrIndex) {
  const index = typeof fragmentOrIndex === "number"
    ? fragmentOrIndex
    : content.indexOf(fragmentOrIndex);
  if (index < 0) {
    return null;
  }
  return content.slice(0, index).split(/\r?\n/).length;
}

export function createSummary(findings) {
  const bySeverity = { low: 0, medium: 0, high: 0 };
  const byCategory = {};
  const byRule = {};
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
  }
  return {
    totalFindings: findings.length,
    bySeverity,
    byCategory,
    byRule
  };
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function hasSecurityAnnotationNear(content, index) {
  const before = content.slice(Math.max(0, index - 300), index);
  const serviceLine = content.slice(index, content.indexOf("{", index) + 1);
  return /@(requires|restrict|readonly|insertonly)/.test(`${before}\n${serviceLine}`);
}

function readBalancedBlock(content, openingBraceIndex) {
  const end = findBlockEnd(content, openingBraceIndex);
  return end > openingBraceIndex ? content.slice(openingBraceIndex + 1, end) : "";
}

function findBlockEnd(content, openingBraceIndex) {
  let depth = 0;
  for (let index = openingBraceIndex; index < content.length; index += 1) {
    if (content[index] === "{") {
      depth += 1;
    } else if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return content.length;
}

function countCdsFields(body) {
  return body
    .split(";")
    .map((line) => line.trim())
    .filter((line) => line && !line.includes("{") && /\b[A-Za-z_][\w.]*\s*:/.test(line))
    .length;
}

function entityPosition(content, entity) {
  return content.indexOf(`${entity.kind} ${entity.name}`);
}

function actionPosition(content, action) {
  return content.indexOf(`${action.kind} ${action.name}`);
}

async function hasCdsConfig(root, packageJson) {
  return Boolean(packageJson?.cds)
    || await fileExists(".cdsrc.json", root)
    || await fileExists(".cdsrc-private.json", root);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
