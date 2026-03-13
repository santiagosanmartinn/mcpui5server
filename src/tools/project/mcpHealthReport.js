import { z } from "zod";
import { fileExists, readJsonFile, readTextFile } from "../../utils/fileSystem.js";
import { DEFAULT_AGENT_POLICY_PATH, loadAgentPolicy } from "../../utils/agentPolicy.js";
import { calculateToolContractHash } from "../../utils/toolContracts.js";

const DEFAULT_CONTRACT_SNAPSHOT_PATH = "docs/contracts/tool-contracts.snapshot.json";
const DEFAULT_REFERENCE_DOC_PATH = "docs/referencia-tools.md";
const DEFAULT_EXAMPLES_DOC_PATH = "docs/ejemplos-tools.md";
const DEFAULT_INTAKE_PATH = ".codex/mcp/project/intake.json";
const DEFAULT_BASELINE_PATH = ".codex/mcp/project/legacy-baseline.json";
const DEFAULT_CONTEXT_INDEX_PATH = ".codex/mcp/context/context-index.json";
const DEFAULT_BLUEPRINT_PATH = ".codex/mcp/agents/agent.blueprint.json";
const DEFAULT_AGENTS_GUIDE_PATH = ".codex/mcp/agents/AGENTS.generated.md";
const DEFAULT_SKILL_METRICS_PATH = ".codex/mcp/skills/feedback/metrics.json";
const DEFAULT_PACK_METRICS_PATH = ".codex/mcp/feedback/metrics.json";
const DEFAULT_TRANSITION_THRESHOLDS = {
  minSkillExecutions: 10,
  minSkillSuccessRate: 0.75,
  minQualifiedSkills: 1,
  minSkillExecutionsPerQualifiedSkill: 3,
  minQualifiedSkillSuccessRate: 0.8,
  minPackExecutions: 6,
  minPackSuccessRate: 0.7
};

const inputSchema = z.object({
  includeToolNames: z.boolean().optional(),
  includeDocChecks: z.boolean().optional(),
  includePolicyStatus: z.boolean().optional(),
  includePolicyTransition: z.boolean().optional(),
  includeContractStatus: z.boolean().optional(),
  includeManagedArtifacts: z.boolean().optional(),
  referenceDocPath: z.string().min(1).optional(),
  examplesDocPath: z.string().min(1).optional(),
  policyPath: z.string().min(1).optional(),
  contractSnapshotPath: z.string().min(1).optional(),
  skillMetricsPath: z.string().min(1).optional(),
  packMetricsPath: z.string().min(1).optional()
}).strict();

