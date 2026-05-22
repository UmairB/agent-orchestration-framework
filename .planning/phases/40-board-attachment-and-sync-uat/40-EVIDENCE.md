# Phase 40 Evidence: Happy Path Attach + Sync + Doctor

**Captured:** 2026-05-22

## Attach Output (human)

```
Attached board coordination to milestone v1.8
roadmap: .planning/ROADMAP.md
binding: attached
sync: aof boards sync coordination --milestone v1.8
```

## Attach Output (JSON)

```json
{
  "ok": true,
  "board": "coordination",
  "milestone": {
    "status": "ready_to_sync",
    "binding": { "status": "attached", "sdkVersion": "0.1.0" },
    "roadmapPath": ".planning/ROADMAP.md",
    "syncedAt": null,
    "id": "v1.8",
    "phaseCount": 5
  }
}
```

## Post-Attach State Change (git diff excerpt)

```diff
-      "status": "synced",
+      "status": "ready_to_sync",
       "binding": {
-        "status": "synced",
-        "sdkVersion": "0.1.0",
-        "fingerprint": "52941f0f4e03601be47c23c8b4df1fcdc2371fdf77cc899e5dda577e8e5fc31a"
+        "status": "attached",
+        "sdkVersion": "0.1.0"
       },
-      "syncedAt": "2026-05-19T12:59:38.405Z",
+      "syncedAt": null,
```

Verified:
- `gsd.milestone.status`: `"synced"` → `"ready_to_sync"` ✓
- `gsd.milestone.syncedAt`: timestamp → `null` ✓
- `gsd.milestone.binding.status`: `"synced"` → `"attached"` ✓
- `gsd.milestone.id`: `"v1.8"` unchanged ✓

## Execution Record Safety Check (post-attach)

```
phase-39.json: unchanged ✓
phase-40.json: unchanged ✓
```

`git diff .aof/boards/coordination/executions/` returned no output — execution records untouched.

## Sync Output (human)

```
Synced board coordination with GSD roadmap
phases: 5
created: 0
add phase: $gsd-phase add
```

## Sync Output (JSON)

```json
{
  "ok": true,
  "board": { "id": "coordination", "gsd": { "milestone": { "status": "synced", "syncedAt": "2026-05-22T10:12:44.803Z" } } },
  "phases": [phaseId 39..43],
  "created": [],
  "updated": [],
  "actions": [
    { "phaseId": "39", "action": "keep" },
    { "phaseId": "40", "action": "keep" },
    { "phaseId": "41", "action": "keep" },
    { "phaseId": "42", "action": "keep" },
    { "phaseId": "43", "action": "keep" }
  ]
}
```

All 5 phases kept (`action: "keep"`). Zero created, zero updated task status changes.

## Post-Sync State Change (git diff excerpt)

```diff
-      "syncedAt": "2026-05-19T12:59:38.405Z",
+      "syncedAt": "2026-05-22T10:12:44.803Z",
```

Only `syncedAt` and `updatedAt` changed — binding.status and milestone.status restored to `"synced"` without an explicit diff entry because sync wrote back identical values.

## Execution Record Safety Check (post-sync)

```
phase-39.json: unchanged ✓
phase-40.json: unchanged ✓
```

`git diff .aof/boards/coordination/executions/` returned no output — execution records untouched after sync.

## Doctor Output (human)

```
doctor: healthy
PASS BOARD_STATE_VALID board=coordination: Board coordination state is readable and structurally valid.
PASS GSD_STATE_PRESENT board=coordination: GSD state is present.
PASS GSD_ROADMAP_ANALYZABLE board=coordination: GSD roadmap has 5 phase(s).
PASS BOARD_MILESTONE_BOUND board=coordination: Board coordination is bound to milestone v1.8.
PASS BOARD_MILESTONE_MATCHES_GSD board=coordination: Milestone v1.8 matches GSD state.
PASS BOARD_TASKS_MATCH_ROADMAP board=coordination: Board coordination tasks match cached roadmap phases.
PASS GSD_TOOLCHAIN_METADATA: Bundled SDK 0.1.0; resolved tools 1.42.2.
WARN SDK_VERSION_DRIFT: Bundled @gsd-build/sdk 0.1.0 differs from resolved gsd-sdk 1.42.2.
  next: Review the installed GSD package before relying on board sync/execution results.
PASS NODE_ON_PATH: node is available on PATH (v22.22.2).
```

## Doctor Output (JSON)

```json
{
  "ok": true,
  "checks": [
    { "status": "pass", "code": "BOARD_STATE_VALID" },
    { "status": "pass", "code": "GSD_STATE_PRESENT" },
    { "status": "pass", "code": "GSD_ROADMAP_ANALYZABLE" },
    { "status": "pass", "code": "BOARD_MILESTONE_BOUND" },
    { "status": "pass", "code": "BOARD_MILESTONE_MATCHES_GSD" },
    { "status": "pass", "code": "BOARD_TASKS_MATCH_ROADMAP" },
    { "status": "pass", "code": "GSD_TOOLCHAIN_METADATA", "actual": { "sdkVersion": "0.1.0", "toolsVersion": "1.42.2" } },
    { "status": "warn", "code": "SDK_VERSION_DRIFT", "next": "Review the installed GSD package before relying on board sync/execution results." },
    { "status": "pass", "code": "NODE_ON_PATH" }
  ]
}
```

## Summary

Happy path complete. Board `coordination` is in `synced` state. UAT-01 (re-attach silently resets synced board state) logged. Doctor reports `ok: true` with 8 PASS and 1 WARN (SDK_VERSION_DRIFT — pre-existing).
