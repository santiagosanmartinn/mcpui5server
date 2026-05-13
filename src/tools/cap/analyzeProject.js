import { z } from "zod";
import { getCapRequires, getDependencyVersion, readCapProject, summarizeCdsAnalyses } from "./common.js";

const inputSchema = z.object({
  sourceDir: z.string().min(1).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional()
}).strict();

const outputSchema = z.object({
  sourceDir: z.string(),
  detected: z.boolean(),
  project: z.object({
    name: z.string().nullable(),
    type: z.literal("cap"),
    capVersion: z.string().nullable(),
    cdsDkVersion: z.string().nullable()
  }),
  detectedFiles: z.object({
    packageJson: z.boolean(),
    cdsConfig: z.boolean(),
    srvDir: z.boolean(),
    dbDir: z.boolean(),
    appDir: z.boolean(),
    mtaYaml: z.boolean(),
    defaultEnvJson: z.boolean()
  }),
  dependencies: z.object({
    cds: z.string().nullable(),
    cdsDk: z.string().nullable(),
    hana: z.string().nullable(),
    sqlite: z.string().nullable()
  }),
  scripts: z.object({
    start: z.boolean(),
    test: z.boolean(),
    build: z.boolean(),
    deploy: z.boolean()
  }),
  cds: z.object({
    sourceFiles: z.number().int().nonnegative(),
    services: z.array(z.object({
      name: z.string(),
      path: z.string(),
      secured: z.boolean(),
      entityCount: z.number().int().nonnegative(),
      actionCount: z.number().int().nonnegative(),
      functionCount: z.number().int().nonnegative()
    })),
    entities: z.number().int().nonnegative(),
    projections: z.number().int().nonnegative(),
    actions: z.number().int().nonnegative(),
    functions: z.number().int().nonnegative()
  }),
  requires: z.array(z.object({
    name: z.string(),
    kind: z.string().nullable(),
    credentialsConfigured: z.boolean()
  })),
  recommendations: z.array(z.string())
});

export const analyzeCapProjectTool = {
  name: "analyze_cap_project",
  description: "Analyze SAP CAP project structure, dependencies, CDS services/entities, scripts, and deployment signals.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const { sourceDir, maxFiles } = inputSchema.parse(args);
    const project = await readCapProject({
      root: context.rootDir,
      sourceDir,
      maxFiles
    });
    const packageJson = project.packageJson;
    const cdsSummary = summarizeCdsAnalyses(project.cdsAnalyses);
    const dependencies = {
      cds: getDependencyVersion(packageJson, "@sap/cds"),
      cdsDk: getDependencyVersion(packageJson, "@sap/cds-dk"),
      hana: getDependencyVersion(packageJson, "@sap/hana-client") ?? getDependencyVersion(packageJson, "hdb"),
      sqlite: getDependencyVersion(packageJson, "@cap-js/sqlite") ?? getDependencyVersion(packageJson, "sqlite3")
    };
    const scripts = packageJson?.scripts ?? {};
    const detected = Boolean(
      dependencies.cds
      || project.detectedFiles.cdsConfig
      || project.detectedFiles.srvDir
      || project.detectedFiles.dbDir
      || project.cdsFiles.length > 0
    );

    return outputSchema.parse({
      sourceDir: project.sourceDir,
      detected,
      project: {
        name: packageJson?.name ?? null,
        type: "cap",
        capVersion: dependencies.cds,
        cdsDkVersion: dependencies.cdsDk
      },
      detectedFiles: project.detectedFiles,
      dependencies,
      scripts: {
        start: Boolean(scripts.start),
        test: Boolean(scripts.test),
        build: Boolean(scripts.build),
        deploy: Boolean(scripts.deploy)
      },
      cds: {
        sourceFiles: project.cdsFiles.length,
        services: cdsSummary.services.map((service) => ({
          name: service.name,
          path: service.path,
          secured: service.secured,
          entityCount: service.entityCount,
          actionCount: service.actionCount,
          functionCount: service.functionCount
        })),
        entities: cdsSummary.entityCount,
        projections: cdsSummary.projectionCount,
        actions: cdsSummary.actionCount,
        functions: cdsSummary.functionCount
      },
      requires: getCapRequires(packageJson),
      recommendations: buildRecommendations({
        detected,
        project,
        dependencies,
        scripts,
        cdsSummary
      })
    });
  }
};

function buildRecommendations(input) {
  const { detected, project, dependencies, scripts, cdsSummary } = input;
  const recommendations = [];
  if (!detected) {
    recommendations.push("CAP project signals are weak; confirm sourceDir or package dependencies before running CAP-specific generation.");
  }
  if (!dependencies.cds) {
    recommendations.push("Declare @sap/cds in package.json so agents can infer CAP runtime capabilities reliably.");
  }
  if (!scripts.test) {
    recommendations.push("Add a test script for CAP service tests to make AI-assisted changes safer.");
  }
  if (project.detectedFiles.srvDir && cdsSummary.serviceCount === 0) {
    recommendations.push("No CDS service definitions were detected under the scanned source; verify service exposure before feature work.");
  }
  if (cdsSummary.services.some((service) => !service.secured)) {
    recommendations.push("Review exposed CAP services without @requires/@restrict annotations before production deployment.");
  }
  return recommendations;
}
