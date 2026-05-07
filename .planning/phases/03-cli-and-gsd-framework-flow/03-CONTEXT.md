# Phase 3: CLI And GSD Framework Flow - Context

**Gathered:** 2026-05-06T22:48:30+01:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 provides complete CLI paths for initializing, applying, inspecting, and installing `.aof/` projects, including managed GSD setup for Claude Code and Codex. It owns automation-friendly config inspection commands, guided CLI install flow, real GSD install/preview behavior, framework install attempt recording, and lock replay. It does not add UI execution, runtime support beyond Claude/Codex, task management, or Codex `.codex/rules/*.rules` execution-policy assets.

</domain>

<decisions>
## Implementation Decisions

### Command Shape
- **D-01:** Phase 3 should add dedicated automation-friendly config inspection commands.
- **D-02:** Include `aof config show`, `aof config validate`, and `aof config doctor` unless planning discovers a narrowly better naming split.
- **D-03:** Inspection commands should use human-readable output by default.
- **D-04:** Inspection commands should support `--json` where practical, including `config show`, `config validate`, catalog/config inspection, and GSD preview output where useful.
- **D-05:** `aof config validate` should perform schema plus semantic checks.
- **D-06:** Validation should cover JSON shape, supported resource kinds and runtimes, file-backed paths, runtime override identity, package ids, and runtime support.
- **D-07:** `aof config doctor` should go beyond validation into actionable project health checks.
- **D-08:** Doctor checks should include config validity, stale legacy root config, generated-output drift summary, missing asset files, package install intent, and suggested next commands.

### GSD Install Semantics
- **D-09:** When `.aof/aof.config.json` declares GSD as a managed package, `aof install gsd` should use that package intent by default.
- **D-10:** CLI flags can override declared package intent for a single run.
- **D-11:** `aof install gsd --dry-run` is the preview path.
- **D-12:** GSD dry-run preview must print the exact `npx get-shit-done-cc@...` commands and clearly state that no network or install will run.
- **D-13:** GSD setup should execute or preview one installer command per runtime.
- **D-14:** After a real GSD install, AOF should record each command attempt in `.aof/aof.lock.json`.
- **D-15:** Install attempt records should include command, runtime, scope, exit status, timestamp, and package source or version/range.

### Interactive Flow
- **D-16:** The primary guided entry point should be `aof install --interactive`.
- **D-17:** The guided flow should gather selections, show a config/render/framework plan, then ask before writing `.aof/`, writing runtime files, or running GSD.
- **D-18:** Interactive catalog selection should stay simple in v1: choose catalog items and runtimes, include GSD choice, and avoid a full profile builder.
- **D-19:** If `.aof/aof.config.json` already exists, the guided flow should inspect it, show proposed additions or changes, and ask before modifying.

### Failure And Reproducibility
- **D-20:** If any GSD runtime install fails, `aof install gsd` should fail overall.
- **D-21:** Partial GSD installs should still record per-runtime attempts, including successes and failures.
- **D-22:** Failure output should print exact retry commands.
- **D-23:** Phase 3 should add explicit lock replay, such as `aof install --from-lock`, with dry-run preview.
- **D-24:** Real networked installer runs should always print a clear boundary message before execution.
- **D-25:** The boundary message should include command, package source, target runtime, scope, and a warning that the command may access the network and execute npm package code.
- **D-26:** If lock state shows GSD was already installed successfully for a runtime, reruns should skip that runtime by default.
- **D-27:** Use `--force` to rerun successful prior installs.

### the agent's Discretion
No areas were delegated to the agent's discretion. The user selected concrete decisions for all discussed areas.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/ROADMAP.md` — Phase 3 goal, requirements, success criteria, and phase boundary.
- `.planning/PROJECT.md` — Product context, constraints, source-of-truth decisions, and UI execution boundary.
- `.planning/REQUIREMENTS.md` — FRAM-01, FRAM-02, FRAM-03, CLI-01, and CLI-02.
- `.planning/STATE.md` — Current project state and project memory.
- `.planning/phases/01-aof-workspace-model/01-CONTEXT.md` — Locked `.aof/` workspace, config precedence, package/config model, and BDD requirements.
- `.planning/phases/02-runtime-rendering-and-lock-state/02-CONTEXT.md` — Locked generated-output, dry-run, lock manifest, and framework-intent boundaries.
- `.planning/phases/02-runtime-rendering-and-lock-state/02-VERIFICATION.md` — Phase 2 completion evidence and implemented lock/apply behavior.

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — CLI command dispatch, init/apply/install/catalog flows, and module boundaries.
- `.planning/codebase/INTEGRATIONS.md` — GSD installer integration, runtime flags, local/global scope, and network boundary.
- `.planning/codebase/TESTING.md` — Unit and BDD integration harness; BDD coverage is required for new user-facing CLI behavior.

