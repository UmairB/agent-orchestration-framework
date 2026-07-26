---
type: story
number: 01
slug: coherence-and-completeness-checks
title: "Coherence & completeness checks — the cross-item status and docs-for-status check-groups"
parent: 15
status: done
owner: product-owner
created: 2026-06-25
updated: 2026-06-25
schema: 1
aofVersion: 0.1.0
---
# 01 · Coherence & completeness — the frontmatter-reading check-groups

## User story

As an operator who wants the health lane to catch the incoherence `aof work validate` is blind to,
I want two check-groups plugged into the doctor engine — **status coherence** (a `done` milestone hiding a non-`done` child; a `not-started` milestone over a started child; a `done` story under a `not-started` milestone; a `depends`-blocked driver already `in-progress`) and **lifecycle completeness** (an `in-review`/`done` milestone with no `VERIFICATION.md`; a `done` milestone with no `RETROSPECTIVE.md`; a past-`not-started` milestone with zero stories; a started story with an empty `tasks/`; a milestone with stories but no `ARCHITECTURE.md`),
so that a stream that passes validate but hides a lying parent or a missing close-convention doc now surfaces each as a coded, severity-tagged `work:doctor` finding.

<!-- The two groups read ONLY frontmatter status + the presence/absence of docs across the item tree —
     no file mtimes, no folder-name structure (that is story 02). Each is a PURE
     (snapshot, ctx) => Finding[] function APPENDED to story 00's registry; neither edits the spine
     nor story 02's groups. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 15/01`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. The OBSERVABLE
     check behaviour lives here; the envelope shape is story 00's arch-test. -->

- [x] **00 · [status-coherence](tasks/00_status-coherence.feature)** — the cross-item status group: `lying-parent`, `stale-parent`, `story-done-under-not-started`, `depends-blocked-in-progress`. A Scenario Outline over fixtures → the expected `code`/`severity`; a coherent stream → no findings.
- [x] **01 · [lifecycle-completeness](tasks/01_lifecycle-completeness.feature)** — the docs-for-status group: `missing-verification`, `missing-retrospective`, `milestone-no-stories`, `started-story-no-tasks`, `missing-architecture`. A Scenario Outline over fixtures → the expected `code`; a complete-for-its-status item → no findings.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (ADR-001 the codes/severities · ADR-003
the pure-check-group contract). This story **owns** the status-coherence and lifecycle-completeness
check-group functions — each appended to the registry story 00 freezes (`doctorWork`'s group array). It
reads the snapshot's per-item frontmatter (`status`/`parent`/`depends`) and the presence of
`VERIFICATION.md` / `RETROSPECTIVE.md` / `ARCHITECTURE.md` / `stories/` / `tasks/` — it does **not** read
mtimes or scan folder names (story 02), and does **not** touch the spine, the faces, or story 02's groups.

**Independent because** it only *appends* its group functions to the engine's array (additive,
order-independent — the engine concatenates + de-dupes); it shares no function body with story 02 and
consumes only story 00's frozen registry + envelope. Build-time it needs story 00's spine to exist; it is
otherwise parallel to stories 02 and 03.

**Feasibility (developer amigo seat — confirmed at Contract):** every fact each check needs is already in
the snapshot story 00 builds (`listItems` gives the parent/child tree and per-milestone `stories/`;
`readMeta` gives `status`/`parent`/`depends`; a `tasks/`/doc presence probe is a `readdir`/`stat`). No new
model code — pure functions over the snapshot. The one judgment is the code→severity map (coherence
violations are `error`; an advisory like a `done` milestone missing a `RETROSPECTIVE.md` may be `warn`) —
QA fixes each in the Examples table at Contract.
