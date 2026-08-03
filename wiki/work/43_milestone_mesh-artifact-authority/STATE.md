---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 43 · Mesh artifact authority — State

## Progress

**Refined 2026-08-01** (`aof:refine 43 --autonomous`) — the milestone is fully broken down and every
story carries its authored contract. Nothing is built yet.

**Building 2026-08-02** (`aof:continue 43` → `aof:autonomous 43`) — wave 1 under way.

- [x] `01_story_item-lock` — **done** (built, reviewed, accepted 2026-08-02). 103 `@executable` green,
      783 arch green, `validate 43/01` PASS. The build review found and fixed one HIGH regression the
      story itself introduced (the held-scope skip in the shared row-writer discarded the holder's own
      frames — see VERIFICATION F1 and ADR-011/A1) plus three vacuous assertions. Task 06's `@manual`
      two-machine soak is **carried to the milestone gate** — it needs the operator at two keyboards.
- [x] `02_story_cache-authority` — **done** (built, reviewed, accepted 2026-08-02). 93 `@executable`
      green (115 with the inherited item-lock lane), 787 arch green, `validate 43/02` PASS. Two HIGH
      defects found at review and fixed: AC5's "P0.3 is retired" was false (one bad row froze the whole
      workspace's cache), and the cure had introduced a renumber regression against HEAD (the operator's
      newly-inserted story never reached the cache). ADR-012 records the rulings. Task 08's `@manual`
      soak is **carried to the milestone gate**.
- [x] `03_story_artifact-sync-on-write` — **done** (built, reviewed, validated; both `@manual` lanes and
      the `@uat` run LIVE on a real two-node mesh and **accepted by the operator 2026-08-03**)
      (2026-08-02). 38 `@executable` green, 790 arch green, `validate 43/03` PASS, and this repo's live
      `.claude/settings.json` provably byte-unchanged. Two HIGH defects found at review: the story's
      **trigger was never delivered** (the matcher existed nowhere outside a test fixture, so a fresh
      `work init` installed the script and no entry), and five drain scenarios were **vacuous** — a plant
      disabling the drain entirely left four of them green, because the reconciliation backstop re-reads
      everything. ADR-013 records the ten rulings, including C8's supersession of AC5. **The `@uat` needs
      an operator reading a live remote agent's features on the control node, mid-run.**
- [ ] `04_story_staleness-and-resync` — refined, not started (wave 2)
- [ ] `05_story_gate-propagation` — refined, not started (wave 2)
- [ ] `06_story_cache-read-surface` — refined, not started (wave 3)

**STOPPED 2026-08-02 at the first `@uat` gate** (`aof:continue 43` → `aof:autonomous 43`). Wave 1 is
accepted and committed; wave 2's first story is built and validated but cannot be accepted without a
human. The cascade halts here because `aof work next 43` keeps returning `43/03` while it is `in-review`,
and because **every remaining lane in this milestone needs the same thing**: a deployed build on two real
nodes plus an operator. Nothing further can be proven from this machine alone.

**What the operator has to do to unblock it** — one session, in this order:

1. `node scripts/install-local.mjs --skip-ui` then `node scripts/install-local.mjs --wsl --skip-ui`
2. Quit the desktop app from its own UI, then `aof mesh desktop run` (never a force-kill; never a
   hand-spawned daemon)
3. Verify `~/.aof/bin/aof.exe --version` reports `payload <buildId>`, and both daemons print the same
   `Build:` line
4. Run the three carried lanes: `43/01` task 06 (cross-machine lock soak), `43/02` task 08 (cross-machine
   cache-authority soak), and task 01's **`@uat`** — an operator reading a live remote agent's
   freshly authored `tasks/*.feature` on the control node while the run is still live
5. `aof:verify 43/03` to record the sign-off, then `aof:autonomous 43` to resume — it will pick up at
   `43/04`