### Current Implementation
- `src/cli.mjs` — Command dispatch, option parsing, `init`, `apply`, `install`, `catalog`, and help text.
- `src/frameworks.mjs` — Current GSD installer command construction and execution.
- `src/lock.mjs` — Lock manifest read/write helpers from Phase 2.
- `src/render-plan.mjs` — Phase 2 framework intent shaping and apply lock behavior.
- `src/dsl.mjs` — `.aof/` config resolution, resource validation, file-backed paths, overrides, and package preservation.
- `src/catalog.mjs` — Catalog item storage and selected item conversion for interactive selection.
- `src/prompt.mjs` — Existing prompt helpers and test-input hooks for interactive CLI behavior.
- `test/integration/cli.feature` — BDD scenarios to extend for config commands, interactive install, GSD preview/install, failure recording, and lock replay.
- `test/integration/cli.mjs` — Integration runner and step definitions to extend.
- `test/render-plan.test.mjs` — Lock/framework-intent tests to build on.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli.mjs`: Existing command router and `parseOptions()` should be extended for `config` subcommands, `--json`, `--from-lock`, and interactive install behavior.
- `src/frameworks.mjs`: Existing GSD command construction already emits one command per runtime and supports dry-run; Phase 3 should add config-aware resolution, attempt recording, skip/force policy, and boundary output.
- `src/lock.mjs`: Phase 2 lock helpers should be reused for install attempt records and lock replay.
- `src/render-plan.mjs`: Existing framework intent manifest shape can feed install/replay behavior.
- `src/catalog.mjs`: Catalog item listing and `itemsToConfig()` can support guided asset selection.
- `src/prompt.mjs`: Existing selection prompts and `AOF_TEST_SELECTION_INPUT` style should be reused for simple interactive flow tests.

### Established Patterns
- CLI commands are synchronous, direct, and small; user-facing failures throw `Error` and are printed by `bin/aof.mjs`.
- Human-readable CLI output is the default; Phase 3 adds `--json` for automation where practical.
- Dry-run must avoid side effects and print exact planned operations.
- Runtime folders are generated output; `.aof/` config and lock state remain authoritative.
- New user-facing behavior must be backed by BDD integration scenarios.

### Integration Points
- `aof config show|validate|doctor` should load the same config discovery path as `aof apply`, preferring `.aof/aof.config.json`.
- `aof install gsd` should resolve package intent from `.aof/aof.config.json` when present, then apply one-run CLI overrides.
- `aof install --interactive` should compose existing catalog selection, runtime selection, config writing, render planning, and GSD preview/install confirmation.
- `aof install --from-lock` should read `.aof/aof.lock.json`, replay package/runtime/scope intent explicitly, and support dry-run preview.

</code_context>

<specifics>
## Specific Ideas

- Keep Phase 3 CLI-first and script-friendly: predictable exit codes, stable `--json`, and clear command output.
- Make network boundaries explicit before running `npx get-shit-done-cc@...`.
- Treat install attempt records as audit data, not proof that external installer output still exists.
- Prefer simple interactive selection over a profile builder or asset editor in v1.

</specifics>

<deferred>
## Deferred Ideas

- Profile-oriented setup is deferred; v1 interactive flow should stay simple.
- Full CLI asset editor is deferred to later work; Phase 4 owns UI configuration editing.
- UI execution of init/apply/install remains out of scope for v1.
- Runtime support beyond Claude Code and Codex remains out of scope for v1.

</deferred>

---

*Phase: 3-CLI And GSD Framework Flow*
*Context gathered: 2026-05-06T22:48:30+01:00*
