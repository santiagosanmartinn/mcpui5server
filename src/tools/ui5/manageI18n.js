import path from "node:path";
import { promises as fs } from "node:fs";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, isIgnoredWorkspaceDirectory, readTextFile, resolveWorkspacePath } from "../../utils/fileSystem.js";

const DEFAULT_SOURCE_DIR = "webapp";
const DEFAULT_I18N_PATH = "webapp/i18n/i18n.properties";
const DEFAULT_MAX_FILES = 800;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".mcp-backups", ".mcp-cache", "dist", "coverage"]);
const TRACKED_EXTENSIONS = new Set([".xml", ".js"]);

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  i18nPath: z.string().min(1).optional(),
  mode: z.enum(["report", "fix"]).optional(),
  dryRun: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional(),
  keyPrefix: z.string().regex(/^[A-Za-z0-9_.-]+$/).optional(),
  maxFiles: z.number().int().min(10).max(2000).optional()
}).strict();

const previewSchema = z.object({
  path: z.string(),
  changed: z.boolean(),
  existsBefore: z.boolean(),
  oldHash: z.string().nullable(),
  newHash: z.string(),
  diffPreview: z.string(),
  diffTruncated: z.boolean()
});

const outputSchema = z.object({
  mode: z.enum(["report", "fix"]),
  dryRun: z.boolean(),
  changed: z.boolean(),
  sourceDir: z.string(),
  i18nPath: z.string(),
  fileReports: z.array(
    z.object({
      path: z.string(),
      literalsFound: z.number().int().nonnegative(),
      usedKeys: z.number().int().nonnegative(),
      missingKeys: z.array(z.string()),
      nonLocalizedLiterals: z.array(
        z.object({
          line: z.number().int().positive(),
          attribute: z.string().nullable(),
          text: z.string(),
          suggestedKey: z.string()
        })
      )
    })
  ),
  missingKeys: z.array(
    z.object({
      key: z.string(),
      usageCount: z.number().int().positive(),
      files: z.array(z.string())
    })
  ),
  unusedKeys: z.array(z.string()),
  summary: z.object({
    filesScanned: z.number().int().nonnegative(),
    literalsFound: z.number().int().nonnegative(),
    usedKeys: z.number().int().nonnegative(),
    missingKeys: z.number().int().nonnegative(),
    unusedKeys: z.number().int().nonnegative(),
    keysAdded: z.number().int().nonnegative(),
    keysUpdated: z.number().int().nonnegative(),
    keysUnchanged: z.number().int().nonnegative()
  }),
  previews: z.array(previewSchema),
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

export const manageUi5I18nTool = {
  name: "manage_ui5_i18n",
  description: "Extract UI literals, detect missing/unused i18n keys, and optionally apply fixes with safe preview/apply patch flow.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      i18nPath,
      mode,
      dryRun,
      reason,
      maxDiffLines,
      keyPrefix,
      maxFiles
    } = inputSchema.parse(args);
    const root = context.rootDir;
    const resolvedSourceDir = normalizeRelativePath(sourceDir ?? DEFAULT_SOURCE_DIR);
    const resolvedI18nPath = normalizeRelativePath(i18nPath ?? DEFAULT_I18N_PATH);
    const selectedMode = mode ?? "report";
    const shouldDryRun = dryRun ?? true;

    const files = await listTrackedFiles({
      root,
      sourceDir: resolvedSourceDir,
      maxFiles: maxFiles ?? DEFAULT_MAX_FILES
    });
    const i18nRaw = await readOptionalTextFile(resolvedI18nPath, root);
    const i18nState = parseI18nProperties(i18nRaw);
    const usageMap = new Map();
    const missingMap = new Map();
    const fileReports = [];
    const literalsToLocalize = [];
    const plannedWrites = [];

    for (const relativePath of files) {
      const content = await readTextFile(relativePath, root);
      const extension = path.extname(relativePath).toLowerCase();
      const usedKeys = collectUsedI18nKeys(content);
      for (const key of usedKeys) {
        incrementUsage(usageMap, key, relativePath);
        if (!i18nState.map.has(key)) {
          incrementUsage(missingMap, key, relativePath);
        }
      }

      const nonLocalizedLiterals = extension === ".xml"
        ? collectXmlLiterals(content, relativePath, keyPrefix)
        : [];
      literalsToLocalize.push(...nonLocalizedLiterals.map((item) => ({
        key: item.suggestedKey,
        value: item.text,
        path: relativePath
      })));

      let nextContent = content;
      if (selectedMode === "fix" && nonLocalizedLiterals.length > 0) {
        nextContent = applyXmlLiteralFixes(content, nonLocalizedLiterals);
      }

      if (selectedMode === "fix" && nextContent !== content) {
        plannedWrites.push({
          path: relativePath,
          content: nextContent
        });
      }

      fileReports.push({
        path: relativePath,
        literalsFound: nonLocalizedLiterals.length,
        usedKeys: usedKeys.size,
        missingKeys: Array.from(usedKeys).filter((key) => !i18nState.map.has(key)).sort(),
        nonLocalizedLiterals: nonLocalizedLiterals.map((item) => ({
          line: item.line,
          attribute: item.attribute,
          text: item.text,
          suggestedKey: item.suggestedKey
        }))
      });
    }

    const unusedKeys = Array.from(i18nState.map.keys())
      .filter((key) => !usageMap.has(key))
      .sort();
    const missingKeys = Array.from(missingMap.entries())
      .map(([key, usage]) => ({
        key,
        usageCount: usage.count,
        files: Array.from(usage.files).sort()
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    let i18nSummary = {
      keysAdded: 0,
      keysUpdated: 0,
      keysUnchanged: 0
    };
    if (selectedMode === "fix") {
      const fixes = new Map();
      for (const literal of literalsToLocalize) {
        if (!fixes.has(literal.key)) {
          fixes.set(literal.key, literal.value);
        }
      }
      for (const missing of missingKeys) {
        if (!fixes.has(missing.key)) {
          fixes.set(missing.key, toMissingValuePlaceholder(missing.key));
        }
      }

      const syncedI18n = synchronizeI18nContent(i18nRaw, fixes);
      i18nSummary = syncedI18n.summary;
      if (syncedI18n.content !== i18nRaw) {
        plannedWrites.push({
          path: resolvedI18nPath,
          content: syncedI18n.content
        });
      }
    }

    const previews = [];
    if (selectedMode === "fix") {
      for (const write of plannedWrites) {
        const preview = await previewFileWrite(write.path, write.content, {
          root,
          maxDiffLines
        });
        previews.push({
          path: preview.path,
          changed: preview.changed,
          existsBefore: preview.existsBefore,
          oldHash: preview.oldHash,
          newHash: preview.newHash,
          diffPreview: preview.diffPreview,
          diffTruncated: preview.diffTruncated
        });
      }
    }

    const changed = previews.some((item) => item.changed);
    let applyResult = null;
    if (selectedMode === "fix" && !shouldDryRun && changed) {
      const changes = plannedWrites.map((write) => {
        const preview = previews.find((item) => item.path === write.path);
        return {
          path: write.path,
          content: write.content,
          expectedOldHash: preview?.oldHash ?? undefined
        };
      });
      applyResult = await applyProjectPatch(changes, {
        root,
        reason: reason ?? "manage_ui5_i18n"
      });
    }

    const totalLiterals = fileReports.reduce((sum, report) => sum + report.literalsFound, 0);
    const totalUsedKeys = Array.from(usageMap.values()).reduce((sum, item) => sum + item.count, 0);

    return outputSchema.parse({
      mode: selectedMode,
      dryRun: selectedMode === "fix" ? shouldDryRun : true,
      changed,
      sourceDir: resolvedSourceDir,
      i18nPath: resolvedI18nPath,
      fileReports,
      missingKeys,
      unusedKeys,
      summary: {
        filesScanned: fileReports.length,
        literalsFound: totalLiterals,
        usedKeys: totalUsedKeys,
        missingKeys: missingKeys.length,
        unusedKeys: unusedKeys.length,
        keysAdded: i18nSummary.keysAdded,
        keysUpdated: i18nSummary.keysUpdated,
        keysUnchanged: i18nSummary.keysUnchanged
      },
      previews,
      applyResult
    });
  }
};

async function listTrackedFiles(options) {
  const { root, sourceDir, maxFiles } = options;
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
    } catch (error) {
      throw new ToolError(`Failed to read directory ${currentDir}: ${error.message}`, {
        code: "I18N_SCAN_FAILED"
      });
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        break;
      }

      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(path.resolve(root), absolutePath).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (isIgnoredWorkspaceDirectory(entry.name, relativePath, IGNORED_DIRS)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (TRACKED_EXTENSIONS.has(extension)) {
        files.push(relativePath);
      }
    }
  }
}

function collectUsedI18nKeys(content) {
  const keys = new Set();
  for (const match of content.matchAll(/\{i18n>([^}]+)\}/g)) {
    keys.add(match[1].trim());
  }
  for (const match of content.matchAll(/\bgetText\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    keys.add(match[1].trim());
  }
  for (const match of content.matchAll(/\bi18n>([A-Za-z0-9_.-]+)/g)) {
    keys.add(match[1].trim());
  }
  return keys;
}

function collectXmlLiterals(content, relativePath, keyPrefix) {
  const literals = [];
  const attrRegex = /\b(text|title|tooltip|placeholder|description|headerText)\s*=\s*"([^"]*)"/g;
  for (const match of content.matchAll(attrRegex)) {
    const attribute = match[1];
    const rawValue = match[2];
    const value = rawValue.trim();
    if (!isCandidateLiteral(value)) {
      continue;
    }

    const index = match.index ?? 0;
    const line = countLine(content, index);
    const suggestedKey = buildSuggestedKey(relativePath, value, keyPrefix);
    literals.push({
      line,
      index,
      matchText: match[0],
      attribute,
      text: value,
      suggestedKey
    });
  }
  return literals;
}

