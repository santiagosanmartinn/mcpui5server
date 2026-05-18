import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { analyzeCapProjectTool } from "../../src/tools/cap/analyzeProject.js";
import { analyzeCapChangeImpactTool } from "../../src/tools/cap/analyzeChangeImpact.js";
import { analyzeCdsModelContractTool } from "../../src/tools/cap/analyzeCdsModelContract.js";
import { analyzeCapServiceSurfaceTool } from "../../src/tools/cap/analyzeServiceSurface.js";
import { analyzeCapPerformanceHotspotsTool } from "../../src/tools/cap/analyzePerformanceHotspots.js";
import { buildCapAiContextPackTool } from "../../src/tools/cap/buildAiContextPack.js";
import { generateCapTestPlanTool } from "../../src/tools/cap/generateTestPlan.js";
import { runCapDevelopmentReadinessTool } from "../../src/tools/cap/runDevelopmentReadiness.js";
import { runCapOfficialQualityGateTool } from "../../src/tools/cap/runOfficialQualityGate.js";
import { validateCapProjectTool } from "../../src/tools/cap/validateProject.js";
import { validateCapTypescriptReadinessTool } from "../../src/tools/cap/validateTypescriptReadiness.js";
import { validateUi5CapContractAlignmentTool } from "../../src/tools/cap/validateUi5CapAlignment.js";
import { runCapQualityGateTool } from "../../src/tools/cap/runQualityGate.js";
import { sapOfficialDocumentationCatalogTool } from "../../src/tools/documentation/sapOfficialDocs.js";