const outputSchema = z.object({
  generatedAt: z.string(),
  server: z.object({
    name: z.string(),
    version: z.string(),
    autoEnsureProject: z.boolean(),
    autoEnsureProjectApply: z.boolean(),
    autoPrepareContext: z.boolean(),
    autoPrepareContextApply: z.boolean()
  }),
  workspace: z.object({
    rootDir: z.string()
  }),
  tools: z.object({
    registered: z.number().int().nonnegative(),
    unique: z.number().int().nonnegative(),
    duplicates: z.array(z.string()),
    namesIncluded: z.boolean(),
    names: z.array(z.string())
  }),
  docs: z.object({
    executed: z.boolean(),
    referenceDocPath: z.string(),
    examplesDocPath: z.string(),
    referenceDocExists: z.boolean(),
    examplesDocExists: z.boolean(),
    referenceInSync: z.boolean(),
    examplesInSync: z.boolean(),
    missingFromReference: z.array(z.string()),
    missingFromExamples: z.array(z.string()),
    extraInReference: z.array(z.string()),
    extraInExamples: z.array(z.string()),
    error: z.string().nullable()
  }),
  policy: z.object({
    executed: z.boolean(),
    path: z.string(),
    exists: z.boolean(),
    loaded: z.boolean(),
    enabled: z.boolean(),
    error: z.string().nullable()
  }),
  contracts: z.object({
    executed: z.boolean(),
    snapshotPath: z.string(),
    exists: z.boolean(),
    inSync: z.boolean(),
    currentHash: z.string().nullable(),
    snapshotHash: z.string().nullable(),
    error: z.string().nullable()
  }),
  policyTransition: z.object({
    executed: z.boolean(),
    policyPath: z.string(),
    currentPreset: z.enum(["starter", "mature", "custom", "unknown"]),
    recommendation: z.enum(["promote-to-mature", "keep-starter", "keep-mature", "review-manual"]),
    readyForMature: z.boolean(),
    confidence: z.number().min(0).max(1),
    thresholds: z.object({
      minSkillExecutions: z.number().int().nonnegative(),
      minSkillSuccessRate: z.number().min(0).max(1),
      minQualifiedSkills: z.number().int().positive(),
      minSkillExecutionsPerQualifiedSkill: z.number().int().positive(),
      minQualifiedSkillSuccessRate: z.number().min(0).max(1),
      minPackExecutions: z.number().int().nonnegative(),
      minPackSuccessRate: z.number().min(0).max(1)
    }),
    signals: z.object({
      skillExecutions: z.number().int().nonnegative(),
      skillSuccessRate: z.number().min(0).max(1),
      qualifiedSkills: z.number().int().nonnegative(),
      packExecutions: z.number().int().nonnegative(),
      packSuccessRate: z.number().min(0).max(1),
      packEvidencePresent: z.boolean()
    }),
    reasons: z.array(z.string()),
    nextAction: z.string().nullable(),
    error: z.string().nullable()
  }),
  managedArtifacts: z.object({
    executed: z.boolean(),
    intakeExists: z.boolean(),
    baselineExists: z.boolean(),
    contextIndexExists: z.boolean(),
    policyExists: z.boolean(),
    blueprintExists: z.boolean(),
    agentsGuideExists: z.boolean()
  })
});

