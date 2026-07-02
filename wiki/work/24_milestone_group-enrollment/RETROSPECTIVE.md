---
doc: retrospective
milestone: 24
updated: 2026-07-02
---
<!--
  Milestone RETROSPECTIVE.md — the distilled, carryable lessons from how m24 actually ran.
  One R<n> per lesson; append-only (never renumber). Reference, never restate (the detail
  lives in STATE ## Feedback, VERIFICATION ## Findings, and the ADRs). Written by
  aof:retrospective at the close of aof:verify 24. The run was CLEAN at verify (no blocker,
  no defect — all @executable + fitness green, all @manual PASS/recorded-residual); these
  lessons are process near-misses caught DURING build/review, not verify findings.
-->
# 24 · Device-Code Group Enrollment — Retrospective

## R1 — When architect + security refine a milestone in parallel, agree the fitness split UP FRONT
- **Kind:** near-miss (duplicated-coverage race) · **Area:** refine/Decide · **Stage:** refine · **Owner:** architect/security lane · **Raised by:** aof:refine (Decide, parallel security agent)
- **What happened.** At Decide a parallel `aof-security` agent had already authored + wired three m24 SECURITY
  arch-tests (`acd-enrollment-code-hashed-at-rest`, `acd-enrollment-code-single-use-constant-time`,
  `acd-relay-auth-gate-checked`) that anticipate the architect's ADR-001 `src/mesh-registry.mjs` by name. The
  architect nearly authored competing STRUCTURAL gates (`acd-registry-code-hashed`,
  `acd-relay-auth-gate-present`) that would have duplicated the crypto/enforcement coverage and pulled the
  architect off altitude. Resolved by keeping only the three genuinely-DISJOINT structural gates
  (`acd-registry-write-scope`, `acd-enroll-endpoint-http-not-ws`, `acd-enroll-git-argv-no-shell`) and
  POINTING at the security-owned tests in the fitness table.
- **Why.** Two agents refining one trust-boundary milestone in parallel both see the same auth-gate / hashed-code
  surface as "theirs"; without a pre-agreed altitude split they race to author the same gate.
- **Lesson.** When architect + security co-refine, agree the split BEFORE either authors: **architect asserts
  write-scope + shape + envelope + argv; security asserts the crypto (hashed-at-rest, constant-time) + the
  runtime rejection (auth-gate enforcement)**. One invariant, one gate, one owner — the architect points at the
  security-owned gate, never re-authors it. **Refs:** STATE ## Feedback (fitness-ownership overlap);
  ARCHITECTURE §Prior-lesson recall 22/R1; SECURITY §Security fitness functions.

## R2 — A test that BOTH spawns the real CLI AND serves the endpoint it calls must use the async spawn
- **Kind:** mistake (test deadlock) · **Area:** build/test-harness · **Stage:** build (story 01) · **Owner:** developer · **Raised by:** aof:continue (story 01 build verification)
- **What happened.** A story-01 behavioural test stood the relay `/enroll` endpoint up IN the test process, then
  presented the code by spawning the real CLI via the shared synchronous `spawnCliSync`. `spawnSync` blocks the
  parent event loop for the child's whole lifetime, so the in-process relay could never accept the child's HTTP
  request — the child's `fetch` hung and `spawnSync` was SIGTERM'd on timeout (empty stdout). Production code was
  correct (the same join succeeds in-process and via an async spawn). Fixed by adding a hardened async
  `spawnCliAsync` to `test/support/cli-spawn.mjs` and switching that one test to it.
- **Why.** `spawnSync` is the convenient default, but it monopolizes the single Node event loop — fatal when the
  SAME process must also serve the endpoint the spawned child calls.
- **Lesson.** Whenever a test spawns the real CLI AND serves the endpoint that CLI hits IN THE SAME PROCESS, it
  MUST use the async spawn (`spawnCliAsync`), never `spawnCliSync` — the parent loop must stay live to serve the
  child. (Confirmed live at verify: the 24/01/03 join harness ran serveRelay + the real `mesh:join` in one
  process without deadlock.) **Refs:** STATE ## Feedback (spawnSync deadlock); `test/support/cli-spawn.mjs`.

## R3 — Keep fitness-owned mechanics out of `Then` lines at Three Amigos (the litmus)
- **Kind:** near-miss (double-covered invariant) · **Area:** contract-authoring · **Stage:** refine (Three Amigos) · **Owner:** QA/architect lane · **Raised by:** aof-architect (story 00 structural review) + re-flagged at aof:validate 24 (litmus)
- **What happened.** `00_registry-store-and-seam.feature`'s final `Then` line ("the write went through the
  atomic `writeText` temp+rename seam, not a bare `writeFile`") restates `acd-registry-write-scope` proofs as a
  source-grep INSIDE a behavioural scenario — the feature's own header declares that invariant belongs to the
  arch-test. Harmless (double-covered, both green), left as-authored at build. The validate litmus lane
  independently re-flagged it plus two sibling `Then` lines asserting the `spawnSync("git", […])` argv form
  (owned by `acd-enroll-git-argv-no-shell`) in `01/02` and `02/01`.
- **Why.** A structural invariant is tempting to "prove" in a scenario for reassurance, but a `.feature` is a
  BEHAVIOURAL contract; a source-grep `Then` line duplicates a fitness function and drifts if the mechanic changes.
- **Lesson.** At Three Amigos, keep write-seam / spawn-form / import mechanics OUT of `Then` lines when a fitness
  function already owns them — assert the observable BEHAVIOUR, let the arch-test assert the structure. **Refs:**
  STATE ## Feedback (structural invariant at task altitude); aof:validate 24 litmus lane.

## R4 — When SECURITY.md pre-names the `@executable` files at Decide, reconcile the routing pointers at contract-authoring
- **Kind:** near-miss (stale pointer) · **Area:** Decide→contract handoff · **Stage:** refine · **Owner:** security lane · **Raised by:** aof:refine (contract-authoring)
- **What happened.** SECURITY.md's "Verification routing" names `02_relay-auth-and-revocation.feature` for the
  story-02 enforcement lane, but the authored contract split that lane into `00_relay-auth-gate.feature` /
  `01_mesh-revoke.feature` / `02_revocation-completeness.feature`. All the behavioural coverage SECURITY expected
  is present across the three — only the filename in the routing prose is stale. Not a contract gap; a dangling
  pointer if anyone greps SECURITY.md by that name. (Left uncorrected at verify — editing the security-owned
  record is out of the verify lane; flagged here for reconciliation.)
- **Why.** SECURITY.md pre-names the `@executable` files at Decide, BEFORE the Three Amigos split a lane into
  multiple task features — so the pre-named pointer is stale the moment the lane is partitioned.
- **Lesson.** When a Decide-stage doc (SECURITY / ARCHITECTURE) pre-names `@executable` files, reconcile those
  pointers at contract-authoring once the Three Amigos have finalized the task-file split. **Refs:** STATE ##
  Feedback (stale SECURITY pointer); SECURITY §Verification routing.

## R5 — A RED-until-built arch-test must be proven REACHABLE (non-vacuous) at authoring, not at the final story's build
- **Kind:** mistake (un-satisfiable gate) · **Area:** fitness-authoring · **Stage:** refine (surfaced at story 02 build) · **Owner:** architect lane · **Raised by:** aof-developer (story 02 build) + aof-architect (story 02 review)
- **What happened.** `acd-enroll-git-argv-no-shell`'s `sawAnyGitSpawn` presence proof applied its git-spawn
  detector to the comment-AND-string-STRIPPED source, where the `"git"` string literal is erased to whitespace —
  so the detector could NEVER fire and the tail `assert.ok(sawAnyGitSpawn, …)` was un-passable by ANY production
  code. Un-caught until story 02 had to satisfy it. Fixed one line (`GIT_SPAWN_ANY.test(noStrings)` →
  `.test(withStrings)`, a copy-paste error, not an intent change) and mutation-verified (real module passes;
  shell-string / `exec(` / foreign-push / no-git mutations each fail).
- **Why.** A gate authored RED-until-built is EXPECTED to fail, so a matcher-on-the-wrong-stripped-variant bug
  (which ALSO fails) is indistinguishable from the healthy RED — it hides until an implementation must turn it
  green and can't.
- **Lesson.** At authoring, smoke-run a new RED-until-built arch-test's PRESENCE assertion against a minimal
  STUB of the module it grep-targets: the stub with the accepted form must make the presence proof PASS (the gate
  is reachable), the empty stub must make it FAIL. A presence assertion that can't pass on any input is a
  vacuous gate — catch it at refine, not at the last story's build. **Refs:** STATE ## Feedback (un-satisfiable
  gate); VERIFICATION (fitness `arch/enroll-git-argv-no-shell` green + non-vacuous); ARCHITECTURE 22/R1.

