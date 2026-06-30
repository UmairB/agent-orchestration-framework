---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 19 · Work-Run Lifecycle — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-27` by `aof:shatter` from [PRD-work-run-orchestration](../../planning/PRD-work-run-orchestration.md)
  (the arc foundation).
- Refined `2026-06-29` by `aof:refine 19 --autonomous` — Decide + Break-down + both Contracts in one pass:
  - **Decide:** [ARCHITECTURE.md](ARCHITECTURE.md) authored (architect) — three ADRs + four fitness functions,
    grounded in a fresh codebase graph (`aof graph build src` → 1032 nodes / 2793 edges).
  - **Break-down:** two stories — **00 · run-store** (the `src/run-store.mjs` spine) → **01 · run-commands**
    (the `work:run-*` commands + CLI face). Store-first is the topological order the call graph dictates.
  - **Contracts (Three Amigos, both stories):** PO headline scenarios → `aof-qa` Examples/case matrices
    (full 5×5 transition table; resolver/error-code/ambiguity matrices) → `aof-developer` feasibility =
    **FEASIBLE WITH NOTES** on both (notes are build-stage guidance folded into each STORY.md — no contract
    defect). 6 task `.feature` files authored (3 + 3). `work validate 19` → PASS.
  - **Build-note carried forward (story 01 / fitness #4):** the `acd-work-command-cli-bijection` smoke needs
    `buildFixture()` to pre-seed a `running` run so `aof work run-complete … --json` exits 0 (else RED).
  - Status → `in-progress`. Next: `aof:continue 19` (build, store-first).
- Built + reviewed `2026-06-29` by `aof:continue 19` (store-first, serialised — story 01 imports story 00's
  `src/run-store.mjs` at runtime, a real build edge):
  - **Story 00 (run-store):** `src/run-store.mjs` (the spine — `runsDir`/`runRecordPath` seam, the closed
    transition table, the frozen 9-key schema, create/read/transition/prune) + 3 task `.feature` suites
    (25-cell grid + 14-row illegal matrix folded in) + the 3 fitness arch-tests. → `in-review`.
  - **Story 01 (run-commands):** `src/commands/run-{start,complete,status}.mjs` (thin over the store; the
    08 read/write resolver split), the additive registration in `command-core.mjs`, the CLI face
    (`runVerbCli`, single `--json` envelope), and the bijection fitness extension (#4). → `in-review`.
  - **Verification:** whole suite green (1444 unit `ok`, 0 fail + integration; re-run after review fixes).
    All 4 fitness functions green. `@executable` suite green across all 6 task features.
  - **Review verdicts:** architect (structural) **CONFORMS** on all 6 invariants (ADR-001/002/003 + the 4
    FFs), confirmed against a fresh graph (no edge into `board-ui.mjs` — board-deferral is real). qa
    (behavioural) **PASS** — every scenario/row covered, anti-gaming verified (findings in `VERIFICATION.md`).
    craft pass — no contract-breaking bug; the one operational item (a torn run file blinding `run-status`)
    fixed at the gate (read-side tolerance in `readRuns` + a coded `invalid-brief` on the CLI face).
  - Next: `aof:verify 19`.
- **Accepted + compacted `2026-06-30` by `aof:verify 19`.** Both stories `done`; milestone `status: done`.
  Whole suite green (1445 `ok` / 0 fail); all six `@executable` features + all four fitness functions
  green; no `@manual`/`@uat`/UI lane (board is m21). `aof work validate 19` and the full-stream validate
  both PASS. No new findings; the two pre-existing non-blockers (F-19-01 design-gap/process,
  F-19-02 enhancement) carried in VERIFICATION. Accept rationale → [SPEC §Accept decision](SPEC.md);
  process lessons distilled → [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R4) and folded into memory
  (`work memory ingest`). Durable decisions live in [ARCHITECTURE.md](ARCHITECTURE.md) (ADR-001/002/003);
  the blow-by-blow above is the archived narrative.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- Foundation-first: this is the enabler milestones 20 (autonomous-run-resilience) and 21
  (board-run-observability) both consume. The derived-record invariant (run log is never authoritative item
  state) is fixed by the PRD and inherited from milestones 05/09.
- **Open contract questions RESOLVED at refine + GRADUATED to ADRs (`2026-06-29`)** — all three settled in
  [ARCHITECTURE.md](ARCHITECTURE.md) and now the durable record: the `work:run-*` verb set + transition rules
  with the `queued`-reserved-not-minted default (ADR-001/003); the derived run log as per-run JSON files under
  a per-item `runs/` dir, forced partition-ready (ADR-002); and Decide-by-architect-ADRs-alone (no
  designer/researcher/security stage — no UI, no blocking unknown, no attack surface). See the ADRs for the
  full rationale; not restated here.
- **Forward note — build mesh-ready (added 2026-06-29, decentralized-mesh shatter).** A *later* PRD
  ([PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md))
  reuses — does not replace — these run records: its **milestone 26** will add a **`node` dimension**,
  path-partitioned per node/run (`runs/<node>/<run-id>.json`). To make that a pure additive delta rather
  than a rework, shape the derived log **partition-ready** here: per-run files under a node-addressable
  path, **not** one monolithic log. No scope change to this milestone — a hint so the work survives the
  fleet extension. (This is the one genuine seam: `26 → 19`.)
  - **Coherence with milestone 22 (added 2026-06-29).** 22 (mesh-foundation) is **parallel-eligible** with
    this arc (08-only — it does NOT depend on 19; the build edge is `26 → 19`). But 22 authors the
    path-partition *convention* (`presence/<node>.json`, `runs/<node>/…`) in parallel, so the two must
    *compose* at 26. 19/ADR-002 has now frozen the store's single path seam `runsDir`/`runRecordPath` (the
    `<node>/` delta is one line); 22's SPEC §Dependencies carries the reciprocal note that its
    partition-convention ADR should adopt this frozen seam as the reference shape. A design cross-reference
    that keeps convention (22) and store (19) coherent — **not** a `depends` edge.

## Verification

<!-- Pointers, not restatements. Accepted 2026-06-30 — see VERIFICATION.md + SPEC §Accept decision. -->
- [x] `@executable` suite green — all six task features (story 00 + 01)
- [x] Fitness functions green — `run-record-derived` / `run-write-scope` / `run-partition-ready` + the bijection extension
- _No `@manual`/`@uat` lane_ — every scenario is `@executable`; board observability (the only UI) is milestone 21.

<!-- §Feedback (for retro) ARCHIVED at Accept (2026-06-30): its three notes graduated into
     RETROSPECTIVE.md (R1 = the ADR-003 multi-fitness-function near-miss; R2 = the two m20-deferred
     durability gaps + the compactStamp contract assumption; R3/R4 derive from the VERIFICATION findings)
     and were folded into memory via `work memory ingest`. Lessons have a durable home; the running
     notes are retired. -->

