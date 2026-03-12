import path from "node:path";
import { promises as fs } from "node:fs";
import { allTools } from "../../src/tools/index.js";

describe("tool catalog consistency", () => {
  it("keeps unique tool names in runtime catalog", () => {
    const names = allTools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps all discovered tool modules registered in allTools", async () => {
    const discoveredTools = await discoverToolDefinitions(path.resolve("src/tools"));
    const discoveredNames = discoveredTools.map((item) => item.toolName);
    const registeredNames = allTools.map((tool) => tool.name);

    expect(discoveredNames.length).toBe(registeredNames.length);
    expect(difference(discoveredNames, registeredNames)).toEqual([]);
    expect(difference(registeredNames, discoveredNames)).toEqual([]);
  });

  it("keeps reference and examples docs aligned with runtime catalog", async () => {
    const referenceDoc = await fs.readFile("docs/referencia-tools.md", "utf8");
    const examplesDoc = await fs.readFile("docs/ejemplos-tools.md", "utf8");
    const runtimeNames = allTools.map((tool) => tool.name);

    const referenceNames = Array.from(referenceDoc.matchAll(/^### `([^`]+)`$/gm)).map((match) => match[1]);
    const exampleNames = Array.from(examplesDoc.matchAll(/^## \d+\) `([^`]+)`$/gm)).map((match) => match[1]);

    expect(new Set(referenceNames).size).toBe(referenceNames.length);
    expect(new Set(exampleNames).size).toBe(exampleNames.length);
    expect(difference(runtimeNames, referenceNames)).toEqual([]);
    expect(difference(referenceNames, runtimeNames)).toEqual([]);
    expect(difference(runtimeNames, exampleNames)).toEqual([]);
    expect(difference(exampleNames, runtimeNames)).toEqual([]);
  });
});

async function discoverToolDefinitions(rootDir) {
  const files = [];
  await walk(rootDir, files);
  const discovered = [];
  const matcher = /export const\s+([A-Za-z0-9_]+Tool)\s*=\s*\{[\s\S]*?\n\s*name:\s*"([a-z0-9_]+)"/m;

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const match = content.match(matcher);
    if (!match) {
      continue;
    }
    discovered.push({
      file: path.relative(process.cwd(), file).replaceAll("\\", "/"),
      exportName: match[1],
      toolName: match[2]
    });
  }

  return discovered;
}

async function walk(currentDir, files) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walk(absolutePath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(absolutePath);
    }
  }
}

function difference(a, b) {
  const bSet = new Set(b);
  return a.filter((item) => !bSet.has(item));
}

