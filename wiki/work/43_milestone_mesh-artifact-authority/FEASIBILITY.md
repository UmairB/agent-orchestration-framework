---
doc: feasibility
---
<!--
  Milestone FEASIBILITY.md — answers ONE question: can the contract be BUILT against the code as it
  actually exists, and what is missing that no story owns?
  Owner: developer (the third amigo). Written at refine, after the PO's ACs, the architect's ADRs and
  the six QA amigos' 42 task .feature files / 277 scenarios were all on the page.
  Does NOT change the contract — it names what the contract costs, what it assumes wrongly, and what
  nobody has been made responsible for. Rulings belong in ARCHITECTURE.md.
-->
# 43 · Mesh artifact authority — Feasibility

> **Method.** Every claim below was measured read-only against this checkout (branch
> `fix/worker-completion-and-milestone-cascade`, Mac worker `umairs-mac-mini`) on 2026-08-01: source
> read at the cited line, `aof graph impact` for coupling (graph built `2026-08-01T13:51:34Z`, 1960
> nodes / 5754 edges), `wc -l` for size, `PRAGMA`-equivalent source reads for schema. Nothing was
> executed against the real `~/.aof`; no `src/`, test or `.feature` file was modified. The eight m43
> arch-tests were taken as green on the operator's word and not re-run.
>
> **ADR-010 is being authored concurrently.** Where an outcome turns on one of QA's open questions it
> is written as "depends on ADR-010's ruling on X" with both branches costed.

## Verdicts

| Story | Verdict | The one thing that decides it |
|---|---|---|
| **01 item-lock** | **buildable-with-caveats** | The control-side-mutation door has no home. `insert-shared.mjs` imports no mesh module at all (`:23-35`). `transitionStreamReindexed` is the exact structural analogue of `transitionRunStart` and nobody named it. |
| **02 cache-authority** | **BLOCKED** (two hard blocks, both cheap to clear) | (a) author retraction reads `work_items.node_id`, which does not exist until 43/04's schema v8 — §3; (b) the reclassification contradicts a currently-green m42 fitness function, twice — §6.1. |
| **03 artifact-sync-on-write** | **buildable** | Every seam it needs exists and is injectable. Its drain lands in `mesh-launcher.mjs`, not the god-file (§5). |
| **04 staleness-and-resync** | **BLOCKED** | Two unowned builds: a board-side headless mount harness (§1.1) and the entire Resync control-side route/verb/frame (§1.2). Its 79 scenarios are the largest single block in the milestone and ~55 of them are `@ui`. |
| **05 gate-propagation** | **buildable** | ADR-008's `mesh-worktree.mjs` placement is achievable exactly as written; the fixture family already exists. One export is mandatory, not optional (§1.3). |
| **06 cache-read-surface** | **buildable-with-caveats** | The chokepoint edit is real and small. The `answeredFrom`-on-`work list --json` assertions collide with a green frozen-contract arch test (§6.2), and the reach-through has no decided answer. |

---

## §1 — What must be built, and no story owns it (ranked by cost × blast radius)

### 1.1 A board-side headless mount harness — REAL, and the milestone's single largest unowned build

QA's assumption is correct. `test/support/fleet-app-harness.mjs` (432 lines) is **hard-bound to
`Fleet.tsx`**: `const FLEET_TSX = path.join(repoRoot, "ui", "src", "fleet", "Fleet.tsx")` is the sole
esbuild entry point, the export is `withFleetApp`, and its four consumers
(`test/fleet-assign-{row-geometry,affordance,acknowledgment}.test.mjs`,
`test/mesh-ui-assign-item-workspace.test.mjs`) are all fleet lanes. There is **no board sibling and no
test in the repo that mounts `Board.tsx`, `DetailPanel.tsx`, `Overview.tsx` or `BoardLanes.tsx`.**

Story 04's tasks 03–08 (~55 `@executable @ui` scenarios) every one open with *"the REAL production
board mounted headlessly against a REAL board face … on a controllable clock"*. That harness does not
exist.

What it costs, measured against what the fleet harness already solved:

- **Reusable as-is** — the virtual `react`/`react/jsx-runtime` shim delegating to
  `globalThis.__AOF_MINI_REACT__` (`:31-53`), the recording `fetch` instrument with same-origin
  rewriting, request log, and the `holds` mechanism that makes an in-flight read deterministic
  (`:143-197`), `flush()`/`renderOnly()` (`:213-240`), the controllable clock. That is ~300 of the 432
  lines and is entirely surface-agnostic. The honest move is to **extract it into a shared
  `test/support/ui-app-harness.mjs`** and reduce both `fleet-app-harness.mjs` and a new
  `board-app-harness.mjs` to entry point + stub table + accessors.
