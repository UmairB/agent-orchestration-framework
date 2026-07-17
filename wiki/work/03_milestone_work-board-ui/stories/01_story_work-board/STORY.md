---
type: story
number: 01
slug: work-board
title: "The work board — render the stream, read an item, act on it"
parent: 3
status: done
owner: product-owner
created: 2026-06-19
updated: 2026-06-20
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 01 · The work board — render the stream, read an item, act on it

## User story

As the operator of an ACD work stream,
I want an in-browser board that shows the whole milestone → story → task hierarchy with each item's
derived status, lets me open a selected item's records (SPEC / VERIFICATION / RETROSPECTIVE / findings),
and lets me add feedback, validate the stream, and ask for the next actionable item — all without
dropping to the terminal,
so that I can see where the work stands and act on it from one calm console instead of running CLI
commands and opening markdown files by hand.

<!-- The React surface (DESIGN: board tree + detail panel + actions strip, one screen) plus its
     `/api/work*` HTTP API (ADR-001). Binds to a FIXTURE of the frozen `work list --json` contract
     (ADR-002) → builds independently of story 00. Owns the board's ONLY write — the feedback append
     (ADR-004); status is DERIVED, never written (no drag-to-restatus). Validate/Next are in-process
     calls to validateWork/nextWork (work.mjs:252,377), never a CLI shell-out. Detail docs resolve at
     path.join(dir,'<DOC>.md'), doc-absent = empty-not-error (RESEARCH §5). Independent of the terminal
     story (02) by the disjoint route namespace; it emits the thin "selected ref + provider" launch
     contract 02 consumes but does not depend on 02. -->

## Tasks

- [x] `tasks/00_board-renders-stream.feature` — the board fetches `/api/work/list` (the ADR-002 contract,
  fixtured) and renders the hierarchical tree (milestones → stories → tasks; uat at depth 0), derived
  status chips, expand/collapse, and single-select that drives the detail panel; empty/loading/error states
- [x] `tasks/01_detail-shows-records.feature` — selecting an item opens the detail panel; the doc switcher
  flips the body between SPEC|STORY · VERIFICATION · RETROSPECTIVE · Findings (resolved at
  `path.join(dir,'<DOC>.md')`); a doc the item doesn't have yet shows an empty placeholder, NOT an error
- [x] `tasks/02_add-feedback.feature` — Add feedback appends ONE attributed bullet under the selected
  milestone/story's STATE `## Feedback (for retro)` (creating the heading if absent), in the
  `- <note> — Raised by: <actor>   Refs: <…>` format; this is the board's only filesystem write
- [x] `tasks/03_validate-stream.feature` — Validate calls `validateWork` in-process and renders the
  findings (path · problem) or a positive "no issues" line; scoped to the selection where applicable
- [x] `tasks/04_next-item.feature` — Next calls `nextWork` in-process and surfaces the returned item
  (ready / blocked-with-waiting-on / done), revealing/selecting the next item on the board
- [x] `tasks/05_serve-board-same-origin.feature` — `@bug @finding-F1`: a first-class command serves the
  BUILT board (`ui/dist`) same-origin via `serveSetupUi`, so `/api/work*`, `/ws/terminal`, and the bundle
  share one 127.0.0.1 origin (the relative API fetches + the `window.location.host` WS both resolve);
  a missing build is reported, not silently served from source. Clears the F-1 launch gap.

## Notes

Inherits the milestone ADRs + DESIGN. The cross-story seam is the **locked `work list --json` contract**
(ADR-002), consumed here as a fixture — this story does not import story 00's CLI. Owns the `/api/work*`
namespace (ADR-001) and the sole board write (ADR-004); guarded by `acd-board-single-server` and
`acd-board-write-isolation`. The chunky-but-cohesive five tasks all live in the one React surface and
share the selection-as-context state (DESIGN), which is why board+detail+actions are one story, not three
(ADR-005 Alternatives). Build WITH the existing `ui/src/components/ui` kit — introduce no new design
system (DESIGN §Intent).
