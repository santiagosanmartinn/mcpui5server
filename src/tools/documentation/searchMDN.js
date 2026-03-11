import { z } from "zod";
import { fetchJson } from "../../utils/http.js";
import { ToolError } from "../../utils/errors.js";

import { buildCacheKey, normalizeCacheOptions, readCacheEntry, writeCacheEntry } from "./cacheStore.js";

const cacheSchema = z.object({
  enabled: z.boolean().optional(),
  ttlSeconds: z.number().int().min(60).max(7 * 24 * 3600).optional(),
  forceRefresh: z.boolean().optional()
}).strict().optional();

const inputSchema = z.object({
  query: z.string().min(2),
  maxResults: z.number().int().min(1).max(20).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  cache: cacheSchema
}).strict();

const outputSchema = z.object({
  query: z.string(),
  source: z.string(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      summary: z.string()
    })
  ),
  trace: z.object({
    provider: z.literal("mdn"),
    queriedAt: z.string(),
    fetchedAt: z.string(),
    timeoutMs: z.number().int().positive(),
    cache: z.object({
      enabled: z.boolean(),
      hit: z.boolean(),
      forceRefresh: z.boolean(),
      ttlSeconds: z.number().int().positive(),
      key: z.string(),
      path: z.string().nullable()
    })
  })
});

export const searchMdnTool = {
  name: "search_mdn",
  description: "Search MDN documentation for JavaScript and web platform references.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { query, maxResults, timeoutMs, cache } = inputSchema.parse(args);
    const root = context.rootDir;
    const effectiveTimeoutMs = timeoutMs ?? 15000;
    const cacheOptions = normalizeCacheOptions(cache);
    // Uses official MDN API endpoint to return lightweight references.
    const endpoint = `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(query)}&locale=en-US`;
    const cacheKey = buildCacheKey("mdn-search", {
      endpoint
    });
    const queriedAt = new Date().toISOString();
    let fetchedAt = queriedAt;
    let cacheHit = false;
    let cachePath = null;
    let payload = null;

    if (cacheOptions.enabled && !cacheOptions.forceRefresh) {
      const cached = await readCacheEntry({
        root,
        cacheKey,
        ttlSeconds: cacheOptions.ttlSeconds
      });
      if (cached) {
        payload = cached.data;
        fetchedAt = cached.fetchedAt;
        cachePath = cached.cachePath;
        cacheHit = true;
      }
    }

    if (!payload) {
      try {
        payload = await fetchJson(endpoint, {
          timeoutMs: effectiveTimeoutMs,
          headers: {
            "User-Agent": "sapui5-mcp-server/1.0.0"
          }
        });
      } catch (error) {
        throw new ToolError(`Unable to fetch MDN search results: ${error.message}`, {
          code: "MDN_UNAVAILABLE"
        });
      }
      if (cacheOptions.enabled) {
        const written = await writeCacheEntry({
          root,
          cacheKey,
          data: payload
        });
        cachePath = written.cachePath;
        fetchedAt = written.fetchedAt;
      }
    }

    const documents = Array.isArray(payload?.documents) ? payload.documents : [];
    const results = documents.slice(0, maxResults ?? 5).map((item) => ({
      title: item.title ?? "Untitled",
      url: item.mdn_url ? `https://developer.mozilla.org${item.mdn_url}` : "https://developer.mozilla.org",
      summary: item.summary ?? "MDN reference entry."
    }));

    return outputSchema.parse({
      query,
      source: endpoint,
      results,
      trace: {
        provider: "mdn",
        queriedAt,
        fetchedAt,
        timeoutMs: effectiveTimeoutMs,
        cache: {
          enabled: cacheOptions.enabled,
          hit: cacheHit,
          forceRefresh: cacheOptions.forceRefresh,
          ttlSeconds: cacheOptions.ttlSeconds,
          key: cacheKey,
          path: cachePath
        }
      }
    });
  }
};
