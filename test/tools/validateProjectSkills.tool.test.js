import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { validateProjectSkillsTool } from "../../src/tools/agents/validateProjectSkills.js";

describe("validate_project_skills tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-validate-skills-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("reports missing catalog as invalid", async () => {
    const report = await validateProjectSkillsTool.handler(
      {
        strict: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.valid).toBe(false);
    expect(report.summary.errorCount).toBeGreaterThan(0);
    expect(report.errors.some((item) => item.includes("Skill catalog not found"))).toBe(true);
  });

  it("downgrades managed-layout mismatch to warning in non-strict mode", async () => {
    const offLayoutPath = path.join(tempRoot, "skills", "legacy", "SKILL.md");
    await fs.mkdir(path.dirname(offLayoutPath), { recursive: true });
    await fs.writeFile(offLayoutPath, "# SKILL\n", "utf8");

    const catalogPath = path.join(tempRoot, ".codex", "mcp", "skills", "catalog.json");
    await fs.mkdir(path.dirname(catalogPath), { recursive: true });
    await fs.writeFile(
      catalogPath,
      `${JSON.stringify({
        schemaVersion: "1.0.0",
        generatedAt: "2026-03-12T10:00:00.000Z",
        project: {
          name: "demo.legacy",
          type: "sapui5",
          namespace: "demo.legacy",
          ui5Version: "1.120.0"
        },
        skills: [
          {
            id: "legacy-skill",
            title: "Legacy Skill",
            goal: "Validate that non-managed file paths are detected by quality checks.",
            whenToUse: "Use when converting historical skill assets to managed layout.",
            workflowSteps: [
              "Inspect current skill artifacts from legacy folders.",
              "Map each skill to managed ids and references.",
              "Validate final catalog consistency and file coverage."
            ],
            officialReferences: ["https://ui5.sap.com/"],
            tags: ["legacy"],
            status: "candidate",
            version: "1.0.0",
            owner: "user",
            filePath: "skills/legacy/SKILL.md",
            createdAt: "2026-03-12T10:00:00.000Z",
            updatedAt: "2026-03-12T10:00:00.000Z"
          }
        ]
      }, null, 2)}\n`,
      "utf8"
    );

    const report = await validateProjectSkillsTool.handler(
      {
        strict: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(report.valid).toBe(true);
    expect(report.summary.warningCount).toBeGreaterThan(0);
    expect(report.warnings.some((item) => item.includes("outside managed skills layout"))).toBe(true);
  });
});
