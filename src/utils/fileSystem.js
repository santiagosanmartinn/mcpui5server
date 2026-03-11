import path from "node:path";
import { promises as fs } from "node:fs";
import { ToolError } from "./errors.js";

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".mcp-backups",
  "dist",
  "coverage"
]);

export function workspaceRoot() {
  // Workspace root is always the current process directory.
  return path.resolve(process.cwd());
}

export function resolveWorkspacePath(inputPath, root = workspaceRoot()) {
  if (typeof inputPath !== "string" || inputPath.trim().length === 0) {
    throw new ToolError("Path must be a non-empty string.", { code: "INVALID_PATH" });
  }

  const safeRoot = path.resolve(root);
  const resolved = path.resolve(safeRoot, inputPath);
  // Prevent escaping the workspace via relative segments/symlink-like paths.
  if (!isPathInsideRoot(resolved, safeRoot)) {
    throw new ToolError("Path traversal detected. Access outside workspace is not allowed.", {
      code: "PATH_TRAVERSAL"
    });
  }

  return resolved;
}

export async function readTextFile(inputPath, root = workspaceRoot()) {
  const resolved = resolveWorkspacePath(inputPath, root);
  await assertPathExists(resolved);
  const stats = await fs.stat(resolved);
  if (!stats.isFile()) {
    throw new ToolError(`Path is not a file: ${inputPath}`, { code: "NOT_A_FILE" });
  }
  return fs.readFile(resolved, "utf8");
}

export async function readJsonFile(inputPath, root = workspaceRoot()) {
  const content = await readTextFile(inputPath, root);
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new ToolError(`Invalid JSON in ${inputPath}: ${error.message}`, {
      code: "INVALID_JSON"
    });
  }
}

export async function fileExists(inputPath, root = workspaceRoot()) {
  try {
    const resolved = resolveWorkspacePath(inputPath, root);
    await fs.access(resolved);
    return true;
  } catch {
    return false;
  }
}

export async function searchFiles(query, options = {}) {
  const {
    root = workspaceRoot(),
    maxResults = 50,
    fileExtensions = []
  } = options;

  if (typeof query !== "string" || query.trim().length === 0) {
    throw new ToolError("Query must be a non-empty string.", { code: "INVALID_QUERY" });
  }

  const resolvedRoot = path.resolve(root);
  const matches = [];
  await walk(resolvedRoot);
  return matches;

  async function walk(currentDir) {
    if (matches.length >= maxResults) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (matches.length >= maxResults) {
        break;
      }

      const absolute = path.join(currentDir, entry.name);
      const relative = path.relative(resolvedRoot, absolute);

      if (entry.isDirectory()) {
        // Skip heavy/non-source folders for predictable performance.
        if (DEFAULT_IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        await walk(absolute);
        continue;
      }

      if (fileExtensions.length > 0) {
        const extension = path.extname(entry.name).toLowerCase();
        if (!fileExtensions.includes(extension)) {
          continue;
        }
      }

      let content;
      try {
        content = await fs.readFile(absolute, "utf8");
      } catch {
        continue;
      }

      if (content.includes(query)) {
        matches.push(relative.replaceAll("\\", "/"));
      }
    }
  }
}

async function assertPathExists(absolutePath) {
  try {
    await fs.access(absolutePath);
  } catch {
    throw new ToolError(`File not found: ${absolutePath}`, { code: "FILE_NOT_FOUND" });
  }
}

function isPathInsideRoot(targetPath, rootPath) {
  // Allow the root itself or any descendant path.
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}
