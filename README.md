# AOF

AOF is a small CLI and DSL for defining assistant-facing project assets once, then rendering them into runtime-specific folders such as `.claude` and `.codex`.

The initial target is local CLI usage:

- initialize a project with a portable `.aof/aof.config.json`
- store project assets under `.aof/` and reusable global assets under `~/.aof`
- delegate framework-level installs such as GSD to the framework's own installer

## Usage

```sh
npm link
aof init
aof assets add skill code-review
aof assets add
aof project migrate
aof assets apply --dry-run
aof project validate
aof project doctor
aof assets clean --dry-run
aof project show
aof assets add --global skill shared-review --codex
aof assets add --global
aof assets list --global
aof packages add gsd --codex
aof packages install gsd --dry-run
aof assets ui
```

When a command needs interactive input, AOF uses keyboard-driven terminal
prompts. Use arrow keys to move, space to toggle checkbox choices, and Enter to
confirm. Automation should pass explicit flags such as `--codex` instead of
depending on interactive prompts.

Dry-run the generated files:

```sh
aof assets apply --dry-run
```

`aof assets apply --dry-run` prints the same action plan that a real apply
would use without writing runtime files, deleting stale files, or updating
`.aof/aof.lock.json`. Each action includes the runtime, source asset, and
reason so automation can distinguish creates, updates, deletes, skips, and
drift warnings.

Scaffold a file-backed `.aof/` asset:

```sh
aof assets add skill code-review --codex
```

`aof assets add [kind id]` writes source files under `.aof/assets/` and
updates `.aof/aof.config.json`. Run `aof assets add` without `kind id` to
choose the asset type, id, runtimes, description, and initial body
interactively. It refuses config or file collisions unless `--force` is
supplied.

Create reusable global source assets:

```sh
aof assets add --global skill shared-review --codex
aof assets add --global
aof assets list --global
aof assets show --global skill shared-review
aof assets validate --global
```

`aof assets ... --global` manages source assets in the user-global AOF
workspace at `~/.aof`. The global workspace mirrors project layout with
`~/.aof/aof.config.json` and `~/.aof/assets/<kind>/<id>/...`. Global source
asset commands currently create and inspect skills, agents, and rules.

Reference global assets from a project without copying their source files into
project `.aof`:

```json
{
  "name": "project",
  "resources": [],
  "globalRefs": [
    { "kind": "skill", "id": "shared-review" }
  ]
}
```

Then render normally:

```sh
aof assets apply --codex
```

Referenced global skills, agents, and rules render alongside project-local
resources. Runtime overrides declared on the global asset are honored, and lock
entries record global source scope. Associated helper/code files for global
skill directories can be listed explicitly with `files`:

```json
{
  "kind": "skill",
  "id": "research-helper",
  "path": "assets/skills/research-helper/SKILL.md",
  "files": [
    "scripts/search.py",
    "templates/query.md"
  ],
  "runtimes": ["codex"]
}
```

Associated file paths are relative to the asset directory containing `SKILL.md`
and cannot escape that directory. For a referenced global skill, the example
above renders to `.codex/skills/research-helper/scripts/search.py` and
`.codex/skills/research-helper/templates/query.md` alongside the generated
`SKILL.md`. AOF supports associated files for skills; other resource kinds
remain single-file outputs.

Render generated outputs and managed package intent:

```sh
aof assets apply --codex --dry-run
aof assets apply --codex
```

`aof assets apply` applies generated runtime outputs and writes lock state.
Package installers are not run from the assets namespace; package execution
belongs under `aof packages ...`.

Remove lock-owned generated outputs:

```sh
aof assets clean --dry-run
aof assets clean
```

`aof assets clean` deletes only generated files recorded in
`.aof/aof.lock.json` whose current content still matches the recorded hash.
Drifted files are preserved and remain in the lock.

Install only Codex assets:

```sh
aof assets apply --codex
```

Declare GSD package intent without running installer code:

