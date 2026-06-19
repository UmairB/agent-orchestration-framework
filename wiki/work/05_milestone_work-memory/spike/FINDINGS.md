# Spike findings — `aof work memory` verb shape

> Throwaway spike (see `memory-spike.mjs`). Run against the **real** work stream (milestones 00–04).
> Purpose: feel out the verb shape and de-risk the contract before `aof:refine 05`. Not the deliverable.

## What it proved

1. **ACD artifacts parse into memory records with zero extra authoring.** `reindex` pulled **21
   records** straight from existing files — **4 lessons** (RETROSPECTIVE `R<n>` entries) + **17 ADRs**
   (ARCHITECTURE `ADR-NNN`) — with their fields intact (kind/area/stage/owner for lessons;
   status/decision/invariant for ADRs). The corpus is *pre-curated*; we are not indexing chat logs.
2. **Recall surfaces the right lesson at decision time.** "content addressed hash cross platform" →
   **R2 (pin line endings)** as #2 of 5 (score 25, neck-and-neck with its own ADR-002). "fitness
   function asserts a symbol appears in a file" → **R1 (requiring-grep smell)** in the top 3. The
   core "agents improve over time" loop demonstrably works on real data.
3. **The store is a derived index.** `reindex` reconstructs `.memory-index.json` from scratch off the
   `.md` files every run; every record carries a `source: path:line` back-reference and restates
   nothing authoritatively. The single-source-of-truth invariant holds and is mechanically checkable.
4. **`ingest` == `reindex` for the local backend.** Same verb, same record shape; only the write
   target differs. This is the seam working: a semantic backend (MemPalace) overrides the write/score
   path **behind identical verbs** — no agent prompt changes.

## The verb shape that felt right

```
aof work memory recall "<query>" [--area --stage --kind --owner --item --limit --json]   # read at Decide/Build
aof work memory brief [--item NN]                                                         # cheap situational digest
aof work memory ingest <item|--all>                                                       # write at Accept
aof work memory reindex [--item NN]                                                       # rebuild derived index
aof work memory status                                                                    # backend + counts
```

Keep `recall` + `reindex` + `status` as the spine; `brief` and `ingest` are thin conveniences over them.

## Findings that should shape the contract (carry into refine)

- **F1 — Ranking, not parsing, is the hard part.** Naive term-frequency scoring is noisy: a long ADR
  can outrank the more on-point one-line lesson purely because it repeats query terms (ADR-005
  out-scored R1 in scenario 1). On a *small, curated* corpus the fix is cheap — length-normalised /
  IDF (BM25-lite) scoring, and/or a record-type boost so a "how should I do X" query prefers
  `lesson` over `adr`. This is also the clearest signal for *when* a semantic backend earns its keep:
  the day filter+keyword stops surfacing the right record at #1.
- **F2 — Scope filters carry real weight; they may be enough for v0.** `--kind near-miss`,
  `--area architecture` cleanly isolate lessons. Because every record already has these fields, scoped
  retrieval is high-precision without embeddings. Recommend the contract make scope filters
  first-class and *test recall precision under scope*, not just raw keyword recall.
- **F3 — The corpus is ADR-heavy early (17 vs 4).** Only milestone 01 has a RETROSPECTIVE so far, so
  memory's lesson-value compounds slowly; ADRs are the bulk of early signal. The read path must weight
  **both** record types, and `brief` should make the lesson/ADR split visible (it does).
- **F4 — Index location & ignore.** The real index belongs at `.aof/aof.memory.index.json` (derived,
  git-ignored), not in the work tree. The spike wrote `.memory-index.json` inside `spike/` to avoid
  polluting `.aof/`; delete it when done — it is regenerable.
- **F5 — Sources beyond retro+ADR.** The spike indexes only RETROSPECTIVE + ARCHITECTURE. STATE's
  `## Feedback (for retro)` inbox and VERIFICATION findings are candidate sources too; decide the
  source set in the contract (each must be a *referenced*, rebuildable source, per the invariant).

## Open questions for `aof:refine 05`

- Does `recall` return text for a human, or structured JSON for an agent to fold into its prompt
  (the spike does both via `--json`)? The agent-injection path (refine/continue/verify wiring) is
  explicitly out of milestone 05 scope, but the **return contract** must anticipate it.
- Is the backend interface a small JS module contract (`recall/ingest/reindex/status`) selected by
  `memory.backend`, mirroring how adapters/packages are already pluggable? (Recommended — matches the
  existing aof seam pattern.)
- What's the fitness function that enforces F-invariant "memory holds no fact absent from its source"?
  Likely: reindex into a temp store, assert every record's `source` resolves to live text in the
  named file at/after the recorded line.
