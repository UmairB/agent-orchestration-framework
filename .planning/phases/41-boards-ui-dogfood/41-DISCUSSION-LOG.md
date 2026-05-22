---
phase: 41
name: Boards UI Dogfood
mode: self_discuss
gathered: 2026-05-22
---

# Phase 41 Discussion Log

**Mode:** Self-discuss (no user present — AI reasoned through gray areas)
**Date:** 2026-05-22

## Gray Areas Analyzed

### Area 1: UI Verification Strategy

**Question:** How do we verify the boards UI without interactive browser testing?
**Options considered:**
- Browser testing only (manual) — no programmatic coverage
- API-only verification without starting the server — no real integration
- Start server, verify HTTP API programmatically + document browser-only behaviors — chosen

**Decision:** Start `aof boards ui` as a background process, verify all `BoardsPanel` mount API routes via HTTP on port 4188, compare against CLI and canonical file baseline. Browser-only behaviors (drag-and-drop, visual layout) are documented as observation notes rather than automated assertions. `npm run ui:build` provides TypeScript compilation coverage.

**Rationale:** The boards UI server IS the integration surface. Calling the API against a live server gives us real integration coverage without a browser, and catches server-side bugs. `npm run ui:build` catches TypeScript bugs in the UI components.

---

### Area 2: Which Tasks To Mutate For UI-03

**Question:** Which task should we move to verify status changes persist to canonical files?
**Options considered:**
- Create a disposable test task — extra setup/teardown complexity
- Move phase-41 (currently in_progress) — already the active dogfood task, safest mutation target
- Move phase-42 or phase-43 (ready) — could interfere with Phase 42 assignment UAT

**Decision:** Use phase-41 as the mutation target. Move it to `blocked` and back to `in_progress`. Final state must be `in_progress` to preserve board integrity for Phase 42.

**Rationale:** Phase-41 is already the active dogfood task. Moving it round-trip demonstrates write-through persistence without risking upcoming tasks' states. The board stays in a clean state after the test.

---

### Area 3: Defect Triage Threshold

**Question:** Which UI defects do we fix in Phase 41 vs defer to Phase 43?
**Options considered:**
- Fix everything found — too broad; visual bugs need a browser to reproduce reliably
- Defer everything — defeats the purpose of dogfood UAT
- Fix API-level and TypeScript errors in Phase 41; defer visual/layout defects to Phase 43 — chosen

**Decision:** Fix in Phase 41 if reproducible via HTTP API or TypeScript compilation. Defer pure visual/browser-only defects to Phase 43. Add any deferred defects to the milestone UAT log.

**Rationale:** Programmatic reproducibility is the line. An API mismatch is a concrete, testable bug. A visual artifact requires a browser and belongs in a dedicated UI audit pass (Phase 43 closeout).

---

### Area 4: Execution State Safety

**Question:** How do we verify phase-41 execution state display without corrupting the running execution record?
**Options considered:**
- Read execution events via streaming SSE — risky during a live execution
- Read non-streaming execution events endpoint — safe read-only
- Skip execution state verification — too narrow; it's part of UI-02

**Decision:** Call `GET /api/boards/coordination/tasks/phase-41/execution` and `GET .../execution/events` (non-streaming). Do NOT write to any execution sub-routes.

**Rationale:** The non-streaming events endpoint is a plain JSON GET. The execution file is not modified by reads. SSE connection would consume a persistent connection and complicate the background process lifecycle.

---

### Area 5: Sync Idempotency Via API

**Question:** Should we test the Sync Phases button path via API while the board is already synced?
**Options considered:**
- Skip sync test (already tested via CLI in Phase 40) — misses UI-specific path
- Test via API against the live synced board — confirms idempotency from the UI surface

**Decision:** Yes — call `PUT /api/boards/coordination/sync` with the board already synced. Verify `{ created: [], updated: [] }` response. This confirms the UI's "Sync Phases" button is safe to click on a synced board.

**Rationale:** The UI sync button is a one-click action without confirmation dialogs. Verifying the API returns a clean idempotent response protects users who click it out of habit.

---

## Claude's Discretion Items

- Port selection: 4187/4188 (standard boards UI ports). Substitute if busy.
- HTTP tooling: PowerShell `Invoke-RestMethod` or inline node fetch script, depending on what's available.
- Server startup: poll `GET /api/boards` until 200 before beginning verification (up to 5s).
- Archived boards check: include `GET /api/boards?archived=true` to verify no boards accidentally archived.

## Deferred Ideas (Not Scope-Creep Captured)

- Browser drag-and-drop kanban testing → manual observation note only
- Agent assignment and execution flows → Phase 42
- UAT-01 fix → Phase 43
- Board create/archive via UI → not needed for dogfood unless a defect surfaces
