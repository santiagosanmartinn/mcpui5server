import { z } from "zod";
import { getDependencyVersion, readCapProject } from "./common.js";
import { analyzeCdsModelContractTool } from "./analyzeCdsModelContract.js";
import { analyzeCapServiceSurfaceTool } from "./analyzeServiceSurface.js";
import { validateUi5CapContractAlignmentTool } from "./validateUi5CapAlignment.js";

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  ui5SourceDir: z.string().min(1).optional(),
  manifestPath: z.string().min(1).optional(),
  includeUi5Checks: z.boolean().optional(),
  testRunner: z.enum(["node_test", "vitest", "jest", "generic"]).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  maxCases: z.number().int().min(5).max(500).optional()
}).strict();

const outputSchema = z.object({
  sourceDir: z.string(),
  testRunner: z.enum(["node_test", "vitest", "jest", "generic"]),
  summary: z.object({
    suites: z.number().int().nonnegative(),
    cases: z.number().int().nonnegative(),
    highPriority: z.number().int().nonnegative(),
    mediumPriority: z.number().int().nonnegative(),
    lowPriority: z.number().int().nonnegative(),
    ui5AlignmentIncluded: z.boolean(),
    truncated: z.boolean()
  }),
  detected: z.object({
    capServices: z.number().int().nonnegative(),
    capEntitySets: z.number().int().nonnegative(),
    capOperations: z.number().int().nonnegative(),
    testScript: z.boolean(),
    cdsTestDependency: z.string().nullable()
  }),
  suites: z.array(z.object({
    id: z.string(),
    title: z.string(),
    target: z.string(),
    priority: z.enum(["high", "medium", "low"]),
    cases: z.array(z.object({
      id: z.string(),
      title: z.string(),
      type: z.enum(["unit", "service", "integration", "security", "contract", "ui5"]),
      priority: z.enum(["high", "medium", "low"]),
      traceTargets: z.array(z.string()),
      suggestedAssertion: z.string(),
      commands: z.array(z.string())
    }))
  })),
  gaps: z.array(z.object({
    id: z.string(),
    severity: z.enum(["high", "medium", "low"]),
    message: z.string(),
    recommendation: z.string()
  })),
  recommendedCommands: z.array(z.string()),
  promptContext: z.array(z.string())
});

export const generateCapTestPlanTool = {
  name: "generate_cap_test_plan",
  description: "Generate a read-only SAP CAP/UI5 test plan from local CDS service surface, model contract, and optional UI5-CAP alignment signals.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      sourceDir,
      ui5SourceDir,
      manifestPath,
      includeUi5Checks,
      testRunner,
      maxFiles,
      maxCases
    } = inputSchema.parse(args);
    const project = await readCapProject({
      root: context.rootDir,
      sourceDir,
      maxFiles
    });
    const selectedRunner = testRunner ?? detectRunner(project.packageJson);
    const [contract, surface] = await Promise.all([
      analyzeCdsModelContractTool.handler({ sourceDir, maxFiles }, { context }),
      analyzeCapServiceSurfaceTool.handler({ sourceDir, maxFiles }, { context })
    ]);
    const shouldIncludeUi5 = includeUi5Checks ?? true;
    let alignment = null;
    if (shouldIncludeUi5) {
      alignment = await validateUi5CapContractAlignmentTool.handler({
        capSourceDir: sourceDir,
        ui5SourceDir,
        manifestPath,
        maxFiles
      }, { context });
    }
    const suites = buildSuites({
      surface,
      contract,
      alignment,
      runner: selectedRunner
    });
    const allCases = suites.flatMap((suite) => suite.cases);
    const effectiveMaxCases = maxCases ?? 200;
    const truncated = allCases.length > effectiveMaxCases;
    const limitedSuites = limitSuites(suites, effectiveMaxCases);
    const limitedCases = limitedSuites.flatMap((suite) => suite.cases);
    const gaps = buildGaps({
      project,
      surface,
      contract,
      alignment
    });

    return outputSchema.parse({
      sourceDir: project.sourceDir,
      testRunner: selectedRunner,
      summary: {
        suites: limitedSuites.length,
        cases: limitedCases.length,
        highPriority: limitedCases.filter((testCase) => testCase.priority === "high").length,
        mediumPriority: limitedCases.filter((testCase) => testCase.priority === "medium").length,
        lowPriority: limitedCases.filter((testCase) => testCase.priority === "low").length,
        ui5AlignmentIncluded: Boolean(alignment),
        truncated
      },
      detected: {
        capServices: surface.summary.services,
        capEntitySets: surface.summary.entitySets,
        capOperations: surface.summary.actions + surface.summary.functions,
        testScript: Boolean(project.packageJson?.scripts?.test),
        cdsTestDependency: getDependencyVersion(project.packageJson, "@cap-js/cds-test")
      },
      suites: limitedSuites,
      gaps,
      recommendedCommands: buildRecommendedCommands({
        runner: selectedRunner,
        hasTestScript: Boolean(project.packageJson?.scripts?.test),
        hasCdsTest: Boolean(getDependencyVersion(project.packageJson, "@cap-js/cds-test"))
      }),
      promptContext: [
        "srv/**/*.cds",
        "db/**/*.cds",
        "srv/**/*.{js,ts}",
        "package.json",
        ...(alignment ? ["webapp/manifest.json", "webapp/**/*.view.xml", "webapp/**/*.controller.js"] : [])
      ]
    });
  }
};

