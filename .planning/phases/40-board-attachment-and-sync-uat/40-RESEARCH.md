---
phase: 40
name: Board Attachment And Sync UAT
type: research
status: complete
gathered: 2026-05-19
---

# Phase 40: Board Attachment And Sync UAT — Research

**Gathered:** 2026-05-19
**Scope:** Technical investigation of attach/sync mechanics, error paths, execution record safety, and Phase 39 straggler state. No source files modified.

---

## 1. Phase 39 Straggler State

**Confidence: HIGH**

Phase 39's execute step ran in 111 ms with `planResults: []` — no artifacts were written. Confirmed by `executions/phase-39.json` step record (`"step": "execute", "durationMs": 111, "planResults": []`).

**Missing artifacts that must be created in Phase 40 Wave 1:**

| Artifact | Destination | Spec source |
|---|---|---|
| `39-BASELINE-OUTPUT.md` | `.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/` | 39-CONTEXT.md D-05 – D-09 |
| `39-UAT-LOG.md` | `.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/` | 39-CONTEXT.md D-10 |

**Untracked files that must be committed in Wave 1** (from git status snapshot):

```
.aof/.gitignore
.aof/boards/               (entire boards directory)
.aof/skills/               (bridge skill only, not referenced in aof.config.json)
.planning/milestones/v1.7-UAT.md
.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/
scripts/uat-v1.7-legacy-board-migration.ps1
scripts/uat-v1.7-sdk-board.ps1
src/internal-skills.mjs
```

**Current live board state at Wave 1 start:**
- `BOARD.json`: `status: "synced"`, `gsd.milestone.id: "v1.8"`, `syncedAt: "2026-05-19T08:27:55.474Z"`
- All 5 tasks exist: `phase-39` through `phase-43`
- `executions/phase-39.json`: `status: "complete"` — must survive sync unchanged
- `executions/phase-40.json`: `status: "running"` — must survive sync unchanged

**Recommendation:** Run all baseline CLI captures first (read-only), write the two markdown artifacts, then commit everything in one wave-1 commit.

---

## 2. Attach Mechanism Analysis

**Confidence: HIGH** — directly verified in `src/boards.mjs:304-352`.

### What `attachBoardMilestoneRoadmap` does

1. Reads current `BOARD.json`
2. Calls `assertBoardMilestone` via the GSD SDK adapter (happy-path dependency — see §5)
3. Resolves and validates the roadmap file path
4. Writes a new `BOARD.json` with:
   - `gsd.milestone.id = milestoneId`
   - `gsd.milestone.status = "ready_to_sync"` — **unconditional reset**
   - `gsd.milestone.binding = bindingState("attached", ...)`
   - `gsd.milestone.syncedAt = null` — **unconditional clear**
   - `gsd.taskCreation.syncCommand = "aof boards sync coordination --milestone v1.8"`
   - `gsd.taskCreation.syncBlockedReason = null`

### UAT Finding: Re-attach state reset without warning

The board is currently `status: "synced"`. Running attach will silently:
- Overwrite `status` → `"ready_to_sync"`
- Clear `syncedAt` → `null`
- Overwrite `binding.status` → `"attached"`

The CLI output is only `"Attached board coordination to milestone v1.8"` with no warning about lost sync state. This is the finding identified in 40-CONTEXT.md D-04/D-05.

**Severity: medium** (re-runnable, no permanent data loss).
**Action:** Log as UAT finding in `39-UAT-LOG.md`. Do NOT fix in Phase 40; defer to Phase 43.

### Human-readable attach output (expected)
```
Attached board coordination to milestone v1.8
roadmap: .planning/ROADMAP.md
binding: attached
sync: aof boards sync coordination --milestone v1.8
```

### JSON attach output (expected)
```json
{
  "ok": true,
  "board": "coordination",
  "milestone": { "id": "v1.8", "status": "ready_to_sync", "binding": { "status": "attached", ... }, ... }
}
```

---

## 3. Sync Mechanism Analysis

**Confidence: HIGH** — directly verified in `src/boards.mjs:402-537`.

### What `syncBoardFromGsdRoadmap` does

1. Validates milestone ID presence (`MILESTONE_MISSING_ARG`)
2. Validates board has a configured milestone ID (`MILESTONE_NOT_BOUND`)
3. Validates milestone IDs match (`MILESTONE_ID_MISMATCH`)
4. Validates roadmap path is configured (`BOARD_MILESTONE_UNATTACHED`)
5. Calls `assertBoardMilestone` + `readRoadmapPhaseDetails` + `readTypedRoadmap`
6. Computes `syncActions` — classifies each phase as create/skip/drift
7. For each phase not yet in task files: calls `addTask` (creates new)
8. For each phase already in task files: calls `syncExistingRoadmapTask` only if metadata changed
9. Writes updated `BOARD.json` with `status: "synced"`, fresh `syncedAt`, updated `phases` array

