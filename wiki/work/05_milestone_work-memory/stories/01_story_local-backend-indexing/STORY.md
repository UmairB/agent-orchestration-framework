---
type: story
number: 01
slug: local-backend-indexing
title: "Local backend — source parsers → derived index"
parent: 05
status: done
owner: product-owner
created: 2026-06-19
updated: 2026-06-19
schema: 1
aofVersion: 0.1.0
---
# 01 · Local backend — source parsers → derived index

## User story

As an ACD maintainer running memory locally,
I want `reindex`/`ingest` to reconstruct a derived index of the work stream's RETROSPECTIVE lessons and ARCHITECTURE ADRs from the `.md` files alone (with `status` reporting what's there),
so that memory is always a rebuildable, source-traceable index — never an authoritative second copy that could drift from the docs it summarises, which is the very failure mode ACD exists to defend against.

<!-- This is the one story that owns new persisted-on-disk state. Its load-bearing job is to keep that
     state honest: a fresh reindex reproduces it, and every record traces to live source text. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 05/01`). Each task is done when its @executable
     feature is green; the @manual live-stream observation is recorded in the milestone VERIFICATION.md. -->

- [x] `00_parse-retrospective-lessons.feature` — a RETROSPECTIVE `R<n>` entry → a `lesson` MemoryRecord with the frozen fields populated (adr-only `status` present-as-`""`).
- [x] `01_parse-architecture-adrs.feature` — an ARCHITECTURE `ADR-NNN` block → an `adr` MemoryRecord (`area` always `"architecture"`; lesson-only fields present-as-`""`; `status` from the ADR).
- [x] `02_reindex-builds-derived-index.feature` — `reindex` reconstructs the frozen index document at `.aof/aof.memory.index.json`, scans every milestone, `--item NN` scopes it, `ingest` aliases it.
- [x] `03_index-location-and-gitignore.feature` — the index is written only to the fixed path and `reindex` adds it to `.gitignore` (idempotently).
- [x] `04_status-reports-the-store.feature` — `status` reports `{ backend, recordCount, store location, lesson/adr split }` and never throws on an absent store.
- [ ] `05_live-stream-corpus.feature` — `@manual` agent observation: `reindex` over the live aof stream matches the real RETROSPECTIVE+ADR corpus (build-time observation captured in STATE; recorded/signed-off in VERIFICATION.md at `aof:verify`).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md). This story **owns**: the two source
parsers (RETROSPECTIVE `R<n>` entries → `lesson` records; ARCHITECTURE `ADR-NNN` blocks → `adr`
records — ADR-007), the index writer at the fixed path `.aof/aof.memory.index.json` **plus its
`.gitignore` entry** (ADR-005), the local backend's `reindex`/`status`, and **the derived-index
invariant implementation** (ADR-001) — a fresh `reindex` fully reconstructs the store and every
record's `source` (`path:line`) resolves to live text.

**Independent because** it only *writes* the **frozen `MemoryRecord` + index format** (ADR-005) that
story 02 *reads*, and it implements the **frozen backend interface** (ADR-003) — not the seam's argv
(story 00). The `.gitignore` entry is its own deliverable (ADR-005), not implicit. Its invariant work
is the natural home of the `acd-memory-derived-index` fitness function. The only milestone-level
artifact dependency is at *integration* (an end-to-end demo wants a real index here), not at build
time — story 02 builds against a fixture. Couples to 00/02 only through ADR-003/005.

**Feasibility (developer's amigo seat): no blocking concern.** The spike (`spike/memory-spike.mjs`)
already parsed exactly these two source kinds into 21 attributed records against the real stream, so
parsing/indexing is proven; the backend module itself is built at `aof:continue`. One real (non-
blocking) deliverable to flag: `.aof/` is currently git-tracked in this repo, so the `.gitignore`
entry for `.aof/aof.memory.index.json` is a genuine, observable outcome (task `03`), not a no-op.

**Boundary held vs the Fitness functions table:** the universal "a fresh reindex reproduces the index
AND every record's `source` resolves to live text" guarantee (`acd-memory-derived-index`) and "written
only to the fixed path, git-ignored, each record matches the frozen shape" (`acd-memory-index-
location`) stay as arch-tests — the features give concrete, example-driven behaviour (this R-entry →
this record; reindex writes this format; status reports this) and deliberately do **not** restate
those universal invariants as scenarios.
