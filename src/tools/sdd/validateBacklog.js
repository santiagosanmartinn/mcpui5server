import { z } from "zod";
import { getSapOfficialRefsForRule } from "../documentation/sapOfficialDocs.js";
import { deriveCapUiBacklogTool } from "./deriveBacklog.js";
import { backlogSchema } from "./common.js";

const inputSchema = z.object({
  backlog: z.unknown().optional(),
  analysis: z.unknown().optional(),
  sourcePaths: z.array(z.string().min(1)).max(100).optional(),
  specRoot: z.string().min(1).optional(),
  includeImages: z.boolean().optional(),
  maxChars: z.number().int().min(1000).max(1000000).optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

const findingSchema = z.object({
  rule: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  category: z.enum(["traceability", "acceptance", "cap", "ui", "risk"]),
  message: z.string(),
  suggestion: z.string(),
  traceIds: z.array(z.string()),
  officialRefs: z.array(z.object({
    id: z.string(),
    title: z.string(),
    url: z.string().url(),
    product: z.enum(["cap", "ui5"]),
    topic: z.string()
  }))
});

const outputSchema = z.object({
  pass: z.boolean(),
  summary: z.object({
    totalFindings: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative()
  }),
  gaps: z.object({
    requirementsWithoutTasks: z.array(z.string()),
    tasksWithoutRequirements: z.array(z.string()),
    screensWithoutFlow: z.array(z.string()),
    entitiesWithoutService: z.array(z.string()),
    weakAcceptanceCriteria: z.array(z.string()),
    risksWithoutMitigation: z.array(z.string())
  }),
  findings: z.array(findingSchema)
});

export const validateSddBacklogQualityTool = {
  name: "validate_sdd_backlog_quality",
  description: "Validate traceability and quality of a generated SDD CAP/UI backlog before coding agents start implementation.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const backlog = parsed.backlog
      ? backlogSchema.parse(parsed.backlog)
      : await deriveCapUiBacklogTool.handler(
          {
            analysis: parsed.analysis,
            sourcePaths: parsed.sourcePaths,
            specRoot: parsed.specRoot,
            includeImages: parsed.includeImages,
            maxChars: parsed.maxChars,
            language: parsed.language
          },
          { context }
        );

    return outputSchema.parse(validateBacklog(backlog));
  }
};

export function validateBacklog(backlog) {
  const findings = [];
  const allTraceIds = backlog.traceMatrix.map((row) => row.traceId);
  const requirementsWithoutTasks = backlog.traceMatrix
    .filter((row) => row.traceId.startsWith("REQ-") && row.tasks.length === 0)
    .map((row) => row.traceId);
  const tasksWithoutRequirements = backlog.tasks
    .filter((task) => task.traceIds.length === 0)
    .map((task) => task.id);
  const screensWithoutFlow = backlog.ui.screens
    .filter((screen) => !screen.flow)
    .map((screen) => screen.name);
  const entitiesWithoutService = backlog.cap.entities
    .filter((entity) => !backlog.cap.services.some((service) => service.entity === entity.name))
    .map((entity) => entity.name);
  const weakAcceptanceCriteria = backlog.tasks
    .filter((task) => task.acceptanceCriteria.length === 0 || task.acceptanceCriteria.some((criterion) => criterion.length < 24))
    .map((task) => task.id);
  const risksWithoutMitigation = [];

  pushIf(findings, requirementsWithoutTasks.length > 0, {
    rule: "SDD_REQ_WITHOUT_TASK",
    severity: "high",
    category: "traceability",
    message: `${requirementsWithoutTasks.length} requirement trace(s) have no implementation task.`,
    suggestion: "Regenerate or refine backlog so every requirement maps to at least one task.",
    traceIds: requirementsWithoutTasks
  });
  pushIf(findings, tasksWithoutRequirements.length > 0, {
    rule: "SDD_TASK_WITHOUT_TRACE",
    severity: "high",
    category: "traceability",
    message: `${tasksWithoutRequirements.length} task(s) have no traceIds.`,
    suggestion: "Attach each task to at least one requirement, screen, entity, or business rule trace."
  });
  pushIf(findings, screensWithoutFlow.length > 0, {
    rule: "SDD_SCREEN_FLOW_MISSING",
    severity: "medium",
    category: "ui",
    message: `${screensWithoutFlow.length} screen(s) have no inferred user flow.`,
    suggestion: "Clarify navigation, search/filter, CRUD, approval, or dashboard behavior before UI implementation.",
    traceIds: findTraceIdsForScreens(backlog, screensWithoutFlow)
  });
  pushIf(findings, entitiesWithoutService.length > 0, {
    rule: "SDD_ENTITY_WITHOUT_SERVICE",
    severity: "high",
    category: "cap",
    message: `${entitiesWithoutService.length} CAP entity candidate(s) have no service.`,
    suggestion: "Expose each required entity through a CAP service or mark it as internal-only.",
    traceIds: findTraceIdsForEntities(backlog, entitiesWithoutService)
  });
  pushIf(findings, weakAcceptanceCriteria.length > 0, {
    rule: "SDD_WEAK_ACCEPTANCE_CRITERIA",
    severity: "medium",
    category: "acceptance",
    message: `${weakAcceptanceCriteria.length} task(s) have weak acceptance criteria.`,
    suggestion: "Use observable Given/When/Then style criteria and include validation commands.",
    traceIds: unique(backlog.tasks.filter((task) => weakAcceptanceCriteria.includes(task.id)).flatMap((task) => task.traceIds))
  });

  const summary = {
    totalFindings: findings.length,
    high: findings.filter((finding) => finding.severity === "high").length,
    medium: findings.filter((finding) => finding.severity === "medium").length,
    low: findings.filter((finding) => finding.severity === "low").length
  };

  return {
    pass: summary.high === 0,
    summary,
    gaps: {
      requirementsWithoutTasks: requirementsWithoutTasks.filter((id) => allTraceIds.includes(id)),
      tasksWithoutRequirements,
      screensWithoutFlow,
      entitiesWithoutService,
      weakAcceptanceCriteria,
      risksWithoutMitigation
    },
    findings: findings.map(withOfficialRefs)
  };
}

function pushIf(findings, condition, finding) {
  if (!condition) {
    return;
  }
  findings.push({
    traceIds: [],
    ...finding
  });
}

function withOfficialRefs(finding) {
  return {
    ...finding,
    officialRefs: getSapOfficialRefsForRule(finding.rule).map((reference) => ({
      id: reference.id,
      title: reference.title,
      url: reference.url,
      product: reference.product,
      topic: reference.topic
    }))
  };
}

function findTraceIdsForScreens(backlog, names) {
  return unique(backlog.ui.screens.filter((screen) => names.includes(screen.name)).flatMap((screen) => screen.traceIds));
}

function findTraceIdsForEntities(backlog, names) {
  return unique(backlog.cap.entities.filter((entity) => names.includes(entity.name)).flatMap((entity) => entity.traceIds));
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
