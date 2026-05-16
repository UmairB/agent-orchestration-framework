# Feature Research: AOF v1.7 Typed GSD SDK Backend

**Domain:** Typed-SDK adapter layer on top of an existing v1.6 board lifecycle
**Researched:** 2026-05-16
**Confidence:** HIGH for SDK surface (read the shipped `.d.ts` and existing AOF code directly); MEDIUM for upstream `QUERY-HANDLERS.md` mapping.

---

## Summary

### What changed since v1.6
v1.6 boards drive GSD via slash commands shelled to `claude`/`codex` (`src/gsd-runtime.mjs`), then detect completion by watching `.planning/ROADMAP.md` mtime and re-parsing markdown (`parseRoadmapPhases` in `src/boards.mjs`). Board↔milestone identity is implicit: `aof boards sync` re-shapes tasks from whatever ROADMAP.md happens to contain. Manual attach (`attachBoardMilestoneRoadmap`) exists but takes an unverified user-typed milestone id.

### What the installed SDK actually exposes
`@gsd-build/sdk@0.1.0` ships:
- **`GSDTools`** — typed wrappers for `stateLoad()`, `roadmapAnalyze()`, `phaseComplete()`, `commit()`, `verifySummary()`, `initExecutePhase()`, `initPhaseOp()`, `configGet()`, `configSet()`, `stateBeginPhase()`, `phasePlanIndex()`, `initNewProject()`, plus generic `exec(command, args)` / `execRaw(command, args)` shelling to `gsd-tools.cjs`.
- **`GSD`** — `executePlan(planPath)`, `runPhase(phaseNumber)`, `run(prompt)` (milestone runner), `createTools()`, `onEvent()`, `addTransport()`.
- **`GSDEventStream`** — discriminated `GSDEvent` union (`SessionInit`, `AssistantText`, `ToolCall`, `PhaseStart/Complete`, `WaveStart/Complete`, `MilestoneStart/Complete`, `CostUpdate`, etc.).
- **`InitRunner`** for new-project init; **no `MilestoneRunner`** for "create milestone from objective".
- Transports `CLITransport` / `WSTransport`; `gsd-sdk` CLI bin.
- Typed `RoadmapAnalysis { phases: RoadmapPhaseInfo[] }` and `InitNewProjectInfo`.

### What the SDK does NOT expose as typed methods (v0.1.0)
- `state.milestone-switch`, `milestone.complete`, `phase.add`, `phase.add-batch`, `init.new-milestone` are NOT typed methods. The upstream `QUERY-HANDLERS.md` describes them as registry handlers, but v0.1.0 ships no `dist/query/*` / `dist/registry/*`. Reachable today only via `tools.exec("state milestone-switch", [...])` — typed seam but still shelled out.
- Therefore "typed adapter" in v1.7 = one AOF-owned module that calls the few real typed methods, and channels the rest through `GSDTools.exec()` with explicit input/output contracts AOF owns. PROJECT.md already accepts this.

### Direct answers to orchestrator's questions

1. **Minimum SDK call set:**
   - (a) Current milestone identity → `tools.stateLoad()` returns raw `state.json`; parse `milestone:` field.
   - (b) Roadmap analysis → `tools.roadmapAnalyze()` returns typed `RoadmapAnalysis { phases }`. Replaces `parseRoadmapPhases()` in `src/boards.mjs:635`.
   - (c) Assert board↔GSD identity → compare board's stored `gsd.milestone.id` against parsed identity from `stateLoad()`. No extra call.
   - (d) Attach/create milestone for objective → no typed method in v0.1.0. AOF must (i) `stateLoad()` to detect fresh milestone need, (ii) hand off to runtime CLI fallback (`continueGsdMilestone` style) for interactive `$gsd-new-milestone`. After user finishes, `stateLoad()` again and bind resulting milestone id.
   - Bonus (future): `tools.exec("state milestone-switch", [milestoneId])` — exec-shaped, not typed.

2. **Sensible v1.7 split** — see four-tier table below.

3. **`BoardBackend` interface (minimum contract):** sync + identity + single `execute(taskId)`. Excluding execution would break v1.6's "assign agent → kick off phase" on non-GSD backends.