- **Net new** — four extra esbuild stubs the fleet never needed, all of them in `Board.tsx`'s subtree:
  `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-web-links` + its CSS (reachable only through
  `TerminalDock.tsx:18-21`, so one `VIRTUAL_TERMINAL_DOCK = "export const TerminalDock = () => null"`
  stub kills all four, exactly as `VIRTUAL_TERMINAL_VIEW` does for the fleet); `lucide-react`
  (`ActionsStrip.tsx:7`); and `@/lib/utils`'s `cn` — which is reachable **only** through
  `TerminalDock.tsx:22`, so stubbing the dock removes every `@/` alias from the board bundle and no
  esbuild path-alias plugin is needed. `marked` (`Markdown.tsx:17`) is pure JS and bundles unchanged.
- **The face already exists.** `serveSetupUi(null, { projectDir, port: 0 })` is the established
  real-board-face idiom (`test/board-face-contract.test.mjs:24`, `test/board-api.test.mjs`,
  `test/arch/acd-board-write-isolation.test.mjs:21`). No new server is needed.
- **`mini-react.mjs` is sufficient.** Board/DetailPanel/BoardLanes use only
  `useState/useEffect/useCallback/useMemo/useRef`; Overview is pure. All are in the shim.
- **Accessors are the real per-surface work** — the fleet harness's value is `cards()`, `card(ref)`,
  `statusLoads()` and the affordance driver (`:270-410`). A board equivalent needs lane-card,
  overview-card, detail-header-cluster, provenance-line, doc-region and legend readers.

**Estimate: ~1.5–2.5 days.** Refactor 432 lines into a shared core (half a day, and it touches four
green fleet suites — a real regression surface), ~200–300 new lines of board entry + stubs +
accessors, plus the fixture planting a stale/fresh/unknown/blocked-and-stale item set.

**Recommendation:** make it an explicit first task of story 04 (`tasks/03` currently absorbs it as
"this task's real work"), or a wave-2 prelude. Do not let it be discovered by the developer who picks
up task 03.

### 1.2 The Resync control-side route/verb — genuinely absent, but there is an exact precedent

Confirmed: **nothing today carries a node→node "push me your state" request.** The down-frame kinds
are `directive`, `clone-credential`, `clone-url`, `write-credential` and `recovery-push`
(`control-stream-server.mjs:795-806` for the up-side dispatch table); `applyStreamFrame`'s up-kinds are
`snapshot`, `delta`, worktree-content, log-entries, `presence`, `assignment-status`, the three
`*-request` pulls, effect-step and `recovery-push-result`. None of them asks a node to re-report.

**But `src/mesh-recovery-push.mjs` is the shape, almost exactly.** Its own header (`:12-31`) documents
the five-step pattern: the CLI writes a `requested` row into a lazily-created additive side table
(`global_recovery_pushes`, classified `fact`, created with `CREATE TABLE IF NOT EXISTS` inside the
feature module so **no schema-version bump is needed**); the control daemon's tick
(`runRecoveryPushDispatchTick`, wired at `mesh-launcher.mjs:1355`) drains `requested` rows whose target
worker is a **currently-connected admitted peer** and dispatches a down-frame, marking the row
`dispatched`; the worker acts and replies with a result up-frame; `applyRecoveryPushResultFrame` flips
the row `pushed`/`failed`; the CLI polls to a terminal state.

Those four states map 1:1 onto DESIGN's Resync table:

| DESIGN state | recovery-push analogue |
|---|---|
| in-flight | row `requested`, not yet drained |
| accepted ("the request reached the owner") | row `dispatched` |
| landed | a fresher `syncedAt` arrives (the row's terminal `pushed` is the *call*, not the data — which is exactly DESIGN's rule 1) |
| owner unreachable | the dispatch tick's "target is not a currently-connected admitted peer" branch |
| refused | terminal `failed` with a code |
| no answer | the watch window elapsing with no fresher `syncedAt` — the one leg with no precedent |

So the build is: one new frame-kind pair, one lazily-created side table, one dispatch-tick branch, one
worker-side handler that forces an immediate `pushActiveWorktreeState`/content re-read, one CLI verb
(`aof mesh resync <ref>`), and one `POST /api/work/resync` on `board-ui.mjs` (which already carries
four POST routes at `:155-168`, so the shape is established). **Estimate ~2 days**, and it hangs off
`mesh-recovery-push.mjs` as a sibling rather than a new subsystem.

**Two things that must be decided, not discovered:**

- **Who owns it.** Story 04's Notes say it "is the only story that touches `ui/` — which is what keeps
  it independent of its wave-2 siblings". That is only true if the Resync `src/` half is *not* in it.
  If it is, story 04 stops being a UI story and grows a mesh-transport half. Either 04 absorbs it
  (and stops being wave-2-parallel-safe against 03, which also edits `mesh-launcher.mjs`), or it
  becomes a seventh story / a wave-2 prelude.