function isCandidateLiteral(value) {
  if (!value || value.length < 2) {
    return false;
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    return false;
  }
  if (/^(sap-icon:\/\/|https?:\/\/|\/|\.\/|\.\.\/)/.test(value)) {
    return false;
  }
  if (/^[0-9\s.,:%-]+$/.test(value)) {
    return false;
  }
  return /[A-Za-z]/.test(value);
}

function applyXmlLiteralFixes(content, literals) {
  let next = content;
  for (const literal of literals) {
    const escapedValue = escapeRegExp(literal.text);
    const pattern = new RegExp(`\\b${literal.attribute}\\s*=\\s*"${escapedValue}"`, "g");
    const replacement = `${literal.attribute}="{i18n>${literal.suggestedKey}}"`;
    next = next.replace(pattern, replacement);
  }
  return next;
}

function buildSuggestedKey(relativePath, value, keyPrefix) {
  const prefix = keyPrefix ?? "auto";
  const fileToken = relativePath
    .replace(/^webapp\//, "")
    .replace(/\.(view|fragment)\.xml$/i, "")
    .replace(/\.[^.]+$/i, "")
    .replace(/[\\/]+/g, ".")
    .replace(/[^A-Za-z0-9.]/g, "")
    .toLowerCase();
  const textToken = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(".");
  return `${prefix}.${fileToken}.${textToken}`;
}

function parseI18nProperties(content) {
  const map = new Map();
  const lines = content.replace(/\r/g, "").split("\n");
  for (const line of lines) {
    const parsed = parseI18nLine(line);
    if (!parsed) {
      continue;
    }
    map.set(parsed.key, parsed.value);
  }
  return { map };
}

function parseI18nLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
    return null;
  }

  const separator = line.indexOf("=");
  if (separator < 1) {
    return null;
  }
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!key) {
    return null;
  }
  return { key, value };
}