```sh
aof packages add gsd --codex
aof packages list
aof packages show gsd
aof packages validate
```

`aof packages add gsd` writes package intent to `.aof/aof.config.json`. It does
not run `npm`, `npx`, or installer code. Runtime flags such as `--codex`,
`--claude`, and `--runtime codex,claude` record the runtimes the package should
target.

Preview the GSD installer commands without running networked installs:

```sh
aof packages install gsd --dry-run
```

Run the configured GSD installer:

```sh
aof packages install gsd
```

Non-dry-run package installs print a network/package-code boundary before each
runtime command. The boundary includes the exact command, package source,
runtime, scope, and a warning that npm package code may run. Each runtime
attempt is recorded in `.aof/aof.lock.json`, including successes, failures, and
skips. Successful matching attempts are skipped on later runs unless `--force`
is supplied.

Replay managed install intent from lock state:

```sh
aof packages install --from-lock --dry-run
aof packages install --from-lock
```

Removed top-level `aof install ...` commands fail with guidance instead of
executing.

Inspect `.aof/` configuration for automation:

```sh
aof project show
aof project show --json
aof project validate
aof project validate --json
aof project doctor
aof project doctor --json
```

`project` means the current repository's AOF workspace and health.
`aof project validate` checks JSON shape, resource kinds, runtimes, file-backed
asset paths, runtime override identity, package ids, package sources, and
package runtime support. `aof project doctor` adds project health checks such as
stale root config detection, generated-output drift summary, missing assets,
managed package intent, and suggested next commands.

Start the local setup UI:

```sh
aof assets ui
```

The setup UI is a source configuration editor with explicit Project and Global
scopes. Project scope edits the current repository `.aof`; Global scope edits
the reusable source library in `~/.aof`. Project assets are editable in Project
scope. Referenced global assets are shown separately as read-only project
references, with a remove-reference action.

Global scope can create and edit skills, agents, and rules. Global assets can
be added to the current project with “Use in this project”, which writes a
`globalRefs` entry and does not copy source files into project `.aof`. Global
skill helper files can also be edited as explicit text associated files; paths
are relative to the skill asset directory and follow the same safety rules as
the `files` manifest.

Project scope also edits file-backed skills, commands, agents, and rules;
runtime targets; runtime-specific overrides; and compact JSON editors for MCP
servers, hooks, project docs, and runtime settings. It shows runtime capability
differences and adapter warnings before apply, including mapped behavior such
as Codex rule guidance rendering through `AGENTS.md`.

The UI writes source-of-truth files under `.aof/` only. It does not run
`aof init`, `aof assets apply`, dry-run, package installers, or shell commands.
Use the Review tab for validation, capability summaries, package intent, and
the next CLI commands to run in a terminal.

The setup UI binds to `127.0.0.1` and is intended for local repository editing.
Its API still treats request bodies and static paths as untrusted input:
malformed JSON, invalid asset routes, oversized bodies, and static path
traversal attempts are rejected with structured JSON
errors.

## DSL

The project keeps reproducibility metadata locally:

```txt
.aof/aof.config.json  # project asset metadata and global references
.aof/aof.lock.json    # generated output manifest and install intent
.aof/assets/          # source asset bodies and runtime overrides
```

Root `aof.config.json` is treated as legacy input. When both root `aof.config.json` and `.aof/aof.config.json` exist, `.aof/aof.config.json` is authoritative. Run an explicit migration when adopting the workspace model:

```sh
aof project migrate
```

Migration leaves the root `aof.config.json` untouched and writes the new workspace files under `.aof/`.
Editor saves also write `.aof/aof.config.json`; they do not silently mutate a
legacy root config. `aof project doctor` reports a warning when both files exist
so stale root config is visible.

Project and global resources currently support four portable resource kinds:

- `skill`: rendered to `<runtime>/skills/<id>/SKILL.md`
- `command`: rendered to `<runtime>/commands/<id>.md`
- `agent`: rendered to `<runtime>/agents/<id>.md`
- `rule`: natural-language assistant guidance

