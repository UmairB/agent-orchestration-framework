---
phase: 41
name: Boards UI Dogfood
status: ready_for_planning
gathered: 2026-05-22
mode: self_discuss
---

# Phase 41: Boards UI Dogfood - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Start `aof boards ui` against the live `coordination` board, verify every boards API endpoint returns data consistent with CLI output and canonical board files, perform at least one round-trip task status mutation through the API, and catch any defects in the server-side or TypeScript surface. Visual browser testing is documented as evidence notes rather than automated; all programmatic verification uses the HTTP API on port 4188.

</domain>

<decisions>
## Implementation Decisions

### UI Verification Strategy (Browser vs API vs Programmatic)
- **D-01:** The boards UI cannot be tested in a headless browser during phase execution. All programmatic verification targets the boards HTTP API (`/api/boards/*` on port 4188). Start `aof boards ui --port 4187 --api-port 4188` as a background process, run all verification steps via `curl` or `node fetch` against the live API, then kill the process.
- **D-02:** `npm run ui:build` is mandatory to confirm there are no TypeScript compilation errors in the UI source. It does not run the server — run it before or after the live API verification wave.
- **D-03:** Browser-only behaviors (kanban column layout, drag-to-move visual feedback, card expansion) cannot be verified programmatically. Document them as "UI-ONLY — requires manual browser session" in the evidence file. Do NOT fabricate pass status for visual-only behaviors.
- **D-04:** The boards API verification must cover all HTTP routes exercised by `BoardsPanel`: `PUT /api/boards/index`, `GET /api/boards`, `GET /api/boards/agents`, `GET /api/boards/validate`, `GET /api/boards/coordination`, `GET /api/boards/coordination` (tasks included), and execution sub-routes. Each response must be captured and compared against CLI output.

### Which Tasks To Mutate For UI-03
- **D-05:** Test task status mutation via `PUT /api/boards/coordination/tasks/phase-41/status` only. The `phase-41` task is the current dogfood subject; it is already `in_progress` and is the safest mutation target because it won't corrupt upstream (done) or downstream (upcoming) task histories.
- **D-06:** Round-trip test: move `phase-41` → `blocked` via API, verify canonical `.aof/boards/coordination/tasks/phase-41.json` is updated, then move it back → `in_progress`. The final state of `phase-41` MUST be `in_progress` after the test to preserve board integrity.
- **D-07:** Do NOT move phase-42 or phase-43 tasks during Phase 41. Those tasks are `ready` and belong to Phase 42 assignment UAT. Do NOT test task assignment through the UI in this phase — that is Phase 42 scope.

### Execution State Handling
- **D-08:** Phase-41 has `execution.status: "running"` with a live execution record. The UI displays this via `GET /api/boards/coordination/tasks/phase-41/execution`. Verify this endpoint returns the correct execution JSON consistent with `.aof/boards/coordination/executions/phase-41.json`. Do NOT call `PUT .../execution` or `.../execution/gate` — those would corrupt the running execution record.
- **D-09:** The EventSource SSE stream at `GET .../execution/events?stream=true` should NOT be connected during programmatic verification. Call `GET .../execution/events` (non-streaming) instead to confirm the event list is readable. This is safe for a live execution.

### Sync Phases Button API Behavior
- **D-10:** The board is already in `status: "synced"` at phase start. Test `PUT /api/boards/coordination/sync` with `{ "milestone": "v1.8" }` from the API. The expected result is `{ ok: true, created: [], updated: [], phases: [5 phases] }` — no tasks created, no state reset. If sync corrupts board state or throws an error, log as a new UAT finding. This verifies the UI's "Sync Phases" button behavior on an already-synced board.

### Defect Triage: Fix in Phase 41 vs Defer to Phase 43
- **D-11:** Fix in Phase 41 if the defect: (a) is reproducible via HTTP API call, (b) is a TypeScript compilation error, or (c) causes a mismatch between API data and CLI/canonical file data. Any fix must be followed by `npm run ui:build` and `npm test`.
- **D-12:** Defer to Phase 43 if the defect: (a) is only observable in a browser, (b) is a layout/styling issue, or (c) is already an open UAT finding (e.g., UAT-01). Log deferred defects in `39-UAT-LOG.md` with Phase 41 as the discovery phase.
- **D-13:** UAT-01 (re-attach silently resets sync state) is already tracked. Do NOT re-investigate or re-log it in Phase 41 unless it surfaces as a new symptom in the UI surface.

### Evidence File Structure
- **D-14:** Capture all API verification output in `.planning/phases/41-boards-ui-dogfood/41-UI-EVIDENCE.md`. Structure: one section per API endpoint tested, each containing the curl invocation, response body (trimmed if long), CLI counterpart where applicable, and a pass/fail verdict. The Sync Phases round-trip and task status mutation round-trip each get their own dedicated sections.
- **D-15:** Any new UAT findings discovered in Phase 41 are added to the milestone-wide log at `.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/39-UAT-LOG.md` (not a new file). Use sequential IDs continuing from UAT-01.

