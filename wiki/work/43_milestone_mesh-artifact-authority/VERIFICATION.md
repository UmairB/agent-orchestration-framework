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

## 43/03 · Write-triggered artifact sync — built and validated 2026-08-02, **AWAITING `@uat`**

Lanes in scope: **`@executable`** (32 scenarios, all four tasks) + **`@manual`** (2) + **`@uat`** (1).
The `@uat` is why this story is `in-review` and not `done` — see the gate below.

### Verification evidence

- **`@executable` suite green — 38 run / 0 failed** (the 32 contract scenarios plus 6 added at review),
  re-run independently by the orchestration after the fix batch:
  `test/artifact-sync-enqueue-hook.test.mjs` (9), `test/artifact-sync-drain.test.mjs` (10),
  `test/artifact-sync-manifest.test.mjs` (8), `test/claude-settings-merge.test.mjs` (11).
- **Fitness functions green — `test/arch/*` 790 run / 0 failed**, including the three that armed on this
  story's code landing (`acd-artifact-sync-hook-derivation-free`, `acd-claude-settings-co-authored`,
  `acd-work-artifact-set-single-home`) and the neighbours' 228/0 sweep.
- **`aof work validate 43/03` → PASS.**
- **Safety confirmed at the source** — `git status --short -- .claude .aof` is **empty**, tracked and
  untracked. This repo's live hand-authored `.claude/settings.json` (~140 keys: the `SessionStart` /
  `UserPromptSubmit` / `SessionEnd` session wiring, the `PreToolUse` test-isolation guard,
  `permissions.deny`, `sandbox.filesystem`, `enabledPlugins`, `extraKnownMarketplaces`) is byte-unchanged,
  no `claude` hook was added to this checkout's `.aof/aof.config.json`, and no `work init` / `work update`
  / `assets apply` was run against this repo. Every fixture is `mkdtemp`; every hook spawn ran a byte-copy
  of the script inside its own scratch checkout.
- **Traceability** — QA mapped **32/32 contract instances 1:1**, then measured that five of them were
  vacuous (below). After the batch, **QA's own `drain-blind` plant — making `drainArtifactQueue` return
  empty and never consume — reds 7 of the 10 drain scenarios**, where before the batch it reddened
  **nothing**. That is the acceptance bar this story is held to, and it is met.
- **Falsifiability — 12 plants across the batch**, each reddening exactly its own invariant, plus the 13
  from the original build.

### `@manual` lanes — RUN LIVE 2026-08-03, both PASS

