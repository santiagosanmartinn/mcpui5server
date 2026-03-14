import { z } from "zod";
import { runGitInRepository, tryResolveGitRepository } from "../../utils/git.js";
import { resolveLanguage, t } from "../../utils/language.js";

const NOTE_TYPES = ["feat", "fix", "perf", "refactor", "docs", "test", "chore", "other"];

const inputSchema = z.object({
  fromRef: z.string().min(1).optional(),
  toRef: z.string().min(1).optional(),
  language: z.enum(["es", "en"]).optional(),
  maxCommits: z.number().int().min(1).max(500).optional(),
  includeAuthors: z.boolean().optional()
}).strict();

const outputSchema = z.object({
  repository: z.object({
    gitAvailable: z.boolean(),
    isGitRepository: z.boolean(),
    branch: z.string().nullable(),
    headSha: z.string().nullable()
  }),
  range: z.object({
    fromRef: z.string().nullable(),
    toRef: z.string(),
    mode: z.enum(["range", "tail"])
  }),
  summary: z.object({
    totalCommits: z.number().int().nonnegative(),
    truncated: z.boolean(),
    breakingChanges: z.number().int().nonnegative(),
    byType: z.object({
      feat: z.number().int().nonnegative(),
      fix: z.number().int().nonnegative(),
      perf: z.number().int().nonnegative(),
      refactor: z.number().int().nonnegative(),
      docs: z.number().int().nonnegative(),
      test: z.number().int().nonnegative(),
      chore: z.number().int().nonnegative(),
      other: z.number().int().nonnegative()
    })
  }),
  entries: z.array(
    z.object({
      sha: z.string(),
      shortSha: z.string(),
      type: z.enum(NOTE_TYPES),
      scope: z.string().nullable(),
      subject: z.string(),
      author: z.string().nullable(),
      date: z.string(),
      breaking: z.boolean()
    })
  ),
  releaseNotes: z.object({
    highlights: z.array(z.string()),
    markdown: z.string()
  }),
  automationPolicy: z.object({
    readOnlyGitAnalysis: z.boolean(),
    note: z.string()
  })
});

export const releaseNotesFromCommitsTool = {
  name: "release_notes_from_commits",
  description: "Generate release notes from commit history (range or recent tail) using conventional-commit heuristics.",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const language = resolveLanguage(parsed.language);
    const maxCommits = parsed.maxCommits ?? 50;
    const includeAuthors = parsed.includeAuthors ?? true;
    const repository = await tryResolveGitRepository(context.rootDir, {});
    const toRef = parsed.toRef ?? "HEAD";

    if (!repository.gitAvailable || !repository.isGitRepository) {
      return outputSchema.parse({
        repository: {
          gitAvailable: repository.gitAvailable,
          isGitRepository: repository.isGitRepository,
          branch: repository.branch,
          headSha: repository.headSha
        },
        range: {
          fromRef: parsed.fromRef ?? null,
          toRef,
          mode: parsed.fromRef ? "range" : "tail"
        },
        summary: {
          totalCommits: 0,
          truncated: false,
          breakingChanges: 0,
          byType: emptyTypeCounter()
        },
        entries: [],
        releaseNotes: {
          highlights: [
            !repository.gitAvailable
              ? t(language, "Git no esta disponible en este entorno.", "Git is not available in this environment.")
              : t(language, "El workspace no es un repositorio Git.", "Workspace is not a Git repository.")
          ],
          markdown: t(language, "# Notas de Version\n\n_No hay datos de commits disponibles._", "# Release Notes\n\n_No commit data available._")
        },
        automationPolicy: {
          readOnlyGitAnalysis: true,
          note: t(language, "Esta tool solo lee historial Git y no modifica estado del repo.", "This tool only reads Git history and does not modify repo state.")
        }
      });
    }

    const mode = parsed.fromRef ? "range" : "tail";
    const logArgs = buildLogArgs({
      fromRef: parsed.fromRef,
      toRef,
      maxCommits
    });
    const output = await runGitInRepository(logArgs, {
      cwd: context.rootDir
    });
    const entriesRaw = parseLogOutput(output);
    const entries = entriesRaw.map((entry) => toReleaseEntry(entry, includeAuthors));
    const byType = countByType(entries);
    const breakingChanges = entries.filter((item) => item.breaking).length;
    const truncated = mode === "tail" && entries.length >= maxCommits;
    const highlights = buildHighlights(entries, language);
    const markdown = buildMarkdown({
      entries,
      byType,
      breakingChanges,
      language,
      includeAuthors
    });

    return outputSchema.parse({
      repository: {
        gitAvailable: repository.gitAvailable,
        isGitRepository: repository.isGitRepository,
        branch: repository.branch,
        headSha: repository.headSha
      },
      range: {
        fromRef: parsed.fromRef ?? null,
        toRef,
        mode
      },
      summary: {
        totalCommits: entries.length,
        truncated,
        breakingChanges,
        byType
      },
      entries,
      releaseNotes: {
        highlights,
        markdown
      },
      automationPolicy: {
        readOnlyGitAnalysis: true,
        note: t(language, "Esta tool solo lee historial Git y no modifica estado del repo.", "This tool only reads Git history and does not modify repo state.")
      }
    });
  }
};

function buildLogArgs(input) {
  const format = "%H%x1f%h%x1f%an%x1f%ae%x1f%cI%x1f%s%x1f%b%x1e";
  if (input.fromRef) {
    return ["log", `${input.fromRef}..${input.toRef}`, `--format=${format}`];
  }
  return ["log", input.toRef, `--max-count=${input.maxCommits}`, `--format=${format}`];
}

