# Phase 39 Baseline CLI Output

**Captured:** 2026-05-22
**Board state:** status=active, milestone=synced (v1.8), tasks=5
**Board path:** .aof/boards/coordination/BOARD.json

## aof boards list (human)

```
boards: 1
- coordination status=active tasks=5 title=Coordination
```

## aof boards list --json

```json
{
  "boards": [
    {
      "id": "coordination",
      "title": "Coordination",
      "objective": "Plan a coordinated milestone",
      "status": "active",
      "columns": ["backlog","ready","in_progress","blocked","done"],
      "executionProvider": "gsd",
      "defaultExecutionRuntime": "codex",
      "gsd": {
        "milestone": {
          "status": "synced",
          "binding": {
            "status": "synced",
            "sdkVersion": "0.1.0",
            "fingerprint": "52941f0f4e03601be47c23c8b4df1fcdc2371fdf77cc899e5dda577e8e5fc31a"
          },
          "roadmapPath": ".planning/ROADMAP.md",
          "syncedAt": "2026-05-19T12:59:38.405Z",
          "id": "v1.8",
          "phaseCount": 5
        }
      },
      "updatedAt": "2026-05-19T12:59:38.405Z",
      "taskCount": 5,
      "counts": { "backlog": 3, "ready": 0, "in_progress": 1, "blocked": 0, "done": 1 }
    }
  ]
}
```

## aof boards show coordination (human)

```
board: coordination
title: Coordination
objective: Plan a coordinated milestone
status: active
execution: gsd runtime=codex
milestone: synced
binding: synced
started: $gsd-new-milestone Plan a coordinated milestone
sync: aof boards sync coordination --milestone v1.8
tasks: 5
- phase-39 status=done priority=normal title=Phase 39: Board Dogfood Requirements And Live State Baseline
- phase-40 status=in_progress priority=normal title=Phase 40: Board Attachment And Sync UAT
- phase-41 status=backlog priority=normal title=Phase 41: Boards UI Dogfood
- phase-42 status=backlog priority=normal title=Phase 42: Assignment And Execution UAT
- phase-43 status=backlog priority=normal title=Phase 43: UAT Findings Hardening And Closeout
```

## aof boards show coordination --json

Full board JSON confirmed. Key fields:
- `gsd.milestone.status: "synced"`
- `gsd.milestone.id: "v1.8"`
- `gsd.milestone.binding.status: "synced"`
- `gsd.milestone.syncedAt: "2026-05-19T12:59:38.405Z"`
- Tasks: phase-39 (done), phase-40 (in_progress), phase-41/42/43 (backlog)

## aof boards validate (pre-index, human)

```
valid: boards passed validation
```

Note: No BOARD_INDEX_STALE warning — index was already fresh.

## aof boards validate --json (pre-index)

```json
{
  "valid": true,
  "strict": false,
  "errors": 0,
  "warnings": 0,
  "diagnostics": []
}
```

## aof boards index (human)

```
Updated .aof/cache/boards/index.json
boards: 1
```

## aof boards validate (post-index, human)

```
valid: boards passed validation
```

## aof boards validate --json (post-index)

```json
{
  "valid": true,
  "strict": false,
  "errors": 0,
  "warnings": 0,
  "diagnostics": []
}
```

## aof boards doctor coordination (human)

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

## aof boards doctor coordination --json

```json
{
  "ok": true,
  "checks": [
    { "status": "pass", "code": "BOARD_STATE_VALID", "boardId": "coordination" },
    { "status": "pass", "code": "GSD_STATE_PRESENT", "boardId": "coordination" },
    { "status": "pass", "code": "GSD_ROADMAP_ANALYZABLE", "boardId": "coordination" },
    { "status": "pass", "code": "BOARD_MILESTONE_BOUND", "boardId": "coordination" },
    { "status": "pass", "code": "BOARD_MILESTONE_MATCHES_GSD", "boardId": "coordination" },
    { "status": "pass", "code": "BOARD_TASKS_MATCH_ROADMAP", "boardId": "coordination" },
    { "status": "pass", "code": "GSD_TOOLCHAIN_METADATA", "actual": { "sdkVersion": "0.1.0", "toolsVersion": "1.42.2" } },
    {
      "status": "warn",
      "code": "SDK_VERSION_DRIFT",
      "message": "Bundled @gsd-build/sdk 0.1.0 differs from resolved gsd-sdk 1.42.2.",
      "next": "Review the installed GSD package before relying on board sync/execution results."
    },
    { "status": "pass", "code": "NODE_ON_PATH" }
  ]
}
```

## aof assets validate (bridge skill leak check)

```
valid: config passed validation
```

```json
{
  "valid": true,
  "strict": false,
  "errors": 0,
  "warnings": 0,
  "diagnostics": [],
  "adapterWarnings": []
}
```

`aof assets list` confirms: `resources: 0` — no assets registered in `aof.config.json`.

### Result: PASS — aof-board-milestone-bridge not in rendered output

The bridge skill lives at `.aof/skills/aof-board-milestone-bridge/` but is NOT listed in `aof.config.json` resources, so it will never be rendered into `.claude/` or `.codex/`. Leak check passed.

## Doctor Warning: SDK_VERSION_DRIFT

Pre-existing warning logged for awareness. Bundled SDK (0.1.0) differs from resolved `gsd-sdk` tools (1.42.2). This is a known AOF v1.7 condition — the adapter uses the bundled SDK types for parsing but calls the installed `gsd-tools.cjs` for execution. No action required for UAT purposes.
