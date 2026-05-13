import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { analyzeCapProjectTool } from "../../src/tools/cap/analyzeProject.js";
import { validateCapProjectTool } from "../../src/tools/cap/validateProject.js";
import { runCapQualityGateTool } from "../../src/tools/cap/runQualityGate.js";
import { sapOfficialDocumentationCatalogTool } from "../../src/tools/documentation/sapOfficialDocs.js";

describe("CAP MCP tools", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-cap-tools-"));
    await fs.mkdir(path.join(tempRoot, "db"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "srv"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify(
        {
          name: "bookshop-cap",
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
    expect(result.cds.entities).toBe(2);
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
