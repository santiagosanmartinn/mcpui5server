import { ToolError } from "./errors.js";

export async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  return response.json();
}

export async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  return response.text();
}

async function fetchWithTimeout(url, options = {}) {
  const {
    timeoutMs = 15000,
    headers = {}
  } = options;

  const controller = new AbortController();
  // Hard timeout avoids hanging tool calls in MCP clients.
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new ToolError(`HTTP ${response.status} for ${url}`, { code: "HTTP_ERROR" });
    }

    return response;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ToolError(`Request timed out for ${url}`, { code: "HTTP_TIMEOUT" });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
