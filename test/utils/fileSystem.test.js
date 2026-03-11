import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  fileExists,
  readJsonFile,
  readTextFile,
  resolveWorkspacePath,
  searchFiles
} from "../../src/utils/fileSystem.js";

describe("fileSystem utils", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-fs-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("resolves paths inside root and blocks traversal", () => {
    const ok = resolveWorkspacePath("webapp/controller/Main.controller.js", tempRoot);
    expect(ok.startsWith(tempRoot)).toBe(true);

    expect(() => resolveWorkspacePath("../outside.txt", tempRoot)).toThrow(/Path traversal detected/);
  });

  it("reads text files and reports missing paths", async () => {
    const relPath = "webapp/controller/Main.controller.js";
    const absPath = path.join(tempRoot, "webapp", "controller", "Main.controller.js");
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, "sap.ui.define([], function () {});", "utf8");

    const content = await readTextFile(relPath, tempRoot);
    expect(content).toContain("sap.ui.define");

    await expect(readTextFile("missing.js", tempRoot)).rejects.toThrow(/File not found/);
  });

  it("parses valid JSON and rejects invalid JSON", async () => {
    const goodPath = path.join(tempRoot, "good.json");
    const badPath = path.join(tempRoot, "bad.json");
    await fs.writeFile(goodPath, JSON.stringify({ ok: true }), "utf8");
    await fs.writeFile(badPath, "{ invalid json", "utf8");

    const parsed = await readJsonFile("good.json", tempRoot);
    expect(parsed).toEqual({ ok: true });
    await expect(readJsonFile("bad.json", tempRoot)).rejects.toThrow(/Invalid JSON/);
  });

  it("checks file existence", async () => {
    await fs.writeFile(path.join(tempRoot, "exists.txt"), "yes", "utf8");

    await expect(fileExists("exists.txt", tempRoot)).resolves.toBe(true);
    await expect(fileExists("does-not-exist.txt", tempRoot)).resolves.toBe(false);
  });

  it("searches files with extension filter and max results", async () => {
    await fs.writeFile(path.join(tempRoot, "a.js"), "const key = 'needle';", "utf8");
    await fs.writeFile(path.join(tempRoot, "b.txt"), "needle in text file", "utf8");
    await fs.writeFile(path.join(tempRoot, "c.js"), "no-match", "utf8");

    const onlyJs = await searchFiles("needle", {
      root: tempRoot,
      maxResults: 10,
      fileExtensions: [".js"]
    });
    expect(onlyJs).toEqual(["a.js"]);

    const firstOnly = await searchFiles("needle", {
      root: tempRoot,
      maxResults: 1
    });
    expect(firstOnly.length).toBe(1);
  });
});
