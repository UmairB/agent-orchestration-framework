# Research Summary: AOF v1.7 Typed GSD SDK Backend

**Synthesized:** 2026-05-16
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

---

## Headline Findings

1. **`@gsd-build/sdk@0.1.0` is real and adoptable** — exposes typed `GSDTools` (`stateLoad`, `roadmapAnalyze`, `phaseComplete`, `commit`, `phasePlanIndex`, `configGet/Set`, generic `exec`) plus `GSD` orchestrator (`runPhase`, `run`) plus `GSDEventStream`. Ships TS `.d.ts` so AOF gets editor types without adopting TS.

2. **The SDK is a typed seam over `gsd-tools.cjs`, NOT a no-shellout boundary.** Every call spawns `execFile('node', [gsdToolsPath, cmd, ...args, '--raw'])` with 30s default timeout and `@file:` indirection for large payloads. Adoption types the calls; it does not eliminate the process boundary.

3. **Version drift is the dominant operational risk.** Two release trains share the package name `@gsd-build/sdk`: the npm-published `0.1.0` (maintainer `glittercowboy`, 2026-03-27) and the CLI-bundled `1.42.2` inside `get-shit-done-cc` (or `gsd-pi@2.58.0`). They can return divergent shapes. AOF must detect mismatch via a doctor diagnostic; failure to do so will produce silent state corruption.

4. **Several critical workflow handlers are NOT typed yet** — `state.milestone-switch`, `milestone.complete`, `phase.add`, `phase.add-batch`, `init.new-milestone` are reachable only through `GSDTools.exec(cmd, args)` in v0.1.0. AOF must channel them through a single typed seam with explicit input/output contracts AOF owns.

5. **No SDK milestone-creation runner exists.** `GSD.run(prompt)` is a milestone *executor* (runs existing phases), `InitRunner` is for new-project only. v1.7 must hand off objective→milestone creation to the runtime CLI fallback. PROJECT.md already accepts this deferral.

6. **Every v1.6 board breaks on first v1.7 sync** because the v1.6 validator never required `gsd.milestone.id`. v1.7 requires it. An explicit migration (`aof boards doctor` + auto-attach when unambiguous, fix-it hint when not) is mandatory — not a nice-to-have.

7. **The `BoardBackend` interface must be minimal** (4 methods: `loadState`, `analyzeRoadmap`, `assertMilestone`, `syncBoardFromMilestone`) with a `kind: "gsd"` discriminant. v1 ships GSD + a test-noop only. Designing for hypothetical backends bakes GSD assumptions into the abstraction.

---

## Stack Additions

- Add `@gsd-build/sdk@0.1.0` as a direct dep, pinned exactly with `--save-exact`.
- No new dev dep, no direct `ws`, no direct `@anthropic-ai/claude-agent-sdk`.
- Node engine unchanged (`>=20`).
- Update `scripts/supply-chain-audit.mjs` allowlist for ~30 transitives.
- Commit `package-lock.json`; add CI guard rejecting widening to a range.
- Lint rule: reject `@gsd-build/sdk` imports from `ui/src/**`.

---

## Architecture Shape

**One new module:** `src/gsd-sdk-adapter.mjs` — module of pure async functions (matches `src/frameworks.mjs`/`src/packages.mjs` style):
- `loadGsdState(projectDir)` → typed `{milestoneId, statePresent, roadmapPresent, configPresent, raw}`
- `analyzeGsdRoadmap(projectDir)` → typed `RoadmapAnalysis`
- `assertMilestone(projectDir, milestoneId)` → throws `GsdSdkError(code, ...)`
- `listMilestonePhases(projectDir, milestoneId)`
- `gsdSdkVersion()` → `{installed, cliBundled, drift, driftReason?}`
- `GsdSdkError` class

**New directory:** `src/backends/`
- `index.mjs` — `BoardBackend` JSDoc contract, `BackendError`, `resolveBackend(name)`, `BACKEND_REGISTRY = { gsd, null }`
- `gsd-backend.mjs` — thin composition over the SDK adapter
- `null-backend.mjs` — test-only no-op

