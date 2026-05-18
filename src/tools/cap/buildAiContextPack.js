import { z } from "zod";
import { readTextFile } from "../../utils/fileSystem.js";
import { sapOfficialDocumentationCatalogTool } from "../documentation/sapOfficialDocs.js";
import { analyzeCapChangeImpactTool } from "./analyzeChangeImpact.js";

const inputSchema = z.object({
  changeRequest: z.string().min(1),
  targetFiles: z.array(z.string().min(1)).max(100).optional(),
  entities: z.array(z.string().min(1)).max(100).optional(),
  services: z.array(z.string().min(1)).max(100).optional(),
  entitySets: z.array(z.string().min(1)).max(100).optional(),
  sourceDir: z.string().min(1).optional(),
  ui5SourceDir: z.string().min(1).optional(),
  agentTarget: z.enum(["codex", "claude", "generic"]).optional(),
  includeUi5: z.boolean().optional(),
  includeTests: z.boolean().optional(),
  includeOfficialRefs: z.boolean().optional(),
  maxFiles: z.number().int().min(3).max(80).optional(),
  maxChars: z.number().int().min(1000).max(80000).optional()
}).strict();

const outputSchema = z.object({
  agentTarget: z.enum(["codex", "claude", "generic"]),
  sourceDir: z.string(),
  ui5SourceDir: z.string(),
  budget: z.object({
    maxFiles: z.number().int().positive(),
    maxChars: z.number().int().positive(),
    usedChars: z.number().int().nonnegative(),
    truncated: z.boolean()
  }),
  change: z.object({
    request: z.string(),
    impactLevel: z.enum(["low", "medium", "high"]),
    impactScore: z.number().int().min(0).max(100)
  }),
  files: z.array(z.object({
    path: z.string(),
    area: z.enum(["cds", "handler", "ui5", "test", "config", "docs"]),
    priority: z.enum(["high", "medium", "low"]),
    reason: z.string(),
    chars: z.number().int().nonnegative(),
    excerpt: z.string()
  })),
  omittedFiles: z.array(z.object({
    path: z.string(),
    reason: z.string()
  })),
  officialRefs: z.array(z.object({
    id: z.string(),
    title: z.string(),
    url: z.string().url(),
    product: z.enum(["cap", "ui5"]),
    topic: z.string()
  })),
  recommendedTools: z.array(z.string()),
  validationCommands: z.array(z.string()),
  compactPrompt: z.string(),
  handoffChecklist: z.array(z.string())
});

export const buildCapAiContextPackTool = {
  name: "build_cap_ai_context_pack",
  description: "Build a compact SAP CAP/UI5 context pack for coding agents from change impact, relevant files, official references, and validation commands.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      changeRequest,
      targetFiles,
      entities,
      services,
      entitySets,
      sourceDir,
      ui5SourceDir,
      agentTarget,
      includeUi5,
      includeTests,
      includeOfficialRefs,
      maxFiles,
      maxChars
    } = inputSchema.parse(args);
    const selectedAgent = agentTarget ?? "generic";
    const selectedMaxFiles = maxFiles ?? 18;
    const selectedMaxChars = maxChars ?? 24000;
    const impact = await analyzeCapChangeImpactTool.handler({
      changeRequest,
      targetFiles,
      entities,
      services,
      entitySets,
      sourceDir,
      ui5SourceDir,
      includeUi5,
      includeTests,
      maxFiles: Math.max(10, selectedMaxFiles * 20),
      maxResults: Math.max(selectedMaxFiles * 2, 20)
    }, { context });
    const selectedFiles = [];
    const omittedFiles = [];
    let usedChars = 0;
    for (const file of impact.impacted.files) {
      if (selectedFiles.length >= selectedMaxFiles) {
        omittedFiles.push({
          path: file.path,
          reason: "maxFiles budget reached"
        });
        continue;
      }
      const remaining = selectedMaxChars - usedChars;
      if (remaining <= 0) {
        omittedFiles.push({
          path: file.path,
          reason: "maxChars budget reached"
        });
        continue;
      }
      const content = await safeRead(file.path, context.rootDir);
      const excerpt = createExcerpt({
        content,
        signals: impact.signals.keywords,
        maxChars: Math.min(remaining, charBudgetFor(file.priority, selectedMaxChars))
      });
      usedChars += excerpt.length;
      selectedFiles.push({
        path: file.path,
        area: file.area,
        priority: file.priority,
        reason: file.reasons.join("; "),
        chars: excerpt.length,
        excerpt
      });
    }
    const officialRefs = includeOfficialRefs === false
      ? []
      : await collectOfficialRefs({ impact });
    const compactPrompt = buildPrompt({
      agentTarget: selectedAgent,
      changeRequest,
      impact,
      files: selectedFiles,
      officialRefs
    });

    return outputSchema.parse({
      agentTarget: selectedAgent,
      sourceDir: impact.sourceDir,
      ui5SourceDir: impact.ui5SourceDir,
      budget: {
        maxFiles: selectedMaxFiles,
        maxChars: selectedMaxChars,
        usedChars,
        truncated: omittedFiles.length > 0 || usedChars >= selectedMaxChars
      },
      change: {
        request: changeRequest,
        impactLevel: impact.impact.level,
        impactScore: impact.impact.score
      },
      files: selectedFiles,
      omittedFiles,
      officialRefs,
      recommendedTools: impact.recommendedTools,
      validationCommands: impact.validationCommands,
      compactPrompt,
      handoffChecklist: buildChecklist(impact)
    });
  }
};

