# Phase 34 Research: Board Lifecycle Migration And Typed Sync

## Resolved Questions

### R-01: Adapter Entry Points

Phase 34 should call only Phase 33 adapter exports from `src/boards.mjs`:

- `assertMilestone(projectDir, milestoneId, options)` for attach and sync identity checks.
- `analyzeGsdRoadmap(projectDir, options)` for typed `RoadmapAnalysis`.
- `listMilestonePhases(projectDir, milestoneId, options)` only if a narrow milestone-scoped list is useful, but current SDK analysis already returns the phase list AOF needs.
- `gsdSdkVersion()` for `binding.sdkVersion`.
- `GsdSdkError` for preserving adapter failure details.

No code outside `src/gsd-sdk-adapter.mjs` should import `@gsd-build/sdk`, and Phase 34 must not add a second shellout seam.

### R-02: Typed Phase Normalization

The current sync path creates board tasks from markdown-derived `{number, title, goal}`. The SDK `RoadmapAnalysis` phase entries already expose `number`, `name`, and `goal` in the current fixture shape. Phase 34 should normalize each typed phase into:

- `phaseId`: stable display/task identity, using `phase.number` as the primary source.
- `title`: `phase.name` or `phase.title`, trimmed.
- `goal`: `phase.goal`, trimmed.
- `taskId`: `phase-${phaseId}`.

This keeps v1.6 task ids stable (`phase-30`) while moving source truth to the SDK.

### R-03: Binding Fingerprint

The binding fingerprint should hash only normalized phase identity rows:

```json
[
  { "phaseId": "34", "title": "Board Lifecycle Migration And Typed Sync", "goal": "..." }
]
```

Use a deterministic JSON string and SHA-256. Do not include roadmap metadata, timestamps, completion status, or raw SDK payload fields.

### R-04: Error Shape

The board layer needs a small typed error class, separate from the adapter class, so CLI and setup UI can return stable board-domain codes:

- `MILESTONE_MISSING_ARG`
- `MILESTONE_NOT_BOUND`
- `MILESTONE_ID_MISMATCH`
- `MILESTONE_NOT_IN_STATE`
- `MILESTONE_INCOMPLETE`
- `BOARD_MILESTONE_UNATTACHED`
- `BOARD_MILESTONE_DRIFT`
- `BOARD_MILESTONE_ID_MISSING`

The error should carry `{code, message, expected?, actual?, next?}` and serialize through `toJSON()`. Phase 38 will broaden JSON parity across all board commands; Phase 34 should make the changed sync/attach/repair paths emit these details where they are introduced.

### R-05: v1.6 Repair Heuristic

Existing v1.6 boards can have `gsd.milestone.roadmapPath` but no `gsd.milestone.id`. Since SDK v0.1.0 does not provide a direct "milestone for roadmap path" method, repair should:

1. Analyze the current roadmap through the adapter.
2. Build candidate milestone ids from `RoadmapAnalysis.milestones[].version`.
3. Auto-bind only if there is exactly one candidate and the stored roadmap path maps to `.planning/ROADMAP.md`, or the existing board phase fingerprint matches the analyzed phase fingerprint.
4. Otherwise return a non-mutating result with an exact manual attach command.

This honors the discussion decision that ambiguity is not guessed.

### R-06: UI Scope

The React board UI already receives full `gsd` data through existing `/api/boards` and `/api/boards/:id` responses. No backend route is needed. The only UI change should be type shape plus compact text:

`milestone: waiting_for_user - binding: pending-attachment`

The existing status card and board summary remain otherwise unchanged.

## Verification Notes

Focused verification should cover:

- `npm run test:unit` for board unit behavior.
- `npm test` for CLI/BDD behavior.
- `npm run ui:build` because `ui/src/main.tsx` changes.
- `node scripts/check-sdk-boundary.mjs` because Phase 34 consumes the adapter and must not create a new SDK import.

