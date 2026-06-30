---
doc: retrospective
milestone: 22
updated: 2026-06-30
---
<!--
  Milestone RETROSPECTIVE.md — the distilled, carryable lessons from how m22 actually ran.
  One R<n> per lesson; append-only (never renumber). Reference, never restate (the detail
  lives in STATE ## Feedback, VERIFICATION ## Findings, and the ADRs). Written by
  aof:retrospective at the close of aof:verify 22.
-->
# 22 · Mesh Foundation — Retrospective

## R1 — A namespace-introducing milestone must author its own coverage gate
- **Kind:** near-miss · **Area:** architecture · **Stage:** refine · **Owner:** architect lane · **Raised by:** architect
- **What happened.** The existing command↔cli-bijection / route-coverage fitness gates hard-filter
  `id.startsWith('work:')`, so the new `mesh:*` namespace inherited **zero** registry-derived coverage until
  the milestone authored its own mirror gate (fitness #3, `arch/mesh-bijection`).
- **Why.** 19/R1 ("enumerate every gate a registration trips") only checks the gates that *fire*; a new
  namespace silently slips the gates scoped to the old one.
- **Lesson.** For any milestone introducing a NEW command namespace, run the *inverse* of 19/R1: confirm
  which structural gates DON'T fire because they are `work:`-scoped, and author the missing-namespace
  equivalent before building. **Refs:** ADR-001 gate enumeration; fitness #3.

## R2 — Scenario-Outline `Examples` literals must agree with the Outline's own `Then` steps
- **Kind:** mistake · **Area:** contract · **Stage:** refine (surfaced at build) · **Owner:** QA/amigos · **Raised by:** developer
- **What happened.** `tasks/01_path-partition-convention.feature`'s Outline lists `expected-leaf` literals
  `../escape.json` and `a/b.json` for the traversal rows — self-contradictory with the SAME Outline's
  `Then` steps ("parent dir is exactly `nodes/`", "one flat leaf segment", "does not escape"). Caught and
  flagged-not-bent; the seam coerces a malformed id to a flat leaf (ADR-002), and the test asserts the
  genuine no-escape invariant for all four rows, so it stayed green.
- **Why.** The Examples table was authored against the *raw* id, not the *coerced* leaf the scenario asserts.
- **Lesson.** When an Outline's `Then` asserts a coercion/safety invariant, its `Examples` expected-values
  must be the **post-coercion** values, not the raw input — or split id-policy out and assert only the
  invariant. **Carried follow-up (not done at accept — retro is RETROSPECTIVE-only):** correct the two
  traversal rows' `expected-leaf` literals to the coerced leaves (`--escape.json` / `a-b.json`).
  **Refs:** STATE ## Feedback (story 00 build); STORY 00 note; ADR-002.

## R3 — A flaky fitness proof is itself a defect; verify must run the suite enough to detect flakes
- **Kind:** misunderstanding · **Area:** process · **Stage:** verify · **Owner:** verify lane · **Raised by:** aof:verify 21
- **What happened.** `arch/mesh-bijection` proof (c) spawned the real CLI over a `mkdtemp` fixture and failed
  ~1-in-3 full-suite runs (Windows `CreateProcess` returning `status===null` under cumulative temp-dir churn)
  while passing 30/30 in isolation. Resolved in build by routing CLI spawns through a shared `spawnCliSync`
  that retries ONLY the never-ran null-status case (a real exit/signal passes straight through, so a genuine
  failure is never masked).
- **Why.** A single green suite run is not proof when the suite is nondeterministic; an env-flaky proof reds
  a structurally-sound gate (or, worse, greens by luck).
- **Lesson.** A milestone carrying a flaky fitness function should not pass verification. Verify runs the
  suite **enough times to detect flakes** before sign-off — honored here (3 verify-time full-suite runs,
  1598/0 each, 0 bijection failures). **Refs:** STATE ## Feedback (RESOLVED-IN-BUILD); `test/support/cli-spawn.mjs`;
  fitness #3.

## R4 — "git IS the bus" means a live `mesh:*` run mutates the tracked work stream — ignore it in the self-host repo
- **Kind:** mistake · **Area:** process · **Stage:** build · **Owner:** developer/orchestrator · **Raised by:** developer/orchestrator
- **What happened.** Running `aof mesh identity`/`sync` against the **real aof repo** during dev persisted a
  machine-specific node record to `wiki/work/.mesh/nodes/<host>.json` and a `mesh` block into
  `.aof/aof.config.json` — because the partition root is *designed* git-tracked (ADR-002/003), there is no
  ignore for it, so a stray dev run pollutes the tracked stream. Cleaned both up; the verify-time `@manual`
  was run in **isolated scratchpad clones**, never the real repo, so no pollution this pass.
- **Why.** In a real deployment `.mesh/` IS the committed bus; the aof self-host repo is not itself a mesh node.
- **Lesson.** The self-host (non-deployment) repo should `.gitignore wiki/work/.mesh/` and devs should drive
  live `mesh:*` only against throwaway clones — distinct from a real node where `.mesh/` is the committed bus.
  **Carried follow-up.** Add the self-host ignore. **Refs:** STATE ## Feedback (BUILD-HYGIENE GOTCHA); ADR-002/003.

## R5 — A git-as-bus convention tracking generated records must pin line endings
- **Kind:** near-miss · **Area:** architecture · **Stage:** verify · **Owner:** architect lane · **Raised by:** aof:verify 22
- **What happened.** The `@manual` two-node acceptance's "own record byte-identical" assertion first FAILED
  under the host's `git core.autocrlf=true`: a peer's checked-out record was CRLF (634 B) vs the owner's LF
  original (600 B). `tr -d '\r'` proved the content byte-identical — the divergence is git's checkout
  normalization, orthogonal to the mesh's sync logic (`mesh:status` reads via `JSON.parse`). With
  `core.autocrlf=false` the assertion passed (11/11).
- **Why.** The git-tracked `.mesh/` records carry no `.gitattributes` line-ending pin, so a mixed-OS fleet
  (or any `autocrlf=true` node) sees byte-divergent — though content-identical — record files.
- **Lesson.** A convention that uses git to carry **generated** record files across heterogeneous nodes must
  pin their line endings (`.gitattributes` `eol=lf` / `-text` for `.mesh/**` or the record `*.json`) so the
  bytes are stable across platforms. **Refs:** VERIFICATION ## Findings **F1** (deferred → m23, which builds
  presence on the same bus).

## R6 — A designed mechanic with no data source at its only call site is dead code
- **Kind:** near-miss · **Area:** architecture/contract · **Stage:** verify · **Owner:** architect lane · **Raised by:** aof:verify 22
- **What happened.** ADR-003 specifies a collision→hash-suffix rule, and `deriveNodeId` implements it via a
  `takenIds` set — but `mesh:identity.run` never passes `takenIds`, so two installs on the **same host** derive
  the **same** id (`umairs-msi`) onto the same `nodes/<id>.json` path. The suffix mechanic is unreachable from
  the command path (a first publish precedes any sync, so there is no roster to disambiguate against).
- **Why.** The ADR specified the resolution rule but not WHERE the collision set (`takenIds`) comes from at the
  one call site; the realistic deployment (distinct hosts) masks the gap.
- **Lesson.** When an ADR promises collision/uniqueness handling, pin the **data source** the mechanic reads,
  not just the rule — or document the constraint (same-host nodes need an operator-set `mesh.nodeId`, which
  wins by precedence #1). Either wire `takenIds` from the post-sync roster on republish, or document it.
  **Refs:** VERIFICATION ## Findings **F2** (deferred → backlog); ADR-003.

<!-- Not retro entries (clean catches, no process lesson — already logged in STATE/VERIFICATION, carried to
     m23 triage): the three LATENT EDGES — readNodeRecord null-ambiguity (a), readNodeRecords silent skip of a
     torn file (b), flatLeaf's cosmetic trailing-dot leaf (c). Intentional scope deferrals, not lessons. -->
