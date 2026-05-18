import { z } from "zod";
import { analyzeSddSpecTool } from "./analyzeSpec.js";
import { backlogSchema, sddAnalysisSchema, slugify, toPascalCase, unique } from "./common.js";

const inputSchema = z.object({
  analysis: z.unknown().optional(),
  sourcePaths: z.array(z.string().min(1)).max(100).optional(),
  specRoot: z.string().min(1).optional(),
  includeImages: z.boolean().optional(),
  maxChars: z.number().int().min(1000).max(1000000).optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

export const deriveCapUiBacklogTool = {
  name: "derive_cap_ui_backlog",
  description: "Derive a traceable CAP Node and mixed UI5/Fiori backlog from SDD analysis or source specification files.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema: backlogSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const analysis = parsed.analysis
      ? sddAnalysisSchema.parse(parsed.analysis)
      : await analyzeSddSpecTool.handler(
          {
            sourcePaths: parsed.sourcePaths,
            specRoot: parsed.specRoot,
            includeImages: parsed.includeImages,
            maxChars: parsed.maxChars,
            language: parsed.language
          },
          { context }
        );

    return backlogSchema.parse(buildBacklog(analysis));
  }
};

export function buildBacklog(analysis) {
  const epics = buildEpics(analysis);
  const stories = analysis.requirements.map((requirement, index) => ({
    id: `STORY-${String(index + 1).padStart(3, "0")}`,
    title: requirement.title,
    traceIds: [requirement.id],
    acceptanceCriteria: buildAcceptanceCriteria(requirement)
  }));
  const entities = buildEntities(analysis);
  const services = entities.map((entity) => ({
    name: `${entity.name}Service`,
    entity: entity.name,
    actions: unique(entity.operations.filter((operation) => !["create", "read", "update", "delete"].includes(operation))),
    traceIds: entity.traceIds
  }));
  const uiScreens = analysis.screens.map((screen) => ({
    name: screen.name,
    recommendation: recommendUiMode(screen),
    rationale: buildUiRationale(screen),
    flow: screen.flow,
    dataHints: screen.dataHints,
    visualEvidence: screen.visualEvidence,
    traceIds: [screen.id]
  }));
  const tasks = [
    ...entities.map((entity, index) => ({
      id: `TASK-MODEL-${String(index + 1).padStart(3, "0")}`,
      title: `Model CDS entity ${entity.name}`,
      type: "cap_model",
      priority: "high",
      traceIds: entity.traceIds,
      acceptanceCriteria: [`Entity ${entity.name} has key, managed fields and validated attributes.`],
      recommendedChecks: ["npx cds compile srv --to csn", "run_cap_quality_gate"],
      contextHints: ["db/schema.cds", "srv"]
    })),
    ...services.map((service, index) => ({
      id: `TASK-SERVICE-${String(index + 1).padStart(3, "0")}`,
      title: `Expose CAP service ${service.name}`,
      type: "cap_service",
      priority: "high",
      traceIds: service.traceIds,
      acceptanceCriteria: [`Service ${service.name} exposes ${service.entity} with authorization annotations.`],
      recommendedChecks: ["npx cds compile srv --to csn", "run_cap_quality_gate"],
      contextHints: ["srv"]
    })),
    ...uiScreens.map((screen, index) => ({
      id: `TASK-UI-${String(index + 1).padStart(3, "0")}`,
      title: `Implement UI screen ${screen.name}`,
      type: "ui5_screen",
      priority: screen.recommendation === "ui5_freestyle" ? "medium" : "high",
      traceIds: screen.traceIds,
      acceptanceCriteria: [`Screen ${screen.name} supports ${screen.flow ?? "its primary user flow"} and binds to CAP OData data.`],
      recommendedChecks: ["run_project_quality_gate", "validate_ui5_odata_usage"],
      contextHints: ["app", "webapp", "srv"]
    })),
    ...stories.map((story, index) => ({
      id: `TASK-TEST-${String(index + 1).padStart(3, "0")}`,
      title: `Add tests for ${story.title}`,
      type: "test",
      priority: "medium",
      traceIds: story.traceIds,
      acceptanceCriteria: ["Automated test covers the requirement acceptance criteria."],
      recommendedChecks: ["npm test", "run_cap_quality_gate"],
      contextHints: ["test", "srv"]
    }))
  ];
  const dependencies = buildDependencies(tasks);

  return {
    generatedAt: new Date().toISOString(),
    mode: "mixed",
    summary: {
      epics: epics.length,
      stories: stories.length,
      tasks: tasks.length,
      entities: entities.length,
      services: services.length,
      uiScreens: uiScreens.length
    },
    epics,
    stories,
    tasks,
    cap: {
      entities,
      services
    },
    ui: {
      screens: uiScreens
    },
    dependencies,
    traceMatrix: buildTraceMatrix({
      analysis,
      stories,
      tasks,
      entities,
      screens: uiScreens
    })
  };
}

function buildEpics(analysis) {
  const epics = [];
  if (analysis.entityCandidates.length > 0 || analysis.requirements.length > 0) {
    epics.push({
      id: "EPIC-001",
      title: "CAP domain and services",
      traceIds: unique([...analysis.requirements.map((item) => item.id), ...analysis.entityCandidates.map((item) => item.id)])
    });
  }
  if (analysis.screens.length > 0) {
    epics.push({
      id: "EPIC-002",
      title: "UI5/Fiori user experience",
      traceIds: analysis.screens.map((item) => item.id)
    });
  }
  if (epics.length === 0) {
    epics.push({
      id: "EPIC-001",
      title: "Initial CAP application delivery",
      traceIds: analysis.traceability.traceIds.slice(0, 10)
    });
  }
  return epics;
}

function buildEntities(analysis) {
  if (analysis.entityCandidates.length > 0) {
    return analysis.entityCandidates.map((entity) => ({
      name: toPascalCase(entity.name),
      attributes: entity.attributes.length ? entity.attributes : ["ID", "createdAt", "modifiedAt"],
      operations: entity.operations.length ? entity.operations : ["read"],
      traceIds: [entity.id]
    }));
  }
  return analysis.requirements.slice(0, 3).map((requirement) => {
    const name = toPascalCase(requirement.title.split(/\s+/).slice(-2).join(" "));
    return {
      name,
      attributes: ["ID", "createdAt", "modifiedAt"],
      operations: ["read"],
      traceIds: [requirement.id]
    };
  });
}

function buildAcceptanceCriteria(requirement) {
  if (/\b(criterio|acceptance|given|when|then)\b/i.test(requirement.text)) {
    return [requirement.text];
  }
  return [
    `Given the CAP application is running, when the user executes "${requirement.title}", then the expected business outcome is observable.`,
    "Relevant CAP service and UI behavior are covered by automated checks."
  ];
}

function recommendUiMode(screen) {
  const text = `${screen.name} ${screen.flow ?? ""} ${screen.dataHints.join(" ")}`.toLowerCase();
  if (/(dashboard|chart|kpi|wizard|upload|custom|approval|approve|reject)/.test(text)) {
    return "ui5_freestyle";
  }
  return "fiori_elements";
}

function buildUiRationale(screen) {
  return recommendUiMode(screen) === "fiori_elements"
    ? "CRUD/list/detail style screen can be driven efficiently by CAP OData V4 metadata and annotations."
    : "Screen implies custom interaction or layout that is better handled with freestyle UI5.";
}

function buildDependencies(tasks) {
  const modelTasks = tasks.filter((task) => task.type === "cap_model");
  const serviceTasks = tasks.filter((task) => task.type === "cap_service");
  const uiTasks = tasks.filter((task) => task.type === "ui5_screen");
  return [
    ...serviceTasks.flatMap((serviceTask) => modelTasks.map((modelTask) => ({
      from: serviceTask.id,
      to: modelTask.id,
      reason: "CAP services depend on CDS model availability."
    }))),
    ...uiTasks.flatMap((uiTask) => serviceTasks.map((serviceTask) => ({
      from: uiTask.id,
      to: serviceTask.id,
      reason: "UI screens depend on exposed OData services."
    })))
  ];
}

function buildTraceMatrix(input) {
  const { analysis, stories, tasks, entities, screens } = input;
  return analysis.traceability.traceIds.map((traceId) => ({
    traceId,
    stories: stories.filter((story) => story.traceIds.includes(traceId)).map((story) => story.id),
    tasks: tasks.filter((task) => task.traceIds.includes(traceId)).map((task) => task.id),
    entities: entities.filter((entity) => entity.traceIds.includes(traceId)).map((entity) => entity.name),
    screens: screens.filter((screen) => screen.traceIds.includes(traceId)).map((screen) => slugify(screen.name))
  }));
}
