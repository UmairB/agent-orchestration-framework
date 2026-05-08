# Roadmap: AOF

**Created:** 2026-05-06
**Last updated:** 2026-05-08 after Phase 13 completion

## Milestones

- ✅ **v1 Assistant Configuration Foundation** — Phases 1-5, shipped 2026-05-07. Archive: [v1-ROADMAP.md](milestones/v1-ROADMAP.md)
- ✅ **v1.1 Aligned Core Hardening** — Phases 6-10, shipped 2026-05-08. Archive: [v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- 🔵 **v1.2 Global Asset Library** — Phases 11-15, planned.

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

<details open>
<summary>🔵 v1.2 Global Asset Library (Phases 11-15) — IN PROGRESS</summary>

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
- [ ] Phase 14: Global Asset Setup UI — create, edit, label, and reference global assets through the UI.
- [ ] Phase 15: Global Asset Verification — harden unit, BDD, UI API, and build coverage for global reuse.

</details>

## Progress

| Milestone | Phases | Plans | Requirements | Status | Shipped |
|-----------|--------|-------|--------------|--------|---------|
| v1 Assistant Configuration Foundation | 1-5 | 15/15 | 32/32 | Complete | 2026-05-07 |
| v1.1 Aligned Core Hardening | 6-10 | 16/16 | 22/22 | Complete | 2026-05-08 |
| v1.2 Global Asset Library | 11-15 | 9/9 | 15/22 | In Progress | - |

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

## Next

Run `$gsd-discuss-phase 14` to start the Global Asset Setup UI phase.
