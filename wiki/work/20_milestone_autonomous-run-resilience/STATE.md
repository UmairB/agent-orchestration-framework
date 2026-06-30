---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 20 · Autonomous Run Resilience — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

**ACCEPTED `2026-06-30` (`aof:verify 20`).** All three stories `done`; milestone `done`. Compacted at
Accept — the blow-by-blow below is archived to its essentials; durable decisions graduated to ADRs.

- **00 · resilience-core** (`done`) — `src/run-store.mjs`: the 13-key record (ADR-001), the pure
  `isRetryable`/`shouldRetry` classification table (ADR-002), `retryRun` lineage mint (ADR-003 store),
  `heartbeat` + `reclaimStaleRuns` path-walking scan (ADR-004), the dedup guard + collision-safe mint
  (ADR-006), atomic `persist` via `fs.mjs:writeText` (ADR-007), and the store-side `failureReason` producer
  (ADR-009). 5 `@executable` features + 5 fitness-function arch-tests.
- **01 · resilience-commands** (`done`) — `work:run-retry` (registered + CLI face), `rollbackItemStatus`
  (the FIRST item-frontmatter status writer, in `work.mjs`, ADR-005), `run-complete --reason` +
  rollback-on-failed, and the restart-time reclaim wired into `work:run-start` (ADR-004). The three `19/R1`
  registry gates + `WORK_IDS` extended; `acd-status-rollback-bounded` added. 5 `@executable` features.
- **02 · resilience-skill** (`done`) — `src/bundle/commands/autonomous.md` (+ regenerated `.claude/` copy)
  wires reclaim-at-restart, resume-on-infra (`work:run-retry`) / fresh-on-rejection (`work:run-start`)
  "ask the store, don't re-derive the table", and the anti-loop skip-self-trigger guidance — within the
  UNCHANGED five-stop set (ADR-008). 3 `@manual` features, agent-observed at verify (VERIFICATION.md).

### Lifecycle (archived)
- Framed `2026-06-27` (`aof:shatter`) from [PRD-work-run-orchestration](../../planning/PRD-work-run-orchestration.md).
- Broken down + contracts authored `2026-06-30` (`aof:refine 20 --autonomous`) — 8 ADRs + 7 fitness
  functions against a fresh codebase graph; 13 task `.feature`s (Three Amigos). Partitioned by-layer into
  three stories (`00 → 01 → 02`), the cut the call graph dictated.
- Built + reviewed `2026-06-30` (`aof:continue 20`) — suite 1535/0; `aof-architect`
  CONFORMS-WITH-FINDINGS + `aof-qa` PASS-WITH-FINDINGS, all findings MINOR, zero blockers/majors.
- Verified + accepted `2026-06-30` (`aof:verify 20`) — `@executable` 1535/0, the four resilience
  behaviours agent-observed live over the real CLI, `aof work validate 20` PASS; lessons → RETROSPECTIVE.

## Durable decisions (graduated to ADRs)

<!-- The in-flight decisions that proved durable, now graduated. Pointers, not restatements. -->
- The three open contract questions resolved by the ADRs: resume-vs-fresh ↔ a VERB distinction (ADR-003);
  heartbeat = a `heartbeatAt` stamp ON the record + a restart-time path-walking reclaim scan (ADR-004);
  dedup = a store guard giving `19`'s reserved `queued` its producer + closing the `19/R2b` mint race,
  anti-loop SPLIT store-facts / skill-policy (ADR-006).
- The Contract-stage `failureReason`-producer default proved durable (shipped + verified green) and is
  **ratified as ADR-009** (store writes it on `→ failed`; `work:run-complete --reason` surfaces it).

## Forward note (still live — the one genuine seam)

<!-- Not in-flight for THIS milestone; a hint a later milestone consumes. Kept past compaction. -->
- **`26 → 20`.** [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  milestone 26 generalises the restart-time backstop scan into a **fleet orphan scan** and makes `aof work
  next` mesh-aware. ADR-004's `reclaimStaleRuns(items, …)` already walks run records **by path** and takes
  the item list as an argument (no single-node assumption), so the fleet version is a caller change, not a
  store rewrite — confirmed green by `run-heartbeat-reclaim/03` (the scan walks the supplied item list).

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — `node scripts/test.mjs` → 1535 / 0 (the 10 story-00/01 traceability files).
- [x] Fitness functions green — the 6 new m20 arch-tests + the 3 inherited m19 guards + the 3 registry gates.
- [x] `@manual` recorded — story 02's three skill-wiring features agent-observed live over the real CLI at
  `aof:verify`, evidence in [VERIFICATION.md](VERIFICATION.md) (`## Verification evidence`). No `@uat`
  session in this milestone, so no human sign-off lane was owed.
- [x] Validate gate PASS — `aof work validate 20` → `[]` (exit 0); traceability + litmus clean.
- [x] Accepted — three findings deferred (all MINOR, non-blocking, `@finding-F-20-01/02/03`); lessons in
  [RETROSPECTIVE.md](RETROSPECTIVE.md) (`R1` spine-seam test cost, `R2` producer-naming); memory ingested.
