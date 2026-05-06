# Roadmap: AOF

**Created:** 2026-05-06
**Granularity:** Standard
**Core Value:** Users can configure assistant skills, commands, agents, rules/instructions, and GSD framework setup once in `.aof/`, then reliably generate the correct Claude Code and Codex files without hand-maintaining assistant-specific folders.

## Summary

| Phase | Name | Goal | Requirements | UI hint |
|-------|------|------|--------------|---------|
| 1 | `.aof` Workspace Model | Establish `.aof/` as the source of truth for config, assets, and runtime overrides | WORK-01, WORK-02, WORK-03, ASST-01, ASST-02, ASST-03, ASST-04, ASST-05, RTOV-01, RTOV-02, RTOV-03 | no |
| 2 | Runtime Rendering And Lock State | Render `.aof/` assets to Claude/Codex output with dry-run and reproducible lock state | REND-01, REND-02, REND-03, REND-04, FRAM-04, CLI-03, CLI-04 | no |
| 3 | CLI And GSD Framework Flow | Provide automation-friendly and interactive CLI paths for init/apply/install plus GSD management | FRAM-01, FRAM-02, FRAM-03, CLI-01, CLI-02 | no |
| 4 | UI Configuration Editor | Let users create valid `.aof/` configuration with visible runtime capability differences | RTOV-04, UI-01, UI-02, UI-03, UI-04, UI-05 | yes |
| 5 | Verification And Hardening | Protect existing behavior and cover the new `.aof/`, runtime override, lock, and UI config paths | VERI-01, VERI-02, VERI-03 | yes |

**Coverage:** 32 / 32 v1 requirements mapped.

## Phase Details

### Phase 1: `.aof` Workspace Model

**Goal:** Establish `.aof/` as the repo-local source of truth for configuration, source assets, runtime targeting, and runtime override data.

**Requirements:** WORK-01, WORK-02, WORK-03, ASST-01, ASST-02, ASST-03, ASST-04, ASST-05, RTOV-01, RTOV-02, RTOV-03

**Success criteria:**
1. Running the appropriate init path creates a `.aof/` workspace with documented config, source asset, override, and lock locations.
2. Existing root `aof.config.json` data can be read or reconciled into the new `.aof/` model without losing current resource definitions.
3. Skills, commands, agents, and rules/instructions can be represented in the `.aof/` model with shared defaults.
4. Each asset can declare Claude Code and Codex targets plus runtime-specific overrides.

**Notes:**
- This phase should centralize resource-kind and runtime definitions to reduce drift across modules.
- Do not break existing tests without replacing them with equivalent `.aof/` expectations.

**Plans:**
- Wave 1: `01-01-PLAN.md` — Workspace discovery, `.aof` init output, explicit `aof migrate`, and BDD coverage.
- Wave 2 *(blocked on Wave 1 completion)*: `01-02-PLAN.md` — Central model/capability table, file-backed assets, runtime overrides, and schema alignment.
- Wave 3 *(blocked on Wave 2 completion)*: `01-03-PLAN.md` — Rule mapping semantics, docs, and full verification sweep.

**Cross-cutting constraints:**
- BDD tests are required for all new functionality.
- `.aof/aof.config.json` is authoritative over legacy root `aof.config.json`.
- Runtime capability behavior is handled capability-by-capability from a central model.

### Phase 2: Runtime Rendering And Lock State

**Goal:** Render `.aof/` assets into Claude Code and Codex folder layouts while preserving dry-run behavior, generated-output boundaries, and reproducible lock state.

**Requirements:** REND-01, REND-02, REND-03, REND-04, FRAM-04, CLI-03, CLI-04

**Success criteria:**
1. `.aof/` assets render to Claude Code output paths.
2. `.aof/` assets render to Codex output paths.
3. Generated `.claude/` and `.codex/` files are clearly treated as output in docs, command output, and lock state.
4. Dry-run output shows what would be written without modifying runtime folders.
5. Lock state records generated assets and managed framework intent in a reproducible format.

