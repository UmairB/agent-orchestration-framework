---
doc: retrospective
ref: "26"
---
# 26 · Distributed Runs + Leasing — Retrospective

Distilled lessons from how execution actually went. One `R<n>` per lesson; append-only, never
renumber. Clean catches with no process lesson are not entries — they live in VERIFICATION/STATE.
This milestone had **no blocker stops**; every review must-fix was applied same-session. The lessons
below come from the story-00/01/02 review-gate flags recorded in STATE `## Feedback (for retro)` and
the verify-time findings in `VERIFICATION.md` (§Findings F-26-01..08).

## R1 — Build notes restating an ADR-frozen SEQUENCE must quote its numbered steps; a gate guarding an ORDER must assert the order

- **Kind:** mistake · **Area:** architecture · **Stage:** build→verify · **Owner:** developer/architect · **Raised by:** architect (story 02 review)
- **What happened:** the STORY build notes paraphrased the frozen A2 claim sequence with steps 2/3
  inverted (acquire→intent→resolve); the developer followed the notes; the checked task text agreed
  with the ADR; and the arch-test's own comment then codified the drift — so the gate passed GREEN
  while ADR-004.3 was violated (the relay intent pushed after acquire, degrading the fast-path window
  from ~ms to ~seconds).
- **Why:** a paraphrase of a frozen sequence drifted, and a fitness function that asserted
  *non-nesting* (not *order*) could not catch a reordering.
- **Lesson:** build notes that restate an ADR-frozen sequence must QUOTE its numbered steps verbatim,
  never paraphrase; a fitness function guarding a sequence must ASSERT the order (snapshot the state at
  the ordered point — e.g. the bare remote AT push time proving the claim is not yet remote), not merely
  that one call isn't nested in another.
- **Refs:** STATE §Feedback (architect, story 02); ADR-004.3; strengthened `acd-claim-relay-independent`.

## R2 — Verify a gate's ACTUAL assertions before citing it as a structural constraint

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** developer · **Raised by:** architect (story 02 review)
- **What happened:** a NEW lease-writer module (`mesh-lease-tie.mjs`) was created and its existence
  justified by citing `acd-status-rollback-bounded` as forbidding write verbs inside run-* commands —
  but that gate pins *frontmatter* writes, not *lease* writes, so it would never have caught the case.
  Right decision (keep the lease write out of the run command), wrong authority.
- **Why:** a gate was cited by its name/reputation rather than by what it actually asserts.
- **Lesson:** before citing a fitness function as a constraint that shapes a design choice, read its
  actual assertions. The module was graduated into `mesh-lease.mjs` (one lease-write home) at the gate.
- **Refs:** STATE §Feedback (architect, story 02); `mesh-lease.mjs`; fitness #6.

## R3 — An every-X invariant needs ONE home for X or an explicit allowlist — never a single-file grep standing in for a set-scoped rule

- **Kind:** mistake · **Area:** architecture · **Stage:** build→verify · **Owner:** architect · **Raised by:** architect (story 02 review) + verify
- **What happened:** "every lease write joins the seam" was enforced over ONE module, so a second
  writer module escaped by construction; symmetrically, the mesh-aware `next` `leaseView` was consulted
  only inside the story-walk loop, so the `uat` and zero-story-milestone ready-returns escaped the lease
  check entirely (surfaced at verify as F-26-05, graduated to ADR-007).
- **Why:** a set-scoped invariant ("every writer", "every ready-return") was encoded as a grep over a
  single named file / a single code path.
- **Lesson:** an every-X invariant needs either exactly ONE home for X (one writer module, one
  view-application point) or an explicit allowlist of X-sites the gate enumerates — a single-file grep
  is not a set-scoped guarantee.
- **Refs:** STATE §Feedback (architect, story 02); VERIFICATION @finding-F-26-05; ADR-007; fitness #6.

## R4 — A prescribed fix must be verified against the seam's ACTUAL shape; the orchestrator must cross-read findings before dispatching them

- **Kind:** near-miss · **Area:** process · **Stage:** verify (review) · **Owner:** orchestrator · **Raised by:** PO (synthesis of architect + QA, story 01)
- **What happened:** a proposed must-fix predicate (`envelope?.synced === true`) was itself wrong — the
  real sync-success envelope carries NO `synced` key, so the literal fix would never have held. It was
  caught only because two independent reviewers examined the same seam and QA's fixture-honesty pass
  established the envelope's true shape.
- **Why:** a reviewer prescribed a fix against the *expected* envelope contract, not its *actual* shape.
- **Lesson:** a reviewer prescribing a fix against a contract (envelope/schema) verifies the contract's
  actual shape first; the orchestrator cross-reads review findings before dispatching them as a batch,
  so a wrong prescription from one lane is caught against another's evidence.
- **Refs:** STATE §Feedback (PO synthesis, story 01).

