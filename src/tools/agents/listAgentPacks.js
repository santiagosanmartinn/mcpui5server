import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { fileExists, readJsonFile } from "../../utils/fileSystem.js";

const DEFAULT_PACK_CATALOG_PATH = ".codex/mcp/packs/catalog.json";

const inputSchema = z.object({
  packCatalogPath: z.string().min(1).optional()
}).strict();

const outputSchema = z.object({
  packCatalogPath: z.string(),
  exists: z.boolean(),
  packs: z.array(
    z.object({
      name: z.string(),
      slug: z.string(),
      version: z.string(),
      projectType: z.string(),
      fingerprint: z.string(),
      path: z.string()
    })
  )
});

export const listAgentPacksTool = {
  name: "list_agent_packs",
  description: "List saved reusable agent packs from catalog.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { packCatalogPath } = inputSchema.parse(args);
    const root = context.rootDir;
    const selectedCatalogPath = normalizePath(packCatalogPath ?? DEFAULT_PACK_CATALOG_PATH);
    enforceManagedSubtree(selectedCatalogPath, ".codex/mcp", "packCatalogPath");

    if (!(await fileExists(selectedCatalogPath, root))) {
      return outputSchema.parse({
        packCatalogPath: selectedCatalogPath,
        exists: false,
        packs: []
      });
    }

    const catalog = await readJsonFile(selectedCatalogPath, root);
    const packs = Array.isArray(catalog?.packs) ? catalog.packs : [];
    return outputSchema.parse({
      packCatalogPath: selectedCatalogPath,
      exists: true,
      packs: packs.map((pack) => ({
        name: pack.name ?? "Unnamed pack",
        slug: pack.slug ?? "",
        version: pack.version ?? "1.0.0",
        projectType: pack.projectType ?? "generic",
        fingerprint: pack.fingerprint ?? "",
        path: pack.path ?? ""
      }))
    });
  }
};

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function enforceManagedSubtree(pathValue, rootPrefix, label) {
  if (!pathValue.startsWith(`${rootPrefix}/`) && pathValue !== rootPrefix) {
    throw new ToolError(`${label} must stay inside ${rootPrefix}.`, {
      code: "INVALID_ARTIFACT_LAYOUT",
      details: {
        label,
        path: pathValue,
        expectedPrefix: rootPrefix
      }
    });
  }
}
