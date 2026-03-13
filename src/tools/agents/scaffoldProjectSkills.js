import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { applyProjectPatch, previewFileWrite } from "../../utils/patchWriter.js";
import { fileExists, readTextFile } from "../../utils/fileSystem.js";
import { analyzeUi5ProjectTool } from "../project/analyzeProject.js";
import { resolveProjectProfile } from "./scaffoldProjectAgents.js";
import {
  DEFAULT_SKILL_CATALOG_PATH,
  DEFAULT_SKILL_FEEDBACK_PATH,
  DEFAULT_SKILL_METRICS_PATH,
  DEFAULT_SKILLS_DOC_PATH,
  DEFAULT_SKILLS_ROOT_DIR,
  enforceManagedSubtree,
  joinPath,
  normalizePath,
  officialReferenceSchema,
  readOrCreateSkillCatalog,
  readOrCreateSkillMetrics,
  skillCatalogSchema,
  toSkillId,
  unique
} from "../../utils/projectSkills.js";

const inputSkillSchema = z.object({
  id: z.string().min(2).max(80),
  title: z.string().min(3).max(120),
  goal: z.string().min(10).max(400),
  whenToUse: z.string().min(10).max(400),
  workflowSteps: z.array(z.string().min(5).max(240)).min(3).max(20),
  officialReferences: z.array(officialReferenceSchema).min(1).max(20),
  tags: z.array(z.string().min(2).max(60)).max(20).optional(),
  status: z.enum(["experimental", "candidate", "recommended", "deprecated"]).optional(),
  version: z.string().min(1).max(40).optional()
}).strict();

const inputSchema = z.object({
  skillsRootDir: z.string().min(1).optional(),
  catalogPath: z.string().min(1).optional(),
  feedbackPath: z.string().min(1).optional(),
  metricsPath: z.string().min(1).optional(),
  docsPath: z.string().min(1).optional(),
  includeDefaultSkills: z.boolean().optional(),
  customSkills: z.array(inputSkillSchema).max(30).optional(),
  generateDocs: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  allowOverwrite: z.boolean().optional(),
  reason: z.string().max(200).optional(),
  maxDiffLines: z.number().int().min(10).max(400).optional()
}).strict();

const previewSchema = z.object({
  path: z.string(),
  role: z.enum(["skills-catalog", "skill-doc", "skills-doc", "skills-feedback-log", "skills-feedback-metrics"]),
  existsBefore: z.boolean(),
  changed: z.boolean(),
  oldHash: z.string().nullable(),
  newHash: z.string(),
  diffPreview: z.string(),
  diffTruncated: z.boolean()
});

