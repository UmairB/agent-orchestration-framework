---
doc: verification
---
<!--
  Milestone VERIFICATION.md — the verify/accept record. Written at aof:verify.
  Pointers, not restatements. Only sections with content are present (absence is information).
-->
# 35 · Mesh Work Assignment — Verification

Verified `2026-07-09` via `aof:verify 35` on a single Windows host (no second physical node / live
tailnet). Lanes in scope: `@executable` (all four stories), one `@manual` two-machine soak (02/05),
one `@uat` design-conformance gate (03/03).

## Verification evidence

### `@executable` suite + fitness functions — GREEN
- Full suite: **2213 passing, 0 failures** (`node ./scripts/test.mjs`, exit 0).
- Milestone-35's **13 fitness functions** (ADR-001..008, incl. the SECURITY.md admission/revocation/
  repo-refusal invariants + ADR-008's driver-wired #13) are all **imported, spread into the assembled
  runner, and green** — verified each `acd-assignment-*` / `acd-directive-*` / `acd-worktree-*` /
  `acd-mesh-ui-read-only` / `acd-no-git-bus-return` / `acd-control-dispatch-reclaim-driver-wired`
  arch-test binding occurs twice in `scripts/test.mjs` (import + spread) and emits `ok`. This directly
  clears the STATE registration-gap risk (the ~32 m22-26 orphaned bindings did NOT include any m35
  test). The 5 `acd-desktop-*` bindings are milestone-36 guard-if-present no-ops (green while their
  target subtree is absent). *verifies →* every story's `@executable` tasks (00×4, 01×4, 02×6, 03×3).

### `@manual` (agent-run) — none in scope
- The only `@manual` scenario (02/05) is the cross-machine soak — not agent-runnable on one host
  (→ `## Live / environmental checks`). Every seam it integrates is proven by the `@executable` 00–04
  lanes over injected transports/clocks/spawns; there is no agent-runnable `@manual` command/endpoint
  lane in this milestone to execute inline.

### Design conformance (UI, story 03 / task 03 `@uat`) — verdict: **CONFORMS**
- **Render:** the read-only fleet SPA (`aof mesh ui`, global scope) rendered populated against a seeded
  v3 global store (`running`+`reclaimed`+`assigned` item chips; `worker-a`/`worker-b` node summaries)
  via the cached ms-playwright Chromium (`chromium-1228/chrome-win64/chrome.exe --headless=new
  --screenshot`, NOT `npx playwright`) at **390 / 768 / 1280** (+480 supplementary). The render
  precondition (a `running` and a `reclaimed`/`failed` appearance) is satisfied — the verdict is a real
  CONFORMS/GAPS, not INCONCLUSIVE-on-missing-render.
- **Designer judgement (aof-designer, region-by-region vs DESIGN.md §1–§4):** PRIMARY running chip
  (left slot, before the in-review token, run-chip primitive, teal-only motion) **CONFORMS**; RAMP
  appearances (assigned=muted / running=teal / failed=destructive `!`, colour+label+mark always agree)
  **CONFORMS**; DEGRADED reclaimed read (visible red `failed`+`!`) **CONFORMS** (see F-3501 rule);
  SECONDARY node summary §2b (non-zero-only, reclaimed folds to `failed` in the destructive token,
  all-zero node omits the line) **CONFORMS**; READ-ONLY rail (no assign/accept/revoke control/form/
  picker; only the drill-in + `⟳` refresh) **CONFORMS**; TOP-BAR poll affordance (`⟳ refreshed …`,
  not a WS indicator) **CONFORMS**.
- **Honest residual (not a defect):** the Legend "Assignment" block is a hover-reveal tooltip, so its
  five-row contents are **INCONCLUSIVE on a static render** — the legend's *presence* conforms; closing
  the sub-item to CONFORMS needs an expanded-legend (hover) capture. No product change implied.
- *verifies →* `03/03_fleet-visual-review.feature` (all regions); renders retained in the verify
  scratchpad (`fleet-m35-{390,480,768,1280}.png`).

## Live / environmental checks

- **Story 02 / task 05 — two-machine assignment soak (`@manual`) — DEFERRED, not agent-executable.**
  The scenario requires a real Windows control node (`umairs-msi`) dispatching over a live **Tailscale**
  tailnet to a real macOS worker (`umairs-mac-mini`) that materializes a **real `git worktree`**, runs a
  headless runtime, and is killed mid-run for a real presence+heartbeat staleness reclaim. This
  `aof:verify` ran on one Windows host with no second physical node and no live tailnet peer, so the soak
  **could not be executed** by the agent. Each seam it integrates is `@executable`-proven over injected
  transports/spawns/clocks (00–04) + the 13 fitness functions; this lane proves them *together against
  the real fabric*. **Owner action (operator):** run the `02/tasks/05` narrative on the two real hosts
  and record the three latencies (dispatch→accept, each lifecycle transition→visible on control,
  kill→reclaimed). Non-blocking by the milestone-34 precedent (34 accepted with its identical story-04
  soak deferred). **Operator decision at this verify:** defer per that precedent (accept now).

## Findings

| id | observed | type | severity | triage | routed-to | status |
| --- | --- | --- | --- | --- | --- |
| F-3501 | The `· reclaimed` provenance note on the reclaimed item chip **truncates to the chip `title` tooltip** in the card grid at every breakpoint (390/480/768/1280) — it is genuinely in the DOM + tooltip (QA `--dump-dom` confirmed), but the always-visible attention-text clips behind the `shrink-0` "Open board →" drill-in. The **required visible degraded signal — the red `failed` chip + `!` mark + `failed` label + `→ <nodeId>` — stays un-clipped everywhere** (the pre-fix "Open board →" clip was already fixed in the build fix pass). Designer ruled **CONFORMS with a standing rule**: the red failed chip is the protected visible signal; the `· reclaimed` note is supplementary provenance that MAY degrade to tooltip (never dropped from the model). A vanished/colour-only chip or silent reversion to `assigned` would still be a GAP. | design-gap | non-blocker | **design-gap → designer sets the DESIGN rule** | `aof-designer` → DESIGN.md (rule codified `2026-07-09` at §2a anatomy note, §4 reclaimed note, Review Notes). Recommended follow-on (deferred backlog): a 320px worst-case `@uat` scenario (long nodeId + reclaimed) asserting the red failed chip + drill-in stay intact and the note is reachable via `title`. | **closed** (rule recorded in the binding baseline) |

## User sign-off

- **`@uat` 03/03 design acceptance — ACCEPTED** by the operator (`2026-07-09`). Shown the populated
  renders (390–1280) inline and the aof-designer **CONFORMS** verdict incl. the F-3501 note-to-tooltip
  tolerance; the operator signed off the design gate. The DESIGN.md rule codification (F-3501) proceeds
  as the closure, not a blocker.

## Accept decision

**ACCEPTED — `2026-07-09`.** Milestone 35 is done: the control↔worker dispatch plane is real and
outsider-verifiable at the seam level. Basis:
- `@executable` suite **2213/0** green; all 13 milestone fitness functions registered + green;
  `aof work validate 35` **PASS**.
- `@uat` design conformance **CONFORMS** (aof-designer) + operator sign-off; the one design-gap (F-3501)
  is **closed** by codifying the standing reclaimed-note rule in DESIGN.md.
- The `@manual` two-machine soak is a **deferred operator-run environmental check** (not agent-executable),
  non-blocking by the automated + design evidence and the milestone-34 precedent — **no blocker finding
  is open.**

All four stories → `done`; SPEC `status: done`. Accepting milestone 35 unblocks anything that
`depends:` on it.