## R5 — A "zero-change for milestone N" claim or a cross-milestone shape/count citation must state its axis and carry its as-of date

- **Kind:** near-miss · **Area:** architecture · **Stage:** refine→build · **Owner:** architect · **Raised by:** architect + craft (m26 design / story 00)
- **What happened:** `mesh-sync.mjs`'s header claimed "runs in m26 sync with ZERO engine change" —
  true for CONTENT (payload-agnostic) but false for SCOPE (the engine staged only `meshDir`; runs live
  outside it); settled honestly in ADR-002's root-set argument. Same class: an ADR preamble's fan-in
  count (mesh-store ← 3) went stale within the milestone (← 4 at review); a task-03 feature comment
  cited the stale m23 `{nodes}` shape; the `aof mesh` usage banner still reads "verbs arrive with later
  stories" though nine verbs are live (F-26-03).
- **Why:** a blanket "zero-change" / shape / count citation reads as a guarantee the graph later
  disproves; comments and citations go stale within AND across milestones.
- **Lesson:** a "zero-change for milestone N" claim must name WHICH axis is unchanged (content vs scope
  vs signature); any fan-in count or cross-milestone shape citation carries its as-of date, so drift is
  detectable rather than silently wrong.
- **Refs:** STATE §Feedback (architect m26 design; craft/architect story 00); ADR-002; VERIFICATION @finding-F-26-03.

## R6 — A real-fleet `@manual` soak needs a launched entrypoint for every seam it drives — check at refine, or scope the soak to what the CLI can drive

- **Kind:** misunderstanding · **Area:** process · **Stage:** verify · **Owner:** verify/PO · **Raised by:** verify (KR2 soak)
- **What happened:** task 04's KR2 soak was written to drive a real two-node fleet including a running
  relay and cross-node run-record visibility. At verify both proved un-launched at m26: `serveRelay`/
  `relayMode` and the `startSyncLoop` background mover are built and unit-proven but wired to NO CLI or
  daemon; `mesh:sync` carries only `.mesh`, and `run-start`'s widened runs-sync runs before its own
  mint. So the relay-up defer half was un-drivable, and the crashed-node reclaim was observable only by
  an extra cooperative run-start propagating the orphan. KR2 correctness was still fully proven at the
  git cadence (the milestone's relay-independent invariant held).
- **Why:** the soak's `@manual` wording assumed launched movers that the milestone had built as
  mechanisms but not exposed (a serve/daemon face concern) — the gap was invisible until the fleet ran.
- **Lesson:** when a milestone's acceptance is a real-fleet soak, verify at REFINE that every seam the
  soak drives has a launched entrypoint (a serve/daemon/CLI verb); otherwise scope the `@manual`
  wording to what the registered CLI can actually drive and route the unlaunched movers as explicit
  forward work.
- **Refs:** VERIFICATION @finding-F-26-01 / F-26-02; ADR-008.

## R7 — When applying an honest-failure doctrine, audit EVERY step for coverage — an un-enveloped step silently wedges

- **Kind:** near-miss · **Area:** code · **Stage:** build · **Owner:** core · **Raised by:** craft pass (story 00)
- **What happened:** `syncMesh` envelopes pull/push failures honestly but swallows a FAILED `git commit`
  into a success-/noop-shaped envelope — on a clone without git identity the tick reports "clean no-op"
  forever while staged changes never move, contradicting the engine's own honest-failure doctrine. A
  pre-existing m22 shape, out of story-00's frozen-surface contract, so deferred (the one operational-risk
  item this milestone left open).
- **Why:** the "every transport step returns an honest envelope" doctrine was applied to pull/push but
  the commit step was left un-enveloped.
- **Lesson:** when a doctrine covers a family of steps, audit every member — a single un-enveloped step
  (commit) is a silent-wedge risk exactly where the doctrine promised safety.
- **Refs:** STATE §Feedback (craft pass, story 00); candidate `commit-failed` envelope follow-up.

## R8 — A parallel-story's review + commit must stage ONLY its manifest pathspec

- **Kind:** near-miss · **Area:** process · **Stage:** build→verify · **Owner:** orchestrator · **Raised by:** architect (story 00 review)
- **What happened:** story 01 began writing `src/mesh-lease.mjs` and the orchestrator updated records
  WHILE the story-00 review ran, so the working tree was not a clean story-00 snapshot. Diffing against
  the story's explicit "owns" manifest worked, but a naive `git add -A` at commit would have let the
  in-flight sibling files ride along.
- **Why:** parallel-story authoring means the working tree is never a clean single-story snapshot.
- **Lesson:** a parallel-story's review diffs, and its commit stages, ONLY that story's manifest by
  explicit pathspec — never `git add -A` while a sibling is mid-flight.
- **Refs:** STATE §Feedback (architect, story 00).