function createExcerpt(input) {
  const { content, signals, maxChars } = input;
  if (content.length <= maxChars) {
    return content;
  }
  const firstHit = findFirstSignalIndex(content, signals);
  if (firstHit < 0) {
    return content.slice(0, maxChars);
  }
  const contextRadius = Math.floor(maxChars / 2);
  const start = Math.max(0, firstHit - contextRadius);
  const end = Math.min(content.length, start + maxChars);
  return content.slice(start, end);
}

function findFirstSignalIndex(content, signals) {
  const lower = content.toLowerCase();
  const indices = signals
    .map((signal) => lower.indexOf(signal.toLowerCase()))
    .filter((index) => index >= 0);
  return indices.length > 0 ? Math.min(...indices) : -1;
}

function charBudgetFor(priority, totalBudget) {
  if (priority === "high") {
    return Math.max(1200, Math.floor(totalBudget * 0.25));
  }
  if (priority === "medium") {
    return Math.max(800, Math.floor(totalBudget * 0.15));
  }
  return Math.max(500, Math.floor(totalBudget * 0.08));
}

async function collectOfficialRefs(input) {
  const riskRules = input.impact.risks.flatMap((risk) => risk.officialRefs);
  const docs = await sapOfficialDocumentationCatalogTool.handler({
    product: "cap",
    includeValidation: true
  });
  return uniqueRefs([
    ...riskRules,
    ...docs.references.filter((reference) => ["cds-modeling", "odata", "testing", "security", "typescript"].includes(reference.topic))
  ]).slice(0, 10);
}

function buildPrompt(input) {
  const { agentTarget, changeRequest, impact, files, officialRefs } = input;
  const lines = [
    `Agent target: ${agentTarget}`,
    `Task: ${changeRequest}`,
    `Impact: ${impact.impact.level} (${impact.impact.score}/100) - ${impact.impact.reason}`,
    "",
    "Relevant files:",
    ...files.map((file) => `- ${file.path} [${file.area}/${file.priority}]: ${file.reason}`),
    "",
    "Impacted contract:",
    `- Services: ${formatList(impact.impacted.services)}`,
    `- Entities: ${formatList(impact.impacted.entities)}`,
    `- Entity sets: ${formatList(impact.impacted.entitySets)}`,
    `- Operations: ${formatList(impact.impacted.operations)}`,
    "",
    "Risks:",
    ...formatRisks(impact.risks),
    "",
    "Validation commands:",
    ...impact.validationCommands.map((command) => `- ${command}`)
  ];
  if (officialRefs.length > 0) {
    lines.push("", "Official SAP references:");
    lines.push(...officialRefs.map((reference) => `- ${reference.title}: ${reference.url}`));
  }
  return lines.join("\n");
}

function buildChecklist(impact) {
  const checklist = [
    "Read the high-priority files before editing.",
    "Keep changes scoped to impacted services/entities/entity sets.",
    "Update or add tests for each impacted service operation or UI5 binding.",
    "Run the recommended validation commands before handoff."
  ];
  if (impact.risks.some((risk) => risk.severity === "high")) {
    checklist.unshift("Resolve high-severity impact risks before broad implementation.");
  }
  return checklist;
}

function formatRisks(risks) {
  if (risks.length === 0) {
    return ["- None detected."];
  }
  return risks.map((risk) => `- [${risk.severity}] ${risk.rule}: ${risk.message}`);
}

function formatList(values) {
  return values.length > 0 ? values.join(", ") : "none";
}

async function safeRead(path, root) {
  try {
    return await readTextFile(path, root);
  } catch {
    return "";
  }
}

function uniqueRefs(refs) {
  const seen = new Set();
  const result = [];
  for (const reference of refs) {
    if (!reference || seen.has(reference.id)) {
      continue;
    }
    seen.add(reference.id);
    result.push({
      id: reference.id,
      title: reference.title,
      url: reference.url,
      product: reference.product,
      topic: reference.topic
    });
  }
  return result;
}
