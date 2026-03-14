import { z } from "zod";
import { runGitInRepository, tryResolveGitRepository } from "../../utils/git.js";

const RISK_LEVELS = ["low", "medium", "high"];

const inputSchema = z.object({
  sourceRef: z.string().min(1).optional(),
  targetRef: z.string().min(1).optional(),
  maxFiles: z.number().int().min(10).max(5000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional()
}).strict();

const overlapFileSchema = z.object({
  path: z.string(),
  sourceEdits: z.number().int().nonnegative(),
  targetEdits: z.number().int().nonnegative(),
  overlapDensity: z.enum(["low", "medium", "high"])
});

const outputSchema = z.object({
  repository: z.object({
    gitAvailable: z.boolean(),
    isGitRepository: z.boolean(),
    branch: z.string().nullable(),
    upstream: z.string().nullable(),
    headSha: z.string().nullable()
  }),
  comparison: z.object({
    sourceRef: z.string().nullable(),
    targetRef: z.string().nullable(),
    mergeBase: z.string().nullable(),
    sourceChangedFiles: z.number().int().nonnegative(),
    targetChangedFiles: z.number().int().nonnegative(),
    overlappingFiles: z.number().int().nonnegative()
  }),
  risk: z.object({
    level: z.enum(RISK_LEVELS),
    score: z.number().int().min(0).max(100),
    overlapFiles: z.array(overlapFileSchema),
    notes: z.array(z.string()),
    recommendations: z.array(z.string())
  }),
  automationPolicy: z.object({
    performsMerge: z.boolean(),
    modifiesWorkingTree: z.boolean(),
    note: z.string()
  })
});

export const conflictPrecheckTool = {
  name: "conflict_precheck",
  description: "Estimate merge conflict risk between source and target refs using merge-base overlap analysis (non-destructive).",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const parsed = inputSchema.parse(args);
    const repository = await tryResolveGitRepository(context.rootDir, {
      timeoutMs: parsed.timeoutMs
    });

    if (!repository.gitAvailable || !repository.isGitRepository) {
      return outputSchema.parse({
        repository: {
          gitAvailable: repository.gitAvailable,
          isGitRepository: repository.isGitRepository,
          branch: repository.branch,
          upstream: repository.upstream,
          headSha: repository.headSha
        },
        comparison: {
          sourceRef: null,
          targetRef: null,
          mergeBase: null,
          sourceChangedFiles: 0,
          targetChangedFiles: 0,
          overlappingFiles: 0
        },
        risk: {
          level: "medium",
          score: 40,
          overlapFiles: [],
          notes: [
            !repository.gitAvailable
              ? "Git is not available, so conflict estimation cannot run."
              : "Workspace is not a Git repository."
          ],
          recommendations: ["Initialize or open a Git repository and rerun this precheck."]
        },
        automationPolicy: {
          performsMerge: false,
          modifiesWorkingTree: false,
          note: "This tool is read-only and never performs merge/rebase operations."
        }
      });
    }

    const sourceRef = parsed.sourceRef ?? "HEAD";
    const targetRef = parsed.targetRef ?? repository.upstream ?? await resolveFallbackTarget(context.rootDir, parsed.timeoutMs);
    if (!targetRef) {
      return outputSchema.parse({
        repository: {
          gitAvailable: repository.gitAvailable,
          isGitRepository: repository.isGitRepository,
          branch: repository.branch,
          upstream: repository.upstream,
          headSha: repository.headSha
        },
        comparison: {
          sourceRef,
          targetRef: null,
          mergeBase: null,
          sourceChangedFiles: 0,
          targetChangedFiles: 0,
          overlappingFiles: 0
        },
        risk: {
          level: "medium",
          score: 35,
          overlapFiles: [],
          notes: ["No target reference found. Pass `targetRef` for accurate conflict analysis."],
          recommendations: ["Retry with explicit target, e.g. `targetRef: origin/main`."]
        },
        automationPolicy: {
          performsMerge: false,
          modifiesWorkingTree: false,
          note: "This tool is read-only and never performs merge/rebase operations."
        }
      });
    }

    const [sourceExists, targetExists] = await Promise.all([
      refExists(context.rootDir, sourceRef, parsed.timeoutMs),
      refExists(context.rootDir, targetRef, parsed.timeoutMs)
    ]);

    if (!sourceExists || !targetExists) {
      return outputSchema.parse({
        repository: {
          gitAvailable: repository.gitAvailable,
          isGitRepository: repository.isGitRepository,
          branch: repository.branch,
          upstream: repository.upstream,
          headSha: repository.headSha
        },
        comparison: {
          sourceRef: sourceExists ? sourceRef : null,
          targetRef: targetExists ? targetRef : null,
          mergeBase: null,
          sourceChangedFiles: 0,
          targetChangedFiles: 0,
          overlappingFiles: 0
        },
        risk: {
          level: "medium",
          score: 45,
          overlapFiles: [],
          notes: ["One or more refs were not found."],
          recommendations: ["Verify `sourceRef`/`targetRef` and rerun."]
        },
        automationPolicy: {
          performsMerge: false,
          modifiesWorkingTree: false,
          note: "This tool is read-only and never performs merge/rebase operations."
        }
      });
    }

    const mergeBase = await resolveMergeBase(context.rootDir, sourceRef, targetRef, parsed.timeoutMs);
    if (!mergeBase) {
      return outputSchema.parse({
        repository: {
          gitAvailable: repository.gitAvailable,
          isGitRepository: repository.isGitRepository,
          branch: repository.branch,
          upstream: repository.upstream,
          headSha: repository.headSha
        },
        comparison: {
          sourceRef,
          targetRef,
          mergeBase: null,
          sourceChangedFiles: 0,
          targetChangedFiles: 0,
          overlappingFiles: 0
        },
        risk: {
          level: "high",
          score: 70,
          overlapFiles: [],
          notes: ["No merge-base found between refs. Branches may be unrelated."],
          recommendations: ["Recheck branch ancestry before attempting merge."]
        },
        automationPolicy: {
          performsMerge: false,
          modifiesWorkingTree: false,
          note: "This tool is read-only and never performs merge/rebase operations."
        }
      });
    }

    const maxFiles = parsed.maxFiles ?? 300;
    const [sourceNumstat, targetNumstat] = await Promise.all([
      collectNumstat(context.rootDir, `${mergeBase}..${sourceRef}`, parsed.timeoutMs),
      collectNumstat(context.rootDir, `${mergeBase}..${targetRef}`, parsed.timeoutMs)
    ]);

    const overlapFiles = buildOverlap(sourceNumstat, targetNumstat)
      .slice(0, maxFiles)
      .map((item) => ({
        path: item.path,
        sourceEdits: item.sourceEdits,
        targetEdits: item.targetEdits,
        overlapDensity: inferDensity(item.sourceEdits + item.targetEdits)
      }));

    const score = inferConflictScore(overlapFiles.length, sourceNumstat.size, targetNumstat.size);
    const level = inferRiskLevel(score);
    const notes = [
      `Compared changes from merge-base ${mergeBase.slice(0, 10)}.`,
      `Source changed files: ${sourceNumstat.size}. Target changed files: ${targetNumstat.size}.`
    ];
    const recommendations = buildRecommendations(level, overlapFiles.length);

    return outputSchema.parse({
      repository: {
        gitAvailable: repository.gitAvailable,
        isGitRepository: repository.isGitRepository,
        branch: repository.branch,
        upstream: repository.upstream,
        headSha: repository.headSha
      },
      comparison: {
        sourceRef,
        targetRef,
        mergeBase,
        sourceChangedFiles: sourceNumstat.size,
        targetChangedFiles: targetNumstat.size,
        overlappingFiles: overlapFiles.length
      },
      risk: {
        level,
        score,
        overlapFiles,
        notes,
        recommendations
      },
      automationPolicy: {
        performsMerge: false,
        modifiesWorkingTree: false,
        note: "This tool is read-only and never performs merge/rebase operations."
      }
    });
  }
};

