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
aof migrate
aof config show
aof config validate
aof config doctor
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
aof config show
aof config show --json
aof config validate
aof config validate --json
aof config doctor
aof config doctor --json
```

`config validate` checks JSON shape, resource kinds, runtimes, file-backed
asset paths, runtime override identity, package ids, package sources, and
package runtime support. `config doctor` adds project health checks such as
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
It shows runtime capability differences before apply, including mapped behavior
such as Codex rule guidance rendering through `AGENTS.md`.

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

Generated assistant folders such as `.claude/` and `.codex/` are output, not source of truth for this project. AOF writes small generated markers into Markdown output where the format allows it, but `.aof/aof.lock.json` is authoritative for ownership. The lock manifest records generated file paths, target runtimes, source asset ids and kinds, content hashes, managed framework intent, and framework install attempts.

When `aof apply` sees that a file it previously generated has been manually edited, it reports a `drift-warning` and skips overwriting that file. Re-run with `aof apply --force` to explicitly overwrite drifted generated files. When an asset is removed or retargeted, AOF prunes stale generated files only if the lock says AOF owns them and their content still matches the prior generated hash; stale files with manual edits are left in place with a warning.

Framework packages declared in `.aof/aof.config.json` are recorded as managed intent in the lock during `aof apply`. `aof apply` does not run framework installers; use commands such as `aof install gsd` for installer execution.

## Tests

Unit tests exercise the core modules:

```sh
node ./scripts/test-unit.mjs
```

Integration tests are BDD-style feature tests that launch the CLI as an external process in isolated temp projects:

```sh
node ./test/integration/cli.mjs
```

On Windows environments that block Node child-process spawning, run the PowerShell runner against the same feature files:

```powershell
powershell -ExecutionPolicy Bypass -File .\test\integration\cli.ps1
```

Both runners execute the same Gherkin-style scenarios.

The feature files live in `test/integration/`. They are intentionally black-box so they can be reused if the CLI implementation later moves from Node to Rust.

All new user-facing functionality should include BDD coverage in `test/integration/cli.feature`. Unit tests can supplement those scenarios, but do not replace them.

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
