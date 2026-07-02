---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 26 · Distributed Runs + Leasing — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-29` by `aof:shatter` from
  [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  (Phase 2 — fleet-safe execution). Stories to be broken down — `aof:refine 26`.
- Refined `2026-07-02` (`aof:refine 26 --autonomous`): [ARCHITECTURE.md](ARCHITECTURE.md) authored —
  six ADRs (the node-dimensioned record, the sync root-set, the lease-of-record, the A2 protocol,
  mesh-aware `next`, fleet reclaim) + twelve fitness gates; broken into three stories
  (00 substrate → 01 lease mechanics ∥-authorable → 02 the A2 integration join), boundaries grounded in
  a fresh graph build (1174 nodes / 3162 edges). Contracts authored via Three Amigos, same session.
- [ ] `00 · node-dimensioned-run-records` — not-started
- [ ] `01 · lease-of-record` — not-started
- [ ] `02 · claim-integration-fleet-reclaim` — not-started

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- This is the PRD's **primary spike (A2)**: the relay-grant vs git-commit ordering protocol that makes
  leasing race-safe (KR2) while keeping correctness independent of the relay. ~~Blocked until milestone 19
  (run records), 20 (restart-scan reclaim + `next`), and 23 (the relay fast-path) are in.~~ All three
  landed done — unblocked at refine, `2026-07-02`.
- ~~Open for refine: the lease-of-record file format + the relay-grant→git-commit sequence; how `runs/`
  partitions by node so merges stay add-only; how `aof work next` becomes mesh-aware (lease check); and
  how milestone 20's restart-time backstop scan generalises to a **fleet** orphan scan over stale peers.~~
  All four settled at refine — ADR-003/ADR-004 (the spike: per-contender claim files; remote-history-order
  arbitration; the frozen local-write → best-effort-intent → git-sync → git-only-arbitration sequence),
  ADR-001 (the fourteen-key record + union readers), ADR-005 (the injected leaseView), ADR-006 (the
  dual-staleness fleet scan).
- **Default decisions taken under `--autonomous`** (documented, reversible; none judged unsafe):
  - Lease acquire/release/reclaim land behind the **existing verbs** (`work:run-start` /
    `work:run-complete` / `work:next`) — a `work:claim` verb was considered and REJECTED (ADR-004): no
    operator takes claiming as an independent step, and zero new verbs keeps every registry gate
    un-re-armed (22/R1 inverse clean). Reversible if operator-facing claiming emerges in m27.
  - **Presence is the lease clock** — no per-lease TTL, no expiry stamp, zero new config keys
    milestone-wide (ADR-003.2, the 23/ADR-002 recall directive).
  - Work-stream frontmatter/record docs stay deliberately **outside the sync root-set** (ADR-002) —
    correctness rests on the lease, never on fresh frontmatter; a peer's board may render stale statuses
    between operator pushes (routing/issuance is m27).
  - Fleet reclaim triggers at the **claim path only** (`work:run-start`), never a timer/daemon — a crashed
    peer's item is reclaimed when someone next seeks work (ADR-006; `SPEC §Out of scope` no server sweep).
  - A stood-down loser **keeps** its claim file (`state:"released"`, never deleted) — delete/re-claim is a
    path-resurrection race, and history loses the stand-down trail (ADR-003).
  - KR2's 100-claim soak is a **`@manual` verification deliverable** (story 02 / task 04); the mechanism
    is `@executable` over local git fixtures (ADR-004.4).

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `VERIFICATION.md`

## Feedback (for retro)

- Architect (m26 design): mesh-sync.mjs's m22 header comment over-promised — 'runs in m26 syncs with ZERO engine change' is true of CONTENT (payload-agnostic) but false of SCOPE: the engine stages only meshDir (git add -- <root>), and run records live under wiki/work/**/runs/, outside it. Settled honestly in 26/ADR-002 (root-set argument, default [meshDir]). Retro lesson: a seam comment promising 'zero change for milestone N' must state WHICH axis is zero-change (content vs scope vs signature), or it reads as a blanket guarantee the graph later disproves. — Raised by: architect
