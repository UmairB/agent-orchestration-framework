---
type: story
number: 08
slug: worker-verified-memory-syncback
title: "A milestone/story verified on a worker updates the control node's memory"
parent: 38
status: in-progress
owner: product-owner
created: 2026-07-18
updated: 2026-07-18
schema: 1
aofVersion: 0.1.0
---

## User story

As the operator, I want the project memory on the CONTROL node to update when a milestone/story is
completed and verified on a WORKER, so that the knowledge produced remotely (retrospective lessons, ADRs,
the verified record) is recallable on the control node in the next `aof:refine`/`aof:continue` — not
stranded on the worker.

## Background

Requirement set by the operator 2026-07-18, reiterated: *"If a milestone is completed on a worker →
control node memory should update."* See `RESEARCH.md § 4.4/4.5`.

The durable knowledge a verify produces (RETROSPECTIVE `R<n>` lessons, `ADR-NNN` blocks, updated record
docs) is **plain markdown committed into the repo** — so once story-07's push-back lands and the branch
merges, it travels to the control node by ordinary `git pull`. The graphify RECALL INDEX
(`<projectRoot>/graphify-out/graph.json`, `src/graph-normalize.mjs`) is **gitignored and machine-local by
design** (`.gitignore:4`, enforced by `src/aof-gitignore.mjs`) — a DERIVED cache rebuilt from the markdown,
never transmitted over the mesh. `aof work memory ingest` only updates whichever machine runs it.

**So there is nothing to send over the mesh.** The control node just needs, after a worker-verified
milestone/story's branch merges: `git pull` its own checkout + `aof work memory ingest` to rebuild ITS
index from the now-shared markdown. This story decides and builds whether that is a documented manual step
or an automatic re-ingest (e.g. the control node re-ingests on detecting a merged worker branch / a
worker-`done` assignment whose record docs changed).

## Tasks

<!-- Contract authored `2026-07-18` via `aof:refine 38 --autonomous` (Three Amigos). Refine DELIVERED the
     owed ADR: ARCHITECTURE ADR-016 — durable knowledge (record docs, RETROSPECTIVE `R<n>`, `ADR-NNN`) rides
     GIT on story-07's merge (no wire protocol); the graphify index (`graphify-out/graph.json`) is gitignored /
     derived / machine-local and NEVER crosses the mesh; the control node rebuilds its OWN index. TRIGGER
     (documented default) = a documented MANUAL `git pull` + `aof work memory ingest` on the control node after
     the worker branch merges (auto re-ingest on merge / `done`-with-record-doc-change noted as the richer
     future option). Tasks 00–01 `@executable` over a real local checkout + the real `ingest`/`recall` (no
     mesh); task 02 the real-mesh end-to-end `@manual` soak. Depends on story 07 (durable output first). -->

- [ ] `tasks/00_knowledge-rides-git-not-mesh.feature` — `@executable` — the sync-back payload is plain committed
  markdown; NO index/graph bytes (`graphify-out/graph.json`) cross ANY mesh frame — fitness
  `acd-memory-index-never-on-mesh`; the index stays gitignored + derived + machine-local. A structural Outline
  enumerates the mesh frame vocabulary (`directive` + the additive `clone-credential`/`clone-url` down-frames,
  the `{kind,nodeId,signal}` up-envelope, `{type}` control-frames) asserting none has a slot the index could ride.
- [ ] `tasks/01_control-reingests-own-checkout.feature` — `@executable` — after a worker-verified branch merges
  into the control node's checkout, the documented `git pull` + `aof work memory ingest` step rebuilds the
  CONTROL node's OWN index from the now-shared markdown; a lesson/ADR authored on the WORKER becomes present in
  the control's rebuilt index (absent-before / recallable-after, over a real local checkout + real ingest/recall).
- [ ] `tasks/02_worker-verified-recall-soak.feature` — `@manual` — the end-to-end real-producer outsider check
  (ADR-008; the story that makes m38 a mesh doing REAL verified work): a story VERIFIED on a REAL worker (its
  lesson/ADR committed + pushed via story-07 + merged) → after the CONTROL node runs `git pull` + `aof work
  memory ingest`, that exact lesson is RECALLABLE via `aof work memory recall` ON THE CONTROL node (it was NOT
  before); plus the negative half (branch pushed-not-pulled → control recall stays empty, proving nothing rode
  the wire). Deferred human gate — closed at `aof:verify 38`.

## Notes

Depends on story-07 (durable output first — memory can only sync once the markdown actually reaches the
control node's checkout). The mesh stream carries nothing here; knowledge rides git, the index is rebuilt
locally. This is the last story that makes milestone 38 a mesh that does REAL verified work end-to-end.