### Execution record safety

The sync loop writes only to:
- `.aof/boards/coordination/tasks/*.json` (via `addTask` / `syncExistingRoadmapTask`)
- `.aof/boards/coordination/BOARD.json` (final board update)

**The `executions/` directory is never touched by sync.** Verified: no code path in `syncBoardFromGsdRoadmap` writes to `executions/`.

### Task file safety during re-sync

`syncExistingRoadmapTask` (`boards.mjs:1324`) pattern:
```javascript
{ ...task, title, description, goal, requirements, successCriteria, dependsOn, deliverable, refs, history: [...task.history, {synced}], updatedAt }
```

It spreads `...task` first, which preserves:
- `task.status` (`in_progress` for phase-40)
- `task.assignedAgent`
- `task.execution`
- All history entries (only appends a `synced` entry)

**Verdict:** Re-sync will update task metadata (title, goal, etc.) from the current roadmap but will NOT reset task status, agent assignment, or execution state. This is expected behavior.

### Expected sync output after re-attach

All 5 tasks already exist. Since the BOARD.json phases array was already set by the prior sync (same roadmap content), `roadmapTaskNeedsSync` will likely return `false` for all 5 — resulting in `updated: 0`. If any roadmap text changed between the prior sync and now, `updated` will reflect the delta.

```
Synced board coordination with GSD roadmap
phases: 5
created: 0
add phase: $gsd-phase add
```

---

## 4. Error Code Paths

**Confidence: HIGH** — verified in `src/boards.mjs:412-450` and `src/cli.mjs:287-313`.

All three errors extend `BoardLifecycleError` and are handled by `printStructuredJsonError` in the CLI.

### `MILESTONE_MISSING_ARG`
- **Trigger:** `aof boards sync test-attach-uat` (no `--milestone` flag)
- **Condition:** `requestedMilestoneId` is falsy after `normalizeMilestoneInput`
- **Human output:** Throws, CLI prints error message
- **JSON output:** `{ "ok": false, "code": "MILESTONE_MISSING_ARG", "message": "Usage: aof boards sync ...", "next": "aof boards sync test-attach-uat --milestone <milestone-id>" }`
- **Exit code:** non-zero

### `MILESTONE_NOT_BOUND`
- **Trigger:** `aof boards sync test-attach-uat --milestone v1.8` on a freshly created board with no milestone.id
- **Condition:** `configuredMilestoneId` is falsy (new GSD board has no `gsd.milestone.id` field)
- **JSON output:** `{ "ok": false, "code": "MILESTONE_NOT_BOUND", "message": "Board test-attach-uat is not bound to a GSD milestone id.", "next": "aof boards milestone attach test-attach-uat --milestone v1.8 --roadmap <path>" }`

### `MILESTONE_ID_MISMATCH`
- **Trigger:** Attach test board to `v1.8`, then sync with `--milestone v1.9`
- **Condition:** `configuredMilestoneId ("v1.8") !== requestedMilestoneId ("v1.9")`
- **JSON output:** `{ "ok": false, "code": "MILESTONE_ID_MISMATCH", "message": "Board test-attach-uat is bound to milestone v1.8, not v1.9.", "expected": "v1.8", "actual": "v1.9", "next": "aof boards sync test-attach-uat --milestone v1.8" }`

---

## 5. Disposable Test Board Setup

**Confidence: HIGH** — verified in `src/cli.mjs:167-194` and `src/boards.mjs:48-104`.

### Create command

```
node bin/aof.mjs boards create test-attach-uat --objective "Error path testing" --title "Test Attach UAT"
```

- `--objective` is required (throws if missing)
- `--title` is optional; defaults to `id` if omitted
- `--execution-runtime` is not needed; defaults to `codex`
- `executionProvider` will be set to `"gsd"` automatically because `isGsdExecutionConfigured` returns true for this project

### Initial state of new GSD board

```json
{
  "gsd": {
    "milestone": {
      "status": "waiting_for_user",
      "id": undefined,           ← field not set
      "roadmapPath": null,
      "syncedAt": null,
      "binding": { "status": "pending-attachment" }
    },
    "taskCreation": {
      "syncCommand": "aof boards sync test-attach-uat",
      "syncBlockedReason": "milestone-incomplete"
    }
  }
}
```

