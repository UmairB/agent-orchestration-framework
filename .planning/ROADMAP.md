# Roadmap: AOF

**Created:** 2026-05-06
**Last updated:** 2026-05-09 after v1.3 completion

## Milestones

- ✅ **v1 Assistant Configuration Foundation** — Phases 1-5, shipped 2026-05-07. Archive: [v1-ROADMAP.md](milestones/v1-ROADMAP.md)
- ✅ **v1.1 Aligned Core Hardening** — Phases 6-10, shipped 2026-05-08. Archive: [v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Global Asset Library** — Phases 11-15, shipped 2026-05-09. Archive: [v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Interactive CLI Hardening** — Phases 16-17, shipped 2026-05-09. Archive: [v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)

## Phases

<details>
<summary>✅ v1 Assistant Configuration Foundation (Phases 1-5) — SHIPPED 2026-05-07</summary>

- [x] Phase 1: `.aof` Workspace Model — completed 2026-05-06
- [x] Phase 2: Runtime Rendering And Lock State — completed 2026-05-06
- [x] Phase 3: CLI And GSD Framework Flow — completed 2026-05-07
- [x] Phase 4: UI Configuration Editor — completed 2026-05-07
- [x] Phase 5: Verification And Hardening — completed 2026-05-07

</details>

<details>
<summary>✅ v1.1 Aligned Core Hardening (Phases 6-10) — SHIPPED 2026-05-08</summary>

- [x] Phase 6: CLI Lifecycle Commands — completed 2026-05-07
- [x] Phase 7: Expanded DSL Primitives — completed 2026-05-07
- [x] Phase 8: Adapter Degradation Policy — completed 2026-05-08
- [x] Phase 9: Framework Package Semantics — completed 2026-05-08
- [x] Phase 10: BDD Parity And Hardening — completed 2026-05-08

</details>

<details>
<summary>✅ v1.2 Global Asset Library (Phases 11-15) — SHIPPED 2026-05-09</summary>

- [x] Phase 11: Global Library Workspace — completed 2026-05-08. Defined `~/.aof` source storage and global asset CRUD.
  - Plans: 11-01 Global Workspace Path And Manifest Foundation; 11-02 Global CLI Asset Operations; 11-03 Global Validation And Phase Hardening.
  - Wave 1: 11-01 completed.
  - Wave 2: 11-02 completed.
  - Wave 3: 11-03 completed.
  - Cross-cutting constraints: `~/.aof` mirrors project workspace shape; use explicit `aof global ...` commands; `~/.aof/aof.config.json` is canonical; project validation only fails for referenced malformed global assets.
- [x] Phase 12: Project Reference Rendering — completed 2026-05-08. Resolved global references from project configs and rendered them with lock traceability.
  - Plans: 12-01 Global Reference Model And Validation; 12-02 Apply And Sync Global Reference Rendering; 12-03 Global Reference Diagnostics And Lock Traceability.
  - Wave 1: 12-01 completed.
  - Wave 2: 12-02 completed.
  - Wave 3: 12-03 completed.
  - Cross-cutting constraints: project configs use top-level `globalRefs`; references do not copy source assets; only referenced global assets affect project validation; lock entries must preserve global source scope.
- [x] Phase 13: Code-Bearing Asset Files — completed 2026-05-08. Preserved explicit associated files for skill assets with validation, rendering, lock ownership, and BDD coverage.
  - Plans: 13-01 Associated File Model And Validation; 13-02 Associated File Rendering And Lock Ownership; 13-03 Associated File BDD Docs And Phase Hardening.
  - Wave 1: 13-01 completed.
  - Wave 2: 13-02 completed.
  - Wave 3: 13-03 completed.
  - Cross-cutting constraints: associated files use explicit `files` entries; paths are relative to the asset directory; Phase 13 renders skill helper files; unsafe paths and output conflicts fail before writes.
- [x] Phase 14: Global Asset Setup UI — completed 2026-05-09. Added scoped Project/Global setup UI APIs, global asset editing, project reference management, source labels, and global skill helper-file editing.
  - Plans: 14-01 Scoped Setup UI Config API; 14-02 Project Global Reference API And UI; 14-03 Setup UI BDD Docs And Phase Hardening.
  - Wave 1: 14-01 completed.
  - Wave 2: 14-02 completed.
  - Wave 3: 14-03 completed.
  - Cross-cutting constraints: UI remains config-editing only; Project/Global scope must be explicit; references write `globalRefs` without copying; referenced globals are read-only in Project scope; associated-file editing is global-skill-only and explicit.
- [x] Phase 15: Global Asset Verification — completed 2026-05-09. Hardened unit, BDD, UI API, PowerShell parity, and build coverage for global reuse.
  - Plans: 15-01 Global Asset Coverage Audit; 15-02 Cross-Runner Verification And Hardening; 15-03 Milestone Audit And Archive.
  - Wave 1: 15-01 completed.
  - Wave 2: 15-02 completed.
  - Wave 3: 15-03 completed.
  - Cross-cutting constraints: no new feature scope; add code only for concrete verification gaps; require unit, UI build, Node BDD, and PowerShell integration evidence; archive v1.2 after audit.

</details>

<details>
<summary>✅ v1.3 Interactive CLI Hardening (Phases 16-17) — SHIPPED 2026-05-09</summary>

- [x] Phase 16: Live Repository Hardening — completed 2026-05-09. Removed active SQLite/default catalog behavior from first-run paths.
  - Wave 1: empty repo init hardening completed.
  - Cross-cutting constraints: project and global assets remain explicit; catalog storage stays disabled until a real product path exists.
- [x] Phase 17: Interactive CLI — completed 2026-05-09. Added Inquirer prompt foundation and interactive project/global asset creation.
  - Plans: 17-01 Inquirer Prompt Foundation; 17-02 Interactive Asset Creation Flow.
  - Wave 1: 17-01 completed.
  - Wave 2: 17-02 completed.
  - Cross-cutting constraints: direct flag commands remain available for automation; deterministic BDD prompt inputs remain supported.

</details>

## Progress

| Milestone | Phases | Plans | Requirements | Status | Shipped |
|-----------|--------|-------|--------------|--------|---------|
| v1 Assistant Configuration Foundation | 1-5 | 15/15 | 32/32 | Complete | 2026-05-07 |
| v1.1 Aligned Core Hardening | 6-10 | 16/16 | 22/22 | Complete | 2026-05-08 |
| v1.2 Global Asset Library | 11-15 | 15/15 | 22/22 | Complete | 2026-05-09 |
| v1.3 Interactive CLI Hardening | 16-17 | 3/3 | 12/12 | Complete | 2026-05-09 |

## Phase Details

### Phase 11: Global Library Workspace

**Goal:** Establish `~/.aof` as the user-global source workspace and support global asset creation, listing, inspection, and validation.

**Requirements:** GLIB-01, GLIB-02, GLIB-03, GLIB-04

**Success Criteria:**
1. CLI can initialize or locate the global AOF library at `~/.aof`.
2. CLI can create global skills, agents, and rules with the same file-backed conventions as project assets.
3. CLI can list and inspect global assets separately from project-local assets.
4. Validation reports malformed global assets and missing required files clearly.

### Phase 12: Project Reference Rendering

**Goal:** Let project `.aof` configs reference global assets by ID and include them in validation, diagnostics, rendering, and lock state.

**Requirements:** GREF-01, GREF-02, GREF-03, GREF-04, GRND-01, GRND-02, GRND-03, GRND-04

**Success Criteria:**
1. Project config can declare global asset references without copying global files into project `.aof`.
2. Missing global references and local/global ID conflicts produce actionable validation errors.
3. `aof apply` and `aof sync` render referenced global assets into Claude Code and Codex outputs.
4. Runtime overrides on global assets are honored.
5. Lock and diagnostic output identify whether generated assets came from local or global source.

### Phase 13: Code-Bearing Asset Files

**Goal:** Support asset-owned helper files for global assets while preventing path escapes and unrelated output overwrites.

**Requirements:** CODE-01, CODE-02, CODE-03

**Success Criteria:**
1. Global asset directories can include associated files such as Python scripts, templates, or examples.
2. Rendering preserves associated files for directory-shaped runtime assets such as skills.
3. Validation rejects associated files that escape the asset directory.
4. Render planning prevents associated files from overwriting unrelated generated output.

### Phase 14: Global Asset Setup UI

**Goal:** Extend the setup UI so users can create, edit, distinguish, and reference global assets.

**Requirements:** GUI-01, GUI-02, GUI-03, GUI-04

**Success Criteria:**
1. UI can switch between project asset editing and global asset editing.
2. UI can create and edit global skills, agents, and rules.
3. UI can add a global asset reference to the current project without copying the asset source.
4. UI clearly labels project-local versus global asset scope.

### Phase 15: Global Asset Verification

**Goal:** Prove global asset behavior across unit tests, integration scenarios, UI API behavior, and UI build.

**Requirements:** TEST-01, TEST-02, TEST-03

**Success Criteria:**
1. Unit tests cover path resolution, reference resolution, conflicts, associated files, and lock metadata.
2. BDD integration tests cover global asset creation, reference rendering, missing-reference diagnostics, and UI API behavior.
3. `npm run ui:build` passes after UI changes.
4. Standard `npm run test:unit` and `npm test` checks pass for the milestone behavior.

### Phase 16: Live Repository Hardening

**Goal:** Use live-repository first-run findings to harden AOF's current project/global asset model.

**Requirements:** INIT-01, INIT-02, INIT-03

**Success Criteria:**
1. Empty project initialization does not seed built-in defaults.
2. First-run CLI commands do not initialize SQLite or emit experimental SQLite warnings.
3. Disabled catalog commands explain the current supported project/global asset paths.

### Phase 17: Interactive CLI

**Goal:** Replace typed prompt helpers with keyboard-driven prompts and provide explicit interactive asset creation flows.

**Requirements:** ICLI-01 through ICLI-06, TEST-01 through TEST-03

**Success Criteria:**
1. Runtime prompts use checkbox-style keyboard navigation.
2. `aof add` can create project assets interactively.
3. `aof global add` can create global assets interactively.
4. Direct flag-based usage and deterministic test inputs remain supported.

## Next

v1.3 is complete. Select the next milestone before planning more work.
