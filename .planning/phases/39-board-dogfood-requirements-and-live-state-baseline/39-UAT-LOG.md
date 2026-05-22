---
status: open
milestone: v1.8
---

# v1.8 UAT Log

**Started:** 2026-05-22
**Milestone:** v1.8 AOF Boards Dogfood UAT
**Status:** Open

## Findings

| ID | Phase | Command/Surface | Severity | Summary | Status |
|----|-------|----------------|----------|---------|--------|
| UAT-01 | 40 | aof boards milestone attach | medium | Re-attach silently resets synced board state with no warning | open |

## Finding Detail

### UAT-01: Re-attach silently resets synced board state

**Phase discovered:** 40
**Command/surface:** `aof boards milestone attach coordination --milestone v1.8 --roadmap .planning/ROADMAP.md`
**Severity:** medium
**Repro steps:**
1. Have a board already in `status: "synced"` state
2. Run `aof boards milestone attach <board-id> --milestone <id> --roadmap <path>`
3. Observe CLI output

**Expected:** CLI warns the user that re-attaching will reset milestone sync state (status → ready_to_sync, syncedAt → null) and asks for confirmation, or at minimum prints a warning line.
**Actual:** CLI prints only "Attached board coordination to milestone v1.8" with no mention of state reset. syncedAt is silently cleared. Fingerprint is also removed from binding.
**Status:** open
**Resolution:** Defer to Phase 43 — add warning line or confirmation prompt in attachBoardMilestoneRoadmap CLI handler.

---

Baseline board state validated (Phase 39):
- `aof boards list/show/validate/index/doctor` all returned healthy output
- No `BOARD_INDEX_STALE` warning (index already fresh)
- Bridge skill `aof-board-milestone-bridge` confirmed absent from rendered asset output
- Doctor reports `ok: true` with 8 PASS and 1 WARN (SDK_VERSION_DRIFT — pre-existing, not a UAT finding)

## Resolution History

(none)
