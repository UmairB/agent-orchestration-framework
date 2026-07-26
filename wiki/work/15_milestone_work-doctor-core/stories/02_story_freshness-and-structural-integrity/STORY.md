---
type: story
number: 02
slug: freshness-and-structural-integrity
title: "Freshness & structural integrity — the date-sanity and folder-first check-groups"
parent: 15
status: done
owner: product-owner
created: 2026-06-25
updated: 2026-06-25
schema: 1
aofVersion: 0.1.0
---
# 02 · Freshness & structural integrity — the metadata-reading check-groups

## User story

As an operator who wants the health lane to catch stale dates and malformed folder structure,
I want two check-groups plugged into the doctor engine — **freshness / date sanity** (an `in-progress` item whose `updated` is stale beyond a configurable window; `updated < created`; a non-ISO / unparseable date; a folder file newer than `updated`), driven by an **injected clock** so every finding is deterministic, and **structural integrity** (folder-first: a numbering gap in the driver sequence; a duplicate top-level driver number; an orphan folder that does not match the item-name pattern; plus a dormant ROADMAP↔folder cross-reference that is an honest no-op until a structured milestone index exists),
so that a stream that passes validate but hides a months-stale `in-progress` item, a typo'd folder `listItems` silently drops, or a duplicate driver number now surfaces each as a coded `work:doctor` finding — reproducibly in CI.

<!-- The two groups read file/folder METADATA beyond frontmatter — the snapshot's per-item folder
     mtimes, parsed `created`/`updated` dates against the injected `now`/`staleWindow`, and the raw
     workDir directory listing for orphan/gap/duplicate detection. Each is a PURE
     (snapshot, ctx) => Finding[] function APPENDED to story 00's registry; neither reads the wall-clock
     (the clock is injected via ctx) nor edits the spine or story 01's groups. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 15/02`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. The injected-clock
     determinism + the no-wall-clock guarantee are story 00's arch-tests; the OBSERVABLE check
     behaviour (incl. a pinned-`now` scenario) lives here. -->

- [x] **00 · [freshness-date-sanity](tasks/00_freshness-date-sanity.feature)** — the date group via the injected clock: `stale-updated` (beyond `staleWindow` relative to `now`), `updated-before-created`, `unparseable-date`, `mtime-ahead-of-updated`. A Scenario Outline keyed on a pinned `now` + fixture → the expected `code`; a fresh, well-dated item → no findings.
- [x] **01 · [structural-integrity](tasks/01_structural-integrity.feature)** — the folder-first group: `numbering-gap` (warn), `duplicate-driver-number` (error), `orphan-folder` (warn — a dir not matching the item pattern), plus the opt-in `roadmap-folder-mismatch` that emits NOTHING with no structured index and fires only when a structured index fixture mismatches the folders.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (ADR-003 the injected clock · ADR-004
folder-first ROADMAP / the documented opt-in-no-op default). This story **owns** the freshness/date-sanity
and structural-integrity check-group functions — each appended to the registry story 00 freezes. It reads
the snapshot's per-item folder mtimes + parsed dates against the injected `now`/`staleWindow`, and the raw
`workDir` listing (for gap/duplicate/orphan via `ITEM_RE`). It does **not** read the wall-clock (`now`
arrives through `ctx`), does **not** parse any ROADMAP prose (the cross-reference activates only on a
structured index), and does **not** touch the spine, the faces, or story 01's groups.

**Independent because** it only *appends* its group functions to the engine's array (additive,
order-independent); it shares no function body with story 01 and consumes only story 00's frozen registry +
envelope + the injectable `now`/`staleWindow`. Build-time it needs story 00's spine; it is otherwise
parallel to stories 01 and 03.

**Feasibility (developer amigo seat — confirmed at Contract):** the mtime probe is the one FS read beyond
`listItems`/`readMeta`, and ADR-003 folds it into the single snapshot build (taken once, handed to the
group as data) — so the group stays pure and the engine stays clock-free. Numbering-gap / duplicate-driver
/ orphan are pure functions of the `listItems` set + the raw directory listing + `ITEM_RE`. The
ROADMAP cross-reference is a dormant, contract-shaped hook (ADR-004) — built but inert here because no
structured index exists; its only Contract obligation is the no-op scenario (a prose-ROADMAP stream emits
no roadmap finding) plus an opt-in-active scenario over a structured-index fixture.
