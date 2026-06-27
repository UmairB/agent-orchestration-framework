---
doc: retrospective
updated: 2026-06-25
---
<!--
  Milestone RETROSPECTIVE.md — the distilled lessons from how execution actually went.
  One R<n> per lesson; APPEND, never renumber. Reference findings/ADRs/commits, never restate.
  Source: STATE ## Feedback (for retro) + VERIFICATION ## Findings + blocker stops.
  Clean findings with no process lesson stay in VERIFICATION — they are NOT retro entries.
-->
# 15 · Work Doctor Core — Retrospective

## R1 — A "sanctioned count" generalised in two places usually lives in a third

- **Kind:** near-miss · **Area:** architecture (fitness design) · **Stage:** build (caught wiring) · **Owner:** developer · **Raised by:** architect/ADR-005 + developer (story 00)
- **What happened.** ADR-005's "no new door" generalised the **two** bijection arch-tests from a hard-coded
  "exactly six work commands" to a registry-derived set — but the same six were hard-coded in a **third**
  place the ADR did not name: `test/command-core-contract.test.mjs`'s milestone-08 "exactly the six work
  commands" contract. Registering `work:doctor` as the 7th broke it; the developer generalised it too
  (a `WORK_IDS` set acknowledging the sanctioned in-namespace extension, mirroring the existing `graph:*`
  handling).
- **Why.** The ADR enumerated the count's homes from the two it set out to change, not from a search for
  every literal of the count. A generalisation scoped to "the tests I'm touching" misses the sibling.
- **Lesson.** Before generalising a frozen count, **grep for every literal of it** and list its homes in
  the ADR's fitness narrative — "the count lives in N places" is the invariant, not "I changed two." A
  future `work:*` command must derive the set in **all three**. (A check-GROUP — e.g. milestone 16 — adds
  no command and is unaffected.)
- **Refs:** ADR-005; `test/arch/acd-work-command-cli-bijection.test.mjs`,
  `acd-work-command-route-coverage.test.mjs`, `command-core-contract.test.mjs` (`WORK_IDS`); STATE §Feedback.

## R2 — Cross-item milestone↔story logic must key on folder containment, not `parent` number

- **Kind:** near-miss · **Area:** code · **Stage:** build · **Owner:** developer · **Raised by:** developer (story 01)
- **What happened.** Keying a milestone→its-children relationship by `parent` **number** let a
  `duplicate-driver-number` — a real error state the doctor itself reports — cross-attribute one
  milestone's stories to another, producing a spurious `stale-parent`. Fixed by attributing children via
  folder containment, not number.
- **Why.** The check that *detects* duplicate numbers cannot itself *assume* numbers are unique — the
  doctor must be correct over the very malformed states it is built to find.
- **Lesson.** Any cross-item milestone↔story logic in this codebase must key on **folder path**, never
  number — duplicate numbers are a state the stream can legitimately be in. A health check must be robust
  to the faults it reports.
- **Refs:** the `stale-parent` / `duplicate-driver-number` codes; `src/work-doctor-coherence.mjs`; STATE §Feedback.

## R3 — A determinism (or any invariant) fitness grep must scan the whole module family it governs

- **Kind:** near-miss · **Area:** architecture (fitness design) · **Stage:** build (caught at structural review) · **Owner:** developer · **Raised by:** architect (review gate)
- **What happened.** `acd-doctor-engine-determinism` source-grepped only the spine (`src/work-doctor.mjs`)
  for `Date.now`/argless `new Date()`, but ADR-003's no-wall-clock invariant explicitly names the GROUP
  modules too (`work-doctor-coherence`/`-freshness`). A future group (or milestone 16's appended group)
  could add a real wall-clock read uncaught. Fixed by extending the grep to the `src/work-doctor*` family.
- **Why.** The invariant is family-scoped; the guard was file-scoped. They drifted because the spine was
  the only module that existed when the guard was first written.
- **Lesson.** When an invariant covers a module **family** (a registry the dependents append into), the
  fitness function must glob the family, not one seed file — otherwise the seam the architecture invites
  others to extend is the exact place the guard goes blind.
- **Refs:** ADR-003; `test/arch/acd-doctor-engine-determinism.test.mjs` (extended to `work-doctor*`); STATE §Feedback.

## R4 — A composite de-dupe key needs a separator outside its fields' value space

- **Kind:** finding · **Area:** code (craft) · **Stage:** build (caught at structural review) · **Owner:** developer · **Raised by:** architect (review gate)
- **What happened.** The engine's `code+path+message` de-dupe key briefly used a **space** separator (a
  seed file's NUL bytes had been swapped to spaces). A space can collide if the field boundaries shift,
  because spaces occur inside `path`/`message`. Restored to an unambiguous `NUL` separator at review.
- **Why.** "Make it readable" weakened a key whose only job is to be unambiguous; collision-safety is a
  property of the separator being absent from the values, not of it looking clean.
- **Lesson.** A composite key's separator must not appear in any field's value space — use NUL (or another
  guaranteed-absent delimiter), never a value-space character, even when collisions seem unlikely today.
- **Refs:** `src/work-doctor.mjs` (the de-dupe key, `NUL`); `03_engine-spine.feature` (de-dupe scenario); STATE §Feedback.

## R5 — The ROADMAP cross-reference shipped dormant by design; revisit whether to keep or drop it

- **Kind:** decision · **Area:** architecture (deferred scope) · **Stage:** refine (ADR-004) · **Owner:** architect/product-owner · **Raised by:** autonomous refine (documented default)
- **What happened.** SPEC's "ROADMAP↔folder sync" assumed a machine-parseable milestone-index ROADMAP that
  does not exist here (`wiki/work/ROADMAP.md` is a backlog; `wiki/ROADMAP.md` is prose). ADR-004 shipped the
  folder-only invariants (`numbering-gap`, `duplicate-driver-number`, `orphan-folder`) live and the
  `roadmap-folder-mismatch` cross-reference as an **opt-in honest no-op** that fires only against a
  structured index — proven inert by two no-op scenarios + one structured-index-fixture scenario.
- **Lesson / carry-forward.** The dormant hook is contract-shaped and tested both inert and active, so it
  costs nothing to keep. **Revisit trigger:** if no project in this repo ever ships a structured
  milestone-index ROADMAP, drop the cross-reference entirely (the one recorded alternative in ADR-004)
  rather than carry a permanently-dead lane.
- **Refs:** ADR-004; `01_structural-integrity.feature` (no-op + structured-index rows); STATE §Default decisions.