async function resolveFallbackTarget(rootDir, timeoutMs) {
  const candidates = ["origin/main", "origin/master", "main", "master", "develop"];
  for (const candidate of candidates) {
    if (await refExists(rootDir, candidate, timeoutMs)) {
      return candidate;
    }
  }
  return null;
}

async function refExists(rootDir, ref, timeoutMs) {
  try {
    await runGitInRepository(["rev-parse", "--verify", ref], {
      cwd: rootDir,
      timeoutMs
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveMergeBase(rootDir, sourceRef, targetRef, timeoutMs) {
  try {
    const output = await runGitInRepository(["merge-base", sourceRef, targetRef], {
      cwd: rootDir,
      timeoutMs
    });
    return output.trim() || null;
  } catch {
    return null;
  }
}

async function collectNumstat(rootDir, rangeExpr, timeoutMs) {
  const map = new Map();
  try {
    const output = await runGitInRepository(["diff", "--numstat", rangeExpr], {
      cwd: rootDir,
      timeoutMs
    });
    for (const line of output.split(/\r?\n/).filter(Boolean)) {
      const parts = line.split("\t");
      if (parts.length < 3) {
        continue;
      }
      const additions = parts[0] === "-" ? 0 : Number.parseInt(parts[0], 10);
      const deletions = parts[1] === "-" ? 0 : Number.parseInt(parts[1], 10);
      const filePath = parts[parts.length - 1].replaceAll("\\", "/");
      const edits = (Number.isFinite(additions) ? additions : 0) + (Number.isFinite(deletions) ? deletions : 0);
      map.set(filePath, edits);
    }
  } catch {
    return map;
  }
  return map;
}

function buildOverlap(sourceNumstat, targetNumstat) {
  const overlaps = [];
  for (const [filePath, sourceEdits] of sourceNumstat.entries()) {
    if (!targetNumstat.has(filePath)) {
      continue;
    }
    const targetEdits = targetNumstat.get(filePath) ?? 0;
    overlaps.push({
      path: filePath,
      sourceEdits,
      targetEdits,
      total: sourceEdits + targetEdits
    });
  }
  return overlaps.sort((a, b) => b.total - a.total || a.path.localeCompare(b.path));
}

function inferDensity(totalEdits) {
  if (totalEdits >= 80) {
    return "high";
  }
  if (totalEdits >= 20) {
    return "medium";
  }
  return "low";
}

function inferConflictScore(overlapCount, sourceCount, targetCount) {
  if (sourceCount === 0 && targetCount === 0) {
    return 0;
  }
  const normalizedOverlap = sourceCount + targetCount > 0
    ? overlapCount / Math.max(1, Math.min(sourceCount, targetCount))
    : 0;
  const raw = Math.round(Math.min(100, (overlapCount * 8) + (normalizedOverlap * 40)));
  return Math.max(0, raw);
}

function inferRiskLevel(score) {
  if (score >= 60) {
    return "high";
  }
  if (score >= 25) {
    return "medium";
  }
  return "low";
}

function buildRecommendations(level, overlapCount) {
  const recommendations = [];
  if (overlapCount === 0) {
    recommendations.push("No overlapping file edits detected from merge-base perspective.");
    recommendations.push("Still run `npm run check` after integration.");
    return recommendations;
  }
  if (level === "high") {
    recommendations.push("Coordinate merge order and resolve hot files collaboratively.");
    recommendations.push("Rebase frequently and validate after each conflict resolution.");
  } else if (level === "medium") {
    recommendations.push("Review overlapping files before merge to reduce manual conflict resolution.");
  } else {
    recommendations.push("Proceed with normal integration flow and standard validation.");
  }
  recommendations.push("Run `npm run check` after merging target changes.");
  return recommendations;
}
