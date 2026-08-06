---
doc: verification
milestone: 43
verified: 2026-08-03
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

## 43/04 · Staleness, never eviction — built and validated 2026-08-03, **AWAITING `@uat`**

Lanes in scope: **`@executable`** (tasks 00–08, 65 scenarios) + **`@uat`** (task 09, 14 scenarios).
There are **no `@manual` scenarios** in this story. It is the milestone's only story touching `ui/`, so
it is the first to run the design-conformance step.

### Verification evidence

- **`@executable` suite green — 373 run / 0 failed across 36 suites**, re-run **independently by the
  orchestration** after the final fix batch rather than taken from any agent's report (every invocation
  under a per-test hermetic `AOF_GLOBAL_HOME`; focused imports only — the full suite binds `:4182`,
  held by the live control daemon). Runner: `scratchpad/run-final.mjs`.
  - Story data layer: `staleness-schema-v8-provenance` (6), `staleness-cached-rows-provenance` (14),
    `staleness-marks-never-evicts` (25).
  - Story UI: `board-freshness-ramp` (12), `board-provenance-attribution` (9), `board-resync-door` (9),
    `board-resync-outcomes` (8), `board-freshness-legend` (6), `board-staleness-a11y` (10).
  - Story transport: `mesh-resync` (20) — owed because tasks 05/06 are both `@ui` and cannot reach the
    codes the route layer produces.
  - Ratchets (11 suites, 47): including the two this story armed — `acd-ui-surface-file-budget` and
    `acd-test-suite-registration` — and `acd-cache-staleness-single-predicate`, tightened twice.
  - Regression (11 suites, 169): the board/fleet surfaces, the four fleet-harness consumers the
    extraction had to leave unweakened, and the cache-authority seams from 43/02.
- **`aof work validate 43/04` → PASS**; **`aof work validate` (whole stream) → PASS**.
- **`node scripts/ui-build.mjs` green** (`tsc -b` + `vite build`), and `cd ui && npx tsc -b` exit 0.
- **Three of the story's claims were proved by MUTATION, not by assertion** — the discipline this
  milestone has had to learn four times over (STATE feedback): the bounded watch poll (deleting the
  effect turns exactly the new lanes red, and killed **0** lanes before the repair), the
  local-authorship discriminator (reverting it to the shipped presence check fails only the new lane —
  measuring the blindness itself), and the fleet badge form (reverting to `full` fails the new lane).

### Design conformance — **INCONCLUSIVE**, naming the missing render

Per ADR-001/002/003 the orchestration renders and the read-only designer judges. **No render was
produced and none could be**: the board is a per-workspace server on an ephemeral port serving the
**deployed payload**, not this branch's uncommitted work, and restarting daemons on this machine is an
operator action that was not requested. The honest verdict is therefore `INCONCLUSIVE` — *not* a
`CONFORMS`/`GAPS` inferred from component source, which the process explicitly forbids.

The missing artifact, named: populated renders of the **board at 1280/768/390** (ephemeral base URL
supplied at capture time) and the **fleet at 1280/768/390/360**, carrying a stale item, a fresh item, an
unknown-`syncedAt` item, a blocked-and-stale item, and each Resync outcome standing. **That is exactly
task 09's `@uat` job**, so the gate below is where this is discharged rather than a gap to fix first.

What the designer *could* discharge — the **programmatic** half of DESIGN's binding checklists, judged
from the rendered element tree the suites assert (text, DOM order, roles, ARIA, counts, class tokens) —
it audited region by region: the detail-panel header, the provenance box and the legends are fully
discharged; four clauses are **built but unasserted** (the overview card's cluster order/anchor, the
lane card's `ml-auto` placement, the provenance box's own class set, the fleet badge's
loading/empty/error states), recorded as F-D3 below.

### Findings

