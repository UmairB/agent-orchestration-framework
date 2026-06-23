---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 08 · CLI Command Core — State

**Accepted 2026-06-21** (`aof:verify 08`). All four stories verified and accepted; milestone
`status: done`. Compacted at this close: the durable decisions live as ADRs
([ARCHITECTURE.md](ARCHITECTURE.md) ADR-001…004); the three build/review process lessons + their
carried follow-ups have graduated to [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R3) and the
`## Feedback (for retro)` section has been archived with them; the verification record lives in
[VERIFICATION.md](VERIFICATION.md). The blow-by-blow framing/refine/contract/build/review narrative has
been archived; only the closure record and carried follow-ups remain below.

## Outcome

The **CLI-as-contract** architecture established and proven on its first surface: one in-process command
core is the single source of truth for the six read-mostly work operations, the CLI is a thin
`argv→command→result` face, the board API is a second `route→invoke→projection` face, and the "single
source of truth" guarantee is made structural by four fitness functions.

- [x] `00_story_command-core` — the spine: `src/command-core.mjs` (the `{id,input,run,cli}→result`
  registry + the basis-neutral result, ADR-002) + `src/commands/{list,doc,tasks,validate,next,feedback}.mjs`
  with the bespoke `board-ui.mjs` logic (incl. the sole feedback write) moved in. The registry also
  **vends `loadWorkspace`** so the faces reach the workspace through the door (RETRO R1). (`status: done`)
- [x] `01_story_cli-face` — thin `argv→command→result`: new `work doc` / `work tasks` / `work feedback`
  subcommands + `list` / `validate` / `next` rewired through the registry via the scope-aware
  `render(result, faceCtx)` adapter (ADR-003) → `src/cli.mjs`. (`status: done`)
- [x] `02_story_board-face` — `/api/work*` reduced to `route→invoke→projection`, the milestone-03 error
  envelope / status and the resolver distinction preserved byte-for-byte, zero operation logic left in
  the UI server (ADR-003) → `src/board-ui.mjs`. (`status: done`)
- [x] `03_story_command-fitness` — the load-bearing deliverable (ADR-004): four arch-tests —
  `acd-work-command-route-coverage` (inv.1 route→command surjection), `acd-work-command-cli-bijection`
  (inv.2 command→CLI), `acd-work-ui-no-core-import` (inv.3 the registry is the only door, incl.
  `setup-ui.mjs`), `acd-work-command-no-subprocess` (inv.4 / ADR-001 in-process). (`status: done`)

Verification: `@executable` only (10 task features + 4 arch-tests) — **886 ok / 0 fail** (was 798 at
start); the four ADR-004 fitness functions + the re-anchored `acd-board-write-isolation` green; the m03
board envelope (`board-api/00`, `board-api/03`, `work list`/`validate`/`next`) byte-for-byte intact;
**zero `@manual`, zero `@uat`** (a backend-contract inversion with no human-judgement surface), no UI /
`DESIGN.md`. Gate `aof:validate 08` → PASS. See [VERIFICATION.md](VERIFICATION.md). This is the
**foundational milestone of a multi-milestone inversion**.

## Carried follow-ups

Open items deliberately deferred past this milestone (lessons live in RETROSPECTIVE.md):

- **The `/ws/terminal` session-launch seam — its own follow-on milestone.** Re-homing session launch
  (incl. headroom + a generalized launch-extension registry; ties into milestones 06/07 and the deferred
  proxy-mode/observability work) behind the command core. Streaming/PTY is a distinct transport problem
  from the read-mostly API. Deferred.
- **The setup-UI config/resource CRUD — its own follow-on milestone.** `/api/config`,
  `/api/config/sections`, `/api/items`, `/api/capabilities` re-homed onto the command core once the
  read-API pattern is proven (it now is). Deferred.
- **Graduate "the door also vends the workspace loader" into the ADR text (RETRO R1).** `command-core.mjs`
  re-exports `loadWorkspace` so inv.3 (no `./work.mjs` import) holds without starving the face of the
  workspace it needs — added at build, named in no ADR. The follow-on terminal/setup-UI migrations
  inherit the need; fold it into ADR-002/004 (or a small new ADR) when they start.
- **Wire follow-on faces' view affordances through `faceCtx` from the first build (RETRO R3).** The
  contract's `render(result, faceCtx)` channel is the intended home for scope-aware/view output; the
  first build of this face inlined it and shipped the adapter dead before review reconciled it. The
  `/ws/terminal` and setup-UI faces should use the channel from the start, not inline.

## Notes & decisions in flight

- **All four ADRs settled at refine** and carried through the build unchanged — see
  [ARCHITECTURE.md](ARCHITECTURE.md): ADR-001 (boundary = in-process command core, NOT per-request
  subprocess — graduated PO decision 1); ADR-002 (the registry `{id,input,run,cli}→result` contract +
  the basis-neutral result that resolves byte-for-byte-on-both-faces); ADR-003 (the `/api/work`
  route→command migration + the new CLI subcommands); ADR-004 (the four enforcing fitness functions —
  the SPEC's load-bearing deliverable). One ADR-text accuracy nit surfaced at the migration —
  "keep `acd-board-write-isolation` green" should read "re-anchored, guarantee preserved," since the
  migration relocates the write the test greps (RETRO R2) — but no ADR was reopened or superseded.

## Feedback (for retro)

<!-- Archived at the milestone close (aof:verify 08, 2026-06-21). The three build/review observations and
     their carried follow-ups have graduated into RETROSPECTIVE.md R1–R3; no VERIFICATION finding was
     raised (clean build). The section is retained empty as the record that the graduation happened,
     exactly as durable decisions graduate into ADRs. -->

_None — graduated to [RETROSPECTIVE.md](RETROSPECTIVE.md) R1–R3 (no VERIFICATION findings; clean build)._
