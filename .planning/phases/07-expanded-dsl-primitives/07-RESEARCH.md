---
phase: 7
status: complete
researched: 2026-05-07
source: inline
---

# Phase 7 Research: Expanded DSL Primitives

## Goal

Plan how to add MCP servers, hooks, project docs, and settings to AOF's `.aof/` source model while preserving existing skills, commands, agents, rules, lock behavior, and CLI/UI workflows.

## Key Findings

### Current AOF shape

- The durable source of truth is `.aof/aof.config.json` plus file-backed assets under `.aof/assets/`.
- Existing portable assets live in `resources[]` with `kind`, `id`, `path/body`, `runtimes`, and runtime `overrides`.
- Rendering currently starts in `src/adapters.mjs`, then `src/render-plan.mjs` groups generated outputs, protects drifted files, and writes lock entries.
- Validation is split between `src/dsl.mjs`, `src/config-inspect.mjs`, `schemas/aof.schema.json`, and schema/model alignment tests.
- The setup UI already edits file-backed resources and exposes capability diagnostics, but it does not execute CLI actions.

### Runtime docs checked

- Claude Code project MCP servers are stored in a root `.mcp.json` with `mcpServers`, and project-scoped servers are intended to be checked into version control after user approval. Claude supports environment variable expansion in `.mcp.json` for command, args, env, url, and headers. Source: https://code.claude.com/docs/en/mcp
- Claude Code settings live in `.claude/settings.json` for shared project settings, while project MCP servers are separately stored in `.mcp.json`. Claude Code treats `CLAUDE.md` as project memory/instructions and supports `@path` imports with recursive depth limits. Sources: https://code.claude.com/docs/en/settings and https://code.claude.com/docs/en/memory
- Claude Code hooks live in settings, are keyed by event, and support command, HTTP, MCP tool, prompt, and agent hook handlers. Common command hooks are the safest cross-runtime starting point. Source: https://code.claude.com/docs/en/hooks
- Codex user config lives in `~/.codex/config.toml`, and project-scoped overrides can live in `.codex/config.toml` for trusted projects. Codex config includes `mcp_servers`, lifecycle `hooks`, `project_doc_*` discovery settings, and project trust behavior. Source: https://developers.openai.com/codex/config-reference
- Codex reads `AGENTS.md` before work, layering global guidance and project guidance from root to current working directory. It supports fallback filenames through `project_doc_fallback_filenames` and a `project_doc_max_bytes` limit. Source: https://developers.openai.com/codex/guides/agents-md

## Planning Assumptions

No Phase 7 `CONTEXT.md` exists. The user explicitly invoked `$gsd-plan-phase 7` after the discussion prompt, so planning proceeds without discussion context. These assumptions should be treated as adjustable before execution:

1. New DSL primitives should use dedicated top-level config sections, not `resources[]`, because MCP servers, hooks, project docs, and settings are structurally different from markdown assistant assets.
2. Phase 7 should implement common-core rendering where both runtimes clearly support the feature. Rich unsupported/lossy warning policy is deferred to Phase 8, but Phase 7 must not silently corrupt data.
3. Project docs should be generated deterministically from `.aof/` source into root `AGENTS.md` and `CLAUDE.md`, with explicit include expansion and lock ownership.
4. UI work should be narrow: support valid editing/review of the new sections, not a full bespoke builder for every runtime-specific field.

## Proposed Source Model

Extend `.aof/aof.config.json` with top-level sections:

```json
{
  "mcpServers": [
    {
      "id": "docs",
      "transport": "http",
      "url": "https://developers.openai.com/mcp",
      "headers": {},
      "runtimes": ["claude", "codex"],
      "codex": {
        "supports_parallel_tool_calls": true,
        "default_tools_approval_mode": "prompt"
      }
    }
  ],
  "hooks": [
    {
      "id": "test-after-write",
      "event": "PostToolUse",
      "matcher": "Write",
      "type": "command",
      "command": "npm test",
      "runtimes": ["claude", "codex"]
    }
  ],
  "projectDocs": [
    {
      "id": "root",
      "path": "assets/docs/root.md",
      "targets": ["AGENTS.md", "CLAUDE.md"],
      "runtimes": ["codex", "claude"]
    }
  ],
  "settings": {
    "model": "gpt-5.4",
    "trust": "workspace",
    "claude": {},
    "codex": {}
  }
}
```

Keep `resources[]` unchanged for v1 compatibility.

## Implementation Risks

- TOML writing is new. Add a small deterministic serializer for the subset AOF emits rather than adding a dependency.
- Generated root files such as `AGENTS.md`, `CLAUDE.md`, and `.mcp.json` can collide with user-authored files. Existing lock/drift behavior should protect them like other generated outputs.
- Settings and hooks can affect tool execution. Validation should require explicit command strings and preserve sensitive values as environment-variable references rather than encouraging literal secrets.
- Codex and Claude hook schemas overlap but are not identical. Phase 7 should support command hooks in the common core and carry runtime-specific escape hatches through only where targeted.

## Recommended Plan Split

1. Normalize and validate new top-level DSL sections.
2. Render runtime outputs and lock them safely.
3. Add BDD/UI/docs coverage for the expanded DSL editing and lifecycle experience.
