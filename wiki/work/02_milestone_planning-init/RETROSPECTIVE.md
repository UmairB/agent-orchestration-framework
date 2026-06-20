---
doc: retrospective
ref: "02"
---
# 02 · Planning Init (the bought seam) — Retrospective

Distilled lessons from how execution actually went. One `R<n>` per lesson; append-only, never
renumber. Clean catches with no process lesson are not entries — they live in VERIFICATION/STATE.
This milestone took **three blocker stops at `aof:verify`** (F1 → F2 → F3) plus review-gate near-misses.
The dominant thread (R1) is one blind-spot class that recurred at three depths; the rest are distinct.

## R1 — A test that asserts a STRING/FIXTURE shaped to pass proves the shape, not the effect

- **Kind:** blocker · **Area:** architecture · **Stage:** build→verify · **Owner:** architect/developer · **Raised by:** verify (F1, F2, F3)
- **What happened:** the same class of defect surfaced as a live-only blocker **three times**. F1: the
  `acd-planning-install-commands` fitness function asserted the exact `owner/repo@<sha>` shorthand the
  code emitted — green the whole time — but that shorthand clones over **SSH** and dies for HTTPS-only
  auth. F2: F1's fix swapped in an HTTPS `#<sha>` string the test then asserted — still green — but
  `marketplace add` is `git clone --branch <ref>`, which can't resolve a bare commit sha. F3: `readSeam`
  was built + tested against fixtures hand-shaped with `## Scope` / `## Milestones` headings the parser
  title-matches, but the real `create-prd` skill emits an 8-section template with neither, so the
  read-out returned objective-only on real output.
