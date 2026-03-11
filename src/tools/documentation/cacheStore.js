import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { resolveWorkspacePath } from "../../utils/fileSystem.js";

const CACHE_BASE_DIR = ".mcp-cache/documentation";

export function normalizeCacheOptions(cache) {
  return {
    enabled: cache?.enabled ?? false,
    ttlSeconds: cache?.ttlSeconds ?? 3600,
    forceRefresh: cache?.forceRefresh ?? false
  };
}

export function buildCacheKey(prefix, payload) {
  const hash = crypto
    .createHash("sha256")
    .update(`${prefix}:${JSON.stringify(payload)}`, "utf8")
    .digest("hex");
  return `${prefix}-${hash}`;
}

export async function readCacheEntry(options) {
  const { root, cacheKey, ttlSeconds } = options;
  const cachePath = resolveWorkspacePath(`${CACHE_BASE_DIR}/${cacheKey}.json`, root);
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    const fetchedAt = Date.parse(parsed?.fetchedAt ?? "");
    if (!Number.isFinite(fetchedAt)) {
      return null;
    }

    const expiresAt = fetchedAt + ttlSeconds * 1000;
    if (Date.now() > expiresAt) {
      return null;
    }

    return {
      cachePath: normalizeRelative(cachePath, root),
      fetchedAt: parsed.fetchedAt,
      data: parsed.data
    };
  } catch {
    return null;
  }
}

export async function writeCacheEntry(options) {
  const { root, cacheKey, data } = options;
  const cachePath = resolveWorkspacePath(`${CACHE_BASE_DIR}/${cacheKey}.json`, root);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const payload = {
    fetchedAt: new Date().toISOString(),
    data
  };
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), "utf8");
  return {
    cachePath: normalizeRelative(cachePath, root),
    fetchedAt: payload.fetchedAt
  };
}

function normalizeRelative(absolutePath, root) {
  return path.relative(path.resolve(root), absolutePath).replaceAll("\\", "/");
}
