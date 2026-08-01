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

- [ ] `43_story_item-lock` — not started
- [ ] `43_story_artifact-sync-on-write` — not started
- [ ] `43_story_cache-read-surface` — not started
- [ ] `43_story_staleness-and-resync` — not started
- [ ] `43_story_gate-propagation` — not started

Stories are named in the SPEC but **not yet scaffolded** — the break-down runs at refine.

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

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `UAT.md`