**Modified:**
- `src/boards.mjs` — rename `syncBoardFromGsdRoadmap` → `syncBoardFromMilestone`; remove `parseRoadmapPhases` markdown regex; add `gsd.milestone.binding.{status, sdkVersion, driftReason, fingerprint}` fields; new diagnostic codes (`BOARD_MILESTONE_UNATTACHED`, `BOARD_MILESTONE_DRIFT`).
- `src/cli.mjs` — same `aof boards sync --milestone` surface; new `aof boards doctor`; stop auto-spawning runtime on `create`/`repair`; placeholder `aof boards milestone create` prints hand-off instructions.
- `src/board-execution.mjs` — replace `provider !== "gsd"` literal with `backend.capabilities.has("assignTask")`; record `backendPlan: { provider, runner: "sdk-deferred" }`.
- `src/setup-ui.mjs` — import swap; response shapes additively extended with `binding.*`; **no new routes**, no SSE/WebSocket.
- `src/gsd-runtime.mjs` → `src/gsd-runtime-fallback.mjs` — deprecate-in-place; remove `completedRoadmapPath` mtime scraping; keep slash-command builders for interactive milestone-answer.

**Unchanged:** `bin/aof.mjs`, `src/adapters.mjs`, `src/dsl.mjs`, `src/frameworks.mjs`, `src/packages.mjs`, `src/fs.mjs`, `src/workspace.mjs`, `src/model.mjs`, `src/lock.mjs`, `ui/src/main.tsx` (display strings get one-line additive change; no new components).

**UI scope:** DEFERRED to v1.8 — SDK-event-streamed lifecycle is explicitly out of scope per PROJECT.md. UI gains two display-only fields.

---

## Feature Inventory

### Table stakes (must ship in v1.7)
**Adapter:** single typed seam module; 4 read/assert functions; SDK version pin + drift diagnostic; adapter is the ONLY place importing `@gsd-build/sdk` or calling `gsd-tools.cjs`.

**Sync:** typed `aof boards sync <id> --milestone <id>`; hard-fail on missing/mismatched/unattached milestone; write typed `gsd.milestone.phases[]` cache into BOARD.json; `--dry-run --json` diff; drift detection on re-sync.

**Lifecycle:** `create` records `waiting_for_milestone` (no auto-spawn); `repair` reads SDK state + auto-binds matching milestone; `attach` verifies milestone exists in GSD state (not just file path); boards without bound milestone surface as `pending_milestone`.

**Backend Interface:** 4-method `BoardBackend` with `kind: "gsd"` discriminant; GSD as only real impl + null backend for tests; `executeTask` returns v1.6-compatible `task.execution` shape.

**Diagnostics:** structured error codes (`MILESTONE_MISSING_ARG`, `MILESTONE_NOT_BOUND`, `MILESTONE_ID_MISMATCH`, `MILESTONE_NOT_IN_STATE`, `MILESTONE_INCOMPLETE`, `ROADMAP_EMPTY`, `SDK_VERSION_DRIFT`, `GSD_TOOLS_MISSING`); every error includes `next:` remediation; `--json` parity across boards subcommands; new `aof boards doctor [<id>]` runs full assertion ladder.

**Execution:** phase-shaped tasks call `gsd.runPhase(phaseNumber)` instead of spawning claude/codex; runtime-CLI execution preserved ONLY as fallback for interactive milestone creation, labeled in lock state.

**v1.6 Migration:** `aof boards doctor` detects v1.6-shaped boards; auto-infers milestone id from `roadmapPath` when possible; emits `BOARD_MILESTONE_ID_MISSING` warning with exact `attach` command; NEVER silently auto-picks.

### Differentiators
Per-phase `{phaseId, action: "create"|"keep"|"drift"}` in `--dry-run --json`; `aof boards doctor` end-to-end ladder; per-board phases cache; dispatch log to `.aof/cache/boards/dispatch.log.jsonl`; BoardBackend with test-noop proving swap.

### Defer / Anti-features (v1.8+)
`GSDEventStream`→UI WebSocket; single-call `createMilestoneFromObjective`; second real `BoardBackend`; `gsd.run(prompt)` full-milestone autoflight; typed `state.milestone-switch` when SDK promotes it; `phase.add` typed wrappers; cost-tracking per board; `gsd-sdk query` shellouts as third path.

**Anti-features:** reimplement GSD's state logic AOF-side; fork/vendor SDK to add missing runners; AOF-side milestone runner using `GSD.run(prompt)`; implicit ROADMAP.md fallback when `--milestone` missing; runtime CLI + SDK as equal peers; adopt event stream without UI consumer; ship two real backends; adopt CLI as second integration path; markdown regex as "fallback when SDK fails."

---

## Critical Pitfalls (ranked by impact)

