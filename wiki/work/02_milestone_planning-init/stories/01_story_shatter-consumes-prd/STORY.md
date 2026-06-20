---
type: story
number: 01
slug: shatter-consumes-prd
title: "Confirm the seam — aof:shatter consumes a PRD-*.md"
parent: 02
status: done
owner: product-owner
created: 2026-06-18
updated: 2026-06-19
---
<!-- Accepted at aof:verify 02 (2026-06-19): F3 closed. readSeam over the genuine create-prd 8-section
     template now yields objective + 5 milestone chunks + 2-in/1-out scope (was objective-only), no
     regression on the two prior fixtures; the @uat live round-trip's faithful sign-off stands. All
     @executable/@manual/@uat lanes green. status: done. -->
<!-- aof:continue 02 (2026-06-19): F3 fix (task 03) built + reviewed — readSeam hardened to the real
     create-prd 8-section template (ADR-010). Architect (PASS-with-nits) + QA (PASS) + craft (LGTM);
     one gate nit applied (honest-empty negative test). Suites green. -->
# 01 · Confirm the seam — aof:shatter consumes a PRD-*.md

<!-- Reopened at aof:verify (2026-06-19): the @uat live create-prd → shatter round-trip finally ran
     (F1/F2 fixed, planner installs) and the PO signed off the framing as faithful — BUT it surfaced
     blocker Finding F3: `readSeam` extracts only the objective (empty scope/milestones) from the REAL
     create-prd 8-section template, because both fixtures were hand-shaped with `## Scope`/`## Milestones`
     headings the real producer never emits. Task 03 (@bug @finding-F3) hardens `readSeam` to the real
     template + replaces the fixtures with genuine create-prd output. `done` at aof:verify once task 03 is
     built green and the read-out carries scope+milestones from real output. -->


## User story

As the product-owner shattering a planned initiative,
I want `aof:shatter` to reliably discover and consume a pm-skills-shaped `PRD-*.md` from the workspace (or an explicit path, asking rather than guessing when none is found), and to stamp each framed milestone's `origin` back to that PRD,
so that the planning→delivery seam is proven to carry a real PRD into milestone SPECs — one-directional, with no silent miss and no drift.

## Tasks

<!-- The PRD discovery contract is observable behaviour (→ here), not a structural invariant.
     A representative pm-skills-shaped PRD fixture is the Given of these scenarios. The live
     create-prd → shatter round-trip is the seam's real proof and is @uat (RESEARCH A9). -->

- [x] `tasks/00_discover-prd.feature` — auto-discovery finds a `PRD-*.md` at the workspace root; an explicit path argument is honoured; a missing or non-prefixed PRD makes shatter **ask**, never silently miss or guess (ADR-005)
- [x] `tasks/01_seam-readout-and-origin.feature` — over a representative PRD fixture, the seam read-out (objective / scope / milestone-sized chunks) is consumable and each produced milestone SPEC stamps `origin` back to the PRD *(@executable read-out lane green; the @manual shatter→SPEC/origin scenarios verified PASS at `aof:verify` — VERIFICATION.md `## Verification evidence`)*
- [x] `tasks/02_live-roundtrip.feature` — `@uat`: a live `create-prd` → `aof:shatter` round-trip produces a `PRD-*.md` that is discovered and shattered into framed milestones (RESEARCH A9) *(human acceptance — **SIGNED OFF at `aof:verify` 2026-06-19**: F1/F2 fixed so the planner installs; create-prd wrote a discoverable PRD, shatter framed 5 origin-stamped milestones, PO judged the framing faithful. The round-trip itself PASSED — the read-out gap it exposed is a separate task below.)*
- [x] `tasks/03_real-template-readout.feature` — `@bug @finding-F3`: `readSeam` now extracts the seam read-out (objective / scope / milestone-chunks) from the REAL pm-execution `create-prd` 8-section template — milestone chunks ← `### 7.2 Key Features` (fallback after `## Milestones`), scope in/out ← `## 8. Release` bold-lead labels (fallback after `## Scope`); additive precedence so the hand-shaped + inline fixtures are unchanged. Genuine create-prd output added as a first-class read-out fixture (`fixtures/PRD-oncall-compass.real-create-prd.md`). Architect pinned the contract in **ADR-010** (+ annotated ADR-005, corrected RESEARCH §7). Built + reviewed via `aof:continue 02` (2026-06-19); all `@executable` scenarios green, suites green (full 523 / unit 544), no regression.

## Notes

Independent of story 00: exercised entirely against a checked-in PRD fixture following the
`create-prd` skill's filename convention — it never imports or runs `aof planning init`. Binds only to
the `PRD-*.md` convention (milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) ADR-005), which the
already-authored [shatter command](../../../../../src/bundle/commands/shatter.md) honours. The seam's
single soft spot ([RESEARCH.md](../../RESEARCH.md) §7): the filename is an agent-honoured convention,
not a tool-enforced path — so discovery must degrade to "pass the path", never a silent miss.

**Build guidance (Three-Amigos feasibility ruling).** To make `00_discover-prd.feature` `@executable`
without reimplementing shatter (an agent command), the build extracts a small pure helper —
`discoverPrd(workspaceDir, explicitPath) → { prd } | { ask, candidates }` — that `shatter.md` step 1
references as its discovery rule and a unit test drives over `fixtures/`. This is the codebase's
existing idiom (pure exported helpers like `findWork`/`listItems` tested over temp-dir fixtures); it is
the smallest seam that makes ADR-005's find / accept-path / ask matrix assertable offline.
