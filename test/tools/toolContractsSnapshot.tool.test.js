import { promises as fs } from "node:fs";
import { allTools } from "../../src/tools/index.js";
import { createToolContractSnapshot } from "../../src/utils/toolContracts.js";

const SNAPSHOT_PATH = "docs/contracts/tool-contracts.snapshot.json";

describe("tool contracts snapshot", () => {
  it("matches committed tool contract snapshot", async () => {
    const expectedRaw = await fs.readFile(SNAPSHOT_PATH, "utf8");
    const expected = JSON.parse(expectedRaw);
    const current = createToolContractSnapshot(allTools);

    expect(current).toEqual(expected);
  });
});