### Claude's Discretion
- Port choice: use `--port 4187 --api-port 4188` to avoid collision with the assets UI (4177/4178). If those ports are in use, pick any free ports and document the substitution in the evidence file.
- Server startup wait: after starting the background process, wait up to 5 seconds (or poll until `GET /api/boards` responds) before beginning verification.
- Tool for HTTP calls during execution: prefer `node` fetch scripts inline or PowerShell `Invoke-RestMethod` on Windows; `curl` if available. The goal is a single reproducible command per endpoint.
- Whether to test `GET /api/boards?archived=true`: yes — verify it returns an empty archived list (no boards should be archived at baseline).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Board State (Live)
- `.aof/boards/coordination/BOARD.json` — Canonical board. `status: "synced"`, milestone `v1.8`, 5 phase tasks. API responses must match this file.
- `.aof/boards/coordination/tasks/phase-41.json` — The mutation test target. Must be `in_progress` before and after the round-trip test.
- `.aof/boards/coordination/executions/phase-41.json` — Running execution record. Must not be modified by any API call in this phase.

### UAT Log
- `.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/39-UAT-LOG.md` — Milestone-wide finding tracker. Add new Phase 41 findings here. Currently has UAT-01 open.

### Boards UI Source
- `src/setup-ui.mjs` — All `/api/boards/*` route handlers. The implementation source for what API responses the UI sends.
- `ui/src/main.tsx` — `BoardsPanel` and `BoardsApp` components. `BoardsPanel` calls the full set of boards API endpoints on load and mutation.
- `ui/src/components/ui/kanban.tsx` — Kanban primitive. `KanbanProvider` / `KanbanBoard` / `KanbanCards` / `KanbanCard`.

### Board Implementation
- `src/boards.mjs` — `listBoards`, `getBoard`, `validateBoards`, `syncBoardFromGsdRoadmap`, `repairBoard`, `archiveBoard`, `addTask`, `editTask`, `moveTask`.
- `src/board-execution.mjs` — `listBoardAgents`, `readTaskExecution`, `readTaskExecutionEvents`, `assignTaskToAgent`, `updateTaskExecution`.

### Phase Requirements
- `.planning/REQUIREMENTS.md` — UI-01, UI-02, UI-03, UI-04 (all Pending). Phase 41 marks all four complete.

### Phase Roadmap
- `.planning/ROADMAP.md` — Phase 41 success criteria.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BoardsPanel` (`ui/src/main.tsx:490`) — Full boards UI component. On mount: `PUT /api/boards/index`, `GET /api/boards`, `GET /api/boards/agents`, `GET /api/boards/validate`, `GET /api/boards/{id}`.
- `syncBoardFromRoadmap()` (`ui/src/main.tsx:564`) — Calls `PUT /api/boards/{id}/sync` with `{ milestone: board.gsd?.milestone?.id }`. The safe idempotent path for an already-synced board.
- `moveTask()` (`ui/src/main.tsx:623`) — Calls `PUT /api/boards/{id}/tasks/{taskId}/status` with `{ status }`. The UI-03 mutation path.
- `visibleBoardColumns()` / `visibleBoardStatus()` — Column filtering logic that determines what columns GSD-backed boards show. Downstream: `kanbanColumns` array passed to `KanbanProvider`.

### Established Patterns
- Boards UI starts on port 4187 (UI static files) / 4188 (API): `aof boards ui --port 4187 --api-port 4188`.
- `VITE_AOF_UI_MODE=boards` is injected by the server; the UI reads `getUiMode()` (`ui/src/main.tsx:2286`) to route to `BoardsApp` vs the assets editor.
- API returns `{ ok: true, ... }` on success, `{ ok: false, error: "...", code: "..." }` on failure — same pattern as CLI `--json`.
- All board file writes go through `src/fs.mjs` atomic write (temp file + rename), so a failed write won't corrupt the canonical JSON.

### Integration Points
- The API server (`src/setup-ui.mjs`) must be running for any `/api/boards/*` calls. There is no mock layer.
- `src/boards.mjs` functions are called directly by the API routes — no adapter layer.
- Port 4188 is the API server. Port 4187 serves the compiled Vite bundle (or proxies to Vite dev server in dev mode). For verification, we only need port 4188 (API) — we do not need to serve the static bundle.
- The `aof boards ui` command uses `--api-port` to tell the UI which API port to proxy to in the built bundle. For programmatic API verification, skip the static UI and call port 4188 directly.

</code_context>

<specifics>
## Specific Ideas

- Wave 1: `npm run ui:build` to confirm TypeScript compilation clean. Capture any errors as immediate findings.
- Wave 2: Start `aof boards ui` background process, verify all `BoardsPanel` mount API calls return consistent data, compare against CLI baseline and BOARD.json.
- Wave 3: Sync round-trip — call `PUT /api/boards/coordination/sync`, verify idempotent response, verify board file unchanged.
- Wave 4: Task status mutation round-trip — move `phase-41` to `blocked` and back to `in_progress` via API, verify canonical file each time.
- Wave 5: Execution state read — call `GET /api/boards/coordination/tasks/phase-41/execution` and `GET .../execution/events`, verify against canonical execution file.
- Wave 6: Write evidence file, update UAT log for any new findings, mark UI-01 through UI-04 Complete in REQUIREMENTS.md.

</specifics>

<deferred>
## Deferred Ideas

- Browser drag-and-drop kanban testing — requires a real browser; defer to manual observation note in evidence file.
- Agent assignment through the UI (Phase 42 scope).
- Execution status updates through the UI (Phase 42 scope).
- UAT-01 fix (re-attach state-reset warning) — Phase 43 scope.
- Board create / archive flows via the UI — out of scope for Phase 41 dogfood unless a defect surfaces naturally.
- EventSource SSE streaming live test — cannot be verified safely while execution is running; log as a "browser-only" observation note.

</deferred>

---

*Phase: 41-Boards-UI-Dogfood*
*Context gathered: 2026-05-22*
