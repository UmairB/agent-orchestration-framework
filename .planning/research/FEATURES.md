# Feature Research: v1.8 AOF Boards Dogfood UAT

**Domain:** Real-project UAT for local GSD-backed task boards
**Researched:** 2026-05-18
**Confidence:** HIGH

## Feature Landscape

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Real board creation | Dogfood must begin with durable `.aof/boards` state. | LOW | `coordination` already exists and should be preserved. |
| Explicit milestone attachment | v1.7 made board sync milestone-bound. | MEDIUM | Attach must accept v1.8 and `.planning/ROADMAP.md`, then set binding to attached. |
| Roadmap-to-task sync | Board tasks should reflect approved GSD phases. | MEDIUM | Sync must create phase tasks only after roadmap approval and attachment. |
| Board doctor and validation | Users need actionable health checks before trusting board state. | MEDIUM | Run human and JSON modes, including board-specific checks. |
| CLI/UI parity | The board UI must show the same canonical state as CLI commands. | MEDIUM | Use `aof boards ui`, API routes, and the live board. |
| Assignment and execution records | A synced phase task should support agent assignment and visible execution state. | HIGH | Exercise safely; real `runPhase()` may be expensive and should be bounded. |
| Finding capture and fix loop | Dogfood value comes from fixing concrete workflow failures. | MEDIUM | Findings need IDs, repro steps, fix commits, and regression tests. |
| Verification evidence | Closeout should prove the full board path works. | MEDIUM | Include unit, BDD, UI build/API, and live UAT log. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| AOF manages its own milestone through AOF boards | Proves the board feature is usable on a real project, not just fixtures. | HIGH | This is the milestone's central test. |
| Typed SDK binding visible in board health | Builds trust that board tasks match the intended GSD milestone. | MEDIUM | Doctor/sync output should be understandable. |
| Runtime fallback labeled as fallback | Prevents confusing interactive assistant behavior with typed backend behavior. | MEDIUM | Validate failure/waiting paths. |
| UI-guided board repair/sync | Helps users recover without memorizing commands. | MEDIUM | Current UI has repair/sync API routes; usability needs inspection. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Disposable dogfood board | Avoids touching real repo state. | Does not validate the user's chosen workflow. | Keep the `coordination` board as real v1.8 state. |
| Manual task creation on GSD-backed boards | Seems convenient. | Breaks phase-backed source of truth and is intentionally blocked. | Add phases through GSD, then sync. |
| Auto-running all phases immediately | Looks like full automation. | Too risky during milestone definition and may run unbounded work. | Assign/run only safe tasks after roadmap approval. |
| Broad board redesign | Dogfood may reveal design wants. | Would blur UAT with product expansion. | Fix confirmed failures; defer speculative improvements. |

## Feature Dependencies

```text
Milestone requirements
  -> Roadmap approval
     -> Board milestone attach
        -> Board sync
           -> UI/CLI parity check
              -> Safe assignment/execution UAT
                 -> Fix findings and regression tests
```

## MVP Definition

### Launch With v1.8

- [ ] Existing `coordination` board is attached to v1.8 and synced from the approved roadmap.
- [ ] CLI dogfood covers list/show/doctor/validate/index/attach/sync/task move/agents/assignment/execution where safe.
- [ ] Boards UI dogfood covers board selection, task columns, status changes, repair/sync controls, assignment, and execution display.
- [ ] UAT findings are captured with repro steps and resolved through code/tests or explicitly deferred.
- [ ] Verification evidence proves the full flow on the AOF repo.

### Add After Validation

- [ ] UI polish beyond confirmed failure fixes.
- [ ] More advanced execution policy controls.
- [ ] Cross-project/global task hub behavior.

## Prioritization

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Real board attach/sync | HIGH | MEDIUM | P1 |
| Full CLI UAT script/log | HIGH | LOW | P1 |
| UI dogfood pass | HIGH | MEDIUM | P1 |
| Finding-to-fix loop | HIGH | MEDIUM | P1 |
| Safe assignment/execution | HIGH | HIGH | P1 |
| Polish-only UI improvements | MEDIUM | MEDIUM | P2 |
| New backend abstractions | LOW | HIGH | P3 |

## Sources

- Current project milestone scope
- `.aof/boards/coordination/BOARD.json`
- `src/boards.mjs`
- `src/setup-ui.mjs`
- `ui/src/main.tsx`
- `test/boards.test.mjs`
- `test/integration/features/boards.feature`

---
*Feature research for: AOF Boards Dogfood UAT*
*Researched: 2026-05-18*
