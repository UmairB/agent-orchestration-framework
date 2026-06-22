---
doc: retrospective
ref: "10"
---
# 10 · Graphify Memory Backend — Retrospective

Distilled lessons from how execution actually went. One `R<n>` per lesson; append-only, never renumber.
Clean catches with no process lesson are not entries — they live in VERIFICATION/STATE. This milestone
had **no blocker stops**; its one VERIFICATION finding (F-01, the half-covered derived-store git-ignore)
was a non-blocker fixed in place at the verify gate. The lessons below come from the STATE
`## Feedback (for retro)` notes (now archived) and F-01: R1–R2 are the story-01 normalizer extraction;
R3 is the F-01 git-ignore gap. (Fittingly for the milestone that *ships* the graphify memory backend:
the repo's own `memory.backend` stays `none`, so the verify `ingest` hook was a no-op here — these
lessons become recallable the moment a project opts a backend in.)

## R1 — When one ADR says "use helper X from module M" and another guard forbids importing M, reconcile at refine — the contradiction is latent until a story needs X

- **Kind:** near-miss · **Area:** contract · **Stage:** refine→build · **Owner:** architect · **Raised by:** PO (story-01 Contract)
- **What happened:** ADR-002 said `recall` reads the built graph "via the on-disk `graph.json` using `readGraph`/`normalizeGraph`" — pure helpers that live in `src/graphify.mjs`. But the story-03 fitness guard `acd-graphify-backend-via-command` (also ADR-002/006) forbids the backend importing `src/graphify.mjs` at all. The two readings contradict: ADR-002 permitted an import its own guard outlaws. Story 00 sidestepped it (its `recall` stub did no graph read), so the contradiction stayed latent until story **01**, the first to actually read the graph, hit it at build.
- **Why:** the ADR named the helper by its *current module* rather than as a *capability*, and no story before 01 exercised the seam — so the ADR-vs-guard tension wasn't forced until a builder needed it.
- **Lesson:** when an ADR says "use helper X" and another ADR/guard constrains *where X may be imported from*, resolve the home at **refine** — name the shared-module extraction in the ADR — so the build is not where the seam is discovered. Resolved cleanly (no ADR re-opening) by extracting the pure `readGraph`/`normalizeGraph`/`graphJsonPath` into a new spawn-free `src/graph-normalize.mjs`; `graphify.mjs` re-imports them (09 behaviour-preserved), the backend imports the shared module, and both ADR-002 ("read via the pure helpers") and the guard ("never import `graphify.mjs`") hold.
- **Refs:** ADR-002; story-01 STORY.md "Contract decision locked"; `src/graph-normalize.mjs`; the guard `test/arch/acd-graphify-backend-via-command.test.mjs`.

## R2 — A file-pinned source-grep fitness test silently breaks (or weakens to vacuity) when a re-exported helper is extracted to a new module — follow the function, not the file

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** developer · **Raised by:** developer (story-01 build)
- **What happened:** extracting `readGraph` out of `src/graphify.mjs` into `src/graph-normalize.mjs` (R1's fix) broke the 09 fitness test `acd-graph-privacy-boundary`, which asserted "the driver READS only the graph artifact" by requiring **≥1 `readFile*` call in `src/graphify.mjs`** — now zero, since the sole read moved. A re-export kept every *importer* working, so behaviour was preserved, but the *file-scoped* grep was now pointing at a module with no reads: it would have failed, and a careless fix (just dropping the `≥1` floor) would have *silently weakened* the egress guard to vacuity.
- **Why:** the fitness test pinned a behaviour to a specific *file* via source-grep, but the behaviour (where the graph is read) is a property of a *function* that can move across a re-export without changing the public surface.
- **Lesson:** a source-grep fitness test that asserts "module M does/doesn't do Y" is fragile to behaviour-preserving extraction — when a re-exported helper may move, make the assertion **follow the function** (scan every module that defines it, or assert on the import-graph/behaviour) rather than a single file. Fixed by scanning BOTH `graphify.mjs` and `graph-normalize.mjs` with the identical per-read assertions; coverage widened (the new module is now policed), the egress invariant genuinely preserved.
- **Refs:** `test/arch/acd-graph-privacy-boundary.test.mjs`; `src/graph-normalize.mjs`; rhymes with 05/R3 (a test leaning on something not part of the contract).

## R3 — When you add a derived artifact that mirrors an existing one, extend the FULL ignore baseline and assert every store — a half-covered git-ignore passes a green suite and a structural review that only checks the new-and-obvious artifact

- **Kind:** near-miss · **Area:** architecture · **Stage:** verify · **Owner:** developer · **Raised by:** developer (@manual live verify) / PO (triage)
- **What happened:** the graphify backend has TWO derived artifacts: the graph under `graphify-out/` and its record store `.aof/aof.memory.graphify.index.json`. Story 00 wired a fresh `ensureGraphifyOutGitignore` for the conspicuous `graphify-out/` graph, but left the record store out of the `.aof/.gitignore` baseline (`AOF_GITIGNORE_ENTRIES` named only the *local* backend's `aof.memory.index.json`). Build was green and the structural review confirmed the `graphify-out/` ignore — but neither caught the *second* store, because no test reindexed-then-checked-git for it. It surfaced only at the live `@manual` verify, when a real `reindex` left `?? .aof/aof.memory.graphify.index.json` in `git status` — a derived store one `git add .` away from becoming the authoritative-second-copy the derived-index invariant exists to forbid (10/ADR-005).
- **Why:** a new derived store mirroring an existing one needs the SAME ignore discipline, but the obvious/new artifact (`graphify-out/`) drew all the attention; the parallel store inherited none of the existing baseline.
- **Lesson:** when adding a derived artifact that mirrors an existing one (a second memory store beside the local store), extend the **full** ignore baseline for *both*, and make the derived-index fitness assert **every** derived store is git-ignored — a half-covered ignore is invisible to a green behavioural suite and to a review that only inspects the new artifact. Fixed at the gate: `aof.memory.graphify.index.json` added to `AOF_GITIGNORE_ENTRIES`; the story-03 `acd-graphify-derived-index` test now pins BOTH the `graphify-out/` graph and the `.aof` store as ignored, so the gap cannot recur.
- **Refs:** VERIFICATION F-01; `src/aof-gitignore.mjs` (`AOF_GITIGNORE_ENTRIES`); `test/arch/acd-graphify-derived-index.test.mjs`; ADR-005.