4. **"Fail clearly" for `aof boards sync`** mirrors `terraform plan` drift / `kubectl apply --dry-run=server`: structured `{code, expected, actual, next}` diagnostic + `--json` sibling. v1.6 names four failure modes at `src/boards.mjs:351-371` but lacks codes/JSON.

5. **SDK event streaming:** Defer to v1.8 per PROJECT.md. v1.7 win is replacing scrape-based completion detection with `runPhase().success` / typed `PhaseRunnerResult` — return-value improvement, not stream-consumer.

6. **Anti-features:** (a) don't fork/shadow GSD state, (b) don't write AOF-side milestone-creation runner the SDK hasn't shipped, (c) don't promote runtime CLI fallback to equal-weight peer.

---

## Table Stakes (Users Expect These)

### Adapter (the typed seam)

| Feature | Why Expected | Complexity | Existing AOF Code | SDK Calls |
|---|---|---|---|---|
| Single `src/gsd-sdk-adapter.mjs` owns SDK instantiation, `gsdToolsPath` resolution, version pinning | PROJECT.md mandates single typed adapter | MEDIUM | NEW; replaces direct `gsd-runtime.mjs` imports from `boards.mjs` | `new GSD({projectDir})`, `gsd.createTools()` |
| `loadGsdState(projectDir)` → typed `{milestoneId, statePresent, roadmapPresent, configPresent, raw}` | Foundation for identity assertions | LOW | Replaces ad-hoc `.planning/STATE.md` reads | `tools.stateLoad()` |
| `analyzeGsdRoadmap(projectDir)` → typed `RoadmapAnalysis` | Replaces fragile markdown regex in `boards.mjs:635-660` | LOW | Removes `parseRoadmapPhases` | `tools.roadmapAnalyze()` |
| `assertMilestone(claimedId)` → `{ok, expected, actual, code}` not throw | Enables `--json` output and tests | LOW | Replaces `throw new Error` block at `boards.mjs:353-359` | `tools.stateLoad()` |
| `syncBoardFromGsdMilestone(...)` is the only entrypoint boards code calls | Forces SDK path; removes implicit ROADMAP sync | MEDIUM | Replaces `boards.mjs:340-425`, preserves task-create idempotency | `tools.stateLoad()`, `tools.roadmapAnalyze()` |
| Pin & verify `@gsd-build/sdk` version; diagnostic when global `gsd-sdk` CLI version diverges | PROJECT.md explicit target feature | LOW | Adapter init; reads `node_modules/@gsd-build/sdk/package.json` + `gsd-sdk --version` | spawn for version check |
| Adapter is the ONLY module allowed to import `@gsd-build/sdk` or call `gsd-tools.cjs` | Keeps seam testable/replaceable; required for `BoardBackend` | LOW | `boards.mjs`, `cli.mjs`, `setup-ui.mjs` import only from adapter | n/a |

### Sync (board ↔ GSD state)

| Feature | Complexity | Existing AOF Code | SDK Calls |
|---|---|---|---|
| `aof boards sync <id> --milestone <id>` reads typed `RoadmapAnalysis`, creates one `phase-<N>` task per phase, idempotent | MEDIUM | `syncBoardFromGsdRoadmap` at `boards.mjs:340`; CLI handler `cli.mjs:268-285` | `stateLoad()`, `roadmapAnalyze()` |
| Refuse sync if `executionProvider !== "gsd"` AND `gsd.milestone.id` empty AND GSD `state.milestone` is different id | LOW | Strengthen `boards.mjs:353-359` | `stateLoad()` |
| Sync writes `gsd.milestone.phaseCount` and typed `gsd.milestone.phases[]` into BOARD.json | LOW | Extend `next.gsd.milestone` at `boards.mjs:402-411` | `roadmapAnalyze()` |
| `aof boards sync --dry-run --json` prints diff without writing | LOW | New flag path; `syncBoardFromGsdRoadmap` already accepts `dryRun` | same |
| Re-sync detects drift: phases on board but not in roadmap → warnings | MEDIUM | New drift loop after `boards.mjs:379-395` | `roadmapAnalyze()` |

### Board Lifecycle (create / repair / attach)

