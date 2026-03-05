#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { exec } from "node:child_process";
import path from "node:path";
import { z } from "zod";

const SERVER_INFO = {
  name: "sapui5-docs-examples",
  version: "0.1.0"
};

const USER_AGENT = process.env.UI5_HTTP_USER_AGENT ?? "sapui5-mcp-server/0.1.0";
const HTTP_TIMEOUT_MS = clampInteger(process.env.UI5_HTTP_TIMEOUT_MS, 15000, 1000, 120000);
const CACHE_TTL_MS = clampInteger(process.env.UI5_CACHE_TTL_MS, 300000, 1000, 3600000);
const SOURCE_STRATEGY = (process.env.UI5_SOURCE_STRATEGY ?? "live").toLowerCase();
const DEFAULT_UI5_VERSION = process.env.UI5_VERSION ?? "latest";

const responseCache = new Map();

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function resolveLimit(limit, fallback = 5, max = 20) {
  const parsed = Number.parseInt(String(limit ?? ""), 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(parsed, max));
}

function resolveUi5Version(ui5Version) {
  if (!ui5Version) {
    return DEFAULT_UI5_VERSION;
  }
  return ui5Version;
}

function sdkBaseUrl(ui5Version) {
  const resolved = resolveUi5Version(ui5Version);
  if (!resolved || resolved === "latest") {
    return "https://ui5.sap.com";
  }
  return `https://ui5.sap.com/${resolved}`;
}

function createAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout)
  };
}

function fromCache(key) {
  if (SOURCE_STRATEGY !== "cache") {
    return null;
  }

  const hit = responseCache.get(key);
  if (!hit) {
    return null;
  }

  if (Date.now() > hit.expiresAt) {
    responseCache.delete(key);
    return null;
  }

  return hit.value;
}

function toCache(key, value) {
  if (SOURCE_STRATEGY !== "cache") {
    return;
  }

  responseCache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

async function fetchJson(url) {
  const key = `json:${url}`;
  const cached = fromCache(key);
  if (cached) {
    return cached;
  }

  const { signal, cleanup } = createAbortSignal(HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT
      },
      signal
    });

    if (!response.ok) {
      const rateRemaining = response.headers.get("x-ratelimit-remaining");
      const rateReset = response.headers.get("x-ratelimit-reset");
      const rateHint = rateRemaining === "0" && rateReset
        ? ` GitHub rate limit reset epoch: ${rateReset}.`
        : "";
      throw new Error(`HTTP ${response.status} while requesting ${url}.${rateHint}`);
    }

    const json = await response.json();
    toCache(key, json);
    return json;
  } finally {
    cleanup();
  }
}

async function fetchText(url) {
  const key = `text:${url}`;
  const cached = fromCache(key);
  if (cached) {
    return cached;
  }

  const { signal, cleanup } = createAbortSignal(HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while requesting ${url}.`);
    }

    const text = await response.text();
    toCache(key, text);
    return text;
  } finally {
    cleanup();
  }
}

function buildGitHubCodeSearchUrl({ repo, query, path, perPage }) {
  const q = `${query} repo:${repo} path:${path}`;
  return `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${perPage}`;
}

function simplifyDocItem(item) {
  return {
    title: item.name.replace(/\.md$/i, "").replace(/-/g, " "),
    path: item.path,
    url: item.html_url,
    rawUrl: `https://raw.githubusercontent.com/SAP-docs/sapui5/main/${item.path}`
  };
}

function simplifyExampleItem(item, ui5Version) {
  const sourcePath = item.path;
  const rawUrl = `https://raw.githubusercontent.com/SAP/openui5/master/${sourcePath}`;
  const folder = sourcePath.split("/").slice(0, -1).join("/");
  const sdkLink = buildSdkExampleLink(folder, ui5Version);

  return {
    path: sourcePath,
    url: item.html_url,
    rawUrl,
    sdkLink
  };
}

function buildSdkExampleLink(folderPath, ui5Version) {
  const marker = "/test/";
  const idx = folderPath.indexOf(marker);
  if (idx === -1) {
    return null;
  }

  const relative = folderPath.slice(idx + marker.length);
  const base = sdkBaseUrl(ui5Version);
  return `${base}/test-resources/${relative}/`;
}