const outputSchema = z.object({
  dryRun: z.boolean(),
  changed: z.boolean(),
  project: z.object({
    name: z.string(),
    type: z.enum(["sapui5", "node", "generic"]),
    namespace: z.string().nullable(),
    ui5Version: z.string().nullable()
  }),
  files: z.object({
    skillsRootDir: z.string(),
    catalogPath: z.string(),
    feedbackPath: z.string(),
    metricsPath: z.string(),
    docsPath: z.string().nullable()
  }),
  skillSummary: z.object({
    total: z.number().int().nonnegative(),
    incoming: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative()
  }),
  previews: z.array(previewSchema),
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

export const scaffoldProjectSkillsTool = {
  name: "scaffold_project_skills",
  description: "Scaffold and manage project skills catalog with official references, safe preview/apply flow, and growth-ready feedback artifacts.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      skillsRootDir,
      catalogPath,
      feedbackPath,
      metricsPath,
      docsPath,
      includeDefaultSkills,
      customSkills,
      generateDocs,
      dryRun,
      allowOverwrite,
      reason,
      maxDiffLines
    } = inputSchema.parse(args);

    const root = context.rootDir;
    const selectedSkillsRootDir = normalizePath(skillsRootDir ?? DEFAULT_SKILLS_ROOT_DIR);
    const selectedCatalogPath = normalizePath(catalogPath ?? DEFAULT_SKILL_CATALOG_PATH);
    const selectedFeedbackPath = normalizePath(feedbackPath ?? DEFAULT_SKILL_FEEDBACK_PATH);
    const selectedMetricsPath = normalizePath(metricsPath ?? DEFAULT_SKILL_METRICS_PATH);
    const shouldGenerateDocs = generateDocs ?? true;
    const selectedDocsPath = shouldGenerateDocs
      ? normalizePath(docsPath ?? DEFAULT_SKILLS_DOC_PATH)
      : null;
    const shouldDryRun = dryRun ?? true;
    const shouldAllowOverwrite = allowOverwrite ?? false;
    const shouldIncludeDefaultSkills = includeDefaultSkills ?? true;

    enforceManagedSubtree(selectedSkillsRootDir, ".codex/mcp", "skillsRootDir");
    enforceManagedSubtree(selectedCatalogPath, ".codex/mcp", "catalogPath");
    enforceManagedSubtree(selectedFeedbackPath, ".codex/mcp", "feedbackPath");
    enforceManagedSubtree(selectedMetricsPath, ".codex/mcp", "metricsPath");
    if (selectedDocsPath) {
      enforceManagedSubtree(selectedDocsPath, "docs", "docsPath");
    }

    const project = await resolveSkillsProjectProfile(root);
    const currentCatalog = await readOrCreateSkillCatalog(selectedCatalogPath, root, project);
    const now = new Date().toISOString();
    const incoming = buildIncomingSkills({
      includeDefaultSkills: shouldIncludeDefaultSkills,
      customSkills: customSkills ?? [],
      project
    });
    if (incoming.length === 0 && currentCatalog.skills.length === 0) {
      throw new ToolError("No skills to scaffold. Enable includeDefaultSkills or pass customSkills.", {
        code: "NO_PROJECT_SKILLS_DEFINED"
      });
    }

    const existingById = new Map(currentCatalog.skills.map((skill) => [skill.id, skill]));
    const nextById = new Map(currentCatalog.skills.map((skill) => [skill.id, skill]));
    const incomingSkillFiles = [];

    for (const skill of incoming) {
      const existing = existingById.get(skill.id);
      const filePath = joinPath(selectedSkillsRootDir, skill.id, "SKILL.md");
      const nextEntry = {
        id: skill.id,
        title: skill.title,
        goal: skill.goal,
        whenToUse: skill.whenToUse,
        workflowSteps: skill.workflowSteps,
        officialReferences: skill.officialReferences,
        tags: unique(skill.tags),
        status: skill.status,
        version: skill.version,
        owner: skill.owner,
        filePath,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      if (existing && !shouldAllowOverwrite && hasSkillChanged(existing, nextEntry)) {
        throw new ToolError(`Skill already exists and differs: ${skill.id}. Use allowOverwrite=true to update.`, {
          code: "PROJECT_SKILL_EXISTS",
          details: {
            skillId: skill.id
          }
        });
      }

      nextById.set(skill.id, nextEntry);
      incomingSkillFiles.push({
        id: skill.id,
        path: filePath,
        content: renderSkillMarkdown(nextEntry)
      });
    }

    const nextCatalog = skillCatalogSchema.parse({
      schemaVersion: "1.0.0",
      generatedAt: now,
      project: {
        name: project.name,
        type: project.type,
        namespace: project.namespace,
        ui5Version: project.ui5Version
      },
      skills: Array.from(nextById.values()).sort((a, b) => a.id.localeCompare(b.id))
    });

    const currentFeedbackLog = await readOptionalText(selectedFeedbackPath, root);
    const currentMetrics = await readOrCreateSkillMetrics(selectedMetricsPath, root);
    const metricsContent = `${JSON.stringify({
      ...currentMetrics,
      generatedAt: now
    }, null, 2)}\n`;

    const writes = [
      {
        path: selectedCatalogPath,
        role: "skills-catalog",
        content: `${JSON.stringify(nextCatalog, null, 2)}\n`
      },
      {
        path: selectedFeedbackPath,
        role: "skills-feedback-log",
        content: currentFeedbackLog
      },
      {
        path: selectedMetricsPath,
        role: "skills-feedback-metrics",
        content: metricsContent
      },
      ...incomingSkillFiles.map((item) => ({
        path: item.path,
        role: "skill-doc",
        content: item.content
      }))
    ];
    if (selectedDocsPath) {
      writes.push({
        path: selectedDocsPath,
        role: "skills-doc",
        content: renderSkillsDoc(nextCatalog)
      });
    }

    const previews = [];
    for (const write of writes) {
      const preview = await previewFileWrite(write.path, write.content, {
        root,
        maxDiffLines
      });
      if (!shouldAllowOverwrite && preview.existsBefore && preview.changed && write.role !== "skills-feedback-log" && write.role !== "skills-feedback-metrics") {
        throw new ToolError(`Refusing to overwrite managed skill artifact without allowOverwrite: ${write.path}`, {
          code: "PROJECT_SKILL_FILE_EXISTS",
          details: {
            path: write.path,
            role: write.role
          }
        });
      }
      previews.push({
        path: preview.path,
        role: write.role,
        existsBefore: preview.existsBefore,
        changed: preview.changed,
        oldHash: preview.oldHash,
        newHash: preview.newHash,
        diffPreview: preview.diffPreview,
        diffTruncated: preview.diffTruncated
      });
    }

    const changed = previews.some((preview) => preview.changed);
    let applyResult = null;
    if (!shouldDryRun && changed) {
      applyResult = await applyProjectPatch(
        writes.map((write) => {
          const preview = previews.find((item) => item.path === write.path);
          return {
            path: write.path,
            content: write.content,
            expectedOldHash: preview?.oldHash ?? undefined
          };
        }),
        {
          root,
          reason: reason ?? "scaffold_project_skills"
        }
      );
    }

    const skillFilePreviews = previews.filter((preview) => preview.role === "skill-doc");
    return outputSchema.parse({
      dryRun: shouldDryRun,
      changed,
      project,
      files: {
        skillsRootDir: selectedSkillsRootDir,
        catalogPath: selectedCatalogPath,
        feedbackPath: selectedFeedbackPath,
        metricsPath: selectedMetricsPath,
        docsPath: selectedDocsPath
      },
      skillSummary: {
        total: nextCatalog.skills.length,
        incoming: incoming.length,
        created: skillFilePreviews.filter((item) => !item.existsBefore && item.changed).length,
        updated: skillFilePreviews.filter((item) => item.existsBefore && item.changed).length,
        unchanged: skillFilePreviews.filter((item) => !item.changed).length
      },
      previews,
      applyResult
    });
  }
};

async function resolveSkillsProjectProfile(root) {
  const profile = await resolveProjectProfile({ root });
  const analysis = await analyzeUi5ProjectTool.handler({}, { context: { rootDir: root } })
    .catch(() => null);
  const ui5Version = analysis?.ui5Version ?? null;
  return {
    ...profile,
    ui5Version
  };
}

function buildIncomingSkills(options) {
  const { includeDefaultSkills, customSkills, project } = options;
  const entries = [];
  if (includeDefaultSkills) {
    entries.push(...buildDefaultSkills(project));
  }
  for (const custom of customSkills) {
    const parsed = inputSkillSchema.parse(custom);
    entries.push({
      ...parsed,
      id: toSkillId(parsed.id),
      status: parsed.status ?? "experimental",
      version: parsed.version ?? "1.0.0",
      tags: parsed.tags ?? [],
      owner: "user"
    });
  }
  const deduped = [];
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    deduped.push(entry);
  }
  return deduped;
}