| id | observed | type | severity | triage | routed to | status |
|---|---|---|---|---|---|---|
| F-A1 | m08's locked `00_routes-byte-for-byte.feature` asserts `GET /api/work/list` returns the m03 envelope byte-for-byte; ADR-010/R4.1 makes it `{ items, stalenessSeconds }`. Both accepted, cannot both hold | contract | blocker | implement the newer ADR; record the supersession on m08's contract without weakening it | PO + architect (ADR-015/E1 verified all six collateral surfaces still assert the seven-field row exactly, one level down) | closed |
| F-A2 | `work:resync` on a row **this** node authored answered `resync-owner-not-connected` — naming a connectivity fact never tested, and misdiagnosing the common case (a control-authored row goes stale exactly when the control's publish tick stops) | correctness | blocker | fifth code `resync-owner-is-self`, muted | ADR-014/E2 → developer | closed |
| F-A3 | The resync request bound (10s literal) was **shorter than the drain cadence it waits on** (15s), so ~1 in 3 healthy resyncs would report "no answer" and exit non-zero on a working system | correctness | blocker | derive from `mesh.sync.cadenceSeconds`; cadence policy extracted to `src/mesh-sync-cadence.mjs` and the launcher's private copy deleted | ADR-014/E5 → developer | closed |
| F-A4 | A **second** storage→wire translation site (`board-worker-stream.mjs:247`) set `reportedBy` from the *assignment overlay* — a different fact under this story's key, correct only by later overwrite | structure | blocker | deleted; the dead third parameter of `mergeWorkerItems` dropped with it | ADR-014/E4 → developer | closed |
| F-A5 | The Resync transport (483 new lines) had **no behavioural test** — the only exercise hit `resync-no-owner` before any row, tick or frame existed | test-coverage | blocker | 20-lane suite modelled on `mesh-recovery-push`, mutation-verified | ADR-014/E6 → developer | closed |
| F-A6 | **Six test suites imported by neither runner** — four of them milestone 43/03's behavioural proof (38 scenarios) for a story already reviewed, accepted and merged. Green when run by hand; nothing would have said a word the day they broke | process | blocker | five paid down (four registered + green; the m25 orphan retired to m35's `reference/retired-dispatch-tests/`); `acd-test-suite-registration` armed so the next orphan fails CI | ADR-014/E7 → PO | closed |
| F-B1 | **A user-facing regression**: widening `reportedBy` to every cache-published row silently retired m03's designed empty states, so on every operator's own control node the panel read "No cached VERIFICATION yet — aof-control has not reported one" instead of "Not verified yet — run `aof:verify`" — false, and it **deleted the call to action**. The suite was blind because every provenance/resync lane states a *remote* reporter | correctness | blocker | discriminator changed to `reportedBy !== thisNode`, answered from the same expression that renders AC 11's `(this node)`; local-authorship lanes added | ADR-015/F5 → developer | closed |
| F-B2 | R4.4 said **lift** the 1s tick; the build **added** one — one cadence from three homes with three spellings, under a comment claiming "one number, so the surfaces cannot drift apart". The added tick was provably redundant | structure | major | leaf interval deleted, root `now` threaded down | ADR-015/F6 → developer | closed |
| F-B3 | `DetailPanel.tsx` took **+284 lines in this one story — more than in the entire month before it** — and crossed 1,000: `global-work-store.mjs`'s trajectory one layer over | health | major | `ProvenanceLine` extracted (994 lines, ceiling 1,000); `acd-ui-surface-file-budget` armed | ADR-015/F2 → developer | closed |
| F-B4 | `acd-cache-staleness-single-predicate`'s `ui/` clause was **satisfiable by a rename** — measured: `const stale = now - Date.parse(row.syncedAt) > windowSeconds * 1000` passes every clause, and `windowSeconds` is what every downstream consumer already calls it | test-quality | major | detector re-keyed on the **subject** (only `freshness.mjs` may read `syncedAt` off a record) | ADR-015/F1 → architect | closed |
| F-C1 | The **bounded watch poll had no falsifiable test** — QA deleted the effect and three of the story's own lanes stayed green, including the very scenario R4.3(b) exists to protect, which the *broken* build satisfies more reliably. All eight "a fresher copy lands" moments drove the operator's **manual** `⟳ sync` | test-quality | blocker | lanes now land the copy the way production does, against a settled baseline measured in-lane; mutation-verified | QA → developer | closed |
| F-C2 | `src`'s `cacheFreshness` and `ui`'s `freshnessState` **disagreed** on a missing/invalid window (`stale` vs `unknown`) — against ADR-006's own "two predicates that can disagree is a defect, not a variant" | correctness | major | `cacheFreshness` returns `unknown`; `resolveCacheStalenessSeconds`'s config-layer fallback (and its honouring of `0`) deliberately untouched, with both layers now named in the header | QA → developer | closed |
| F-C3 | Task 06's "never pre-disabled on presence" Examples column was **never bound** — three rows, one fabric, the distinguishing value dropped | test-quality | minor | absence asserted positively off the real wire | QA → developer | closed |
| F-D1 | DESIGN specified a **viewport-keyed** badge yield for a card whose width is viewport-**invariant** (`repeat(auto-fill, minmax(320px,1fr))` adds columns, not width — the card is narrower at 2560 than at 1280) | design-gap | major | requirement **withdrawn**, not deferred; new binding rule "the form is chosen by the SURFACE, not the viewport"; `minimal` reserved with its `role="img"`/`aria-label` contract still binding | designer (DESIGN.md amended, 15 changes) → PO amended tasks 03 + 09 | closed |
| F-D2 | Two defects **in DESIGN.md itself**: a self-contradiction ("badge and label never both appear" vs its own §1c and a11y rule 10, which *require* both), and **no yield rule at all** for the detail panel header — the narrowest row carrying the widest form, by arithmetic within ~±20px of overflow at the primary judgement width | design-gap | major | both fixed in DESIGN.md; the header overflow is the **first** thing the `@uat` reviewer is pointed at | designer | closed |
| F-D3 | Four binding-checklist clauses are **built but unasserted**: the overview card's cluster order/anchor (checklist region 2 has no lane at all), the lane card's `ml-auto` right-end placement, the provenance box's own class set, the fleet badge's loading/empty/error/fresh states | test-coverage | non-blocker | **deferred** — each is a structural clause the `@uat` render also covers; carried as a named gap rather than closed silently | backlog | open |
| F-D4 | `resync-owner-is-self` was asserted only on the pure derivation, on a premise (`commands/resync.mjs` still returns `owner-not-connected`) that was already stale — the only one of the eight rendered Resync states with no producer behind it | test-quality | major | producer-fed end to end through the real door → route → command | QA → developer | closed |
| F-E1 | A fresh copy pushed in the **final interval** of the watch window is not collected automatically (the poll fires at ack+5s and ack+10s; the third tick coincides with the window's own expiry and is cleared by it). The operator gets the honest "no answer" and picks it up on the next sync | behaviour | non-blocker | **accepted as designed** — it follows from the bounds ADR-014 set, not from a mistake. Recorded so it is not re-discovered as a bug | STATE feedback | open (by design) |

Every blocker is **closed**. The two open findings (F-D3, F-E1) are non-blocking and named.

### Contract amendments made at this gate (by the PO, on the reviewers' rulings)

The `.feature` files are a locked contract for *developers*; the PO corrects one only when it is
demonstrably unsatisfiable or false, and records why inline. Four were needed — an unusually high
count, itself distilled into the retro:

1. **Task 03 + task 04**, the same defect at two addresses: an Examples cell spelling out `synced 4s
   ago`, which the single `relativeTime` formatter those lines *delegate to* cannot produce (it renders
   anything under five seconds as `just now`). Ages moved to 10s; the vocabulary was never in question.
2. **Task 01**, unsatisfiable as written: the `Then` fixed `syncedAt` as null **unconditionally** while
   the table varied the stored instant, so its third row (`instant known, node unknown`) could not
   pass. The `Then` is now parameterised over both halves of its own subject.
3. **Task 03**, a false premise with a right outcome: "gates are local acceptance items with no cached
   provenance" — measured, a `uat` gate row **does** carry `reportedBy`/`syncedAt`; the badge is absent
   because no gate-bar component paints one, which is a claim about *where the ramp renders*.
4. **Task 03 + task 09**, on the designer's ruling: the fleet card's form (`minimal` → `short`) and
   task 09's whole yield outline, rewritten from "did the ladder fire in the right order" to "does this
   surface's ONE pinned form FIT" — with the highest-risk cell (the detail header at 1280) named.

Also amended: **m08's `00_routes-byte-for-byte.feature`**, which now records the R4.1 supersession for
`GET /api/work/list` rather than silently asserting something false. Editing the scenario itself was
rejected — it would have destroyed the evidence that the contract moved.

### ADRs written at this gate

**ADR-014** (build-time reconciliation, `src/` half — rulings E1–E8) and **ADR-015** (UI half —
F1–F9). Between them they rule the m08 supersession and the ACCEPT-time rule it earns, the fifth
resync code, the `global-work-store.mjs` ceiling holding at 1,280 unraised, the one-mapper boundary
(row-subject → `cache-provenance.mjs`, response-subject → the face, so a fourth envelope key needs no
fifth ruling), the bound-vs-cadence defect, the transport's owed test, the suite-registration ratchet,
and the `ui/` file budget. R4.1's stale wording was corrected **by ruling rather than by edit**, on
E1's own argument.

`TECH_DEBT.md`: item 10 extended (root `.mjs` 104 → 106; 42% of the flat root is now two subjects with
no directory), item 12 updated (store openers 17 → 19, crossing its own stated threshold), item 17
created then paid down to one named baseline, item 18 created (`ui/` has no shared layer — `fleet/`
reaches into `board/` seven times; and the fleet payload states no serving-node identity, which is the
prerequisite for a board↔fleet "this node" agreement lane).

### The `@uat` gate — **RUN 2026-08-06 over a real render; ACCEPTED by the operator**

The design-conformance verdict had been **INCONCLUSIVE by construction** since 2026-08-03 for one
reason only: there was no render. There is now.

**How the render was produced.** An ISOLATED fixture: the real production board (`ui/dist` + the real
`/api/work/*` face via `serveSetupUi`) over its own `AOF_GLOBAL_HOME`, seeded through the real
publisher — the operator's live `~/.aof`, the running daemons and `~/.claude.json` were never touched.
(`serveBoard` was deliberately NOT used: it wires the real `ensureWorktreeTrusted`, which writes the
operator's `~/.claude.json`.) The wire came back as ADR-010/R4.1 specifies —
`{ items, stalenessSeconds: 300, nodeId }`, per-row `reportedBy`/`syncedAt`, and an EXPLICIT
`syncedAt: null` for the pre-v8 row. The fixture carried a stale item reported by `umairs-mac-mini`, a
fresh one reported by this node, one with unknown `syncedAt`, and a **blocked AND stale** one, plus a
`uat` gate. Renders were driven through the cached ms-playwright Chromium — never `npx playwright` —
with interaction and geometry taken over CDP against the same binary.

**The two clauses the contract asks to be MEASURED, measured:**

| clause | measurement |
|---|---|
| the status chip keeps its right-edge anchor whether or not a badge sits beside it | **1264 px on BOTH** — stale `#43`: `◌ stale · 13m ago` 1059–1162, `◐ in-progress` 1168–**1264**; fresh `#43/03`: `✓ done` 1204–**1264** |
| the Resync hit target is ≥ 24×24 CSS px at every breakpoint | **82 × 27** at 1280, 768 and 390; `font-size: 11px`, `1px solid` — visual weight unchanged |

**The highest-risk cell, settled with a number.** The detail-panel header at 1280 — the ~382px column
in which nothing can shrink, which the design review placed within ~±20px of overflow — **fits with
about 30px of slack** carrying the longest forms of both chips (`milestone` type chip ends at 1029, the
badge cluster starts at 1059, the row ends at 1264). `documentElement.scrollWidth === innerWidth` at
360, 390, 768 and 1280: **no page-level overflow at any breakpoint.**

**The `owner unreachable` message — the one the review said to look hardest at, because it is the most
likely production outcome and the easiest to over-alarm.** Driven for real (the REAL control-daemon
drain, `runResyncDispatchTick`, with the fabric standing in for "a socket exists but the dispatch does
not complete"), the board renders:

```
stale · synced 13m ago · from umairs-mac-mini · owner unreachable
[⟳ Resync]   owner umairs-mac-mini unreachable — showing the 13m-old copy
```

in **muted grey mono, with no red and no destructive treatment anywhere on the item**, and the control
back at `⟳ Resync`, enabled. **It does not read red. CONFORMS** — the review's stated GAP condition is
not met.

| region | verdict |
|---|---|
| stale reads DEGRADED, not broken | CONFORMS |
| blocked AND stale — two vocabularies, red on the status chip alone | CONFORMS |
| detail header cluster + the anchor rule | CONFORMS (measured) |
| nothing moves at the threshold | CONFORMS (measured — 1264 both) |
| provenance line, `(this node)`, Resync idle + unreachable | CONFORMS |
| Resync subordinate to the single teal-filled headline action | CONFORMS |
| doc region states its own provenance above the markdown | CONFORMS |
| each surface's pinned badge form FITS at every width | CONFORMS (measured) |
| the Resync hit target | CONFORMS (measured) |

**Three things recorded rather than claimed:**

1. **"the stale badge is visibly smaller than the status chip"** is not true of the BOUNDING BOX —
   badge 103×23 vs chip 96×20. It is true of type scale and weight (11px dashed outline vs a filled
   tint). Read as intended-and-satisfied on weight; recorded because the wording says "smaller" and the
   geometry does not support that reading.
2. **The unreachable MESSAGE truncates** at the provenance box edge (`…showing the 13m-old …`). The
   contract's actual clause — that the *cached facts* stay legible and untruncated — **is** satisfied:
   `stale · synced 13m ago · from umairs-mac-mini` is intact on the line above. An observation, not a
   GAP.
3. **Not covered by this run:** the greyscale / colour-vision read, the legend's Freshness block, and
   the absent-doc placeholder — the last being **unreachable in this fixture by construction**, since
   the seeded stream writes real files to disk so the doc route always finds one. Carried forward
   rather than claimed.

## User sign-off — 43/04

**Accepted by the operator, 2026-08-06**, on the evidence above: a real render of the real board at
every documented breakpoint, the two measured clauses measured, and the `owner unreachable` message
confirmed muted rather than alarming. The three items above were put to the operator explicitly and
accepted as recorded. Verdict: **accept.**

### Accept decision — 43/04

**ACCEPT.** 374 `@executable` green across 36 suites, `validate 43/04` PASS, reviewed four ways with
every blocker closed, and task 09's 14 `@uat` scenarios now judged against a real render rather than
returning INCONCLUSIVE for want of one. `STORY.md` moves to `status: done`.

### Post-incident note (2026-08-05) — this story's UI half was destroyed and rebuilt

While story 06 was in review, a `git worktree remove --force` followed a Windows junction into the
repo's real `node_modules` and, through npm's workspace symlink `@aof/ui → ../../ui`, deleted the
`ui/` directory. Story 04's UI half was **uncommitted** at the time. Recovery, in full:

- All 56 tracked files restored from `573c18c`. 49 were byte-perfect (unmodified since HEAD).
- `Board.tsx` recovered **byte-exact** from a QA mutation backup (581 lines, verified to differ from
  HEAD and to carry 8 story-04 markers).
- `ProvenanceLine.tsx`, `StaleBadge.tsx`, `freshness.mjs`/`.d.mts`, `resync.mjs`/`.d.mts` recovered
  from full write snapshots — `ProvenanceLine.tsx` at **204 lines, exactly** ADR-016/G10's
  independently measured figure.
- `DetailPanel.tsx`, `Fleet.tsx`, `board/api.ts`, `fleet/api.ts`, `Overview.tsx` and `BoardLanes.tsx`
  were **genuinely lost and re-derived** against the six intact UI suites (which live in `test/`, not
  `ui/`, and survived) plus ADR-014/015/016's recorded end state.

The re-derivation is corroborated independently of the tests: a saved copy of the `ProvenanceLine`
block *as it lived inline* in `DetailPanel.tsx`, removed from the transcript replay, yields **993
lines** — ADR-016/G10's measured figure to the line; the delivered file is 994, matching the number
already recorded above. `DetailPanel.tsx` 994 ≤ 1,000 ceiling, `Fleet.tsx` 1,532 ≤ 1,560.

**Re-verified after recovery, by the orchestration rather than the agent that did the work: 374 tests
/ 0 failed across 36 suites**, `ui-build` green, `tsc -b` exit 0. The story's evidence above stands
unchanged. One deviation accepted and recorded: `now={now}` was added to `Board.tsx`'s `<DetailPanel>`
call site (the byte-exact backup predates ADR-015's must-fixes), without which F-B2's "leaf interval
deleted, root `now` threaded down" could not hold.

---

## 43/05 · Gate-time propagation — built and validated 2026-08-04, **AWAITING `@manual` + `@uat`**

Lanes in scope: **`@executable`** (tasks 00–03, 19 scenarios) + **`@manual`** (task 04, the two-node
soak) + **`@uat`** (task 05, 3 scenarios). No UI surface, so no design-conformance step.

### Verification evidence

- **`@executable` suite green — 19/19**, plus the 3 fitness-function lanes, re-run **independently by
  the orchestration**: `gate-propagation-reuse-door-advance` (6), `-refusals-leave-branch` (4),
  `-reported-on-base-channel` (4), `-create-path-regression` (5).
- **`acd-gate-propagation-never-discards` is now genuinely ARMED** — it asserted an absence while no
  advance existed; a `merge` now exists in `mesh-worktree.mjs` and the ban is live. Green.
- **Mutation evidence, seven mutations against red-lane counts** — the strongest in the milestone:
  reverting the advance to the shipped no-op reds **17/22**; `merge` → `rebase` reds **14** (including
  the fitness function itself); removing `merge --abort` reds 3 (including the armed lane); removing
  the dirty guard reds exactly the 3 dirty lanes; suppressing the report reds 7. The pass also caught
  one of the story's **own** over-permissive lanes — "HEAD stays on the item branch" stayed green
  without the mechanism — which was then tightened.
- `aof work validate` (whole stream) **PASS**.

### Two judgement calls, both recorded in the source

1. **`already-current` is decided BEFORE the dirty-tree guard**, because that path runs no writing git
   verb: refusing a dispatch that was never going to touch the tree would convert a working continue
   into a coded failure for no safety gain. Every path that *acts* — `--ff-only` included, which
   writes tracked files exactly as a merge does — stays behind the guard. Ruled correct (ADR-016/Q5).
2. **The create door checks base availability *before* materialization; the reuse door *after*.** Not
   an inconsistency: create needs the commit **to build** the worktree, reuse needs it **to advance**
   the branch. One rule — *the availability check runs immediately before the operation that needs the
   commit* — and task 03's two rows ("no worktree was materialized" / "the worktree is retained for
   inspection") are its consequences, not its cause. Ruled sound (ADR-016/Q6).

### Findings

| id | observed | type | severity | triage | status |
|---|---|---|---|---|---|
| F-05.1 | Task 00's cell `git rev-list --count <branch>^1..<branch>` is 1 is **arithmetically unreachable** in the diverged case the scenario is about — that range is the merge PLUS the whole control line it brought in (measured: 2). It could only read 1 if the lines had never diverged | contract | blocker | PO corrected the cell to `--count --merges`, which asserts what it was reaching for | closed |
| F-05.2 | Both new refusal codes shared one message naming **no cure and no worktree path**, though ADR-010/R5.1 already requires the cure be named | diagnostics | major | `gatePropagationRefusalDetail` now names the cause, the cure and the retained worktree; ADR-016/G8 makes R5.1 general to every coded refusal this milestone adds | closed |

### `@manual` task 04 — RUN LIVE 2026-08-05; the headline claim PASSES, and the run found a REAL GAP

Run on the standing test-bed against the deployed build (control `payload
7002ffb+dirty.20260805T112416`, worker `umairs-msi-wsl` on byte-identical `src/`). The fixture was
built exactly as the Background specifies: `origin/aof/mesh/00` established at the worker's own commit
`68c8d76`, the item at a gate (all prior assignments terminal), and a **substantive** control-side edit
committed at that gate — a new `--greeting <word>` acceptance criterion carrying the unique token
`GATE-EDIT-20260805`, so "the agent saw it" is checkable rather than asserted. Pinned base `4f853f8`;
branch and base genuinely **diverged**.

**THE HEADLINE THEN PASSES.** In the worker's materialized worktree, the edited file contains the
operator's edit **verbatim**, token and all, and `git merge-base --is-ancestor 4f853f8 aof/mesh/00`
exits **0**. A control-side edit made at a gate reached a real worker's phase on another machine before
the agent started. That is the claim this story exists to restore, and on real hardware it holds.

**But the REUSE DOOR never opened, and that is the gap.** The dispatch logged
`worker-worktree-base: worktree on fresh branch aof/mesh/00 off 4f853f8…` — the **create** path. There
is therefore **no advance entry** on the log channel, no merge, and the earlier phase's commit is gone
from the line: `git merge-base --is-ancestor 68c8d76 aof/mesh/00` exits **1**, though
`origin/aof/mesh/00` holds `68c8d76` and had been fetched into the very same checkout.

Root cause, read at the source rather than inferred —
[`mesh-worker-execution.mjs:2402`](../../../src/mesh-worker-execution.mjs#L2402):

```js
const branchExists = baseBranch == null && (await localBranchExists(ws.projectRoot, branch, { exec }));
const reuseDoor = baseBranch != null || branchExists;
```

and `localBranchExists` runs `show-ref --verify --quiet refs/heads/<branch>` — **local heads only**. A
checkout that has fetched `refs/remotes/origin/<branch>` but has no local head takes the create door and
forks the item's line. The control's directive carried no `baseBranch` either, so neither half of the
`reuseDoor` predicate fired.

**This is not an artefact of the fixture.** The worker's managed checkout
(`~/.aof/mesh/checkouts/<workspaceId>`) only ever held `main`; it was always going to take the create
door. Nor is it hypothetical: any SECOND worker, or one whose checkout was rebuilt, meets it — and the
mesh exists to have more than one worker.

| # | scenario | verdict (first run) | verdict (after the F-05.3 fix) |
|---|---|---|---|
| 1 | a gate-time edit reaches a real worker's continuing phase before the agent starts | **PARTIAL** — edit ✓, base an ancestor ✓; earlier commit reachable ✗, `^2` a real merge ✗ | **PASS — every Then** |
| 2 | the advance is readable from the control in one `mesh logs --node` read | **FAIL** — no advance entry (create path) | **PASS — all five Thens** |
| 3 | from a separate clone of the real origin, both lines present after settle | NOT REACHED | **PASS on the durability claim** — push performed by hand, not by the worker's completion path (TECH_DEBT 14/21) |
| 4 | a conflicting gate edit refuses and leaves the branch untouched | NOT REACHED | **PASS on every Then but one** — the fleet carries no code (F-05.5) |

### The re-run after the fix — scenarios 1 and 2 PASS on real hardware

F-05.3 was fixed (below), deployed to both nodes, and both daemons restarted onto it (control
`payload 7002ffb+dirty.20260805T164722` at `15:47:50Z`; worker at `15:51:31Z`). The fixture was then
rebuilt to the EXACT precondition the defect needs — a checkout holding the item's line only at
`refs/remotes/origin/aof/mesh/00` (`68c8d76`) with no local head, which is what a second worker, or one
whose checkout was rebuilt, always has. Pinned base `4f853f8`.

The worker's own log channel, read from the CONTROL node in one `aof mesh logs --node` call:

```
15:53:08.741  worker-worktree-base:    worktree on EXISTING item branch aof/mesh/00 ADOPTED from origin
15:53:08.811  worker-gate-propagation: gate-propagation merged on aof/mesh/00
                                       — base 4f853f8…, tip b70014fb…
```

and in the worker's checkout:

| Then | measured |
|---|---|
| the edited file contains the operator's edit verbatim | ✅ `GATE-EDIT-20260805` present in the materialized worktree |
| `git merge-base --is-ancestor <pinned-base> aof/mesh/00` exits 0 | ✅ |
| each worker commit recorded in the Background is still reachable | ✅ `68c8d76` reachable — **nothing discarded** |
| `git rev-parse aof/mesh/00^2` resolves to the pinned base | ✅ `4f853f8` — a real merge, not a rewrite |
| the advance entry reports outcome `merged` | ✅ |
| its base hash equals the control's `git rev-parse HEAD` at dispatch | ✅ `4f853f8` |
| its tip hash equals `git rev-parse aof/mesh/00` on the worker | ✅ `b70014fb` |
| the `worker-worktree-base` entry is present alongside it | ✅ |

```
*   b70014f  aof(mesh): advance aof/mesh/00 to the dispatched base 4f853f8…
|\
| * 4f853f8  feat(work): 00 — a --greeting <word> flag, added at the gate   <- the CONTROL's line
* | 68c8d76  aof(mesh): 00 — /aof:refine 00 --autonomous                     <- the WORKER's line
|/
* 7919b4e
```

Both lines are in the tree at the tip: the worktree carries the operator's new acceptance criterion
**and** the previous phase's `ARCHITECTURE.md` and `stories/`. `^1` is the worker's commit and `^2` is
the pinned base — the merge joins them in the order ADR-008 specifies.

### Scenario 4 — the refusal, MADE to happen rather than waited for

The operator edited, on the control node, the **same line** the worker's own commit `68c8d76` had
already replaced (`To be broken down at refine.` → a stories checklist on the worker's side, → a
`CONFLICT-PROBE-20260805` sentence on the control's). Pinned base `a32eea1`. The advance refused:

```
worker-gate-propagation: assignment-gate-propagation-conflict on aof/mesh/00
                         — base a32eea1…, tip 68c8d76…            <- tip UNCHANGED
assignment-gate-propagation-conflict: … the branch is unchanged at 68c8d76…, and the worktree is
  RETAINED for inspection at … Cause: merging the base into "aof/mesh/00" conflicted; the merge was
  ABORTED, so no half-merged state was left behind. Cure: resolve the conflict … then re-dispatch.
```

| Then | measured |
|---|---|
| the fleet shows the assignment `failed` with code `assignment-gate-propagation-conflict` | ⚠️ `failed` yes; **code no** — see F-05.5 |
| `mesh logs --node` shows the advance entry carrying that code and the unchanged tip | ✅ |
| `git rev-parse aof/mesh/00` equals the Background hash | ✅ `68c8d76`, untouched |
| `git rev-parse -q --verify MERGE_HEAD` exits non-zero — the tree is not left MERGING | ✅ absent in both the checkout and the worktree; no unmerged paths |
| no agent session was started for that assignment | ✅ zero `claude` processes |
| re-dispatching after the operator resolves the conflict succeeds normally | ✅ conflict reverted on the control → next dispatch logged `merged` on base `64aaae2` |

The refusal message is worth quoting because it is F-05.2/ADR-016/G8 discharged in production: one line
carries the **cause**, the **cure** and the **retained worktree path**, so an operator can act without
opening a shell on the worker.

### Scenario 3 — the durability half, verified from a SEPARATE clone of the real origin

The advanced branch was pushed to the real origin and read back from a **fresh clone made for the
purpose**: `origin/aof/mesh/00` is listed; the pinned base is an ancestor; the worker's `68c8d76` is
still reachable; `git log --format=%H` contains **both** hashes **unchanged** (nothing rebased or
rewritten); and the tree at the tip carries both phases' work — the worker's `ARCHITECTURE.md`,
`stories/*/STORY.md` and `tasks/*.feature`, alongside the operator's `GATE-EDIT-20260805` criterion in
`SPEC.md`.

**Stated honestly:** the push was performed by hand rather than by the worker's own settle-and-push
path, which TECH_DEBT **14** and **21** block on this test-bed. So the scenario's *git durability*
claim is verified and its *"after the run settles"* framing is not — the run was withdrawn rather than
driven to `done`.

### Findings — `@manual` task 04

| id | observed | type | severity | triage | status |
|---|---|---|---|---|---|
| F-05.3 | **The reuse-door predicate is LOCAL-ONLY.** `localBranchExists` checks `refs/heads/<branch>` and never `refs/remotes/origin/<branch>`, so a worker with a fetched-but-not-checked-out item branch takes the CREATE door, bases the line on the pinned base and **orphans every commit the previous phase made**. Measured live: local `aof/mesh/00` = `4f853f8`, `68c8d76` unreachable, while `origin/aof/mesh/00` = `68c8d76` in the same checkout | correctness | **blocker** | **FIXED at this gate.** `remoteBranchExists` + `adoptRemoteBranch` in `mesh-worktree.mjs` (which owns every git verb, ADR-010 R5.2); the worker adopts a remote-only line as a local head and routes it to the reuse door, leaving the move-to-base to `advanceBranchToBase` alone so ADR-008's refusal semantics stay in one place. Re-run on real hardware: `ADOPTED from origin` → `merged`, `68c8d76` reachable, `^2` = the pinned base. **The armed invariant was extended to cover this door** and mutation-tested: reverting the fix reds exactly the new proof | closed |
| F-05.4 | The worker attempts `git clone` into an existing managed checkout and fails the whole assignment: *"destination path … already exists and is not an empty directory"* — rather than fetching into it. **Systematic, not occasional:** measured across six dispatches this session, EVERY one onto an existing checkout failed, and the workspace only became dispatchable again by moving the directory aside by hand. The 2026-08-03 history shows the same shape (three of five assignments failed identically) | correctness | major | Not this story's code, but it is on this story's only route to a real two-node run, and it means a workspace is dispatchable **once** per checkout. Routed to TECH_DEBT **21** | routed |
| F-05.5 | **The coded failure reason never reaches the assignment row, so the fleet cannot show it.** Scenario 4 requires the fleet to show `failed` with code `assignment-gate-propagation-conflict`; the row reads `state=failed, code=NULL`. Measured across the whole store: **45 of 46 assignment rows carry `code = NULL`, including all 30 `failed` ones** (the single non-null is `resumed`) | diagnostics | major | **Pre-existing across every milestone, not a 43/05 regression** — the worker does pass the code (`reportSettled(…, { code })`), so it is being dropped between the worker's report and the control's row. Not fixed here: unlike F-05.3 it is not a discard, the information is not lost (the full cause+cure is one `aof mesh logs --node` read, which scenario 2 proves), and the fix belongs to the assignment lifecycle rather than to gate propagation. Routed to TECH_DEBT **22**. It does, however, weaken task 05's `@uat` scenario 3 — "the fleet shows … a code that names the cause" — so the operator should be shown the log line, and told the fleet does not yet carry it | routed |

### Accept decision — 43/05

**`@manual` task 04 is COMPLETE and PASSES; the story awaits only its `@uat` (task 05).**

The gate found a real blocker (F-05.3 — a remote-only line was forked and the previous phase's commits
orphaned), it was **fixed at the gate**, the armed invariant was **extended to cover the door that did
the discarding**, and the whole lane was **re-run on real hardware**:

- **scenario 1 — PASS, every Then.** `ADOPTED from origin` → `merged`; the operator's edit verbatim in
  the worktree; `68c8d76` still reachable; `^2` = the pinned base, i.e. a real merge.
- **scenario 2 — PASS, all five Thens**, in one `aof mesh logs --node` read from the control node.
- **scenario 3 — PASS on its durability claim**, read from a separate fresh clone of the real origin;
  the settle-and-push framing was not exercised (TECH_DEBT 14/21).
- **scenario 4 — PASS on every Then but one.** The refusal fires, names cause + cure + retained
  worktree, leaves the branch at its Background hash with no `MERGE_HEAD` and no agent session, and a
  re-dispatch after resolution advances cleanly. The single miss is F-05.5: the fleet shows `failed`
  without the code, which is a pre-existing lifecycle gap rather than this story's.

The fix is committed with the story. **`STORY.md` stays `status: in-review` only because task 05's
`@uat` needs the operator** — there is no longer any machine work outstanding on this story.

### `@uat` task 05 — the EVIDENCE assembled for the operator (2026-08-05/06)

The `@uat`'s three scenarios ask an operator for judgements, not measurements. What follows is the
evidence each is to be judged against; the verdict itself is the operator's and is recorded below it.

**Scenario 1 — "the continuing phase worked from the EDITED item."** This is the one the mechanical
lane cannot answer, so a real cascade was driven to produce it. The gate edit deliberately asked for
something a phase must ACT on, not merely carry: a `--greeting <word>` acceptance criterion **and**
"a fourth story, `03_story_greeting-word`, covering that flag". A real Claude Code agent then refined
the milestone on the WSL worker from the pinned base carrying that edit. It produced:

```
stories/00_story_greeting-seam        <- the PREVIOUS phase's work, still present
stories/01_story_shout-flag           <- "
stories/02_story_empty-name-refusal   <- "
stories/03_story_greeting-word        <- AUTHORED FROM THE GATE EDIT
    STORY.md      "Choose the greeting word", depends: [00/00]
    tasks/00_greeting-word.feature
```

and its user story reads *"I want a `--greeting <word>` flag that swaps the leading word of the
sentence, so that I can say `Morning, Ada!`…"* — **the operator's own example sentence from the SPEC
edit**, which is about as direct as "the agent saw it" gets. The phase did not work from the pre-edit
text (which had three stories and no such flag), and nothing the previous phase produced is missing.

**Scenario 2 — "which base did it run on", from the control node alone.** One
`aof mesh logs --node umairs-msi-wsl` read returns the pair, for every outcome the advance has:

```
worker-worktree-base:    worktree on EXISTING item branch aof/mesh/00 ADOPTED from origin
worker-gate-propagation: gate-propagation merged        on aof/mesh/00 — base 64aaae24…, tip cff999de…
worker-gate-propagation: gate-propagation already-current on aof/mesh/00 — base 64aaae24…
worker-gate-propagation: gate-propagation assignment-gate-propagation-conflict on aof/mesh/00
                         — base a32eea1d…, tip 68c8d769…   (tip UNCHANGED)
```

All three outcomes — `merged`, `already-current`, the coded refusal — were produced live and read this
way. No SSH session and no worker-side `git log` was needed for any of them.

**Scenario 3 — "a refusal is legible and actionable."** The refusal line carries cause, cure and the
retained worktree path (quoted in full under scenario 4 above). **The operator must judge this knowing
F-05.5**: the scenario's own first clause — *"the fleet shows the assignment failed with a code that
names the cause"* — is NOT satisfied. The row reads `state=failed, code=NULL`, as do 45 of 46
assignment rows across every milestone. Everything needed to act is present; it is one surface away
from where the scenario says to look.

## User sign-off — 43/05

**Accepted by the operator, 2026-08-06.** The claim put to them was the story's own: *when I fix
something at a gate, does the next phase behave as though my fix had always been there — and when it
can't, do I know what to do?* They were shown (a) `stories/03_story_greeting-word` — a story the worker
authored **because of** the gate edit, whose user story reuses the operator's own example sentence from
the SPEC — standing beside the three stories the previous phase had produced, none of them lost;
(b) all three advance outcomes (`merged`, `already-current`, and the coded conflict refusal) readable
from the control node in one `aof mesh logs --node` call, with no SSH and no worker-side `git log`; and
(c) the refusal message naming cause, cure and retained worktree.

**The one clause that fails was put to them explicitly**: scenario 3's *"the fleet shows the assignment
failed with a code that names the cause"* is not satisfied (F-05.5 — `code` is NULL on 45 of 46
assignment rows, milestone-wide and pre-existing). The operator accepted knowing the cause is fully
legible one surface away, on the log channel, and that the fix is routed to TECH_DEBT **22**.
Verdict: **accept.**

### Accept decision — 43/05

**ACCEPT.** 19 `@executable` green plus the now-ARMED (and extended) `acd-gate-propagation-never-discards`,
architect CONFORMS to ADR-008, task 04's `@manual` two-node soak **run live and passed on all four
scenarios** after the gate found and closed F-05.3, and task 05's `@uat` accepted above.
`STORY.md` moves to `status: done`.

### An observation the run produced for free — the stall class, on real hardware

The cascade above **stalled rather than completing**: the agent authored its last artifact at
`21:44`–`22:04` and the `claude` process was still resident 4h41m later at ~3.6% CPU having written
nothing further, with the assignment row frozen at `running` since `20:24:06`. It was withdrawn by the
control to end it.

This is the failure the repo already knows about ("refines that take hours are usually a STALLED agent,
and aof has no watchdog to recover one") — recorded here because this is a **measured instance with
timestamps**, and because it compounds TECH_DEBT **19**: a stalled agent and a settled-but-unreported
run are indistinguishable on `work run-status`, since both read `running` forever. The evidence
scenario 1 needed was already on disk when the stall began, so it cost this gate nothing — but a
milestone that depended on the cascade's completion would have waited indefinitely with no signal.

---

## 43/06 · The readers migrate — built and validated 2026-08-04, **AWAITING `@manual`**

Lanes in scope: **`@executable`** (tasks 00–04, 43 scenarios) + **`@manual`** (task 05, the
remote-authored read-surface soak). No `@uat`, no UI surface.

### Verification evidence

- **`@executable` suite green — 58/58** across the five suites (`cache-read-seam` 13,
  `-resolve-chokepoint` 12, `-control-leaves` 9, `-boundary-holds` 10, `-doctor-overlay` 14),
  re-run independently by the orchestration; **298 tests / 0 failed** across the 29-suite blast radius
  including 43/05.
- **Twelve mutations**, each reddening the expected lanes: `seam-to-disk` reds 20; `stage1-revert` and
  `stage2-revert-leaves` red *different* task sets, which is what proves the staging claims; the
  worktree-boundary, doctor-overlay, write-door and degrade mutations each red their own.
- `aof work validate` (whole stream) **PASS**.

### The mutation pass found a real defect in the build — the story's best evidence

`worker-reads-cache` came back **green**, which looked like defence in depth and was not: it was green
for the wrong reason, and chasing why exposed two fixture lies (a path-derived workspace id and an
arbitrary path). Corrected to production shape, `aof work find` run **inside a worker's own worktree**
answered with **another node's `in-progress` over the worktree's freshly-authored `done`** — the echo
chamber arriving through the command layer, which is precisely the hazard ADR-005's positive pinning
exists to prevent. Fixed with `isMeshWorktree` in the seam; the scenario now asserts through `invoke`,
because the direct call cannot see it.

### Findings

| id | observed | type | severity | triage | status |
|---|---|---|---|---|---|
| F-06.1 | **Cross-milestone contract collision** — m03/ADR-002 freezes `work list --json` at exactly seven fields; ADR-005 rule 3 wants every row to say which side answered. `acd-work-list-contract` RED | contract | blocker | The stamp is a **face projection**: stripped in the CLI adapter, kept on the command result and the board route. Decisive reason — the stamp is **not one key** (a cache-answered row carries three), so widening the contract would make its key set vary by deployment. ADR-016/G1; PO amended task 02's two clauses | closed |
| F-06.2 | `acd-cache-read-surface-boundary`'s worker-side pin had been **green on the wrong subject since 43/03** — `readWorkspaceContentRecords` moved to `src/work-content-read.mjs` and the grep began matching a different `listItems` in the publish path, which ADR-005 says must NOT migrate | test-quality | blocker | Re-pointed at subjects by the architect; `src/mesh-launcher.mjs:1532` **added**, having been pinned by nothing at all (its rule lived only in a source comment) | closed |
| F-06.3 | **A regression in the daemon's hot loop**: the presence tick opened the projection store once per workspace instead of once per tick (2→10 opens at 5 workspaces; ~27ms→~136ms). Verified GREEN at `6b4ab7f`, so caused by this story | performance | blocker | `sharedProjectionStore` — one open per tick, measured 1 open at every workspace count; `mesh-coordination-launcher` green 10/10 | closed |
| F-06.4 | `freshnessGroup` — declared "disk-only and explicitly so", its **file not even in the diff** — had its gate silently become cache-authoritative, because `buildSnapshot` writes the cache's status into `meta.status`. Measured false finding against an item another machine was actively working | correctness | blocker | Gate reads `item.diskStatus`, which `overlayFor` already stamped on both branches. Rule: *a group's source is a property of the facts it consumes, not of whether its file is in the diff — and a gate is a read* | closed |
| F-06.5 | `work:doctor` bypassed the seam's worktree guard entirely, calling `readCachedWorkFacts` directly — two false findings plus a knock-on inside a worker's own checkout, on **the normal mid-phase state** | correctness | blocker | `isMeshWorktree` exported as a workspace fact; doctor consults it and degrades to `cache: null` | closed |
| F-06.6 | Two byte-identical copies of `reportedElsewhere` in `commands/doc.mjs` and `commands/tasks.mjs` | structure | minor | Collapsed to one exported predicate in `work-read.mjs` | closed |
| F-06.7 | The staging claims (stage 0/1 states) are **not simultaneously satisfiable** with the delivered stage-3 tree | contract | non-blocker | Ruled an **acceptable discharge**: each suite asserts the invariant half behaviourally and the ordering half by mutation, with a re-runnable harness committed at the milestone's `reference/staging-mutations.mjs`. ADR-016 | closed |
| F-06.8 | Two undeclared reds found and repaired: `board-worker-content` (3 exact-key `deepEqual`s the story had enriched) and `item-lock-holder-identity` (three call sites left on `resolveItemExact`'s old signature) — both green at `6b4ab7f`, so both this story's | correctness | major | Amended with `assertFrozenShape` + `assertAnswersFrom`; call sites re-pointed | closed |

### `@manual` task 05 — RUN LIVE 2026-08-05 on the real two-node mesh; **PASS**

Run on the standing test-bed (`C:\Source\umair\aof-test-repo`, workspace `52294b307214c27d`) after
deploying this milestone's HEAD to both nodes.

**The build under test, verified at the source rather than assumed.** Control node
`payload 7002ffb+dirty.20260805T112416`; **both daemons restarted onto it** — `mesh-ui` at
`2026-08-05T12:54:52.491Z` and `mesh-serve` at `12:54:53.051Z`, each printing that build on its own
`daemon-started` line. The WSL worker `umairs-msi-wsl` restarted at `12:55:57.765Z`; its `src/` tree is
**byte-identical to the control's — 213 of 213 `.mjs` files, zero differing** (per-file sha256, both
sides normalised). `claude` answers `MESH_AUTH_OK` in the daemon's own bare environment
(`env -i PATH=/usr/local/bin:/usr/bin:/bin`), so the documented "resolvable but unauthenticated" hazard
is excluded by measurement.

**A verification trap worth carrying.** `aof mesh status` reported the control's presence `buildId` as
the NEW payload *before any restart had happened* — presence re-reads `BUILD_ID.json` at each heartbeat,
so it reflects what is INSTALLED, never what is LOADED. **Presence buildId is not evidence of a restart;
the `daemon-started` log line is.** Anything gated on "the daemons are on the new build" must read the
log line.

| # | scenario | verdict |
|---|---|---|
| 1 | six read surfaces answer with the worker's view | **PASS**, two deviations recorded below |
| 2 | the answer does not revert while the republish tick runs on | **PASS** |
| 3 | doctor reports no false findings against the worker-authored milestone | **PASS** |
| 4 | a fresh never-published workspace still answers from disk | **PASS** |
| 5 | on the worker node, the item reads from the worker's own checkout | **PASS** |

**Scenario 1 — the outsider-observable proof.** The control node's disk for milestone `00` holds
**exactly two files**, `SPEC.md` and `STATE.md` — no `stories/` directory anywhere on this filesystem.
Against that, on the control node:

| surface | answer | names the answering side? |
|---|---|---|
| `work find 00 --json` | the worker's row | `answeredFrom: cache`, `reportedBy: umairs-msi-wsl` |
| `work list --json` | **three worker-authored stories** (`00/00`, `00/01`, `00/02`), each `dir: null` | **no — by contract, see F-06.9** |
| `work next --json` | `00/00` ready | `answeredFrom: cache`, `reportedBy: umairs-msi-wsl` |
| `work doc 00/00 STORY --json` | the worker's 3,670-byte STORY.md body | `fromWorker: true`, `answeredFrom: cache`, `reportedBy: umairs-msi-wsl` |
| `work run-status 00 --json` | the worker's run row | `fromWorker: true`, `answeredFrom: cache`, `reportedBy: umairs-msi-wsl` |
| `work tasks 00/01 --json` | the worker's parsed `00_shout-flag.feature` | `fromWorker: true`, `reportedBy: umairs-msi-wsl` |

`work list` returning three stories whose `dir` is `null`, on a machine whose disk has no `stories/`
directory at all, is the exact transition this story exists to make: at `43/03`'s live run the same
command returned **only ref `00`**, and VERIFICATION recorded that as the gap `43/06` would close. It is
closed, observably, on two machines.

**Scenario 2 — permanence, measured against a LIVE adversary rather than a quiet one.** The naive form of
this check is vacuous: an answer that does not change proves nothing unless something is actively trying
to change it. So the control's republish tick was proven to be *running during the window*, by watching a
**control-authored** population move while the worker-authored one stood still:

- control-authored workspace `9db1fd84f5895e38` — `newest = 13:06:59.432Z`, sampled at `13:07:03.275Z`:
  **the tick is writing, seconds before the sample**;
- worker-authored test-bed rows `00/00`, `00/01`, `00/02` — frozen at `2026-08-03T00:56:05.435Z`,
  **two days old and unmoved**, still `reportedBy: umairs-msi-wsl`.

Across a 7.4-minute window (`13:04:04Z` → `13:11:27Z`) with that tick running throughout,
`work find 00 --json`, `work list --json` and `work doc 00 SPEC --json` were **byte-identical** — three
diffs, zero bytes changed. At no point did the milestone read back as its pre-run scaffold, and the
reporting node named on the row was the WORKER at both ends.

**Scenario 3 — `aof work doctor --json` on the control node reports ZERO findings** (`errors: 0`,
`warnings: 0`, `findings: []`) against a milestone whose disk holds a bare scaffold while its cache holds
three stories. This is the operator-visible form of F-06.4/F-06.5: before those fixes, precisely this
shape produced false findings whose subject was another machine's live work.

**Scenario 4 — the negative outsider check.** A fresh workspace that has never published
(`.aof/aof.config.json` with no `mesh` block, one milestone on disk): `work list`, `work find`,
`work next` and `work doc` each **exit 0**, and `find`/`next`/`doc` each state `"answeredFrom": "disk"`
explicitly. No command failed because the cache held nothing for it.

**Scenario 5 — the boundary, and the sharpest single datum in this lane.** Run INSIDE the worker's own
worktree, `aof work list --json` returns the worktree's own state with real `dir` paths into it — and
milestone `00` reads **`status: in-progress` there while the control's cache says `not-started`**. A
worker reading the control's copy would have said `not-started`. It says `in-progress`, which is its own
disk's truth and a state the control has never received. This is the same hazard F-06.2's re-pointed pin
and the `isMeshWorktree` guard exist to prevent, observed now on real hardware rather than in a fixture.

### Two deviations from scenario 1 as written, recorded rather than papered over

1. **The worker's worktree was never deleted, so "the run settles and the worker deletes its worktree"
   was not reproduced as written.** The standing fixture's run (`428fd15a`, 2026-08-03) had its agent
   phase *succeed* — the worker's own run record reads `state: done, outcome: done` at `00:56:11.602Z` —
   and the control marked the assignment `failed` **244 ms later**, at `00:56:11.846Z`, retaining the
   worktree. The cause is **TECH_DEBT item 14** (the clone-credential provider is fleet-global, so a
   GitHub-configured control cannot serve this `file://` test-bed), not anything this milestone owns:
   `git push --dry-run origin aof/mesh/00` from the worker exits **0** and would create the branch, so
   the push path is not structurally blocked — only the mesh's credential path is.
   **Why the scenario's PROPERTY still holds.** Worktree deletion is the scenario's *mechanism* for
   "the worker will never tick again"; the *property* is what scenario 2 asserts. That property was met
   independently and is measured above: the worker is **not** republishing this workspace (its last
   stamp on `00` is `11:54:50.794Z`, i.e. **before** its own `12:55:57Z` restart, and it has not moved
   since), while the control's tick demonstrably runs on. The disease — stale republished over live truth
   on a timer — had every condition it needs and did not occur.
2. **"`next` treats the worker's completed work as complete" could not be evaluated**, because that run
   authored artifacts without advancing statuses: all four rows are still `not-started`, so there is no
   completed work for `next` to mishandle. `next` correctly offers `00/00`. Recorded as **not reached**,
   not as passed.

### Findings — `@manual` task 05

| id | observed | type | severity | triage | status |
|---|---|---|---|---|---|
| F-06.9 | Scenario 1's closing Then — *"every one of those answers says which side answered it"* — is **unsatisfiable for `work list --json`**, which carries exactly seven keys and no provenance. Measured: 5 of 6 surfaces carry `answeredFrom`; `list` carries none | contract | non-blocker | **Not a defect — this is ADR-016/G1 working as ruled.** F-06.1 already decided the stamp is a *face projection*: stripped in the CLI adapter, kept on the command result and the board route, because a cache-answered row carries three keys and widening `acd-work-list-contract` would make its key set vary by deployment. The PO amended **task 02**'s two clauses then and missed the identical clause in **task 05**; amended now, same reason, recorded inline | closed |
| F-06.10 | **A run row can be stuck `running` on the control while the worker's own record says `done`.** Measured three-way divergence for run `20260803T001759834Z-0000`: worker disk `done`/outcome `done`; control `global_assignments` `failed`; control cached run row `running`. `work run-status` therefore shows an operator a run that has been "running" for two days | correctness | major | **Out of this story's scope** — 43/06 migrates READERS; the run row's terminal state is written by the assignment/run lifecycle (m26/m42 territory), and the divergence originates in the push failure of TECH_DEBT 14. Routed to TECH_DEBT as a new item rather than fixed here. Worth carrying because the *cache* faithfully reports what it was told: the defect is upstream of the read surface this story owns | routed |

### Accept decision — 43/06

**ACCEPT.** Every `@executable` scenario is green (58/58; 298 across the blast radius), the structural
review says **CONFORMS to ADR-005** after seven must-fixes, `validate` is PASS, and task 05's `@manual`
remote-authored soak has now **run live on the real two-node mesh and passed** — five scenarios outright,
with scenario 1's six read surfaces all answering from the worker's view on a control node whose disk
holds no `stories/` directory. The two deviations are recorded above with their causes; neither is a
defect in this story, and the property scenario 1's unreproduced precondition exists to create was proven
independently under a demonstrably live republish tick. `STORY.md` moves to `status: done`.
