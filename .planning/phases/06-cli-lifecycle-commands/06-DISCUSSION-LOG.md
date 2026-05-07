# Phase 6: CLI Lifecycle Commands - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 6-CLI Lifecycle Commands
**Areas discussed:** Command Shape, Sync Semantics, Scaffold Model, Clean Safety, Diagnostics Split

---

## Command Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Top-level commands | `aof add`, `aof sync`, `aof validate`, `aof doctor`, `aof clean` | ✓ |
| Mixed shape | Keep `aof config validate|doctor`, add only `aof add`, `aof sync`, `aof clean` | |
| Alias both | Support top-level commands and keep old `aof config validate|doctor` as aliases | |

**User's choice:** Top-level commands.
**Notes:** The user wants the clean lifecycle surface as the Phase 6 primary contract.

| Option | Description | Selected |
|--------|-------------|----------|
| Keep `apply` as the write command | `sync` composes it; no rename churn | ✓ |
| Add `compile` as alias | `apply` remains supported, `compile` becomes clearer for DSL-to-runtime rendering | |
| Replace with `compile` | Move users toward architecture-doc language, with migration cost | |

**User's choice:** Keep `apply`.
**Notes:** No `compile` rename or alias is required in this phase.

| Option | Description | Selected |
|--------|-------------|----------|
| Top-level only | Implement `aof validate` and `aof doctor`; old config paths are not the primary surface | ✓ |
| Alias old paths | Top-level commands are primary, but `aof config validate|doctor` keep working | |
| Keep both documented | Both forms are equally supported and shown in help | |

**User's choice:** Top-level only.
**Notes:** Planning may decide whether to leave old paths temporarily, but they should not be documented as equal surfaces.

| Option | Description | Selected |
|--------|-------------|----------|
| Lifecycle-first help | Group lifecycle commands before secondary/supporting commands | ✓ |
| Current flat help | Keep one usage block with all commands listed together | |
| Detailed subcommand help | Add `aof help <command>` pages for each lifecycle command | |

**User's choice:** Lifecycle-first help.
**Notes:** The lifecycle should be obvious without building a full help system.

---

## Sync Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Apply only | Re-render generated runtime outputs from `.aof/` | |
| Packages plus apply | Reconcile package intent from config/lock, then apply generated runtime outputs | ✓ |
| Plan only unless confirmed | Show package/apply plan, then require confirmation before writes or installs | |

**User's choice:** Packages plus apply.
**Notes:** `sync` should be the full "make repo match `.aof/` intent" command.

| Option | Description | Selected |
|--------|-------------|----------|
| No network by default | Reconcile package intent and apply local generated files, but print install commands unless `--install` is passed | ✓ |
| Prompt before network | Ask before package installers in TTY; automation requires `--yes` | |
| Run installers by default | Fully install packages and apply files unless `--dry-run` is passed | |

**User's choice:** No network by default.
**Notes:** This preserves the existing network-boundary policy.

| Option | Description | Selected |
|--------|-------------|----------|
| Full plan, no writes | Show package reconciliation, generated output actions, lock preview, and exact install commands; write nothing | ✓ |
| Apply dry-run only | Reuse current `apply --dry-run` behavior and skip package planning | |
| JSON-first dry-run | Make dry-run primarily machine-readable and require `--human` for text | |

**User's choice:** Full plan, no writes.
**Notes:** Human-readable output remains default.

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve drift and continue | Warn, skip drifted files, update safe files, keep preserved drift auditable | ✓ |
| Fail sync | Treat drift as blocking unless `--force` is passed | |
| Prompt in TTY | Ask whether to overwrite drifted files in interactive terminals | |

**User's choice:** Preserve drift and continue.
**Notes:** This matches current `apply` behavior.

---

## Scaffold Model

| Option | Description | Selected |
|--------|-------------|----------|
| File-backed asset plus config entry | Create `.aof/assets/...` source file and update `.aof/aof.config.json` | ✓ |
| Config entry only | Add an inline JSON resource to `.aof/aof.config.json` | |
| File only, no config edit | Create the asset file and tell the user how to wire it | |

**User's choice:** File-backed asset plus config entry.
**Notes:** Newly scaffolded prompt/body content should live in files, not inline JSON.

| Option | Description | Selected |
|--------|-------------|----------|
| Flag-first | `aof add <kind> <id> [--runtime claude,codex] [--description ...]`; missing required values fail | ✓ |
| Interactive fallback | Accept flags/positionals, prompt for missing required values in TTY | |
| Interactive-first | `aof add` opens a guided flow by default | |

