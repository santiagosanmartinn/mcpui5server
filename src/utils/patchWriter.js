import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { ToolError } from "./errors.js";
import { resolveWorkspacePath, workspaceRoot } from "./fileSystem.js";

const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_MAX_DIFF_LINES = 120;
const BACKUP_DIR = ".codex/mcp/backups";
const LEGACY_BACKUP_DIR = ".mcp-backups";
const PATCH_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export async function previewFileWrite(inputPath, nextContent, options = {}) {
  const {
    root = workspaceRoot(),
    maxBytes = DEFAULT_MAX_BYTES,
    maxDiffLines = DEFAULT_MAX_DIFF_LINES
  } = options;

  assertTextContent(nextContent);
  assertContentSize(nextContent, maxBytes);

  const state = await readCurrentFileState(inputPath, root);
  const changed = state.content !== nextContent;
  const lineSummary = summarizeLineChanges(state.content, nextContent);
  const diff = buildDiffPreview(state.content, nextContent, maxDiffLines);

  return {
    path: state.relativePath,
    existsBefore: state.exists,
    changed,
    oldHash: state.exists ? hashContent(state.content) : null,
    newHash: hashContent(nextContent),
    bytesBefore: byteLength(state.content),
    bytesAfter: byteLength(nextContent),
    lineSummary,
    diffPreview: diff.text,
    diffTruncated: diff.truncated
  };
}

export async function applyProjectPatch(changes, options = {}) {
  const {
    root = workspaceRoot(),
    maxBytes = DEFAULT_MAX_BYTES,
    reason = null
  } = options;

  validatePatchChanges(changes);
  const safeRoot = path.resolve(root);
  const prepared = [];
  const seenPaths = new Set();

  for (const change of changes) {
    const state = await readCurrentFileState(change.path, safeRoot);
    if (seenPaths.has(state.relativePath)) {
      throw new ToolError(`Duplicate path in patch: ${state.relativePath}`, {
        code: "DUPLICATE_PATCH_PATH"
      });
    }
    seenPaths.add(state.relativePath);

    assertTextContent(change.content);
    assertContentSize(change.content, maxBytes);

    const oldHash = state.exists ? hashContent(state.content) : null;
    if (change.expectedOldHash && change.expectedOldHash !== oldHash) {
      throw new ToolError(`Expected hash mismatch for ${state.relativePath}.`, {
        code: "BASE_HASH_MISMATCH",
        details: {
          path: state.relativePath,
          expectedOldHash: change.expectedOldHash,
          actualOldHash: oldHash
        }
      });
    }

    prepared.push({
      relativePath: state.relativePath,
      absolutePath: state.absolutePath,
      existedBefore: state.exists,
      previousContent: state.content,
      oldHash,
      nextContent: change.content,
      newHash: hashContent(change.content),
      changed: state.content !== change.content,
      bytesBefore: byteLength(state.content),
      bytesAfter: byteLength(change.content)
    });
  }

  const changedItems = prepared.filter((item) => item.changed);
  const skippedFiles = prepared.filter((item) => !item.changed).map((item) => item.relativePath);
  if (changedItems.length === 0) {
    return {
      patchId: null,
      appliedAt: new Date().toISOString(),
      reason,
      changedFiles: [],
      skippedFiles
    };
  }

  const patchId = createPatchId();
  const metadataPath = resolveWorkspacePath(`${BACKUP_DIR}/${patchId}.json`, safeRoot);
  const backupMetadata = {
    patchId,
    createdAt: new Date().toISOString(),
    reason,
    rolledBackAt: null,
    files: changedItems.map((item) => ({
      path: item.relativePath,
      existedBefore: item.existedBefore,
      previousContent: item.previousContent,
      oldHash: item.oldHash,
      newHash: item.newHash
    }))
  };

  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, JSON.stringify(backupMetadata, null, 2), "utf8");

  const applied = [];
  try {
    for (const item of changedItems) {
      await fs.mkdir(path.dirname(item.absolutePath), { recursive: true });
      await fs.writeFile(item.absolutePath, item.nextContent, "utf8");
      applied.push(item);
    }
  } catch (error) {
    await restoreAppliedItems(applied);
    throw new ToolError(`Failed to apply patch: ${error.message}`, {
      code: "APPLY_PATCH_FAILED",
      details: { patchId }
    });
  }

  return {
    patchId,
    appliedAt: new Date().toISOString(),
    reason,
    changedFiles: changedItems.map((item) => ({
      path: item.relativePath,
      changed: true,
      oldHash: item.oldHash,
      newHash: item.newHash,
      bytesBefore: item.bytesBefore,
      bytesAfter: item.bytesAfter
    })),
    skippedFiles
  };

  async function restoreAppliedItems(items) {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item.existedBefore) {
        await fs.mkdir(path.dirname(item.absolutePath), { recursive: true });
        await fs.writeFile(item.absolutePath, item.previousContent, "utf8");
      } else {
        await fs.rm(item.absolutePath, { force: true });
      }
    }
  }
}

