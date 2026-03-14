import { z } from "zod";
import { runGitInRepository, tryResolveGitRepository } from "../../utils/git.js";
import { resolveLanguage, t } from "../../utils/language.js";

const NOTE_TYPES = ["feat", "fix", "perf", "refactor", "docs", "test", "chore", "other"];
const COMPARE_BY = ["auto", "refs", "tags", "since_latest_tag"];
const RANGE_MODES = ["range", "tail", "tag_range", "since_latest_tag"];
const NOTE_FORMATS = ["notes", "changelog"];

const inputSchema = z.object({
  fromRef: z.string().min(1).optional(),
  toRef: z.string().min(1).optional(),
  fromTag: z.string().min(1).optional(),
  toTag: z.string().min(1).optional(),
  compareBy: z.enum(COMPARE_BY).optional(),
  format: z.enum(NOTE_FORMATS).optional(),
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
    fromTag: z.string().nullable(),
    toTag: z.string().nullable(),
    mode: z.enum(RANGE_MODES),
    compareBy: z.enum(["refs", "tags", "since_latest_tag"])
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
    format: z.enum(NOTE_FORMATS),
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
    const format = resolveOutputFormat(parsed);
    const repository = await tryResolveGitRepository(context.rootDir, {});
    const fallbackPlan = buildFallbackPlan(parsed);

    if (!repository.gitAvailable || !repository.isGitRepository) {
      return outputSchema.parse({
        repository: {
          gitAvailable: repository.gitAvailable,
          isGitRepository: repository.isGitRepository,
          branch: repository.branch,
          headSha: repository.headSha
        },
        range: {
          fromRef: fallbackPlan.fromRef,
          toRef: fallbackPlan.toRef,
          fromTag: fallbackPlan.fromTag,
          toTag: fallbackPlan.toTag,
          mode: fallbackPlan.mode,
          compareBy: fallbackPlan.compareBy
        },
        summary: {
          totalCommits: 0,
          truncated: false,
          breakingChanges: 0,
          byType: emptyTypeCounter()
        },
        entries: [],
        releaseNotes: {
          format,
          highlights: [
            !repository.gitAvailable
              ? t(language, "Git no esta disponible en este entorno.", "Git is not available in this environment.")
              : t(language, "El workspace no es un repositorio Git.", "Workspace is not a Git repository.")
          ],
          markdown: format === "changelog"
            ? t(language, "# Changelog\n\n_No hay datos de commits disponibles._", "# Changelog\n\n_No commit data available._")
            : t(language, "# Notas de Version\n\n_No hay datos de commits disponibles._", "# Release Notes\n\n_No commit data available._")
        },
        automationPolicy: {
          readOnlyGitAnalysis: true,
          note: t(language, "Esta tool solo lee historial Git y no modifica estado del repo.", "This tool only reads Git history and does not modify repo state.")
        }
      });
    }

    const plan = await resolveComparisonPlan({
      parsed,
      rootDir: context.rootDir
    });
    const logArgs = buildLogArgs({
      fromRef: plan.fromRef,
      toRef: plan.toRef,
      maxCommits
    });
    const output = await runGitInRepository(logArgs, {
      cwd: context.rootDir
    });
    const entriesRaw = parseLogOutput(output);
    const entries = entriesRaw.map((entry) => toReleaseEntry(entry, includeAuthors));
    const byType = countByType(entries);
    const breakingChanges = entries.filter((item) => item.breaking).length;
    const truncated = entries.length >= maxCommits;
    const highlights = buildHighlights({
      entries,
      language,
      range: plan,
      fallbackNotes: plan.notes
    });
    const markdown = format === "changelog"
      ? buildChangelogMarkdown({
        entries,
        byType,
        breakingChanges,
        language,
        includeAuthors,
        range: plan
      })
      : buildReleaseNotesMarkdown({
      entries,
      byType,
      breakingChanges,
      language,
      includeAuthors,
      range: plan
    });

    return outputSchema.parse({
      repository: {
        gitAvailable: repository.gitAvailable,
        isGitRepository: repository.isGitRepository,
        branch: repository.branch,
        headSha: repository.headSha
      },
      range: {
        fromRef: plan.fromRef,
        toRef: plan.toRef,
        fromTag: plan.fromTag,
        toTag: plan.toTag,
        mode: plan.mode,
        compareBy: plan.compareBy
      },
      summary: {
        totalCommits: entries.length,
        truncated,
        breakingChanges,
        byType
      },
      entries,
      releaseNotes: {
        format,
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
    return ["log", `${input.fromRef}..${input.toRef}`, `--max-count=${input.maxCommits}`, `--format=${format}`];
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

function buildHighlights(input) {
  const highlights = [];
  const breaking = input.entries.filter((entry) => entry.breaking);
  const compareLabel = buildRangeLabel(input.range, input.language);
  if (compareLabel) {
    highlights.push(compareLabel);
  }
  for (const note of input.fallbackNotes) {
    highlights.push(note);
  }
  if (breaking.length > 0) {
    highlights.push(
      t(
        input.language,
        `Cambios breaking detectados: ${breaking.length}.`,
        `Breaking changes detected: ${breaking.length}.`
      )
    );
  }
  const featCount = input.entries.filter((entry) => entry.type === "feat").length;
  if (featCount > 0) {
    highlights.push(t(input.language, `Nuevas funcionalidades: ${featCount}.`, `New features: ${featCount}.`));
  }
  const fixCount = input.entries.filter((entry) => entry.type === "fix").length;
  if (fixCount > 0) {
    highlights.push(t(input.language, `Correcciones: ${fixCount}.`, `Fixes: ${fixCount}.`));
  }
  if (highlights.length === 0) {
    highlights.push(t(input.language, "No se detectaron highlights relevantes en el rango.", "No relevant highlights were detected in the selected range."));
  }
  return highlights;
}

function buildReleaseNotesMarkdown(input) {
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
  const compareLabel = buildRangeLabel(input.range, input.language);
  if (compareLabel) {
    lines.push(compareLabel);
  }
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

function buildChangelogMarkdown(input) {
  const sections = {
    added: input.entries.filter((entry) => entry.type === "feat"),
    fixed: input.entries.filter((entry) => entry.type === "fix"),
    changed: input.entries.filter((entry) => entry.type === "perf" || entry.type === "refactor" || entry.type === "other"),
    docs: input.entries.filter((entry) => entry.type === "docs"),
    tests: input.entries.filter((entry) => entry.type === "test"),
    chore: input.entries.filter((entry) => entry.type === "chore"),
    breaking: input.entries.filter((entry) => entry.breaking)
  };

  const releaseLabel = input.range.toTag ?? input.range.toRef;
  const previousLabel = input.range.fromTag ?? input.range.fromRef;
  const lines = [];
  lines.push("# Changelog");
  lines.push("");
  lines.push(`## [${releaseLabel}] - ${toDateOnly(new Date())}`);
  if (previousLabel) {
    lines.push(t(input.language, `_Comparado con ${previousLabel}_`, `_Compared with ${previousLabel}_`));
  }

  appendSection(lines, "### Added", sections.added, input.language, input.includeAuthors);
  appendSection(lines, "### Fixed", sections.fixed, input.language, input.includeAuthors);
  appendSection(lines, "### Changed", sections.changed, input.language, input.includeAuthors);
  appendSection(lines, "### Documentation", sections.docs, input.language, input.includeAuthors);
  appendSection(lines, "### Tests", sections.tests, input.language, input.includeAuthors);
  appendSection(lines, "### Chore", sections.chore, input.language, input.includeAuthors);
  appendSection(lines, "### Breaking Changes", sections.breaking, input.language, input.includeAuthors);

  if (input.entries.length === 0) {
    lines.push("");
    lines.push(t(input.language, "- Sin cambios detectados en el rango seleccionado.", "- No changes detected in selected range."));
  }

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

function toDateOnly(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "1970-01-01";
  }
  return value.toISOString().slice(0, 10);
}

function resolveOutputFormat(parsed) {
  if (parsed.format) {
    return parsed.format;
  }
  if (parsed.compareBy === "tags" || parsed.compareBy === "since_latest_tag" || parsed.fromTag || parsed.toTag) {
    return "changelog";
  }
  return "notes";
}

function buildFallbackPlan(parsed) {
  const toRef = parsed.toRef ?? "HEAD";
  if (parsed.compareBy === "since_latest_tag") {
    return {
      fromRef: null,
      toRef,
      fromTag: parsed.fromTag ?? null,
      toTag: parsed.toTag ?? null,
      mode: "since_latest_tag",
      compareBy: "since_latest_tag"
    };
  }
  if (parsed.compareBy === "tags" || parsed.fromTag || parsed.toTag) {
    return {
      fromRef: parsed.fromTag ?? parsed.fromRef ?? null,
      toRef: parsed.toTag ?? toRef,
      fromTag: parsed.fromTag ?? null,
      toTag: parsed.toTag ?? null,
      mode: "tag_range",
      compareBy: "tags"
    };
  }
  return {
    fromRef: parsed.fromRef ?? null,
    toRef,
    fromTag: null,
    toTag: null,
    mode: parsed.fromRef ? "range" : "tail",
    compareBy: "refs"
  };
}

async function resolveComparisonPlan(input) {
  const parsed = input.parsed;
  const rootDir = input.rootDir;
  const toRef = parsed.toRef ?? "HEAD";
  const notes = [];

  if (parsed.compareBy === "since_latest_tag") {
    const latestTag = await resolveLatestMergedTag(rootDir, toRef);
    if (latestTag) {
      return {
        fromRef: latestTag,
        toRef,
        fromTag: latestTag,
        toTag: null,
        mode: "since_latest_tag",
        compareBy: "since_latest_tag",
        notes
      };
    }
    notes.push(
      t(
        resolveLanguage(parsed.language),
        "No se encontro tag previa; se usa modo tail como fallback.",
        "No previous tag found; falling back to tail mode."
      )
    );
    return {
      fromRef: null,
      toRef,
      fromTag: null,
      toTag: null,
      mode: "tail",
      compareBy: "refs",
      notes
    };
  }

  if (parsed.compareBy === "tags" || parsed.fromTag || parsed.toTag) {
    const toTag = parsed.toTag ?? await resolveLatestMergedTag(rootDir, toRef);
    if (toTag) {
      const fromTag = parsed.fromTag ?? await resolvePreviousTag(rootDir, toTag);
      if (fromTag) {
        return {
          fromRef: fromTag,
          toRef: toTag,
          fromTag,
          toTag,
          mode: "tag_range",
          compareBy: "tags",
          notes
        };
      }
      notes.push(
        t(
          resolveLanguage(parsed.language),
          `No se encontro tag anterior a ${toTag}; se usa modo range/tail como fallback.`,
          `No previous tag found before ${toTag}; falling back to range/tail mode.`
        )
      );
    }
  }

  if (parsed.fromRef) {
    return {
      fromRef: parsed.fromRef,
      toRef,
      fromTag: null,
      toTag: null,
      mode: "range",
      compareBy: "refs",
      notes
    };
  }

  return {
    fromRef: null,
    toRef,
    fromTag: null,
    toTag: null,
    mode: "tail",
    compareBy: "refs",
    notes
  };
}

async function resolveLatestMergedTag(rootDir, ref) {
  try {
    const output = await runGitInRepository(["describe", "--tags", "--abbrev=0", ref], {
      cwd: rootDir
    });
    return output.trim() || null;
  } catch {
    try {
      const output = await runGitInRepository(["tag", "--merged", ref, "--sort=-creatordate"], {
        cwd: rootDir
      });
      const tags = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      return tags[0] ?? null;
    } catch {
      return null;
    }
  }
}

async function resolvePreviousTag(rootDir, toTag) {
  try {
    const output = await runGitInRepository(["describe", "--tags", "--abbrev=0", `${toTag}^`], {
      cwd: rootDir
    });
    return output.trim() || null;
  } catch {
    try {
      const output = await runGitInRepository(["tag", "--merged", toTag, "--sort=-creatordate"], {
        cwd: rootDir
      });
      const tags = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((tag) => tag !== toTag);
      return tags[0] ?? null;
    } catch {
      return null;
    }
  }
}

function buildRangeLabel(range, language) {
  if (range.mode === "tag_range" && range.fromTag && range.toTag) {
    return t(language, `Comparativa de tags: ${range.fromTag}..${range.toTag}.`, `Tag comparison: ${range.fromTag}..${range.toTag}.`);
  }
  if (range.mode === "since_latest_tag" && range.fromTag) {
    return t(language, `Cambios desde la ultima etiqueta (${range.fromTag}) hasta ${range.toRef}.`, `Changes since latest tag (${range.fromTag}) to ${range.toRef}.`);
  }
  if (range.mode === "range" && range.fromRef) {
    return t(language, `Comparativa de refs: ${range.fromRef}..${range.toRef}.`, `Ref comparison: ${range.fromRef}..${range.toRef}.`);
  }
  return null;
}
