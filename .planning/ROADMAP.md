# Roadmap: AOF

**Created:** 2026-05-06
**Last updated:** 2026-05-08 after Phase 10 planning

## Milestones

- ✅ **v1 Assistant Configuration Foundation** — Phases 1-5, shipped 2026-05-07. Archive: [v1-ROADMAP.md](milestones/v1-ROADMAP.md)
- 📋 **v1.1 Aligned Core Hardening** — Phases 6-10, requirements defined 2026-05-07.

## Phases

<details>
<summary>✅ v1 Assistant Configuration Foundation (Phases 1-5) — SHIPPED 2026-05-07</summary>

- [x] Phase 1: `.aof` Workspace Model — completed 2026-05-06
- [x] Phase 2: Runtime Rendering And Lock State — completed 2026-05-06
- [x] Phase 3: CLI And GSD Framework Flow — completed 2026-05-07
- [x] Phase 4: UI Configuration Editor — completed 2026-05-07
- [x] Phase 5: Verification And Hardening — completed 2026-05-07

</details>

### v1.1 Aligned Core Hardening

| Phase | Name | Goal | Requirements | UI hint |
|-------|------|------|--------------|---------|
| 6 | CLI Lifecycle Commands | Add first-class commands for scaffold, sync, validate, doctor, and clean lifecycle work | CLI-05, CLI-06, CLI-07, CLI-08, CLI-09 | no |
| 7 | Expanded DSL Primitives | Add MCP, hooks, project docs, and settings to the `.aof/` model without regressing v1 primitives | DSL-01, DSL-02, DSL-03, DSL-04, DSL-05 | yes |
| 8 | Adapter Degradation Policy | Make unsupported or lossy runtime behavior explicit, warnable, and enforceable in strict mode | ADPT-01, ADPT-02, ADPT-03, ADPT-04 | no |
| 9 | Framework Package Semantics | Add package source descriptors, namespace enforcement, dependency lock state, and conflict detection | PKG-01, PKG-02, PKG-03, PKG-04 | no |
| 10 | BDD Parity And Hardening | Cover the v1.1 lifecycle, primitive, package, and degradation behaviors with BDD scenarios | BDD-01, BDD-02, BDD-03, BDD-04 | yes |

**Coverage:** 22 / 22 v1.1 requirements mapped.

## Phase Details

### Phase 6: CLI Lifecycle Commands

**Goal:** Add first-class CLI commands for common lifecycle operations so users do not need to compose lower-level config/apply/install behavior manually.

**Requirements:** CLI-05, CLI-06, CLI-07, CLI-08, CLI-09

**Status:** Complete — implemented and verified 2026-05-07.

**Success criteria:**
1. `aof add` scaffolds supported primitives into `.aof/` with valid defaults and collision checks.
2. `aof sync` reconciles declared packages and generated runtime outputs through one automation-friendly command.
3. `aof validate` emits human and JSON diagnostics for config and DSL source validation.
4. `aof doctor` reports project setup health, stale lock/package state, and actionable remediation hints.
5. `aof clean` removes AOF-owned generated outputs while preserving `.aof/` source files.

**Plans:**
- [x] Wave 1: `06-01-PLAN.md` — Top-level diagnostics and lifecycle help.
- [x] Wave 2: `06-02-PLAN.md` — File-backed scaffold command.
- [x] Wave 3: `06-03-PLAN.md` — Sync and clean lifecycle commands.

**Cross-cutting constraints:**
- Human-readable output remains the default; `--json` is added where automation benefits.
- Dry-run paths must be side-effect-free and print exact planned operations.
- Generated-output drift is preserved by default.
- Networked package installer execution must remain opt-in and explicit.
- New user-facing CLI behavior requires BDD coverage.

### Phase 7: Expanded DSL Primitives

**Goal:** Expand the source model to cover MCP servers, hooks, project docs, and settings while keeping v1 skills, commands, agents, and rules stable.

**Requirements:** DSL-01, DSL-02, DSL-03, DSL-04, DSL-05

**Status:** Complete — implemented and verified 2026-05-07.

**Success criteria:**
1. MCP server definitions render to Claude Code and Codex configuration outputs where supported.
2. Common-core hook definitions render to both runtime targets where supported.
3. Project docs render deterministically to AGENTS.md and CLAUDE.md, including documented include behavior.
4. Settings support vendor-neutral defaults and runtime-specific escape hatches.
5. Existing v1 `.aof/` configs remain valid or receive intentional migration diagnostics.

**Plans:**
- [x] Wave 1: `07-01-PLAN.md` — Expanded DSL model and validation.
- [x] Wave 2: `07-02-PLAN.md` — Runtime rendering for MCP, hooks, docs, and settings.
- [x] Wave 3: `07-03-PLAN.md` — UI editing and documentation for expanded DSL.

