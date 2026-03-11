import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { applyProjectPatch, previewFileWrite, rollbackProjectPatch } from "../../src/utils/patchWriter.js";

describe("patchWriter utils", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-patch-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("builds preview with hashes and line summary", async () => {
    const filePath = path.join(tempRoot, "webapp", "view", "Main.view.xml");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "<View>\n  <Text text=\"Old\" />\n</View>", "utf8");

    const preview = await previewFileWrite(
      "webapp/view/Main.view.xml",
      "<View>\n  <Text text=\"New\" />\n</View>",
      { root: tempRoot }
    );

    expect(preview.existsBefore).toBe(true);
    expect(preview.changed).toBe(true);
    expect(preview.oldHash).not.toBeNull();
    expect(preview.newHash).not.toBe(preview.oldHash);
    expect(preview.lineSummary.changed).toBeGreaterThan(0);
    expect(preview.diffPreview).toContain("Old");
    expect(preview.diffPreview).toContain("New");
  });

  it("applies and rolls back patch for existing file", async () => {
    const filePath = path.join(tempRoot, "webapp", "controller", "Main.controller.js");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "const version = 1;\n", "utf8");

    const preview = await previewFileWrite("webapp/controller/Main.controller.js", "const version = 2;\n", {
      root: tempRoot
    });
    const applied = await applyProjectPatch(
      [{
        path: "webapp/controller/Main.controller.js",
        content: "const version = 2;\n",
        expectedOldHash: preview.oldHash
      }],
      {
        root: tempRoot,
        reason: "upgrade version"
      }
    );

    expect(applied.patchId).toMatch(/^patch-/);
    expect(applied.changedFiles).toHaveLength(1);
    expect(await fs.readFile(filePath, "utf8")).toBe("const version = 2;\n");

    const rollback = await rollbackProjectPatch(applied.patchId, { root: tempRoot });
    expect(rollback.alreadyRolledBack).toBe(false);
    expect(rollback.restoredFiles[0].action).toBe("restored");
    expect(await fs.readFile(filePath, "utf8")).toBe("const version = 1;\n");

    const secondRollback = await rollbackProjectPatch(applied.patchId, { root: tempRoot });
    expect(secondRollback.alreadyRolledBack).toBe(true);
  });

  it("creates new file and rollback deletes it", async () => {
    const relativePath = "webapp/model/new.json";
    const absolutePath = path.join(tempRoot, "webapp", "model", "new.json");

    const applied = await applyProjectPatch(
      [{
        path: relativePath,
        content: "{\"created\":true}\n"
      }],
      { root: tempRoot }
    );

    expect(await fs.readFile(absolutePath, "utf8")).toContain("\"created\":true");
    const rollback = await rollbackProjectPatch(applied.patchId, { root: tempRoot });
    expect(rollback.restoredFiles[0].action).toBe("deleted");
    await expect(fs.access(absolutePath)).rejects.toThrow();
  });

  it("rejects apply when expected hash does not match", async () => {
    const filePath = path.join(tempRoot, "webapp", "controller", "App.controller.js");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "const status = \"old\";\n", "utf8");

    await expect(
      applyProjectPatch(
        [{
          path: "webapp/controller/App.controller.js",
          content: "const status = \"new\";\n",
          expectedOldHash: "0".repeat(64)
        }],
        { root: tempRoot }
      )
    ).rejects.toMatchObject({ code: "BASE_HASH_MISMATCH" });

    expect(await fs.readFile(filePath, "utf8")).toBe("const status = \"old\";\n");
  });
});
