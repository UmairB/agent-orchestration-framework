import os from "node:os";
import path from "node:path";

export const RUNTIMES = {
  claude: {
    id: "claude",
    name: "Claude Code",
    localRoot: ".claude",
    globalRoot: path.join(os.homedir(), ".claude"),
    commandPrefix: "/"
  },
  codex: {
    id: "codex",
    name: "Codex",
    localRoot: ".codex",
    globalRoot: path.join(os.homedir(), ".codex"),
    commandPrefix: "$"
  }
};

export const RESOURCE_KINDS = {
  skill: {
    id: "skill",
    plural: "skills",
    defaultBodyFile: "SKILL.md"
  },
  command: {
    id: "command",
    plural: "commands",
    defaultBodyFile: "COMMAND.md"
  },
  agent: {
    id: "agent",
    plural: "agents",
    defaultBodyFile: "AGENT.md"
  },
  rule: {
    id: "rule",
    plural: "rules",
    defaultBodyFile: "RULE.md"
  }
};

export const CAPABILITY_STATUS = {
  native: "native",
  mapped: "mapped",
  unsupportedWarning: "unsupported-warning",
  unsupportedFail: "unsupported-fail",
  future: "future"
};

export const CAPABILITIES = {
  skill: {
    claude: CAPABILITY_STATUS.native,
    codex: CAPABILITY_STATUS.native
  },
  command: {
    claude: CAPABILITY_STATUS.native,
    codex: CAPABILITY_STATUS.native
  },
  agent: {
    claude: CAPABILITY_STATUS.native,
    codex: CAPABILITY_STATUS.native
  },
  rule: {
    claude: CAPABILITY_STATUS.native,
    codex: CAPABILITY_STATUS.mapped
  },
  pathScopedRule: {
    claude: CAPABILITY_STATUS.native,
    codex: CAPABILITY_STATUS.mapped
  },
  codexExecutionPolicyRule: {
    claude: CAPABILITY_STATUS.unsupportedFail,
    codex: CAPABILITY_STATUS.future
  }
};

export const MCP_TRANSPORTS = {
  stdio: "stdio",
  http: "http",
  sse: "sse"
};

export const HOOK_EVENTS = {
  PreToolUse: "PreToolUse",
  PostToolUse: "PostToolUse",
  Notification: "Notification",
  Stop: "Stop",
  SubagentStop: "SubagentStop",
  UserPromptSubmit: "UserPromptSubmit",
  SessionStart: "SessionStart",
  SessionEnd: "SessionEnd",
  PreCompact: "PreCompact"
};

export const HOOK_TYPES = {
  command: "command"
};

export const PROJECT_DOC_TARGETS = {
  agents: "AGENTS.md",
  claude: "CLAUDE.md"
};

export const TRUST_MODES = {
  readOnly: "read-only",
  workspace: "workspace",
  full: "full"
};

export const IDENTITY_FIELDS = new Set(["id", "kind"]);

export function supportedRuntimes() {
  return Object.keys(RUNTIMES);
}

export function supportedResourceKinds() {
  return Object.keys(RESOURCE_KINDS);
}

export function supportedMcpTransports() {
  return Object.values(MCP_TRANSPORTS);
}

export function supportedHookEvents() {
  return Object.values(HOOK_EVENTS);
}

export function supportedHookTypes() {
  return Object.values(HOOK_TYPES);
}

export function supportedProjectDocTargets() {
  return Object.values(PROJECT_DOC_TARGETS);
}

export function supportedTrustModes() {
  return Object.values(TRUST_MODES);
}

export function defaultBodyFile(kind) {
  const definition = RESOURCE_KINDS[kind];
  if (!definition) {
    throw new Error(`Invalid resource kind "${kind}". Expected ${supportedResourceKinds().join(", ")}.`);
  }
  return definition.defaultBodyFile;
}

export function mergeRuntimeOverride(resource, runtime) {
  const override = resource.overrides?.[runtime];
  if (!override) return resource;

  for (const field of IDENTITY_FIELDS) {
    if (Object.hasOwn(override, field) && override[field] !== resource[field]) {
      throw new Error(`Runtime override for "${resource.id}" cannot change identity field "${field}".`);
    }
  }

  const merged = {
    ...resource,
    ...override,
    id: resource.id,
    kind: resource.kind,
    runtimes: resource.runtimes,
    overrides: resource.overrides
  };

  if (Object.hasOwn(override, "body") || Object.hasOwn(override, "prompt") || Object.hasOwn(override, "instructions")) {
    merged.body = override.body ?? override.prompt ?? override.instructions ?? "";
  }

  return merged;
}
