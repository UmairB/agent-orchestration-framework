# AOF

AOF is a small CLI and DSL for defining assistant-facing project assets once, then rendering them into runtime-specific folders such as `.claude` and `.codex`.

The initial target is local CLI usage:

- initialize a project with a portable `.aof/aof.config.json`
- store shared skills, commands, and agents in the catalog, then render selected items into Claude Code and Codex layouts during install
- delegate framework-level installs such as GSD to the framework's own installer

## Usage

```sh
npm link
aof init
aof add skill project-context
aof migrate
aof sync --dry-run
aof validate
aof doctor
aof clean --dry-run
aof config show
aof config validate
aof config doctor
aof global add skill shared-review --codex
aof global list
aof catalog init
aof install --select
```

Dry-run the generated files:

```sh
aof apply --dry-run
```

`aof apply --dry-run` prints the same action plan that a real apply would use
without writing runtime files, deleting stale files, or updating
`.aof/aof.lock.json`. Each action includes the runtime, source asset, and reason
so automation can distinguish creates, updates, deletes, skips, and drift
warnings.

Scaffold a file-backed `.aof/` asset:

```sh
aof add skill project-context --codex
```

`aof add <kind> <id>` writes source files under `.aof/assets/` and updates
`.aof/aof.config.json`. It refuses config or file collisions unless `--force`
is supplied.

Create reusable global source assets:

```sh
aof global add skill shared-review --codex
aof global list
aof global show skill shared-review
aof global validate
```

`aof global ...` manages source assets in the user-global AOF workspace at
`~/.aof`. The global workspace mirrors project layout with
`~/.aof/aof.config.json` and `~/.aof/assets/<kind>/<id>/...`. Global commands
currently create and inspect skills, agents, and rules. This is separate from
the existing `--global` flag on runtime commands such as `aof apply --global`
or `aof install gsd --global`, which targets assistant runtime home folders.

Synchronize generated outputs and managed package intent:

```sh
aof sync --codex --dry-run
aof sync --codex
aof sync --codex --install
```

`aof sync` applies generated runtime outputs and writes lock state while keeping
networked package installers disabled by default. It still prints the installer
commands so automation can decide whether to run `aof sync --install`.

Remove lock-owned generated outputs:

```sh
aof clean --dry-run
aof clean
```

`aof clean` deletes only generated files recorded in `.aof/aof.lock.json` whose
current content still matches the recorded hash. Drifted files are preserved and
remain in the lock.

Initialize and inspect the global catalog database:

```sh
aof catalog init
aof catalog path
aof catalog list
```

By default the database is created in the user's app data directory:

```txt
Windows: %APPDATA%\aof\aof.sqlite
macOS:   ~/Library/Application Support/aof/aof.sqlite
Linux:   ~/.local/share/aof/aof.sqlite
```

Override it when needed:

```sh
aof catalog list --db ./tmp/aof.sqlite
```

Install only Codex assets:

```sh
aof apply --codex
```

Install selected catalog items into the current project:

```sh
aof install --select
aof install --items project-context,prime --codex
aof install --dry-run
```

Ask GSD's installer to install its current Codex and Claude integrations:

```sh
aof install gsd
```

Preview the GSD installer commands without running networked installs:

```sh
aof install gsd --dry-run
```

When `.aof/aof.config.json` declares a managed `gsd` package, `aof install
gsd` uses that package source and runtime list by default. Runtime and scope
flags such as `--claude`, `--codex`, and `--global` override that intent for
one run. Dry-run output prints the exact `npx get-shit-done-cc@...` commands
and does not write lock state or run npm.

Real GSD installs print a network boundary before each runtime command. The
boundary includes the command, package source, runtime, scope, and a warning
that npm package code may run. Each runtime attempt is recorded in
`.aof/aof.lock.json`, including successes and failures. Successful matching
attempts are skipped on later runs unless `--force` is supplied.

Replay managed framework intent from lock state:

```sh
aof install --from-lock --dry-run
aof install --from-lock
```

Inspect `.aof/` configuration for automation:

```sh
aof validate
aof validate --json
aof doctor
aof doctor --json
aof config show
aof config show --json
aof config validate
aof config validate --json
aof config doctor
aof config doctor --json
```

`aof validate` checks JSON shape, resource kinds, runtimes, file-backed
asset paths, runtime override identity, package ids, package sources, and
package runtime support. `aof doctor` adds project health checks such as
stale root config detection, generated-output drift summary, missing assets,
managed package intent, and suggested next commands.

Use the guided terminal install flow:

```sh
aof install --interactive
```

The guided flow asks for catalog items and runtimes, shows proposed config,
render, and framework plans, then asks separately before writing `.aof/`,
writing runtime files, or running GSD installer commands.

