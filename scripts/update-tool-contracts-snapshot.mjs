/* global process, console */
import path from "node:path";
import { promises as fs } from "node:fs";
import { allTools } from "../src/tools/index.js";
import { createToolContractSnapshot } from "../src/utils/toolContracts.js";

const SNAPSHOT_PATH = path.resolve(process.cwd(), "docs/contracts/tool-contracts.snapshot.json");

async function main() {
  const snapshot = createToolContractSnapshot(allTools);
  await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  await fs.writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`Tool contract snapshot updated: ${SNAPSHOT_PATH}`);
}

main().catch((error) => {
  console.error("Failed to update tool contract snapshot.", error);
  process.exit(1);
});