**User's choice:** Flag-first.
**Notes:** Scriptability is preferred; guided creation can wait.

| Option | Description | Selected |
|--------|-------------|----------|
| Fail unless `--force` | If config entry or asset file exists, fail with exact conflicting path/id | ✓ |
| Merge config, refuse file overwrite | Add missing config/runtime data but never overwrite asset files | |
| Prompt in TTY | Ask whether to overwrite or merge interactively | |

**User's choice:** Fail unless `--force`.
**Notes:** Predictable, safe, and easy to test.

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal built-ins only | Generate valid skeletons for existing v1 kinds: skill, command, agent, rule | ✓ |
| Catalog-backed templates | Reuse catalog item bodies and future template entries where possible | |
| Template flag with built-ins | Support minimal built-ins plus `--template <name>` for known built-in templates | |

**User's choice:** Minimal built-ins only.
**Notes:** Richer template systems are deferred.

---

## Clean Safety

| Option | Description | Selected |
|--------|-------------|----------|
| Lock-owned outputs only | Delete only generated files listed in `.aof/aof.lock.json` | ✓ |
| All known runtime output dirs | Delete `.claude/`, `.codex/`, and related generated paths for selected runtimes | |
| Nothing without `--force` | Default to preview only; require `--force` for deletion | |

**User's choice:** Lock-owned outputs only.
**Notes:** Preserves the generated-output ownership contract.

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve drifted files | Warn and skip files whose current hash differs from lock hash | ✓ |
| Delete drifted files too | Lock ownership is enough to delete | |
| Require `--force` for drifted deletes | Delete matching files by default, drifted only with `--force` | |

**User's choice:** Preserve drifted files.
**Notes:** Same safety posture as `apply`.

| Option | Description | Selected |
|--------|-------------|----------|
| Remove deleted file entries | Keep package/framework intent and install attempts, remove cleaned generated file entries | ✓ |
| Leave lock untouched | Clean only affects files; next apply/sync rewrites lock | |
| Delete the whole lock | Remove lock state when all generated outputs are cleaned | |

**User's choice:** Remove deleted file entries.
**Notes:** Lock state should reflect remaining generated ownership without losing package intent.

| Option | Description | Selected |
|--------|-------------|----------|
| Full preview | Print delete/skip/drift-warning actions and lock changes; write nothing | ✓ |
| No dry-run | Rely on conservative defaults | |
| Dry-run by default | Require `--yes` or `--force` to delete | |

**User's choice:** Full preview.
**Notes:** Keeps lifecycle commands consistent and automation-friendly.

---

## Diagnostics Split

| Option | Description | Selected |
|--------|-------------|----------|
| Config and DSL source only | Validate `.aof/aof.config.json`, referenced asset files, schema/semantic rules, supported kinds/runtimes | ✓ |
| Everything doctor checks too | Include generated output drift, lock/package state, and assistant availability | |
| Schema only | Keep validate narrow and leave semantic checks to doctor | |

**User's choice:** Config and DSL source only.
**Notes:** Validate answers "is source valid?"

| Option | Description | Selected |
|--------|-------------|----------|
| Project health beyond validation | Include validation result, stale legacy config, generated-output drift, package/install intent, lock/package drift, writable outputs, and suggested next commands | ✓ |
| Only generated outputs | Keep doctor focused on drift and lock state | |
| Only environment checks | Check assistant binaries, filesystem permissions, and package manager availability | |

**User's choice:** Project health beyond validation.
**Notes:** Doctor answers "is the project healthy?"

| Option | Description | Selected |
|--------|-------------|----------|
| Errors fail, warnings pass | Errors exit non-zero; warnings exit 0 unless strict mode is passed | ✓ |
| Warnings fail too | Any warning exits non-zero | |
| Always exit 0 with JSON status | Let automation inspect output | |

**User's choice:** Errors fail, warnings pass.
**Notes:** `--strict` can promote warnings to failures.

| Option | Description | Selected |
|--------|-------------|----------|
| Human + JSON | Human-readable default, `--json` for automation | ✓ |
| JSON only | Keep diagnostics machine-oriented | |
| Human only | Defer structured output | |

**User's choice:** Human + JSON.
**Notes:** Carries forward the Phase 3 automation contract.

## the agent's Discretion

None. The user selected concrete options for all gray areas.

## Deferred Ideas

- `compile` command or alias for `apply`.
- Catalog-backed or named templates for `aof add`.
- Interactive-first scaffold flow.
- New DSL primitive kinds, package dependency semantics, runtime expansion, and Rust migration.