export async function rollbackProjectPatch(patchId, options = {}) {
  const { root = workspaceRoot() } = options;
  if (typeof patchId !== "string" || !PATCH_ID_PATTERN.test(patchId)) {
    throw new ToolError("Patch ID format is invalid.", {
      code: "INVALID_PATCH_ID"
    });
  }

  const safeRoot = path.resolve(root);
  const metadataPath = await resolveExistingBackupMetadataPath(patchId, safeRoot);
  const metadata = await readBackupMetadata(metadataPath);

  if (metadata.rolledBackAt) {
    return {
      patchId,
      alreadyRolledBack: true,
      rolledBackAt: metadata.rolledBackAt,
      restoredFiles: []
    };
  }

  const restoredFiles = [];
  for (const file of metadata.files ?? []) {
    const absolutePath = resolveWorkspacePath(file.path, safeRoot);

    if (file.existedBefore) {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, file.previousContent ?? "", "utf8");
      restoredFiles.push({ path: file.path, action: "restored" });
      continue;
    }

    const existedNow = await existsOnDisk(absolutePath);
    if (existedNow) {
      const stats = await fs.stat(absolutePath);
      if (!stats.isFile()) {
        throw new ToolError(`Rollback target is not a file: ${file.path}`, {
          code: "ROLLBACK_TARGET_NOT_FILE"
        });
      }
      await fs.rm(absolutePath, { force: true });
      restoredFiles.push({ path: file.path, action: "deleted" });
    } else {
      restoredFiles.push({ path: file.path, action: "noop" });
    }
  }

  const rolledBackAt = new Date().toISOString();
  const updatedMetadata = {
    ...metadata,
    rolledBackAt
  };
  await fs.writeFile(metadataPath, JSON.stringify(updatedMetadata, null, 2), "utf8");

  return {
    patchId,
    alreadyRolledBack: false,
    rolledBackAt,
    restoredFiles
  };
}

async function readCurrentFileState(inputPath, root) {
  const absolutePath = resolveWorkspacePath(inputPath, root);
  const relativePath = path.relative(path.resolve(root), absolutePath).replaceAll("\\", "/");
  const exists = await existsOnDisk(absolutePath);
  if (!exists) {
    return {
      absolutePath,
      relativePath,
      exists: false,
      content: ""
    };
  }

  const stats = await fs.stat(absolutePath);
  if (!stats.isFile()) {
    throw new ToolError(`Path is not a file: ${relativePath}`, {
      code: "NOT_A_FILE"
    });
  }

  const content = await fs.readFile(absolutePath, "utf8");
  return {
    absolutePath,
    relativePath,
    exists: true,
    content
  };
}

function validatePatchChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new ToolError("Patch must include at least one change.", {
      code: "EMPTY_PATCH"
    });
  }
}

function assertTextContent(content) {
  if (typeof content !== "string") {
    throw new ToolError("Content must be a string.", {
      code: "INVALID_CONTENT_TYPE"
    });
  }
}

function assertContentSize(content, maxBytes) {
  if (byteLength(content) > maxBytes) {
    throw new ToolError(`Content exceeds max allowed size (${maxBytes} bytes).`, {
      code: "CONTENT_TOO_LARGE",
      details: {
        maxBytes
      }
    });
  }
}

function summarizeLineChanges(before, after) {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const maxLength = Math.max(beforeLines.length, afterLines.length);
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  for (let index = 0; index < maxLength; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) {
      unchanged += 1;
      continue;
    }
    if (oldLine === undefined) {
      added += 1;
      continue;
    }
    if (newLine === undefined) {
      removed += 1;
      continue;
    }
    changed += 1;
  }

  return { added, removed, changed, unchanged };
}

function buildDiffPreview(before, after, maxDiffLines) {
  if (before === after) {
    return {
      text: "No changes detected.",
      truncated: false
    };
  }

  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const maxLength = Math.max(beforeLines.length, afterLines.length);
  const previewLines = [];

  for (let index = 0; index < maxLength; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) {
      continue;
    }
    if (oldLine !== undefined) {
      previewLines.push(`- ${index + 1}: ${oldLine}`);
    }
    if (newLine !== undefined) {
      previewLines.push(`+ ${index + 1}: ${newLine}`);
    }
    if (previewLines.length >= maxDiffLines) {
      return {
        text: `${previewLines.slice(0, maxDiffLines).join("\n")}\n... (diff truncated)`,
        truncated: true
      };
    }
  }

  return {
    text: previewLines.join("\n"),
    truncated: false
  };
}

function splitLines(content) {
  return content.split(/\r?\n/);
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function byteLength(content) {
  return Buffer.byteLength(content, "utf8");
}

function createPatchId() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "");
  const random = crypto.randomBytes(4).toString("hex");
  return `patch-${timestamp}-${random}`;
}

async function existsOnDisk(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveExistingBackupMetadataPath(patchId, root) {
  const candidatePaths = [
    resolveWorkspacePath(`${BACKUP_DIR}/${patchId}.json`, root),
    resolveWorkspacePath(`${LEGACY_BACKUP_DIR}/${patchId}.json`, root)
  ];

  for (const candidatePath of candidatePaths) {
    if (await existsOnDisk(candidatePath)) {
      return candidatePath;
    }
  }

  return candidatePaths[0];
}

async function readBackupMetadata(metadataPath) {
  try {
    const content = await fs.readFile(metadataPath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ToolError("Patch backup not found.", {
        code: "PATCH_NOT_FOUND"
      });
    }
    throw new ToolError(`Failed to read patch backup: ${error.message}`, {
      code: "PATCH_BACKUP_READ_ERROR"
    });
  }
}
