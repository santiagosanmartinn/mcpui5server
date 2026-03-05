import { z } from "zod";
import { fetchJson } from "../../utils/http.js";
import { ToolError } from "../../utils/errors.js";

const SDK_INDEX_URL = "https://ui5.sap.com/test-resources/sap/ui/documentation/sdk/inverted-index.json";

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
      summary: z.string(),
      example: z.string()
    })
  )
});

export const searchUi5SdkTool = {
  name: "search_ui5_sdk",
  description: "Search official SAPUI5 SDK metadata and return API/topic summaries with examples.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { query, maxResults } = inputSchema.parse(args);
    // Pull SDK index and map it to a stable result contract.
    const data = await fetchSdkIndex();
    const allEntries = normalizeSdkEntries(data);
    const matches = filterEntries(allEntries, query).slice(0, maxResults ?? 5);

    return outputSchema.parse({
      query,
      source: SDK_INDEX_URL,
      results: matches.map((entry) => ({
        title: entry.title,
        url: entry.url,
        summary: entry.summary,
        example: entry.example
      }))
    });
  }
};

async function fetchSdkIndex() {
  try {
    return await fetchJson(SDK_INDEX_URL, {
      headers: {
        "User-Agent": "sapui5-mcp-server/1.0.0"
      }
    });
  } catch (error) {
    throw new ToolError(`Unable to fetch SAPUI5 SDK index: ${error.message}`, {
      code: "UI5_SDK_UNAVAILABLE"
    });
  }
}

function normalizeSdkEntries(data) {
  // SDK endpoint shape may vary; normalize known variants.
  if (Array.isArray(data)) {
    return data.map((item) => normalizeEntry(item)).filter(Boolean);
  }

  if (data?.symbols && typeof data.symbols === "object") {
    return Object.keys(data.symbols).map((name) => ({
      title: name,
      url: `https://ui5.sap.com/#/api/${encodeURIComponent(name)}`,
      summary: "API symbol in SAPUI5 SDK.",
      example: `sap.ui.require(["${name.replace(/\./g, "/")}"], function (SymbolRef) {\n  void SymbolRef;\n});`
    }));
  }

  if (data && typeof data === "object") {
    return Object.entries(data).map(([key, value]) => normalizeEntry({ key, value })).filter(Boolean);
  }

  return [];
}

function normalizeEntry(entry) {
  const title = entry?.title ?? entry?.name ?? entry?.key;
  if (!title || typeof title !== "string") {
    return null;
  }

  const relativeUrl = entry?.url ?? entry?.href ?? "";
  const url = relativeUrl.startsWith("http")
    ? relativeUrl
    : relativeUrl
      ? `https://ui5.sap.com${relativeUrl}`
      : `https://ui5.sap.com/#/search/${encodeURIComponent(title)}`;

  const summary = typeof entry?.summary === "string"
    ? entry.summary
    : "Official SAPUI5 SDK entry.";

  const example = typeof entry?.example === "string"
    ? entry.example
    : `// Example usage for ${title}\nsap.ui.require([], function () {\n  // TODO: add implementation\n});`;

  return { title, url, summary, example };
}

function filterEntries(entries, query) {
  const q = query.toLowerCase();
  return entries.filter((entry) => {
    return (
      entry.title.toLowerCase().includes(q) ||
      entry.summary.toLowerCase().includes(q) ||
      entry.url.toLowerCase().includes(q)
    );
  });
}
