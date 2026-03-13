import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { scaffoldProjectSkillsTool } from "../../src/tools/agents/scaffoldProjectSkills.js";
import { validateProjectSkillsTool } from "../../src/tools/agents/validateProjectSkills.js";

describe("scaffold_project_skills tool", () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-scaffold-skills-"));
    const manifestPath = path.join(tempRoot, "webapp", "manifest.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify({
        "sap.app": { id: "demo.skills" },
        "sap.ui5": {}
      }, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("supports dryRun and returns previews without writing files", async () => {
    const result = await scaffoldProjectSkillsTool.handler(
      {
        includeDefaultSkills: false,
        customSkills: [
          {
            id: "custom-skill-alpha",
            title: "Custom Skill Alpha",
            goal: "Provide a deterministic workflow for a controlled skill scaffold test.",
            whenToUse: "Use when validating the managed skill catalog and write preview flow.",
            workflowSteps: [
              "Inspect current project structure and runtime constraints.",
              "Prepare a minimal safe change plan with explicit validation steps.",
              "Return previews before any write operation."
            ],
            officialReferences: [
              "https://ui5.sap.com/"
            ],
            tags: ["ui5", "testing"]
          }
        ],
        dryRun: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(result.dryRun).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.applyResult).toBeNull();
    expect(result.previews.map((item) => item.role)).toEqual(
      expect.arrayContaining(["skills-catalog", "skill-doc", "skills-feedback-log", "skills-feedback-metrics", "skills-doc"])
    );
    await expect(fs.access(path.join(tempRoot, ".codex", "mcp", "skills", "catalog.json"))).rejects.toThrow();
  });

  it("applies scaffold and passes strict validation", async () => {
    const scaffold = await scaffoldProjectSkillsTool.handler(
      {
        includeDefaultSkills: true,
        dryRun: false
      },
      {
        context: { rootDir: tempRoot }
      }
    );

    expect(scaffold.changed).toBe(true);
    expect(scaffold.applyResult?.patchId).toMatch(/^patch-/);
    await expect(fs.access(path.join(tempRoot, ".codex", "mcp", "skills", "catalog.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempRoot, "docs", "mcp", "skills.md"))).resolves.toBeUndefined();

    const validation = await validateProjectSkillsTool.handler(
      {
        strict: true
      },
      {
        context: { rootDir: tempRoot }
      }
    );
    expect(validation.valid).toBe(true);
    expect(validation.summary.errorCount).toBe(0);
    expect(validation.summary.warningCount).toBe(0);
  });
});