function normalizeDocPath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("path is required");
  }

  let path = inputPath.trim().replace(/^\/+/, "");
  if (path.includes("..")) {
    throw new Error("path must not contain '..'");
  }

  if (!path.startsWith("docs/")) {
    path = `docs/${path}`;
  }

  if (!path.toLowerCase().endsWith(".md")) {
    path = `${path}.md`;
  }

  return path;
}

function asTextResult(text) {
  return {
    content: [{ type: "text", text }]
  };
}

function asToolError(error) {
  return {
    content: [{
      type: "text",
      text: `Request failed: ${error instanceof Error ? error.message : String(error)}`
    }],
    isError: true
  };
}

function formatCommandResult(command, stdout, stderr, exitCode = 0) {
  return [
    `$ ${command}`,
    `exitCode: ${exitCode}`,
    "",
    "stdout:",
    stdout?.trim() ? stdout.trim() : "(empty)",
    "",
    "stderr:",
    stderr?.trim() ? stderr.trim() : "(empty)"
  ].join("\n");
}

function execCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject({
          command,
          error,
          stdout: stdout ?? "",
          stderr: stderr ?? ""
        });
        return;
      }

      resolve({
        command,
        stdout: stdout ?? "",
        stderr: stderr ?? ""
      });
    });
  });
}

const server = new McpServer(SERVER_INFO);

server.tool(
  "create_ui5_app_and_run",
  {
    projectName: z.string().min(1)
  },
  async ({ projectName }) => {
    const trimmedProjectName = projectName.trim();
    const projectDir = path.resolve(process.cwd(), trimmedProjectName);
    const commandOutputs = [];

    try {
      const scaffoldCommand = `yo @sap/fiori:headless ui5config.json ${trimmedProjectName}`;
      const scaffoldResult = await execCommand(scaffoldCommand, { cwd: process.cwd() });
      commandOutputs.push(formatCommandResult(scaffoldCommand, scaffoldResult.stdout, scaffoldResult.stderr, 0));

      const installCommand = "npm install";
      const installResult = await execCommand(installCommand, { cwd: projectDir });
      commandOutputs.push(formatCommandResult(installCommand, installResult.stdout, installResult.stderr, 0));

      const serveCommand = "npx ui5 serve -o index.html";
      const serveProcess = exec(serveCommand, { cwd: projectDir });

      let serveStdout = "";
      let serveStderr = "";
      serveProcess.stdout?.on("data", (chunk) => {
        serveStdout += String(chunk);
      });
      serveProcess.stderr?.on("data", (chunk) => {
        serveStderr += String(chunk);
      });

      await new Promise((resolve) => {
        const done = () => resolve();
        const timer = setTimeout(done, 2500);

        serveProcess.once("spawn", () => {
          clearTimeout(timer);
          setTimeout(done, 1000);
        });

        serveProcess.once("error", () => {
          clearTimeout(timer);
          done();
        });

        serveProcess.once("exit", () => {
          clearTimeout(timer);
          done();
        });
      });

      const isRunning = serveProcess.exitCode === null && !serveProcess.killed;
      const serveExit = serveProcess.exitCode === null ? "N/A (process still running)" : serveProcess.exitCode;
      commandOutputs.push(formatCommandResult(serveCommand, serveStdout, serveStderr, serveExit));

      return asTextResult([
        `Project: ${trimmedProjectName}`,
        `Project directory: ${projectDir}`,
        `Server status: ${isRunning ? "running" : "not running"}`,
        "",
        ...commandOutputs
      ].join("\n"));
    } catch (failure) {
      const command = failure?.command ?? "unknown command";
      const stderr = failure?.stderr ?? failure?.error?.message ?? "No stderr captured.";
      const stdout = failure?.stdout ?? "";
      const exitCode = Number.isNaN(Number.parseInt(String(failure?.error?.code), 10))
        ? 1
        : Number.parseInt(String(failure.error.code), 10);
      const details = formatCommandResult(command, stdout, stderr, exitCode);

      return {
        content: [{
          type: "text",
          text: [
            `Project: ${trimmedProjectName}`,
            `Project directory: ${projectDir}`,
            "Server status: not running",
            "",
            "Command failed:",
            details
          ].join("\n")
        }],
        isError: true
      };
    }
  }
);