Run on real machines after the milestone build was deployed to both nodes (control node
`payload 42864d8.20260803T000925`, desktop app supervising `:4181`/`:4182`; the WSL worker
`umairs-msi-wsl` synced to the same `src/`). No daemon was started, stopped or restarted for these
two lanes, and this repo's own `.claude/settings.json` and `.aof/aof.config.json` were provably
untouched throughout (`git status --short` empty; the live file's sha unchanged at 1203 bytes).

**Task 00's `@manual` — the exec-form entry spawns and enqueues identically on every node: PASS on
two of three.** A scratch workspace per node, armed through the **real merge door** (`aof work init`,
no hand-editing). The written `.claude/settings.json` was **byte-identical on both nodes** (371 bytes,
LF): `command: "node"`, exactly one `args` element — `.claude/hooks/aof/artifact-sync-enqueue.mjs`,
checkout-relative, forward slashes, no drive letter, no leading separator, no `..` — matcher the exact
string `Write|Edit|NotebookEdit`, and the `aofManaged` marker. The installed script hashed identically
on both nodes and against the repo's source.

A **real `claude -p` session** (claude 2.1.220) then performed one `Write` on each node:

| node | result |
|---|---|
| Windows control node | exit 0, one `TOOL_USE Write`, `is_error: false`. Queue gained exactly **one** line, 123 bytes, LF-terminated, no CR: `{"tool":"Write","path":"C:\\…\\wiki\\work\\99_milestone_lane1\\STORY.md"}` |
| WSL worker `umairs-msi-wsl` | exit 0, `result success`, zero hook mentions in the transcript. Queue gained exactly **one** line, 84 bytes, LF, no CR: `{"tool":"Write","path":"/tmp/…/wiki/work/99_milestone_lane1/STORY.md"}` |
| Mac worker `umairs-mac-mini` | **NOT-COVERED** — measured, not assumed: the host is reachable (`ssh … hostname` exit 0, 41 ms ping) but `which -a aof node claude` resolves **none** of the three in either a non-login or a `zsh -lc` shell, so a real session is not startable without an operator at the machine — and per the rules an SSH-spawned session would lack the login keychain anyway (the documented "unauthenticated `claude`, burned runs" hazard) |

Field by field the two lines are **byte-comparable**: identical key set and order (`[tool, path]`),
identical value types, `"Write"` byte-identical, **zero** extra keys (no workspace id, no item ref, no
node id — AC2's "derives nothing", observed in a real harness rather than a fixture), LF terminator and
exactly one line on both. The `path` values differ *only* in each OS's own spelling of the same file,
which is the contract's own requirement that the payload path be carried **verbatim** — and through
`normalizeArtifactPath` both converge exactly to `wiki/work/99_milestone_lane1/STORY.md`.

This is the proof no fixture could give: **a real Claude Code harness on two different OSes fires the
entry aof ships and produces the same line.** Given that the trigger was not delivered at all until this
morning's fix (finding C1), it is the lane that most needed running.

*Observability note worth carrying:* the artifact-sync hook produces **no** `system/hook_started` or
`hook_response` event in the stream-json transcript on either node, while the operator's `SessionStart`
hook does — the harness surfaces only hooks that emit output, which is independent confirmation of the
"writes nothing on stdout" clause, observed in the real harness.

**Task 03's `@manual` — arming the hook on a scratch clone leaves the operator's live settings intact:
PASS, every Then.** A real `git clone --no-hardlinks` of this repo (HEAD `42864d8`), the operator's live
`.claude/settings.json` copied in, the claude-runtime hook added to the clone's `.aof/aof.config.json`,
then the verbs driven there:

- `permissions`, `sandbox`, `enabledPlugins`, `extraKnownMarketplaces` — **all four value-identical AND
  serialisation-identical**. Top-level key set unchanged; the `hooks` event-key set unchanged and in its
  original order.
- `SessionStart`, `UserPromptSubmit`, `SessionEnd`, `PreToolUse` — **all four byte-identical**.
- The only change is `PostToolUse` `[]` → one aof-marked group: substituting that group back makes the
  merged document **deep-serialisation-identical to the committed file**. **45 of the 50** original
  non-empty lines survive verbatim; the 5 that do not are exactly the operator's compact one-line hook
  groups, re-expanded to 2-space JSON.
- A subsequent run writes **nothing**: after `work update` the sha, mtime **and inode** were frozen
  across a second `work update` *and* a `work init --force` — the harder door, the one that "treats every
  unlocked file as fresh". No temp file left beside it.
- The plan envelope names **zero** actions for the file on either verb (`work init --force --json`
  updated 35 files and named it in none; `claudeSettings: {action:"skipped", written:false, drift:[]}`).
- **The operator's own wiring still fires with aof's entry spliced in beside it**, directly observed in a
  live session in the clone: `SessionStart` → `hook_response exit_code 0`; `UserPromptSubmit` → the
  session record's `lastPingAt` advanced while `startedAt` held (`pingSession`'s semantics and nothing
  else's); `SessionEnd` → the record file unlinked; and the `PreToolUse` **test-isolation guard actually
  blocked a real Bash call**. A final combined session did one `Write` and produced exactly one queue line
  *while* the operator's hooks fired and the settings file's sha and mtime stayed unmoved.

**Correction to a figure recorded earlier in this document.** QA measured the one-time reformat as
`1203 → 1913 bytes, 51 → 93 lines` on a fixture. The live clone gives **1203 → 1743 bytes, 50 → 91
newline-terminated lines**, CRLF → LF confirmed. The developer bounded it three ways (bundle declaration
alone, config hook under the bundle's id, config hook under a different id → 1743 / 1743 / 2064); **none
is 1913**, so the fixture figure is stale — most plausibly measured before ADR-013/C2 removed the
absolute-queue-path argv element, whose long absolute temp path is the right order of magnitude for the
difference. The **shape** of QA's finding stands (a one-time, irreversible whole-document reformat in
which every value survives); only the magnitude was wrong.

### Two findings from the live run (neither a defect in shipped code)

| id | observed | disposition |
|---|---|---|
| L-1 | **`aof work init` (plain) refuses in a clone of this repo, exit 1** — `.aof/aof.lock.json` is tracked, so a clone carries one and init is guarded (`Run \`aof work update\`… or \`aof work init --force\``). It wrote nothing. The `@manual` scenario's literal "`aof work update` then `aof work init`" therefore cannot both run un-forced on a clone of *this* repo | The Then is satisfied — the harder `--force` door was driven instead and the file stayed byte-frozen. The **scenario's phrasing** needs the note, not the code |
| L-2 | **The bundle↔config union is keyed by hook `id`**, so declaring the hook in config under an id other than the bundle's (`claude-artifact-sync`) yields **two** aof-managed `PostToolUse` groups. Measured on a real workspace: markers `["claude-artifact-sync","aof-artifact-sync"]` | **Cosmetic today, not a double-enqueue** — measured on a real write, the harness deduplicates identical exec-form `command`+`args` and still produced exactly **one** queue line. Worth an id-collision note; the story's own test fixture uses a different id from the bundle, which is how it surfaced |

### `@uat` — RUN LIVE 2026-08-03 on a real two-node mesh; **ACCEPTED by the operator**

The scenario's own words: *"it needs a real remote node running a real Claude Code agent whose own writes
fire the hook, and an operator reading the control node WHILE the run is still live."* That is what was
run — on the standing test-bed (`C:\Source\umair\aof-test-repo`, workspace `52294b307214c27d`), with the
Windows control node on `payload 42864d8` and the WSL worker `umairs-msi-wsl` executing
`/aof:refine 00` under assignment `428fd15a-8409-47f7-bb45-4d8868ddeb7b`, run
`20260803T001759834Z-0000`.

**The hook fired on the remote agent's own writes.** The worktree
(`~/source/aof-test-repo/.aof/mesh/worktrees/428fd15a…`) carried the shipped entry — `aofManaged:
"claude-artifact-sync"`, matcher `Write|Edit|NotebookEdit` — and the queue took lines as the agent
worked, e.g.

```
{"tool":"Edit","path":"/home/umair/source/aof-test-repo/.aof/mesh/worktrees/428fd15a…/wiki/work/00_milestone_mesh-smoke/SPEC.md"}
```

The queue was observed rising to a line and returning to zero as the daemon drained it on its existing
tick — the rename-then-read consume, in production.

**The control node holds nine artifacts, every one authored by the worker.** Read from the control's
cache mid-run, all stamped `node_id: umairs-msi-wsl`:

| ref | doc | bytes |
|---|---|---|
| `00` | ARCHITECTURE | 23,954 |
| `00` | SPEC | 3,110 |
| `00` | STATE | 4,975 |
| `00/00` | STORY | 2,766 |
| `00/00` | **TASKS/00_greet-named-person.feature** | 6,912 |
| `00/01` | STORY | 2,017 |
| `00/01` | **TASKS/00_shout-flag.feature** | 5,316 |
| `00/02` | STORY | 2,311 |
| `00/02` | **TASKS/00_empty-name-refusal.feature** | 4,897 |

**`ARCHITECTURE.md` and `tasks/*.feature` are exactly the classes the old four-name whitelist excluded**
(`WORK_ITEM_DOC_FILES` was `SPEC`/`STORY`/`VERIFICATION`/`RETROSPECTIVE`). AC6's widened manifest is
carrying them over the wire, live.

**The headline read, on the control node, while the run was still going:**

```
$ aof work tasks 00/01 --json
{ "ref": "00/01",
  "tasks": [ { "file": "00_shout-flag.feature",
               "feature": "The shout flag",
               "scenarios": [ …"The shout flag raises the whole greeting to upper case"…,
                              …"Without the shout flag the greeting is left as it is" (executable)…,
                              …"Shouting a greeting" (outline, executable)… ],
               "counts": { "executable": 3, "manual": 0, "uat": 0 } } ],
  "fromWorker": true,
  "reportedBy": "umairs-msi-wsl" }
```

…while the control node's **own disk for that milestone contained only `SPEC.md` and `STATE.md`** — no
`stories/` directory at all, and therefore no feature file anywhere on the control's filesystem. The
envelope says so itself: `fromWorker: true, reportedBy: umairs-msi-wsl`.

**This closes `commands/tasks.mjs:15` — *"the features live in the worker's worktree and are not streamed
yet"* — observably, on two machines, with a human able to read the answer.** It is the milestone's
central claim and the reason this story exists.

**A correct intermediate state, worth recording rather than mistaking for a defect:** `aof work list`
on the control returned only ref `00` during the run, not the three stories the worker had authored,
because `list`/`next`/`find` still read the control's own disk. That is exactly the gap
`43/06 · cache-read-surface` exists to close and it is **not built yet** — the cache held the truth
(nine rows) while the disk-based reader could not see it. The milestone's end state is reached at 43/06,
and this run is direct evidence of why that story is load-bearing rather than mechanical.

## User sign-off — 43/03

**Accepted by the operator, 2026-08-03.** The claim put to them was the scenario's own: *an operator can
read a live remote agent's freshly authored features on the control node, mid-run.* They were shown the
`aof work tasks 00/01 --json` envelope above (`fromWorker: true`, `reportedBy: umairs-msi-wsl`, three
`@executable` scenarios parsed from a feature file authored minutes earlier on another machine), together
with the fact that the control node's own disk for that milestone held only `SPEC.md` and `STATE.md`.
Verdict: **accept.**

The orchestration produced the evidence and did **not** sign it — an agent signing its own acceptance
gate would defeat the purpose of the lane.

### The `@uat` gate — the two `@manual` lanes and the human acceptance

`tasks/01_daemon-drains-queue-into-one-batched-frame.feature`'s closing scenario is the human acceptance
this story exists for, and the feature says plainly why it cannot be automated: *"it needs a real remote
node running a real Claude Code agent whose own writes fire the hook, and an operator reading the control
node WHILE the run is still live. It is the outsider check on `commands/tasks.mjs:15` — 'the features live
in the worker's worktree and are not streamed yet'."*

Both `@manual` scenarios have since been **run live and passed** (above) — task 00's exec-form spawn on the
Windows control node and the WSL worker (the Mac is not covered, and why is recorded), and task 03's
scratch-clone arming against the operator's real settings file. What remains is the `@uat` alone.

### Findings

Raised across the architect (structural) and QA (behavioural) reviews. Both blockers fixed and re-verified.

| id | observed | type | sev | triage | status |
|---|---|---|---|---|---|
| C1 | **AC1 — the story's entire trigger — was never delivered.** `grep -rn "Write\|Edit\|NotebookEdit" src/ .aof/` returned **nothing**: both occurrences were a constant the tests build themselves. The bundle declared three `kind:"hook"` members, all codex; the enqueue script shipped correctly as `kind:"asset"`, but **no member declared the claude-runtime hook entry** — so `aof work init` in a fresh workspace installed the script and no entry, and AC1 was asserted against a fixture | defect | **HIGH** | blocker | **fixed** — the trigger ships as `src/bundle/hooks/claude-artifact-sync.json` (`PostToolUse`, matcher pinned to exactly `Write\|Edit\|NotebookEdit`, `runtimes: ["claude"]`); `claudeHookDeclarations()` is the one resolver (bundle ∪ project config, deduped by id, project wins). Verified at the source by the orchestration |
| C2 | **The install-time absolute argv.** `.claude/settings.json` is tracked and a `git worktree` — exactly how a mesh worker builds its checkout — inherits it verbatim. The **queue** path then resolved outside the worktree (hook inert), and worse, the **script** path made `node` itself exit non-zero **before** the script's "exit 0, always" could apply — AC4 defeated from outside the script | defect | **HIGH** | blocker; supersedes ADR-001 | **fixed** — `args` is a single checkout-relative element and the script derives its queue from `process.argv[1]`, keeping AC1's no-environment-variable and AC2's no-derivation clauses. Both QA scenarios built: a second checkout lands its line in its **own** queue and none in the first's, and the pre-amendment absolute form is shown failing beside the relative form exiting 0 |
| F-1 | **The AC5 headline scenario was vacuous** — with the worktree and the writes held constant, the frame was byte-identical whether the queue held the right names, the wrong names, nothing, or did not exist | defect (test) + design-gap (contract) | **HIGH** | fix now + contract amendment | **fixed** — scenario replaced (see ADR-013/C8 below); it now asserts a coded `artifact-sync-artifact-missing` on `aof mesh logs` for a deleted-but-named artifact, which no re-scan can produce, plus the consumed batch's own bytes |
| F-2 | Same shape, and the test had been **retitled** from the feature's "is not read" to "is not re-sent" — the assertion softened to match the build | defect (test) | **HIGH** | fix now | **fixed** — restated in the failing direction: an unchanged artifact does not ride *even when the queue names it*; a changed one rides *even when it does not* |
| F-3 | "Re-draining an already-sent batch" never re-sent anything (the hash gate suppressed it), so every Then held trivially | defect (test) | MED | fix now | **fixed** — the identical frame now goes through the control's own door a second time, which is what a reconnect does |
| F-4 | **AC7's "derived, never two literal lists" was guarded by nothing** — a planted stale literal beside the manifest passed the behavioural suite *and* its own fitness function. The guard was not weak but **blind**: its detector matched `= (Object.freeze()? [{` while the real form is `= Object.freeze(Object.fromEntries(`, so the symbol was never detected at all | design-gap | **HIGH** | fix now | **fixed** — the arch clause now requires the initializer to name `WORK_ITEM_ARTIFACTS`, forbids a literal, and pins the derived value to the manifest's `file`-kind entries in order; QA's behavioural `deepEqual` added |
| F-5 | The degrade channel was not self-limiting — one enqueued `unresolved-path` line produced **10 copies over 10 ticks** with the transport down. Third instance of this shape in the repo (the Mac's log ring was 259/260 copies of one code) | defect | MED | fix now | **fixed** — reported once per batch, cleared on confirm; asserted at one copy after ten ticks, with a new batch still reporting |
| F-6 | Relative and case-different paths were silently dropped by the drain, with no code and no warning — while the hook is *contractually required* to carry paths verbatim | defect | MED | fix now | **fixed** — coded `artifact-sync-unattributable-path`, bounded by the manifest; all three spellings covered, an ordinary source file asserted silent |
| F-9 | The `unresolved-path` degrade was asserted on the launcher's `onWarning` collector, one hop short of the `aof mesh logs` channel the Then names | defect (test) | LOW | fix now | **fixed** — assertions now run `meshLogsCommand.run({ node })` for real |
| F-11 | Run records were not hash-gated — three steady-state ticks with one run record sent three content frames | design-gap | LOW | fix now on cost-of-fix (C10) | **fixed** — an idle tick now sends **no content frame at all**, the end state AC8 describes |
| F-10 | A settings file that is valid JSON but **not an object** was refused with a message saying "not parseable JSON" | enhancement | LOW | fix now (cheap) | **fixed** — message distinguishes torn from array/string/number; three additive rows in task 03's read-side outline |
| C4 | `.aof/artifact-sync-queue.ndjson` and `.batch` were **not git-ignored** and would land in every agent worktree — crossing into 43/05, whose ADR-008 refuses on a dirty worktree. `ensureAofGitignore` also had exactly one caller (`work-init.mjs`) for three milestones, so existing workspaces would never get the entry | defect | MED | fix now | **fixed** — both entries added; `work update` now calls it, asserted against a stripped-back pre-43/03 baseline |
| C5 | A `finally { … try { closeSync(fd) } catch { fd = null } }` was a **second** runtime silence the `acd-no-new-silent-catch` detector cannot see (`fd` is block-scoped and never read again — the assignment is dead), so the pinned count of `1` was dishonest | degradation | LOW | fix now | **fixed** — the `finally` is dropped; the counter now returns 1, matching the pin |
| C3 | The drift line never told the operator about the escape hatch it depends on | degradation | LOW | fix now | **fixed** — it now says to remove the `aofManaged` key to keep a hand edit |
| C7 | ~60 lines of drain **orchestration** were inlined into `mesh-launcher.mjs`, the widest out-degree module in `src/` (2-in / 30-out) — the mechanism went to a leaf but the orchestration did not | degradation | MED | fix now | **fixed** — two call sites (`prepareArtifactSyncBatch` / `confirmArtifactSyncBatch`); the launcher went 1,660 → **1,643** lines. TECH_DEBT item 10 re-measured, with `mesh-launcher.mjs` added as the second file on that trajectory |
| — | Health: `work-orchestrator.mjs` still named the deleted `claudeSettingsJson` and told the operator to run `aof apply` (wrong verb *and* wrong mechanism); `listItems()` walked twice per tick per worktree; and if `streamClient.sendWorktreeContent` were absent, `delivered` stayed `true` and the batch was discarded unsent | degradation | LOW-MED | fix now | **fixed** (all three) |

No blocker finding is open. Root `src/` siblings went 100 → 104 — each graph-verified as ADR-earned and
leaf-shaped (`work-artifacts.mjs` 5-in/0-out, `claude-settings.mjs` 4-in/2-out, `work-content-read.mjs`
2-in/3-out, `artifact-sync.mjs` 2-in/1-out): not sprawl by subject, sprawl by directory, measured and
recorded rather than ratcheted. `global-work-store.mjs` went **1,279 → 1,250**, handing 43/04 thirty lines
of headroom against ADR-012/B4's ceiling instead of one.

### Contract amendments made at this gate (by the PO, on the architect's rulings)

- **AC5 replaced (ADR-013/C8).** AC5 demanded both *"reads content for the named artifacts **only**"* and
  *"one loop does both jobs — the targeted push AND the reconciliation backstop"*, which cannot both hold;
  the build implemented the backstop and documented the deviation in a module header, but the record was
  never amended, so the contract claimed a property the system did not have and the only scenario over it
  could not fail. The orchestration argued for narrowing the read; the architect ruled against it with
  evidence, and the ruling is accepted: narrowing would break **AC4's "never worse than today"** (an
  unwritable queue becomes N× slower than HEAD), **task 00's "within one stream tick"** for `Bash`-written
  files, and **every codex worker** — the enqueue script ships `runtimes: ["claude"]`, so a codex node's
  queue is permanently empty and *all* its artifact sync would fall to the reduced cadence, which is the
  silent-no-fire class ADR-001 rejected the `http` hook type for, re-entering through the read path. The
  affordability argument was always the **content hash's**, in both ADR-001's and ADR-007's own words.
  **(a) becomes right the day the trigger is universal** — every runtime, every write path — recorded in
  C8 with that precondition so it is not lost.
- **Task 01** — header, `Feature:` line, the headline scenario and the "only the named artifacts are read"
  scenario all restated to the property the build has and can fail on.
- **Task 03** — the torn-file rows now follow **ADR-010/R3.A** (refuse-and-report, writing nothing) rather
  than ADR-002's `absent/torn ⇒ {}`; the header paragraph that flagged the concern at refine records that
  it was upheld; AC11's Then is split per-door; and the `@manual` scenario now states what QA measured —
  the first real merge **reformats the whole document** — measured on the live clone at 1203 → 1743 bytes,
  CRLF → LF, 50 → 91 lines, with 45 of the 50 original lines surviving verbatim — a one-time,
  **irreversible** churn that reads as a whole-file rewrite in `git diff` even though every value
  survives. Subsequent runs skip cleanly with the sha, mtime and inode all frozen.
- **Task 00** — the `args` Thens no longer require an absolute path (ADR-013/C2); the argv is one
  checkout-relative element with no drive letter, leading separator or `..` segment.

### ADR amendments written at this gate

`ARCHITECTURE.md` gained **ADR-013** (C1–C10): C1 the trigger-not-delivered gap; **C2** supersedes
ADR-001's install-time absolute argv; **C3** supersedes ADR-010/R3.E in the developer's favour (the marker
is the ownership boundary and un-marking is the operator's escape hatch, so restore-and-report stands);
C4 pins the queue as ignorable runtime state; C5 rules the silent-catch count; C6 accepts non-retracting
settings keys; C7 health; **C8** supersedes AC5; **C9** rules AC7 survives as an **anti-drift rule, not a
migration promise** (it has zero production importers left — kept exported and derived so the next caller
reaching for "the record-doc names" gets the manifest's answer instead of writing a fifth literal list);
C10 rules the run-record hash gate.

### Accept decision — 43/03

**ACCEPT 43/03.** Everything automatable is green (38/0 `@executable`, 790/0 fitness,
`validate 43/03` PASS, no blocker finding open, and this repo's live `.claude/settings.json` provably
byte-unchanged throughout). Both `@manual` lanes were **run live** on two nodes and passed. The `@uat`
was **run live on a real two-node mesh and accepted by the operator** — the control node read a feature
file authored minutes earlier by a real Claude Code agent on the WSL worker, while its own disk carried
no `stories/` directory at all. `STORY.md` → `status: done`.

One gap is carried forward deliberately, and it is not this story's to close: `aof work list` on the
control still answers from the control's own disk, so it did not show the worker-authored stories during
the run. That is `43/06 · cache-read-surface`, unbuilt — and this run is the evidence that it is
load-bearing.

### Accept decision — 43/02

**ACCEPT 43/02.** Every `@executable` scenario is green (93/0 for the story, 115/0 with the inherited
item-lock lane and the frame doors), all fitness functions green (787/0) including two new ratchets, `aof
work validate 43/02` is PASS, and no blocker finding is open. The `@manual` soak is carried to the
milestone gate; G2b and G4 are recorded as open non-blocking gaps with named homes. `STORY.md` →
`status: done`.