- **A stale row's "owning node" is `work_items.node_id`** — which does not exist until 43/04's own
  schema v8. Self-consistent within story 04, but it means Resync cannot precede the migration.

### 1.3 `advanceBranchToBase` must be **exported** from `mesh-worktree.mjs` — confirmed, and mandatory

QA's feasibility note is **correct and now measured**. `reuseWorktreeOnBranch`
(`mesh-worktree.mjs:261-300`) always materialises a **fresh** tree: it best-effort-fetches the branch,
removes every worktree holding `refs/heads/<branch>` with `worktree remove --force`, runs
`worktree prune`, then `git worktree add <path> <branch>` — and git refuses `worktree add` into a
non-empty path. The advance runs immediately after that call (`mesh-worker-execution.mjs:2388-2390`).
**A dirty tree is therefore unreachable at dispatch altitude, always.**

Consequence: `assignment-gate-propagation-dirty-worktree` is a defensive guard with no dispatch-level
producer. Story 05's task 01 has **three dirty rows** in its Scenario Outline whose `When` step reads
*"the worker dispatches the continuing assignment"* — those three rows cannot be made green at that
altitude. The header already concedes this and specifies the seam-altitude route; the steps do not.
The export is not a convenience, it is the only way three contracted rows become exercisable.

`mesh-worktree.mjs` is a **375-line module whose only imports are `node:path`, `node:child_process`
and `./degrade.mjs`** (`:43-46`) — zero mesh modules. It already owns `resolveExec`, `gitError`,
`ensureCommitAvailable` and `localBranchExists`. ADR-008's placement requirement is achievable exactly
as written, and the export costs nothing structurally.

### 1.4 The 1s cosmetic tick is not where the badge needs it — confirmed

The tick exists in exactly two places and **neither is at item-surface level**:

- `ui/src/board/DetailPanel.tsx:588-595` — `setInterval(() => setNow(Date.now()), 1000)` inside the
  `RunsSection` component's effect, alongside the `RUNS_POLL_MS` poll. Its `now` is local state of the
  runs tab. The **detail-panel header** (where DESIGN puts the badge and the provenance line) is a
  different component and has no clock.
- `ui/src/fleet/Fleet.tsx:73` (`const CLOCK_MS = 1000`) and `:144-147` — a Fleet-root `nowMs`, which
  does cover the fleet milestone card.

So the board needs a **new clock at `Board.tsx` root**, threaded to `BoardLanes`, `Overview` and the
`DetailPanel` header. That is the mechanism story 04's AC 8 stands on ("the badge appears within one
second of the crossing, with no network") and QA is right that it is the task's real work. Small
(~20 lines) but genuinely new, and it re-renders the whole board once a second — worth a deliberate
`useMemo` boundary so a 200-item overview does not re-derive lanes every tick.

### 1.5 Two more nobody named

- **`wholesaleDelete` is module-private** (`global-work-store.mjs:51`, `function wholesaleDelete`, no
  `export`), and after story 02's cut it will have **no remaining caller for `work_items`**. Story 02's
  task 00 Scenario Outline drives four rows through *"a wholesale delete of the `<table>` table is
  attempted"* — there is no channel to attempt it. It must be exported (or given a named
  test door). Trivial, but unnamed.
- **`applyDeltaFrame` does not receive the authenticated node id.** Its signature is
  `applyDeltaFrame(store, frame, { now })` (`control-stream-server.mjs:177`) — it destructures `now`
  only, while `applyWorktreeContentFrame(store, frame, options)` reads `options.nodeId` for exactly
  the stamping rule story 02's AC2 wants to copy. `applyStreamFrame` already passes the full `options`
  through (`:795-806`), so the fix is one destructure. Cheap, but AC2 reads as if it were already
  plumbed.

---

## §2 — Test-harness reality, per story

