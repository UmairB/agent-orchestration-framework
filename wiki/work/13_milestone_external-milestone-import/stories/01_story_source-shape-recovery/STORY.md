---
type: story
number: 01
slug: source-shape-recovery
title: "Source-shape recovery — aof-structured AND arbitrary repos into the frozen artifact set, recovering what is present, never fabricating"
parent: 13
status: done
owner: product-owner
created: 2026-06-22
updated: 2026-06-23
schema: 1
aofVersion: 0.1.0
---
# 01 · Source-shape recovery — what the import actually recovers

## User story

As the ACD agents who can only learn from prior art they can recall,
I want recovery to turn a source repo — whether **aof-structured** (its own SPEC / ARCHITECTURE / RETROSPECTIVE) or **arbitrary** (README, `docs/`, ADRs, commit history) — into story 00's frozen materialize artifact set, recovering only what is **present** and **marking what is absent** (never inventing a SPEC objective, decision, or lesson the source never had),
so that the precedent the agents recall is grounded in what a milestone *actually did*, not in a plausible fiction — because fabricated precedent is worse than none.

<!-- This is the "source-shape tolerance" + "absence is information" half of the SPEC. It is a pure
     source → artifact-set transform behind story 00's FROZEN materialize signature: it owns the
     recovery heuristics (how to read an aof-shaped source vs an arbitrary one) and the
     no-fabrication discipline. It owns NO command wiring (story 00), NO indexer change (story 02),
     NO arch-tests (story 03). The user offered example source repos at refine — collect them here to
     ground the heuristics on real shapes (a default was taken to proceed on aof-shape + a generic
     arbitrary fallback if none arrive; see STATE). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 13 --autonomous`): PO headline Scenarios +
     aof-qa Examples tables/tagging + aof-developer feasibility. @executable runs against fixture
     source repos (aof-shaped + arbitrary); a real-world arbitrary repo recovery is @manual. -->

- [x] `tasks/00_recovers-aof-structured-milestone.feature` — given an aof-structured source milestone, recovery materializes the pair faithfully (recovered intent → `SPEC.md`; the source's own ADRs → `ARCHITECTURE.md`-shaped; its R-entries → `RETROSPECTIVE.md`-shaped) with every recovered record traceable to recovered source content. *(@executable scenarios green; `test/import-recovery.test.mjs` recovery/00.)*
- [x] `tasks/01_recovers-arbitrary-repo.feature` — given an arbitrary repo (README, `docs/`, ADR files, git log), recovery materializes what is present: intent from the README/overview, decisions from docs/ADRs, outcomes/lessons from history — written INTO the 05 doc shapes. *(@executable rows green; recovery/01. The @manual real-world-repo recovery row is DEFERRED — no example repos were supplied to this run.)*
- [x] `tasks/02_absence-is-information.feature` — when the source lacks a recoverable intent / decision set / outcome, the artifact records the **absence** (an explicit "not recoverable" marker, empty of records) and recovery emits **no** record not grounded in recovered source content. *(@executable scenarios incl. the 2³ truth table green; recovery/02.)*

**Three-Amigos pass (`2026-06-22`, `aof:refine 13 --autonomous`):** PO headline Scenarios + aof-qa Examples
tables/tagging (the `02_absence-is-information` 2³ truth table is the key matrix) + aof-developer
feasibility. **Developer verdict: BUILDABLE-WITH-NOTE** — a pure source→artifact transform behind story
00's frozen materialize signature; the parser round-trip Thens reuse `parseArchitecture`/`parseRetrospective`
exactly. **Build-time decisions to carry into `aof:continue 13/01`:**
- **Canonical absent-marker constant** — pin ONE legible `SPEC.md` note string (recovery emits it, every
  absence-row Then asserts it; e.g. `_Intent not recoverable from source._`). It is a legible note, never a
  parsed field (ADR-001: `SPEC.md` is never an index record source). Both this story's aof-structured
  matrix and `02_absence-is-information` assert the SAME constant so they cannot drift.
- **Recovery must emit parser-clean headings** — for the arbitrary lane to yield records, recovered
  decisions/outcomes must be written in EXACTLY the `## ADR-NNN` + `**Status:**` and `## R<n>` +
  inline-field conventions the existing parsers read; prose instead silently yields zero records (the
  story-03 `acd-import-artifact-shape` floor also catches this).
- **Arbitrary fixture with git history** — `git init` + scripted commits in a temp dir (offline-feasible)
  via the shared `makeGitFixtureRepo` helper, so `git log`→`RETROSPECTIVE.md` recovery has real content.
- **Collect the user's example repos at build** (`aof:continue 13/01`) — the @manual real-world recovery
  row + to refine the arbitrary heuristics on real shapes (see STATE default decision).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** the artifact pair + reuse of
the 05 `ARCHITECTURE.md`/`RETROSPECTIVE.md` heading conventions so the EXISTING parsers index the output;
**ADR-002** the read-only source access recovery reads through; **ADR-005** "absence is information" — no
fabrication — and the derived-index floor: no record is produced that the materialized `.md` does not
contain). This story **owns** the recovery heuristics: the aof-structured reader (recovering a source
milestone's SPEC intent + its ADRs + its R-entries) and the arbitrary-repo reader (README/`docs/`/ADRs/git
log → the same doc shapes), plus the no-fabrication / mark-the-absence discipline. It **produces** story
00's frozen materialize input; it does **not** register the command, write the store, or touch the indexer.

**Independent because** it is a pure transform behind story 00's frozen materialize signature —
fixture-testable against a few example source repos (aof-shaped + arbitrary) with NO command wiring and NO
indexer. It couples to 00 only through the materialize-input shape and to the milestone only through the
05 doc conventions (`05/ADR-005/007`) it writes into. **Collect the user's example repos here** to ground
the heuristics; absent them, the default (proceed on aof-shape + a generic arbitrary fallback, refine
heuristics on real shapes at build) is recorded in STATE.