**Notes:**
- Keep the existing adapter pattern, but make `.aof/` the input boundary.
- Lock state should be useful for audit and re-apply behavior, not just a timestamp.

### Phase 3: CLI And GSD Framework Flow

**Goal:** Provide a complete CLI path for initializing, applying, inspecting, and installing `.aof/` projects, including managed GSD setup for Claude Code and Codex.

**Requirements:** FRAM-01, FRAM-02, FRAM-03, CLI-01, CLI-02

**Success criteria:**
1. Users can declare GSD as a managed framework package in `.aof/`.
2. Users can preview and run GSD setup for Claude Code.
3. Users can preview and run GSD setup for Codex.
4. Automation-friendly commands exist for init, apply, install, and catalog/config inspection.
5. Interactive install flow can guide users through selecting assets, runtimes, and framework setup.

**Notes:**
- Preserve dry-run behavior around framework installation.
- Keep networked installer boundaries explicit in command output.

### Phase 4: UI Configuration Editor

**Goal:** Evolve the setup UI into a configuration editor that writes valid `.aof/` configuration while leaving execution to the CLI.

**Requirements:** RTOV-04, UI-01, UI-02, UI-03, UI-04, UI-05

**Success criteria:**
1. Users can edit `.aof/` configuration through the setup UI.
2. Users can create and edit skills, commands, agents, and rules/instructions in the UI.
3. Users can configure runtime targets and runtime-specific overrides.
4. UI makes capability differences visible before config is applied, including Claude Code-only support where applicable.
5. UI writes valid configuration but does not execute init, apply, or install actions in v1.

**Notes:**
- The UI should expose runtime support as product behavior, not hidden metadata.
- Use the shared `.aof/` schema/model rather than creating a separate UI-only shape.

### Phase 5: Verification And Hardening

**Goal:** Add coverage and hardening for the new source-of-truth model, rendering behavior, runtime overrides, lock state, and UI config editing.

**Requirements:** VERI-01, VERI-02, VERI-03

**Success criteria:**
1. Existing CLI behavior remains covered by unit and BDD integration tests or intentionally migrated equivalents.
2. `.aof/` config parsing, rendering, runtime overrides, and lock state have targeted tests.
3. UI configuration editing paths are covered by build checks or targeted tests.
4. Setup UI request validation and static serving risks identified in the codebase map are addressed or explicitly deferred.

**Notes:**
- This phase should include regression coverage for old `aof.config.json` compatibility decisions made in Phase 1.
- Include `npm run ui:build` in verification if UI changes are part of the implementation.

## Requirement Coverage

| Requirement | Phase |
|-------------|-------|
| WORK-01 | Phase 1 |
| WORK-02 | Phase 1 |
| WORK-03 | Phase 1 |
| ASST-01 | Phase 1 |
| ASST-02 | Phase 1 |
| ASST-03 | Phase 1 |
| ASST-04 | Phase 1 |
| ASST-05 | Phase 1 |
| RTOV-01 | Phase 1 |
| RTOV-02 | Phase 1 |
| RTOV-03 | Phase 1 |
| REND-01 | Phase 2 |
| REND-02 | Phase 2 |
| REND-03 | Phase 2 |
| REND-04 | Phase 2 |
| FRAM-04 | Phase 2 |
| CLI-03 | Phase 2 |
| CLI-04 | Phase 2 |
| FRAM-01 | Phase 3 |
| FRAM-02 | Phase 3 |
| FRAM-03 | Phase 3 |
| CLI-01 | Phase 3 |
| CLI-02 | Phase 3 |
| RTOV-04 | Phase 4 |
| UI-01 | Phase 4 |
| UI-02 | Phase 4 |
| UI-03 | Phase 4 |
| UI-04 | Phase 4 |
| UI-05 | Phase 4 |
| VERI-01 | Phase 5 |
| VERI-02 | Phase 5 |
| VERI-03 | Phase 5 |

---
*Roadmap created: 2026-05-06*
