<!--
  STATE.md — answers ONE question: where are we now, and what happened?
  Owner: product-owner (SINGLE WRITER — sub-agents report completion, the PO records it).
  Part of the spine (always present).
  Lifecycle: grows during the milestone, COMPACTED at close — durable conclusions graduate into
  ADRs / the architecture reference / the next SPEC; the blow-by-blow is archived. Don't let it
  become an unbounded log.
-->
# NNN · <Milestone Name> — State

**Status:** Not started <!-- | In progress | In review | Blocked | Done -->
**Last updated:** <date>

## Progress checklist

<!-- One line per stage/deliverable. Mirrors the workflow stages; check off as they pass their gate. -->

- [ ] Frame — SPEC bounded
- [ ] Research — findings recorded (if needed)
- [ ] Decide — ADRs + fitness functions (if needed)
- [ ] Contract — tasks/*.feature authored (Three Amigos signed)
- [ ] Build — @executable green + traceability lint passing
- [ ] Review — structural (architect) + behavioural (qa) clear
- [ ] Verify — @manual / UAT signed off
- [ ] Accept — PO accepted; STATE compacted

## Notes & decisions in flight

<!-- Running narrative: surprises, corrections, things discovered mid-build. Decisions that prove
     durable graduate to ADRs at close (don't leave them only here). Use strike-through for
     corrected assumptions so the history stays honest. -->

## Verification

<!-- Pointers to verification status. Automated: reference the CI surfaces. Manual: reference UAT.md.
     Reference, never restate scenario text. -->

- [ ] `@executable` suite green — <surface / suite name>
- [ ] Fitness functions green — <arch-test name>
- [ ] `@manual` signed off — see `UAT.md`