| Story | Existing harness it builds on | What must be written |
|---|---|---|
| **01** | `test/support/mesh-assign-fixture.mjs` (control-side store + assign), `test/support/cli-spawn.mjs` (every Then is a `--json` envelope + exit status), the `AOF_GLOBAL_HOME` temp-store idiom. `test/support/work-insert-fixture.mjs` for the insert door's folder-set litmus. | Nothing structural. One helper that seeds an ACTIVE `global_assignments` row for an arbitrary `item_ref`/state — `mesh-assign-fixture.mjs` plus `insertAssignment` covers it. **Weight: light.** |
| **02** | A real SQLite store over `AOF_GLOBAL_HOME`, driven through `publishWorkspaceSnapshot` / `applyStreamFrame` directly — the idiom `test/mesh-assignment-reclaim.test.mjs` already uses. `readWorkspaceItems` is the exported read channel every Then names. | A **two-writer driver**: publish-as-control, then apply a frame *as if* it arrived on worker-a's authenticated connection. `applyStreamFrame(store, frame, { nodeId })` is already the shape; nothing needs a real socket. **Weight: light-to-moderate** (the interleaving matrix in task 03 needs a sequencer, ~60 lines). |
| **03** | For the hook: plain `spawnSync(node, [script, queuePath])` with JSON on stdin — no harness at all, and the in-repo precedent `.claude/hooks/aof/guard-test-isolation.mjs` proves the stdin idiom. For the merge: temp-dir byte-copy fixtures + `serveSetupUi`-free `work init/update` plan envelopes. | The **drain-side lane needs a worker-daemon stream fixture** — `mesh-launcher.mjs`'s `pushActiveWorktreeState` is a closure inside `startLauncher`, not an exported function, so the drain is only reachable by standing up a launcher with an injected `streamSyncTicker` (`mesh-launcher.mjs:1381`) and a fake `streamClient`. That injection point exists and is the intended door. **Weight: moderate** — a `withWorkerStreamTickFixture` (~120 lines) that most of tasks 01/02 then ride. |
| **04** | Data layer (tasks 00–02): the **backcompat-migrate idiom** QA cites — `test/backcompat-migrate-doctor.test.mjs` — writing a store at the old version and re-opening. Real and exactly right. UI layer: **nothing.** | §1.1's board harness, plus a board-face fixture planting the four freshness states. **Weight: heavy** — the largest single harness investment in the milestone. |
| **05** | **The strongest position of any story.** `test/support/mesh-worker-exec-fixture.mjs` (real `git init` repo + resolvable item + hermetic `AOF_GLOBAL_HOME` + `createStatusRecorder`, which records every `sendAssignmentStatus` call in order — exactly the channel task 01's "settles `failed` with code" Thens need); `test/support/mesh-worker-push-fixture.mjs` (adds a **real local bare origin**, which task 03's push row requires verbatim); `createRecordingGitExec` (a **real** `git` spawn wrapped with a call-order recorder — which is precisely what task 00's *"the recorded git call order shows the advance strictly after the `worktree add` and strictly before the runtime spawn"* asks for, and it already exists). | Only a **topology builder**: C1 → W1,W2 on the item branch, C2 on the control line, plus the conflict pair. ~50 lines on top of `withMeshWorkerPushFixture`. **Weight: light.** |
| **06** | `cli-spawn.mjs` for every `--json` Then; the `AOF_GLOBAL_HOME` store; `setDegradeSinkForTest` (`degrade.mjs:19`) — mandatory, because `reportDegrade` throttles per code for 5 s process-globally, so a suite asserting "the sink gained one entry" would see zero on a second test without the reset. | A **cache-seeding fixture** that plants `work_items` rows attributed to a foreign node without the control's tick clobbering them — which only works after 43/02. That is why wave 3 is right. **Weight: moderate.** Doctor's lanes (task 04) also need an injected `now`, which `doctorWork` already supports. |

---

## §3 — The wave-1 sequencing defect (independently verified)

**The column really is absent.** `work_items`' DDL (`global-work-store.mjs:173-183`) is exactly
`workspace_id, ref, type, slug, status, title, parent, source_path`, `PRIMARY KEY (workspace_id, ref)`
— no `node_id`, no `updated_at`. `GLOBAL_WORK_SCHEMA_VERSION = 7` (`:11`). The sibling tables
`work_item_docs` / `work_item_runs` do carry both (`:272-273`, `:281-282`), written by
`upsertWorkItemContent` (`:652-668`).

**So ADR-004's author-retraction predicate — `node_id = <this node> AND ref NOT IN <that set>` — cannot
be written in wave 1.** It is not merely unobservable (QA's careful column-free litmus channels handle
that); the WHERE clause has no column. Story 02's task 02 is 10 Examples rows of retraction outcomes,
its task 01 is the stamping seam, and its task 04's contention matrix keys on `row_author`. Roughly
half of story 02's 46 scenarios are unimplementable until schema v8 lands.

**Cheapest correct resolution — a wave-0 prelude of exactly one task.**

Promote **`04/00_schema-v8-provenance-columns`** ahead of story 02 as a wave-0 predecessor. It is the
right unit because:

- Its Background is *"a global work store written at schema version 7"* and nothing else. **Nine of its
  ten Then-clauses have zero dependency on 43/02's seam** — columns land, content tables untouched,
  idempotence across four starting states, NULLs not backfilled, migration marker recorded once,
  forward guard intact.
- The **one** clause that does need the seam ("a row upserted AFTER the migration reads back with the
  writer's node id") is a single `And` step, and it is satisfied the moment 02's seam lands in the same
  wave-1 window.
- The implementation is **~8 lines** — the `clone_url` / `session_id` / `code` guarded-`ALTER`
  precedent at `global-work-store.mjs:305-345` is copy-shaped, plus the version bump. This is the
  cheapest possible unit of unblocking. (`readWorkspaceItems`, `:569-587`, is the read accessor the
  mapper then widens; it returns the seven-field row shape with no provenance today.)
- It preserves ADR-006/ADR-009's ownership intent: story 04 still *owns* the columns, the mapper, the
  wire names, the predicate and the envelope. Only its **wave** changes, not its scope, and no
  scenario is rewritten or reassigned.

Net effect on the critical path: wave 1 becomes `04/00 → 02` in sequence, still parallel with `01`.
Cost roughly half a day, and it removes an outright impossibility.

**Fallback if the architect prefers no re-wave:** story 02 lands the two columns itself and story 04's
task 00 becomes a regression proof (its scenarios still read true — they say "opening a v7 store", and
they still hold). Cost is the same lines of code; the price is that ADR-009's "staleness **owns** the
columns rather than inheriting them" stops being true, and the argument it was made for (a story
should own its upstream data need) is quietly reversed. **Prefer the prelude.**

---

## §4 — Cross-story file collisions (ADR-009's disjointness claim, tested)

ADR-009 asserts *"wave 1 (parallel, no shared file)"* and that `artifact-sync-on-write` *"shares only
`work-artifacts.mjs` (a new leaf) with the cache work"*. Both are **false as stated**, though only one
of the collisions is dangerous.

| File | Stories | Waves | Verdict |
|---|---|---|---|
| **`src/global-work-store.mjs`** (823 lines, imported by 16 — graph) | **02** (publish path, upsert seam, retraction), **03** (`WORK_ITEM_DOC_FILES` derived + re-exported per ADR-007; `readWorkspaceContentRecords:588+` widened to the manifest), **04** (schema v8 `migrateSchema`, the row mapper, `readWorkspaceItems`) | 1, 2, 2 | **Benign co-edit, but 03 ∥ 04 is a real merge hazard.** The regions are disjoint (`:17-22` and `:588-640` vs `:305-345` and `:569-587`) so there is no semantic conflict — but two wave-2 siblings editing the repo's central store module concurrently will conflict textually and will each rebase onto the other's version bump. **Recommend: 04's schema half lands in the wave-0 prelude (§3), which removes the overlap entirely.** ADR-009's "shares only a new leaf" claim should be corrected. |
| **`src/mesh-launcher.mjs`** (1585 lines, imports 30) | **02** (the control publish tick's held-skip counter surfaces through `capturePropagation`, `:730-736`), **03** (the drain on `pushActiveWorktreeState`, `:1448`), **04** (the Resync dispatch tick, if it lands here as `runRecoveryPushDispatchTick` does at `:1352`), **06** (the injected `listItemsFn` default, `:493`) | 1, 2, 2, 3 | **Wave-2 collision if 04 absorbs Resync's `src/` half** (§1.2). 03 and 04 would then both edit the launcher's tick region concurrently. Otherwise sequential and benign. |
| **`src/commands/next.mjs`** | **01** (skip-and-report envelope), **06** (stage-2 migration off `nextWork`) | 1, 3 | Benign — sequential, and both are additive. But note both stories assert on `next`'s envelope simultaneously at the end: 01's `skipped[]` must survive 06's re-source. |
| **`src/commands/run-start.mjs`**, **`src/mesh-assignment.mjs`** | **01** (lock doors), **06** (stage-2 leaves at `run-start:119`, `mesh-assignment:111,177`) | 1, 3 | Benign, sequential. |
| **`src/board-mesh-execution.mjs`** | **01** (`executionScopeRef` moves out, re-exported from `assignment-record.mjs`), **04** (nothing — the badge is `ui/` only) | 1 | Single-owner. But note ADR-009's story-01 file list omits it; ADR-003 requires it. |
| **`ui/src/**`** | **04** only — verified by grep across all 42 `.feature` files: no story outside `04_story_*` names a `ui/src` path. | 2 | Genuinely single-owner. |
| **`src/work.mjs`** (the 37-importer god-node) | nobody edits it; 06 must positively *not*. | — | Clean. |

**The one genuine wave-1 coupling ADR-009 asserts away.** Story 01's task 02 contracts a control-side
mutation refusal (`aof work insert-story … --under 42`) and its own header concedes *"where the raise
happens for a mutation verb is a BUILD decision"*, while **ADR-004 routes it "into the same guard" at
the shared upsert seam — which is story 02's file.** If the raise lands there, the two wave-1 stories
share `global-work-store.mjs`, the milestone's highest-risk module, and wave 1 stops being parallel.

**There is a third home, and it is the architecturally correct one.**
`src/effects/stream-transitions.mjs`'s `transitionStreamReindexed(workspace, edge, opts)` is the
**single seam every insert routes through** — exactly two call sites, both in `insert-shared.mjs`
(`:274`, `:599`) — it already takes `workspace`, and it **already imports `resolveWorkspaceId`**
(`stream-transitions.mjs:22`). It is the fourth transition seam beside `run-transitions.mjs`,
`assignment-transitions.mjs` and `doc-transitions.mjs`, and its own header states the same discipline
ADR-003 invokes for the mint door. Putting the control-side-mutation guard **inside
`transitionStreamReindexed`, in front of the fact** is ADR-003's rule applied verbatim, lands in a file
**no other story touches**, and **preserves wave-1 parallelism exactly as ADR-009 claims**.

This is a ruling for ADR-010. Cost if it lands in the seam: ~30 lines, wave 1 parallel. Cost if it
lands in the upsert seam: wave 1 serialises (01 after 02), adding the whole of story 02 to the critical
path.

---

## §5 — The largest-file risk (and one correction that improves it)

`src/mesh-worker-execution.mjs` is **3,174 lines** — confirmed, the largest file in `src/`, imported by
3 and importing 17.

**ADR-008's requirement is achievable exactly as written.** `mesh-worktree.mjs` is 375 lines with three
imports, none of them mesh (`:43-46`); it already owns every git verb on this path
(`ensureCommitAvailable:143`, `localBranchExists:169`, `reuseWorktreeOnBranch:261`, plus the private
`resolveExec`/`gitError`). An exported `advanceBranchToBase(worktreePath, commit, options)` sits there
naturally. Story 05 then adds to the god-file: **one call between `:2390` and the `worker-worktree-base`
log at `:2396`, one `onLog` block beside it, and one refusal branch mirroring the
`assignment-base-commit-unavailable` block at `:2376-2386`.** Call it **25–40 lines**. The requirement
holds.

**ADR-009's health finding mis-attributes the second story, and the correction is good news.** It says
*"TWO of this milestone's stories land in it (`artifact-sync-on-write`'s drain wiring,
`gate-propagation`'s reuse-door advance)"*. Measured: **`pushActiveWorktreeState` is defined at
`mesh-launcher.mjs:1448`**, inside `startLauncher`'s closure, and ADR-001 itself cites it there. Story
03's drain lands in **`mesh-launcher.mjs`, not `mesh-worker-execution.mjs`**. Only **one** story of the
six lands in the god-file, and it lands ~30 lines.

**The file that actually grows.** `mesh-launcher.mjs` (1,585 lines, imports 30) takes story 03's drain,
story 02's tick-skip surfacing, story 06's default swap, and story 04's Resync dispatch tick if it
lands there — **four of six stories**. That is the concentration worth flagging, and it is a
*different* file from the one TECH_DEBT item 10 names. Same disease, wrong patient.

---

## §6 — Wrong, not merely hard

### 6.1 Story 02's reclassification contradicts a currently-green m42 fitness function — twice

`test/arch/acd-fact-projection-split.test.mjs` asserts, live and green today:

```
:139  assert.ok(/wholesaleDelete\(db, "work_items"/.test(code), "the publisher's work_items sweep routes through the guard");
:148  assert.equal(tableClass("work_items"), "projection");
```

Story 02's AC1 makes both false by construction. And a third: `:137-139`

```
const rawSweeps = [...code.matchAll(/DELETE FROM (\w+) WHERE workspace_id = \?/g)].map((m) => m[1]);
assert.deepEqual(rawSweeps, [], "no raw workspace-sweep DELETE outside the guard");
```

is **unanchored**, so ADR-004's retraction statement
`DELETE FROM work_items WHERE workspace_id = ? AND node_id = ? AND ref NOT IN (…)` matches it and
lands `"work_items"` in `rawSweeps`. Story 02 trips that assertion too.

ADR-004's Consequences names only `acd-work-items-single-writer`. **Amending `acd-fact-projection-split`
is a required, unowned part of story 02** — three assertions, maybe fifteen minutes, but it will fail
CI at the exact moment the cut lands with no named owner. Name it in ADR-010 or in story 02's AC1.

### 6.2 `answeredFrom` / `syncedAt` on `aof work list --json` is forbidden by a green arch test

`test/arch/acd-work-list-contract.test.mjs` spawns the real CLI and asserts, per element:

```
:25   const CONTRACT_FIELDS = ["ref", "type", "slug", "status", "title", "parent", "dir"];
:122  assert.deepEqual(keys, [...CONTRACT_FIELDS].sort(), "…has exactly the seven contract fields");
```

That is **exact key-set equality on the emitted JSON**, not a subset check. So:

- **Story 04, task 01, last scenario** — *"the provenance fields appear only as additive OPTIONAL keys —
  no existing key is renamed, retyped or removed"* — is **wrong as written**. Additive optional keys on
  the CLI face are not permitted at all.
- **Story 06, task 02** — *"When I run `aof work list --json` … And every listed row reports
  `answeredFrom` \"disk\""*, and again in the disk-known-ref scenario — is **wrong as written** for the
  same reason. (Story 06's task 00 is *correct*: at stage 0 it asserts no such field appears.)

The board's element shape has legitimately grown `execution?` / `fromWorker?` / `reportedBy?`
(`board-worker-stream.mjs:140,159-161`) precisely because those ride the **`mesh: true` opt-in** path
(`commands/list.mjs:22-30`) which the CLI never takes (`board-ui.mjs:53` passes `{ mesh: true }`; the
CLI does not). **The cheap, precedent-following fix is to keep provenance on the mesh/board path only**
and rewrite those Thens to read the board response or a `--provenance` flag. The alternative — amending
ADR-002's frozen contract and its fitness function — is a knowing supersession of an m03 decision and
needs an ADR-010 clause, not a scenario edit. **Depends on ADR-010's ruling on where provenance rides
the read surface; the two branches differ by "rewrite four Then-clauses" versus "supersede ADR-002".**

### 6.3 `stalenessSeconds` has nowhere to ride on the board list response

`board-ui.mjs:44-56` does `sendJson(response, 200, rows)` — a **bare array**. There is no envelope.
Story 04's task 01 requires *"the response carries `stalenessSeconds` = N, once for the whole
response"*. Options, all real: an object envelope (breaks `ui/src/board/api.ts`'s `WorkItem[]` and
`test/board-face-contract.test.mjs` / `test/board-api.test.mjs`, though **not** the CLI arch test); a
response header; or a separate `GET /api/work/freshness` the board fetches once. QA correctly left the
carrier open and pinned only the two observables. **Depends on ADR-010's ruling.** Cost is materially
different: header ≈ 20 lines; envelope ≈ a day plus two green board suites to re-baseline.

### 6.4 ADR-003's "admitted by identity, never by exemption" is vacuous cross-machine

`global_assignments` rows are written **only on the control node** — `insertAssignment` has one caller
(`mesh-assignment.mjs:147`) and `updateAssignmentState` reaches it through
`effects/assignment-transitions.mjs`, driven by `control-stream-server.mjs`'s frame handlers. The
worker's own store holds none: **`mesh-worker-execution.mjs` does not import `assignment-record.mjs`
at all** (it opens the global store only for repo/clone-url lookups, `:290`, `:662`).

So on a real second machine, the guard inside `transitionRunStart` at
`mesh-worker-execution.mjs:2458,2954` finds **no assignment row to consult** and admits by absence.
That is operationally correct (the worker is never blocked) but it is *exemption by empty store*, not
admission by identity — the precise distinction ADR-003 says it is engineering out. It is load-bearing
**only** in the self-assignment case (control node targets itself), where the row is local.

Practical consequence for the contract: story 01 task 03's matrix — especially row 3, *"the holder's own
id after it went terminal ⇒ refused"* — is exercisable **only in-process**, where the assignment row and
the mint share one store. It is green in a fixture and untestable on the deployment it describes. Task
06's cross-machine soak will pass trivially ("the worker is never locked out") without proving anything
about identity. Worth one sentence in ADR-010 so the claim is not later read as a cross-machine
guarantee.

### 6.5 Story 01's guard has no workspace identity at three of five mint sites

Confirmed at HEAD: `transitionRunStart` is called **without `opts.workspace`** at
`run-retry.mjs:65-69` and at both worker sites (`mesh-worker-execution.mjs:2458-2462`, `:2954-2958`) —
deliberately, and each carries a source comment saying so, because a null `workspaceRoot` is what makes
the publish reactor skip. The lock lookup is keyed on `(workspaceId, itemRef)`. QA's flag is exact: an
identity must be threaded in **without** deriving it from `item.dir` (TECH_DEBT item 4) and **without**
switching `run-retry` into publishing as a side effect (which its own scenario guards).

The clean route exists: `resolveWorkspaceId(workspace, { override })`
(`workspace-identity.mjs:31-38`) already prefers *"identity that arrived as data"*. The worker's mints
already carry `brief: { assignmentId, itemRef }` and the handler holds `workspaceId` in scope; `ctx`
carries the workspace at the command sites. So a **new, lock-only `opts.lockContext`** — distinct from
`opts.workspace`, so the publish reactor's null-workspaceRoot behaviour is byte-unchanged — is the
shape. Cheap, but it is a seam-signature decision, not a detail. **ADR-010 should name it.**

### 6.6 Two smaller ones

- **Wrong flag, twice.** Story 06 task 02 writes `aof mesh assign 07/01 --node aof-wsl --json` (in the
  Examples table) and `aof mesh assign 07/01 --node <another node> --json` (in the reclaim scenario).
  The flag is **`--to`** (`commands/mesh-assign.mjs:45-48`: *"`aof mesh assign <ref> --to <nodeId> |
  --withdraw`"*). Story 01's features use `--to` correctly, so the two stories' scenarios disagree about
  the same verb.
- **The `degrade` sink is genuinely unreadable, and the entry cannot carry a ref.** Confirmed:
  `commands/mesh-logs.mjs:18` is `const KNOWN_PROCS = ["mesh-serve", "mesh-ui"]` and an unknown proc is
  a coded `invalid-proc` refusal (`:45-47`). Story 06 task 00 asserts against *"the durable degrade
  sink"* directly (an artefact, which is legitimate) — but it also says the entry names *"the cache miss
  **and the ref**"*, and `reportDegrade(code, error, extra)` (`degrade.mjs:28-45`) forwards only
  `extra.path` into the written record `{ level, code, message, path? }`. The ref must go in the
  message, or `reportDegrade`'s allowlist widens. Also note the **5 s per-code throttle** with
  process-global state: any suite asserting entry counts **must** call `setDegradeSinkForTest`
  (`degrade.mjs:19`) or it will read zero. Admitting `degrade` to `KNOWN_PROCS` is a one-line change
  that makes ADR-005's *"explicit, reported degrade path"* operator-visible; nobody owns it.

**Litmus channels I spot-checked and confirm are REAL:** `readWorkItemDoc` returns `{ ref, doc, body,
nodeId, updatedAt }` (`global-work-store.mjs:685-687`) — the "an artifact not re-sent shows an
`updatedAt` that did not move" channel is sound. `publishWorkspaceSnapshot`'s result **does** carry
`skipped` — and QA's name-collision warning is exactly right: it is `items.errors.length`, a
projection-error count, so a lock-skip counter must be a distinct key. `isStale(run, nowMs, threshold)`
is `age > threshold`, strict, injected clock (`run-store.mjs:510-514`), re-exposed as `isNodeStale`
(`mesh-presence.mjs:407-408`); `resolveStalenessSeconds` exists (`:418`) and is the "zero is honoured"
precedent QA cites. `reportedBy` really is set only on inserted child rows
(`board-worker-stream.mjs:159-161`) and not on the merged row (`:140`) — DESIGN's measured gap holds.
`commands/tasks.mjs:31-38` really does lose its `fromWorker: true` marker once `resolveItem` starts
succeeding, and `:44-47` really does answer `{ ref, tasks: [] }` on ENOENT — story 06's residual
concern (1) is a live regression risk, not a hypothetical.

---

## §7 — Build order

**I agree with ADR-009's three waves in shape, and disagree in two places.** The corrected order:

**Wave 0 (new, one task, ~half a day)** — `04/00_schema-v8-provenance-columns`. Eight lines of guarded
`ALTER` plus the version bump. Unblocks story 02's retraction predicate (§3) and removes the
`global-work-store.mjs` overlap between the two wave-2 siblings (§4).

**Wave 1 (parallel, genuinely disjoint once the mutation door is placed)** — `01` ∥ `02`.
Parallelism is real **only if ADR-010 places the control-side-mutation guard in
`effects/stream-transitions.mjs`** rather than in the upsert seam (§4). Story 02 must also amend
`acd-fact-projection-split` (§6.1).

**Wave 2 (parallel)** — `03` ∥ `05` ∥ `04`, **with two prerequisites carved out of 04 and started
early**: the board mount harness (§1.1) and the Resync control-side transport (§1.2). Both are
independent of `03` and `05` and can be built during wave 1 by a spare hand — the harness depends on
nothing at all, and Resync depends only on wave 0's columns. If they are not carved out, story 04 is
not a wave-2-sized story: it is 79 scenarios sitting behind two unbuilt substrates, and it will become
the critical path.

**`05` is the safest story in the milestone and should start first inside wave 2** — its harness family
already exists in full, its file footprint is disjoint from every sibling, and its only new requirement
is one export. It is also the only story that touches the god-file, so getting it in early keeps that
diff small and reviewable.

**Wave 3** — `06`, last, unchanged, and for exactly the reason ADR-009 gives. Its scenarios are not
merely red before wave 1; the control tick would clobber the fixture between the `Given` and the `When`.
Its two open questions (`promote-gap-to-chore`'s classification, the reach-through's write-door
contract) should be ruled on before it starts, since both are scenario-shaped and both change what the
step definitions must assert.

**One sequencing note ADR-009 does not make.** Story 06's `tasks` surface depends on story 03's widened
manifest — `tasks/*.feature` only ride the wire once ADR-007 lands. QA already recorded this in `06/05`'s
header ("if 43/03 has not shipped when this soak is run, the `tasks` step is the one that legitimately
reads empty"). Since 03 is wave 2 and 06 is wave 3 the ordering already holds; it is worth stating as a
dependency rather than leaving it as a soak-time caveat, because `06/01`'s headline scenario
(*"a fresh `aof work tasks 07/01 --json` reports the worker's task features, not an empty list"*) is
**not** a soak — it is `@executable`, and it is unsatisfiable without 03.