function buildDefaultSkills(project) {
  const projectType = project.type === "sapui5" ? "SAPUI5" : "JavaScript";
  return [
    {
      id: "ui5-architecture-official",
      title: "UI5 Architecture (Official-first)",
      goal: "Design implementation plans aligned with official SAPUI5 and Fiori guidance before code generation.",
      whenToUse: "Use before implementing features, refactors, or migrations that impact routing, model strategy, or app structure.",
      workflowSteps: [
        "Analyze project structure and active UI5 runtime constraints.",
        "Consult official SAPUI5 SDK and Fiori design guidance for the target pattern.",
        "Produce a minimal-risk implementation plan with quality gates and rollback path."
      ],
      officialReferences: [
        "https://ui5.sap.com/",
        "https://experience.sap.com/fiori-design-web/"
      ],
      tags: [projectType, "architecture", "planning", "official-docs"],
      status: "recommended",
      version: "1.0.0",
      owner: "system"
    },
    {
      id: "ui5-feature-implementation-safe",
      title: "UI5 Feature Implementation (Safe Patch Flow)",
      goal: "Implement UI5 features with deterministic dry-run, patch preview, and rollback discipline.",
      whenToUse: "Use for day-to-day feature delivery where speed is needed but quality and safety cannot be compromised.",
      workflowSteps: [
        "Generate feature scaffolding and preview every write operation.",
        "Apply patch in small increments and validate compatibility/security/performance.",
        "Close task only after quality gate and npm checks pass."
      ],
      officialReferences: [
        "https://ui5.sap.com/",
        "https://developer.mozilla.org/"
      ],
      tags: [projectType, "implementation", "quality", "safe-editing"],
      status: "recommended",
      version: "1.0.0",
      owner: "system"
    },
    {
      id: "ui5-odata-implementation-official",
      title: "UI5 OData Implementation (Official-first)",
      goal: "Implement OData features using compatible models/components and official SAP guidance for runtime constraints.",
      whenToUse: "Use when adding new OData screens, bindings, or service integrations in UI5 projects.",
      workflowSteps: [
        "Analyze metadata and validate service compatibility with target UI5 runtime.",
        "Generate OData feature base via controlled scaffolding and context gate checks.",
        "Validate OData usage and close with strict quality gate profile."
      ],
      officialReferences: [
        "https://ui5.sap.com/",
        "https://help.sap.com/"
      ],
      tags: ["SAPUI5", "odata", "integration", "official-docs"],
      status: "recommended",
      version: "1.0.0",
      owner: "system"
    },
    {
      id: "ui5-quality-security-review",
      title: "UI5 Quality & Security Review",
      goal: "Detect regressions and enforce high-quality secure delivery before merge.",
      whenToUse: "Use at the end of each feature/bugfix cycle and before promotion to production profile.",
      workflowSteps: [
        "Run compatibility, security, and performance checks on impacted modules.",
        "Execute consolidated project quality gate with policy-aware profile.",
        "Record findings, remediation, and decision rationale for traceability."
      ],
      officialReferences: [
        "https://ui5.sap.com/",
        "https://developer.mozilla.org/"
      ],
      tags: ["quality", "security", "review", "governance"],
      status: "recommended",
      version: "1.0.0",
      owner: "system"
    },
    {
      id: "ui5-docs-and-tests-discipline",
      title: "UI5 Docs & Test Discipline",
      goal: "Keep technical docs and verification artifacts aligned with code changes to reduce context waste and errors.",
      whenToUse: "Use for every substantial change where maintainability and onboarding speed matter.",
      workflowSteps: [
        "Refresh context docs after impactful structural or workflow changes.",
        "Capture implementation rationale and validation outcomes in project docs.",
        "Ensure test and quality evidence is present before task closure."
      ],
      officialReferences: [
        "https://ui5.sap.com/",
        "https://developer.mozilla.org/"
      ],
      tags: ["documentation", "testing", "maintainability", "team-scale"],
      status: "candidate",
      version: "1.0.0",
      owner: "system"
    }
  ].map((item) => ({
    ...item,
    id: toSkillId(item.id),
    tags: unique(item.tags)
  }));
}

