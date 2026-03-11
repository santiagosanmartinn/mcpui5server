export const MCP_LAYOUT_VERSION = "2026.03.11";
export const MCP_STATE_SCHEMA_VERSION = "1.0.0";
export const DEFAULT_MCP_STATE_PATH = ".codex/mcp/project/mcp-project-state.json";

export const MANAGED_ARTIFACTS = [
  {
    id: "blueprint",
    path: ".codex/mcp/agents/agent.blueprint.json",
    required: true,
    role: "blueprint"
  },
  {
    id: "agentsGuide",
    path: ".codex/mcp/agents/AGENTS.generated.md",
    required: true,
    role: "agents-guide"
  },
  {
    id: "bootstrapPrompt",
    path: ".codex/mcp/agents/prompts/task-bootstrap.txt",
    required: true,
    role: "bootstrap-prompt"
  },
  {
    id: "agentPolicy",
    path: ".codex/mcp/policies/agent-policy.json",
    required: true,
    role: "agent-policy"
  },
  {
    id: "projectContextDoc",
    path: "docs/mcp/project-context.md",
    required: true,
    role: "context-doc"
  },
  {
    id: "agentFlowsDoc",
    path: "docs/mcp/agent-flows.md",
    required: true,
    role: "flows-doc"
  },
  {
    id: "projectState",
    path: DEFAULT_MCP_STATE_PATH,
    required: true,
    role: "mcp-state"
  }
];

export const LEGACY_ARTIFACTS = [
  {
    path: "agent.blueprint.json",
    targetPath: ".codex/mcp/agents/agent.blueprint.json"
  },
  {
    path: "AGENTS.generated.md",
    targetPath: ".codex/mcp/agents/AGENTS.generated.md"
  },
  {
    path: "prompts/task-bootstrap.txt",
    targetPath: ".codex/mcp/agents/prompts/task-bootstrap.txt"
  },
  {
    path: "docs/project-context.md",
    targetPath: "docs/mcp/project-context.md"
  },
  {
    path: "docs/agent-flows.md",
    targetPath: "docs/mcp/agent-flows.md"
  },
  {
    path: ".codex/agents/agent.blueprint.json",
    targetPath: ".codex/mcp/agents/agent.blueprint.json"
  },
  {
    path: ".codex/agents/AGENTS.generated.md",
    targetPath: ".codex/mcp/agents/AGENTS.generated.md"
  },
  {
    path: ".codex/agents/prompts/task-bootstrap.txt",
    targetPath: ".codex/mcp/agents/prompts/task-bootstrap.txt"
  },
  {
    path: ".mcp/agents/agent.blueprint.json",
    targetPath: ".codex/mcp/agents/agent.blueprint.json"
  },
  {
    path: ".mcp/agents/AGENTS.generated.md",
    targetPath: ".codex/mcp/agents/AGENTS.generated.md"
  },
  {
    path: ".mcp/agents/prompts/task-bootstrap.txt",
    targetPath: ".codex/mcp/agents/prompts/task-bootstrap.txt"
  }
];