1. **Bundled vs published SDK drift** — HIGH severity, near-certain in field. Mitigation: boot-time version comparison; lock-state recording; doctor warning.
2. **0.x SDK semver** — HIGH severity, certain on next minor bump. Mitigation: exact pin + contract test that fails boot on shape change + smoke against fixtures.
3. **v1.6 board migration breakage** — HIGH severity, certain on first upgrade. Mitigation: doctor + auto-attach + fix-it hint; never auto-pick.
4. **"Typed SDK = no shell" misconception** — MEDIUM severity, surfaces as 30s timeouts and Windows path errors. Mitigation: per-method timeouts, error wrapping, batching, docs honesty.
5. **Slash-command fallback drift** — MEDIUM severity, accumulates over time. Mitigation: single result shape; loud `[fallback]` stderr; parity unit test.
6. **BoardBackend over-abstraction** — HIGH severity if it lands, but preventable. Mitigation: 4 methods + `kind: "gsd"` discriminant; extract from working code in Phase 35, not designed up-front.
7. **Reimplementing milestone-creation via composites** — MEDIUM severity, recreates the pre-v1.7 fragility. Mitigation: explicit handoff to runtime CLI; no `tools.exec("state", ["milestone-switch"])` in adapter.
8. **Test doubles at wrong layer** — MEDIUM severity, silent failure mode. Mitigation: two-tier doubles — `MockGSDTools` with captured real fixtures + integration contract test against real SDK.
9. **Windows-specific regressions** — MEDIUM, affects all Windows users. Mitigation: `aof doctor` checks (node on PATH, UNC paths, BOM); BDD parity on PowerShell runner.
10. **Removing line-ending safeguards** — LOW-MEDIUM, easy to regress during "cleanup". Mitigation: `// WINDOWS-FALLBACK:` comments before deletion; `.gitattributes` enforces LF for `.aof/`/`.planning/` JSON/MD.

---

## Suggested Phase Decomposition (for roadmapper)

Five phases, numbered continuing from v1.6 (last phase was 32):

- **Phase 33 — SDK adapter foundation:** add `@gsd-build/sdk@0.1.0` exact pin; write `src/gsd-sdk-adapter.mjs`; SDK version drift diagnostic; error wrapping; contract test; first captured fixture under `test/fixtures/gsd-sdk/`.
- **Phase 34 — Board lifecycle migration + typed sync:** rename and re-route board sync through adapter; remove `parseRoadmapPhases`; add `gsd.milestone.binding.*` fields; structured error codes with `next:` hints; v1.6 board migration via `aof boards doctor` with auto-attach when unambiguous.
- **Phase 35 — BoardBackend seam:** extract minimal interface (4 methods + `kind: "gsd"`) from the working Phase 34 code; ship null backend for tests; capability flags for `assignTask`; ensure no GSD-isms leak.
- **Phase 36 — Test surface migration + Windows BDD parity:** captured-fixture two-tier doubles, SDK-path BDD parallel to fallback scenarios, `test:integration:ps` covers SDK path, regression for v1.6 board JSON fixture, `.gitattributes` for cross-OS fingerprint stability.
- **Phase 37 — Runtime fallback hardening + collapse:** rename `gsd-runtime.mjs` → `gsd-runtime-fallback.mjs`; remove `completedRoadmapPath` mtime scraping; loud `[fallback runtime=…]` stderr; parity unit test; `aof boards milestone create` handoff implementation.
- **Phase 38 — Doctor / observability / closeout:** `aof boards doctor` end-to-end ladder; lock state records SDK + tools versions; Windows-specific checks (node-on-PATH, UNC warning, BOM); milestone audit + archive.

**Ordering:** 33 → (34, 37 in parallel) → 35 → 36 alongside all → 38 closes. Phase 36 (tests) runs concurrent with every phase, not as a final pass.

---

## Open Questions for Phase 33

- Does `glittercowboy`'s `@gsd-build/sdk@0.1.0` share the same `gsd-tools.cjs` JSON contract as `get-shit-done-cc@1.42.2`'s bundled `gsd-tools.cjs`? Verifiable by diffing the two bundled `gsd-tools.cjs` files; informs whether AOF needs to ship a vendored `gsd-tools.cjs` or rely on the user-installed one.
- Should `binding.fingerprint` be exposed in `validateBoards` as a `BOARD_MILESTONE_DRIFT` diagnostic? Recommend yes (cheap, surfaces drift early).
- `aof boards milestone create` UX while deferred: silent no-op with instructions vs hidden until v1.8? Recommend visible-with-instructions (forward-compat signal).
- Lock state schema extension: can `.aof/lock/packages.json` add `sdkVersion` + `toolsVersion` without a separate schema migration? Depends on v1.1 Phase 9's framework lock metadata decision.