Generated source assets use kind-specific body files:

```txt
.aof/assets/skills/<id>/SKILL.md
.aof/assets/commands/<id>/COMMAND.md
.aof/assets/agents/<id>/AGENT.md
.aof/assets/rules/<id>/RULE.md
```

Resources can target all runtimes or a subset:

```json
{
  "kind": "command",
  "id": "repo-prime",
  "runtimes": ["claude", "codex"],
  "description": "Prime the assistant with repository context.",
  "prompt": "Inspect the repository before making changes."
}
```

Inline content can be moved into separate files by replacing `body`, `prompt`, or `instructions` with `path`. New `.aof/` workspaces prefer file-backed assets:

```json
{
  "kind": "skill",
  "id": "code-review",
  "runtimes": ["claude", "codex"],
  "description": "Review code changes.",
  "path": "assets/skills/code-review/SKILL.md"
}
```

Runtime-specific overrides live beside the asset:

```txt
.aof/assets/skills/code-review/overrides/claude.json
.aof/assets/skills/code-review/overrides/codex.json
```

Overrides shallow-merge with shared metadata and can change runtime-specific fields such as `description`, `body`, `model`, `tools`, or `paths`. They cannot change identity fields such as `id` or `kind`.

Rules render differently per runtime:

- Claude Code: `.claude/rules/<id>.md`, including `paths` frontmatter when provided.
- Codex: `AGENTS.md` or nested `AGENTS.md` for natural-language guidance.
- Codex `.codex/rules/*.rules` files are execution-policy rules, not natural-language guidance. AOF treats them as a separate future asset type.

Expanded project primitives live beside `resources[]` in `.aof/aof.config.json`.
They are rendered by `aof assets apply` like other generated outputs:

```json
{
  "name": "demo",
  "resources": [],
  "mcpServers": [
    {
      "id": "docs",
      "transport": "http",
      "url": "https://example.test/mcp",
      "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" },
      "runtimes": ["claude", "codex"]
    },
    {
      "id": "local-tools",
      "transport": "stdio",
      "command": "node",
      "args": ["tools/mcp-server.mjs"],
      "env": { "NODE_ENV": "development" },
      "runtimes": ["codex"]
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
      "id": "root-guidance",
      "path": "assets/docs/root.md",
      "targets": ["AGENTS.md", "CLAUDE.md"],
      "runtimes": ["claude", "codex"]
    }
  ],
  "settings": {
    "claude": {
      "permissions": { "allow": ["Bash(npm test)"] }
    },
    "codex": {
      "model": "gpt-5.4",
      "approval_policy": "on-request"
    }
  }
}
```

`mcpServers[]` renders to root `.mcp.json` for Claude Code and
`.codex/config.toml` for Codex. `hooks[]` supports the common command-hook
shape and renders to `.claude/settings.json` and `.codex/config.toml` when the
target runtime can represent the shared fields. Runtime-specific `claude` and
`codex` objects are passed only to the matching runtime; non-matching runtime
objects are intentionally ignored without warnings.

`projectDocs[]` renders root `AGENTS.md` for Codex and root `CLAUDE.md` for
Claude Code. File-backed docs can include other `.aof/` files relative to the
source doc:

```md
Shared project guidance.

{{include partials/testing.md}}
```

Includes are rejected when they are missing, recursive, absolute, or escape the
`.aof/` workspace. Multiple docs targeting the same root file are ordered by id.

Generated assistant folders such as `.claude/` and `.codex/` are output, not source of truth for this project. AOF writes small generated markers into Markdown output where the format allows it, but `.aof/aof.lock.json` is authoritative for ownership. The lock manifest records generated file paths, target runtimes, source asset ids and kinds, content hashes, managed framework intent, and framework install attempts.

