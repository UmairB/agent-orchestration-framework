---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 24 · Device-Code Group Enrollment — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-29` by `aof:shatter` from
  [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  (the trust-boundary / join chunk — Phase 1). Stories to be broken down — `aof:refine 24`.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- v1 trust = **single-group / trusted-operator**; untrusted / cross-org / multi-tenant authz is the
  deferred Phase-5+ fork — keep the door clean but do not build it. Blocked until milestone 23 stands up
  the control node + relay endpoint the join code is presented to.
- Open for refine: the device-code issuance / match / TTL flow; what the **mesh credential** contains
  (relay auth + stream identity) and the revocation path; the **group registry** schema (roster +
  registered boards) as its own git stream of record + how git-remote access is provisioned alongside
  admission (PRD A3).

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `VERIFICATION.md`
