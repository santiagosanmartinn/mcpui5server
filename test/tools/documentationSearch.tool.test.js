import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { searchUi5SdkTool } from "../../src/tools/documentation/searchUI5SDK.js";
import { searchMdnTool } from "../../src/tools/documentation/searchMDN.js";

describe("documentation search tools with cache/trace", () => {
  let tempRoot;
  let originalFetch;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-doc-search-"));
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("uses optional cache in search_ui5_sdk", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return {
        ok: true,
        json: async () => ({
          symbols: {
            "sap.m.Button": {},
            "sap.m.Table": {}
          }
        })
      };
    };

    const first = await searchUi5SdkTool.handler(
      {
        query: "sap.m.Table",
        cache: {
          enabled: true,
          ttlSeconds: 3600
        }
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    const second = await searchUi5SdkTool.handler(
      {
        query: "sap.m.Table",
        cache: {
          enabled: true,
          ttlSeconds: 3600
        }
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(fetchCalls).toBe(1);
    expect(first.trace.cache.hit).toBe(false);
    expect(second.trace.cache.hit).toBe(true);
    expect(second.trace.cache.path).toContain(".mcp-cache/documentation");
  });

  it("returns trace metadata and supports configurable timeout in search_mdn", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return {
        ok: true,
        json: async () => ({
          documents: [
            {
              title: "Array.prototype.map()",
              mdn_url: "/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map",
              summary: "Creates a new array populated with the results of calling a provided function."
            }
          ]
        })
      };
    };

    const result = await searchMdnTool.handler(
      {
        query: "Array.prototype.map",
        timeoutMs: 7000,
        cache: {
          enabled: true,
          ttlSeconds: 3600
        }
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(fetchCalls).toBe(1);
    expect(result.trace.provider).toBe("mdn");
    expect(result.trace.timeoutMs).toBe(7000);
    expect(result.trace.queriedAt).toBeTruthy();
    expect(result.trace.fetchedAt).toBeTruthy();
    expect(result.trace.cache.enabled).toBe(true);
  });
});