function parseLogOutput(output) {
  return output
    .split("\x1e")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [sha, shortSha, authorName, authorEmail, date, subject, body] = block.split("\x1f");
      return {
        sha: (sha ?? "").trim(),
        shortSha: (shortSha ?? "").trim(),
        authorName: (authorName ?? "").trim(),
        authorEmail: (authorEmail ?? "").trim(),
        date: (date ?? "").trim(),
        subject: (subject ?? "").trim(),
        body: (body ?? "").trim()
      };
    })
    .filter((entry) => entry.sha && entry.subject);
}

function toReleaseEntry(entry, includeAuthors) {
  const parsed = parseConventionalSubject(entry.subject, entry.body);
  return {
    sha: entry.sha,
    shortSha: entry.shortSha || entry.sha.slice(0, 7),
    type: parsed.type,
    scope: parsed.scope,
    subject: parsed.subject,
    author: includeAuthors ? formatAuthor(entry.authorName, entry.authorEmail) : null,
    date: entry.date,
    breaking: parsed.breaking
  };
}

function parseConventionalSubject(subject, body) {
  const match = subject.match(/^(feat|fix|perf|refactor|docs|test|chore)(?:\(([^)]+)\))?(!)?:\s+(.+)$/i);
  if (!match) {
    return {
      type: "other",
      scope: null,
      subject,
      breaking: /breaking change/i.test(body || "")
    };
  }
  return {
    type: match[1].toLowerCase(),
    scope: match[2] ? match[2].trim() : null,
    subject: match[4].trim(),
    breaking: Boolean(match[3]) || /breaking change/i.test(body || "")
  };
}

function formatAuthor(name, email) {
  if (!name && !email) {
    return null;
  }
  if (!email) {
    return name;
  }
  return `${name} <${email}>`;
}

function countByType(entries) {
  const counter = emptyTypeCounter();
  for (const entry of entries) {
    counter[entry.type] += 1;
  }
  return counter;
}

function emptyTypeCounter() {
  return {
    feat: 0,
    fix: 0,
    perf: 0,
    refactor: 0,
    docs: 0,
    test: 0,
    chore: 0,
    other: 0
  };
}

function buildHighlights(entries, language) {
  const highlights = [];
  const breaking = entries.filter((entry) => entry.breaking);
  if (breaking.length > 0) {
    highlights.push(
      t(
        language,
        `Cambios breaking detectados: ${breaking.length}.`,
        `Breaking changes detected: ${breaking.length}.`
      )
    );
  }
  const featCount = entries.filter((entry) => entry.type === "feat").length;
  if (featCount > 0) {
    highlights.push(t(language, `Nuevas funcionalidades: ${featCount}.`, `New features: ${featCount}.`));
  }
  const fixCount = entries.filter((entry) => entry.type === "fix").length;
  if (fixCount > 0) {
    highlights.push(t(language, `Correcciones: ${fixCount}.`, `Fixes: ${fixCount}.`));
  }
  if (highlights.length === 0) {
    highlights.push(t(language, "No se detectaron highlights relevantes en el rango.", "No relevant highlights were detected in the selected range."));
  }
  return highlights;
}

function buildMarkdown(input) {
  const sections = new Map([
    ["feat", []],
    ["fix", []],
    ["perf", []],
    ["refactor", []],
    ["docs", []],
    ["test", []],
    ["chore", []],
    ["other", []]
  ]);

  for (const entry of input.entries) {
    sections.get(entry.type).push(entry);
  }

  const lines = [];
  lines.push(t(input.language, "# Notas de Version", "# Release Notes"));
  lines.push("");
  lines.push(
    t(
      input.language,
      `Total commits: ${input.entries.length}. Breaking changes: ${input.breakingChanges}.`,
      `Total commits: ${input.entries.length}. Breaking changes: ${input.breakingChanges}.`
    )
  );

  appendSection(lines, t(input.language, "Nuevas funcionalidades", "Features"), sections.get("feat"), input.language, input.includeAuthors);
  appendSection(lines, t(input.language, "Correcciones", "Fixes"), sections.get("fix"), input.language, input.includeAuthors);
  appendSection(lines, t(input.language, "Rendimiento", "Performance"), sections.get("perf"), input.language, input.includeAuthors);
  appendSection(lines, t(input.language, "Refactorizacion", "Refactoring"), sections.get("refactor"), input.language, input.includeAuthors);
  appendSection(lines, t(input.language, "Documentacion", "Documentation"), sections.get("docs"), input.language, input.includeAuthors);
  appendSection(lines, t(input.language, "Pruebas", "Tests"), sections.get("test"), input.language, input.includeAuthors);
  appendSection(lines, t(input.language, "Mantenimiento", "Maintenance"), sections.get("chore"), input.language, input.includeAuthors);
  appendSection(lines, t(input.language, "Otros", "Other"), sections.get("other"), input.language, input.includeAuthors);

  return lines.join("\n");
}

function appendSection(lines, title, entries, language, includeAuthors) {
  if (!entries || entries.length === 0) {
    return;
  }
  lines.push("");
  lines.push(`## ${title}`);
  for (const entry of entries) {
    const scope = entry.scope ? `(${entry.scope}) ` : "";
    const breakingTag = entry.breaking ? t(language, " [BREAKING]", " [BREAKING]") : "";
    const authorTag = includeAuthors && entry.author ? ` - ${entry.author}` : "";
    lines.push(`- ${scope}${entry.subject}${breakingTag} (${entry.shortSha})${authorTag}`);
  }
}