server.tool(
  "search_ui5_docs",
  {
    query: z.string().min(2),
    limit: z.number().int().min(1).max(20).optional()
  },
  async ({ query, limit }) => {
    try {
      const effectiveLimit = resolveLimit(limit, 5, 20);
      const url = buildGitHubCodeSearchUrl({
        repo: "SAP-docs/sapui5",
        query,
        path: "docs",
        perPage: effectiveLimit
      });

      const payload = await fetchJson(url);
      const items = (payload.items ?? []).slice(0, effectiveLimit).map(simplifyDocItem);

      const lines = [
        `SAPUI5 docs matches for \"${query}\": ${items.length}`,
        `Source strategy: ${SOURCE_STRATEGY}`,
        ""
      ];

      if (!items.length) {
        lines.push("No matches found.");
      } else {
        for (const item of items) {
          lines.push(`- ${item.title}`);
          lines.push(`  Path: ${item.path}`);
          lines.push(`  GitHub: ${item.url}`);
          lines.push(`  Raw: ${item.rawUrl}`);
        }
      }

      return asTextResult(lines.join("\n"));
    } catch (error) {
      return asToolError(error);
    }
  }
);

server.tool(
  "get_ui5_doc_content",
  {
    path: z.string().min(1),
    maxChars: z.number().int().min(1000).max(120000).optional()
  },
  async ({ path, maxChars }) => {
    try {
      const normalizedPath = normalizeDocPath(path);
      const rawUrl = `https://raw.githubusercontent.com/SAP-docs/sapui5/main/${normalizedPath}`;
      const githubUrl = `https://github.com/SAP-docs/sapui5/blob/main/${normalizedPath}`;
      const fullText = await fetchText(rawUrl);
      const charLimit = clampInteger(maxChars, 12000, 1000, 120000);
      const wasTrimmed = fullText.length > charLimit;
      const excerpt = wasTrimmed ? `${fullText.slice(0, charLimit)}\n\n[...truncated...]` : fullText;

      const lines = [
        `Path: ${normalizedPath}`,
        `GitHub: ${githubUrl}`,
        `Raw: ${rawUrl}`,
        "",
        excerpt
      ];

      return asTextResult(lines.join("\n"));
    } catch (error) {
      return asToolError(error);
    }
  }
);

server.tool(
  "search_ui5_examples",
  {
    query: z.string().min(2),
    limit: z.number().int().min(1).max(20).optional(),
    ui5Version: z.string().optional()
  },
  async ({ query, limit, ui5Version }) => {
    try {
      const effectiveLimit = resolveLimit(limit, 8, 20);
      const resolvedVersion = resolveUi5Version(ui5Version);

      const searches = [
        buildGitHubCodeSearchUrl({
          repo: "SAP/openui5",
          query,
          path: "demokit/sample",
          perPage: effectiveLimit
        }),
        buildGitHubCodeSearchUrl({
          repo: "SAP/openui5",
          query,
          path: "demokit/tutorial",
          perPage: effectiveLimit
        })
      ];

      const [samplePayload, tutorialPayload] = await Promise.all(searches.map((url) => fetchJson(url)));
      const allItems = [...(samplePayload.items ?? []), ...(tutorialPayload.items ?? [])];

      const deduped = [];
      const seen = new Set();
      for (const item of allItems) {
        if (seen.has(item.path)) {
          continue;
        }
        seen.add(item.path);
        deduped.push(item);
        if (deduped.length >= effectiveLimit) {
          break;
        }
      }

      const mapped = deduped.map((item) => simplifyExampleItem(item, resolvedVersion));
      const lines = [
        `SAPUI5 example matches for \"${query}\": ${mapped.length}`,
        `UI5 version base: ${resolvedVersion}`,
        `SDK base URL: ${sdkBaseUrl(resolvedVersion)}`,
        ""
      ];

      if (!mapped.length) {
        lines.push("No matches found in demokit sample/tutorial paths.");
      } else {
        for (const item of mapped) {
          lines.push(`- Path: ${item.path}`);
          lines.push(`  GitHub: ${item.url}`);
          lines.push(`  Raw: ${item.rawUrl}`);
          if (item.sdkLink) {
            lines.push(`  SDK test-resources: ${item.sdkLink}`);
          }
        }
      }

      return asTextResult(lines.join("\n"));
    } catch (error) {
      return asToolError(error);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start SAPUI5 MCP server:", error);
  process.exit(1);
});

process.stdin.on("close", () => {
  if (typeof server.close === "function") {
    server.close().catch(() => {
      // Best effort shutdown.
    });
  }
});