| Feature | Complexity | Existing AOF Code | SDK Calls |
|---|---|---|---|
| `aof boards create` with GSD provider records milestone required, status starts `waiting_for_milestone` (today: `waiting_for_user`) | LOW | Rename status in `createBoard` (`boards.mjs:21-72`) | none yet |
| `aof boards repair` re-checks GSD state via `loadGsdState()`, auto-binds matching milestone | MEDIUM | Replace runtime invocation in `repairBoard` (`boards.mjs:120-184`) | `stateLoad()` |
| `aof boards milestone attach` verifies milestone exists in GSD state | LOW | Strengthen `attachBoardMilestoneRoadmap` (`boards.mjs:252-295`); `--roadmap` becomes optional | `stateLoad()`, `configGet("planning_dir")` |
| Boards without bound GSD-confirmed milestone surface as `pending_milestone` | LOW | Extend `boardSummary` (`boards.mjs:570`) with `gsdAttached: boolean` | none |

### Backend Interface (swap-in path)

| Feature | Complexity | Existing AOF Code |
|---|---|---|
| `BoardBackend` interface (JSDoc-typed) with 5 methods: `identify()`, `currentMilestone()`, `analyzeMilestone(id)`, `bindBoard(boardId, milestoneId)`, `executeTask(boardId, taskId, opts)` | MEDIUM | NEW `src/board-backends/backend.mjs`; `gsd-sdk-adapter.mjs` → `src/board-backends/gsd.mjs` |
| GSD is the ONLY implementation in v1.7; interface exercised by `noop` test backend | LOW | Test-only `src/board-backends/test-noop.mjs` |
| `executeTask` returns `{status, runtime, exitCode, durationMs, costUsd?, error?}` matching v1.6 `task.execution` shape | LOW | Reuse `validateExecutionSummary` shape (`boards.mjs:678`) |
| Backend selection per-board via `executionProvider`, defaulting to `gsd`; other values reserved | LOW | Already enforced at `boards.mjs:628` |

### Diagnostics

| Feature | Complexity | Existing AOF Code |
|---|---|---|
| Structured error codes: `MILESTONE_MISSING_ARG`, `MILESTONE_NOT_BOUND`, `MILESTONE_ID_MISMATCH`, `MILESTONE_NOT_IN_STATE`, `MILESTONE_INCOMPLETE`, `ROADMAP_EMPTY`, `SDK_VERSION_DRIFT` | LOW | Replace string throws (`boards.mjs:351-371`) with `{code, message, expected, actual, next}` Error subclass |
| Every error includes `next:` hint with exact remediation command | LOW | Formalize existing v1.6 pattern |
| `--json` output for every `aof boards` subcommand emits structured error | LOW | Audit ~30 boards handlers in `cli.mjs` for `--json` parity |
| `aof boards doctor [<id>]` runs full assertion ladder | MEDIUM | NEW; lives next to `validateBoards` (`boards.mjs:530-568`) |
| `SDK_VERSION_DRIFT` diagnostic when CLI `gsd-sdk --version` ≠ bundled `@gsd-build/sdk` version | LOW | Adapter init |

### Execution (replacing slash-command spawn)

| Feature | Complexity | Existing AOF Code | SDK Calls |
|---|---|---|---|
| `executeTask` for phase tasks (`refs.phase`) calls `gsd.runPhase(phaseNumber)`, writes typed `PhaseRunnerResult` into `task.execution` | HIGH | Body of `continueGsdMilestone` (`gsd-runtime.mjs:99-161`) replaced for execution; milestone-creation path keeps spawn fallback | `gsd.runPhase()` |
| Runtime-CLI execution preserved ONLY as fallback for milestone-creation workflow; labeled `fallback: runtime-cli` in lock state | MEDIUM | Keep `claudeGsdMilestoneCommand` / `codexGsdMilestoneCommand` but isolate behind adapter | spawn `claude`/`codex` |
| Phase execution exits non-zero on `PlanResult.success === false`; surfaces `error.subtype` | LOW | New error mapping in adapter | `gsd.runPhase()` result |

---

## Differentiators

