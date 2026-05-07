# Phase 3: CLI And GSD Framework Flow - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06T22:48:30+01:00
**Phase:** 3-CLI And GSD Framework Flow
**Areas discussed:** Command Shape, GSD Install Semantics, Interactive Flow, Failure And Reproducibility

---

## Command Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated config inspection commands | Add commands like `aof config show`, `aof config validate`, and possibly `aof config doctor`. | yes |
| Extend existing commands only | Keep top-level surface small by adding flags to existing commands. | |
| Minimal for now | Only add what Phase 3 strictly needs for GSD install flow. | |

**User's choice:** Dedicated config inspection commands
**Notes:** Inspection/config command surface is part of Phase 3 automation support.

| Option | Description | Selected |
|--------|-------------|----------|
| JSON flags for inspection commands | Human text by default, `--json` for inspection and preview commands where practical. | yes |
| Human output only | Scripts parse exit codes and text. | |
| JSON by default | Automation-first output with optional text mode. | |

**User's choice:** JSON flags for inspection commands
**Notes:** Human output remains default.

| Option | Description | Selected |
|--------|-------------|----------|
| Schema plus semantic checks | Validate JSON shape, kinds/runtimes, file-backed paths, overrides, package ids, and runtime support. | yes |
| Schema only | Keep validation narrow and leave deeper checks to doctor. | |
| Same as apply planning | Include generated output conflict and drift analysis. | |

**User's choice:** Schema plus semantic checks
**Notes:** `validate` should catch config problems before apply/install.

| Option | Description | Selected |
|--------|-------------|----------|
| Actionable project health checks | Include config validity, stale legacy config, drift summary, missing files, package intent, and next commands. | yes |
| Skip doctor in Phase 3 | Leave health diagnostics for Phase 5. | |
| Alias validate | Make doctor a friendly alias. | |

**User's choice:** Actionable project health checks
**Notes:** `doctor` should be useful beyond schema validation.

---

## GSD Install Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Use declared config when present | Read `.aof` package intent, selected runtimes, and scope; CLI flags override for one run. | yes |
| Ignore config by default | Keep `aof install gsd` flag-driven unless `--from-config` is passed. | |
| Require config declaration | Fail unless GSD is declared in `.aof/aof.config.json`. | |

**User's choice:** Use declared config when present
**Notes:** CLI flags remain one-run overrides.

| Option | Description | Selected |
|--------|-------------|----------|
| Use dry-run everywhere | `aof install gsd --dry-run` prints exact commands and says no network/install will run. | yes |
| Separate preview command | Add a preview subcommand. | |
| Both dry-run and preview alias | Support both. | |

**User's choice:** Use dry-run everywhere
**Notes:** Dry-run is the preview convention.

| Option | Description | Selected |
|--------|-------------|----------|
| One command per runtime | Separate Claude/Codex commands for clearer failures and previews. | yes |
| Combined command when possible | Prefer one installer invocation with both runtime flags. | |
| Configurable strategy | Default separate, allow combine later. | |

**User's choice:** One command per runtime
**Notes:** Preserves current `src/frameworks.mjs` direction.

| Option | Description | Selected |
|--------|-------------|----------|
| Attempt manifest with command results | Record each command, runtime, scope, exit status, timestamp, and package source/range. | yes |
| Intent only | Keep Phase 2 behavior only. | |
| Only successful installs | Omit failed attempts. | |

**User's choice:** Attempt manifest with command results
**Notes:** Real installs need audit records beyond intent.

---

## Interactive Flow

| Option | Description | Selected |
|--------|-------------|----------|
| `aof install --interactive` | One guided CLI flow for assets, runtimes, and optional GSD setup. | yes |
| Plain `aof install` remains interactive | Evolve current behavior as guided entry point. | |
| New command like `aof setup` | Separate guided setup from install/server behavior. | |

**User's choice:** `aof install --interactive`
**Notes:** Make guided flow explicit.

| Option | Description | Selected |
|--------|-------------|----------|
| Preview then confirm | Show config/render/framework plan, then ask before writing or running. | yes |
| Write config and render assets, confirm before GSD only | Gate only networked install. | |
| Just write config | User runs apply/install separately. | |

**User's choice:** Preview then confirm
**Notes:** Guided flow should not surprise-write `.aof/` or runtime output.

| Option | Description | Selected |
|--------|-------------|----------|
| Simple selection with defaults | Reuse current prompt style; choose catalog items/runtimes and GSD choice. | yes |
| Profile-oriented setup | Role/use-case presets. | |
| Full editor-like flow | Create/edit custom assets interactively. | |

**User's choice:** Simple selection with defaults
**Notes:** v1 avoids a full profile builder or CLI editor.

| Option | Description | Selected |
|--------|-------------|----------|
| Update path with confirmation | Inspect existing config, show proposed changes, and ask before modifying. | yes |
| Refuse and point to config commands | New projects only. | |
| Overwrite only with force | Require `--force` to replace existing config. | |

**User's choice:** Update path with confirmation
**Notes:** Existing `.aof` projects should have a safe guided update path.

---

## Failure And Reproducibility

| Option | Description | Selected |
|--------|-------------|----------|
| Fail overall but record attempts | Nonzero exit, record success/failure per runtime, and print retry command. | yes |
| Succeed partially | Exit zero if at least one runtime installed. | |
| Rollback successes | Attempt to undo successes if later runtime fails. | |

**User's choice:** Fail overall but record attempts
**Notes:** Partial success is visible but overall command fails.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, explicit lock replay | Add command/flag like `aof install --from-lock` with dry-run preview. | yes |
| No replay command in Phase 3 | Lock audit only. | |
| Automatic replay by default | Prefer lock over config. | |

**User's choice:** Yes, explicit lock replay
**Notes:** Replay must be explicit.

| Option | Description | Selected |
|--------|-------------|----------|
| Clear boundary message every time | Print command, package source, runtime, scope, and network/code warning before running. | yes |
| Only in dry-run | Real installs stay concise. | |
| Verbose flag only | Boundary detail only with `--verbose`. | |

**User's choice:** Clear boundary message every time
**Notes:** Networked npm execution should always be explicit.

| Option | Description | Selected |
|--------|-------------|----------|
| Ask or require force for re-run | Skip successful prior installs by default; use `--force` to rerun. | yes |
| Always rerun | Installer should be idempotent. | |
| Never rerun | Refuse unless lock state is deleted. | |

**User's choice:** Ask or require force for re-run
**Notes:** For automation, planning should prefer skip-by-default with `--force` for rerun.

---

## the agent's Discretion

None.

## Deferred Ideas

- Profile-oriented setup.
- Full interactive CLI asset editor.
- UI execution of init/apply/install.
- Runtime support beyond Claude Code and Codex.
