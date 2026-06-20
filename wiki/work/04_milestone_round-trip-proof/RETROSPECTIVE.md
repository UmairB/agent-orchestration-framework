---
doc: retrospective
---
<!--
  Milestone RETROSPECTIVE.md — the distilled lessons from how execution actually went.
  One R<n> per lesson; append-only, never renumber. Reference (don't restate) the source:
  VERIFICATION `@finding-<id>`, ADR, STATE feedback note, or commit.
-->
# 04 · Round-trip Proof — Retrospective

The build itself was clean — three review lenses passed with no blockers (`STATE.md`). The lessons
below come from the `STATE.md` `## Feedback (for retro)` craft notes and the two `VERIFICATION.md`
findings (F-01, F-02); both findings were non-blocking and routed to their owning milestones.

## R1 — A RED-until-built fitness function must not be registered in the shared runner before its implementation exists

- **Kind:** near-miss · **Area:** process · **Stage:** build · **Owner:** architect / runner-wiring · **Raised by:** aof:verify (sweep)
- **What happened.** `scripts/test.mjs` + `scripts/check.mjs` came up RED during verify — not from any
  milestone-04 lane, but from milestone 06's `acd-headroom-*` fitness functions, registered while their
  plugin is unbuilt. They were also wired into `test.mjs` but not `test-unit.mjs`.
- **Why.** A fitness function authored RED-by-design is only safe to register once the build that turns
  it green lands. Registering at Decide time reds the shared suite, which masks real regressions (you
  can't tell expected-RED from a true break). Milestone 04 hit the *same* tension and deliberately
  **deferred** its own roundtrip fitness-function registration to story 00's build (`STATE.md`); 06 did not.
- **Lesson.** Keep a milestone's RED-by-design fitness functions **unregistered** (or otherwise
  quarantined from the green-required suites) until its build flips them green — then register into **all**
  runners together so coverage can't drift between them.
- **Refs:** `VERIFICATION.md` F-01 (→ milestone 06); `ARCHITECTURE.md` (04 fitness-function "EXPECTED RED" convention).

## R2 — A cold-start integration proof catches install gaps that per-unit tests miss; route them, don't patch them

- **Kind:** near-miss · **Area:** process · **Stage:** verify · **Owner:** aof-qa / PO · **Raised by:** user (round-trip @uat)
- **What happened.** Driving the round-trip in a *real adopting repo* surfaced F-02 — `aof work init`
  establishes no `.gitignore` baseline — a gap milestone 01's per-unit init tests never asserted. It
  routed cleanly back to milestone 01 (the owner) instead of being patched in the proof.
- **Why.** Per-unit tests assert their unit; only an end-to-end cold install exercises the *composition*
  (and its first-run side-effects on a user's tree). ADR-004's "surface gaps back into 00/01, fix there"
  is what made the catch actionable rather than a local workaround.
- **Lesson.** The integration/cold-start lane earns its keep — keep it. When it finds a machinery gap,
  log + route to the owning milestone (ADR-004), never patch the proof in place. (Here it worked exactly
  as designed — which is itself the round-trip milestone's point.)
- **Refs:** `VERIFICATION.md` F-02 (→ milestone 01); `ARCHITECTURE.md` ADR-002/ADR-004.

## R3 — Importing the runner from a meta-test created an import cycle; a shared test-suite module is the clean fix

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** aof-developer · **Raised by:** structural + craft review
- **What happened.** The `acd-roundtrip-registration` no-drift meta-test imports the assembled `tests`
  array from `scripts/test.mjs`, creating a cycle worked around by exporting `tests` + invoking
  `runSuite()` fire-and-forget (no blocking top-level await). Sound, but the meta-test guards only
  `test.mjs`, not `test-unit.mjs`, and ~110 lines of import/spread are duplicated between the runners.
- **Why.** Registration lives in the runner *and* must be read by a test that the runner runs — an
  inherent cycle when both responsibilities sit in one module.
- **Lesson.** Extract the common suite assembly into a shared `scripts/test-suite.mjs` that both runners
  **and** the meta-test import; that kills the cycle, removes the duplication, and lets the no-drift
  guard cover every runner at once.
- **Refs:** `STATE.md` `## Feedback` note 1; `scripts/test.mjs:154-199`; `test/arch/acd-roundtrip-registration.test.mjs`.

## R4 — Assert the property that matters, and factor shared test scaffolding outside the frozen surface

- **Kind:** misunderstanding · **Area:** contract · **Stage:** build · **Owner:** aof-architect / aof-developer · **Raised by:** craft review
- **What happened.** Two smells in the test support: (a) the harness imports `loadBundle` only to satisfy
  the *source-grep* arm of `acd-roundtrip-reuses-shipped-code`, though ADR-002 is genuinely satisfied
  because `initWork` calls `loadBundle` internally (a hollow proxy); (b) `roundtrip-install-proof` and
  `roundtrip-loop-proof` each re-derive the CLI-spawn + seed/cleanup helpers, and loop-proof re-states the
  seeded folder layout by hand.
- **Why.** A fitness function that greps for an *import* tests a proxy, not the behaviour; and the harness
  is correctly frozen to exactly three exports (ADR-005), so shared ergonomics have nowhere to live and
  get copied instead.
- **Lesson.** Pin the property that actually holds (delegation through `initWork`, ideally behaviourally),
  not an import token. Put shared proof scaffolding (`runCli`, `withSeededRepo`, a `pathFor(ref)`) in a
  sibling `test/support/roundtrip-cli.mjs` — **never** by widening the frozen harness contract.
- **Refs:** `STATE.md` `## Feedback` notes 2–4; `ARCHITECTURE.md` ADR-002/ADR-005.
