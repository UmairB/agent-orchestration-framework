# Architecture Research: AOF v1.7 Typed GSD SDK Backend

**Researched:** 2026-05-16
**Confidence:** HIGH (grounded in direct reads of `src/` files + `@gsd-build/sdk@0.1.0` `.d.ts`)

---

## Summary

The v1.6 board surface is already shaped correctly for the v1.7 cut: `src/boards.mjs` is the single owner of `BOARD.json`, and every GSD interaction is funnelled through one module (`src/gsd-runtime.mjs`) plus three call sites (`src/cli.mjs`, `src/setup-ui.mjs`, indirectly `src/board-execution.mjs`). The clean integration is:

1. Introduce `src/gsd-sdk-adapter.mjs` as a typed seam around `@gsd-build/sdk`'s `GSD` + `GSDTools` (module-of-functions, matching `src/frameworks.mjs` / `src/packages.mjs` style).
2. Introduce `BoardBackend` in `src/backends/index.mjs` as a capability interface; ship a `gsd-backend.mjs` implementation that wraps the adapter.
3. Replace `parseRoadmapPhases` regex scraping in `src/boards.mjs` with `analyzeGsdRoadmap` + `listMilestonePhases` SDK calls.
4. Collapse `src/gsd-runtime.mjs` to fallback-only (rename to `src/gsd-runtime-fallback.mjs`) for interactive Claude/Codex milestone Q&A.

The key seam is **identity, not execution**: `GSDTools.roadmapAnalyze()` + `stateLoad()` give typed milestone + phase identity that current code derives by regex-scraping `.planning/ROADMAP.md` (`src/boards.mjs:635-660`). UI work is **deferred to v1.8**.

---

## New Components

### `src/gsd-sdk-adapter.mjs` — typed SDK wrapper

**Shape: module of pure exported async functions (NOT a class).** Matches `src/frameworks.mjs`, `src/packages.mjs`, `src/adapters.mjs`. The SDK's `GSDTools` class is instantiated *inside* each adapter function and discarded — no per-call state to retain.

**Proposed exports:**
```javascript
export async function loadGsdState(projectDir);           // wraps GSDTools.stateLoad()
export async function analyzeGsdRoadmap(projectDir);      // wraps GSDTools.roadmapAnalyze()
export async function assertMilestone(projectDir, milestoneId);
                       // throws GsdSdkError(MILESTONE_NOT_FOUND|MISMATCH|NOT_ACTIVE)
export async function listMilestonePhases(projectDir, milestoneId);
export function gsdSdkVersion();                          // drift between bundled SDK and gsd-sdk CLI
export class GsdSdkError extends Error { /* code, milestoneId, ... */ }
```

The full `GSD` class (with `executePlan`, `runPhase`, `run`) is *only* instantiated by execution-mode operations, which are deferred. Single-file module is sufficient.

### `src/backends/` — interface and registry

New directory. Three files:
- `src/backends/index.mjs` — exports `BACKEND_REGISTRY`, `resolveBackend(name)`, `BackendError`, JSDoc-typed `BoardBackend` contract.
- `src/backends/gsd-backend.mjs` — v1 implementation; thin composition over `src/gsd-sdk-adapter.mjs`.
- `src/backends/null-backend.mjs` — test-only stub; replaces the `AOF_TEST_GSD_RUNTIME_STATUS` env-var fork for unit testing.

**Why a folder, not a file inside `boards.mjs`:** the interface has multiple consumers (`boards.mjs`, `board-execution.mjs`, `cli.mjs::boardsDoctorCommand`). Co-locating it with one consumer couples the contract.

---

## Modified Components