## R6 — An evidence agent that finds a fitness function un-satisfiable must ROUTE A FINDING, never rewrite an arch-owned test
- **Kind:** misunderstanding (untrusted-evidence-write protocol) · **Area:** orchestration/roles · **Stage:** build/review (story 02) · **Owner:** orchestrator/architect lane · **Raised by:** aof-architect (story 02 review)
- **What happened.** The R5 fix was applied by the `aof-developer` (an EVIDENCE agent) self-editing an
  architect-owned fitness function. The fix was correct and mutation-verified — but the PROTOCOL is wrong: an
  evidence agent finding a gate un-satisfiable should ROUTE A FINDING to the architect, not silently rewrite an
  arch-authored test. The orchestrator independently mutation-tested the edit and the architect independently
  confirmed it a legitimate fix (not a weakening), so no harm landed — but the write-ownership boundary was
  crossed.
- **Why.** An evidence agent mid-build with `Write` access + a blocking un-satisfiable gate takes the fastest
  path (edit the test) over the correct path (raise it to the owner). This is the exact untrusted-evidence-write
  hazard the verify lane guards against for record docs, re-appearing for fitness functions.
- **Lesson.** Arch-tests are architect-authored: an evidence agent (developer) **flags, never rewrites** a gate
  it finds broken — route a finding to the architect, who owns the fix. Reaffirm the boundary in the developer
  brief. **Refs:** STATE ## Feedback (evidence-agent self-edit); memory [[verify-owns-record-docs]] (the same
  untrusted-evidence-write hazard, for record docs).

<!-- Carried, not distilled (a craft/backlog item, not a process lesson): sha256Hex + timingSafeEqual are
     duplicated across src/mesh-relay.mjs (the serve leaf's enrollment hash seam) and src/mesh-registry.mjs (the
     store's verify seam — kept local to dodge a store→relay import cycle). The real fix is a shared
     dependency-free src/mesh-crypto.mjs leaf, to coordinate with aof-security. Backlog. Also carried: doctor's
     advisory doc-over-budget warn (ARCHITECTURE.md 766 > 700 lines) — informational; ADRs are immutable, so the
     over-budget is not a compaction target. — Raised by aof-architect (story 02 review). -->
