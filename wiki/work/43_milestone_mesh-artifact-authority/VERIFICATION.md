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

### Accept decision — 43/01

**ACCEPT 43/01.** Every `@executable` scenario is green (103/0), both fitness functions are armed and
green, `aof work validate 43/01` is PASS, and no blocker finding is open. The one `@manual` lane is
carried to the milestone gate on the contract's own instruction. `STORY.md` → `status: done`.

## 43/02 · The authority cut — verified 2026-08-02, ACCEPTED

Lanes in scope: **`@executable`** (tasks 00–07) + **`@manual`** (task 08, the cross-machine soak).
**No `@uat`** and **no UI surface** — human acceptance and design conformance are both out of scope.

### Verification evidence

- **`@executable` suite green — 93 run / 0 failed** across the eight story suites
  (`test/cache-authority-{fact-not-projection,upsert-seam,author-retraction,alternation,contention-lock,frame-row-by-row,workspace-removal,own-disk-read}.test.mjs`), re-run independently by the
  orchestration after the fix batch together with the inherited item-lock lane and the frame doors —
  **115 run / 0 failed**. *verifies →* `tasks/00…07/*.feature` `@executable`.
- **Fitness functions green — `test/arch/*` 787 run / 0 failed**, including the three this story moves
  and the two ratchets the architect committed at this gate:
  - `acd-fact-projection-split` — amended as the story's `## Notes` budgeted for, and judged **stronger**
    by review: a repo-wide sweeper scan replaces one string check; the guard is proven *behaviourally*
    (it throws `fact-table-wholesale-delete` and deletes nothing, while `projection_errors` is still
    swept) rather than by spelling; the raw-`DELETE` rule now distinguishes a retraction from a sweep by
    requiring the `node_id = ?` authorship predicate on every workspace-scoped delete outside the two
    named doors.
  - `acd-work-items-single-writer` — armed by the reclassification and green, plus two new ratchets: a
    **1,280-line ceiling** on `src/global-work-store.mjs` (ADR-012/B4) and a **pinned caller set** for
    the newly-exported `wholesaleDelete` (B3).
  - `acd-control-stream-tailnet-only` — re-pointed from a hard-coded function name to a by-class
    locator. Judged **stronger**: the old form had a real vacuity hole (a missing `redactDescriptor`
    made `-1 < writeIdx` pass); the new one asserts both indices `>= 0` first. Its slice was narrowed at
    review to end at `applySnapshotFrame`.
  - `acd-item-lock-single-door` — ADR-011/A1's armed clause **discharged**: `global-work-store.mjs`
    reads no `global_assignments` state, detected at both the SQL and the import boundary, each
    self-checked against the exact shape 43/01 shipped.
  - `acd-work-list-contract` — correctly **untouched**; per ADR-010/R4.1 the staleness envelope rides
    the HTTP face and `work list --json` stays a byte-identical flat array.
- **`aof work validate 43/02` → PASS** (exit 0).
- **Traceability** — QA mapped **82/82 contract instances 1:1** (85 tests = 82 + 3 deliberate extras),
  with no MISSING and none of the three vacuity shapes that sank 43/01. The fix batch took it to 93.
- **Falsifiability — 17 planted defects, each reddening exactly its own invariant.** Independently
  spot-checked by QA on the three highest-value invariants: disabling the authored-elsewhere guard reds
  13 tests (the whole alternation proof and nothing collateral); dropping `node_id = ?` from the
  retraction predicate reds 16; swapping `ownerNode ?? frameNode` reds exactly 2 (the impostor scenario
  and its row). The connection-authenticated identity genuinely beats a self-reported one, proven both
  ways.

### `@manual` lane — deferred to the milestone gate

`tasks/08_cross-machine-cache-authority-soak.feature` is `@manual` and needs two real machines and a
deployed build — an operator action under `.claude/rules/build-deploy-restart.md`. Carried to the
milestone Accept alongside 43/01's task 06.

### Findings

