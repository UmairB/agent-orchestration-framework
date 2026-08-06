---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 43 · Mesh artifact authority — State

**COMPACTED AT ACCEPT, 2026-08-06.** The blow-by-blow is archived; the durable decisions had already
graduated into `ARCHITECTURE.md` (ADR-001…ADR-016), and the `## Feedback (for retro)` log has graduated
into `RETROSPECTIVE.md` (R1–R17). What this milestone now delivers is `OUTCOME.md`; what was proven, and
how, is `VERIFICATION.md`.

## Closure

**ACCEPTED 2026-08-06.** All six stories done. Refined 2026-08-01, built 2026-08-02 → 08-04, verified
across 08-03 → 08-06 on a real two-node mesh.

| story | delivered |
|---|---|
| `01_story_item-lock` | the exclusive lock at execution scope, in front of the one mint seam |
| `02_story_cache-authority` | the authority cut — authorship and door, never timestamp |
| `03_story_artifact-sync-on-write` | the `PostToolUse` trigger, the widened manifest, the surgical settings merge |
| `04_story_staleness-and-resync` | staleness marks and never evicts; provenance, the ramp, Resync |
| `05_story_gate-propagation` | a dispatch advances a continuing item's branch at the reuse door |
| `06_story_cache-read-surface` | the readers migrate; the cache is the read surface |

**Final gate:** `aof work validate 43` PASS, whole stream 0 findings. Both `@uat` gates accepted by the
operator (43/03 on 2026-08-03; 43/04 and 43/05 on 2026-08-06).

## What the verification gate changed

The gate was not a formality. It found one **blocker in a story's own subject area** and closed it:
`F-05.3` — the reuse-door predicate asked only `refs/heads/<branch>`, so a worker holding an item's line
only on the remote forked it and orphaned the previous phase's commits, **without using any of the git
verbs the armed invariant forbids**. Fixed at the gate, the invariant extended to the door that did the
discarding, mutation-tested, and the whole two-node lane re-run (commit `5184f0c`). See `RETROSPECTIVE.md`
R13.

Four defects **outside** this milestone were measured on the way and ledgered rather than absorbed —
`TECH_DEBT` **19** (a settled run reads `running` forever), **20** (the desktop supervisor has no
programmatic stop, so the documented deploy loop needs a human at a GUI), **21** (a workspace is
dispatchable exactly once per worker checkout), and **22** (a failed assignment carries no code, so the
fleet can only say `failed`). Items **14**, **15**, **16** and live evidence for **4** were recorded
during the earlier live run.

## Carried forward

- The five open gaps are stated as product state in `OUTCOME.md` §Gaps, each with its discharge
  condition: the operator-delete door (TECH_DEBT 13), the terminal run row (19), the coded assignment
  reason (22), the perceptual a11y lane, and the visual-regression baselines.
- `43/02`'s task 08 cross-machine soak was carried to the milestone gate and is discharged by `43/06`'s
  `@manual` lane, which proves the same property on real hardware: a worker-authored row survives the
  control's republish tick indefinitely (measured against a demonstrably live tick).
- The standing test-bed (`C:\Source\umair\aof-test-repo`, workspace `52294b307214c27d`) is kept. It now
  also carries `origin/aof/mesh/00` with a real merge of a worker line and a control gate edit — the
  fixture `43/05`'s soak was proven on.

## The four operator directives this milestone was scoped from (2026-08-01)

Retained because they are the milestone's charter, and every one is now delivered:

1. When a task is assigned, **lock the work item** on the control node.
2. While a worker is working an item, **the viewport uses that worker's snapshot**.
3. The control node **caches the artifacts in SQLite, with a TTL** — and the TTL never evicts, because
   after settle the cache is one of only two copies of that work.
4. The worker **syncs to control during the aof lifecycle**; no pulling from control to worker unless
   something is wrong — the Resync door being that carve-out, and operator-initiated.

The disk line the directives required but did not state is recorded in `ARCHITECTURE.md`: the cache is
authoritative for item **state** and artifact **content**; the disk remains the medium for structural
operations on the control's own checkout, each of which publishes its result into the cache.
