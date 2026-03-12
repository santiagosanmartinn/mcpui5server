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

const inputSchema = z.object({
  includeToolNames: z.boolean().optional(),
  includeDocChecks: z.boolean().optional(),
  includePolicyStatus: z.boolean().optional(),
  includeContractStatus: z.boolean().optional(),
  includeManagedArtifacts: z.boolean().optional(),
  referenceDocPath: z.string().min(1).optional(),
  examplesDocPath: z.string().min(1).optional(),
  policyPath: z.string().min(1).optional(),
  contractSnapshotPath: z.string().min(1).optional()
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
      includeContractStatus,
      includeManagedArtifacts,
      referenceDocPath,
      examplesDocPath,
      policyPath,
      contractSnapshotPath
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
    const shouldCheckContracts = includeContractStatus ?? true;
    const shouldCheckArtifacts = includeManagedArtifacts ?? true;
    const selectedReferenceDocPath = normalizeRelativePath(referenceDocPath ?? DEFAULT_REFERENCE_DOC_PATH);
    const selectedExamplesDocPath = normalizeRelativePath(examplesDocPath ?? DEFAULT_EXAMPLES_DOC_PATH);
    const selectedPolicyPath = normalizeRelativePath(policyPath ?? DEFAULT_AGENT_POLICY_PATH);
    const selectedContractSnapshotPath = normalizeRelativePath(contractSnapshotPath ?? DEFAULT_CONTRACT_SNAPSHOT_PATH);

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

