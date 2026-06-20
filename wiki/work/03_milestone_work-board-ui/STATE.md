---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 03 · Work Board UI — State

**Milestone accepted 2026-06-20** (`aof:verify 03`). All three independent stories are `done`. Compacted
at this close: the durable decisions have graduated to ADRs ([ARCHITECTURE.md](ARCHITECTURE.md)
ADR-001…006); the review-gate + UAT process lessons have graduated to
[RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R7) and the `## Feedback (for retro)` section has been archived
with them; the full verification record (evidence, the operator `@uat` sign-off, findings) lives in
[VERIFICATION.md](VERIFICATION.md). The blow-by-blow refine→build→review→rework narrative (the visual
rework, the detail-panel doc-model fix, the terminal-lifecycle + persistent-dock fixes, the state-aware
action, the tasks/markdown additions, the F-1 launch-path fix, and the several review gates) has been
archived to git history; only the closure record and carried follow-ups remain below.

## Outcome

The work stream is now an interactive board that both *shows* the milestone→story→task stream and
*drives* the agent loop, served same-origin via `aof work board`:

- [x] `00_story_work-list-json` — `aof work list [--json]` emits the whole stream as the locked flat
  7-field array `{ ref, type, slug, status, title, parent, dir }` (ADR-002) via `listStream(workDir)`,
  plus a readable human listing. (`status: done`)
- [x] `01_story_work-board` — the `/api/work*` API (`list`/`doc`/`validate`/`next`/`feedback`/`tasks`) in
  `src/board-ui.mjs` + the React surface: VIEW 1 milestone-card overview grid + VIEW 2 five-lane status
  board (read-only derived buckets, NOT a draggable kanban), the type-aware detail panel
  (milestone SPEC·VERIFICATION·RETROSPECTIVE·Findings; story STORY·TASKS; markdown bodies), and the three
  actions (add feedback / validate / next). The feedback append to STATE is the board's only write
  (ADR-004). (`status: done`)
- [x] `02_story_agent-terminal` — the in-app agent terminal: `node-pty@1.1.0` + `ws@8` at `/ws/terminal`
  + an xterm dock + the ported `CliProvider` seam (claude/codex/gemini, MIT-attributed, ADR-003);
  state-aware primary action types the matching `aof` command in as raw PTY input (ADR-006); a missing
  provider degrades to the dock error state, never a crash. (`status: done`)

Delivery: `aof work board` + `serveBoard()` (`src/board-serve.mjs`) serve the built `ui/dist` through the
one `serveSetupUi` `http.createServer` — `/api/work*` + `/ws/terminal` + bundle share one 127.0.0.1
origin (ADR-001; no second server/port).

Verification: full `@executable` suite **green (636 ok / 0 not-ok)**; all **five fitness functions** green
(`acd-work-list-contract`, `acd-board-write-isolation`, `acd-board-single-server`,
`acd-terminal-server-only`, `acd-vibeyard-attribution`); `@manual` A2 (`pty.spawn` smoke) + A7 (real
provider present/missing) + story-01 rendered UI all PASS; the milestone's one `@uat` gate — story 02's
A4 live agent-stream — **signed off by the operator** ("All 5 passed"). Gate `aof:validate 03` → PASS.
See [VERIFICATION.md](VERIFICATION.md). **Depends:** 00 (done). Nothing currently `depends:` on 03.

## Carried follow-ups

Open items deliberately deferred past this milestone (routed work, not lessons — see RETROSPECTIVE.md for
those). None gate acceptance; all are non-blocking.

- **F-2 — superseding ADR-002 contract extension** (routed to `aof:refine 03` → `aof-architect`). The
  card/lanes design wants per-item data the frozen 7-field contract doesn't carry: per-milestone task
  **roll-up counts**, the gate **`depends`/"waiting on X"** edge, and the **Findings count**. The build
  degrades honestly. The **tasks** half is discharged (`GET /api/work/tasks`); the remainder needs the
  extension (or a sidecar endpoint), never new fields on `listStream`. Subsumes DG-1. (RETROSPECTIVE R3.)
- **DG-1 — Findings-tab count** is a hardcoded `"Findings (0)"` (`ui/src/board/DetailPanel.tsx`); render
  as a dynamic `Badge variant="secondary"` once the real count lands (gated on F-2). Deferred.
- **`04_next-item.feature` scenario fixes** (RETROSPECTIVE R2) — state the scope explicitly in the
  blocked step (unscoped `next` returns first-ready, not blocked); align the `waitingOn` value-format
  (`"03"` vs un-padded `"3"`); add multi-dependency `waitingOn` coverage. Routed to refine.
- **Provider picker reconciliation** — the UI shows claude-only while the feature + DESIGN §4 enumerate
  all three; DESIGN's corrected rule renders codex/gemini **visibly paused** (disabled/dimmed), not
  hidden. Routed to refine (designer + developer).
- **`feature-parse.mjs` lane precedence** — scenario-level verification tag should *override* the
  feature-level tag, not sum (current sum yields `lane: null` for `@executable`+`@manual`); add that
  fixture + a malformed-`.feature` case. Routed to refine.
- **Overview card-footer attention ladder omits `blocked`** — should be blocked → in-review → accepted →
  neutral (`Overview.tsx`). DESIGN §1 rule + patch. Routed to refine.
- **Fitness-function backstop gaps** (RETROSPECTIVE R5) — widen `acd-board-write-isolation` beyond the
  one `board-ui.mjs` file; add a negative arch-test for ADR-006's "no `{type:'run'}` envelope member";
  add the ADR-004 no-status-mutation-from-drag test if/when dnd-kit is wired.
- **Wire-envelope de-duplication** (RETROSPECTIVE R7) — `parseControl` is implemented twice (server
  `terminal-ws.mjs` + client `TerminalDock.tsx`) and the resize shape re-implemented inline vs
  `resize.mjs`; consolidate into one shared `.mjs` both import so an ADR-003 envelope change can't diverge.
- **Feedback composer "Refs (optional)" input** — un-specced (DESIGN §3 = Textarea + Send only); if kept,
  add it to `02_add-feedback.feature` + the DESIGN §3 checklist. Routed to refine.
- **Roadmapped (out of scope, from SPEC):** P2P WebRTC session-sharing (vibeyard `sharing/`),
  multi-session swarm grid, cost/context tracking, session resume, and a true "continue the running
  session in the host terminal" (needs PTY fan-out + `aof terminal attach <ref>`; the `.aof`
  session registry is the lookup it would build on).

## Notes & decisions

The autonomous-pass default decisions (one server two surfaces; the locked flat `work list --json`
contract; board read-mostly with the feedback append as its only write; vibeyard reused as a recipe under
MIT attribution; the connection-state ramp onto the 3-variant Badge; proportionate ceremony — no
SECURITY/COMPLIANCE doc for a 127.0.0.1 single-user no-auth surface) have **graduated to the ADRs** —
[ARCHITECTURE.md](ARCHITECTURE.md) ADR-001…006. No decision is left open as a blocker.

## Feedback (for retro)

<!-- Archived at Accept (aof:verify 03, 2026-06-20). The build + review-gate + UAT observations have
     graduated into RETROSPECTIVE.md R1–R7 (and the defects were logged as VERIFICATION findings —
     F-1 resolved, F-2/DG-1/DG-7 carried). The section is retained empty as the record that the
     graduation happened, exactly as durable decisions graduate into ADRs. -->

_None — graduated to [RETROSPECTIVE.md](RETROSPECTIVE.md) R1–R7 (findings in [VERIFICATION.md](VERIFICATION.md))._