### `src/boards.mjs`
- **Remove** `parseRoadmapPhases` (635-660) and `nextBoldValue` (653-660).
- **Rename** `syncBoardFromGsdRoadmap` → `syncBoardFromMilestone(projectDir, boardId, { milestoneId, dryRun })`. Internally calls `resolveBackend(board.executionProvider ?? "gsd").syncBoardFromMilestone(...)`.
- **Modify** `createBoard` / `repairBoard`: stop hard-coding `milestone.invocation = "$gsd-new-milestone …"`. Write `binding.status = "pending-attachment"`; let `cli.mjs` print next-step text. Slash command strings move to `gsd-runtime-fallback.mjs`.
- **Modify** `attachBoardMilestoneRoadmap` (252-295): call `backend.assertMilestone(projectDir, milestoneId)` *before* writing BOARD.json so drift fails loud at attach time.
- **Add fields** under `board.gsd.milestone.binding`: `{ status: "unattached"|"pending-attachment"|"attached"|"drift"|"synced", sdkVersion, driftReason?, fingerprint }`.
- **Modify** `addTask` gate (297): predicate switches from `milestone.status !== "synced"` to `binding.status !== "synced"`.
- **Modify** `validateBoards`: add `BOARD_MILESTONE_UNATTACHED` (warning) and `BOARD_MILESTONE_DRIFT` (error) diagnostic codes.

**Unchanged in `boards.mjs`:** `BOARD_STATUSES`, `boardWorkspacePaths`, `listBoards`, `getBoard`, `archiveBoard`, `removeBoard`, `moveTask`, `editTask`, `updateTask`, `writeBoardIndex`, `readBoardIndex`, `loadBoardIndexOrBuild`, `buildBoardIndex`, `canonicalFingerprint`. BOARD.json schema stays at `version: 1` (additive keys only).

### `src/cli.mjs`
The CLI surface for `aof boards sync <board-id> --milestone <milestone-id>` is already correct at `cli.mjs:268-287` — it parses and requires `--milestone`. Only the underlying function call changes.

- Line 18 import: `syncBoardFromGsdRoadmap` → `syncBoardFromMilestone`.
- Line 21 import: move `continueGsdMilestone` to lazy import inside fallback branches of `boardsCreateCommand` (187), `boardsMilestoneAnswerCommand` (359).
- `boardsCreateCommand` (161-194): stop auto-invoking `continueGsdMilestone` for Claude (186-192). Print `aof boards milestone attach …` next-step instead.
- `boardsRepairCommand` (289): same — emit attach instruction; do not spawn.
- **New subcommand:** `aof boards doctor [<board-id>]` calls `gsdSdkVersion()` and reports drift, next to `validateBoards`.
- **Placeholder subcommand:** `aof boards milestone create <board-id> --milestone <id>` prints "run `$gsd-new-milestone` then `aof boards milestone attach`" (single-call SDK milestone runner is deferred).

**Option parsing pattern:** existing generic `parseOptions(args)` already handles `--milestone` correctly. No new parser work needed.

### `src/board-execution.mjs`
- `gsdCommands(phase)` (196): keep hard-coded `$gsd-discuss-phase`/`$gsd-plan-phase`/`$gsd-execute-phase` strings (still needed for fallback) but additionally record `backendPlan: { provider: "gsd", phase, runner: "sdk-deferred" }` in `executions/<task-id>.json`.
- `assignTaskToAgent` (35): replace `provider !== "gsd"` literal check with `const backend = resolveBackend(provider); if (!backend.capabilities.has("assignTask")) throw …`.
- No change to `executions/<task-id>.json` shape.

### `src/board-breakdown.mjs`
**No structural change.** `createBreakdownProposal` and `generatedTasks` don't touch GSD. `proposalRefs` references `.planning/ROADMAP.md` as a string artifact — stays as-is.

### `src/gsd-runtime.mjs` → `src/gsd-runtime-fallback.mjs`
**Decision: deprecate-in-place, do not delete.** Runtime CLIs become fallback-only. The file remains the only path for interactive `aof boards milestone answer`.

- Rename file to make role explicit.
- Keep `continueGsdMilestone`, `claudeGsdMilestoneCommand`, `codexGsdMilestoneCommand`, `resolveGsdMilestoneEntrypoint`, `classifyGsdMilestoneStatus`.
- **Remove** `completedRoadmapPath` (208) — mtime scraping of `.planning/ROADMAP.md` is the brittle behavior the SDK replaces. Callers that need "did GSD finish?" now call `loadGsdState(projectDir)`.

