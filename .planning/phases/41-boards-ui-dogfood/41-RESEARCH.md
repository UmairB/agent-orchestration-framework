---
phase: 41
name: Boards UI Dogfood
status: ready_for_planning
---

# Phase 41 Research: Boards UI Dogfood

**Gathered:** 2026-05-22

## Summary

The boards API surface is complete and all routes used by `BoardsPanel` are implemented. One confirmed API/UI data mismatch was found (`updated` field omitted from sync response). Task status round-trip for `phase-41` is safe. Execution state reads are safe (read-only). The kanban drag-and-drop surface is browser-only and cannot be verified programmatically. Wave plan from CONTEXT.md is sound with no blocking issues.

---

## Topic 1: API Route Coverage

**Confidence: HIGH**

All `/api/boards/*` routes called by `BoardsPanel` on mount and interaction are implemented in `src/setup-ui.mjs`. Complete inventory:

| API Route | Handler | Source | Used By |
|-----------|---------|--------|---------|
| `PUT /api/boards/index` | `writeBoardIndex` | `boards.mjs:642` | `refreshBoards()` — always first |
| `GET /api/boards` | `listBoards` | `boards.mjs:106` | `refreshBoards()` |
| `GET /api/boards?archived=true` | `listBoards({includeArchived:true})` | `boards.mjs:106` | Evidence check |
| `GET /api/boards/agents` | `listBoardAgents` | `board-execution.mjs:20` | `refreshBoards()` |
| `GET /api/boards/validate` | `validateBoards` | `boards.mjs:663` | `refreshBoards()` |
| `GET /api/boards/{id}` | `getBoard + readBoardTasks` | `boards.mjs:112` | `loadBoard()` |
| `PUT /api/boards/{id}/sync` | `syncBoardFromGsdRoadmap` | `boards.mjs:402` | `syncBoardFromRoadmap()` |
| `PUT /api/boards/{id}/repair` | `repairBoard` | `boards.mjs:152` | `repairBoardMilestone()` |
| `PUT /api/boards/{id}/tasks/{id}/status` | `moveTask` | `boards.mjs:541` | `moveTask()` drag-drop |
| `GET /api/boards/{id}/tasks/{id}/execution` | `readTaskExecution` | `board-execution.mjs:437` | execution panel |
| `GET /api/boards/{id}/tasks/{id}/execution/events` | `readTaskExecutionEvents` | `board-execution.mjs:442` | events list |

**Recommendation:** Cover all routes in the evidence file. All routes are reachable with a running server.

---

## Topic 2: Sync API Response Missing `updated` Field

**Confidence: HIGH — BUG**

`syncBoardFromGsdRoadmap` (`boards.mjs:538`) returns `{ board, phases, created, updated, actions, dryRun }` including `updated`.

The API route handler at `setup-ui.mjs:197` only passes through:
```js
sendJson(response, 200, { ok: true, board: result.board, phases: result.phases, created: result.created, actions: result.actions });
```

`result.updated` is **not included** in the response.

The UI's `syncBoardFromRoadmap` at `main.tsx:581` checks:
```ts
const updated = Array.isArray(payload.updated) ? payload.updated.length : 0;
```

Since `payload.updated` is `undefined`, `updated` is always `0` regardless of how many tasks were actually updated. The sync success message always reports "0 updated" even when tasks had content updates.

**Impact for Phase 41 dogfood:** The board is already synced so no tasks will be updated during the round-trip test — the message "0 updated" will be accurate by coincidence. The bug is latent and only surfaces when tasks need updates.

**Recommendation:** Fix in Phase 41 (API-level data mismatch, reproducible via HTTP). Add `updated: result.updated ?? []` to the sync API response. Must be followed by `npm test` and `npm run ui:build`.

---

## Topic 3: Task Status Move — phase-41 Round-Trip Safety

**Confidence: HIGH**

`assertTaskStatusMoveAllowed` (`boards.mjs:569`) only blocks moves to `in_progress` for GSD-backed phase tasks that have no `assignedAgent` or `execution.status`. Moves to any other status (including `blocked`) are unrestricted.

Current `phase-41` state:
```json
{
  "status": "in_progress",
  "assignedAgent": { "id": "claude", ... },
  "execution": { "provider": "gsd", "status": "running", ... }
}
```

- `in_progress → blocked`: unrestricted (no guard for `blocked` target status) ✓
- `blocked → in_progress`: allowed because `assignedAgent.id` is set ✓

The round-trip test `phase-41: in_progress → blocked → in_progress` is safe and will succeed.

**Recommendation:** Execute exactly as designed in CONTEXT.md D-05/D-06. Verify `.aof/boards/coordination/tasks/phase-41.json` on disk after each move.

---

## Topic 4: GSD Column Filtering — Expected Kanban Shape

**Confidence: HIGH**

`visibleBoardColumns` (`main.tsx:2221`) removes `"ready"` from GSD-backed board columns:
```ts
function visibleBoardColumns(columns: BoardStatus[], gsdBacked: boolean) {
  return gsdBacked ? columns.filter((status) => status !== "ready") : columns;
}
```

The `coordination` board is GSD-backed (`executionProvider: "gsd"`). The visible kanban columns will be:
**Backlog | In Progress | Blocked | Done** (4 columns)

`visibleBoardStatus` maps `"ready"` → `"backlog"` for GSD boards. Phase-42 and phase-43 tasks (which have `status: "ready"`) will appear in the Backlog column.

Current expected kanban distribution:
- **Backlog (2):** phase-42, phase-43 (both `ready` → mapped to backlog)
- **In Progress (1):** phase-41 (`in_progress`)
- **Blocked (0):** none at baseline
- **Done (2):** phase-39, phase-40 (`done`)