function synchronizeI18nContent(currentContent, additions) {
  const lines = currentContent.length > 0 ? currentContent.replace(/\r/g, "").split("\n") : [];
  const keyToIndex = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseI18nLine(lines[index]);
    if (parsed) {
      keyToIndex.set(parsed.key, index);
    }
  }

  let keysAdded = 0;
  let keysUpdated = 0;
  let keysUnchanged = 0;
  const append = [];
  for (const [key, rawValue] of additions.entries()) {
    const value = escapeI18nValue(rawValue);
    const existingIndex = keyToIndex.get(key);
    if (existingIndex === undefined) {
      append.push(`${key}=${value}`);
      keysAdded += 1;
      continue;
    }
    const parsed = parseI18nLine(lines[existingIndex]);
    if (parsed?.value === value) {
      keysUnchanged += 1;
      continue;
    }
    lines[existingIndex] = `${key}=${value}`;
    keysUpdated += 1;
  }

  if (append.length > 0 && lines.length > 0 && lines[lines.length - 1].trim().length > 0) {
    lines.push("");
  }
  lines.push(...append);

  return {
    content: `${lines.join("\n")}`.replace(/\n?$/, "\n"),
    summary: {
      keysAdded,
      keysUpdated,
      keysUnchanged
    }
  };
}

function escapeI18nValue(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n");
}

function toMissingValuePlaceholder(key) {
  const token = key.split(".").at(-1) ?? key;
  return `[TODO] ${token}`;
}

function incrementUsage(map, key, filePath) {
  if (!map.has(key)) {
    map.set(key, { count: 0, files: new Set() });
  }
  const item = map.get(key);
  item.count += 1;
  item.files.add(filePath);
}

function normalizeRelativePath(input) {
  return input
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function countLine(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readOptionalTextFile(filePath, root) {
  if (!(await fileExists(filePath, root))) {
    return "";
  }
  return readTextFile(filePath, root);
}