function renderSkillMarkdown(skill) {
  return [
    "# SKILL",
    "",
    `## ${skill.title}`,
    "",
    `ID: \`${skill.id}\``,
    `Version: \`${skill.version}\``,
    `Status: \`${skill.status}\``,
    "",
    "### Goal",
    skill.goal,
    "",
    "### When To Use",
    skill.whenToUse,
    "",
    "### Workflow",
    ...skill.workflowSteps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "### Official References",
    ...skill.officialReferences.map((reference) => `- ${reference}`),
    "",
    "### Tags",
    skill.tags.length > 0 ? skill.tags.map((tag) => `- ${tag}`).join("\n") : "- none",
    ""
  ].join("\n");
}

function renderSkillsDoc(catalog) {
  const lines = [
    "# Skills del Proyecto",
    "",
    `Generado: ${catalog.generatedAt}`,
    "",
    "## Resumen",
    "",
    `- Total skills: ${catalog.skills.length}`,
    `- Proyecto: ${catalog.project.name ?? "n/a"} (${catalog.project.type ?? "n/a"})`,
    `- Namespace: ${catalog.project.namespace ?? "n/a"}`,
    `- UI5 runtime: ${catalog.project.ui5Version ?? "n/a"}`,
    "",
    "## Catalogo",
    ""
  ];

  for (const skill of catalog.skills) {
    lines.push(`### ${skill.title}`);
    lines.push(`- id: \`${skill.id}\``);
    lines.push(`- estado: \`${skill.status}\``);
    lines.push(`- version: \`${skill.version}\``);
    lines.push(`- owner: \`${skill.owner}\``);
    lines.push(`- path: \`${skill.filePath}\``);
    lines.push(`- objetivo: ${skill.goal}`);
    lines.push("- referencias oficiales:");
    for (const reference of skill.officialReferences) {
      lines.push(`  - ${reference}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function hasSkillChanged(previous, next) {
  const lhs = JSON.stringify({
    id: previous.id,
    title: previous.title,
    goal: previous.goal,
    whenToUse: previous.whenToUse,
    workflowSteps: previous.workflowSteps,
    officialReferences: previous.officialReferences,
    tags: previous.tags,
    status: previous.status,
    version: previous.version,
    owner: previous.owner,
    filePath: previous.filePath
  });
  const rhs = JSON.stringify({
    id: next.id,
    title: next.title,
    goal: next.goal,
    whenToUse: next.whenToUse,
    workflowSteps: next.workflowSteps,
    officialReferences: next.officialReferences,
    tags: next.tags,
    status: next.status,
    version: next.version,
    owner: next.owner,
    filePath: next.filePath
  });
  return lhs !== rhs;
}

async function readOptionalText(filePath, root) {
  if (!(await fileExists(filePath, root))) {
    return "";
  }
  return readTextFile(filePath, root);
}