**Updated 2026-08-03 — steps 1–3 are DONE and the two `@manual` lanes are CLOSED.** `ui/dist` was built
for the first time in this checkout (the cause of the "9 pre-existing failures" every story hit); the
payload is deployed to both nodes (`payload 42864d8.20260803T000925`); the desktop app is supervising
`:4181`/`:4182`; the WSL worker has the current `src/` and a `claude` that authenticates in the daemon's
own bare environment. `43/03`'s two `@manual` lanes were then **run live and passed** — see VERIFICATION.
A deploy defect was found and fixed on the way (`*.sh` was never pinned to LF, so `core.autocrlf=true`
made `scripts/deploy-wsl.sh` and `install.sh` unrunnable — commit `42864d8`).

**What is still blocked, and on what:** the WSL worker *daemon* is not running — starting it was refused
by the environment's permission classifier, twice, so the worker cannot connect to the control stream.
Until it does, the three cross-machine lanes cannot run: `43/01` task 06, `43/02` task 08, and `43/03`'s
`@uat`. The command the operator needs is
`wsl -d Ubuntu-22.04 --cd /home/umair/source/aof -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/umair aof mesh serve --serve`
— the clean env is not incidental, it is the environment in which `claude` was proven to authenticate.

Produced at refine: `RESEARCH.md`, `DESIGN.md`, `ARCHITECTURE.md` (ADR-001…ADR-010), `FEASIBILITY.md`,
six scaffolded stories, **42 task features / 277 scenarios** (240 `@executable`, 19 `@manual`,
18 `@uat`), and **eight fitness-function files / 31 proofs, all green**.

## Notes & decisions in flight

### 2026-08-01 — how this milestone was scoped

Scoped from an operator direction given while m42's last open row (run-settled docs landing on the
default branch) was being put up for its mechanism decision. The investigation that preceded the
direction is the reason this milestone exists rather than that row: the docs-to-default-branch cure
was aimed at making the control node's **disk** current, and the operator's answer was that the
control node's disk should stop being read at all.

**The four operator directives, verbatim in substance:**

1. When a task is assigned, **lock the work item** on the control node — not assignable to another
   node, or anything else. No concurrent worker support yet.
2. While a worker is working an item (refine, continue), **the viewport uses that worker's
   snapshot**, synced to the control node as the work happens.
3. The control node **caches the artifacts in SQLite, with a TTL**. Do not read from the control
   node's disk from now on.
4. The worker **syncs to control during the aof lifecycle**: when writing artifacts to worker disk,
   also send the update over the wire. No pulling from control to worker unless something is wrong.

### The measured evidence behind directive 2/3 (the reason the current view is fragile)

