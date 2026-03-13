import { z } from "zod";
import { fileExists, readJsonFile } from "../../utils/fileSystem.js";
import {
  DEFAULT_SKILL_CATALOG_PATH,
  isOfficialReferenceUrl,
  normalizePath,
  skillCatalogSchema
} from "../../utils/projectSkills.js";

const inputSchema = z.object({
  catalogPath: z.string().min(1).optional(),
  strict: z.boolean().optional()
}).strict();

const outputSchema = z.object({
  catalogPath: z.string(),
  strict: z.boolean(),
  valid: z.boolean(),
  summary: z.object({
    skillCount: z.number().int().nonnegative(),
    checksPassed: z.number().int().nonnegative(),
    checksFailed: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative()
  }),
  checks: z.array(
    z.object({
      id: z.string(),
      ok: z.boolean(),
      severity: z.enum(["error", "warn"]),
      message: z.string()
    })
  ),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  recommendedActions: z.array(z.string())
});

export const validateProjectSkillsTool = {
  name: "validate_project_skills",
  description: "Validate project skill catalog integrity, official references, and file layout consistency.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { catalogPath, strict } = inputSchema.parse(args);
    const root = context.rootDir;
    const selectedCatalogPath = normalizePath(catalogPath ?? DEFAULT_SKILL_CATALOG_PATH);
    const shouldStrict = strict ?? true;

    const checks = [];
    if (!(await fileExists(selectedCatalogPath, root))) {
      checks.push({
        id: "catalog_exists",
        ok: false,
        severity: "error",
        message: `Skill catalog not found: ${selectedCatalogPath}`
      });
      return finalize({
        selectedCatalogPath,
        strict: shouldStrict,
        checks
      });
    }

    checks.push({
      id: "catalog_exists",
      ok: true,
      severity: "error",
      message: `Skill catalog found: ${selectedCatalogPath}`
    });

    const rawCatalog = await readJsonFile(selectedCatalogPath, root);
    const parsed = skillCatalogSchema.safeParse(rawCatalog);
    if (!parsed.success) {
      checks.push({
        id: "catalog_schema",
        ok: false,
        severity: "error",
        message: `Invalid skill catalog schema: ${parsed.error.issues[0]?.message ?? "unknown issue"}`
      });
      return finalize({
        selectedCatalogPath,
        strict: shouldStrict,
        checks
      });
    }

    checks.push({
      id: "catalog_schema",
      ok: true,
      severity: "error",
      message: "Skill catalog schema is valid."
    });

    const catalog = parsed.data;
    const duplicateSkillIds = findDuplicates(catalog.skills.map((skill) => skill.id));
    checks.push({
      id: "skill_ids_unique",
      ok: duplicateSkillIds.length === 0,
      severity: "error",
      message: duplicateSkillIds.length === 0
        ? "All skill IDs are unique."
        : `Duplicate skill IDs found: ${duplicateSkillIds.join(", ")}`
    });

    let invalidOfficialReferenceCount = 0;
    for (const skill of catalog.skills) {
      for (const reference of skill.officialReferences) {
        if (!isOfficialReferenceUrl(reference)) {
          invalidOfficialReferenceCount += 1;
        }
      }
    }
    checks.push({
      id: "official_references_only",
      ok: invalidOfficialReferenceCount === 0,
      severity: shouldStrict ? "error" : "warn",
      message: invalidOfficialReferenceCount === 0
        ? "All skill references point to official sources."
        : `${invalidOfficialReferenceCount} non-official reference(s) found in skill catalog.`
    });

    let missingSkillFiles = 0;
    for (const skill of catalog.skills) {
      if (!(await fileExists(skill.filePath, root))) {
        missingSkillFiles += 1;
      }
    }
    checks.push({
      id: "skill_files_exist",
      ok: missingSkillFiles === 0,
      severity: "error",
      message: missingSkillFiles === 0
        ? "All skill files exist."
        : `${missingSkillFiles} skill file(s) are missing from workspace.`
    });

    let invalidSkillFilePaths = 0;
    for (const skill of catalog.skills) {
      if (!skill.filePath.startsWith(".codex/mcp/skills/")) {
        invalidSkillFilePaths += 1;
      }
    }
    checks.push({
      id: "skill_paths_managed_layout",
      ok: invalidSkillFilePaths === 0,
      severity: shouldStrict ? "error" : "warn",
      message: invalidSkillFilePaths === 0
        ? "All skill files use managed layout under .codex/mcp/skills."
        : `${invalidSkillFilePaths} skill file(s) are outside managed skills layout.`
    });

    return finalize({
      selectedCatalogPath,
      strict: shouldStrict,
      checks,
      skillCount: catalog.skills.length
    });
  }
};

function finalize(input) {
  const { selectedCatalogPath, strict, checks, skillCount = 0 } = input;
  const failedChecks = checks.filter((check) => !check.ok);
  const errors = failedChecks
    .filter((check) => check.severity === "error")
    .map((check) => check.message);
  const warnings = failedChecks
    .filter((check) => check.severity === "warn")
    .map((check) => check.message);
  const valid = strict
    ? errors.length === 0 && warnings.length === 0
    : errors.length === 0;

  return outputSchema.parse({
    catalogPath: selectedCatalogPath,
    strict,
    valid,
    summary: {
      skillCount,
      checksPassed: checks.length - failedChecks.length,
      checksFailed: failedChecks.length,
      errorCount: errors.length,
      warningCount: warnings.length
    },
    checks,
    errors,
    warnings,
    recommendedActions: recommendActions(failedChecks)
  });
}

function recommendActions(failedChecks) {
  const actionMap = {
    catalog_exists: "Run scaffold_project_skills to initialize managed skill artifacts.",
    catalog_schema: "Regenerate catalog with scaffold_project_skills or repair invalid schema fields.",
    skill_ids_unique: "Rename duplicated skill IDs and keep stable unique identifiers.",
    official_references_only: "Replace non-official references with SAP/UI5/MDN/ECMAScript official documentation.",
    skill_files_exist: "Recreate missing skill files with scaffold_project_skills or restore from version control.",
    skill_paths_managed_layout: "Move skill files under .codex/mcp/skills to preserve managed layout."
  };
  return failedChecks
    .map((check) => actionMap[check.id] ?? null)
    .filter(Boolean);
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }
    seen.add(value);
  }
  return Array.from(duplicates);
}

