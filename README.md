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
aof catalog init
aof install --select
```

Dry-run the generated files:

```sh
aof apply --dry-run
```

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

## DSL

The project keeps reproducibility metadata locally:

```txt
.aof/aof.config.json  # desired project defaults and asset metadata
.aof/aof.lock.json    # generated install/migration record
.aof/assets/          # source asset bodies and runtime overrides
```

Root `aof.config.json` is treated as legacy input. When both root `aof.config.json` and `.aof/aof.config.json` exist, `.aof/aof.config.json` is authoritative. Run an explicit migration when adopting the workspace model:

```sh
aof migrate
```

Migration leaves the root `aof.config.json` untouched and writes the new workspace files under `.aof/`.

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

Generated assistant folders such as `.claude/` and `.codex/` are install output, not source of truth for this project. They are ignored by git here; the catalog database and project config define what should be installed.

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