`work_items` is a projection of the CONTROL node's disk, wholesale-deleted and rebuilt on every
propagation tick ([global-work-store.mjs:431](../../../src/global-work-store.mjs#L431), fed by
[mesh-launcher.mjs:732](../../../src/mesh-launcher.mjs#L732)). The worker's streamed rows are
merged in by `applyDeltaFrame` and then rebuilt out again by the next control tick — **the two
writers alternate and the last tick wins.** On a successful push the worker deletes its worktree
([mesh-worker-execution.mjs:2664](../../../src/mesh-worker-execution.mjs#L2664)) and stops ticking
forever, so after settle the stale side wins permanently.

`work_item_docs`/`work_item_runs` survive only because m42 leg d5 classified them **facts** and the
wholesale-delete guard refuses to sweep them — which is exactly why STATE could record "streamed
content PERSISTS after worktree cleanup" while the row underneath reverted to the stub.

### DECIDED — the TTL never evicts (operator, 2026-08-01)

A TTL that evicts would destroy the mesh's only readable copy: after settle the artifacts exist in
exactly two places, the pushed branch and the control's cache, and this milestone deliberately does
not read git. So the TTL is a **staleness marker**, not an evictor. Cached rows carry `syncedAt` +
the reporting node; past the window the board shows a stale badge and a **Resync** action that
requests a fresh push from the owning node. That Resync is the first sanctioned "pull", and it is
operator-initiated — which is the shape of directive 4's "unless something is wrong" carve-out.

### DECIDED — control-side writes are refused mid-phase, allowed at a gate (operator, 2026-08-01)

The open question was two writers on one item: the worker owns it remotely, but the control node
legitimately performs maintenance on it (the operator's example: adding a story to a milestone).
The operator considered requiring the control node to switch to the item's active branch and push
there, and was explicitly unsure. The rule taken **for now**:

> While an assignment for the item's execution scope is active, control-side mutation of that item
> is refused. Changes are allowed only when the item reaches a gate (refine / continue / verify),
> i.e. when no assignment is active.

This is computable today from `global_assignments` — a phase *is* an assignment, so "between gates"
is "no active row"; no new state is introduced. It is also load-bearing rather than conservative:
"add a story" is an **insert**, which renumbers folders and raises `stream.reindexed`, and running
it while a worker holds a worktree full of the old refs is the worst case in the system (control
renames `03`→`04` while the worker is actively writing `03`).

**The branch switch is not needed, and was set aside.** Forcing the control checkout onto the item
branch fights whatever the operator is doing, is impossible on a dirty tree, and reintroduces the
control→worker pull directive 4 rules out. m42's **base-commit pin** (`50c2c82`) already carries a
control-side edit to the worker: the dispatch stamps the assigning checkout's HEAD and the worker
builds from exactly it. The one gap is that the **reuse doors ignore the pin by design** ("an
existing line continues from where it is"), so a continuing item never sees the edit — closed by
`43_story_gate-propagation`, which fast-forwards the existing item branch to the pinned commit at
dispatch, into a tree that is quiescent precisely because it is at a gate.

### DECIDED — the sync trigger is a `PostToolUse` hook, not a watcher (operator, 2026-08-01)

Directive 4's blocker: **aof does not write the artifacts — the agent does.** Claude Code writes
`STORY.md` and `tasks/*.feature` straight into the worktree with its own Write tool; aof's only
visibility is the periodic re-scan on the stream tick. So "when writing to disk, also send" needs
something to hang a trigger on.

The operator asked whether an agent can call a command on update, and whether that is reliable.
It is — **as a hook, never as an instruction**. An instruction to run a command after editing is
the forget-class bug this arc exists to kill; a `PostToolUse` hook is executed by the Claude Code
harness, and the model cannot skip it. The pattern is already proven in this repo: `.claude/settings.json`
fires `aof session start|ping|end` from `SessionStart`/`UserPromptSubmit`/`SessionEnd`
(`cli.mjs:615` — *"assistant-session presence (fired from editor hooks)"*), plus a `PreToolUse`
guard on `Bash|PowerShell`; `PostToolUse` is present as an empty array.

An fs watcher was considered first and **rejected**: the hook names the exact file
(`tool_input.file_path`), fires synchronously with the write, needs no debounce heuristics, and
avoids `fs.watch`'s cross-platform behaviour entirely.

Two known limits, both carried into the story:

1. **Coverage is high, not total.** `Write`/`Edit`/`NotebookEdit` are covered; files written by a
   `Bash` command (`sed -i`, a codegen script, `git checkout`) are not — a `Bash` matcher sees the
   command, not the files it touched. The existing periodic tick is **retained as the
   reconciliation backstop**, which closes that gap for free.
2. **Frequency.** `session ping` fires per prompt; `PostToolUse` on Write|Edit fires far hotter — a
   refine writes dozens of files, and booting the full CLI per edit would add latency to the agent's
   own work. The hook body must be a **thin enqueue**, with the worker daemon batching the wire
   send.

**Installation is a real gap, and belongs to the sync story.** The bundle installs 34 files into
`.claude/` (agents + commands) but does **not** manage `.claude/settings.json`; this repo's hook
config is hand-maintained by the operator. The precedent for shipping hooks exists on the Codex
side (`.codex/hooks.json`, manifest.json:522). The Claude-side settings write must be a **merge**,
never wholesale — that is m42 leg d4's `writeLock` defect verbatim, where `aof init` silently
deleted the sections of a lock file it did not own.

### The disk line (recorded, since directive 3 read literally would break three subsystems)

The cache is authoritative for item **state** and artifact **content**. The disk remains the medium
for structural operations on the control's own checkout — `work-reindex` renames real folders,
`validate`/`doctor` check folder↔frontmatter *consistency* (the disk is the subject of the check),
`work-upgrade` rewrites templates in place, and the scaffold verbs create directories. Every such
operation publishes its result into the cache.

The corollary the directives do not state but require: **nothing seeds the cache otherwise.** A
milestone authored on the control node exists only on control disk, so the control node must sync
its own lifecycle writes through the same seam a worker uses. The cache has one read surface and
many writers, of which the control node is simply one.

### Migration surface (measured 2026-08-01)

25 disk-read call sites across 18 modules (`listItems` / `findWork` / `nextWork` / `listStream`).
The control-side readers that must move: `next`, `find`, `resolve` (which `doc`/`tasks`/`feedback`
sit on), `run-start`, `list`, `work-doctor`, the notion sync/associate pair, `promote-gap-to-chore`,
`mesh-heartbeat`, and `memory/local-indexing`. The worker-side reads in `mesh-worker-execution.mjs`
are correct as they are — a worker reading its own checkout is the intended behaviour and must not
be migrated.

### Two lock holes measured at HEAD (inputs to `43_story_item-lock`)

1. **The lock is exact-ref, execution is milestone-scoped.** `findActiveAssignment` matches
   `item_ref` exactly ([assignment-record.mjs:203](../../../src/assignment-record.mjs#L203)), so
   milestone `42` running on one node does not prevent `42/03` being assigned to another — while a
   mesh run of `42` builds every story in ONE worktree on ONE branch. The read side already has the
   scope rule (`resolveScopedExecution`,
   [board-mesh-execution.mjs:125](../../../src/board-mesh-execution.mjs#L125)); the write side does
   not use it.
2. **Nothing local honours the lock.** `run-start` never queries `global_assignments`, and `work
   next` will hand out a locked item. Only the continue/refine/verify door checks, via the overlay —
   and that is not the mint door. The check belongs in front of `transitionRunStart`, the one seam
   all four mint sites route through since m42 leg d4.

### 2026-08-01 — the refine, and the four things it changed about the plan

`aof:refine 43 --autonomous`. The Decide stage produced `RESEARCH.md` and `DESIGN.md`; the architect
produced `ARCHITECTURE.md` (ADR-001…ADR-009) plus eight fitness-function files; six QA amigos authored the
contracts in parallel; the architect then ruled their findings into **ADR-010 (refine-time
reconciliation)**; and the developer amigo produced `FEASIBILITY.md`. Four things came out of it that the
scoping above did not anticipate:

1. **The break-down is SIX stories, not five.** `cache-read-surface` split along the authority cut vs. the
   reader migration — the write-side change is ~3 modules and high-risk, the read-side is 17 sites across
   12 modules and mechanical. Together they made the critical path as long as the widest sweep and made
   the risky change unreviewable inside a 13-module diff.
2. **The sync trigger stayed a `command` hook, but the alternative was real.** RESEARCH measured a fourth
   hook type — `http` — that POSTs the identical payload with **zero process spawn** against ~23ms for a
   node spawn. ADR-001 rejected it as primary anyway: it needs a new inbound listening surface on every
   agent node, requires writing the security-relevant `allowedHttpHookUrls` key into a hand-authored file,
   needs a dynamic port known at settings-write time, and **fails silently** when the allowlist is
   restrictive — reintroducing the forget-class failure one layer down, for 23ms. Recorded as
   supersedable if the worker daemon ever grows a loopback listener for another reason.
3. **Two ordering defects were found and fixed before any code was written.** (a) ADR-004's
   author-retraction predicate reads `work_items.node_id`, a column ADR-009 had landing *after* the story
   that needs it — schema v8's `ALTER` and write-side stamping moved to `43/02`, with `43/04` keeping
   everything read-side. (b) ADR-004's "outside a lock, last-write-wins by `syncedAt`" would, after
   settle, let the control's tick re-win with a fresher timestamp from stale disk — reverting the item,
   i.e. the disease. **Authority is now by authorship and door, never by timestamp**; `syncedAt` is
   provenance for display and staleness only.
4. **The milestone's real critical path is the UI story's missing substrate, not the cache cut.** Story 04
   must first build a board-side headless mount harness (~1.5–2.5 days — nothing in the repo mounts
   `Board.tsx`), the `work:resync` transport (~2 days — nothing carries a node→node "push me your state"
   request; `mesh-recovery-push.mjs` is the precedent), and a `Board.tsx`-root 1s clock. ~4 days sitting
   under 79 scenarios. Start them during wave 1.

### 2026-08-01 — a latent defect this milestone now closes before it arms

`planApplyActions` (`src/render-plan.mjs:12-49`) gates drift protection on a **prior lock entry**, and
falls through at `:48` to an ungated *"existing file will be overwritten"* for any file without one — which
describes this repo's hand-authored `.claude/settings.json` exactly, since the bundle has never written it.
The content that would be written is built entirely from `config.hooks` + `config.settings`, so the moment
this milestone adds a `claude` hook to `.aof/aof.config.json`, the next `work init` / `work update` /
`assets apply` would silently delete the operator's `SessionStart`/`UserPromptSubmit`/`SessionEnd`/
`PreToolUse` hooks, `permissions.deny`, `sandbox.filesystem`, `enabledPlugins` and `extraKnownMarketplaces`.
**This is m42 leg d4's `writeLock` defect verbatim, third instance.** ADR-002 closes this file's case (the
file is CO-AUTHORED, so it gets a surgical merge and the whole-file render path is structurally closed);
the repo-wide fix is TECH_DEBT **item 9**. ADR-010 additionally sharpened the fallback: absent ⇒ `{}`, but
a **torn** file is a coded `claude-settings-unparseable` that writes nothing — the literal "torn ⇒ `{}`"
would have answered one missing brace by replacing a ~140-key operator file with a three-line aof document.

### Documented default decisions taken autonomously (no operator present)

- **No mock was elicited for the UI surfaces**, because `--autonomous` means there is nobody to ask.
  Per 07/ADR-003 the **binding checklists in `DESIGN.md` are therefore mandatory and ARE the conformance
  source of truth** for all three surfaces; all three carry one. If a mock is produced later it belongs in
  `wiki/work/43_milestone_mesh-artifact-authority/mocks/` as a committed, locally-readable file.
- **18 `@uat` scenarios** were authored (14 of them in story 04) — a deliberate consequence of the no-mock
  decision: with no image baseline, the perceptual judgement moves to a human gate at verify time.
- The **staleness window value and the two Resync timeouts** were left unpinned as tuning constants;
  DESIGN supplies defaults (10s request, 3 poll intervals) for the Three Amigos to fix at build time.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `UAT.md`

## Feedback (for retro)

- Record-doc citations decayed between authoring and this refine, three ways, and each cost a verification pass: (1) SPEC.md cited global-work-store.mjs:431/:417 for the wholesale rebuild; at HEAD it is :459-460 inside a function starting at :436. (2) STATE.md asserted '25 disk-read call sites across 18 modules'; a reproducible grep measures 33 across 21. (3) SPEC/STATE cite commits 50c2c82 and 87a7f39, neither of which resolves in this checkout (Mac worker, branch fix/worker-completion-and-milestone-cascade) — a cross-machine citation that reads as authoritative but cannot be verified where the refine actually runs. Durable lesson for the retro: a record doc should cite MODULE + FUNCTION NAME (stable across edits, greppable on any machine) and reserve line numbers for a same-session quote; a COUNT asserted in prose should carry the command that produced it, or it silently becomes folklore. RESEARCH.md this refine did exactly the right thing by re-measuring and flagging the deltas rather than inheriting them. — Raised by: architect
- DEFECT (found at refine, 2026-08-01): `aof work insert-story <slug> --at P --under NN` rewrites PROSE tokens matching NN_story_* in the parent SPEC.md '## Stories' checklist as if they were top-level refs. Six nested inserts under milestone 43 rewrote the PO's hand-written labels '43_story_item-lock' etc. through 44,45,...,49 — one bump per insert. Nested inserts shift only the nested SS space (each reported shifted:0) and must never renumber the parent's own number. The checklist updater's rewrite is matching too broadly. Repro: scaffold 6 stories under a milestone whose SPEC '## Stories' section names them as NN_story_<slug> prose. — Raised by: product-owner
- BUILD 43/01, the defect the story introduced: the held-scope skip was placed in `publishWorkspaceSnapshot`, which READS as "the tick" but is the shared row-writer with three callers — the control's periodic publish AND the two worker frame doors (`applySnapshotFrame`/`applyDeltaFrame`). The lock therefore made the control node discard the holder's OWN streamed rows for the whole duration of its phase, including the completion frame, reintroducing ADR-004/D1's permanent revert through the mechanism meant to prevent it. Both reviewers found it independently and QA reproduced it black-box end-to-end. The durable lesson is not "check the callers": it is that **"operator vs automatic" was written as a property of the TRIGGER when it is a property of WHOSE SLICE is being written** — a distinction the AC's own wording ("the periodic tick skips the rows it does not own") already contained and the implementation collapsed. Ruled in ADR-011/A1. Retro-worthy because no fitness function can catch it — a placement assertion sees the guard in the right module; only a behavioural test through the frame door sees the data loss. — Raised by: architect + qa
- BUILD 43/01, three of the story's own claims were asserted vacuously and only found by an explicit hunt for unfalsifiable tests: a "no log spam" assertion against a channel that is always empty in-process, an Examples row whose distinguishing flag was dropped by the destructure (so it duplicated the row above it), and a "resume mints nothing new" scenario asserted against a guard function that cannot mint anything. All three were GREEN and all three proved nothing. Worth carrying: the QA review's highest-value pass this story was not coverage-counting (89/89 instances mapped 1:1) but the vacuity hunt — a scenario can be traced, green and worthless, and a per-story review should budget for that pass explicitly. — Raised by: qa
- BUILD 43/03, the story's central trigger was never delivered and every test still passed: `aof work init` in a fresh workspace installed the enqueue SCRIPT and no hook ENTRY — the matcher string `Write|Edit|NotebookEdit` existed nowhere in `src/` or `.aof/`, only in a constant the tests build themselves. Four task features, 32 green scenarios, three armed fitness functions, and the mechanism was unreachable from the product. The gap survived because AC1 is a claim about the SHIPPED CONFIGURATION and every proof was a claim about behaviour given that configuration. Durable lesson: **when an AC's subject is a declaration (a bundle member, a config key, a registered route), the fitness function must assert the declaration exists in the shipped artefact — a behavioural test can only ever assume it.** — Raised by: architect
- BUILD 43/03, a vacuity class this milestone has now paid for three times, in its most expensive form yet: FIVE drain scenarios — including the story's headline — produced byte-identical observables whether the queue held the right names, the wrong names, nothing, or did not exist. A plant that made the drain return empty and never consume left four of them green. The cause is structural rather than careless: the reconciliation backstop re-reads everything anyway, so **any assertion phrased over the artifact bodies is an assertion about the backstop, not about the hook.** The rule that falls out is worth more than the fix: in a system with a repair mechanism, a test of the fast path must name an observable the repair path CANNOT produce — here, a named-but-now-missing artifact, an `unresolved-path` line, and the consumed batch's own bytes. — Raised by: qa
- BUILD 43/03, an AC and its own ADR were in tension and the build silently picked one: AC5 demanded BOTH "reads content for the named artifacts only" AND "one loop does both jobs — the targeted push and the reconciliation backstop", which cannot both hold. The build implemented the backstop and documented the deviation in a module header; the record doc was never amended, so the contract claimed a property the system did not have and the only scenario over it could not fail. Ruled at review (ADR-013/C8): the queue bounds the WIRE and the REPORTING, never the local read — narrowing the read would have broken AC4's "never worse than today", `Bash`-written convergence, and every codex worker (which has no `PostToolUse` hook at all, so its queue is permanently empty). Carry the shape: **an AC containing the word "only" alongside a mandate to keep a fallback is a contradiction, and refine is where it is cheap to notice.** — Raised by: architect + developer
- BUILD 43/03, a shrink-only ratchet was side-stepped in the same diff that extended it: a baseline entry was added to `acd-no-new-silent-catch` with a sound rationale, while a SECOND silence — a dead `finally` whose assignment is never read — landed in the same file where the detector could not see it. The pinned count said 1; the true count was 2. Cheap durable cure: **a baseline addition must be reviewed together with a re-count of the file, never with its rationale alone.** — Raised by: architect
- BUILD 43/03, ADR-001's "O(changed) instead of O(all artifacts)" is realised on the WIRE, not on local reads: STATE requires the reconciliation backstop to converge a `Bash`-written file on the SAME tick, which forces a full read of the manifest set every tick regardless. What the hook actually buys is the wire send (via the content hash) plus two things a scan can never produce — a named-but-now-missing artifact, and an `unresolved-path` degrade. Recorded because the ADR's stated benefit and the built benefit are different benefits, and the difference only surfaced when the two mechanisms had to coexist. — Raised by: developer
- BUILD 43/03, the reconciliation backstop makes drain assertions unfalsifiable by default, and two planted defects passed because of it: "the batch is discarded even when the send failed" and "the drain ignores a carried batch" both stayed green, because the backstop re-reads the bodies on the next tick anyway. The tests were repaired to assert the thing the backstop CANNOT reproduce (the batch's own bytes; an `unresolved-path` line that exists only in the queue). Durable lesson: **a system with a backstop cannot be tested through the channel the backstop repairs** — every assertion about the fast path must name an observable the slow path does not produce, or it is testing the backstop. — Raised by: developer
- BUILD 43/03, an absolute path stamped into a COMMITTED config file is machine- and checkout-specific: the merge stamps the queue's absolute path into `.claude/settings.json` at install time, but a `git worktree` (which is exactly how a mesh worker builds its checkout) inherits the committed settings file, so a worker's hook entry may name another checkout's queue. No AC covers it. Worth carrying beyond this milestone as a class: **anything the bundle writes into a tracked file must be either checkout-relative or resolved at run time** — an install-time absolute path is correct on exactly the machine that ran the install. — Raised by: developer
- BUILD 43/02, the story headline asserted a hazard was retired that was not: AC5 claimed `applyDeltaFrame`'s P0.3 whole-transaction rollback died "because there is no longer a whole-workspace transaction for one bad row to abort" — but the new seam still opens ONE `BEGIN IMMEDIATE` per batch, and its completeness screen checked four of the eight columns it binds. A `title: [alpha, beta]` in one record doc's frontmatter (ordinary operator input — `parseFrontmatter` deliberately parses inline lists) therefore froze the ENTIRE workspace's cache on every tick, and a single bad row in a worker frame dropped the whole frame silently into a degrade sink with no reader. Both reviewers found it independently. The durable lesson: **an AC that claims a hazard is retired should name the mechanism that retires it and the test that proves the hazard gone** — "there is no longer a transaction" was a claim about the design that the build never had to satisfy, and the Examples table meant to catch it enumerated eight shapes of the SAME failure class (missing/empty strings), so it could not reach a present-but-non-bindable value. Class-diversity in an Examples table is worth more than row count. — Raised by: architect + qa
- BUILD 43/02, the cure introduced a regression against HEAD that no AC covered: with the wholesale rebuild gone, a control-side RENUMBER leaves a worker-authored row parked at the old ref forever, so the operator's newly-inserted story never reaches the cache and the ref renders a DIFFERENT item's slug, title and status. The old disease self-healed this case by rebuilding everything; the cure made it permanent. It was found only because QA drove a real `insert-story` rather than reasoning about the retraction predicate. Worth carrying: **when a story removes a self-healing mechanism, the retro question is not "is the new rule correct" but "what was the old mechanism silently repairing"** — a wholesale rebuild is a bad authority model AND a free reconciler, and only the first half was in scope. — Raised by: qa
- BUILD 43/02, two ADR clauses turned out to be unimplementable-as-written and were narrowed at build time rather than discovered later: ADR-004's "outside a lock, last-write-wins by `syncedAt`" cannot hold BETWEEN nodes (it hands authority to clock skew, and would let a worker with a trailing clock have its own holder frames rejected — ADR-011/A1's regression by another route), so the rule is now same-author-only and arrival order decides between two workers; and ADR-010/D1's "operator-initiated delete" door has nothing to hang on, because aof has no item-delete verb at all. Both are recorded rather than silently absorbed. The pattern to carry: an ADR clause that names a tiebreaker should state WHICH ACTORS it arbitrates between — "last-write-wins by timestamp" is safe within one author and unsafe across two, and the sentence read identically in both cases. — Raised by: developer + architect
- BUILD 43/02, `src/global-work-store.mjs` grew 885 → 1,233 lines (+39%) in ONE story, and ADR-009 routes more into it (43/04's mapper, predicate and Resync). This is `mesh-worker-execution.mjs`'s trajectory exactly — one justified block at a time. The architect deliberately did NOT require a split inside the milestone's riskiest diff, and instead committed a line-ceiling ratchet plus a requirement on 43/04 to land its read-side code in its own module. Carry the ratchet-instead-of-refactor move: it converts "we should split this one day" from a comment into a test that fails. — Raised by: architect
- BUILD 43/01, m20/R1 fired twice in one story: ADR-003 nominated `transitionRunStart` and `transitionStreamReindexed` as shared seams but enumerated no prior-milestone TESTS of them. Two (m42/d5's remap proof, m38/04's node-eligibility probe) used an active assignment over a ref another assignment's scope covers as incidental fixture state — legal at HEAD, illegal after ADR-003, so both had to be amended before the story could go green. An ADR that adds a guard to a shared seam should list the existing tests of that seam in its Consequences, as 19/R1 and 20/R1 both already require. — Raised by: developer
- BUILD 43/01, `npm run check` is unusable on this machine — `scripts/check.mjs` shells into the full suite, which binds `:4182`, held by the live control daemon; there is no focused or lint-only entry point, so every agent hand-rolls a runner into the scratchpad. A `scripts/test-focused.mjs` taking a file list would remove that per-agent tax and make "what did you actually run" auditable. — Raised by: developer
- Three Amigos closure, doc-drift routed rather than fixed: src/effects/stores.mjs:27 lists 'work:doctor --explain: renders a store's class beside its cascade' among TABLE_CLASSIFICATION's consumers. Verified 2026-08-01 — work-doctor.mjs and its group modules have NO --explain handling at all, and TABLE_CLASSIFICATION is imported by exactly two files (stores.mjs itself and test/arch/acd-fact-projection-split.test.mjs). The comment documents a consumer that does not exist. This is TECH_DEBT item 0's fourth shape ('history kept in comments rather than in the design') in its subtlest form: not a stale scar narrating an old bug, but a forward-looking claim about a feature that was never built, which reads to the next author as an existing contract to preserve. Retro-worthy because the class is invisible to every gate we have — an arch-test can check that a claimed IMPORT exists, but not that a claimed COMMAND FLAG does. Cheapest durable cure: when a module header enumerates its consumers, each entry should be a module path (greppable, and acd-* can ratchet it) rather than a user-facing verb+flag. Left unfixed deliberately: it is a comment, not accrued structural cost, so it does not belong in TECH_DEBT. — Raised by: architect
