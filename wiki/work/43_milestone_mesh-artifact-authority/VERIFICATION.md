---
doc: verification
milestone: 43
verified: 2026-08-02
verifier: aof:verify
verdict: in-progress
---
<!--
  Milestone VERIFICATION.md — the verification record. Pointers, not restatements.
  Only sections with content are written (absence of a section is information).
  Written per story as each reaches its gate; the milestone verdict is recorded at Accept.
-->
# 43 · Mesh artifact authority — Verification

Ref resolved via `aof work find "<ref>" --json`. This milestone is verified **story by story**; the
record below grows one section per story gate, and the milestone verdict is settled once all six are
`done`.

## 43/01 · The exclusive item lock — verified 2026-08-02, ACCEPTED

Lanes in scope: **`@executable`** (tasks 00–05) + **`@manual`** (task 06, the cross-machine soak).
There are **no `@uat` scenarios** in this story and **no UI surface**, so the human-acceptance step and
the design-conformance review are both out of scope — no user was pestered and no browser was rendered.

### Verification evidence

- **`@executable` suite green — 103 run / 0 failed**, across the six story suites, re-run independently
  by the orchestration after the fix batch (every invocation under `AOF_GLOBAL_HOME="$(mktemp -d)"`;
  focused files only — the full suite binds `:4182`, held by the live control daemon):
  `test/item-lock-scope-one-home.test.mjs` (11), `test/item-lock-symmetric-scope.test.mjs` (24),
  `test/item-lock-coded-refusal-every-door.test.mjs` (24), `test/item-lock-holder-identity.test.mjs`
  (21), `test/item-lock-next-skips-held.test.mjs` (14), `test/item-lock-operator-vs-automatic.test.mjs`
  (9). *verifies →* `tasks/00…05/*.feature` `@executable`.
- **Fitness functions green — `test/arch/*` 783 run / 0 failed**, including the two this story arms:
  - `acd-item-lock-single-door` — *`executionScopeRef` is defined exactly once and the mint door is
    single* → **ok, now fully ARMED** (it self-activates on `src/item-lock.mjs` landing).
  - `acd-assignment-run-store-mesh-blind` / `acd-run-store-mesh-free` — *`src/run-store.mjs` gains no
    mesh import and no config read* → **ok** (AC8; `run-store.mjs` is unmodified by this story).
  - `acd-fact-projection-split` and `acd-assignment-transition-seam` re-run green; `acd-fact-projection-split`'s
    fixture was amended (seeded assignment `running` → `done`) with **every assertion byte-identical** —
    reviewed and cleared by the architect as a strengthening, since a terminal row is now the only
    production state reachable at that seam.
- **Frame-door regression green** — `test/control-stream-server.test.mjs` 13/13 and the two
  `test/work-insert-*` suites (58 run / 0 failed with it) confirm the F1 fix left both worker frame
  doors byte-unaffected.
- **`aof work validate 43/01` → PASS** (exit 0) — folder↔frontmatter, closed tag vocabulary, depends
  graph, all clean.
- **Traceability + litmus (the agent-only layer)** — QA mapped **89/89 contract instances 1:1** to
  asserting tests before the fix batch, and the batch added 10 more assertions (the F1 regression, two
  F6 gate-order rows, five F7 torn-store rows, two F5 payload rows). Three channel divergences were
  reviewed and **accepted as the honest reading of the contract** rather than silently coded around:
  task 00's `dispatchRef`/`scopeRef` assertions ride `resolveContinueDecision`'s verdict (not the
  `work:continue` envelope); task 00's `execution` assertion rides the board's `mesh: true` opt-in
  (`acd-work-list-contract` pins the CLI row at seven keys); task 04's settle scenario runs over a
  story-less `42` because `nextWork`'s pre-existing drill-down makes its own `Then` unsatisfiable
  otherwise. Each is stated in its test header, not buried.

### `@manual` lane — deferred to the milestone gate, by the contract's own instruction