### `src/setup-ui.mjs`
- Line 7 import swap: `syncBoardFromGsdRoadmap` → `syncBoardFromMilestone`.
- Line 192 route `PUT /api/boards/:id/sync`: payload unchanged (already passes `item.milestone`); response gains `binding` + `sdkVersion` nested fields.
- Lines 150-163 board-create route: stop auto-invoking `continueGsdMilestone`; return `nextStep` field instead.
- Lines 119-129 `/api/boards/validate`: passes through new diagnostic codes automatically.
- **No new routes.** No SSE/WebSocket plumbing for SDK events (deferred to v1.8).

---

## Unchanged Components

| File | Why |
|------|-----|
| `bin/aof.mjs` | Thin 7-line shim over `src/cli.mjs:run`. |
| `src/adapters.mjs` | Rendering layer; orthogonal to backend abstraction. |
| `src/dsl.mjs` | No config schema change. |
| `src/frameworks.mjs` | GSD package install stays via `get-shit-done-cc@latest`; the SDK is a direct npm dep on AOF, not an AOF-managed package. |
| `src/packages.mjs` | Package descriptors unchanged. |
| `src/fs.mjs`, `src/workspace.mjs`, `src/model.mjs`, `src/lock.mjs` | No model-level changes. |
| `ui/src/main.tsx` | Display of `binding.*` fields deferred to v1.8. |

---

## BoardBackend Interface (concrete sketch)

Capability-style interface, JSDoc-typed. **Read state + assert identity + mutate** — execution stays in `board-execution.mjs` and the fallback runtime.

```javascript
// src/backends/index.mjs

/**
 * @typedef {object} BoardBackend
 * @property {string} name                                // "gsd"
 * @property {() => Promise<{version, drift, driftReason?}>} version
 *
 * // Read-only state
 * @property {(projectDir) => Promise<BackendState>} loadState
 * @property {(projectDir) => Promise<BackendRoadmap>} analyzeRoadmap
 * @property {(projectDir, milestoneId) => Promise<BackendPhase[]>} listMilestonePhases
 *
 * // Identity assertions (throw BackendError on mismatch)
 * @property {(projectDir, milestoneId) => Promise<BackendMilestone>} assertMilestone
 *
 * // Mutations
 * @property {(projectDir, boardId, {milestoneId, roadmapPath}) => Promise<Board>} attachMilestone
 * @property {(projectDir, boardId, {milestoneId, dryRun}) => Promise<SyncResult>} syncBoardFromMilestone
 *
 * // Forward-compat capability flags
 * @property {Set<string>} capabilities
 */

export class BackendError extends Error {
  constructor(code, message, context) { super(message); this.code = code; this.context = context; }
}

export function resolveBackend(name = "gsd") {
  const backend = BACKEND_REGISTRY[name];
  if (!backend) throw new BackendError("BACKEND_UNKNOWN", `Unknown backend "${name}"`);
  return backend;
}

export const BACKEND_REGISTRY = {
  gsd: gsdBackend,
  null: nullBackend   // tests only
};
```

**Consumers:**
1. `src/boards.mjs::syncBoardFromMilestone` → `backend.syncBoardFromMilestone(...)`
2. `src/boards.mjs::attachBoardMilestoneRoadmap` → `backend.assertMilestone(...)` then `backend.attachMilestone(...)`
3. `src/board-execution.mjs::assignTaskToAgent` → `backend.capabilities.has("assignTask")`
4. `src/cli.mjs::boardsDoctorCommand` → `backend.version()`

**Why `capabilities: Set<string>`:** a future backend can declare partial support without forcing every method to be implemented. Pattern borrowed from `frameworks.mjs:65`.

---

## Data Flow

