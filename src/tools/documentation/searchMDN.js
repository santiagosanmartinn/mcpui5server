import { z } from "zod";
import { fetchJson } from "../../utils/http.js";
import { ToolError } from "../../utils/errors.js";

const inputSchema = z.object({
  query: z.string().min(2),
  maxResults: z.number().int().min(1).max(20).optional()
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
  )
});

export const searchMdnTool = {
  name: "search_mdn",
  description: "Search MDN documentation for JavaScript and web platform references.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { query, maxResults } = inputSchema.parse(args);
    const endpoint = `https://developer.mozilla.org/api/v1/search?q=${encodeURIComponent(query)}&locale=en-US`;
    let payload;
    try {
      payload = await fetchJson(endpoint, {
        headers: {
          "User-Agent": "sapui5-mcp-server/1.0.0"
        }
      });
    } catch (error) {
      throw new ToolError(`Unable to fetch MDN search results: ${error.message}`, {
        code: "MDN_UNAVAILABLE"
      });
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
      results
    });
  }
};