`tasks/06_cross-machine-lock-soak.feature` is `@manual` and its header states its disposition
explicitly: *"closed by the operator at `aof:verify 43`, recorded in the milestone's UAT/VERIFICATION
record… the human at two keyboards is the only producer that can prove it."* It is **not
agent-runnable**: it requires a deployed build on two real nodes (`node scripts/install-local.mjs --wsl`)
and a restart of the desktop supervisor, which is an operator-only action under
`.claude/rules/build-deploy-restart.md`. It is therefore **carried forward to the milestone Accept**,
not run here, and it is the reason the milestone gate will need the operator.

This also leaves ADR-003's *"admitted by identity, never by exemption"* **proven in-process only** — a
limit the story recorded up front rather than discovered: `global_assignments` is control-only and
`mesh-worker-execution.mjs` does not import `assignment-record.mjs`, so cross-machine a worker is
admitted by an empty store. Task 06 is the proof that closes it.

### Findings

Raised at the build review (architect structural + QA behavioural, both run before acceptance) and all
blocking/medium items fixed in one batch, re-verified above.

| id | observed | type | sev | triage | routed-to | status |
|---|---|---|---|---|---|---|
| F1 | The held-scope skip was placed in `publishWorkspaceSnapshot` — the **shared row-writer**, whose other two callers are the worker frame doors `applySnapshotFrame`/`applyDeltaFrame`. An active assignment therefore made the control node **discard the holder's own streamed rows for the whole phase**, including the completion frame; a worker-created ref landed once then froze; the control's next disk tick erased it. ADR-004/D1's permanent revert, reintroduced by the mechanism meant to prevent it. Reproduced black-box end-to-end by QA. | defect | **HIGH** | blocker — fixed before accept | developer, per ADR-011/A1 | **fixed** — carry is now gated on `options.diskDerived`, set only by `publishGlobalWorkSnapshot`; both reads moved inside `BEGIN IMMEDIATE`; a new `@executable` regression scenario in `tasks/02` proves it, and its falsifiability was proven by re-introducing the defect (reds that test and nothing else) |
| F2 | AC7's "no log spam" asserted against a `mesh:logs` channel that is always `{"count":0}` in-process — could not fail | defect (test honesty) | MED | fix now | developer | **fixed** — the harness now spans four channels (all `console` levels, the `reportDegrade` sink, both `mesh logs` reads) behind a **non-vacuity self-check** that plants two lines and asserts the harness sees exactly 2 |
| F3 | `noStore: true` dropped by the destructure, so Examples row 3 was byte-identical to row 1 | defect (test honesty) | LOW-MED | fix now | developer | **fixed** — the three rows are now three real store states; row 3 asserts the DB file genuinely does not exist |
| F4 | A torn store yielded the coded `item-lock-undeterminable` at three doors but leaked a raw `ERR_SQLITE_ERROR` at `mesh assign` — breaking AC5's "coded at every door" under R1.4 | defect | MED | fix now | developer | **fixed** — `openLockableStore` exported and used by `mesh-assignment.mjs`; asserted over a genuinely torn DB at all four doors, including `doesNotMatch(/ERR_SQLITE_ERROR/)` |
| F5 | Refusing an **unheld** ref while a genuine-but-unrelated assignment id was presented produced a payload **naming a holder that holds nothing** (`holderNode: aof-wsl, state: running` for an unheld `43`) | defect (payload) | MED-LOW | fix now, **payload truthfulness only** — no admit/refuse decision moved | developer | **fixed** — `holderNode: null`, `state: null`, `assignmentId` = the id presented; the message no longer says "is held by"; every outcome the identity matrix pins is byte-unchanged |
| F6 | ADR-011/A2's gate order was unpinned for a **held** ref | design-gap (coverage) | MED | fix now | QA/developer | **fixed** — two Examples rows (holder `42`, requested `42/03`) pin `assignment-target-unknown` / `assignment-repo-unavailable` winning over the lock |
| F7 | Fail-closed proven only by injecting `lock.openStore`, a test-only seam living in production code; `readHeldScopes`' fail-closed had no coverage at all | design-gap (coverage) | MED | fix now | developer | **fixed** — the real `projection.sqlite` is overwritten with non-database bytes; four door rows plus a dedicated `readHeldScopes` row; the injected-seam test is gone |
| F8 | The resume scenario asserted state the test itself had just minted, then called `guardItemLock` directly — which cannot mint — so a double-minting resume would still have passed | defect (test honesty) | LOW-MED | fix now | developer | **fixed** — driven through the real `createMeshWorkerTerminalResumeHandler` with an active assignment covering the scope; falsifiability proven by disabling identity admission |
| F9 | A **top-level insert** renumbering a held milestone (the operator's own worst case at milestone grain) has no scenario — behaviour probed correct (`item-locked-by-assignment`, nothing renamed) | design-gap | LOW | backlog | QA | open — covered behaviourally by task 06's soak |
| F10 | The tick publishes a ref the cache has **never carried** even under a held scope — deliberate and commented, but stated in neither direction by the contract | design-gap | LOW | backlog | product-owner | open |
| H2 | `commands/next.mjs` reached `executionScopeRef` through the face's compat re-export — a **new** consumer dragging a face + six deps into a command that had imported only `work.mjs` | degradation | MED | fix now | developer | **fixed** — imports from the leaf `assignment-record.mjs` |
| H3 | `spine/face.mjs` carried two mechanisms for one concept (the pre-existing `shifted` special case and the new `error.detail` spread) — accretion labelled as generalisation | degradation | MED | fix now | developer | **fixed** — `error.detail = { shifted }` set at both `insert-shared.mjs` sites; the bespoke line deleted from `face.mjs`; both insert suites green |
| H4 | `heldScopesOnStore`'s doc named the tick as its consumer; the tick reads `activeScopeHolders` from the leaf instead — comment-drift, the shape ADR-010 already flagged once this milestone | degradation | LOW | fix now | developer | **fixed** — deleted; `readHeldScopes` builds the map inline and its doc names the real division |
| H5 | `heldSkipped`/`heldRefs` count **scopes**, while the comments said "rows" | degradation | LOW | fix now (comment) | developer | **fixed** |
| H6 | A stale-but-genuine assignment id renders *"held by … (state \"done\")"* — self-contradictory prose on a coded refusal | degradation | LOW | accept | — | closed by F5's message branch |
| — | **17 `src/` modules open the global mesh store for themselves, in five spellings of the same options bag; `aof work run-start` now opens it twice in one command** — a second chance to resolve the wrong `AOF_GLOBAL_HOME` (TECH_DEBT item 4's class) | degradation | MED | route out of story | `wiki/work/TECH_DEBT.md` **item 12** | routed — evidence, bite, fix shape (a once-per-invocation handle on `ctx`) and the ratchet all recorded there |

No blocker finding is open.

### ADR amendments written at this gate

`ARCHITECTURE.md` gained **ADR-011** (build-time reconciliation for story 01), in ADR-010's
SUPERSEDES/PINS/CLARIFIES form:

- **A1** — the operator-vs-automatic split is a property of the **caller**, and the discriminator is
  *whose slice is being written*, not *what triggered the write*. A writer applying another node's
  reported slice is the holder's own voice and may never be filtered by the lock.
- **A2** — the assign door's gate order is pinned: `ref-not-found → assignment-target-unknown →
  assignment-repo-unavailable → assignment-already-active → item-locked-by-assignment`, on two stated
  principles (request-validity gates precede item-state gates; among item-state gates the more specific
  answer wins).
- **A3** — ADR-009's "wave 1 touches disjoint modules" is corrected: `global-work-store.mjs` **is**
  shared with `43/02`. `43/02` **replaces** the interim carry rather than extending it, inherits task
  05's scenarios as its own acceptance contract, and whoever lands second rebases rather than merges.
  The `acd-item-lock-single-door` clause *"the publish path reads no `global_assignments` state"* is
  recorded as **armed for 43/02** and deliberately not committed now — it would be red against today's
  interim carry, and this milestone's convention is that no arch-test is committed red.

### Accept decision

**ACCEPT 43/01.** Every `@executable` scenario is green (103/0), both fitness functions are armed and
green, `aof work validate 43/01` is PASS, and no blocker finding is open. The one `@manual` lane is
carried to the milestone gate on the contract's own instruction. `STORY.md` → `status: done`.