| Feature | Value | Complexity |
|---|---|---|
| `aof boards sync --dry-run --json` per-phase `{phaseId, action: "create"\|"keep"\|"drift"}` | v1.6 sync is create-only; drift surfacing is a real new capability | LOW |
| `aof boards doctor` ladder | One command, full pass/fail; lowers support burden | MEDIUM |
| Per-board `gsd.milestone.phases[]` cache in BOARD.json | UI no longer re-parses ROADMAP.md | LOW |
| Adapter-level `dispatchEvent` log of every `GSDTools.exec` call → `.aof/cache/boards/dispatch.log.jsonl` | Forward-compat with future SDK observability; cheap | LOW |
| `BoardBackend` interface with one fake test-noop implementation | Proves swap-ability without YAGNI second real backend | MEDIUM |

---

## Defer / Nice-to-Have (v1.8+)

| Feature | Why Defer |
|---|---|
| `GSDEventStream` → UI WebSocket transport with live `PhaseStart`, `ToolCall`, `CostUpdate` | PROJECT.md explicitly defers; requires `WSTransport` plumbing |
| Single-call `createMilestoneFromObjective(objective)` | SDK has no `MilestoneRunner`; wait for upstream |
| Second `BoardBackend` real implementation | YAGNI for v1.7 |
| `gsd.run(prompt)` full-milestone autoflight | Needs human-gate UI for `HumanGateCallbacks` |
| Typed `state.milestone-switch` when SDK promotes | Today only via `tools.exec` |
| `phase.add` / `phase.add-batch` typed wrappers | Out of v1.7 — boards consume phases, GSD authors them |
| Cost tracking per board | Requires event-stream consumption |
| `gsd-sdk query` shellouts as third path | Two seams = two bug surfaces |

---

## Anti-Features (Do NOT Build in v1.7)

| Anti-Feature | Why Problematic | Do Instead |
|---|---|---|
| Re-implement GSD's milestone/phase/state logic AOF-side | Recreates 12K-line CJS surface SDK wraps; locks AOF into shadowing GSD evolution | Use `GSDTools.exec` for missing handlers; document as exec-shaped |
| Fork or vendor `@gsd-build/sdk` to add `createMilestoneFromObjective` | Forks = permanent maintenance burden | Compose typed reads + runtime-CLI fallback; mark interactive path |
| Write AOF-side milestone-creation runner using `GSD.run(prompt)` | `GSD.run` is milestone EXECUTOR, not initializer; misuse corrupts state | Wait for SDK milestone runner; keep CLI fallback |
| Make `aof boards sync` fall back to implicit ROADMAP.md when `--milestone` missing | Exactly the silent-drift footgun PROJECT.md kills | Hard-fail with `MILESTONE_MISSING_ARG` + `next:` hint |
| Treat runtime CLI and SDK execution as equal peers | Defeats typed-seam value prop | Adapter selects SDK path automatically; runtime-CLI is internal fallback labeled in lock |
| Adopt `GSDEventStream` in v1.7 just because it exists | UI consumer isn't ready; partial adoption adds no value | Defer to v1.8; document integration plan |
| Ship `BoardBackend` with two real backends | YAGNI; stub backend distracts from GSD hardening | One real (GSD) + one test (no-op) |
| Adopt `gsd-sdk query` CLI as second integration path | Two seams = two bug surfaces | Use `GSDTools.exec` exclusively |
| Move `parseRoadmapPhases` regex into adapter as fallback when SDK fails | Masks SDK failures, defeats typed-state guarantee | Surface `ROADMAP_ANALYZE_FAILED` code |

---

## SDK Call → Feature Mapping

