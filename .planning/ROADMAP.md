# Roadmap: AOF

**Created:** 2026-05-06
**Last updated:** 2026-05-10 after v1.4 initialization

## Milestones

- ✅ **v1 Assistant Configuration Foundation** — Phases 1-5, shipped 2026-05-07. Archive: [v1-ROADMAP.md](milestones/v1-ROADMAP.md)
- ✅ **v1.1 Aligned Core Hardening** — Phases 6-10, shipped 2026-05-08. Archive: [v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Global Asset Library** — Phases 11-15, shipped 2026-05-09. Archive: [v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Interactive CLI Hardening** — Phases 16-17, shipped 2026-05-09. Archive: [v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)
- 🔵 **v1.4 Namespaced CLI Contract** — Phases 18-22, active.

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

- [x] Phase 11: Global Library Workspace — completed 2026-05-08
- [x] Phase 12: Project Reference Rendering — completed 2026-05-08
- [x] Phase 13: Code-Bearing Asset Files — completed 2026-05-08
- [x] Phase 14: Global Asset Setup UI — completed 2026-05-09
- [x] Phase 15: Global Asset Verification — completed 2026-05-09

</details>

<details>
<summary>✅ v1.3 Interactive CLI Hardening (Phases 16-17) — SHIPPED 2026-05-09</summary>

- [x] Phase 16: Live Repository Hardening — completed 2026-05-09
- [x] Phase 17: Interactive CLI — completed 2026-05-09

</details>

<details open>
<summary>🔵 v1.4 Namespaced CLI Contract (Phases 18-22) — ACTIVE</summary>

- [ ] Phase 18: Command Contract Audit — review every current command and lock the replacement taxonomy before code changes.
  - Plans: 18-01 Current Command Inventory; 18-02 Replacement CLI Contract; 18-03 Help, Errors, And BDD Contract.
  - Wave 1: 18-01.
  - Wave 2 *(blocked on Wave 1 completion)*: 18-02.
  - Wave 3 *(blocked on Wave 2 completion)*: 18-03.
  - Cross-cutting constraints: contract artifacts only; no CLI implementation in Phase 18; no legacy aliases; removed commands must not execute.
- [ ] Phase 19: Assets Namespace Rewrite — implement `aof assets ...` for asset CRUD, global scope, apply, validate, clean, and UI.
- [ ] Phase 20: Packages Namespace Rewrite — implement `aof packages ...` for GSD package declaration, inspection, validation, install, and lock replay.
- [ ] Phase 21: Project And Diagnostics Commands — settle top-level/project/config/migrate/doctor behavior and remove catalog ambiguity.
- [ ] Phase 22: Live Repository Verification — run the rewritten CLI through new/existing repo workflows, docs, and cross-runner BDD.

</details>

## Progress

| Milestone | Phases | Plans | Requirements | Status | Shipped |
|-----------|--------|-------|--------------|--------|---------|
| v1 Assistant Configuration Foundation | 1-5 | 15/15 | 32/32 | Complete | 2026-05-07 |
| v1.1 Aligned Core Hardening | 6-10 | 16/16 | 22/22 | Complete | 2026-05-08 |
| v1.2 Global Asset Library | 11-15 | 15/15 | 22/22 | Complete | 2026-05-09 |
| v1.3 Interactive CLI Hardening | 16-17 | 3/3 | 12/12 | Complete | 2026-05-09 |
| v1.4 Namespaced CLI Contract | 18-22 | 0/3 | 0/22 | Active | — |

## Phase Details

### Phase 18: Command Contract Audit

**Goal:** Review every CLI command and subcommand from the user's point of view, then lock the replacement namespaced contract before implementation.

**Requirements:** CLI-01, CLI-02, CLI-03, CLI-04

**Success Criteria:**
1. Every current command is classified as keep, replace, move, or remove.
2. Replacement commands have explicit purpose, arguments, missing-argument behavior, prompt behavior, dry-run behavior, output, errors, and BDD expectations.
3. The accepted taxonomy includes no legacy aliases.
4. Help structure and examples are drafted from the accepted command contract.

### Phase 19: Assets Namespace Rewrite

**Goal:** Move asset source, global asset scope, rendering, validation, cleanup, and editor launch into the `aof assets ...` namespace.

**Requirements:** ASSET-01, ASSET-02, ASSET-03, ASSET-04, ASSET-05, ASSET-06

**Success Criteria:**
1. `aof assets add skill|command|rule|agent` supports full and partial interactive asset creation.
2. Global asset creation, inspection, validation, and project reference operations are available under `aof assets`.
3. `aof assets apply` renders all configured project runtimes by default and supports runtime narrowing flags.
4. `aof assets ui` starts the editor; no install command starts the editor.
5. Asset validation and cleanup preserve existing diagnostics, lock, and drift-protection behavior.

### Phase 20: Packages Namespace Rewrite

**Goal:** Move managed package intent and installer execution into `aof packages ...`, with GSD as the concrete v1.4 package.

**Requirements:** PKG-01, PKG-02, PKG-03, PKG-04

**Success Criteria:**
1. `aof packages add gsd` records package intent without running networked installer code.
2. `aof packages install gsd` runs the installer with explicit network/package-code boundary output.
3. Package inspection and validation are available through the packages namespace.
4. Lock replay no longer depends on `aof install --from-lock`.

### Phase 21: Project And Diagnostics Commands

**Goal:** Settle the commands that are not asset or package operations: project initialization, project config inspection, migration, diagnostics, and disabled catalog behavior.

**Requirements:** PROJ-01, PROJ-02, PROJ-03, PROJ-04

**Success Criteria:**
1. `aof init` creates only the project workspace/config/lock and never creates default assets, launches UI, renders outputs, installs packages, or initializes catalog storage.
2. Project-level inspection, validation, and diagnostics have clear names and scopes.
3. Migration output explains exactly what changes and what remains untouched.
4. Catalog commands are removed or report a deliberate unsupported-product-path message with no SQLite side effects.

### Phase 22: Live Repository Verification

**Goal:** Prove the final CLI contract against real new-repo and existing-repo workflows, then align docs and BDD coverage with the shipped behavior.

**Requirements:** HARD-01, HARD-02, HARD-03, HARD-04

**Success Criteria:**
1. Live new-repository testing covers init, assets, globals, UI, apply, validate, clean, and package dry-runs.
2. Live existing-repository testing covers migration, validation, rendering, cleanup, global references, and package intent without corrupting user files.
3. Node and PowerShell BDD scenarios cover accepted commands and rejected legacy commands.
4. README and CLI help examples match the final command surface exactly.

## Next

Start Phase 18 with `$gsd-discuss-phase 18`.
