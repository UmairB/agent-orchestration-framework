---
doc: retrospective
ref: "08"
---
# 08 · CLI Command Core — Retrospective

Distilled lessons from how execution actually went. One `R<n>` per lesson; append-only, never
renumber. Clean catches with no process lesson are not entries — they live in VERIFICATION/STATE.
This milestone had **no blocker stops** and **no VERIFICATION findings** (the build was clean; the
review converged on "faithful, load-bearing"). The lessons below come from the three carried
observations recorded in STATE `## Feedback (for retro)` (now archived at the close): R1 and R2 are
ADR-text accuracy gaps surfaced by the migration, R3 a build-then-review near-miss in how the frozen
contract's render channel was wired.

## R1 — An invariant that forbids a face from importing a core module must say how the face still gets what that module legitimately vends

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** architect · **Raised by:** orchestrator (build)
- **What happened:** ADR-002 sets `ctx = { workspace }` (the `loadWorkspace` result) and ADR-004 inv. 3
  forbids `board-ui.mjs` from importing `./work.mjs` *at all* — but the face still needs `loadWorkspace`
  to build that ctx. The only consistent resolution was for `command-core.mjs` to **re-export**
  `loadWorkspace`, so the face gets the workspace *through the door*. This was added at build but is
  named in no ADR.
- **Why:** the "registry is the only door" invariant was written as a pure prohibition, but the face has
  a legitimate need (the workspace loader) that the prohibition silently relocates — leaving an
  unstated, load-bearing piece of the contract.
- **Lesson:** when an invariant forbids a face from importing a core module the face still legitimately
  needs, the door must explicitly **vend** that dependency, and the ADR must say so. Graduate "the door
  also vends the workspace loader" into the ADR-002/004 text (or a small new ADR). **Carried follow-up:**
  the `/ws/terminal` and setup-UI migrations inherit the same need — they must reach the workspace
  through the registry, not around it.
- **Refs:** STATE `## Feedback (for retro)`; ADR-002, ADR-004 inv. 3; `src/command-core.mjs`
  (re-exports `loadWorkspace`).

## R2 — "Keep test X green through the migration" must distinguish "green verbatim" from "guarantee preserved" when the migration relocates the code the test greps

- **Kind:** near-miss · **Area:** architecture · **Stage:** verify · **Owner:** architect · **Raised by:** orchestrator (build/verify)
- **What happened:** ADR-004 said to keep `acd-board-write-isolation` green through the migration, but
  the whole point of inv. 3 is to move the sole feedback write **out of** `board-ui.mjs` **into**
  `src/commands/feedback.mjs` — so that arch-test's board-ui-internal source-greps could not stay green
  verbatim. They were **re-anchored** to the command's new home; the guarantee (one write kind, STATE.md
  only, no status write, no shell-out) is fully preserved and the behavioural end-to-end is unchanged.
- **Why:** the ADR phrased a structural-test expectation as "stays green" when the migration it mandates
  necessarily relocates the very code that test inspects — a small ADR-text inaccuracy, not a design
  problem.
- **Lesson:** when an ADR says "keep test X green" across a migration that **moves the code X
  source-greps**, state it as "re-anchored, guarantee preserved," not "green verbatim." A source-grep
  arch-test follows its target's home; the durable claim is the invariant, not the literal grep path.
- **Refs:** STATE `## Feedback (for retro)`; ADR-004 fitness table, ADR-002/003;
  `test/arch/acd-board-write-isolation.test.mjs` (re-anchored to `src/commands/feedback.mjs`).

## R3 — Wire a face's view affordances through the adapter's `faceCtx` from the start, not inline — or the frozen contract's render channel ships dead

- **Kind:** near-miss · **Area:** code · **Stage:** build · **Owner:** developer · **Raised by:** aof-architect, aof-qa (Review gate)
- **What happened:** `list`/`validate`/`next` carry scope-aware human output, but the first build inlined
  that rendering in `cli.mjs` and left the commands' `render` adapters uncalled (and already drifted).
  The frozen contract's `render(result, faceCtx)` signature was the intended channel all along;
  reconciled at review by routing the human path through the adapter with `faceCtx = { scope }`.
- **Why:** the face implemented its view affordance (scope-aware output) inline instead of through the
  contract's render channel, so the channel the contract froze shipped dead while the suite stayed green
  over the gap.
- **Lesson:** when a frozen contract supplies a render channel (`render(result, faceCtx)`), wire the
  face's view affordances **through `faceCtx` from the start**, not inline — otherwise the contract's
  channel ships dead and drifts. **Carried follow-up:** the `/ws/terminal` and setup-UI faces inherit
  the same `faceCtx` channel; wire their view affordances through it from the first build.
- **Refs:** STATE `## Feedback (for retro)`; ADR-002 (`render(result, faceCtx)`), ADR-003;
  `src/cli.mjs` list/validate/next render path (now delegates through the command adapter).