function buildSuites(input) {
  const { surface, contract, alignment, runner } = input;
  const suites = [];
  for (const service of surface.services) {
    const cases = [];
    for (const entitySet of service.entitySets) {
      cases.push(createCase({
        id: `TC-${slug(service.name)}-${slug(entitySet.name)}-read`,
        title: `Read ${entitySet.name} through ${service.name}`,
        type: "service",
        priority: "high",
        traceTargets: [service.name, entitySet.name, entitySet.entityType].filter(Boolean),
        suggestedAssertion: `GET ${service.odataPath}/${entitySet.name} returns 200 and an OData collection payload.`,
        runner
      }));
      cases.push(createCase({
        id: `TC-${slug(service.name)}-${slug(entitySet.name)}-metadata`,
        title: `Expose ${entitySet.name} in ${service.name} metadata`,
        type: "contract",
        priority: "medium",
        traceTargets: [service.name, entitySet.name],
        suggestedAssertion: `$metadata contains EntitySet ${entitySet.name} with expected key fields and navigation properties.`,
        runner
      }));
    }
    for (const operation of service.operations) {
      cases.push(createCase({
        id: `TC-${slug(service.name)}-${slug(operation.name)}-${operation.kind}`,
        title: `Execute ${operation.kind} ${operation.name}`,
        type: "integration",
        priority: operation.hasHandler ? "medium" : "high",
        traceTargets: [service.name, operation.name],
        suggestedAssertion: `${operation.httpMethod} ${service.odataPath}/${operation.name} validates payload, authorization, and expected response shape.`,
        runner
      }));
    }
    if (!service.secured) {
      cases.push(createCase({
        id: `TC-${slug(service.name)}-authorization`,
        title: `Authorization behavior for ${service.name}`,
        type: "security",
        priority: "high",
        traceTargets: [service.name],
        suggestedAssertion: "Anonymous or unauthorized requests are rejected, unless the service is explicitly public by design.",
        runner
      }));
    }
    suites.push({
      id: `SUITE-${slug(service.name)}`,
      title: `${service.name} service tests`,
      target: service.name,
      priority: cases.some((testCase) => testCase.priority === "high") ? "high" : "medium",
      cases
    });
  }

  const riskyEntities = contract.entities.filter((entity) => !entity.hasKey || entity.associations.length > 0);
  if (riskyEntities.length > 0) {
    suites.push({
      id: "SUITE-CDS-CONTRACT",
      title: "CDS model contract tests",
      target: "cds-model",
      priority: "medium",
      cases: riskyEntities.map((entity) => createCase({
        id: `TC-CDS-${slug(entity.name)}`,
        title: `Validate CDS contract for ${entity.name}`,
        type: "contract",
        priority: entity.hasKey ? "medium" : "high",
        traceTargets: [entity.qualifiedName],
        suggestedAssertion: "Compiled CSN/EDMX exposes expected keys, scalar properties, and associations.",
        runner
      }))
    });
  }

  if (alignment) {
    suites.push({
      id: "SUITE-UI5-CAP-ALIGNMENT",
      title: "UI5 to CAP contract alignment",
      target: "ui5-cap",
      priority: alignment.pass ? "medium" : "high",
      cases: alignment.usage.referencedEntitySets.map((reference) => createCase({
        id: `TC-UI5-${slug(reference.entitySet)}`,
        title: `UI5 binding resolves ${reference.entitySet}`,
        type: "ui5",
        priority: alignment.cap.entitySets.includes(reference.entitySet) ? "medium" : "high",
        traceTargets: [reference.entitySet, reference.file],
        suggestedAssertion: `Binding path in ${reference.file} maps to a CAP-exposed entity set and loads data successfully.`,
        runner
      }))
    });
  }

  return suites.filter((suite) => suite.cases.length > 0);
}

