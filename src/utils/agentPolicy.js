import { z } from "zod";
import { ToolError } from "./errors.js";
import { fileExists, readJsonFile } from "./fileSystem.js";

export const DEFAULT_AGENT_POLICY_PATH = ".codex/mcp/policies/agent-policy.json";
export const AGENT_PACK_LIFECYCLE_STATUSES = ["experimental", "candidate", "recommended", "deprecated"];

const rankingPolicySchema = z.object({
  enabled: z.boolean().optional(),
  minExecutions: z.number().int().min(0).max(1000).optional(),
  maxResults: z.number().int().min(1).max(200).optional(),
  includeUnscored: z.boolean().optional(),
  includeDeprecated: z.boolean().optional(),
  allowedLifecycle: z.array(z.enum(AGENT_PACK_LIFECYCLE_STATUSES)).min(1).optional(),
  blockedPackSlugs: z.array(z.string().min(1)).optional()
}).passthrough();

const recommendationPolicySchema = z.object({
  enabled: z.boolean().optional(),
  includePackCatalog: z.boolean().optional(),
  includePackFeedbackRanking: z.boolean().optional(),
  maxRecommendations: z.number().int().min(2).max(20).optional(),
  blockedRecommendationIds: z.array(z.string().min(1)).optional(),
  blockedPackSlugs: z.array(z.string().min(1)).optional(),
  allowedLifecycle: z.array(z.enum(AGENT_PACK_LIFECYCLE_STATUSES)).min(1).optional()
}).passthrough();

const qualityGatePolicySchema = z.object({
  enabled: z.boolean().optional(),
  failOnUnknownSymbols: z.boolean().optional(),
  failOnMediumSecurity: z.boolean().optional(),
  maxHighPerformanceFindings: z.number().int().min(0).max(500).optional(),
  refreshDocs: z.boolean().optional(),
  applyDocs: z.boolean().optional(),
  failOnDocDrift: z.boolean().optional(),
  requireUi5Version: z.boolean().optional()
}).passthrough();

const agentPolicySchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  enabled: z.boolean().optional(),
  ranking: rankingPolicySchema.optional(),
  recommendation: recommendationPolicySchema.optional(),
  qualityGate: qualityGatePolicySchema.optional()
}).passthrough();

export async function loadAgentPolicy(options) {
  const { root, policyPath, enforceManagedLayout = true } = options;
  const selectedPath = normalizeRelativePath(policyPath ?? DEFAULT_AGENT_POLICY_PATH);
  if (enforceManagedLayout) {
    enforceManagedSubtree(selectedPath, ".codex/mcp", "policyPath");
  }

  const exists = await fileExists(selectedPath, root);
  if (!exists) {
    return {
      path: selectedPath,
      exists: false,
      loaded: false,
      enabled: false,
      policy: null
    };
  }

  let rawJson;
  try {
    rawJson = await readJsonFile(selectedPath, root);
  } catch (error) {
    throw new ToolError(`Unable to read agent policy at ${selectedPath}: ${error.message}`, {
      code: "INVALID_AGENT_POLICY",
      details: {
        path: selectedPath
      }
    });
  }

  const parsed = agentPolicySchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new ToolError(`Invalid agent policy schema at ${selectedPath}: ${parsed.error.issues[0]?.message ?? "unknown issue"}`, {
      code: "INVALID_AGENT_POLICY",
      details: {
        path: selectedPath,
        issue: parsed.error.issues[0] ?? null
      }
    });
  }

  const data = parsed.data;
  return {
    path: selectedPath,
    exists: true,
    loaded: true,
    enabled: data.enabled ?? true,
    policy: data
  };
}

export function normalizePackSlugSet(values) {
  if (!Array.isArray(values)) {
    return new Set();
  }
  return new Set(
    values
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function enforceManagedSubtree(pathValue, rootPrefix, label) {
  if (!pathValue.startsWith(`${rootPrefix}/`) && pathValue !== rootPrefix) {
    throw new ToolError(`${label} must stay inside ${rootPrefix}.`, {
      code: "INVALID_ARTIFACT_LAYOUT",
      details: {
        label,
        path: pathValue,
        expectedPrefix: rootPrefix
      }
    });
  }
}
