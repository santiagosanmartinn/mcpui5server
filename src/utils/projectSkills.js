import { z } from "zod";
import { ToolError } from "./errors.js";
import { fileExists, readJsonFile } from "./fileSystem.js";

export const SKILL_STATUSES = ["experimental", "candidate", "recommended", "deprecated"];
export const SKILL_OUTCOMES = ["success", "partial", "failed"];
export const DEFAULT_SKILLS_ROOT_DIR = ".codex/mcp/skills";
export const DEFAULT_SKILL_CATALOG_PATH = `${DEFAULT_SKILLS_ROOT_DIR}/catalog.json`;
export const DEFAULT_SKILL_FEEDBACK_PATH = `${DEFAULT_SKILLS_ROOT_DIR}/feedback/executions.jsonl`;
export const DEFAULT_SKILL_METRICS_PATH = `${DEFAULT_SKILLS_ROOT_DIR}/feedback/metrics.json`;
export const DEFAULT_SKILLS_DOC_PATH = "docs/mcp/skills.md";

const OFFICIAL_REFERENCE_HOSTS = new Set([
  "ui5.sap.com",
  "sapui5.hana.ondemand.com",
  "experience.sap.com",
  "help.sap.com",
  "sap.com",
  "developer.mozilla.org",
  "ecma-international.org",
  "tc39.es"
]);

export const officialReferenceSchema = z.string().url().refine((value) => isOfficialReferenceUrl(value), {
  message: "Reference must point to an official SAP/UI5/MDN/ECMAScript source."
});

export const skillEntrySchema = z.object({
  id: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  title: z.string().min(3).max(120),
  goal: z.string().min(10).max(400),
  whenToUse: z.string().min(10).max(400),
  workflowSteps: z.array(z.string().min(5).max(240)).min(3).max(20),
  officialReferences: z.array(officialReferenceSchema).min(1).max(20),
  tags: z.array(z.string().min(2).max(60)).max(20),
  status: z.enum(SKILL_STATUSES),
  version: z.string().min(1).max(40),
  owner: z.enum(["system", "user"]),
  filePath: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

export const skillCatalogSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  generatedAt: z.string().datetime(),
  project: z.object({
    name: z.string().nullable(),
    type: z.enum(["sapui5", "node", "generic"]).nullable(),
    namespace: z.string().nullable(),
    ui5Version: z.string().nullable()
  }),
  skills: z.array(skillEntrySchema)
}).strict();

export const skillMetricsEntrySchema = z.object({
  skillId: z.string(),
  executions: z.number().int().nonnegative(),
  outcomes: z.object({
    success: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative()
  }),
  qualityGatePasses: z.number().int().nonnegative(),
  qualityGateFails: z.number().int().nonnegative(),
  usefulnessTotal: z.number().int().nonnegative(),
  usefulnessCount: z.number().int().nonnegative(),
  timeSavedMinutesTotal: z.number().int().nonnegative(),
  tokenDeltaEstimateTotal: z.number().int(),
  tags: z.record(z.string(), z.number().int().nonnegative()),
  lastRecordedAt: z.string().datetime().nullable()
}).strict();

export const skillMetricsSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  generatedAt: z.string().datetime(),
  totals: z.object({
    executions: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative()
  }),
  skills: z.record(z.string(), skillMetricsEntrySchema)
}).strict();

export function createDefaultSkillMetrics() {
  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    totals: {
      executions: 0,
      success: 0,
      partial: 0,
      failed: 0
    },
    skills: {}
  };
}

export async function readOrCreateSkillCatalog(catalogPath, root, project) {
  if (!(await fileExists(catalogPath, root))) {
    return {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      project: normalizeProjectProfile(project),
      skills: []
    };
  }

  const parsed = await readJsonFile(catalogPath, root);
  const result = skillCatalogSchema.safeParse(parsed);
  if (!result.success) {
    throw new ToolError(`Invalid skill catalog schema at ${catalogPath}.`, {
      code: "INVALID_PROJECT_SKILL_CATALOG",
      details: {
        path: catalogPath,
        issue: result.error.issues[0] ?? null
      }
    });
  }

  return result.data;
}

export async function readOrCreateSkillMetrics(metricsPath, root) {
  if (!(await fileExists(metricsPath, root))) {
    return createDefaultSkillMetrics();
  }

  try {
    const parsed = await readJsonFile(metricsPath, root);
    const result = skillMetricsSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
  } catch {
    // Fall back to empty metrics if invalid/corrupt.
  }

  return createDefaultSkillMetrics();
}

export function isOfficialReferenceUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (OFFICIAL_REFERENCE_HOSTS.has(host)) {
    return true;
  }
  for (const allowed of OFFICIAL_REFERENCE_HOSTS) {
    if (host.endsWith(`.${allowed}`)) {
      return true;
    }
  }
  return false;
}

export function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

export function joinPath(...segments) {
  return segments.filter(Boolean).join("/").replaceAll("\\", "/").replace(/\/{2,}/g, "/");
}

export function enforceManagedSubtree(pathValue, rootPrefix, label) {
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

export function toSkillId(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function unique(values) {
  return Array.from(new Set(values));
}

function normalizeProjectProfile(project) {
  const safe = project && typeof project === "object" ? project : {};
  return {
    name: typeof safe.name === "string" ? safe.name : null,
    type: safe.type === "sapui5" || safe.type === "node" || safe.type === "generic" ? safe.type : null,
    namespace: typeof safe.namespace === "string" ? safe.namespace : null,
    ui5Version: typeof safe.ui5Version === "string" ? safe.ui5Version : null
  };
}