When `aof assets apply` sees that a file it previously generated has been manually edited, it reports a `drift-warning` and skips overwriting that file. This includes root `AGENTS.md`, root `CLAUDE.md`, root `.mcp.json`, `.claude/settings.json`, and `.codex/config.toml` when they are generated from expanded primitives. Re-run with `aof assets apply --force` to explicitly overwrite drifted generated files. When an asset is removed or retargeted, AOF prunes stale generated files only if the lock says AOF owns them and their content still matches the prior generated hash; stale files with manual edits are left in place with a warning.

Framework packages declared in `.aof/aof.config.json` are recorded as managed intent in the lock during `aof assets apply`. `aof assets apply` does not run framework installers; use `aof packages install gsd` for installer execution.

## Adapter Warnings

AOF reports adapter warnings when a valid `.aof/` configuration asks for
behavior that a selected runtime cannot represent cleanly. Warnings are
computed at command time and are not written to `.aof/aof.lock.json`.

Commands that surface adapter warnings:

```sh
aof project validate
aof project validate --json
aof project doctor
aof project doctor --json
aof assets validate
aof assets validate --json
aof assets apply --dry-run
aof assets apply --dry-run --json
```

Human output uses a compact block before apply actions:

```txt
adapter-warnings:
- [adapter.skipped-runtime-output] hooks[0] runtime=codex source=hook:notify output=.codex/config.toml
  reason: Common hook field(s) "timeout" cannot be represented directly by the codex adapter.
  remediation: Move runtime-specific hook fields under "codex" or remove "codex" from this hook's runtimes.
create: .codex/skills/context/SKILL.md runtime=codex source=skill:context reason=file does not exist
```

JSON output exposes a top-level `adapterWarnings` array:

```json
{
  "adapterWarnings": [
    {
      "code": "adapter.skipped-runtime-output",
      "severity": "warning",
      "path": "hooks[0]",
      "kind": "hook",
      "id": "notify",
      "runtime": "codex",
      "generatedPath": ".codex/config.toml",
      "reason": "Common hook field(s) \"timeout\" cannot be represented directly by the codex adapter.",
      "remediation": "Move runtime-specific hook fields under \"codex\" or remove \"codex\" from this hook's runtimes."
    }
  ]
}
```

Use `--strict` to turn adapter warnings into failures for CI:

```sh
aof project validate --strict
aof project doctor --strict
aof assets validate --strict
aof assets apply --strict
```

For `aof assets apply --strict`, AOF stops before generated files, stale
deletes, or lock updates run. `--force` only affects generated-output drift; it
does not bypass adapter warning failures under `--strict`.

## Tests

Unit tests exercise the core modules:

```sh
node ./scripts/test-unit.mjs
```

Integration tests are BDD-style feature tests that launch the CLI as an external process in isolated temp projects:

```sh
node ./test/integration/cli.mjs
```

Run the PowerShell integration parity suite separately on Windows:

```powershell
npm run test:integration:ps
```

The PowerShell command consumes the same split feature files and exits successfully with a skip message outside Windows. It is intentionally not part of `npm test`.

The feature files live in `test/integration/features/`. They are intentionally black-box so they can be reused if the CLI implementation later moves from Node to Rust.

All new user-facing functionality should include BDD coverage in the relevant domain feature file under `test/integration/features/`. Unit tests can supplement those scenarios, but do not replace them.

Run everything through the main test entrypoint:

```sh
node ./scripts/test.mjs
```

Run the focused real process-boundary smoke test:

```sh
npm run test:smoke:cli
```

Build the setup UI through the cross-platform wrapper:

```sh
npm run ui:build
```

The wrapper runs TypeScript and Vite through Node entry points from the UI
workspace, avoiding platform-specific npm shell shims. For troubleshooting, the
direct equivalent commands are:

```powershell
cd ui
node ..\node_modules\typescript\bin\tsc -b
node ..\node_modules\vite\bin\vite.js build
```

Run the full closeout check:

```sh
npm run check
```
