import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readJsonFile } from "../../utils/fileSystem.js";
import { synchronizeManifest, validateManifestStructure } from "../../utils/manifestSync.js";

const modelChangesSchema = z.object({
  upsert: z.record(z.any()).optional(),
  remove: z.array(z.string().min(1)).optional()
}).strict().optional();

const routeSchema = z.object({
  name: z.string().min(1)
}).passthrough();

const routeChangesSchema = z.object({
  upsert: z.array(routeSchema).optional(),
  removeByName: z.array(z.string().min(1)).optional()
}).strict().optional();

const targetChangesSchema = z.object({
  upsert: z.record(z.any()).optional(),
  remove: z.array(z.string().min(1)).optional()
}).strict().optional();

const inputSchema = z.object({
  manifestPath: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional(),
  changes: z.object({
    models: modelChangesSchema,
    routes: routeChangesSchema,
    targets: targetChangesSchema
  }).strict()
}).strict();

const validationSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string())
});

const summarySchema = z.object({
  modelsAdded: z.number().int().nonnegative(),
  modelsUpdated: z.number().int().nonnegative(),
  modelsRemoved: z.number().int().nonnegative(),
  routesAdded: z.number().int().nonnegative(),
  routesUpdated: z.number().int().nonnegative(),
  routesRemoved: z.number().int().nonnegative(),
  targetsAdded: z.number().int().nonnegative(),
  targetsUpdated: z.number().int().nonnegative(),
  targetsRemoved: z.number().int().nonnegative()
});

const outputSchema = z.object({
  manifestPath: z.string(),
  dryRun: z.boolean(),
  changed: z.boolean(),
  preValidation: validationSchema,
  postValidation: validationSchema,
  summary: summarySchema,
  preview: z.object({
    oldHash: z.string().nullable(),
    newHash: z.string(),
    diffPreview: z.string(),
    diffTruncated: z.boolean()
  }),
  applyResult: z.object({
    patchId: z.string().nullable(),
    appliedAt: z.string(),
    reason: z.string().nullable(),
    changedFiles: z.array(
      z.object({
        path: z.string(),
        changed: z.boolean(),
        oldHash: z.string().nullable(),
        newHash: z.string(),
        bytesBefore: z.number().int().nonnegative(),
        bytesAfter: z.number().int().nonnegative()
      })
    ),
    skippedFiles: z.array(z.string())
  }).nullable()
});

export const syncManifestJsonTool = {
  name: "sync_manifest_json",
  description: "Synchronize manifest.json models, routes, and targets with idempotent updates and optional dry-run.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { manifestPath, dryRun, reason, changes, maxDiffLines } = inputSchema.parse(args);
    const root = context.rootDir;
    const targetManifestPath = await resolveManifestPath(manifestPath, root);
    const currentManifest = await readJsonFile(targetManifestPath, root);

    const preValidation = validateManifestStructure(currentManifest);
    if (!preValidation.valid) {
      throw new ToolError("Manifest pre-validation failed.", {
        code: "MANIFEST_PRE_VALIDATION_FAILED",
        details: preValidation
      });
    }

    const syncResult = synchronizeManifest(currentManifest, changes);
    const postValidation = validateManifestStructure(syncResult.manifest);
    if (!postValidation.valid) {
      throw new ToolError("Manifest post-validation failed after synchronization.", {
        code: "MANIFEST_POST_VALIDATION_FAILED",
        details: postValidation
      });
    }

    const nextContent = `${JSON.stringify(syncResult.manifest, null, 2)}\n`;
    const preview = await previewFileWrite(targetManifestPath, nextContent, {
      root,
      maxDiffLines
    });

    let applyResult = null;
    const shouldDryRun = dryRun ?? true;
    if (!shouldDryRun && preview.changed) {
      applyResult = await applyProjectPatch(
        [{
          path: targetManifestPath,
          content: nextContent,
          expectedOldHash: preview.oldHash ?? undefined
        }],
        {
          root,
          reason: reason ?? "sync_manifest_json"
        }
      );
    }

    return outputSchema.parse({
      manifestPath: targetManifestPath,
      dryRun: shouldDryRun,
      changed: preview.changed,
      preValidation,
      postValidation,
      summary: syncResult.summary,
      preview: {
        oldHash: preview.oldHash,
        newHash: preview.newHash,
        diffPreview: preview.diffPreview,
        diffTruncated: preview.diffTruncated
      },
      applyResult
    });
  }
};

async function resolveManifestPath(manifestPath, root) {
  if (manifestPath) {
    return manifestPath.replaceAll("\\", "/");
  }

  const webappManifest = "webapp/manifest.json";
  if (await fileExists(webappManifest, root)) {
    return webappManifest;
  }

  const rootManifest = "manifest.json";
  if (await fileExists(rootManifest, root)) {
    return rootManifest;
  }

  throw new ToolError("No manifest.json found in workspace (checked webapp/manifest.json and manifest.json).", {
    code: "MANIFEST_NOT_FOUND"
  });
}