export const mcpHealthReportTool = {
  name: "mcp_health_report",
  description: "Return MCP server/runtime health diagnostics (tool exposure, docs alignment, contract snapshot, and managed artifact status).",
  inputSchema,
  outputSchema,
  async handler(args, { context }) {
    const {
      includeToolNames,
      includeDocChecks,
      includePolicyStatus,
      includePolicyTransition,
      includeContractStatus,
      includeManagedArtifacts,
      referenceDocPath,
      examplesDocPath,
      policyPath,
      contractSnapshotPath,
      skillMetricsPath,
      packMetricsPath
    } = inputSchema.parse(args);

    const root = context.rootDir;
    const serverInfo = context.serverInfo ?? {
      name: "sapui5-mcp-server",
      version: "unknown"
    };
    const toolNames = Array.isArray(context.registeredToolNames)
      ? context.registeredToolNames.map((item) => String(item))
      : [];
    const namesIncluded = includeToolNames ?? false;
    const shouldCheckDocs = includeDocChecks ?? true;
    const shouldCheckPolicy = includePolicyStatus ?? true;
    const shouldCheckPolicyTransition = includePolicyTransition ?? true;
    const shouldCheckContracts = includeContractStatus ?? true;
    const shouldCheckArtifacts = includeManagedArtifacts ?? true;
    const selectedReferenceDocPath = normalizeRelativePath(referenceDocPath ?? DEFAULT_REFERENCE_DOC_PATH);
    const selectedExamplesDocPath = normalizeRelativePath(examplesDocPath ?? DEFAULT_EXAMPLES_DOC_PATH);
    const selectedPolicyPath = normalizeRelativePath(policyPath ?? DEFAULT_AGENT_POLICY_PATH);
    const selectedContractSnapshotPath = normalizeRelativePath(contractSnapshotPath ?? DEFAULT_CONTRACT_SNAPSHOT_PATH);
    const selectedSkillMetricsPath = normalizeRelativePath(skillMetricsPath ?? DEFAULT_SKILL_METRICS_PATH);
    const selectedPackMetricsPath = normalizeRelativePath(packMetricsPath ?? DEFAULT_PACK_METRICS_PATH);

    const duplicates = findDuplicates(toolNames);

    const docs = shouldCheckDocs
      ? await evaluateDocsAlignment({
        root,
        toolNames,
        referenceDocPath: selectedReferenceDocPath,
        examplesDocPath: selectedExamplesDocPath
      })
      : {
        executed: false,
        referenceDocPath: selectedReferenceDocPath,
        examplesDocPath: selectedExamplesDocPath,
        referenceDocExists: false,
        examplesDocExists: false,
        referenceInSync: true,
        examplesInSync: true,
        missingFromReference: [],
        missingFromExamples: [],
        extraInReference: [],
        extraInExamples: [],
        error: null
      };

    const policy = shouldCheckPolicy
      ? await evaluatePolicyStatus({
        root,
        policyPath: selectedPolicyPath
      })
      : {
        executed: false,
        path: selectedPolicyPath,
        exists: false,
        loaded: false,
        enabled: false,
        error: null
      };

    const contracts = shouldCheckContracts
      ? await evaluateContractStatus({
        root,
        snapshotPath: selectedContractSnapshotPath,
        runtimeSnapshot: context.contractSnapshot ?? null,
        runtimeHash: context.contractHash ?? null
      })
      : {
        executed: false,
        snapshotPath: selectedContractSnapshotPath,
        exists: false,
        inSync: true,
        currentHash: null,
        snapshotHash: null,
        error: null
      };

    const policyTransition = shouldCheckPolicyTransition
      ? await evaluatePolicyTransition({
        root,
        policyPath: selectedPolicyPath,
        skillMetricsPath: selectedSkillMetricsPath,
        packMetricsPath: selectedPackMetricsPath
      })
      : {
        executed: false,
        policyPath: selectedPolicyPath,
        currentPreset: "unknown",
        recommendation: "review-manual",
        readyForMature: false,
        confidence: 0,
        thresholds: DEFAULT_TRANSITION_THRESHOLDS,
        signals: {
          skillExecutions: 0,
          skillSuccessRate: 0,
          qualifiedSkills: 0,
          packExecutions: 0,
          packSuccessRate: 0,
          packEvidencePresent: false
        },
        reasons: [],
        nextAction: null,
        error: null
      };

    const managedArtifacts = shouldCheckArtifacts
      ? await evaluateManagedArtifacts(root)
      : {
        executed: false,
        intakeExists: false,
        baselineExists: false,
        contextIndexExists: false,
        policyExists: false,
        blueprintExists: false,
        agentsGuideExists: false
      };

    return outputSchema.parse({
      generatedAt: new Date().toISOString(),
      server: {
        name: serverInfo.name,
        version: serverInfo.version,
        autoEnsureProject: process.env.MCP_AUTO_ENSURE_PROJECT !== "false",
        autoEnsureProjectApply: process.env.MCP_AUTO_ENSURE_PROJECT_APPLY !== "false",
        autoPrepareContext: process.env.MCP_AUTO_PREPARE_CONTEXT !== "false",
        autoPrepareContextApply: process.env.MCP_AUTO_PREPARE_CONTEXT_APPLY !== "false"
      },
      workspace: {
        rootDir: root
      },
      tools: {
        registered: toolNames.length,
        unique: new Set(toolNames).size,
        duplicates,
        namesIncluded,
        names: namesIncluded ? [...toolNames] : []
      },
      docs,
      policy,
      contracts,
      policyTransition,
      managedArtifacts
    });
  }
};