This is "browser-only" visual behavior — cannot be asserted programmatically. Document as observation note in evidence file.

---

## Topic 5: Agents API — Expected Response

**Confidence: HIGH**

`listBoardAgents` (`board-execution.mjs:20`) first checks `runtimeAgentsFromConfig(config)`. For the AOF project, the existing execution record for phase-41 shows:
```json
"assignedAgent": { "id": "claude", "source": "runtime" }
```

This confirms the project config has `runtimes: ["claude"]`. The agents API will return:
```json
{ "ok": true, "agents": [{ "id": "claude", "description": "claude execution runtime.", "runtimes": ["claude"], "source": "runtime" }] }
```

**Recommendation:** Verify `GET /api/boards/agents` returns exactly this shape and compare against the `assignedAgent` already recorded in `phase-41.json`.

---

## Topic 6: Server Launch Mechanism

**Confidence: HIGH**

`aof boards ui --port 4187 --api-port 4188` starts:
1. **API server** (`setup-ui.mjs`) on port `4188` — `serveSetupUi(null, { port: 4188 })`
2. **Vite dev server** on port `4187` — proxies to the API

For API-only verification, only port `4188` is needed. The Vite frontend on port `4187` is not needed and can be killed without affecting API calls.

Server binds to `127.0.0.1` only (not `0.0.0.0`). The server is ready as soon as the background process starts (Node.js HTTP `listen` is synchronous). Wait ~2s or poll `GET /api/boards` for a `200` before beginning verification.

**PowerShell invocation:**
```powershell
$proc = Start-Process -NoNewWindow -PassThru node -ArgumentList "bin/aof.mjs", "boards", "ui", "--port", "4187", "--api-port", "4188"
Start-Sleep 2
Invoke-RestMethod http://127.0.0.1:4188/api/boards  # poll
```

Kill after verification: `Stop-Process -Id $proc.Id -Force`

---

## Topic 7: Execution State — Read Safety

**Confidence: HIGH**

Phase-41 has a live execution record (`status: "running"`) with 65+ events in the JSONL log. Both read endpoints are safe:

- `GET /api/boards/coordination/tasks/phase-41/execution` → returns `phase-41.json` execution section; read-only
- `GET /api/boards/coordination/tasks/phase-41/execution/events` → reads `phase-41.events.jsonl` line-by-line; read-only

SSE streaming (`?stream=true`) must NOT be used. It opens a persistent connection and requires a browser `EventSource`. The non-streaming form returns all events as a JSON array.

**Recommendation:** Compare `GET .../execution` response against canonical `executions/phase-41.json`. Verify `events` endpoint returns an array with at least 1 entry. Do not test `PUT .../execution` or `PUT .../execution/gate`.

---

## Topic 8: Stale Temp Files

**Confidence: HIGH — INERT**

Three untracked temp files exist from a previous process crash mid-write:
```
.aof/.tmp-aof.lock.json-74856-...
.aof/.tmp-aof.lock.json-74856-...
.aof/boards/coordination/.tmp-BOARD.json-74856-...
```

These are leftover from `fs.mjs` atomic write (write temp → rename). The canonical files are intact. These files are not read by any code path. They can be cleaned up after Phase 41 but are not blocking.

**Recommendation:** Leave as-is for Phase 41. Note in evidence file. Optionally clean up in Phase 43 hardening.

---

## Topic 9: `npm run ui:build` — TypeScript Compilation

**Confidence: HIGH**

`npm run ui:build` runs Vite + TypeScript compiler over `ui/src/`. It does NOT start a server. Recent source changes to `ui/src/main.tsx` and `ui/src/components/ui/kanban.tsx` are visible in git status, so a fresh build is required to confirm there are no compile errors.

The build must run before or after the live API verification wave — the order doesn't matter since it doesn't affect server behavior.

**Recommendation:** Run as Wave 1 in the execution plan. A clean exit from `npm run ui:build` is the TypeScript coverage signal. Any errors are immediate Phase 41 findings.

---

## Topic 10: Wave Plan Validation

**Confidence: HIGH**

The wave plan from CONTEXT.md `<specifics>` is sound. No blocking dependencies or ordering issues:

| Wave | Task | Dependency | Risk |
|------|------|-----------|------|
| 1 | `npm run ui:build` | none | Low — standard build |
| 2 | Start API server, verify mount-time routes | wave 1 complete | Low — read-only |
| 3 | Sync round-trip via API | server running | Low — idempotent on synced board |
| 4 | Status mutation round-trip (phase-41) | server running | Low — safe as researched |
| 5 | Execution state read | server running | Low — read-only |
| 6 | Evidence file, UAT log, requirements update | waves 2-5 complete | None |

One fix must be applied (Topic 2 sync response bug) and followed by `npm test` + `npm run ui:build`. Insert the fix between waves 2/3 and the final verification, or include as a Wave 3a.

---

## Pre-Planning Checklist

- [x] All routes used by `BoardsPanel` are implemented
- [x] `phase-41` status round-trip is safe (`assignedAgent` + `execution` present)
- [x] Sync round-trip is idempotent (board already synced → `created: [], updated: []`)
- [x] Execution reads are safe (read-only; no SSE)
- [x] One confirmed API/UI bug to fix: sync response missing `updated` field
- [x] Temp files are inert — no action needed before execution
- [x] Browser-only behaviors documented for evidence notes
- [x] Server launch port configuration confirmed (4188 for API, 4187 for UI)

---

*Phase: 41-Boards-UI-Dogfood*
*Research completed: 2026-05-22*