| id | observed | type | sev | triage | routed-to | status |
|---|---|---|---|---|---|---|
| G1 | **AC5's headline claim was false as built.** `upsertWorkItems` opened one `BEGIN IMMEDIATE` per batch and its completeness screen covered four of the eight bound columns, so a present-but-non-bindable value (array, object, boolean) threw and **zero rows landed**. On the frame path the whole frame was dropped silently into `reportDegrade`; on the disk path `title: [alpha, beta]` in one record doc — ordinary operator input, since `parseFrontmatter` deliberately parses inline lists — **froze every other item in the workspace on every tick** until a human edited that doc. P0.3 verbatim, and reproduced independently by both reviewers | defect | **HIGH** | blocker — fixed before accept | developer, per ADR-012/B5 | **fixed** — `itemRowFault` screens every bound value; a bad row is skipped and counted with its `reason`, **column**, **ref** and **sourcePath** (never a bind-parameter index); four new Examples rows + a new disk-half scenario in `tasks/05` |
| G2a | **A renumber left a worker-authored row parked at the old ref forever** — the operator's newly-inserted story never reached the cache and the ref rendered the *previous occupant's* slug, title and status, permanently, because every tick skipped it as `authored-elsewhere`. A regression against HEAD, where the wholesale rebuild self-healed a renumber | defect | **HIGH** | blocker — PO overruled the initial routing and required the fix in-story, since the cure is a door this story had already built but left dead | developer | **fixed** — `publish-projection` registered on `stream.reindexed` (last in the cascade); `operatorRefsFor` returns **both ends** of each remap entry; the retraction reaches the operator's own rows plus rows on refs its own act just rewrote, bound by each row's recorded author. Driven through the **real** `work:insert-story` verb, because a seam-level test would have proved the seam and missed the wiring — which was the actual defect |
| G2b | A worker-authored ref **deleted from the control's disk** survives in the cache forever — no path can remove it but a whole-workspace wipe | defect | MED | routed out — aof has **no item-delete verb** for that door to hang on | `wiki/work/TECH_DEBT.md` **item 13**, natural home 43/04 | open — item 13 retitled and narrowed to this half; it records that half the door now exists (the renumber cascade is its first caller) and what remains is a second caller |
| G3 | **AC3's "outside a lock, last-write-wins by `syncedAt`" is false between two nodes** — the guard is scoped to the same author, so between two workers **arrival order wins, silently and uncounted** | design-gap | MED | PO decision (documented default, no operator present): **behaviour unchanged, the AC's sentence narrows to "within one author"** — cross-node timestamp authority is what ADR-010/D1 forbids, since it hands the outcome to clock skew and would let a worker with a trailing clock have its own holder frames rejected (ADR-011/A1's regression by another route) | product-owner | **recorded** — an Examples row added to `tasks/04` pinning the real behaviour, whose test writes an older `worker-b` stamp over `worker-a`'s row (accepted) and fires the same-author redelivery in the same test (refused): same call, opposite outcome, decided only by whose row it is |
| G4 | **`removeWorkspaceFromCache` has zero production callers.** AC7's letter ("that path must be NAMED by this story") is met; its spirit is not reachable by any user action | design-gap | MED | PO decision: naming the function is the whole of AC7 for this story — **after** confirming nothing existed to wire | product-owner | **open, named gap.** The developer enumerated `src/commands/` and every mesh verb route (`assign, desktop, heartbeat, identity, invite, join, logs, recover-push, relay, repo, revoke, serve, status, terminal-resume, ui`): `mesh repo` has only `publish`, and `mesh revoke` removes a **node** from the roster, not a workspace's cache. **aof has no workspace-forget verb at all** — a product gap, not a code gap. Two stories have now named this function and neither could wire it |
| G5 | Task 07's "the worker reads its own worktree" fixture built the worktree from `fx.workspace`, whose `workDir` **already was** the control's dir — so it proved a temporal ordering, not source separation, and its "unaffected by what the control's disk says" Then was trivially true | defect (test honesty) | MED-LOW | fix now | developer | **fixed** — a new `workerWorktree()` fixture helper gives worker-a a genuinely separate directory; the control's disk differs both **before** the worker reads and **after** the frame lands, and the control's own read is asserted to still report the control's value |
| G6 | `operatorRefsFor`'s `remap` branch was dead code — `publish-projection` was registered on `run.started`/`run.completed`/`feedback.recorded` only | degradation | LOW | fix now | developer | **fixed** — closed by G2a's registration; the branch is now live and load-bearing |
| G7 | Two comments in `src/effects/table.mjs` (`:271`, `:312`) asserted a publish reactor on `stream.reindexed` that did not exist, plus stale "DELETE-then-reinsert row publisher" comments in `global-work-store.mjs` and `effects/stores.mjs` — the justification a future reader would trust | degradation (comment-drift) | LOW | fix now | developer | **fixed** — rewritten to state what is now true, rather than deleted |
| G8 | Two Examples rows in `tasks/03`'s alternation outline could not discriminate: `43/05`'s expected status was constant across all five rows *and* equal to the fixture's initial disk value, and the `C,C,C` row expected what the first tick already wrote | defect (test honesty) | LOW-MED | fix now | developer | **fixed** — the control's disk now moves **mid-sequence** in both, so ticks 2 and 3 assert something the first did not write |
| — | `removeWorkspaceFromCache` left `projection_metadata` behind while task 06 says "whole cache footprint" | degradation | LOW | fix now | developer | **fixed**, with the assertion added to task 06 |
| — | `src/global-work-store.mjs` grew **885 → 1,233 lines (+39%) in one story** — 17 dependents, sole declared writer of four fact tables, and ADR-009 routes 43/04's mapper, predicate and Resync into it next. `mesh-worker-execution.mjs`'s trajectory exactly | degradation | MED | **ratchet, not refactor** — a 1,200-line split inside the milestone's riskiest diff is the scope explosion the rule warns against | ADR-012/**B4** + `acd-work-items-single-writer` | routed — the ceiling is committed green and is now a **requirement on 43/04**: its read-side code lands in its own module (`src/work-read.mjs`, which ADR-005 already creates) and is *called* from the store. The file finished this story at **1,279 of 1,280** — zero headroom |

No blocker finding is open. TECH_DEBT item 12 did **not** become 18 openers — no new module opens the
global store.

### A defect the fix batch introduced and removed again — worth the record

The first cut of G1's fix added a per-row `try/catch` as a "never aborts its siblings" belt. The
falsifiability pass killed it: with the catch in place, **disabling the screen left four of the five new
tests green**, because the catch absorbed the bind error into a counted skip. An unreachable branch that
masks its own invariant is precisely the vacuity shape 43/01 was pulled up for. It was removed and the
rule enforced **structurally** instead — a new clause in `acd-work-items-single-writer` parses the
upsert's bind list and fails if any bound field is absent from the screen's field lists (imported from
the module, never re-spelled). Disabling the screen now reds six tests instead of one, and the *next*
column added to the statement is red until it is screened.

### ADR amendments written at this gate

`ARCHITECTURE.md` gained **ADR-012** (build-time reconciliation for story 02): **B1** narrows ADR-011/A1
with the full eight-cell authority matrix (a reported slice is filtered only from a **non-holder**, which
is ADR-004/D3 verbatim); **B2** supersedes A1's transaction clause (it and A1's armed clause were mutually
exclusive — the armed one won, and the residual race can only skip-or-admit, never overwrite); **B3** pins
`wholesaleDelete`'s caller set; **B4** rules the god-file trajectory and the 43/04 requirement; **B5**
rules P0.3 fix-now; **B6** routes the two deletion gaps as one; **B7/B8** rule the judgement calls,
pinning that the same-author `syncedAt` comparison **may never widen to two node ids**.

### Accept decision — 43/02

**ACCEPT 43/02.** Every `@executable` scenario is green (93/0 for the story, 115/0 with the inherited
item-lock lane and the frame doors), all fitness functions green (787/0) including two new ratchets, `aof
work validate 43/02` is PASS, and no blocker finding is open. The `@manual` soak is carried to the
milestone gate; G2b and G4 are recorded as open non-blocking gaps with named homes. `STORY.md` →
`status: done`.