describe("CAP MCP tools", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-cap-tools-"));
    await fs.mkdir(path.join(tempRoot, "db"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "srv"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "webapp", "view"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify(
        {
          name: "bookshop-cap",
          imports: {
            "#cds-models/*": "./@cds-models/*/index.js"
          },
          dependencies: {
            "@sap/cds": "^8.0.0",
            "@cap-js/sqlite": "^1.0.0"
          },
          devDependencies: {
            "@sap/cds-dk": "^8.0.0"
          },
          scripts: {
            start: "cds watch",
            build: "cds build"
          },
          cds: {
            requires: {
              db: {
                kind: "sqlite"
              }
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempRoot, "db", "schema.cds"),
      [
        "namespace demo;",
        "",
        "entity Books {",
        "  title : String;",
        "  author : Association to Authors;",
        "}",
        "",
        "entity Authors {",
        "  key ID : UUID;",
        "  name : String(111);",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempRoot, "srv", "catalog-service.cds"),
      [
        "using demo as db from '../db/schema';",
        "",
        "@path:'catalog'",
        "service CatalogService {",
        "  entity Books as projection on db.Books;",
        "  action submit(id : UUID) returns Boolean;",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempRoot, "srv", "catalog-service.js"),
      [
        "const cds = require('@sap/cds');",
        "",
        "module.exports = (srv) => {",
        "  srv.on('READ', 'Books', async (req) => {",
        "    const rows = await cds.run(`SELECT * FROM Books WHERE title = '${req.data.title}'`);",
        "    req.data.audit = true;",
        "    return rows;",
        "  });",
        "};",
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempRoot, "webapp", "manifest.json"),
      JSON.stringify(
        {
          "sap.app": {
            id: "demo.app",
            dataSources: {
              mainService: {
                uri: "/odata/v4/catalog/",
                type: "OData",
                settings: {
                  odataVersion: "4.0"
                }
              }
            }
          },
          "sap.ui5": {
            models: {
              main: {
                dataSource: "mainService",
                type: "sap.ui.model.odata.v4.ODataModel",
                settings: {
                  synchronizationMode: "None"
                }
              }
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempRoot, "webapp", "view", "Main.view.xml"),
      [
        "<mvc:View xmlns:mvc=\"sap.ui.core.mvc\" xmlns=\"sap.m\">",
        "  <List items=\"{main>/Books}\">",
        "    <StandardListItem title=\"{main>title}\" />",
        "  </List>",
        "  <List items=\"{main>/Ghosts}\">",
        "    <StandardListItem title=\"{main>name}\" />",
        "  </List>",
        "</mvc:View>",
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.mkdir(path.join(tempRoot, "webapp", "controller"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "webapp", "controller", "Main.controller.js"),
      [
        "sap.ui.define([], function () {",
        "  return {",
        "    onInit: function () {",
        "      this.getView().getModel('main').setUseBatch(false);",
        "    }",
        "  };",
        "});",
        ""
      ].join("\n"),
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("analyzes CAP structure, dependencies, services and recommendations", async () => {
    const result = await analyzeCapProjectTool.handler(
      {},
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.detected).toBe(true);
    expect(result.project.name).toBe("bookshop-cap");
    expect(result.dependencies.cds).toBe("^8.0.0");
    expect(result.cds.sourceFiles).toBe(2);
    expect(result.cds.services).toHaveLength(1);
    expect(result.cds.entities).toBe(3);
    expect(result.scripts.test).toBe(false);
    expect(result.requires).toEqual([
      {
        name: "db",
        kind: "sqlite",
        credentialsConfigured: false
      }
    ]);
    expect(result.recommendations.some((item) => item.includes("test script"))).toBe(true);
  });

  it("validates CAP quality risks and runs a blocking CAP quality gate", async () => {
    const validation = await validateCapProjectTool.handler(
      {},
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(validation.valid).toBe(false);
    expect(validation.summary.bySeverity.high).toBeGreaterThanOrEqual(3);
    expect(validation.findings.some((finding) => finding.rule === "CAP_SERVICE_AUTH_MISSING")).toBe(true);
    expect(validation.findings.some((finding) => finding.rule === "CAP_ENTITY_KEY_MISSING")).toBe(true);
    expect(validation.findings.some((finding) => finding.rule === "CAP_HANDLER_DYNAMIC_SQL")).toBe(true);
    expect(validation.findings.some((finding) => finding.rule === "CAP_TEST_SCRIPT_MISSING")).toBe(true);
    expect(validation.findings.every((finding) => finding.officialRefs.length > 0)).toBe(true);
    expect(
      validation.findings
        .flatMap((finding) => finding.officialRefs)
        .some((reference) => reference.url.startsWith("https://cap.cloud.sap/"))
    ).toBe(true);

    const gate = await runCapQualityGateTool.handler(
      {
        qualityProfile: "prod"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(gate.pass).toBe(false);
    expect(gate.reports.analysis.detected).toBe(true);
    expect(gate.summary.errorChecks).toBeGreaterThan(0);
    expect(gate.recommendedCommands).toContain("npm run build");
    expect(gate.recommendedCommands).toContain("npx cds compile srv --to csn");
  });

  it("analyzes CDS model contracts with traceable official SAP references", async () => {
    const contract = await analyzeCdsModelContractTool.handler(
      {
        includeRawSnippets: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(contract.summary.services).toBe(1);
    expect(contract.summary.entities).toBe(2);
    expect(contract.summary.projections).toBe(1);
    expect(contract.entities.some((entity) => entity.name === "Books" && entity.associations.length === 1)).toBe(true);
    expect(contract.entities.some((entity) => entity.name === "Authors" && entity.hasKey)).toBe(true);
    expect(contract.findings.some((finding) => finding.rule === "CDS_CONTRACT_ENTITY_KEY_MISSING")).toBe(true);
    expect(contract.findings.some((finding) => finding.rule === "CDS_CONTRACT_STRING_LENGTH_UNBOUNDED")).toBe(true);
    expect(contract.findings.every((finding) => finding.officialRefs.length > 0)).toBe(true);
    expect(contract.recommendedCommands).toContain("npx cds compile srv --to csn");
  });

  it("validates CAP TypeScript and typed JavaScript readiness", async () => {
    const readiness = await validateCapTypescriptReadinessTool.handler(
      {
        targetMode: "mixed"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(readiness.ready).toBe(false);
    expect(readiness.detected.packageImportsForCdsModels).toBe(true);
    expect(readiness.detected.cdsTyperDependency).toBeNull();
    expect(readiness.checks.some((check) => check.id === "cap_cds_typer_dependency" && !check.pass)).toBe(true);
    expect(readiness.checks.flatMap((check) => check.officialRefs).some((reference) => reference.id === "sap-cap-cds-typer")).toBe(true);
    expect(readiness.recommendedCommands).toContain("npx cds add typer");
  });

  it("runs an official SAP grounded CAP quality gate without mutating the project", async () => {
    const gate = await runCapOfficialQualityGateTool.handler(
      {
        qualityProfile: "dev"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(gate.officialOnly).toBe(true);
    expect(gate.pass).toBe(false);
    expect(gate.reports.documentationCatalog.valid).toBe(true);
    expect(gate.reports.modelContract.highFindings).toBeGreaterThan(0);
    expect(gate.reports.typescriptReadiness.score).toBeLessThan(100);
    expect(gate.checks.some((check) => check.id === "official_catalog_valid" && check.pass)).toBe(true);
    expect(gate.recommendedCommands).toContain("npx cds lint");
  });

  it("analyzes CAP service surface with OData paths and handler coverage", async () => {
    const surface = await analyzeCapServiceSurfaceTool.handler(
      {},
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(surface.summary.services).toBe(1);
    expect(surface.services[0].odataPath).toBe("/odata/v4/catalog");
    expect(surface.services[0].entitySets[0]).toMatchObject({
      name: "Books",
      hasHandler: true
    });
    expect(surface.services[0].operations[0]).toMatchObject({
      name: "submit",
      httpMethod: "POST",
      hasHandler: false
    });
    expect(surface.findings.some((finding) => finding.rule === "CAP_SERVICE_SURFACE_OPERATION_HANDLER_MISSING")).toBe(true);
    expect(surface.findings.every((finding) => finding.officialRefs.length > 0)).toBe(true);
  });

  it("validates UI5 manifest and bindings against the CAP service surface", async () => {
    const alignment = await validateUi5CapContractAlignmentTool.handler(
      {},
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(alignment.pass).toBe(false);
    expect(alignment.manifest.odataDataSources[0]).toMatchObject({
      name: "mainService",
      matchedCapService: "CatalogService"
    });
    expect(alignment.cap.entitySets).toContain("Books");
    expect(alignment.summary.unknownEntitySets).toBe(1);
    expect(alignment.findings.some((finding) => finding.rule === "UI5_CAP_ENTITYSET_UNKNOWN")).toBe(true);
    expect(alignment.findings.every((finding) => finding.officialRefs.length > 0)).toBe(true);
  });

  it("generates a CAP/UI5 test plan from service, contract and alignment signals", async () => {
    const plan = await generateCapTestPlanTool.handler(
      {
        includeUi5Checks: true,
        testRunner: "node_test"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(plan.summary.suites).toBeGreaterThanOrEqual(2);
    expect(plan.summary.highPriority).toBeGreaterThan(0);
    expect(plan.detected.capServices).toBe(1);
    expect(plan.gaps.some((gap) => gap.id === "CAP_OPERATION_HANDLER_TEST_RISK")).toBe(true);
    expect(plan.gaps.some((gap) => gap.id === "UI5_CAP_ALIGNMENT_BLOCKERS")).toBe(true);
    expect(plan.recommendedCommands).toContain("node --test");
    expect(plan.promptContext).toContain("webapp/manifest.json");
  });

  it("analyzes change impact across CAP contract, handlers, UI5 and tests", async () => {
    const impact = await analyzeCapChangeImpactTool.handler(
      {
        changeRequest: "Update Books behavior in CatalogService and UI5 list",
        entities: ["Books"],
        entitySets: ["Books"],
        includeUi5: true,
        includeTests: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(impact.impact.level).not.toBe("low");
    expect(impact.impacted.files.some((file) => file.path === "db/schema.cds" && file.area === "cds")).toBe(true);
    expect(impact.impacted.files.some((file) => file.path === "srv/catalog-service.js" && file.area === "handler")).toBe(true);
    expect(impact.impacted.files.some((file) => file.path === "webapp/view/Main.view.xml" && file.area === "ui5")).toBe(true);
    expect(impact.impacted.entitySets).toContain("Books");
    expect(impact.risks.some((risk) => risk.rule === "CAP_CHANGE_IMPACT_MODEL_BLOCKERS")).toBe(true);
    expect(impact.risks.some((risk) => risk.rule === "CAP_CHANGE_IMPACT_TEST_GAP")).toBe(true);
    expect(impact.risks.every((risk) => risk.officialRefs.length > 0)).toBe(true);
    expect(impact.validationCommands).toContain("npx cds compile srv --to csn");
  });

  it("builds a compact CAP AI context pack for coding agents", async () => {
    const pack = await buildCapAiContextPackTool.handler(
      {
        changeRequest: "Update Books behavior in CatalogService and UI5 list",
        entities: ["Books"],
        entitySets: ["Books"],
        agentTarget: "codex",
        maxFiles: 5,
        maxChars: 4000
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(pack.agentTarget).toBe("codex");
    expect(pack.files.length).toBeGreaterThan(0);
    expect(pack.files.length).toBeLessThanOrEqual(5);
    expect(pack.budget.usedChars).toBeLessThanOrEqual(4000);
    expect(pack.compactPrompt).toContain("Update Books behavior");
    expect(pack.compactPrompt).toContain("Validation commands");
    expect(pack.officialRefs.some((reference) => reference.url.startsWith("https://cap.cloud.sap/"))).toBe(true);
    expect(pack.handoffChecklist.some((item) => item.includes("recommended validation commands"))).toBe(true);
  });

  it("analyzes CAP and UI5 performance hotspots", async () => {
    const performance = await analyzeCapPerformanceHotspotsTool.handler(
      {
        includeUi5: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(performance.score).toBeLessThan(100);
    expect(performance.summary.high).toBeGreaterThan(0);
    expect(performance.hotspots.some((hotspot) => hotspot.rule === "CAP_PERF_UNBOUNDED_SELECT")).toBe(true);
    expect(performance.hotspots.some((hotspot) => hotspot.rule === "UI5_PERF_ODATA_BATCH_DISABLED")).toBe(true);
    expect(performance.hotspots.every((hotspot) => hotspot.officialRefs.length > 0)).toBe(true);
    expect(performance.recommendedCommands).toContain("npx cds lint");
  });

  it("runs a final CAP development readiness gate", async () => {
    const readiness = await runCapDevelopmentReadinessTool.handler(
      {
        changeRequest: "Update Books behavior in CatalogService and UI5 list",
        includeContextPack: true,
        qualityProfile: "dev"
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(readiness.pass).toBe(false);
    expect(readiness.score).toBeLessThan(100);
    expect(readiness.summary.contextPackIncluded).toBe(true);
    expect(readiness.reports.performance.high).toBeGreaterThan(0);
    expect(readiness.reports.contextPack.files).toBeGreaterThan(0);
    expect(readiness.checks.some((check) => check.id === "performance_hotspots" && !check.pass)).toBe(true);
    expect(readiness.nextActions.length).toBeGreaterThan(0);
    expect(readiness.validationCommands).toContain("npx cds lint");
  });

  it("exposes an official SAP documentation catalog for grounding agent validations", async () => {
    const catalog = await sapOfficialDocumentationCatalogTool.handler({
      product: "cap",
      rule: "CAP_SERVICE_AUTH_MISSING"
    });

    expect(catalog.validation.valid).toBe(true);
    expect(catalog.references).toHaveLength(1);
    expect(catalog.references[0]).toMatchObject({
      id: "sap-cap-authorization",
      product: "cap",
      officialDomain: "cap.cloud.sap"
    });
    expect(catalog.references[0].url).toBe("https://cap.cloud.sap/docs/guides/security/authorization");
  });
});