async function evaluateDocsAlignment(options) {
  const { root, toolNames, referenceDocPath, examplesDocPath } = options;
  try {
    const referenceDocExists = await fileExists(referenceDocPath, root);
    const examplesDocExists = await fileExists(examplesDocPath, root);
    if (!referenceDocExists || !examplesDocExists) {
      return {
        executed: true,
        referenceDocPath,
        examplesDocPath,
        referenceDocExists,
        examplesDocExists,
        referenceInSync: false,
        examplesInSync: false,
        missingFromReference: [],
        missingFromExamples: [],
        extraInReference: [],
        extraInExamples: [],
        error: "Reference docs are missing."
      };
    }

    const [referenceText, examplesText] = await Promise.all([
      readTextFile(referenceDocPath, root),
      readTextFile(examplesDocPath, root)
    ]);
    const referenceNames = Array.from(referenceText.matchAll(/^### `([^`]+)`$/gm)).map((item) => item[1]);
    const examplesNames = Array.from(examplesText.matchAll(/^## \d+\) `([^`]+)`$/gm)).map((item) => item[1]);
    const missingFromReference = difference(toolNames, referenceNames);
    const missingFromExamples = difference(toolNames, examplesNames);
    const extraInReference = difference(referenceNames, toolNames);
    const extraInExamples = difference(examplesNames, toolNames);

    return {
      executed: true,
      referenceDocPath,
      examplesDocPath,
      referenceDocExists: true,
      examplesDocExists: true,
      referenceInSync: missingFromReference.length === 0 && extraInReference.length === 0,
      examplesInSync: missingFromExamples.length === 0 && extraInExamples.length === 0,
      missingFromReference,
      missingFromExamples,
      extraInReference,
      extraInExamples,
      error: null
    };
  } catch (error) {
    return {
      executed: true,
      referenceDocPath,
      examplesDocPath,
      referenceDocExists: false,
      examplesDocExists: false,
      referenceInSync: false,
      examplesInSync: false,
      missingFromReference: [],
      missingFromExamples: [],
      extraInReference: [],
      extraInExamples: [],
      error: error.message
    };
  }
}

async function evaluatePolicyStatus(options) {
  const { root, policyPath } = options;
  try {
    const resolution = await loadAgentPolicy({
      root,
      policyPath
    });
    return {
      executed: true,
      path: resolution.path,
      exists: resolution.exists,
      loaded: resolution.loaded,
      enabled: resolution.enabled,
      error: null
    };
  } catch (error) {
    return {
      executed: true,
      path: policyPath,
      exists: await fileExists(policyPath, root),
      loaded: false,
      enabled: false,
      error: error.message
    };
  }
}

async function evaluateContractStatus(options) {
  const { root, snapshotPath, runtimeSnapshot, runtimeHash } = options;
  try {
    const exists = await fileExists(snapshotPath, root);
    if (!exists) {
      return {
        executed: true,
        snapshotPath,
        exists: false,
        inSync: false,
        currentHash: runtimeHash,
        snapshotHash: null,
        error: "Contract snapshot file is missing."
      };
    }

    const savedSnapshot = await readJsonFile(snapshotPath, root);
    const snapshotHash = calculateToolContractHash(savedSnapshot);
    const currentHash = runtimeHash ?? (runtimeSnapshot ? calculateToolContractHash(runtimeSnapshot) : null);
    return {
      executed: true,
      snapshotPath,
      exists: true,
      inSync: Boolean(currentHash && snapshotHash === currentHash),
      currentHash,
      snapshotHash,
      error: null
    };
  } catch (error) {
    return {
      executed: true,
      snapshotPath,
      exists: false,
      inSync: false,
      currentHash: runtimeHash,
      snapshotHash: null,
      error: error.message
    };
  }
}

async function evaluateManagedArtifacts(root) {
  return {
    executed: true,
    intakeExists: await fileExists(DEFAULT_INTAKE_PATH, root),
    baselineExists: await fileExists(DEFAULT_BASELINE_PATH, root),
    contextIndexExists: await fileExists(DEFAULT_CONTEXT_INDEX_PATH, root),
    policyExists: await fileExists(DEFAULT_AGENT_POLICY_PATH, root),
    blueprintExists: await fileExists(DEFAULT_BLUEPRINT_PATH, root),
    agentsGuideExists: await fileExists(DEFAULT_AGENTS_GUIDE_PATH, root)
  };
}

async function evaluatePolicyTransition(options) {
  const { root, policyPath, skillMetricsPath, packMetricsPath } = options;
  const thresholds = { ...DEFAULT_TRANSITION_THRESHOLDS };
  try {
    const resolution = await loadAgentPolicy({
      root,
      policyPath
    });
    const currentPreset = detectPolicyPreset(resolution.policy);
    const skillMetrics = await readSkillMetricsSummary({
      root,
      metricsPath: skillMetricsPath,
      thresholds
    });
    const packMetrics = await readPackMetricsSummary({
      root,
      metricsPath: packMetricsPath
    });
    const evaluation = computeMaturityEvaluation({
      currentPreset,
      skillMetrics,
      packMetrics,
      thresholds
    });

    return {
      executed: true,
      policyPath: resolution.path,
      currentPreset,
      recommendation: evaluation.recommendation,
      readyForMature: evaluation.readyForMature,
      confidence: evaluation.confidence,
      thresholds,
      signals: {
        skillExecutions: skillMetrics.executions,
        skillSuccessRate: skillMetrics.successRate,
        qualifiedSkills: skillMetrics.qualifiedSkills,
        packExecutions: packMetrics.executions,
        packSuccessRate: packMetrics.successRate,
        packEvidencePresent: packMetrics.evidencePresent
      },
      reasons: evaluation.reasons,
      nextAction: evaluation.nextAction,
      error: null
    };
  } catch (error) {
    return {
      executed: true,
      policyPath,
      currentPreset: "unknown",
      recommendation: "review-manual",
      readyForMature: false,
      confidence: 0,
      thresholds,
      signals: {
        skillExecutions: 0,
        skillSuccessRate: 0,
        qualifiedSkills: 0,
        packExecutions: 0,
        packSuccessRate: 0,
        packEvidencePresent: false
      },
      reasons: ["Unable to evaluate policy transition due to policy/metrics read error."],
      nextAction: "Validate policy and metrics files, then rerun mcp_health_report.",
      error: error.message
    };
  }
}

async function readSkillMetricsSummary(options) {
  const { root, metricsPath, thresholds } = options;
  const exists = await fileExists(metricsPath, root);
  if (!exists) {
    return {
      executions: 0,
      successRate: 0,
      qualifiedSkills: 0
    };
  }

  const payload = await readJsonFile(metricsPath, root).catch(() => null);
  if (!payload || typeof payload !== "object") {
    return {
      executions: 0,
      successRate: 0,
      qualifiedSkills: 0
    };
  }

  const totals = payload.totals ?? {};
  const executions = toInt(totals.executions);
  const success = toInt(totals.success);
  const partial = toInt(totals.partial);
  const successRate = executions > 0
    ? round((success + (partial * 0.5)) / executions)
    : 0;

  const skillEntries = payload.skills && typeof payload.skills === "object"
    ? Object.values(payload.skills)
    : [];
  let qualifiedSkills = 0;
  for (const entry of skillEntries) {
    const skillExecutions = toInt(entry?.executions);
    const skillSuccess = toInt(entry?.outcomes?.success);
    const skillPartial = toInt(entry?.outcomes?.partial);
    const skillSuccessRate = skillExecutions > 0
      ? (skillSuccess + (skillPartial * 0.5)) / skillExecutions
      : 0;
    if (
      skillExecutions >= thresholds.minSkillExecutionsPerQualifiedSkill
      && skillSuccessRate >= thresholds.minQualifiedSkillSuccessRate
    ) {
      qualifiedSkills += 1;
    }
  }

  return {
    executions,
    successRate,
    qualifiedSkills
  };
}

async function readPackMetricsSummary(options) {
  const { root, metricsPath } = options;
  const exists = await fileExists(metricsPath, root);
  if (!exists) {
    return {
      evidencePresent: false,
      executions: 0,
      successRate: 0
    };
  }

  const payload = await readJsonFile(metricsPath, root).catch(() => null);
  if (!payload || typeof payload !== "object") {
    return {
      evidencePresent: false,
      executions: 0,
      successRate: 0
    };
  }

  const totals = payload.totals ?? {};
  const executions = toInt(totals.executions);
  const success = toInt(totals.success);
  const partial = toInt(totals.partial);
  const successRate = executions > 0
    ? round((success + (partial * 0.5)) / executions)
    : 0;

  return {
    evidencePresent: executions > 0,
    executions,
    successRate
  };
}

function computeMaturityEvaluation(input) {
  const { currentPreset, skillMetrics, packMetrics, thresholds } = input;
  const reasons = [];
  const skillExecutionsReady = skillMetrics.executions >= thresholds.minSkillExecutions;
  const skillSuccessReady = skillMetrics.successRate >= thresholds.minSkillSuccessRate;
  const qualifiedSkillsReady = skillMetrics.qualifiedSkills >= thresholds.minQualifiedSkills;
  const packReady = !packMetrics.evidencePresent || (
    packMetrics.executions >= thresholds.minPackExecutions
    && packMetrics.successRate >= thresholds.minPackSuccessRate
  );

  if (!skillExecutionsReady) {
    reasons.push(`Need >= ${thresholds.minSkillExecutions} skill executions (current: ${skillMetrics.executions}).`);
  }
  if (!skillSuccessReady) {
    reasons.push(`Need skill success rate >= ${thresholds.minSkillSuccessRate} (current: ${skillMetrics.successRate}).`);
  }
  if (!qualifiedSkillsReady) {
    reasons.push(`Need >= ${thresholds.minQualifiedSkills} qualified skills (current: ${skillMetrics.qualifiedSkills}).`);
  }
  if (packMetrics.evidencePresent && !packReady) {
    reasons.push(`Pack evidence below threshold (${packMetrics.executions} exec, successRate=${packMetrics.successRate}).`);
  }

  const readyForMature = skillExecutionsReady && skillSuccessReady && qualifiedSkillsReady && packReady;
  if (readyForMature) {
    reasons.push("Evidence is stable: transition to mature preset is safe.");
  }

  const confidence = computeTransitionConfidence({
    skillMetrics,
    packMetrics,
    thresholds
  });
  const recommendation = recommendTransition({
    currentPreset,
    readyForMature
  });
  const nextAction = buildTransitionAction({
    recommendation,
    currentPreset
  });

  return {
    readyForMature,
    recommendation,
    confidence,
    reasons,
    nextAction
  };
}

function computeTransitionConfidence(options) {
  const { skillMetrics, packMetrics, thresholds } = options;
  const scoreSkillExec = clamp(skillMetrics.executions / thresholds.minSkillExecutions, 0, 1);
  const scoreSkillRate = clamp(skillMetrics.successRate / thresholds.minSkillSuccessRate, 0, 1);
  const scoreQualified = clamp(skillMetrics.qualifiedSkills / thresholds.minQualifiedSkills, 0, 1);
  const scorePack = !packMetrics.evidencePresent
    ? 0.6
    : (
      clamp(packMetrics.executions / thresholds.minPackExecutions, 0, 1) * 0.5
      + clamp(packMetrics.successRate / thresholds.minPackSuccessRate, 0, 1) * 0.5
    );
  return round(
    (scoreSkillExec * 0.3)
    + (scoreSkillRate * 0.3)
    + (scoreQualified * 0.2)
    + (scorePack * 0.2)
  );
}

function recommendTransition(options) {
  const { currentPreset, readyForMature } = options;
  if (currentPreset === "starter") {
    return readyForMature ? "promote-to-mature" : "keep-starter";
  }
  if (currentPreset === "mature") {
    return "keep-mature";
  }
  return "review-manual";
}

function buildTransitionAction(options) {
  const { recommendation, currentPreset } = options;
  if (recommendation === "promote-to-mature") {
    return "Run scaffold_project_agents with policyPreset=\"mature\" and allowOverwrite=true.";
  }
  if (recommendation === "keep-starter") {
    return "Keep starter preset and continue recording skill/pack feedback.";
  }
  if (recommendation === "keep-mature") {
    return currentPreset === "mature"
      ? "Keep mature preset and monitor strict-mode filter results."
      : "Monitor metrics and maintain current preset.";
  }
  return "Review agent-policy.json manually and align it to starter/mature preset.";
}

function detectPolicyPreset(policy) {
  if (!policy || typeof policy !== "object") {
    return "unknown";
  }
  const recommendation = policy.recommendation ?? {};
  const qualityGate = policy.qualityGate ?? {};
  if (
    recommendation.skillSignalMode === "prefer"
    && recommendation.autoPromoteSkillSignalMode === false
    && qualityGate.defaultProfile === "dev"
  ) {
    return "starter";
  }
  if (
    recommendation.skillSignalMode === "prefer"
    && recommendation.autoPromoteSkillSignalMode === true
    && qualityGate.defaultProfile === "prod"
  ) {
    return "mature";
  }
  return "custom";
}

function findDuplicates(values) {
  const duplicates = [];
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value) && !duplicates.includes(value)) {
      duplicates.push(value);
      continue;
    }
    seen.add(value);
  }
  return duplicates;
}

function difference(a, b) {
  const setB = new Set(b);
  return a.filter((item) => !setB.has(item));
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function toInt(value) {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