**Cross-cutting constraints:**
- Preserve `resources[]` behavior for existing skills, commands, agents, and rules.
- Use top-level config sections for structurally different primitives: `mcpServers`, `hooks`, `projectDocs`, and `settings`.
- Implement common-core rendering now; defer strict unsupported/lossy warning policy to Phase 8.
- Keep setup UI as valid configuration editing and review only; CLI remains the execution surface.

### Phase 8: Adapter Degradation Policy

**Goal:** Formalize adapter behavior when a primitive cannot be represented with full fidelity in a target runtime.

**Requirements:** ADPT-01, ADPT-02, ADPT-03, ADPT-04

**Status:** Complete - implemented and verified 2026-05-08.

**Success criteria:**
1. Unsupported runtime features produce skip warnings naming the source file, target, and reason.
2. Lossy fallback behavior produces inline warnings naming the fallback output.
3. Runtime-namespaced extensions pass through only to matching targets without noisy warnings.
4. Strict mode turns adapter warnings into command failures suitable for CI.

**Plans:**
- [x] Wave 1: `08-01-PLAN.md` - Shared adapter warning model.
- [x] Wave 2: `08-02-PLAN.md` - CLI warning output and strict gates.
- [x] Wave 3: `08-03-PLAN.md` - Review surfaces and policy documentation.

**Cross-cutting constraints:**
- Adapter warnings are computed at command time and are not stored in `.aof/aof.lock.json`.
- `apply --strict` and `sync --strict` must fail before generated files, lock state, or installers change anything.
- `--force` only affects generated-output drift and must not bypass strict adapter warnings.
- Existing Codex rule guidance output to `AGENTS.md` remains intentional mapped output, not warning noise.

### Phase 9: Framework Package Semantics

**Goal:** Upgrade framework package handling from simple GSD delegation to a package model with sources, namespaces, dependency metadata, lock resolution, and conflict checks.

**Requirements:** PKG-01, PKG-02, PKG-03, PKG-04

**Status:** Complete - implemented and verified 2026-05-08.

**Success criteria:**
1. Packages can be declared from npm, git, and local file sources.
2. Package namespaces are required and applied to emitted files before writes.
3. Dependency metadata and resolved package versions are recorded in lock state.
4. Conflicting generated output claims fail before any write and identify the packages or local primitives involved.

**Plans:**
- [x] Wave 1: `09-01-PLAN.md` - Package descriptor normalization and validation.
- [x] Wave 2: `09-02-PLAN.md` - Package resolution and lock metadata.
- [x] Wave 3: `09-03-PLAN.md` - Package output claims and conflict gates.

**Cross-cutting constraints:**
- Existing string package sources remain supported while structured npm/git/file descriptors are added.
- Package namespaces are explicit and required.
- Lock state records direct package metadata, not a full transitive dependency graph.
- Package conflict checks must fail before generated files, lock state, or installers change anything.
- Networked package installer execution remains opt-in and explicit.

### Phase 10: BDD Parity And Hardening

**Goal:** Expand the BDD suite so v1.1 behavior is specified at the user-facing command level before deeper runtime expansion or a future core port.

**Requirements:** BDD-01, BDD-02, BDD-03, BDD-04

**Status:** Planned - ready to execute.

**Success criteria:**
1. Lifecycle commands have happy-path and error-path BDD scenarios.
2. All v1.1 primitives have compile/render BDD scenarios for Claude Code and Codex targets.
3. Package install, dependency, lock, and conflict behavior has BDD coverage.
4. Degradation warnings and strict-mode failures have BDD coverage.

**Plans:**
- [ ] Wave 1: `10-01-PLAN.md` - BDD coverage matrix and runner foundation.
- [ ] Wave 2 *(blocked on Wave 1 completion)*: `10-02-PLAN.md` - CLI domain feature split and BDD gap closure.
- [ ] Wave 2 *(blocked on Wave 1 completion)*: `10-03-PLAN.md` - Setup UI API BDD over HTTP.
- [ ] Wave 3 *(blocked on Wave 2 completion)*: `10-04-PLAN.md` - PowerShell BDD parity and final verification.

**Cross-cutting constraints:**
- `10-BDD-COVERAGE.md` must map `BDD-01` through `BDD-04` to exact scenario names.
- Split feature files use domain names and each domain gets its own step module.
- Setup UI BDD uses real HTTP server scenarios, not browser E2E.
- PowerShell integration remains a separate required verification command and consumes the shared feature files.

## Progress

| Milestone | Phases | Plans | Requirements | Status | Shipped |
|-----------|--------|-------|--------------|--------|---------|
| v1 Assistant Configuration Foundation | 1-5 | 15/15 | 32/32 | Complete | 2026-05-07 |
| v1.1 Aligned Core Hardening | 6-10 | 16/16 | 18/22 | In Progress | — |

## Next

Run `$gsd-execute-phase 10` to implement BDD Parity And Hardening.
