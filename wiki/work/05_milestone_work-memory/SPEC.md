---
type: milestone
number: 05
slug: work-memory
title: "Work Memory"
status: done
owner: product-owner
created: 2026-06-19
updated: 2026-06-19
depends: [00]
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 05 · Work Memory

## Objective

Give ACD agents a memory so they **improve over time**. Today every milestone's hard-won lessons —
the difficulties and bad decisions distilled into `RETROSPECTIVE.md`, the rationale captured in
ADRs — are siloed in the folder that produced them; nothing carries them into the next milestone.
An architect about to repeat the "requiring-grep" mistake (R1) or a developer about to forget to
pin line endings (R2) has no way to be told "we already learned this."

This milestone adds a **memory seam in the CLI** — `aof work memory ...` — that any ACD agent or
command can call to recall relevant prior lessons at decision time and to ingest new ones at Accept.
The seam is **backend-agnostic by contract**: a trivial local backend ships here; richer semantic
backends (e.g. MemPalace) plug in behind the same verbs later without touching a single agent
prompt. An outsider can verify the objective is met when, building milestone N+1, an agent's recall
surfaces a lesson first written in milestone N.

The load-bearing constraint: memory is a **derived index**, rebuildable from the work-stream `.md`
files — never an authoritative second copy. This preserves ACD's single-source-of-truth principle;
without it, memory becomes the very drift vector ACD exists to defend against.

## Scope

In scope:
- A stable `aof work memory` CLI surface (recall / brief / ingest / reindex / status) — the seam ACD
  agents call, independent of any backend.
- A zero-dependency **local backend** as the default: structured retrieval over `RETROSPECTIVE.md`
  R-entries and `ARCHITECTURE.md` ADRs across the work stream, scoped by their existing fields
  (area / stage / kind / owner / item).
- Backend selection in `.aof/aof.config.json` (`memory.backend`), with `none` as a graceful no-op so
  ACD runs unchanged when memory is absent.
- The **derived-index invariant** enforced structurally: `reindex` fully reconstructs the store from
  the `.md` files; a fitness function asserts memory holds no fact absent from its source.
- The **read/write hooks** that make the seam actually used: `refine`/`continue` recall relevant prior
  lessons at a decision point and surface them before the agent decides; `verify` ingests the new
  milestone's lessons at Accept. Without this the objective ("agents improve over time") is unmet — a
  seam nothing calls improves nothing. (Added after the seam was proven; see story `03`.)

Out of scope:
- The MemPalace (or any semantic/vector) backend itself — it plugs in behind this seam in a later
  milestone; this one proves the seam earns its keep with the cheap backend.

## Stories

The seam itself is **three independent stories** that couple only through the **locked shared contracts**
in [ARCHITECTURE.md](ARCHITECTURE.md) — the backend interface (ADR-003), the `RecallResult` return
shape (ADR-004), and the `MemoryRecord` + index format (ADR-005). The seam builds against an in-memory
stub; retrieval builds against a hand-authored fixture index; only indexing touches the real on-disk
store — so all three parallelise. A fourth story (`03`) then **uses** the proven seam: it wires the
read/write hooks into the bundled `refine`/`continue`/`verify` commands, so it builds *on* `00`–`02`
(sequential, not parallel). See ARCHITECTURE.md for the ADRs and fitness functions.

- [x] `00_story_memory-seam` — the `aof work memory` verb surface (recall / brief / ingest / reindex / status), `memory.backend` config selection (+ the `$defs/memory` schema change), and the `none` no-op backend; dispatches to the configured backend through the frozen interface
- [x] `01_story_local-backend-indexing` — the local backend's parsers (RETROSPECTIVE R-entries + ARCHITECTURE ADRs → records) and derived index at `.aof/aof.memory.index.json` (git-ignored); `reindex`/`ingest`/`status`; owns the derived-index invariant (a rebuild reproduces it; every record traces to live source)
- [x] `02_story_local-backend-retrieval` — the local backend's `recall`/`brief`: first-class scope filters (area/stage/kind/owner/item) as a hard pre-filter, then BM25-lite length-normalised ranking + record-type boost so a short on-point lesson beats a long term-heavy ADR
- [x] `03_story_memory-hooks` — **wire the seam into the loop**: `refine`/`continue` recall scoped prior lessons and surface them before the agent decides; `verify` ingests the accepted milestone's lessons; every hook is a silent no-op when `memory.backend` is `none`. Turns the callable seam into a used one (the objective)

## Dependencies

- **00 · work-cli** — `aof work memory` extends the `aof work` command surface and reuses its
  work-stream item resolution (folder ↔ frontmatter, item types).