This means the new board has no `gsd.milestone.id` — exactly what `MILESTONE_NOT_BOUND` checks for.

### Remove command

```
node bin/aof.mjs boards remove test-attach-uat
```

Uses `rm(boardDir, { recursive: true })`. No `--force` required for normal operation.

### Side effect: `ensureAofBoardMilestoneBridge`

`createBoard` calls `ensureAofBoardMilestoneBridge` for GSD boards. This creates `.aof/skills/aof-board-milestone-bridge/` if it doesn't already exist. Since this skill already exists in the repo, no change will occur.

---

## 6. Board Doctor Post-State

**Confidence: HIGH** — from `src/cli.mjs:257-273` and `src/boards.mjs` doctor logic.

After attach + sync completes successfully on `coordination`:

**Expected human output:**
```
doctor: healthy
✓ BOARD_EXISTS board=coordination: Board coordination exists.
✓ BOARD_MILESTONE_SYNCED board=coordination: Board coordination GSD milestone v1.8 is synced.
✓ BOARD_TASK_COUNT board=coordination: Board coordination has 5 tasks.
```

**Expected JSON fields:**
```json
{ "ok": true, "checks": [ { "status": "ok", "code": "BOARD_MILESTONE_SYNCED", ... } ] }
```

Any `FAIL`-severity check after fresh attach+sync should be logged as a UAT finding.

---

## 7. Wave Plan

**Confidence: HIGH**

### Wave 1 — Phase 39 Stragglers

1. Run baseline CLI captures: `list`, `show`, `validate`, `index`, `doctor` against `coordination` (human and JSON)
2. Write `.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/39-BASELINE-OUTPUT.md`
3. Write `.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/39-UAT-LOG.md` (initial findings, empty list)
4. Commit all untracked files: `.aof/boards/`, `.aof/skills/`, `.aof/.gitignore`, `.planning/phases/39-*/`, `.planning/milestones/v1.7-UAT.md`, `src/internal-skills.mjs`, scripts

### Wave 2 — Happy Path: Attach + Sync + Doctor

1. Run `node bin/aof.mjs boards milestone attach coordination --milestone v1.8 --roadmap .planning/ROADMAP.md` (human + JSON)
2. Verify `BOARD.json` shows `status: "ready_to_sync"`, `syncedAt: null`
3. Verify `executions/phase-39.json` and `executions/phase-40.json` are unchanged
4. Run `node bin/aof.mjs boards sync coordination --milestone v1.8` (human + JSON)
5. Verify `BOARD.json` shows `status: "synced"`, fresh `syncedAt`
6. Run `node bin/aof.mjs boards doctor coordination` (human + JSON)
7. Verify doctor shows healthy
8. Log re-attach warning absence as UAT finding in `39-UAT-LOG.md`
9. Commit updated board state and UAT log

### Wave 3 — Error Paths via Disposable Board

1. Create: `node bin/aof.mjs boards create test-attach-uat --objective "Error path testing" --title "Test Attach UAT"`
2. `MILESTONE_MISSING_ARG`: `node bin/aof.mjs boards sync test-attach-uat` + `--json` form
3. `MILESTONE_NOT_BOUND`: `node bin/aof.mjs boards sync test-attach-uat --milestone v1.8` + `--json` form
4. `MILESTONE_ID_MISMATCH`: Attach to v1.8 (`--roadmap .planning/ROADMAP.md`), then sync with `--milestone v1.9` + `--json` form
5. Remove: `node bin/aof.mjs boards remove test-attach-uat`
6. Update `39-UAT-LOG.md` with error path evidence
7. Update `REQUIREMENTS.md` BOARD-02/03/04 to Complete
8. Commit wave 3 changes

---

## 8. Risks And Mitigations

| Risk | Confidence | Mitigation |
|---|---|---|
| SDK probe fails on attach (happy path) | LOW | If `assertBoardMilestone` fails, log as BLOCKER; halt Phase 40 until resolved |
| Re-sync corrupts execution records | LOW (code verifies safety) | Confirm with before/after diff of `executions/` |
| Test board creation triggers interactive milestone flow | LOW | `createBoard` only sets `status: "waiting_for_user"` but does NOT actually launch the GSD CLI |
| `roadmapTaskNeedsSync` returns `true` for all 5 tasks | LOW | Expected if roadmap content hasn't changed; `updated: 0` is the correct result |
| `ensureAofBoardMilestoneBridge` creates duplicate skill | LOW | Skill already exists; function is idempotent |

---

*Phase: 40-Board-Attachment-And-Sync-UAT*
*Research completed: 2026-05-19*