function createCase(input) {
  return {
    id: input.id,
    title: input.title,
    type: input.type,
    priority: input.priority,
    traceTargets: input.traceTargets,
    suggestedAssertion: input.suggestedAssertion,
    commands: commandFor(input.runner)
  };
}

function buildGaps(input) {
  const { project, surface, contract, alignment } = input;
  const gaps = [];
  if (!project.packageJson?.scripts?.test) {
    gaps.push({
      id: "CAP_TEST_SCRIPT_MISSING",
      severity: "medium",
      message: "package.json has no test script.",
      recommendation: "Add a repeatable test script before delegating implementation to coding agents."
    });
  }
  if (!getDependencyVersion(project.packageJson, "@cap-js/cds-test")) {
    gaps.push({
      id: "CAP_CDS_TEST_DEPENDENCY_MISSING",
      severity: "medium",
      message: "@cap-js/cds-test is not declared.",
      recommendation: "Add @cap-js/cds-test for CAP service integration tests grounded in official CAP testing APIs."
    });
  }
  if (surface.findings.some((finding) => finding.rule === "CAP_SERVICE_SURFACE_OPERATION_HANDLER_MISSING")) {
    gaps.push({
      id: "CAP_OPERATION_HANDLER_TEST_RISK",
      severity: "high",
      message: "Some exposed CAP operations have no detected handler binding.",
      recommendation: "Add handler implementation or explicit tests proving the default behavior is intentional."
    });
  }
  if (contract.summary.highFindings > 0) {
    gaps.push({
      id: "CAP_MODEL_CONTRACT_BLOCKERS",
      severity: "high",
      message: "CDS model contract has high-severity findings.",
      recommendation: "Resolve model blockers before generating broad UI or service test suites."
    });
  }
  if (alignment && !alignment.pass) {
    gaps.push({
      id: "UI5_CAP_ALIGNMENT_BLOCKERS",
      severity: "high",
      message: "UI5 references do not fully align with CAP service surface.",
      recommendation: "Fix manifest service paths or entity bindings before coding UI flows."
    });
  }
  return gaps;
}

function buildRecommendedCommands(input) {
  const commands = [];
  if (!input.hasCdsTest) {
    commands.push("npm add -D @cap-js/cds-test");
  }
  if (!input.hasTestScript) {
    commands.push("npm pkg set scripts.test=\"cds test\"");
  }
  commands.push(...commandFor(input.runner));
  commands.push("npx cds compile srv --to edmx");
  return Array.from(new Set(commands));
}

function commandFor(runner) {
  if (runner === "node_test") {
    return ["node --test"];
  }
  if (runner === "vitest") {
    return ["npx vitest run"];
  }
  if (runner === "jest") {
    return ["npx jest"];
  }
  return ["npm test"];
}

function detectRunner(packageJson) {
  const deps = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies
  };
  if (deps.vitest) {
    return "vitest";
  }
  if (deps.jest) {
    return "jest";
  }
  if (packageJson?.scripts?.test?.includes("node --test") || packageJson?.scripts?.test?.includes("cds test")) {
    return "node_test";
  }
  return "generic";
}

function limitSuites(suites, maxCases) {
  let remaining = maxCases;
  const limited = [];
  for (const suite of suites) {
    if (remaining <= 0) {
      break;
    }
    const cases = suite.cases.slice(0, remaining);
    remaining -= cases.length;
    if (cases.length > 0) {
      limited.push({
        ...suite,
        cases
      });
    }
  }
  return limited;
}

function slug(value) {
  return String(value)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}