### v1.7 sync flow
```
aof boards sync <id> --milestone <milestone-id>
   |
cli.mjs::boardsSyncCommand                     (parses --milestone)
   |
boards.mjs::syncBoardFromMilestone(projectDir, id, {milestoneId})
   |
   |- reads BOARD.json
   |- const backend = resolveBackend(board.executionProvider ?? "gsd")
   |- await backend.assertMilestone(projectDir, milestoneId)         <- SDK call
   |     -> gsd-backend.mjs -> gsd-sdk-adapter.mjs::assertMilestone
   |        -> new GSDTools({projectDir}).stateLoad()
   |        -> new GSDTools({projectDir}).roadmapAnalyze()
   |        -> throws GsdSdkError(MILESTONE_NOT_FOUND|MISMATCH)
   |- await backend.listMilestonePhases(projectDir, milestoneId)     <- SDK call
   |- for each phase: addTask(...)  (unchanged storage layer)
   |- writes BOARD.json with binding.status="synced", binding.sdkVersion
```

### State location decisions

| State | Lives in | Why |
|-------|----------|-----|
| Board identity, tasks | `.aof/boards/<id>/BOARD.json`, `tasks/*.json` | AOF owns. Unchanged. |
| Milestone binding (id, status, sdkVersion, driftReason, fingerprint) | `BOARD.json` under `gsd.milestone.binding` | AOF's view of which milestone the board points at. |
| Milestone status, phase definitions | GSD's `.planning/state.json` and `.planning/ROADMAP.md` via SDK | GSD owns. AOF reads, never writes. |
| Execution attempts/logs | `.aof/boards/<id>/executions/<task-id>.json` | AOF owns. Unchanged. |

**`.planning/STATE.md` is GSD-owned — AOF never writes to it.** AOF reads `.planning/state.json` through `GSDTools.stateLoad()` and projects a binding fingerprint into BOARD.json.

### Sync semantics
- **Best-effort** (no rollback if `addTask` fails mid-loop — preserves v1.6 behavior).
- **Transactional within BOARD.json**: `binding.status = "synced"` writes *after* all task files succeed, so re-runs are safe.
- **Synchronous** from caller's perspective. No event streaming in v1.7.
- `binding.fingerprint` is a short hash of `analyzeRoadmap()` output for that milestone; enables cheap drift detection.

---

## UI Scope Decision — DEFERRED to v1.8

**v1.7 UI scope: zero new components, zero new routes, two new display fields.**
- `BoardSummary.gsd.milestone` type in `ui/src/main.tsx:103` gains `binding?: { status, sdkVersion, driftReason? }`.
- Display strings already render `milestone.status` (530-531); change to `milestone.binding?.status ?? milestone.status` is one line.
- **No SSE/WebSocket plumbing in `setup-ui.mjs`.** SDK-event-streamed UI is explicitly out of scope. Adding event streaming would require new server transport code not present today.
- No new "milestone unattached" banner — existing `setMessage(...)` toast pattern handles it.

**Why defer:** the backend abstraction is the load-bearing v1.7 change. Shipping UI surface before the interface settles risks rework.

---

## Suggested Build Order

Five phases. Serial 1 → 2 → 3 is mandatory. Phases 4 and 5 *can* run in parallel.

### Phase 1 — `src/gsd-sdk-adapter.mjs` + SDK dependency wiring
- Add `@gsd-build/sdk@0.1.0` to `package.json` (pin exact, pre-1.0).
- Export the five typed functions + `GsdSdkError`.
- Unit tests for error normalization and drift detection.
- **Why first:** pure addition, no existing code modified, lowest risk. Everything else depends on it.

### Phase 2 — `src/backends/` interface + gsd-backend wrapper
- Define `BoardBackend` (JSDoc), `BackendError`, `resolveBackend`, `BACKEND_REGISTRY`.
- `gsd-backend.mjs` composes the adapter; `null-backend.mjs` for tests.
- **Why second:** Phase 3 needs it. Still pure addition.

### Phase 3 — `src/boards.mjs` migration + new BOARD.json fields
- Rename `syncBoardFromGsdRoadmap` → `syncBoardFromMilestone`; route through backend.
- Remove `parseRoadmapPhases`. Add `binding.*` fields. Add new diagnostic codes.
- Stop spawning slash commands from `createBoard`/`repairBoard`.
- **Why third:** affects every board test. Highest-risk phase.