Start the local setup UI:

```sh
aof install
```

The setup UI is a `.aof/` configuration editor. It edits file-backed skills,
commands, agents, and rules; runtime targets; and runtime-specific overrides.
It also exposes compact JSON editors for MCP servers, hooks, project docs, and
runtime settings. It shows runtime capability differences and adapter warnings
before apply, including mapped behavior such as Codex rule guidance rendering
through `AGENTS.md`.

The UI writes source-of-truth files under `.aof/` only. It does not run
`aof init`, `aof apply`, dry-run, `aof install`, or shell commands. Use the
Review tab for validation, capability summaries, package intent, and the next
CLI commands to run in a terminal.

The setup UI binds to `127.0.0.1` and is intended for local repository editing.
Its API still treats request bodies and static paths as untrusted input:
malformed JSON, invalid asset routes, oversized bodies, unsupported catalog
items, and static path traversal attempts are rejected with structured JSON
errors.

## DSL

The project keeps reproducibility metadata locally:

```txt
.aof/aof.config.json  # desired project defaults and asset metadata
.aof/aof.lock.json    # generated output manifest and install intent
.aof/assets/          # source asset bodies and runtime overrides
```

Root `aof.config.json` is treated as legacy input. When both root `aof.config.json` and `.aof/aof.config.json` exist, `.aof/aof.config.json` is authoritative. Run an explicit migration when adopting the workspace model:

```sh
aof migrate
```

Migration leaves the root `aof.config.json` untouched and writes the new workspace files under `.aof/`.
Editor saves also write `.aof/aof.config.json`; they do not silently mutate a
legacy root config. `aof config doctor` reports a warning when both files exist
so stale root config is visible.

Catalog items currently support four portable resource kinds:

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
  "id": "prime",
  "runtimes": ["claude", "codex"],
  "description": "Prime the assistant with repository context.",
  "prompt": "Inspect the repository before making changes."
}
```

Inline content can be moved into separate files by replacing `body`, `prompt`, or `instructions` with `path`. New `.aof/` workspaces prefer file-backed assets:

```json
{
  "kind": "skill",
  "id": "project-context",
  "runtimes": ["claude", "codex"],
  "description": "Shared project context.",
  "path": "assets/skills/project-context/SKILL.md"
}
```

Runtime-specific overrides live beside the asset:

```txt
.aof/assets/skills/project-context/overrides/claude.json
.aof/assets/skills/project-context/overrides/codex.json
```

Overrides shallow-merge with shared metadata and can change runtime-specific fields such as `description`, `body`, `model`, `tools`, or `paths`. They cannot change identity fields such as `id` or `kind`.

Rules render differently per runtime:

- Claude Code: `.claude/rules/<id>.md`, including `paths` frontmatter when provided.
- Codex: `AGENTS.md` or nested `AGENTS.md` for natural-language guidance.
- Codex `.codex/rules/*.rules` files are execution-policy rules, not natural-language guidance. AOF treats them as a separate future asset type.

Expanded project primitives live beside `resources[]` in `.aof/aof.config.json`.
They are rendered by `aof apply` and `aof sync` like other generated outputs:

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

When `aof apply` sees that a file it previously generated has been manually edited, it reports a `drift-warning` and skips overwriting that file. This includes root `AGENTS.md`, root `CLAUDE.md`, root `.mcp.json`, `.claude/settings.json`, and `.codex/config.toml` when they are generated from expanded primitives. Re-run with `aof apply --force` to explicitly overwrite drifted generated files. When an asset is removed or retargeted, AOF prunes stale generated files only if the lock says AOF owns them and their content still matches the prior generated hash; stale files with manual edits are left in place with a warning.

Framework packages declared in `.aof/aof.config.json` are recorded as managed intent in the lock during `aof apply`. `aof apply` does not run framework installers; use commands such as `aof install gsd` for installer execution.

## Adapter Warnings

AOF reports adapter warnings when a valid `.aof/` configuration asks for
behavior that a selected runtime cannot represent cleanly. Warnings are
computed at command time and are not written to `.aof/aof.lock.json`.

Commands that surface adapter warnings:

```sh
aof validate
aof validate --json
aof doctor
aof doctor --json
aof apply --dry-run
aof apply --dry-run --json
aof sync --dry-run
aof sync --dry-run --json
```

Human output uses a compact block before apply/sync actions:

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
aof validate --strict
aof doctor --strict
aof apply --strict
aof sync --strict
```

For `apply --strict` and `sync --strict`, AOF stops before generated files,
stale deletes, lock updates, or package installers run. `--force` only affects
generated-output drift; it does not bypass adapter warning failures under
`--strict`.

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
