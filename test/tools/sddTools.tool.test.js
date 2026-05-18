import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import JSZip from "jszip";
import { analyzeSddSpecTool } from "../../src/tools/sdd/analyzeSpec.js";
import { deriveCapUiBacklogTool } from "../../src/tools/sdd/deriveBacklog.js";
import { validateSddBacklogQualityTool } from "../../src/tools/sdd/validateBacklog.js";
import { planAiCodingIterationsTool } from "../../src/tools/sdd/planIterations.js";

describe("SDD CAP/UI backlog tools", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-sdd-tools-"));
    await fs.mkdir(path.join(tempRoot, "specs", "visuals"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "specs", "functional.md"),
      [
        "# Sales Order SDD",
        "Actor: Sales Manager",
        "REQ-001: El sistema debe listar Sales Orders con busqueda y filtros por estado.",
        "Pantalla: Sales Orders List muestra entidad Sales Order con fields: ID, status, amount.",
        "Regla de negocio: solo usuarios autorizados pueden aprobar pedidos.",
        "Riesgo: dependencia externa de pricing pendiente de definir.",
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempRoot, "specs", "technical.txt"),
      [
        "REQ-002: The application must create and edit Customer records with fields: ID, name, email.",
        "Screen: Customer Wizard must guide custom onboarding.",
        "RNF-001: Security audit logging must be enabled for approval actions.",
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempRoot, "specs", "docx-spec.docx"),
      await createDocxBuffer("REQ-003: El sistema debe exportar Invoice records. Entity: Invoice fields: ID, total."),
    );
    await fs.writeFile(
      path.join(tempRoot, "specs", "pdf-spec.pdf"),
      createPdfBuffer("REQ-004: The system must show Dashboard KPIs for Sales Orders. Screen Dashboard."),
    );
    await fs.writeFile(
      path.join(tempRoot, "specs", "visuals", "sales-orders-list.png"),
      Buffer.from("png-placeholder"),
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("analyzes Markdown, text, DOCX, PDF and visual evidence into traceable SDD facts", async () => {
    const analysis = await analyzeSddSpecTool.handler(
      {
        specRoot: "specs",
        includeImages: true,
        maxChars: 50000
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(analysis.documents.map((document) => document.type).sort()).toEqual(["docx", "markdown", "pdf", "text"]);
    expect(analysis.documents.every((document) => document.extractionStatus !== "failed")).toBe(true);
    expect(analysis.visualEvidence).toHaveLength(1);
    expect(analysis.requirements.length).toBeGreaterThanOrEqual(4);
    expect(analysis.requirements.every((requirement) => /^REQ-\d{4}$/.test(requirement.id))).toBe(true);
    expect(analysis.screens.some((screen) => screen.name.includes("Sales Orders List"))).toBe(true);
    expect(analysis.entityCandidates.some((entity) => entity.name === "SalesOrder")).toBe(true);
    expect(analysis.ambiguities.length).toBeGreaterThan(0);
    expect(analysis.traceability.sourceCoverage.length).toBeGreaterThanOrEqual(4);
  });

  it("derives CAP/UI backlog and plans coding iterations with traceable tasks", async () => {
    const backlog = await deriveCapUiBacklogTool.handler(
      {
        specRoot: "specs",
        includeImages: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(backlog.mode).toBe("mixed");
    expect(backlog.tasks.length).toBeGreaterThan(0);
    expect(backlog.tasks.every((task) => task.traceIds.length > 0)).toBe(true);
    expect(backlog.ui.screens.every((screen) => ["fiori_elements", "ui5_freestyle"].includes(screen.recommendation))).toBe(true);
    expect(backlog.ui.screens.some((screen) => screen.recommendation === "ui5_freestyle")).toBe(true);
    expect(backlog.cap.services.length).toBeGreaterThan(0);

    const plan = await planAiCodingIterationsTool.handler(
      {
        backlog,
        targetAi: "codex",
        tokenBudget: 8000,
        maxTasksPerIteration: 3
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(plan.iterations.length).toBeGreaterThan(0);
    expect(plan.iterations.every((iteration) => iteration.taskIds.length <= 3)).toBe(true);
    expect(plan.iterations.every((iteration) => iteration.prompt.includes("Recommended checks"))).toBe(true);
    expect(plan.iterations.flatMap((iteration) => iteration.checks)).toContain("run_cap_quality_gate");
  });

  it("validates backlog quality gaps and attaches official SAP references", async () => {
    const backlog = await deriveCapUiBacklogTool.handler(
      {
        specRoot: "specs",
        includeImages: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );
    const brokenBacklog = {
      ...backlog,
      tasks: [
        {
          ...backlog.tasks[0],
          id: "TASK-BROKEN",
          traceIds: [],
          acceptanceCriteria: ["ok"]
        }
      ],
      cap: {
        ...backlog.cap,
        services: []
      },
      ui: {
        screens: backlog.ui.screens.map((screen) => ({
          ...screen,
          flow: null
        }))
      },
      traceMatrix: backlog.traceMatrix.map((row) => ({
        ...row,
        tasks: []
      }))
    };

    const validation = await validateSddBacklogQualityTool.handler(
      {
        backlog: brokenBacklog
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(validation.pass).toBe(false);
    expect(validation.gaps.requirementsWithoutTasks.length).toBeGreaterThan(0);
    expect(validation.gaps.tasksWithoutRequirements).toEqual(["TASK-BROKEN"]);
    expect(validation.gaps.entitiesWithoutService.length).toBeGreaterThan(0);
    expect(validation.gaps.weakAcceptanceCriteria).toEqual(["TASK-BROKEN"]);
    expect(validation.findings.some((finding) => finding.rule === "SDD_ENTITY_WITHOUT_SERVICE")).toBe(true);
    expect(validation.findings.flatMap((finding) => finding.officialRefs).some((reference) => reference.url.startsWith("https://cap.cloud.sap/"))).toBe(true);
  });
});

async function createDocxBuffer(text) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
    "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
    "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
    "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>",
    "</Types>"
  ].join(""));
  zip.folder("_rels").file(".rels", [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>",
    "</Relationships>"
  ].join(""));
  zip.folder("word").file("document.xml", [
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
    "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
    "<w:body><w:p><w:r><w:t>",
    escapeXml(text),
    "</w:t></w:r></w:p></w:body></w:document>"
  ].join(""));
  return zip.generateAsync({ type: "nodebuffer" });
}

function createPdfBuffer(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapePdfText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}