### Phase 4 — CLI wiring + `gsd-runtime.mjs` collapse
- `cli.mjs` calls new function names, stops auto-spawning, adds `aof boards doctor`.
- Rename `gsd-runtime.mjs` → `gsd-runtime-fallback.mjs`, remove `completedRoadmapPath`.
- `setup-ui.mjs` import updates.

### Phase 5 — Verification hardening + v1.7 closeout
- End-to-end BDD: create → attach → sync → repair flow + `aof boards doctor` with simulated drift.
- `board-execution.mjs::assignTaskToAgent` gains capability check.
- Documentation updates.

**Why NOT adapter + lifecycle in parallel:** the `BoardBackend` interface (Phase 2) is the load-bearing contract. Running Phase 3 in parallel forces both to discover seams simultaneously.

---

## Key Anti-Patterns to Avoid

1. **`BoardBackend` typedef inside `boards.mjs`** — couples interface to one consumer. Put it in `src/backends/index.mjs`.
2. **Class-based `GsdSdkAdapter`** — mismatches every other AOF module. Module-of-functions, projectDir as first arg.
3. **Slash-command strings stored in BOARD.json** — `boards.mjs` becomes runtime-aware. Move presentation text to `cli.mjs`.
4. **Importing `@gsd-build/sdk` from `cli.mjs`** — bypasses the backend interface. SDK imports live only in `src/gsd-sdk-adapter.mjs`.

---

## Integration Points

| External Service | Pattern | Notes |
|---|---|---|
| `@gsd-build/sdk@0.1.0` | Direct npm dep; `new GSDTools({projectDir})` per call inside adapter | Pre-1.0; pin exact. Surface SDK/CLI drift via `gsdSdkVersion()`. |
| `gsd-tools.cjs` (via SDK) | Indirect — SDK shells out to `~/.claude/get-shit-done/bin/gsd-tools.cjs` | AOF must not invoke `gsd-tools.cjs` directly. Adapter normalizes `GSDToolsError` to `GsdSdkError("GSD_TOOLS_MISSING")` with a fix hint. |
| Claude/Codex CLIs | Fallback only via `gsd-runtime-fallback.mjs` | Used for `aof boards milestone answer` interactive Q&A; NOT used by sync. |

| Internal Boundary | Communication | Notes |
|---|---|---|
| `cli.mjs` ↔ `boards.mjs` | Function calls (existing) | No change. |
| `boards.mjs` ↔ `backends/index.mjs` | `resolveBackend(name).method(...)` | **New seam.** String `executionProvider` becomes registry lookup. |
| `backends/gsd-backend.mjs` ↔ `gsd-sdk-adapter.mjs` | Function calls | Adapter is SDK isolation layer. |
| `gsd-sdk-adapter.mjs` ↔ `@gsd-build/sdk` | `new GSDTools({projectDir})` per call | **Only place** that imports from the SDK. |
| `setup-ui.mjs` ↔ `boards.mjs` / `board-execution.mjs` | Function calls (existing) | No change — handlers stay thin pass-throughs. |
| `ui/src/main.tsx` ↔ `setup-ui.mjs` | HTTP/JSON (existing) | Response shapes additively extended with `binding.*`. |

---

## Open Questions

- **How does `assertMilestone` resolve a milestone id?** SDK's `RoadmapAnalysis` exposes `phases[]` but not `milestones[]`. Likely needs `GSDTools.stateLoad()` to return current milestone identifier, then `roadmapAnalyze` for phase-set comparison. May require `GSDTools.exec("state", ["milestone-id"])`. Worth a Phase 1 spike against a live `.planning/state.json`.
- **Should `binding.fingerprint` be exposed in `validateBoards`?** Drift detection runs cheaply on `aof boards validate` if so. Recommend yes, as a `BOARD_MILESTONE_DRIFT` diagnostic.
- **`aof boards milestone create` placeholder UX** — should the deferred command silently no-op with instructions, or be hidden from `--help` until v1.8 implements it? Recommend visible-with-instructions (forward-compat signal).