- **Why:** in every case the test encoded the *value the code produces* (a command string, a
  parser-shaped fixture) rather than *the effect that value must have* (the marketplace clones; the seam
  reads a real producer's PRD). A green assertion against a shape the producer never takes is a tautology.
- **Lesson:** when an invariant guards a value consumed by an external tool or producer, **assert the
  effect, not the literal** — that it clones / resolves / runs / reads. A networked or external
  integration is only proven by a live run, so the `@manual` / `@uat` lane is load-bearing, not ceremony;
  a green offline lane is necessary-but-not-sufficient. The loop finally closed structurally (R-fix
  below), not by another string tweak.
- **Refs:** `@finding-F1`, `@finding-F2`, `@finding-F3`; ADR-007/ADR-008/ADR-010; fitness functions
  `acd-planning-install-commands`, `acd-planning-clonable-ref` (the networked clone-smoke).

## R2 — Close a live-only blocker with a structural guard + a live repro before the gate, not a string tweak

- **Kind:** blocker · **Area:** architecture · **Stage:** build · **Owner:** architect/developer · **Raised by:** developer (F2 fix)
- **What happened:** F1's remedy replaced one unverified-against-live command string with another, which
  shipped F2. The F2 fix instead added (a) a deterministic offline guard that the marketplace `#<ref>`
  is a named ref, never a bare 40-hex sha, and (b) a **networked clone-smoke** that extracts the
  actually-emitted ref and runs `git ls-remote --exit-code` to prove it resolves upstream (loud-skip
  offline, never a silent pass) — then proved it **live in the same `aof:continue` run** rather than
  punting the live proof to the next verify.
- **Why:** a fix for a live-only failure that is itself only checked offline just re-arms the same loop
  one layer down.
- **Lesson:** a fix for a live-only failure must be reproduced live before the gate, and the guard added
  must assert the effect (it clones/runs), so the next latent defect can't hide behind a green string.
- **Refs:** `@finding-F2`; ADR-008; fitness function `acd-planning-clonable-ref`; STATE `## Feedback`.

## R3 — A consumed-artifact fixture must be derived from the real producer, and RESEARCH must capture its real SHAPE

- **Kind:** blocker · **Area:** contract · **Stage:** refine→verify · **Owner:** architect/researcher · **Raised by:** verify (F3)
- **What happened:** ADR-005 called the story-01 fixture "a representative pm-skills create-prd-shaped
  PRD" — but nobody ran `create-prd` to check; the fixture was shaped to the parser. RESEARCH §7 nailed
  the create-prd **filename** discrepancy but never recorded the skill's actual **section structure**
  (the 8-section template), so the parser's heading assumptions went unchallenged until the live `@uat`.
- **Why:** a seam that consumes a bought/external artifact was validated against an artifact derived from
  our own parser, and the research captured the producer's name/location but not its shape.
- **Lesson:** when a seam consumes an external artifact, (1) make a single **genuine producer output** a
  first-class test case, and (2) research the artifact's real SHAPE, not just its name/location. Captured
  at `fixtures/PRD-oncall-compass.real-create-prd.md`; ADR-010 pins the additive read-out contract.
- **Refs:** `@finding-F3`; ADR-005 (annotated) / ADR-010; RESEARCH §7 (corrected); `test/planning-prd.test.mjs`.

## R4 — A verify verdict must record observed facts + a fix DIRECTION, not a command form it never ran

- **Kind:** mistake · **Area:** process · **Stage:** verify · **Owner:** verify (PO/QA) · **Raised by:** verify (F2)
- **What happened:** the 2026-06-18 (F1) verdict told `aof:continue` to "emit HTTPS `#<sha>`" as if the
  sha were a known-good ref, when verify had only proven HTTPS `ls-remote` works — not that a sha clones.
  That over-specified remedy shipped the next blocker (F2).
- **Why:** a verify handed down a concrete command form it had not executed end-to-end.
- **Lesson:** a finding records *observed facts* + a fix *direction the architect confirms* — never a
  command string the verify never ran. The F2 finding then nailed the facts (`--branch v2.0.0`/`main`
  succeed; `--branch <sha>` fails) so the fix could be chosen against evidence.
- **Refs:** `@finding-F1`, `@finding-F2`; STATE `## Feedback (for retro)`.

## R5 — Offline simulation seams leave the real spawn / `--json` path uncovered

- **Kind:** near-miss · **Area:** code · **Stage:** build · **Owner:** developer · **Raised by:** build + review
- **What happened:** the injected-sha test hook short-circuited `resolveSha`, masking that `--dry-run`
  (the real path, no injected sha) called `git ls-remote` — a live spawn violating ADR-001's
  "dry-run performs no network call or spawn." Separately, two real bugs lived only on the untested
  real-execution path: a failed runtime step was recorded as a *successful* pin (an honesty violation),
  and `--json` interleaved human boundary lines into stdout so the payload wasn't parseable.
- **Why:** the simulate/inject seams that keep `@executable` offline also leave the real spawn / `--json`
  paths unexercised, and a passing suite won't catch what no test drives.
- **Lesson:** an arch test that proves "no network/spawn" must exercise the **un-injected** path, and the
  build's craft pass on the real spawn / `--json` path earns its place — those defects are otherwise only
  caught by the costlier `@manual` lane.
- **Refs:** ADR-001; fitness function `acd-planning-install-commands` (un-injected dry-run case); STATE
  `## Feedback (for retro)`.

## R6 — When an ADR enumerates N paths that must satisfy an invariant, the fitness suite must cover all N

- **Kind:** near-miss · **Area:** architecture · **Stage:** build→review · **Owner:** architect · **Raised by:** review (story 02)
- **What happened:** ADR-009 named TWO lock reconstructors as the regression hazard —
  `createLockManifest` and `mergeFrameworkInstallAttempts`. The developer migrated both correctly, but
  the new `acd-unified-lock-sections` suite exercised only the first, so the second's foreign-section
  preservation rested on code review, not CI. The structural review caught it; a third arch case was
  added at the gate.
- **Why:** a fitness suite that covers N-1 of N enumerated hazard paths leaves a correctly-migrated-but-
  unguarded writer one refactor away from a silent regression.
- **Lesson:** when an ADR enumerates N paths bound by one invariant, the fitness suite must cover all N.
- **Refs:** ADR-009; fitness function `acd-unified-lock-sections`; STATE `## Feedback (for retro)`.

## R7 — A derivation assumption guarded only by a loud-skipping smoke must be exercised online on the trigger

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** architect · **Raised by:** architect (nit N1)
- **What happened:** `MARKETPLACE_REF = \`v${MARKETPLACE_VERSION}\`` bakes in "the release tag is always
  `v`+semver." That held for `v2.0.0`, but a future upstream tag of `2.1.0` (no `v`) or `release-…` would
  emit an unclonable ref. The networked clone-smoke is the only guard — and offline it loud-skips, while
  the deterministic test only rejects bare-sha shapes, not a wrong-but-named tag.
- **Why:** the guard for an unverified derivation is a networked test that degrades to a skip offline, so
  the assumption rides unchecked on any offline run.
- **Lesson:** surface the assumption in the ADR's consequences and require the smoke to run **online** on
  the event that can break it (a `marketplaceVersion` bump), or the guard is latent.
- **Refs:** ADR-008 (consequences); fitness function `acd-planning-clonable-ref`.

## R8 — Narrative provenance drifts from the real ADR — verify against the ADR, correct at the gate

- **Kind:** misunderstanding · **Area:** contract · **Stage:** refine→verify · **Owner:** product-owner · **Raised by:** architect (story 02 review)
- **What happened:** SPEC/STORY narrative cited "milestone 00's separate-work-lock decision," but the
  work-lock vertical was actually built in milestone 01 (m01-ADR-004). ADR-009 cited the correct ADR;
  the prose lagged.
- **Why:** hand-off notes carried a roadmap reference that was never reconciled against the source ADR.
- **Lesson:** narrative provenance must be verified against the real ADR id, not a remembered milestone
  number; correct the drift at the verify gate so the roadmap doesn't carry the wrong lineage. Corrected
  in SPEC.md at this close.
- **Refs:** ADR-009 / m01-ADR-004; SPEC.md `## Scope` + `## Stories`.
