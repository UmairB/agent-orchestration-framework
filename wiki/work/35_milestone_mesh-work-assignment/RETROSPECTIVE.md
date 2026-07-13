---
doc: retrospective
---
<!--
  Milestone RETROSPECTIVE.md — distilled, carryable lessons from HOW execution went.
  One R<n> per lesson; append-only (never renumber). Reference refs, never restate them.
  Triaged from STATE ## Feedback notes + VERIFICATION Findings + blocker stops at aof:verify 35.
-->
# 35 · Mesh Work Assignment — Retrospective

## R1 — The end-to-end capability had no control-side DRIVER; every seam worked in isolation, nothing invoked them live
- **Kind:** blocker · **Area:** architecture · **Stage:** build (caught at review) · **Owner:** architect/dispatch · **Raised by:** aof-architect + aof-qa (both, independently)
- **What happened:** all seams were built and unit-proven, but nothing on the control node connected them — `aof mesh assign` minted a row and never called `dispatchDirective` (B1), and `reclaimStaleAssignments` had no periodic caller (B2). The dispatch plane could neither START work nor RECOVER it; the SPEC's outsider-verifiable success + the `@manual` soak were unreachable.
- **Why:** the ADRs (002 dispatch, 005 reclaim) named the *seams*, not the *control-side driver* that invokes them against live state. Injected-transport/clock unit tests exercised each seam green while the production wiring between them was absent.
- **Lesson:** when a milestone's success is "the system does X end-to-end," an ADR must name the **production driver/call-site** that invokes the seams, and a fitness function must assert the seam has a **live caller** — not merely that the seam works in isolation. This is a recurrence of milestone 34's F-3404 "fixtures-hide-the-wiring" — now seen twice, so treat "seam is green in unit tests" as NOT evidence the capability runs.
- **Refs:** ADR-008 + fitness #13 `acd-control-dispatch-reclaim-driver-wired`; STATE build/review + fix pass; 34 F-3404.

## R2 — A new doc that names a specific import/store-access on a file already guarded by an inherited fitness function trips it at first build
- **Kind:** near-miss · **Area:** contract · **Stage:** build · **Owner:** Three Amigos (contract) · **Raised by:** aof-developer (stories 01 + ADR-008)
- **What happened:** twice, a milestone-35 doc named a literal access that collided with an inherited milestone-34 invariant on the same file — SECURITY.md's T2 named `isRevoked` (→ trips `acd-control-stream-tailnet-only`, which forbids `control-stream-server.mjs` importing `mesh-registry.mjs`); ADR-008's "launcher scans the store" reading implied `mesh-launcher.mjs` opens the store (→ trips `acd-global-publisher-single-seam`). Each surfaced as a red test at first build.
- **Why:** the contract authored the access literally without cross-checking the fitness functions already guarding the target file. Resolved without touching the contract (a local `isRevokedLocal` predicate; delegating the store-open to `runControlDispatchReclaimTick` in a non-restricted module).
- **Lesson:** at Contract, cross-check the **inherited fitness functions on any file a control names an import/store-access on**, and name the **delegation / local-predicate pattern** in the doc — don't discover the collision as a build-time `not ok`.
- **Refs:** STATE feedback (T2, ADR-008); `acd-control-stream-tailnet-only`, `acd-global-publisher-single-seam`.

## R3 — The repo-availability gate approximates a per-node fact the store doesn't hold
- **Kind:** misunderstanding · **Area:** contract · **Stage:** refine · **Owner:** product-owner/architect · **Raised by:** aof-developer (story 00)
- **What happened:** the gate conceptually needs "does node X hold repo Y," but `mesh.repo.published` is LOCAL config the control node can't read, and `global_node_workspaces` is roster membership. `resolveTarget` approximates via membership + the workspace-level `workspaces.last_published_at IS NOT NULL` ("has anyone published this workspace at all") — coherent and fully tested, but a workspace-level signal standing in for a per-node one.
- **Why:** the data model was framed at refine as if a per-node "holds this repo" bit existed; it doesn't.
- **Lesson:** when a store lacks a fact a gate conceptually needs, record the **approximation explicitly** and name the **column/table a future true per-node signal will require** — don't let "tested green" mask the modeling gap. A future story needing a genuine per-node signal must add the store fact first.
- **Refs:** STATE feedback (repo-availability); ADR-004, 34/ADR-008.

## R4 — Arch-test bindings imported but never spread are silently-dead fitness functions
- **Kind:** near-miss · **Area:** process · **Stage:** build · **Owner:** developer/test-harness · **Raised by:** aof-developer (story 02)
- **What happened:** `scripts/test.mjs` carried ~34 arch-test bindings imported at the top but never spread into the assembled `tests` array (milestones 22–26). They read as coverage but never run. Surfaced while arming fitness #12. Milestone 35's own tests were all verified correctly registered (import + spread) at verify.
- **Why:** the manual import-then-spread registration has no guard that every imported binding is actually spread.
- **Lesson:** an imported-but-unspread fitness binding is worse than a missing one — it looks armed. Add a harness guard (or audit) that every imported `archTests` binding appears in the assembled array; a broad m22–26 audit is recommended (out of this milestone's scope).
- **Refs:** STATE feedback; `test/arch/acd-assignment-run-store-mesh-blind.test.mjs` header (the stale `acd-fleet-reclaim-guarded` 4th proof).

## R5 — Truncation-priority for a chip sharing a row with a shrink-0 element is a design decision the .feature can't assert
- **Kind:** near-miss · **Area:** design · **Stage:** verify (and review) · **Owner:** designer · **Raised by:** aof-designer
- **What happened:** the attention-row assignment chip competes with the shrink-0 "Open board →" drill-in. Review found the chip clipping the drill-in + the node summary clipping the `failed` count (both fixed in the fix pass); verify found the `· reclaimed` note truncating to tooltip (F-3501, ruled CONFORMS-with-a-standing-rule).
- **Why:** the containment order (what clips first) wasn't stated in DESIGN up front, and the litmus deliberately keeps visual fidelity out of the `.feature` — so only the render + designer judgement catches it.
- **Lesson:** DESIGN must state the **truncation-priority** (protected element vs. optional detail) for any chip sharing a row with a shrink-0 sibling, at refine — before the render review discovers the clip. (Now codified in DESIGN §2a/§4.)
- **Refs:** VERIFICATION F-3501; DESIGN §2a/§4 + Review Notes; STATE fix pass.

## R6 — Minor process/tooling nits worth carrying
- **Kind:** near-miss · **Area:** process/tooling · **Stage:** refine · **Owner:** refine orchestration / graph tooling · **Raised by:** aof-security, aof-architect
- **What happened + lesson:** (a) a refine-stage brief cited the milestone reference at a repo-root path when it is co-located under the milestone folder → **briefs should cite the milestone-local reference path**. (b) `aof graph impact` reported a **phantom edge for a deleted file** (`mesh-issue.mjs → global-work-publisher`); harmless here (cross-checked with grep; `acd-no-git-bus-return` asserts against the source tree, not the graph), but a stale coupling edge could mislead a boundary decision → **`graph build` should reconcile deleted files, or `graph impact` should flag nodes with no backing file**.
- **Refs:** STATE feedback (aof-security; aof-architect).