| AOF Feature | Adapter Method | Underlying SDK Call(s) | Typed? |
|---|---|---|---|
| Current milestone identity | `loadGsdState()` | `tools.stateLoad()` | YES + AOF-side frontmatter parse |
| Roadmap analysis | `analyzeGsdRoadmap()` | `tools.roadmapAnalyze()` | YES (`RoadmapAnalysis`) |
| Identity assertion | `assertMilestone(claimedId)` | `tools.stateLoad()` composed | YES |
| Attach board to milestone | `attachMilestone(boardId, milestoneId)` | `tools.stateLoad()` verify | YES |
| Sync board tasks | `syncBoardFromGsdMilestone(...)` | `stateLoad()` + `roadmapAnalyze()` | YES |
| Execute phase task | `backend.executeTask(...)` | `gsd.runPhase(phaseNumber)` → `PhaseRunnerResult` | YES |
| Mark phase complete | `markPhaseComplete()` | `tools.phaseComplete(phase)` | YES (string) |
| Commit results | `commitMilestoneArtifacts()` | `tools.commit(message, files?)` | YES (string) |
| Get/set config | `getConfig()`/`setConfig()` | `tools.configGet/Set` | YES |
| **New milestone (interactive)** | `startMilestoneCreation(objective)` | spawn `claude`/`codex` fallback — **no SDK runner** | NO (deferred) |
| **Switch active milestone** | `switchMilestone(id)` | `tools.exec("state milestone-switch", [id])` | exec-shaped |
| **Add a phase** | not in v1.7 | `tools.exec("phase add"/"phase add-batch")` | exec-shaped (deferred) |
| SDK version check | `assertSdkVersion()` | `require("@gsd-build/sdk/package.json").version` + spawn `gsd-sdk --version` | n/a |
| Event streaming (deferred) | n/a | `gsd.eventStream.addTransport(WSTransport)` | YES — v1.8 |

---

## Dependencies on Existing v1.6 Board Code

| New Feature | Existing Module / Function | Action |
|---|---|---|
| Adapter module | `src/gsd-runtime.mjs` (`continueGsdMilestone`, `claudeGsdMilestoneCommand`, `codexGsdMilestoneCommand`) | Move SDK calls to `src/gsd-sdk-adapter.mjs`; keep `gsd-runtime.mjs` only as milestone-creation fallback |
| Typed sync | `src/boards.mjs::syncBoardFromGsdRoadmap` (340-425) | Rewrite body to call adapter; preserve idempotency loop (379-395) and BOARD.json shape |
| Drop markdown parsing | `boards.mjs::parseRoadmapPhases` (635-651), `nextBoldValue` (653-660) | Delete after adapter uses `RoadmapAnalysis` |
| Identity assertion | `boards.mjs::syncBoardFromGsdRoadmap` (351-371) | Replace 4 `throw new Error` with `assertMilestone()` returning structured `{code, ...}` |
| Lifecycle | `createBoard` (21-72), `repairBoard` (120-184), `attachBoardMilestoneRoadmap` (252-295), `updateBoardMilestone` (186-250) | Rename status; route runtime spawn through adapter; verify `--milestone <id>` exists in GSD state on attach |
| CLI surface | `cli.mjs::boardsSyncCommand` (268-285), `boardsRepairCommand` (289-306), `boardsMilestoneCommand` cluster (308-391) | Wire `--json` parity for structured errors; new `aof boards doctor` |
| Execution | `boards.mjs::addTask` GSD-guard (301-307), `task.execution` shape | Replace runtime-spawn with adapter `executeTask`; keep `task.execution` schema (678-687) byte-compatible |
| Index/fingerprint | `boards.mjs::buildBoardIndex`, `canonicalFingerprint` (703-721) | Include `gsdAttached`, `gsd.milestone.phases[]` in fingerprint inputs |
| Validation | `boards.mjs::validateBoards` (530-568) | Add `gsd.milestone.id` shape check + `BOARD_MILESTONE_NOT_IN_GSD_STATE` warning |
| UI | `ui/src/main.tsx` | Consume `gsdAttached`, `gsd.milestone.phases[]`; surface structured error codes from `--json` |
| Tests | `test/boards.test.mjs`, `test/integration/features/boards.feature`, step files | Add `--milestone <id>` scenarios per error code; mock adapter (not `spawnSync`) |
| package.json | `package.json` | Add `@gsd-build/sdk` as direct dep (pin exact `0.1.0`) |

---

## Confidence Notes

- HIGH on installed SDK surface (read `dist/*.d.ts` directly).
- HIGH on existing AOF code touchpoints (read `boards.mjs`, `gsd-runtime.mjs`, `cli.mjs` directly).
- MEDIUM on which upstream `QUERY-HANDLERS.md` operations exist in installed v0.1.0 vs only on `main` (v0.1.0 dist ships none of `dist/query/*` etc.; reachable only via `GSDTools.exec`).
- HIGH on PROJECT.md's deferral of single-call milestone creation — no `MilestoneRunner` exists; `InitRunner` is new-project only; `GSD.run(prompt)` runs existing phases, doesn't initialize.
