---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 43 · Mesh artifact authority — Architecture Decisions

> Inputs: `SPEC.md` (the control node's SQLite cache becomes the ONE read surface for work-item state
> and artifact content, fed by whichever node authored the change; an assigned item is exclusively
> owned for the duration of its phase), `STATE.md` (four operator directives + four DECIDED entries —
> **the TTL never evicts**, **control-side writes refused mid-phase / allowed at a gate**, **the sync
> trigger is a `PostToolUse` hook, not a watcher**, **concurrent workers deferred**; these are SETTLED
> and are cited below, never relitigated), `RESEARCH.md` (measured: the `PostToolUse` payload shape and
> its per-tool path field, the `http` hook type, spawn-cost table, the `.claude/settings.json`
> wholesale-overwrite defect, schema v7's column reality, the 33-call-site migration surface),
> `DESIGN.md` (the freshness ramp and its **data ask**: every row/artifact carries `syncedAt` +
> `reportedBy`, the envelope carries `stalenessSeconds`, and the staleness predicate REUSES the shared
> `isStale` — "two predicates that can disagree about the same instant is a defect").
>
> **Memory recall.** `aof work memory recall … --area architecture --block` was run before each ADR
> below (seven queries: hook trigger, settings merge, lock door, cache authority, staleness model,
> artifact set, gate propagation). Every block came back EMPTY — the workspace memory index reports
> `backend=graphify records=0`, so there is genuinely nothing to surface. No near-miss was honoured or
> departed from, because none exists to honour. Prior-milestone lessons are cited directly from source
> instead (m42 leg d3/d4, m41/ADR-001, m38/ADR-002, m35/ADR-005, TECH_DEBT items 3/4/6).
>
> **Codebase-graph grounding.** The graph was rebuilt fresh at this refine (`aof graph build src` →
> **1960 nodes, 5754 edges, 84 communities**, built `2026-08-01T13:51:34Z`; `aof graph impact` read back
> per file below). It reports the coupling every boundary here is drawn against — actual structure, not
> inferred:
> - **`src/work.mjs` is the god-node — imported by 37 modules, imports only 3** (`fs`, `node-identity`,
>   `workspace`). The reader migration lives entirely inside that blast radius, which is why it gets a
>   NEW seam module beside `work.mjs` rather than new exports inside it (ADR-005, reusing m41/ADR-001's
>   direction rule verbatim).
> - **`src/commands/resolve.mjs` — imported by 8 command modules** (`continue`, `doc`, `feedback`,
>   `run-complete`, `run-retry`, `run-start`, `run-status`, `tasks`), imports only `work.mjs`. It is the
>   single highest-leverage migration chokepoint in the milestone: one edit moves eight commands
>   (ADR-005).
> - **`src/effects/run-transitions.mjs` — imported by 5** (`commands/run-complete`, `commands/run-retry`,
>   `commands/run-start`, `mesh-assignment-reclaim`, `mesh-worker-execution`), imports 5. `transitionRunStart`
>   is reached from **five mint call sites in three modules** (`run-start.mjs:156,176`, `run-retry.mjs:65`,
>   `mesh-worker-execution.mjs:2458,2954`) and from nowhere else — confirming STATE's nomination of it as
>   the ONE lock door (ADR-003).
> - **`src/assignment-record.mjs` — imported by 6, imports 0: a pure leaf.** That is why the execution-scope
>   rule moves DOWN into it rather than the mint seam reaching UP into a board module (ADR-003).
> - **`src/global-work-store.mjs` — imported by 16, imports 6** (`degrade`, `effects/stores`, `run-store`,
>   `work`, `workspace-identity`, `workspace`). It holds the ONLY `INSERT INTO work_items` in the repo
>   (`:463`, verified by grep across `src/`) — so the single-writer seam ADR-004 needs already half exists.
> - **`src/global-work-publisher.mjs` — imported by 7** (`commands/feedback`, `commands/mesh-repo`,
>   `commands/run-complete`, `commands/run-start`, `effects/table`, `global-mesh-query`, `mesh-launcher`),
>   imports 5; it is the seam `acd-global-publisher-single-seam` already pins for mutation callers.
> - **`src/board-mesh-execution.mjs` — imported by 3** (`continue`, `list`, `run-status`), imports 6 —
>   a FACE-layer module. The spine must not import it (ADR-003).
> - **`src/mesh-worker-execution.mjs` — imported by 3, imports 17, and is 3,174 lines** (measured
>   2026-08-01). Two of this milestone's stories land in it. See §Codebase health.
> - **`src/mesh-launcher.mjs` — imported by 2, imports 30.** The worker stream tick (`:1378-1392`,
>   `streamSyncSeconds` = `max(5, heartbeatWindow/3)`) and the control republish tick (`:732`) both live
>   here; ADR-001 and ADR-004 both attach to them.
>
> The graph is one input; every boundary below is the architect's call.
>
> **Citation corrections made this refine** (RESEARCH measured better line numbers than SPEC/STATE
> carried, verified again here at `277ada5`):
> - The wholesale delete+rebuild is at **`global-work-store.mjs:459-460`**, inside `publishWorkspaceSnapshot`
>   which starts at `:436` — **not** SPEC.md's `:431`/`:417`. The mechanic SPEC describes is exactly right;
>   only the lines drifted across m42 wave (d).
> - The migration surface is **33 call sites across 21 modules**, not STATE's "25 across 18" — split
>   control-side (13 modules / 18 sites), worker-side (2 modules / 7 sites), structural (6 modules / 8
>   sites). ADR-005 is built on the per-module list, not either summary number.
> - `transitionRunStart` lives in **`src/effects/run-transitions.mjs:39`**, not `assignment-transitions.mjs`
>   (which is the *assignment* seam; both are cited below and they are different doors).

---

## ADR-001: The sync trigger is a `PostToolUse` **`command` hook in EXEC form** whose body is a derivation-free append-only enqueue; the measured `http` hook type is REJECTED as primary and recorded; the worker daemon drains the queue on its EXISTING stream tick and batches the wire send

**Status:** Accepted
**Date:** 2026-08-01

**Context.** STATE settled the trigger — a `PostToolUse` hook, never an fs watcher, never a prose
instruction ("an instruction to run a command after editing is the forget-class bug this arc exists to
kill") — and required a **thin enqueue** with daemon-side batching, because `PostToolUse` on
`Write|Edit` fires far hotter than the `session ping` this repo already runs per prompt. RESEARCH then
measured the shape of the choice:

- **Spawn cost dominates and varies ~8×**: bare `node -e ""` ≈ 23ms; `node` + file append ≈ 24.6ms;
  `node` + `fetch` POST ≈ 41ms; `curl` POST ≈ 5.5ms; **the full `aof session ping` ≈ 70-80ms** — the
  number STATE's "booting the full CLI per edit" concern names, now measured.
- **A fourth hook type exists — `http`** — which POSTs the identical payload from Claude Code's own
  process with **zero child processes**, gated by an `allowedHttpHookUrls` allowlist. Measured live
  against a loopback listener.
- **`PostToolUse` cannot block** (documented + schema-confirmed): exit 2 shows stderr to the model but
  the tool already ran. Report-only — which is exactly right here: an artifact sync must never be able
  to veto the agent's own write.
- **The path field is per-tool**: `Write`/`Edit` carry `tool_input.file_path`; **`NotebookEdit` carries
  `tool_input.notebook_path`**. `MultiEdit` does not exist in the installed version (2.1.220).
- **The `command` hook's shell FORM differs by OS** (bash / Git-Bash / PowerShell); its **exec form**
  (`command` + `args`) bypasses the shell entirely and needs a real executable on Windows — `node`
  qualifies, `.cmd`/`.bat` shims do not.

The tempting decision is the `http` type, because it is free at the call site. Its real costs are not
latency: it requires (a) a **new inbound listening surface on every node that runs an agent** — the
worker daemon does not listen today, it dials out; (b) writing **`allowedHttpHookUrls`**, a top-level
security-relevant settings key, into a hand-authored settings file, widening exactly the merge blast
radius ADR-002 exists to narrow; (c) a URL that must be known when settings are written but whose port
is dynamic; and (d) a **silent-no-fire** failure mode when the allowlist is present-but-restrictive or
the installed harness predates the type — which is the forget-class failure this trigger exists to
remove, reintroduced one layer down. Against all that it buys ~23ms per file write; a refine writing
dozens of files pays well under a second in total, against LLM turn times measured in tens of seconds.

The other framing correction that settles the mechanism: the hook's real architectural job is **not**
latency. The worker already re-scans and streams its active worktree every `streamSyncSeconds`
(`mesh-launcher.mjs:1378-1392`, ≥5s). Widening the artifact set (ADR-007) makes an O(all artifacts)
re-scan-and-send expensive. The hook turns that into **O(changed)**: it names the exact files, so the
tick sends only what moved, and catches changes a scan window would miss.

**Decision.**
- **The trigger is a `PostToolUse` `command` hook in EXEC form**: `{ "type": "command", "command":
  "node", "args": ["<enqueue script>", …], "matcher": "Write|Edit|NotebookEdit" }`. Exec form is
  mandatory — the shell form's interpreter differs across the Windows control node, the Mac worker and
  the WSL worker (RESEARCH §1.6), and a hook that behaves differently per node is the cross-machine
  defect class this repo keeps paying for.
- **The matcher is pinned to exactly `Write|Edit|NotebookEdit`.** `MultiEdit` is deliberately absent
  (measured removed from the shipped tool set). `Bash`-written files are NOT covered and are not meant
  to be — STATE already retains the periodic tick as the reconciliation backstop, which closes that gap
  for free.
- **The hook body DERIVES NOTHING.** It reads stdin, resolves the path field through an explicit
  per-tool map, appends ONE NDJSON line to a queue file whose absolute path was stamped into its argv
  at hook-install time, and exits **0, always**. It opens no store, imports nothing from `src/`, boots
  no CLI, loads no workspace, and **computes no workspace identity** — the last is not incidental:
  cwd-derived identity is TECH_DEBT item 4, the defect that silently discarded 100% of the worker→control
  frames for days. The queue destination is an argument, not a derivation.
- **The per-tool path map is explicit and fails LOUD, never silent.** `Write` → `file_path`, `Edit` →
  `file_path`, `NotebookEdit` → `notebook_path`. A payload whose tool is matched but whose mapped field
  is absent enqueues a coded `unresolved-path` line rather than dropping the event — the drain reports
  it as a degrade. A hook keyed only on `file_path` silently misses every notebook edit; silence here is
  the exact failure mode being engineered out.
- **A failed enqueue NEVER fails the agent.** Exit code is always 0; the hook is report-only by
  construction (`PostToolUse` cannot block) and by choice. A queue that cannot be written degrades to
  the reconciliation tick, which is the pre-existing behaviour — never worse than today.
- **The daemon owns batching and the wire.** The worker daemon drains the queue on its EXISTING stream
  tick (`pushActiveWorktreeState`, `mesh-launcher.mjs:1448`), de-duplicates by path, reads current
  content for the named artifacts only, and sends one batched frame. The drain is **idempotent and
  loss-averse**: it consumes by rename-then-read (or a persisted offset), so a crash mid-drain re-sends
  rather than loses. One loop does both jobs — targeted push AND the reconciliation backstop STATE
  mandates keeping.
- **REJECTED, with the measurement recorded: the `http` hook type as the primary transport**, for the
  four reasons above. It is not rejected on merit — it is the cheaper mechanism at the call site and it
  measurably works — and this ADR is the record to supersede if the worker daemon ever grows a loopback
  listener for another reason, at which point the transport swaps behind an unchanged payload contract.
- **REJECTED: `curl` as the hook binary.** 5.5ms vs 23ms is real, but it requires the HTTP endpoint the
  `http` type also requires, plus `curl`'s presence on every node — a portability assumption this repo
  has no reason to take on for 17ms.

**Consequences.**
- The hook is auditable in one page: stdin → one map lookup → one append → exit 0. Nothing in it can
  disagree with the rest of the system, because it knows nothing about the rest of the system.
- No new listening surface is added on any node; no security-relevant settings key is written; nothing
  depends on a Claude Code version newer than the `command` hook type this repo already uses.
- Widening the artifact set (ADR-007) becomes affordable, because the tick stops re-sending unchanged
  content.
- The `~23ms` per-write cost is accepted explicitly and is ~3× cheaper than the `aof session ping` this
  repo already fires per prompt.
- `acd-artifact-sync-hook-derivation-free` fails CI if the enqueue script ever grows an `src/` import, a
  store open, a workspace-identity derivation, or a non-zero exit path — or if it handles `file_path`
  without handling `notebook_path`.

---

## ADR-002: `.claude/settings.json` is a **CO-AUTHORED** file — aof splices only its own self-identifying hook entry through a read-overlay-write merge, and the whole-file render path is closed for it. The general rule: **a whole-file render is correct exactly when aof exclusively owns the file; a co-authored file gets a surgical merge**

**Status:** Accepted
**Date:** 2026-08-01

**Context.** RESEARCH reported a latent defect; it was re-verified from source here before deciding.
`src/render-plan.mjs:13-49` (`planApplyActions`) gates drift protection on a **prior lock entry**. For a
file that exists on disk with **no** prior entry — exactly this repo's hand-authored
`.claude/settings.json`, which aof's lock has never recorded because the bundle never writes it
(`src/bundle/manifest.json`: 34 `.claude/` entries, zero for `settings.json`) — every guard is skipped
and the code falls through to line 48:

```js
actions.push(action("update", output, prior ? "generated content changed" : "existing file will be overwritten"));
```

An **ungated overwrite**: no `--force` required, no drift warning surfaced. And the content that would
be written is `claudeSettingsJson({ hooks, settings })` (`src/runtime-config.mjs:21-28`), which builds
the file's ENTIRE body from `config.hooks` + `config.settings` and nothing else. This repo's
`.aof/aof.config.json` has keys `$schema, name, work, memory, resources, packages, runtimes, mesh` —
**no `hooks`, no `settings`** (verified) — so `renderRuntimeConfigOutputs` (`src/adapters.mjs:101-111`)
emits no output today and the hazard is **dormant, not absent**. The moment this milestone adds a
`claude`-runtime hook to that config, the next `aof work init` / `work update` / `assets apply`
silently deletes the operator's `SessionStart`/`UserPromptSubmit`/`SessionEnd`/`PreToolUse` hooks,
`permissions.deny`, `sandbox.filesystem`, `enabledPlugins` and `extraKnownMarketplaces`.

**This is m42 leg d4's `writeLock` defect verbatim** — same shape, different file. That defect's own
words: *"`aof init` and `project migrate` wrote the WHOLE lock document, so either one run against a
workspace that already had work or planning installed silently deleted the other's section."* One
writer assumed sole ownership of a document with several authors. The cure is already in the codebase
twice — `mergeLock` (`src/lock.mjs:37-50`) and `writeSidecarPatch` (`src/node-identity.mjs:74-95`):
read what is there, overlay only THIS caller's keys, write the union; absent/torn reads as `{}`.

The one thing neither precedent does, and this needs: both replace a whole TOP-LEVEL key on a match.
`.claude/settings.json` has ~140 independent top-level keys, and within `hooks` five independently
hand-wired event keys. The merge target is not "one key" but **"one hook array entry, inside one event
key, inside one top-level key."**

**Decision.**
- **Classify the file, then pick the writer. The rule, stated once for the whole codebase:** a
  **whole-file render** (bundle manifest, content-hashed, drift-protected) is correct **iff aof
  exclusively owns the file** — `.codex/hooks.json` qualifies (nothing hand-authors into it), every
  bundled agent/command/skill file qualifies. A file with any other author gets a **surgical merge**.
  `.claude/settings.json` is co-authored and therefore takes the merge.
- **The hook SCRIPT and the hook ENTRY ship through DIFFERENT doors.** The enqueue script (ADR-001) is
  an aof-exclusive file and ships as a normal content-hashed **bundle asset** — the existing, correct,
  drift-protected mechanism. The **settings entry** ships through the merge. Splitting them is what
  keeps the exclusive-ownership rule true of every file the bundle writes.
- **A new merge writer** — indicatively `mergeClaudeSettings(settingsPath, patch)` — mirroring
  `mergeLock` + `writeSidecarPatch`: read (absent/torn ⇒ `{}`), splice, write the union, and **skip the
  write entirely when the merged result is byte-identical** (`writeSidecarPatch`'s refinement, which
  makes a no-op run leave no mtime churn).
- **aof-authored hook entries are SELF-IDENTIFYING.** Each entry aof writes carries an explicit
  ownership marker. Without one the merge cannot tell its own entry from an operator's on the next run,
  and would either append a duplicate every run or clobber a sibling. With one the splice is idempotent
  and **retractable**: removing the hook from config removes exactly aof's entry and nothing else. Any
  entry on the same event that aof did not author survives byte-identical.
- **The generic render pipeline is structurally closed for this file.** `renderRuntimeConfigOutputs`
  (`src/adapters.mjs:101-111`) must no longer emit a whole-file `.claude/settings.json` output, so the
  file can never reach `planApplyActions`' fall-through. This is a removal, not a guard added at a call
  site — the m42 lesson is that a rule living at whichever call site needed it first is not a rule.
- **The `allowedHttpHookUrls` question does not arise**, because ADR-001 chose the `command` type. That
  is a deliberate second-order benefit of ADR-001, recorded here: the merge's blast radius stays "one
  entry inside `hooks.PostToolUse`" and never widens to a top-level security key.

**Consequences.**
- The operator's hand-maintained settings survive every aof run, including a `work init` that treats
  every unlocked file as fresh (`src/work-init.mjs:30,91`).
- The defect is closed **before** it is armed: the hazard only becomes live when a `claude` hook lands
  in config, and that is the same change that introduces the merge.
- `acd-claude-settings-co-authored` fails CI the moment a `claude`-runtime hook/settings entry exists in
  config while `adapters.mjs` still renders the file whole-file — i.e. it arms exactly at the hazard —
  and asserts NOW, green, that the operator's current top-level keys are present (a canary that a
  wholesale overwrite would trip).
- **`planApplyActions`' ungated fall-through is a defect for EVERY co-authored file, not just this
  one.** Fixing it repo-wide changes `work init`/`work update` semantics and is out of this milestone's
  scope. It is routed to `wiki/work/TECH_DEBT.md` **item 9** and cited from this verdict; this milestone
  closes only the `.claude/settings.json` instance.

---

## ADR-003: The item lock is scoped by ONE `executionScopeRef` rule, which moves DOWN into the `assignment-record.mjs` leaf; the single enforcement door is inside `transitionRunStart`; the refusal is the coded `item-locked-by-assignment`; `work next` skips-and-reports through the SAME predicate

**Status:** Accepted
**Date:** 2026-08-01

**Context.** STATE measured two holes at HEAD and nominated a door.

1. **The lock is exact-ref; execution is milestone-scoped.** `findActiveAssignment`
   (`src/assignment-record.mjs:203`) matches `item_ref` **exactly**, so milestone `42` running on one
   node does not prevent `42/03` being assigned to another — while a mesh run of `42` builds every story
   in ONE worktree on ONE branch. The read side already owns the scope rule: `executionScopeRef` /
   `resolveScopedExecution` (`src/board-mesh-execution.mjs:117-136`), whose own comment says *"This is
   the ONE home for the scope rule."* The write side does not use it.
2. **Nothing local honours the lock.** `run-start` never queries `global_assignments`; `work next` hands
   out a locked item. Only the continue/refine/verify door checks, via the overlay — and that is not the
   mint door.

STATE nominates `transitionRunStart`. The graph confirms it: `src/effects/run-transitions.mjs` is
imported by 5 modules, and `transitionRunStart` is reached from **exactly five call sites in three
modules** (`commands/run-start.mjs:156,176`; `commands/run-retry.mjs:65`;
`mesh-worker-execution.mjs:2458,2954`) and from nowhere else. Its own header states the discipline this
decision inherits: *"the MINT is the second run-store fact to get a seam … Now the ledger decides, and
no mint can reach the store without the event."*

Two structural constraints bound the placement:

- **The spine must not import a face.** `executionScopeRef` currently lives in
  `src/board-mesh-execution.mjs` — imported by `continue`, `list`, `run-status` (graph), i.e. a
  FACE-layer module that itself imports 6 including `global-work-store.mjs`. Making the mint seam
  import it inverts the layering.
- **The run STORE must stay mesh-blind** — `acd-run-store-mesh-free` (m26/ADR-001) asserts
  `src/run-store.mjs` imports no mesh module and reads no config. That invariant is on the **store**,
  not on the **seam**; `run-transitions.mjs` already imports `effects/table.mjs`, `effects/dispatch.mjs`
  and `degrade.mjs`. So the guard may live in the seam and MUST NOT reach into the store.

**Decision.**
- **`executionScopeRef` moves DOWN to `src/assignment-record.mjs`** — imported by 6, **imports 0, a pure
  leaf** (graph). It is an assignment-record concern by subject ("which item ref does an assignment
  cover"), and a pure leaf is the only home both a face and the spine can reach without an inversion.
  `board-mesh-execution.mjs` imports it from there and re-exports for its existing consumers; the
  function is **defined exactly once in the repo**, as it is today.
- **The lock predicate is SYMMETRIC over the execution scope, and is a NEW composition — the exact-ref
  primitive is not changed.** `findActiveAssignment` keeps its exact-ref semantics for its 6 importers;
  a new scope-aware read (indicatively `findActiveAssignmentForScope`) returns the active row **whose
  `item_ref` shares this ref's execution scope** — `executionScopeRef(row.item_ref) ===
  executionScopeRef(ref)`. Symmetry is load-bearing and is a conscious extension of
  `resolveScopedExecution`, which only walks UPWARD (own row, else the parent scope's): running `42`
  must lock `42/03`, **and** running `42/03` must lock `42`, because both execute in one worktree on one
  branch. One predicate covers both directions.
- **There is exactly ONE enforcement door: inside `transitionRunStart`, in front of the fact.** Not in
  front of it at each call site — *inside* the seam, so no mint can reach the run store without it. This
  is `effects/assignment-transitions.mjs`'s discipline copied deliberately: *"the rules live ONCE, in
  front of the write, and no writer can reach the fact without them."*
- **The guard ADMITS the holder, exactly as the assignment seam does.** `guardAssignmentTransition`
  distinguishes a frame writer (passes the connection-authenticated `byNode`) from a control-side writer
  (passes none). The mint guard mirrors it: a mint made **under** an assignment passes that assignment's
  identity and is admitted; a local mint that passes none is refused when any foreign active assignment
  covers the scope. The worker's own two mint sites (`mesh-worker-execution.mjs:2458,2954`) run under
  the very assignment that holds the lock and are therefore admitted by identity, never by exemption.
- **The predicate has ONE home and TWO consumers.** A near-leaf module (indicatively `src/item-lock.mjs`)
  exports the predicate; `run-transitions.mjs` imports it for the refusal, and `work next` imports the
  same predicate to **skip-and-report**. `next` does not silently omit a held item (invisible) and does
  not hand one out to be refused a step later (a bad seam): it returns the next unheld item and reports
  the skipped ones in its envelope with the holder. One rule, two renderings.
- **The refusal is coded and loud: `item-locked-by-assignment`** — ONE code for every door, because it
  is one rule; the message names the door and the payload carries `{ itemRef, scopeRef, assignmentId,
  holderNode, state }` so a face can render "42 is held by aof-wsl — refused" without parsing prose. It
  joins the existing coded-refusal vocabulary (`assignment-status-not-holder`,
  `assignment-base-commit-unavailable`).
- **Automatic vs operator-initiated is the one place the rule renders differently, and it is decided
  HERE rather than per call site.** An **operator verb** (a mint, a second assignment, a control-side
  item mutation) is **refused, coded, loud** — a human asked and gets an answer. An **automatic periodic
  tick** (the control's publish, ADR-004) **skips the rows it does not own and counts the skips in its
  result** — a coded refusal per held item per tick is log spam, and the tick asked nothing.
- **The store stays mesh-blind.** The guard lives in the seam and in the lock module; `src/run-store.mjs`
  gains no import and no config read (`acd-run-store-mesh-free` re-armed, not duplicated).

**Consequences.**
- A second assignment, a local `run-start`, a `run-retry` and a control-side mutation of a held item are
  all refused by the same predicate with the same code — the rule cannot be true at one door and false
  at another.
- `work next` stops handing out work someone else is doing, and says why.
- The exact-ref primitive is untouched under its 6 importers; the scope rule is one new composition over
  it, defined once.
- `acd-item-lock-single-door` fails CI if `executionScopeRef` is defined twice, or (once the lock module
  lands) if `run-transitions.mjs` does not import it, or if a command module re-derives an active-row
  query for lock purposes.

---

## ADR-004: `work_items` stops being a disk-rebuilt projection and becomes a **provenance-stamped, row-upserted FACT** written through ONE seam that both the control node and every worker use; the `effects/stores.mjs` reclassification IS the enforcement; **each node may retract only the rows it authored**

**Status:** Accepted
**Date:** 2026-08-01

**Context.** The disease, measured precisely. `publishWorkspaceSnapshot`
(`src/global-work-store.mjs:436-504`) calls `wholesaleDelete(db, "work_items", workspaceId)` at
**`:459`** and then re-`INSERT`s every row from `readWorkspaceProjectionItems` — **the calling node's
own local disk slice** — inside one `BEGIN IMMEDIATE`. The control launcher runs this on a cadence
(`mesh-launcher.mjs:732`). The worker's contribution arrives as a delta and is merged by
`applyDeltaFrame` (`src/control-stream-server.mjs:177-202`), which reads the current rows, overlays the
delta by `ref`, and **re-publishes the merged set through the same wholesale seam**. So while a run is
live the two writers alternate and the last tick wins; after settle the worker deletes its worktree
(`mesh-worker-execution.mjs:2664`) and stops ticking, so the control's stale disk wins **permanently**.

The read primitive is not the disease: a node reading its own checkout to know its own state is correct,
and is what the WORKER uses to build the frame it streams. The disease is the **wholesale delete-and-
rebuild wrapped around that read, executed by a node that is not the sole author of every row.**

Two existing structures make the cure cheap:

- **`work_item_docs` / `work_item_runs` already prove the target shape** — per-`(workspace_id, ref, doc|run_id)`
  upsert, carrying `node_id` + `updated_at` per row, written by ONE writer (`upsertWorkItemContent`,
  `global-work-store.mjs:636-679`) since schema v5. They survive worktree cleanup precisely because m42
  leg d5 classified them **facts** and the sweep guard refuses them.
- **`wholesaleDelete` (`:45-61`) throws before running** when the target table is not classified
  `"projection"` in `src/effects/stores.mjs`. That is schema-level gating, not a comment.

**Decision.**
- **`work_items` is reclassified from `projection` to `fact`** in `src/effects/stores.mjs`, naming its
  writer module explicitly. **The reclassification IS the enforcement**: from that moment
  `wholesaleDelete(db, "work_items", …)` throws, so the rebuild cannot survive the reclassification even
  by accident. No new mechanism is invented; the registry m42 built for exactly this gates exactly this.
  - The class is a property of the **write discipline** (one row at a time, by its declared writer, never
    wholesale), and that discipline now holds for every row regardless of author. That the control node
    *can* re-derive its own slice from disk is a **repair path**, not a licence to sweep. Authorship stays
    visible per row via `node_id` rather than via a second table class.
- **The shared publish seam is a single row-level upsert primitive** — indicatively
  `upsertWorkItems(store, workspaceId, rows, { nodeId, syncedAt, authoritativeRefs })` in
  `global-work-store.mjs`, the **structural twin of `upsertWorkItemContent`**, which already stamps
  `node_id`/`updated_at` and already has exactly one writer. Both writers use it:
  - the **control node's** publish (`publishWorkspaceSnapshot`) calls it with its own node id;
  - the **worker's** delta (`applyDeltaFrame`) calls it with the **connection-authenticated** node id —
    never a self-reported one, the same rule `applyWorktreeContentFrame` already keeps.
  `global-work-publisher.mjs` remains the seam mutation callers and the launcher reach through
  (`acd-global-publisher-single-seam`, unchanged); this decision is about the **row primitive beneath
  it**, of which the repo already has exactly one (`INSERT INTO work_items` appears in exactly one place
  in `src/`, `global-work-store.mjs:463` — verified).
- **Contention is resolved by the ADR-003 lock, not by a timestamp race.** While an assignment covers a
  ref's execution scope, an upsert for that ref is accepted **only from the holder**. Outside a lock,
  last-write-wins by `syncedAt`. The control's periodic tick therefore **skips held refs and counts the
  skips** (ADR-003's automatic-vs-operator rule); an operator-initiated control-side mutation of a held
  ref is **refused with `item-locked-by-assignment`** — which is STATE's settled "control-side mutation
  is refused mid-phase, allowed at a gate", landing in the same guard as the mint door rather than as a
  second rule.
- **Deletion is solved by AUTHOR RETRACTION, never by a sweep and never by time.** Dropping the
  wholesale delete would otherwise leave deleted items in the cache forever. The rule: a publishing node
  passes the full ref set it is authoritative for, and the seam deletes rows where
  `node_id = <this node> AND ref NOT IN <that set>`. **A node may retract only what it itself authored;
  it may never delete another node's row, and no deletion may ever be predicated on a timestamp** (the
  settled never-evict rule, ADR-006). A ref first authored by the control and later reported by a worker
  carries the worker's `node_id` and therefore survives a control-side delete — correct, because the
  worker's copy is the live one, and the lock covers the mid-phase case.
- **`applyDeltaFrame` collapses to a call.** Its current read-merge-republish dance exists only to feed
  the wholesale writer; with a row upsert it passes the delta rows straight through. That also retires
  its P0.3 hazard — *"one partial delta … rolls back the ENTIRE `BEGIN IMMEDIATE` txn and silently drops
  every OTHER item in the same frame"* — because there is no longer a whole-workspace transaction for one
  bad row to abort.

**Consequences.**
- The alternation ends structurally, not by tuning a cadence: two writers upserting disjoint rows cannot
  clobber each other, and same-ref contention is decided by the lock.
- A worker-authored item survives worktree cleanup for the same reason its docs already do.
- A workspace's rows can still be removed deliberately (unregistering a workspace) — but only through an
  explicitly named path, never through the publish tick. That path must be named by the story, because
  the sweep it used to ride is gone.
- `acd-work-items-single-writer` asserts NOW (green) that every `work_items` INSERT/UPDATE/DELETE lives
  in exactly one module, and ARMS at the reclassification: once `effects/stores.mjs` classifies
  `work_items` as `fact`, no `wholesaleDelete(db, "work_items"` call may exist anywhere.

---

## ADR-005: The readers migrate through a NEW cache-first seam module (`src/work-read.mjs`) that IMPORTS `work.mjs` and is never imported back; the migration is staged **chokepoint-first** via `commands/resolve.mjs` (8 dependents); the worker-side and structural readers are PINNED to disk by positive assertion; and `work-doctor` keeps ONE snapshot — **structure from disk, status overlaid from the cache**

**Status:** Accepted
**Date:** 2026-08-01

**Context.** RESEARCH's exhaustive grep replaces STATE's summary figure: **33 real call sites across 21
modules** (three files excluded as verified false positives — `catalog.mjs`, `setup-ui.mjs`,
`planning-prd.mjs`, none of which import `work.mjs`), in three categories:

- **(a) control-side, must migrate — 13 modules / 18 sites**: `commands/next:25`, `commands/find:27`,
  `commands/resolve:18,28`, `commands/list:27`, `commands/run-start:119`, `commands/mesh-heartbeat:70`,
  `commands/promote-gap-to-chore:95`, `commands/notion-associate:120`, `notion/sync-work:121`,
  `memory/local-indexing:596`, `mesh-assignment:111,177`, `mesh-assignment-reclaim:134`,
  `mesh-launcher:390` (an **injected** `listItemsFn`, default wired at `:493`).
- **(b) worker-side, must NOT migrate — 2 modules / 7 sites**: `mesh-worker-execution` ×5 and
  `global-work-store:601` (`readWorkspaceContentRecords`, "the WORKER-side content read"). A worker
  reading its own checkout is the intended behaviour.
- **(c) structural, stays on disk — 6 modules / 8 sites**: `work-reindex` ×3, `insert-shared` ×4,
  `work-upgrade:106`, `effects/table:258`, `effects/reconcile:75`, and `work-doctor:157`.

`global-work-store:539` (`readWorkspaceProjectionItems`) is dual-use and is not a "reader that must
migrate": it is how a node reads its own disk to report its own state.

The graph gives the staging order. **`commands/resolve.mjs` is imported by 8 command modules** and
imports only `work.mjs` — the single highest-leverage edit in the milestone. `mesh-launcher:390` is
already an injected seam, so it migrates by swapping a default, not by editing a call site.
`src/work.mjs` is the 37-importer god-node: m41/ADR-001 already ruled that a new capability lives
*beside* it, importing its readers, never inside it.

RESEARCH flagged **one ambiguity it could not settle**: `work-doctor.mjs:157`'s single `listItems` call
feeds SIX check-groups of two natures — structural (`structuralIntegrityGroup`, folder/orphan checks;
SPEC says doctor stays disk-based) and status-reading (`statusCoherenceGroup`,
`lifecycleCompletenessGroup`; STATE names `work-doctor` among modules that must move). Both citations
are accurate about different parts of the same snapshot. `doctorWork` builds that snapshot **once** and
hands it to pure `(snapshot, ctx) => Finding[]` groups (its own header, `:14-16`), so splitting the
snapshot's SOURCE per group would be an architecture change to doctor.

**Decision.**
- **A NEW module, `src/work-read.mjs`, is the cache-first read seam.** It exposes cache-first
  equivalents of `listItems` / `findWork` / `nextWork` / `listStream`, each returning rows stamped with
  provenance (`reportedBy`, `syncedAt`) and falling back to disk when the cache has no row for a ref.
  **The dependency direction is FIXED: `work-read.mjs` imports `work.mjs`; `work.mjs` NEVER imports
  `work-read.mjs`** — m41/ADR-001's rule reused verbatim, for the same reason: the god-node's blast
  radius must not grow, and the seam needs its readers, not the reverse.
- **Cache-first with disk fallback, not cache-only.** A control node that has never published (a fresh
  workspace, a torn store) must still answer. The fallback is an explicit, reported degrade path, not a
  silent one — and every row says which side answered it, which is the same fact DESIGN renders.
- **The migration is staged, chokepoint-first — four stages, not one big bang:**
  1. **Stage 0 — the seam exists** and is tested against a fixture, with no call site moved. Zero blast
     radius.
  2. **Stage 1 — `commands/resolve.mjs` moves.** One edit; `continue`, `doc`, `feedback`,
     `run-complete`, `run-retry`, `run-start`, `run-status`, `tasks` all migrate behind it
     (graph-cited: 8 dependents). This is the milestone's single largest behavioural change and it is
     one file.
  3. **Stage 2 — the remaining control-side leaves**, in any order, each independently revertible:
     `next`, `find`, `list`, `run-start`'s own `:119`, `mesh-heartbeat`, `promote-gap-to-chore`,
     `notion-associate`, `notion/sync-work`, `memory/local-indexing`, `mesh-assignment`,
     `mesh-assignment-reclaim`, and `mesh-launcher`'s injected default.
  4. **Stage 3 — the boundary is fitness-locked**, in BOTH directions.
- **The non-migration is asserted POSITIVELY, not merely left alone.** The worker-side reads
  (`mesh-worker-execution`, `global-work-store:601`) and the structural reads (`work-reindex`,
  `insert-shared`, `work-upgrade`, `effects/table`, `effects/reconcile`) MUST keep importing `work.mjs`'s
  disk readers. A later well-meaning "finish the migration" that moves a worker onto the control's cache
  would make a worker read someone else's opinion of its own checkout. A negative-only guard cannot
  catch that; a positive assertion can.
- **`work-doctor` keeps ONE snapshot; the snapshot BUILDER gains a status overlay.** This settles
  RESEARCH's open question and consciously departs from STATE's prose list (which named `work-doctor`
  among the modules that must move) while honouring SPEC's out-of-scope bullet (the disk is the subject
  of doctor's checks):
  - `doctorWork` still builds its snapshot **once** from disk — folder identity, frontmatter, orphans,
    folder mtime. Its pure-group architecture is untouched, which was the blocker.
  - Before the groups run, the builder **overlays cache-authoritative STATUS** onto each row, stamping
    `statusFrom: "cache" | "disk"` per row. `statusCoherenceGroup` / `lifecycleCompletenessGroup` then
    read the authoritative status without changing their source or their signature.
  - `freshnessGroup` stays **disk-only and explicitly so** — it is a folder-mtime probe with no cache
    equivalent.
  - **This is why doctor must not simply "move":** for a worker-authored item, control disk holds only
    the stale scaffold, so a naive disk-status doctor would report a false finding against every remote
    item. The overlay is what stops the migration turning doctor into noise. A genuine divergence
    between the two sides — for a ref the control itself last reported — remains a real finding, and
    `node_id` is what distinguishes the two cases.

**Consequences.**
- Eight command modules migrate in one reviewable edit; the rest are independently revertible leaves.
- `work.mjs` gains nothing; its 37-module blast radius is unchanged.
- The worker's self-read and the structural operations are protected from a future over-migration by an
  assertion that fails if they are "tidied up".
- Doctor becomes the one reader whose SUBJECT is the disk, and gains the ability to say *why* the two
  sides differ instead of asserting one of them is wrong.
- `acd-cache-read-surface-boundary` pins both directions.

---

## ADR-006: Schema **v8** adds `node_id` + `updated_at` to `work_items` by guarded idempotent `ALTER`, mirroring `work_item_docs` exactly; STORAGE names mirror the sibling tables and map to the wire's `syncedAt`/`reportedBy` in ONE mapper; the staleness predicate is the shared strict-`>` `isStale`, with exactly ONE client-side evaluator and NO threshold literal in `ui/`; **the TTL never evicts — no deletion may be predicated on time**

**Status:** Accepted
**Date:** 2026-08-01

**Context.** RESEARCH measured the schema reality: `GLOBAL_WORK_SCHEMA_VERSION = 7`;
`work_item_docs`/`work_item_runs` **already carry `node_id` + `updated_at` per row** (`:267-285`,
written by `upsertWorkItemContent`); `work_items` carries **neither** and is DELETE+INSERT. Migration is
in-place with `CREATE TABLE IF NOT EXISTS` plus **explicit, idempotent, guarded `ALTER TABLE … ADD
COLUMN`** for every column added after a table's birth (`clone_url`, `session_id`, `code`) — because
`CREATE TABLE IF NOT EXISTS` never adds a column to an existing table.

DESIGN's data ask is a hard input: every row and every artifact must carry `syncedAt` (ISO) +
`reportedBy` (node id); the list envelope must carry the configured `stalenessSeconds`; and the
predicate must **reuse** the shared `isStale` (`src/mesh-presence.mjs:398-408`, strict `>`, injected
clock, imported from `run-store.mjs`) — *"Two staleness predicates that can disagree about the same
instant is a defect, not a variant."* DESIGN also establishes a load-bearing UI fact: the badge is
computed against a **1-second cosmetic clock tick**, not against fetch time, because the board only
re-polls while something is executing — so a settled stale item would otherwise never grow its badge.
That means the predicate genuinely evaluates on **two** sides of the wire.

STATE settled that the TTL is a **staleness marker, never an evictor**: *"a TTL that evicts would
destroy the mesh's only readable copy"*.

**Decision.**
- **Schema v8.** `GLOBAL_WORK_SCHEMA_VERSION` 7 → 8; `work_items` gains `node_id` and `updated_at` via
  the established **guarded, idempotent `ALTER TABLE … ADD COLUMN`** pattern (`clone_url`/`session_id`/
  `code`), never a table rebuild. Existing rows read as NULL, which the read boundary renders as
  DESIGN's **`unknown`** state — *"a missing `syncedAt` yields 'unknown', not 'stale'"*. Backfilling a
  fabricated timestamp is forbidden: it would assert a freshness nobody observed.
- **STORAGE names mirror the sibling tables: `node_id` and `updated_at`** — NOT `synced_at`/`reported_by`.
  A reader joining `work_items`, `work_item_docs` and `work_item_runs` must not meet two column names
  for one fact. **WIRE names are DESIGN's: `syncedAt` and `reportedBy`.** The storage→wire mapping has
  **one home** — the row mapper — and is applied identically to rows and to artifacts.
- **The staleness PREDICATE has one definition per runtime boundary, and the boundary is explicit.**
  - In `src/`: the shared `isStale` (`run-store.mjs`, re-exposed as `isNodeStale`,
    `mesh-presence.mjs:398-408`), strict `>`, `now` injected. No cache-freshness code in `src/`
    hand-rolls a timestamp comparison.
  - In `ui/`: **exactly one** module evaluates freshness — DESIGN's `ui/src/board/freshness.mjs` — a
    pure, framework-free, headless module with **`now` passed in and no clock of its own** (the
    `runs.mjs` contract verbatim). It uses **strict `>`**, so both sides agree at the threshold
    instant. No other `ui/` file may compare a timestamp to `stalenessSeconds`.
  - **The THRESHOLD NUMBER is never duplicated.** It is configured once in `src/`, travels on the list
    envelope as `stalenessSeconds`, and `ui/` carries **no default and no literal**. When the wire does
    not carry it the legend degrades to words (DESIGN), never to a guessed number.
- **The TTL NEVER evicts — expressed structurally, not by convention.** No `DELETE` against
  `work_items` / `work_item_docs` / `work_item_runs` may be predicated on a time column. Combined with
  ADR-004 (`work_items` reclassified `fact`, so `wholesaleDelete` refuses it, as it already refuses the
  two content tables), the only sanctioned removal in the whole cache is ADR-004's **author retraction**,
  which is predicated on authorship and ref-set membership — never on age.
- **Both grains of staleness are on the wire, because DESIGN renders both.** The ROW's freshness comes
  from `work_items.updated_at`; each ARTIFACT's from its own `work_item_docs.updated_at` — *"a doc can be
  older than the row that names it"*. One predicate, two subjects.

**Consequences.**
- The content tables need no migration at all: their columns already exist; what the story adds there is
  read-side interpretation plus the wire fields.
- A pre-v8 row renders `unknown`, which is a designed state, not a gap.
- `acd-cache-staleness-single-predicate` asserts the shared predicate's strict-`>` property
  behaviourally, that `ui/` holds no threshold literal and at most one evaluator, and — the ratchet that
  matters most — that **no time-predicated DELETE exists** against the three cache tables.

---

## ADR-007: The streamed/requestable artifact set becomes a **bounded two-kind MANIFEST** — exact filenames plus directory+extension entries — living in a NEW pure-leaf `src/work-artifacts.mjs`; `WORK_ITEM_DOC_FILES` is DERIVED from it so the one-home invariant survives the widening; artifacts travel with a content hash so unchanged ones are never re-sent

**Status:** Accepted
**Date:** 2026-08-01

**Context.** Today the set is a four-name whitelist, `WORK_ITEM_DOC_FILES`
(`src/global-work-store.mjs:17-22`), whose own comment already states the invariant this ADR must
preserve: *"The record docs a board/CLI face may request by NAME (`work:doc`'s input contract) and
therefore exactly the doc bodies a worker streams for its active worktree — ONE home for the set … so
the streamed set and the requestable set can never drift."* SPEC widens it to `tasks/*.feature`,
`ARCHITECTURE.md`, `DESIGN.md`, `RESEARCH.md`, `STATE.md` and ADRs. Two problems follow:

1. `tasks/*.feature` is genuinely **not an exact name** — the set of feature files is open. But a free
   pattern language would break the other half of the invariant: `work:doc`'s input contract is a
   **name**, so "what can I ask for" must stay answerable.
2. Widening from 4 files to 8+ files plus every feature file, streamed per tick per item, is a real
   payload increase on a cross-machine link.

("ADRs" needs no separate entry: in this repo an ADR log is `ARCHITECTURE.md`.)

**Decision.**
- **The set becomes a MANIFEST with exactly TWO entry kinds, and no third:**
  - `{ name, file }` — an exact filename (`SPEC.md`, `STORY.md`, `VERIFICATION.md`, `RETROSPECTIVE.md`,
    `ARCHITECTURE.md`, `DESIGN.md`, `RESEARCH.md`, `STATE.md`);
  - `{ name, dir, ext }` — a **bounded** directory+extension set (`tasks/` + `.feature`).
  Two kinds keep the set enumerable, testable and bounded, and keep `work:doc` answerable: a `file`
  entry is requested by name; a `dir` entry is requested by name + member. A regex/glob language is
  REJECTED — it is exactly how the streamed set and the requestable set would drift apart.
- **The manifest moves to a NEW pure-leaf module, `src/work-artifacts.mjs` (0 imports).** Its three
  consumers — the worker's streamer, `commands/doc.mjs`, and the content reader — should not have to
  travel through `global-work-store.mjs`'s 6-module import closure to read a constant table. This is the
  same leaf-home reasoning ADR-003 applies to `executionScopeRef`.
- **`WORK_ITEM_DOC_FILES` is DERIVED from the manifest** (its `file`-kind entries) and re-exported from
  `global-work-store.mjs`, so every existing importer keeps working unchanged. One definition, one
  derived compatibility view — never two literal lists.
- **Artifacts travel with a per-artifact content hash, and an unchanged artifact is never re-sent.**
  This is a direct consequence of widening: without it, the tick's payload grows with the set. With it,
  the tick is cheap and ADR-001's hook-named change list is what usually decides the batch. It also
  makes the reconciliation backstop cheap enough to keep running forever, which STATE requires.
- **Nothing about the DOC-BODY read path changes** beyond the set: the worker still reads its own
  worktree (ADR-005 (b)), and the content still lands through `upsertWorkItemContent`, which already
  stamps provenance (ADR-006).

**Consequences.**
- `tasks/*.feature` finally rides the wire, closing `commands/tasks.mjs:15`'s *"the features live in the
  worker's worktree and are not streamed yet"*.
- The widening cannot silently desynchronise the two sets, because both derive from one manifest.
- `acd-work-artifact-set-single-home` asserts NOW (green) that the artifact-set constant is declared in
  exactly one module in `src/`, every other mention being an import or a re-export — which holds through
  the move to the leaf.

---

## ADR-008: Gate propagation advances the item branch **at the worker's reuse door**, by fast-forward when possible and a real **MERGE** otherwise — never a rebase, a force-update or a reset; a **dirty worktree or a conflicted merge is a loud coded refusal that aborts cleanly**, and no worker commit is ever discarded

**Status:** Accepted
**Date:** 2026-08-01

**Context.** m42's base-commit pin already carries a control-side edit to a worker: the dispatch stamps
the assigning checkout's HEAD (`headCommit`, `src/mesh-worktree.mjs:117-134`) and the worker builds from
exactly it, failing loudly (`assignment-base-commit-unavailable`) when the commit is unreachable after
one `git fetch origin` (`ensureCommitAvailable`, `:143-162`). The gap is exact and is stated in the
source itself (`mesh-worker-execution.mjs:2369-2375`): *"The reuse doors ignore it by design: an
existing line continues from where it is."* The pin check is gated
`baseBranch == null && !branchExists && directive.commit != null` (`:2376`), so a **continuing** item —
which by definition takes the reuse door — never sees the control's edit.

The word "fast-forward" in SPEC/STATE needs an honest reading before it can be built. The item branch
`aof/mesh/<ref>` (`meshItemBranchName`, `mesh-worktree.mjs:112`) was cut from an earlier control HEAD
and carries the worker's commits; the control's new HEAD carries the gate edit. In git's terms the two
are **diverged**, not "behind" — so a strict fast-forward-only rule would deliver the propagation only
in the rare case where the worker committed nothing, and refuse the common one. A refuse-on-divergence
rule would block nearly every continue.

The one thing that must never happen is the one thing every convenient mechanism does: `rebase` rewrites
the worker's history, `push --force` / `reset --hard` / `checkout -B` discard it. Measured at HEAD, none
of these exists anywhere in `src/`: the only force is `git worktree remove --force` (removing a
worktree, not a branch), the only `reset` is a path-scoped `git reset -q -- .aof`, and the only push is a
plain `git push origin <branch>` (`mesh-worker-execution.mjs:583`). That clean baseline is worth locking.

**Decision.**
- **The advance happens WORKER-SIDE, at the reuse door**, immediately after `reuseWorktreeOnBranch`
  materialises the worktree and before the agent starts — `mesh-worker-execution.mjs:2388-2390`. Reasons:
  the worker owns the checkout and the branch; directive 4 rules out a control→worker pull; the pin
  already travels on the directive, so no new wire field is needed; and `ensureCommitAvailable` already
  exists to make the commit present in the worker's clone. This story **flips the existing pin gate on
  for the reuse door** rather than inventing a second propagation path.
- **The mechanism is fast-forward-if-possible, MERGE otherwise — and merge means a real merge commit.**
  - `directive.commit` already an ancestor of the branch ⇒ **no-op**, reported `already-current`.
  - the branch strictly behind ⇒ **`--ff-only`**; nothing is created, nothing is lost.
  - diverged ⇒ a **real merge of the pinned base INTO the item branch**. Every worker commit is
    preserved by construction; the gate edit arrives; the history stays honest about both.
- **The forbidden operations are named, and forbidden absolutely on this path:** `rebase`,
  `push --force` / `--force-with-lease`, `reset --hard`, `checkout -B`, `branch -f`, and any
  `update-ref` against `refs/heads/*`. Every one of them can discard a worker commit. There is no
  `--force` escape hatch on this path — a flag that permits history loss will eventually be passed.
- **Two preconditions, each a loud coded refusal that leaves the tree untouched:**
  - **`assignment-gate-propagation-dirty-worktree`** — the advance runs only against a clean tree. Never
    check out or merge over uncommitted work.
  - **`assignment-gate-propagation-conflict`** — a merge that conflicts is **`git merge --abort`**ed and
    the dispatch fails with this code. Handing an agent a half-merged, conflicted tree is strictly worse
    than not propagating: it would begin a phase on a state no human authored.
  Both settle the assignment `failed` with the code, exactly as `assignment-base-commit-unavailable`
  already does (`:2379-2385`), so the operator sees the cause on the fleet rather than an agent
  reasoning from a wrong base.
- **The advance is REPORTED on the existing log channel**, beside the `worker-worktree-base` line
  (`:2396-2401`) that already records which base a worktree was built from — with the outcome
  (`already-current` / `fast-forwarded` / `merged` / refused-with-code) and the two commits. "Which base
  did it actually run on" stays one `aof mesh logs --node` read.
- **This is safe precisely because it runs at a gate.** STATE's settled rule — control-side changes are
  allowed only when no assignment is active — is what makes the tree quiescent at the moment of the
  advance. The two decisions are one mechanism: the lock creates the quiet window; the advance uses it.

**Consequences.**
- A control-side gate edit reaches a continuing item, with no branch switch on the control node and no
  pull into a live tree.
- No mechanism on this path can discard a worker commit; the two ways it can fail both leave the tree
  exactly as it was and say so with a code.
- `acd-gate-propagation-never-discards` asserts NOW (green) that the worktree/worker/recovery-push path
  contains no history-rewriting or force git operation, and arms as an outright ban the moment the
  advance lands.

---

## ADR-009: The milestone partitions into **FIVE stories** — the PO's five candidates stand, with ONE correction: `cache-read-surface` **splits in two** along the authority cut vs. the reader migration, and `staleness-and-resync` absorbs the schema column it depends on. Build order: `item-lock` ∥ `cache-authority` first; `artifact-sync`, `cache-readers`, `staleness`, `gate-propagation` follow

**Status:** Accepted
**Date:** 2026-08-01

**Context.** SPEC proposed five stories. Judged against the graph and the per-module migration list, four
are well-cut and one is not: **`43_story_cache-read-surface` bundles two different jobs with different
blast radii and different risk** — (i) the WRITE-side authority cut (stop the wholesale rebuild, add the
shared upsert seam, reclassify the table: `global-work-store.mjs` + `control-stream-server.mjs` +
`effects/stores.mjs`, ~3 modules, high risk, everything else depends on it) and (ii) the READ-side
migration (18 call sites across 13 modules, low risk each, wide, mechanical). Keeping them together
makes the milestone's critical path as long as its widest mechanical sweep, and makes the risky write
change unreviewable inside a 13-module diff.

The graph also shows why the other four boundaries are right:

- `item-lock` owns `assignment-record.mjs` (imports 0) + `effects/run-transitions.mjs` (imports 5) + a
  new near-leaf. It touches **no** module the cache stories touch.
- `artifact-sync-on-write` owns a bundle asset, a settings merge writer, `adapters.mjs`, and the
  launcher's drain — it shares only `work-artifacts.mjs` (a new leaf) with the cache work.
- `gate-propagation` owns `mesh-worktree.mjs` + one block in `mesh-worker-execution.mjs` — disjoint from
  every other story's files.
- `staleness-and-resync` owns the v8 migration, the wire envelope, and `ui/` — its only upstream need is
  the provenance columns, which is why it must **own** them rather than inherit them.

**Decision — six stories** (the main session scaffolds the folders; this ADR is the rationale they cite):

- **`43_story_item-lock`** — an assignment exclusively owns its item at execution scope; second
  assignment, local run mint and control-side mutation all refused, coded and loud, until the next gate.
  Owns `executionScopeRef`'s move into `assignment-record.mjs`, the scope-aware read, the new lock
  predicate module, the guard inside `transitionRunStart`, and `work next`'s skip-and-report. ADR-003.
- **`43_story_cache-authority`** *(new — the first half of the PO's `cache-read-surface`)* — `work_items`
  stops being rebuilt from control disk and becomes an upserted, provenance-stamped fact behind ONE
  shared seam both the control and workers write through, with author-retraction deletion. Owns
  `global-work-store.mjs`'s publish path, `control-stream-server.mjs`'s `applyDeltaFrame`, and the
  `effects/stores.mjs` reclassification. ADR-004.
- **`43_story_artifact-sync-on-write`** — the `PostToolUse` hook, the derivation-free enqueue, the
  settings **merge** (never wholesale), the widened artifact manifest, and the daemon-side batched drain
  on the existing tick. ADR-001, ADR-002, ADR-007.
- **`43_story_cache-read-surface`** *(narrowed — the second half)* — the cache-first read seam and the
  staged reader migration, chokepoint-first through `commands/resolve.mjs`, with the worker-side and
  structural readers pinned, and doctor's status overlay. ADR-005.
- **`43_story_staleness-and-resync`** — schema v8's provenance columns, the shared predicate, the wire
  envelope (`syncedAt` / `reportedBy` / `stalenessSeconds`), the never-evict rule, and the board's stale
  badge + Resync action per DESIGN. ADR-006.
- **`43_story_gate-propagation`** — the dispatch advances an existing item branch to the pinned base
  commit at the reuse door, never discarding a worker commit. ADR-008.

**Build order and independence.**
- **Wave 1 (parallel, no shared file):** `item-lock` ∥ `cache-authority`. These are the two risk-carrying
  cores and they touch disjoint modules.
- **Wave 2 (parallel):** `artifact-sync-on-write` ∥ `staleness-and-resync` ∥ `gate-propagation`. Each
  depends on wave 1 (sync and staleness on the upsert seam; gate-propagation on the lock's quiescence
  guarantee) and on none of its wave-2 siblings.
- **Wave 3:** `cache-read-surface` — last on purpose. It is the widest, most mechanical change, and it is
  only *correct* once the cache is actually authoritative and provenance-stamped; migrating readers onto
  a cache still being clobbered by the control tick would ship a regression.

**Consequences.**
- The critical path is the two small, risky cores rather than the 13-module sweep.
- Five of the six stories can be reviewed as a single-subject diff.
- The one genuinely cross-cutting artefact — the shared upsert seam — is owned by exactly one story
  (`cache-authority`) and consumed by three, which is the shape that keeps the consumers independent of
  each other.

---

## ADR-010: Refine-time reconciliation — the Three Amigos' rulings on ADR-001..009

**Status:** Accepted
**Date:** 2026-08-01

**Context.** Six QA amigos authored the task contracts against ADR-001..009 and surfaced two apparent
defects plus a set of ambiguities. ADRs are immutable, so the rulings land here, in m41/ADR-006's
"refine-time reconciliation" form. **Every claim below was re-verified at source before ruling** — two
were citation drift in MY OWN doc, one QA claim is **wrong** and is corrected with a measurement, and
one ruling **changes the story partition**. Each ruling is labelled **SUPERSEDES** (a prior decision
genuinely changes), **PINS** (an indicative shape is fixed), or **CLARIFIES** (the decision was already
implied but not stated — said honestly, not retrofitted as "always stated").

### D1 — SUPERSEDES ADR-004's "outside a lock, last-write-wins by `syncedAt`". QA is right: that clause reintroduces the exact permanent-revert the milestone exists to cure

**The defect, confirmed.** After settle the assignment is terminal, so no lock covers the ref. The
control's automatic tick then upserts that ref from its own stale disk with a *fresher* `syncedAt` and
wins — the item reverts to its pre-run scaffold. That is verbatim the disease in SPEC's own table. And
it contradicts ADR-004's own reasoning three paragraphs earlier ("contention is resolved by the ADR-003
lock, **not by a timestamp race**"): a timestamp records when a node last *looked*, never whether its
content is current.

**Ruling — authority is by AUTHORSHIP and by DOOR, never by timestamp. `syncedAt` is provenance for
display and staleness ONLY; it is never a tiebreaker for authority.**

- **An AUTOMATIC tick is authoritative only over rows it authored.** It upserts a row when
  `node_id IS NULL` (never reported — first reporter takes authorship) or `node_id = <this node>`. For a
  row another node authored it **skips and counts** (D1a below). No timestamp is consulted.
- **An OPERATOR-INITIATED write is a different door and TAKES authorship** — it sets
  `node_id = <this node>` and `updated_at = now`, becoming the row's new author. It is refused while the
  scope is locked (ADR-003) and allowed at a gate, which is STATE's settled rule reaching its natural
  conclusion: **a gate is where authorship legitimately changes hands.**
- **Author retraction gets the same split.** ADR-004's retraction predicate
  (`node_id = <me> AND ref NOT IN <set>`) stands for the automatic tick. An **operator-initiated delete**
  is an operator door: it may retract the ref regardless of `node_id`, and is refused while locked. Without
  this an operator could not delete an item a worker had ever reported.
- **Worked example, the one that matters:** control scaffolds `44` (author = control) → worker is
  assigned and streams (holder, so allowed; author becomes worker) → **after settle the control's tick
  sees `node_id = worker` and skips forever.** The worker's copy survives permanently. That is the cure.
- **Retraction does NOT cascade to artifact bodies.** A retracted row's `work_item_docs`/`work_item_runs`
  rows are left in place: orphaned bodies are invisible (nothing lists them) and harmless, whereas a
  cascade would be the one path by which a delete on one node destroys content authored on another.
  They are reclaimed only by an explicit workspace-unregister.

**D1a — CLARIFIES / PINS (S1.5).** `publishWorkspaceSnapshot` already returns `skipped:
items.errors.length` (verified, `global-work-store.mjs:~500`) — a **projection-error** count. The
held/foreign-row skip counter is **additive and distinctly named — `heldSkipped`** — and is never summed
into `skipped`. Two different facts must not share a counter.

### D2 — SUPERSEDES ADR-009's placement of schema v8. QA is right: ADR-004's retraction predicate reads a column that does not exist until the story that lands two waves later

**The defect, confirmed.** `work_items.node_id` arrives with schema v8, which ADR-006 puts in the
staleness story and ADR-009 schedules in wave 2 — *after* the cache-authority story in wave 1 that needs
it. Not an observability gap: the predicate has no column to read.

**Ruling — the schema SPLITS along the write/read seam, and the wave order does NOT change.**

- **`43/02 cache-authority` carries the schema v8 migration** (the guarded, idempotent
  `ALTER TABLE work_items ADD COLUMN node_id / updated_at`, `GLOBAL_WORK_SCHEMA_VERSION` 7 → 8) **and the
  write-side stamping** — because the columns are the *shape its own upsert seam produces*. A story that
  cannot write the column it depends on is not a story.
- **`43/04 staleness-and-resync` keeps everything read-side**: the storage→wire mapper
  (`node_id`/`updated_at` → `reportedBy`/`syncedAt`), the shared strict-`>` predicate, the envelope's
  `stalenessSeconds`, the never-evict enforcement, the Resync door, and the whole UI.
- **No wave changes**; the `04 → 02` dependency edge already existed and is now load-bearing rather than
  incidental. ADR-006's column names, `ALTER` pattern and NULL-renders-`unknown` rule are unchanged — only
  the OWNING story moves.

### Story 01 — `item-lock` (ADR-003)

**R1.1 — SUPERSEDES ADR-003's "ONE code for every door". QA's pin is adopted.** Verified: the exact-ref
duplicate-assign gate already refuses **`assignment-already-active`** (`src/mesh-assignment.mjs:122`),
it is mapped to HTTP 409 (`src/mesh-ui-serve.mjs:775`), and m38's
`04_story_ui-driven-assignment/tasks/01_assign-gates-hold-on-ui-path.feature` asserts it twice. The two
codes answer different questions — *"this exact item already has an assignment"* vs *"this item's
execution SCOPE is held"* — and the first is a pinned wire contract with an HTTP mapping and an existing
feature. Breaking it to satisfy a tidiness rule would be a gratuitous cross-milestone change.
**Exact-ref duplicate keeps `assignment-already-active`; every refusal the NEW scope predicate produces
carries `item-locked-by-assignment`. The m38 feature needs NO amendment.**

**R1.2 — CORRECTION to ADR-003's own citation.** ADR-003 says `findActiveAssignment` keeps its semantics
"for its 6 importers". Measured: **6 is `assignment-record.mjs`'s module-import count; the FUNCTION has
exactly ONE caller in `src/`** — `mesh-assignment.mjs:122`. The decision is unchanged (the primitive is
not altered); the number was wrong. Same class of drift this refine already flagged in SPEC/STATE, now
found in my own doc.

**R1.3 — PINS how workspace identity reaches the guard.** Verified: `run-retry.mjs:65` and both worker
sites (`mesh-worker-execution.mjs:2458,2954`) pass no `opts.workspace` **deliberately**, each with a
comment saying so; only `run-start`'s two sites pass `seamOpts`.

- **The holder admission needs no lookup at all.** Both worker mint sites already carry
  `brief.assignmentId` + `brief.itemRef` (verified at both call sites). The guard admits the holder on
  **assignment identity supplied as data** — the `startRun(item, { node })` precedent
  (`acd-assignment-run-store-mesh-blind`) applied to the lock.
- **The scope LOOKUP takes a NEW, distinctly-named opt: `opts.lock = { workspaceId, byAssignment }` —
  deliberately NOT `opts.workspace`.** Reusing `opts.workspace` would set the event payload's
  `workspaceRoot` and flip `run-retry` into publishing as a side effect. Behaviour stays byte-unchanged.
- **`workspaceId` is supplied by the CALLER from its already-resolved workspace** — the same
  `resolveItem(workspace)` path `mesh-assignment.mjs:121` uses. It is **never derived from `item.dir`**
  (TECH_DEBT item 4: cwd-derived identity is what silently discarded 100% of the frames for days).
- **A missing `opts.lock` where mesh IS configured FAILS LOUD (`item-lock-context-missing`), never
  silently skips.** This is the m42 lesson stated as a rule: "three of the four mint sites silently had
  none" is exactly what an absent-means-skip default reproduces.

**R1.4 — RULES the question ADR-003 was silent on: the lock FAILS CLOSED, with a distinct code, scoped
to mesh-configured workspaces.** Three cases, and they are not the same case:

- **Mesh not configured for the workspace / no global store** — there is no assignment and there cannot
  be one. **Mint freely.** This is not "fail open"; it is the correct answer. `meshGlobalPropagationDecision`
  (`global-work-publisher.mjs`) already computes this predicate and is the door.
- **Store present and readable** — the predicate answers. Normal path.
- **Store configured but unopenable / torn** — we cannot rule out a holder. **REFUSE, with the DISTINCT
  code `item-lock-undeterminable`** (never `item-locked-by-assignment`: the operator's remedy is to repair
  or remove the store, not to wait for a holder), and the message names the remedy.

**Why closed, not open.** The milestone's entire premise is that two writers on one item is the disease;
an unreadable store is precisely the condition under which that cannot be ruled out. A refusal is loud,
coded, remediable and destroys nothing. A fail-open silently permits the double-write the milestone
exists to prevent, and its damage surfaces days later — TECH_DEBT items 2 and 3's pattern verbatim. The
wedge risk QA rightly raises is bounded by the first case: a non-mesh workspace can never be wedged by a
mesh store's corruption.

**R1.5 — PINS `work next`'s envelope (S1.6).** Verified: today's states are `done` / `blocked` / the ready
shape. Additive: **`skipped: [{ ref, scopeRef, holderNode, assignmentId, state }]`** — the same five facts
as the refusal payload, so one vocabulary — plus a NEW state **`held`** for "everything actionable is held
elsewhere", explicitly **not** `done` (reporting `done` for work someone else is doing is the same lie
class the board already paid for). The renderer gains one line for `held`.

### Story 03 — `artifact-sync-on-write` (ADR-001/002/007)

**R3.A — SUPERSEDES ADR-002's "read (absent/torn ⇒ `{}`)". QA is right, and this is the sharpest catch of
the set.** `mergeLock`'s absent-or-torn-reads-as-`{}` is safe **only because the lock is aof-owned**. For
a co-authored file with ~140 possible top-level keys, one missing brace in the operator's own file would
be answered by **replacing it with a three-line aof-only document** — the exact defect ADR-002 exists to
close, arriving through ADR-002's own fallback.

- **ABSENT ⇒ `{}`** (a genuine fresh install) — unchanged.
- **TORN ⇒ a coded refuse-and-report, `claude-settings-unparseable`, writing NOTHING.** The operator is
  told which file failed to parse. A file we cannot read is a file whose contents we cannot claim to
  preserve, and preserving them is the whole point.

**R3.B — CLARIFIES (deleted artifact).** Never-evict applies to artifact bodies as it does to rows: **the
last streamed body keeps answering and its stamp stops moving**, so it ages into `stale` naturally and the
provenance line tells the truth. QA's contract confirmed. (Retraction is row-scoped and does not cascade
— D1 above.)

**R3.C — PINS ownership of the widened READ.** QA's choice confirmed: **43/03 owns the widened set
end-to-end for the EXISTING streamed-doc fallback** (the `work:doc` `fromWorker` path already exists and is
simply widened by the manifest). **43/06 owns only the cache-first migration** of `resolve.mjs` and its
leaves. The two are different mechanisms and must not be conflated.

**R3.D — PINS the dir-kind request surface.** Verified: `work:doc`'s input is `{ ref, doc }` with no member
field. **The `dir` kind is requested through `work:doc` with an ADDITIVE optional `member`** — e.g.
`{ ref, doc: "TASKS", member: "01_foo.feature" }`. Rejected: a separate `aof work tasks <ref> <member>`
door, because ADR-007's one-home invariant is defined against *`work:doc`'s by-name input contract*
(the constant's own comment), and putting half the artifact set behind a different verb breaks exactly
the invariant the manifest preserves. `work:tasks` stays what it is — a parsed-scenarios view — and gains
its cache fallback in 43/06 (R6.4).

**R3.E — PINS the ownership marker's shape, and its hand-edit rule.** **A marker KEY on the entry object**,
not a sentinel argv element — argv is content an operator may legitimately edit, and a marker hidden there
is brittle. **Verified schema-legal:** every one of the five hook variants in the installed
`claude-code-settings.schema.json` leaves `additionalProperties` **undefined**, so an extra key on a hook
entry is permitted rather than a validation error. **A hand-edited marked entry is DRIFT-WARNED, never
silently restored to canonical** — restoring it would be the wholesale-overwrite reflex at entry
granularity, and the operator marked their intent by editing it.

### Story 04 — `staleness-and-resync` (ADR-006 + DESIGN)

**R4.1 — PINS the `stalenessSeconds` carrier: the HTTP FACE, not the command result.** Verified:
`work:list`'s `run` returns a bare row array and `board-ui.mjs:44-56` does `sendJson(response, 200, rows)`.
**`/api/work/list` responds with an envelope (`{ items, stalenessSeconds }`); the `work:list` command
result and its `--json` flat array stay byte-identical.** This is `validate.mjs`'s own documented
discipline ("Path display is a FACE adapter … the command result stays the richer envelope") applied in
the other direction: **the wire envelope is a face concern.** Per-row `syncedAt`/`reportedBy` ride the
ROWS (additive fields, the way `fromWorker`/`reportedBy` already arrived at
`board-worker-stream.mjs:140`), so both faces get provenance and neither contract breaks.

**R4.2 — PINS the Resync door, which DESIGN specifies exhaustively and names nowhere.** A command
**`work:resync`** plus **`POST /api/work/resync`**; the mechanism is the existing directive/control-stream
channel — the control asks the OWNING node (the row's `node_id`) to push a fresh delta + content frame.
Codes, matching DESIGN's four outcomes: **`resync-no-owner`** (no `node_id` recorded — DESIGN's
"refused", `destructive`), **`resync-owner-not-connected`** / **`resync-owner-unreachable`** (DESIGN's
"unreachable", `muted`), and a timeout that renders DESIGN's "no answer". It belongs to **43/04**.

**R4.3 — CLARIFIES the acknowledgement referent, and adds the mechanism DESIGN's watch window needs.**
Verified: `Board.tsx:183-188` arms a poll only while something executes — so on a settled stale item, the
case Resync exists for, no poll ever happens.

- **The one-poll-interval decay is a TIMER, not an event**: it is measured against the poll-interval
  constant, not against a poll having occurred. DESIGN's "never a moment in which the surface says
  nothing" holds with no polling at all.
- **A Resync in flight ARMS a bounded poll** (the existing `load({ silent: true })` at the same interval)
  for the duration of the watch window, then disarms. Without this, "no answer" would be structurally
  guaranteed rather than measured — the surface would be lying by construction.

**R4.4 — CONFIRMS the 1s cosmetic tick is in scope for 43/04.** Verified: it exists only inside
`DetailPanel`'s runs section and `Fleet.tsx:72`, not at the item-surface level the lane/overview/header
badges need. Lifting it a level is real work and it is **required**, not optional: DESIGN's load-bearing
decision is that the badge appears within one second of the crossing **with no network activity**.

**R4.5 — CONFIRMS the board headless mount harness is a named deliverable of 43/04.** Verified:
`test/support/fleet-app-harness.mjs` exists and has **no board sibling**. It is a real build cost and is
recorded here so it is planned rather than discovered mid-build.

### Story 05 — `gate-propagation` (ADR-008)

**R5.1 — CONFIRMS the behaviour change, with the framing corrected: it removes an INCONSISTENCY rather
than adding a refusal.** Verified at `mesh-worker-execution.mjs:2376`: the pin gate is
`baseBranch == null && !branchExists && directive.commit != null`, so a **refine already refuses**
`assignment-base-commit-unavailable` on an unreachable pin — only the reuse door (continue/verify/
autonomous) silently proceeds. After this story both doors behave identically. The operational
consequence QA names is real and accepted: a control checkout with unpushed commits blocks a continue —
but it *already* blocks a refine, so the control node must already push before dispatching. **The refusal
message must name the cure** ("push the control checkout, then re-dispatch"), because a coded failure
whose remedy is unstated is how TECH_DEBT item 2 reads.

**R5.2 — AGREES, and makes it a REQUIREMENT.** The branch advance must be an **exported, directly
callable function in `src/mesh-worktree.mjs`** — indicatively `advanceBranchToBase(worktreePath, commit,
options)` with the module's existing injected `exec` seam — never inlined at the dispatch call site. Two
independent reasons, and QA supplies the second: (a) ADR-008's codebase-health requirement already puts
the logic in `mesh-worktree.mjs` so the 3,174-line god-file gains a call site, not a block (TECH_DEBT item
10); (b) the dispatch path always materialises a *fresh* worktree, so the **dirty-tree scenario is only
exercisable against a directly-callable function**. An untestable safety rule is not a safety rule.

### Story 06 — `cache-read-surface` (ADR-005)

**R6.1 — RULES the false-finding class ADR-005 did not settle, and CHANGES a dependency edge.** Verified:
`missing-verification`, `missing-retrospective` and `milestone-no-stories` all live in
`work-doctor-coherence.mjs` and read `status × item.docs[…] × children`. ADR-005's overlay makes **status**
cache-authoritative while docs and children stay disk-derived — so a worker-authored milestone reported
`done` would fire all three against every remote milestone. QA is right, and it is the same noise the
overlay exists to prevent, one group over.

- **REJECTED: gating those findings on `statusFrom === "disk"`.** It would permanently exempt remote items
  from lifecycle checks — doctor goes blind on exactly the items the mesh cares about.
- **ADOPTED: the overlay is PER-FACT.** Status, the doc map and the children set are each overlaid from
  the cache when it can answer (43/03 streams precisely these artifacts) and each degrades to disk
  independently, recording its source.
- **And the degrade must be visible, not silent: when status is cache-authoritative but the doc/children
  facts had to fall back to disk, the three lifecycle findings for that item are SUPPRESSED and replaced
  by ONE `cache-incomplete` finding** naming the reporting node. One honest finding instead of three false
  ones — and it says what is actually wrong.
- **PARTITION CHANGE: `43/06` now depends on `43/03`** (previously on `02` and `04` only), because the
  per-fact overlay needs the widened artifact set. Wave 3 already follows wave 2, so **the build order is
  unchanged**; only the edge is newly explicit.

**R6.2 — CONFIRMS QA's message contract.** Verified: `Finding = { code, severity, path, message }`
(`work-doctor.mjs:12`) with no room for structured provenance. **Every divergence / `cache-incomplete`
finding must NAME the reporting node in its `message`** — that is the only black-box channel doctor has,
and `statusFrom` is an internal snapshot field, never an observable.

**R6.3 — CORRECTS ADR-005's classification. QA is right; `promote-gap-to-chore` moves from (a) to (c).**
Verified: its `listItems` call is inside `defaultAt(workDir)` (`:94-96`), which counts top-level items to
choose the insert position for a folder it then creates on disk through the m41 reindex engine. That is a
**structural-placement read**; a cache-derived count would land the insert past the end of the real
stream, leaving a numbering gap. My (a)-list inherited this from STATE's prose without re-deriving it.
**Corrected counts: control-side (a) = 12 modules / 17 sites; structural (c) = 7 modules / 9 sites.** It
is now PINNED positively in `acd-cache-read-surface-boundary` alongside the other structural readers.

**R6.4 — PINS the reach-through rules, including the named regression.** A cache-answered row describes a
folder that is not on this node.

- **A cache-answered row carries `dir: null` — never a fabricated path** — plus `reportedBy`.
- **READ doors answer from the cache where they can, and where they cannot they return the honest
  absent-with-provenance shape — never an unmarked empty.** Specifically, **`work:tasks`'s `fromWorker`
  marker MUST survive a successful cache resolve.** Verified as a real regression: today the marker is set
  only on the `!item` branch (`tasks.mjs:34-40`); once `resolve` succeeds from the cache the `readdir`
  ENOENTs into `{ ref, tasks: [] }` with no marker — a silent empty list dressed as a pass. The marker
  moves from meaning "resolve missed" to meaning "the answer did not come from this node's disk".
- **WRITE doors (`feedback`, `run-start`) REFUSE, coded (`item-not-local`), and write nothing. They do NOT
  scaffold on demand.** Scaffolding would create a second authority for content another node owns — the
  disease itself — race the lock, and reproduce exactly how the control's stale disk became authoritative
  in the first place. The sanctioned path for a control-side change is the gate plus ADR-008's propagation.
- **`memory/local-indexing:596` and `notion/sync-work:121` need real files: they SKIP non-local rows and
  report the skip count.** Never crash; never index an empty body as though it were the item.

**R6.5 — ACCEPTS QA's finding and assigns it.** Verified: `mesh-logs.mjs:18` `KNOWN_PROCS = ["mesh-serve",
"mesh-ui"]`, so the `degrade` sink `reportDegrade` writes to has **no reader** — ADR-005's explicit-degrade
requirement is unobservable to an operator. **`degrade` is admitted to `KNOWN_PROCS` as part of 43/06**, the
story that creates the degrade path. One line, and without it the requirement is decorative.

### The out-of-milestone reports

**QA's scoped-validate defect is WRONG — measured, not argued.** The claim was that `aof work validate
<ref>` never reaches task features. `checkFeatureTags` sits *after* the `if (!inScope(item)) continue;`
guard inside the same loop (`work.mjs:720`, `:786-790`), and `inScope` for a numeric ref matches
`item.parent ?? item.number`, so a milestone's nested stories ARE in scope. Measured against a scratch
stream with a bogus-tag feature: **scope `undefined`, `01`, `01/01` and `demo` each returned the identical
2 tag findings.** No hole.

**But an adjacent REAL hazard was found while checking it, and it is routed:** an **unresolved** scope
returns zero findings and renders `PASS — 99 is well-formed.` Measured against this repo's own stream:
`validate 99`, `validate 43/07` and `validate nonexistent-slug` all report 0 findings. Scope-as-filter is
deliberate (`validate.mjs`'s header says so), but rendering a typo'd or not-yet-scaffolded ref as PASS is a
silent green. **Routed to `wiki/work/TECH_DEBT.md` item 11.** Not fixed here.

**`src/effects/stores.mjs:27`'s doc drift is confirmed and routed as feedback, not debt.** The comment
claims `work:doctor --explain` "renders a store's class beside its cascade"; verified, `work-doctor*.mjs`
has no `--explain` handling at all and `TABLE_CLASSIFICATION` is imported only by `stores.mjs` itself and
one arch-test. A comment describing a consumer that does not exist is exactly TECH_DEBT item 0's fourth
shape ("history kept in comments rather than in the design") — but it is a comment, not accrued structural
cost, so it is feedback rather than a debt item.

**Consequences.**
- Two genuine defects in ADR-004 and ADR-009 are closed before any code is written.
- Three of my own citations are corrected (`findActiveAssignment`'s caller count, `promote-gap-to-chore`'s
  classification, and the (a)/(c) counts that follow from it).
- One QA claim is refuted with a measurement rather than deferred.
- The partition gains one explicit dependency edge (`43/06 → 43/03`) and one story-scope move (schema v8
  to `43/02`); **the six stories, their slugs and the three-wave build order are unchanged.**
- `acd-cache-read-surface-boundary` and `acd-item-lock-single-door` are amended to match R6.3 and R1.1.

---

## ADR-011: Build-time reconciliation for story 01 — the automatic-vs-operator split is a property of the **caller**, so it is decided at the **disk-derived publish path**, never inside the shared row-writer; the assign door's gate ORDER is ruled; and ADR-009's "wave 1 touches disjoint modules" is corrected

**Status:** Accepted
**Date:** 2026-08-02

**Context.** Structural review of `43/01`'s build (uncommitted at review time) found the implementation
conformant on seven of eight ACs, and found that ADR-003 under-decided two things and mis-stated one.
Each is ruled below in ADR-010's form — **SUPERSEDES** / **PINS** / **CLARIFIES** — and each was
verified at source, not inferred.

### A1 — CLARIFIES what ADR-003 meant by "the control's publish", and SUPERSEDES the implicit assumption that it is a distinct caller. **The held-scope carry belongs to the DISK-DERIVED publish path, not to `publishWorkspaceSnapshot`.**

**The measurement.** `publishWorkspaceSnapshot` (`src/global-work-store.mjs:442`) is not the tick. It is
the **shared row-writer with three callers**: `publishGlobalWorkSnapshot` (`global-work-publisher.mjs:95`
— the control's periodic tick *and* publish-on-mutate), `applySnapshotFrame`
(`control-stream-server.mjs:145`) and `applyDeltaFrame` (`control-stream-server.mjs:195`). The last two
are the **worker's** authored write path into the control's cache.

A held-scope skip placed inside that shared writer therefore fires for the worker's own frames. Measured
end-to-end against the build under review: with an ACTIVE assignment for `42`, `applyDeltaFrame` reporting
`42 → in-progress` returned `{ heldSkipped: 1, heldRefs: ["42"] }` and the row read back **`not-started`** —
the worker's authored delta silently discarded, for the whole duration of the phase, by the mechanism meant
to protect it. That is ADR-004/D1's cure inverted, and it is worse than the disease it replaces (the
pre-lock alternation at least let the worker's row win some ticks).

**Ruling.**
- **The discriminator is not "automatic vs operator". It is "whose slice is being written".** A node
  publishing **its own disk-derived slice** may be made to step over scopes it does not hold; a writer
  applying **another node's reported slice** is the holder's own voice and may never be filtered by the
  lock. ADR-003's operator-vs-automatic split still stands for the two *renderings of a refusal*; it was
  never a licence to filter a foreign node's authored rows.
- **The carry therefore lives on the disk-derived path** — `publishGlobalWorkSnapshot`, or gated inside
  `publishWorkspaceSnapshot` by an explicit option that only that path sets. An `apply*Frame` caller,
  which supplies `options.items` from a frame, must be byte-unaffected. `heldSkipped` / `heldRefs` stay
  where ADR-010/D1a put them, on the publish result.
- **The read must be inside the transaction.** The held-scope lookup and the carry `SELECT` run before
  `BEGIN IMMEDIATE` in the build under review, so a frame committing in that window is read stale and then
  re-written over. Both reads move inside the transaction.
- **This is a regression the story OWES a test for**, because this story introduced the hazard: an active
  assignment plus a worker frame for the held ref, asserting the worker's row lands. Placement scenarios
  do not catch it; only a behavioural one does.
- **ARMED for `43/02`:** once the upsert seam lands, `acd-item-lock-single-door` gains the clause
  *"`src/global-work-store.mjs`'s publish path reads no `global_assignments` state"* — under ADR-004/D1
  authority is a `node_id` **column on the row**, so the shared writer never needs the assignment table at
  all, and the carry disappears rather than moving. It is not committed now because it would be red today.

### A2 — PINS the assign door's gate ORDER, which ADR-003 left undecided

`assignWork` now has five gates. ADR-003 named the lock without ordering it, and the story's task 02 pins
only `ref-not-found` first (its rows 3 and 4 deliberately target an *unheld* milestone, so they constrain
nothing about the lock's position). The build placed the scope lock **last**, behind
`assignment-target-unknown` and `assignment-repo-unavailable`, and justified it by the m38 tests. The
tests are evidence, not a rationale; here is the rationale, so the next gate has somewhere to be placed:

- **Request-validity gates precede item-state gates.** "This ref does not resolve", "this node is not
  registered", "this node does not hold the repo" say *your command is wrong*. The lock says *your command
  is right, and refused for now*. Telling an operator to wait for a holder when their target was a typo
  sends them to the wrong remedy.
- **Among item-state gates, the more SPECIFIC answer wins.** The exact-ref duplicate
  (`assignment-already-active`) precedes the scope lock (`item-locked-by-assignment`) for the same reason
  ADR-010/R1.1 keeps both codes: "this exact item is already assigned" is strictly more informative than
  "something in its scope is".

**Order, pinned:** `ref-not-found` → `assignment-target-unknown` → `assignment-repo-unavailable` →
`assignment-already-active` → `item-locked-by-assignment`. The build conforms.

### A3 — CORRECTS ADR-009's "wave 1 (parallel, no shared file)". It is no longer true, and the hand-off must be explicit

ADR-009 asserted `item-lock` ∥ `cache-authority` "touch disjoint modules", and ADR-003's own consequence
list assumed the same. **AC7's automatic half lands in `src/global-work-store.mjs`, which ADR-009 assigns
to `43/02`.** The two stories share one function. The wave order does not change and the parallelism is
still worth having — the overlap is one block in one function — but it must be *named*, not discovered at
merge:

- `43/02` **REPLACES** this block; it does not extend it. The wholesale delete-and-rebuild goes away, and
  with it the read-carry-reinsert dance, which exists only because the rebuild exists.
- `43/02` inherits `43/01`'s task-05 scenarios as its own acceptance contract (task 05's FEASIBILITY note
  already says so) and must keep `heldSkipped`/`heldRefs` on the result.
- Whoever lands second rebases this function rather than merging it.

**Consequences.**
- The worker's authored rows are protected by the same decision that protects the holder's item, instead of
  being destroyed by it.
- The assign door has a stated ordering principle, so gate six does not need a fresh argument.
- The one file two wave-1 stories share is written down before it becomes a merge surprise.

---

## ADR-012: Build-time reconciliation for story 02 — the lock DOES filter a reported slice, but only from a NON-holder (ADR-011/A1's blanket phrasing is narrowed to what it measured); the held-scope read leaves the transaction because the carry it protected no longer exists; the row screen must cover every column it BINDS, not only the NOT NULL ones; and the newly-widened surfaces get their ratchets

**Status:** Accepted
**Date:** 2026-08-02

**Context.** Structural review of `43/02`'s build (uncommitted at review time). The authority cut
conforms on six of seven ACs; one AC's headline claim is false as built and is measured below. Two
of the three amended arch-tests are genuinely stronger and one is stronger-but-over-scoped. ADR-011
under-decided one thing and, in one clause, over-stated it. Each ruling is labelled **SUPERSEDES** /
**PINS** / **CLARIFIES** in ADR-010's form, and each was verified at source or by running the code.

**Codebase-graph grounding.** Rebuilt at this review — `aof graph build src` → **2,336 nodes, 6,266
edges, 109 communities**, built `2026-08-02T19:04:19Z` (up from ADR-011's 1,960/5,754). `aof graph
impact` read back for every file in the diff. Actual, not inferred: **`src/global-work-store.mjs`
has 17 dependents and 8 dependencies** (it gained one, `node-identity.mjs`) — the third-widest
fan-in in `src/`, and the module this story grew by 39%. `src/control-stream-server.mjs` is 3-in /
11-out, `src/global-work-publisher.mjs` 9-in / 7-out, `src/effects/stores.mjs` **1-in / 0-out** (a
pure leaf, which is why a classification change there is a safe enforcement point).

### B1 — NARROWS ADR-011/A1. A writer applying another node's reported slice **is** filtered by the lock when the reporter is not the holder; A1's "may never be filtered" described the case it measured, not the rule

A1 was written from one measurement: an ACTIVE assignment for `42`, the HOLDER's own delta discarded.
Its ruling — *"a writer applying another node's reported slice is the holder's own voice and may never
be filtered by the lock"* — silently assumed reporter == holder, which is the only case it had in hand.
The build reads it more precisely and is **right to**: `upsertWorkItems`'s `heldBy(ref)` returns `null`
when the holder **is** the reporter, so a holder's frame passes untouched, while a frame from a
different node for a held scope is skipped. That is ADR-004/D3 verbatim — *"while an assignment covers
a ref's execution scope, an upsert for that ref is accepted **only from the holder**"* — which A1's
phrasing, taken literally, would have broken.

**Ruling. The discriminator is `holder == writer`, in one predicate, for every authority.** The lock
gate runs first for every writer; `authority` decides only the SECOND question (may this writer step
over a row another node authored). Stated as the matrix the build implements and its tests pin:

| scope | row author | writer | outcome |
|---|---|---|---|
| held by worker-a | anyone | worker-a (`reported`) | **accepted** — A1's regression, cured |
| held by worker-a | anyone | worker-b (`reported`) | skipped `held-by-assignment` — ADR-004/D3 |
| held by worker-a | anyone | control (`disk-derived`, automatic) | skipped + counted — ADR-003 |
| held by worker-a | anyone | control (`disk-derived`, operator ref) | refused `item-locked-by-assignment` upstream |
| free | worker-a | control (`disk-derived`, automatic) | skipped `authored-elsewhere` — ADR-010/D1, the cure |
| free | worker-a | control (`disk-derived`, operator ref) | accepted, authorship changes hands — ADR-010/D1 |

A1's ARMED clause is **discharged**: `acd-item-lock-single-door` now carries it, green, and the store
module imports only `executionScopeRef` from the assignment leaf.

### B2 — SUPERSEDES ADR-011/A1's "both reads move inside the transaction". The carry it protected is gone, and the OTHER A1 clause forbids the read being there at all

A1 required the held-scope lookup and the carry `SELECT` to run inside `BEGIN IMMEDIATE`, because a
frame committing in the window was read stale and then **written back over**. A1's own armed clause
then required the store module to read no `global_assignments` state — so the two clauses cannot both
hold, and the build resolves it correctly: the lock is read by the caller (`global-work-publisher.mjs`
for the disk-derived path, `control-stream-server.mjs` for the frame doors) and handed down as
`options.heldScopes` data, outside the writer's transaction.

**Ruling — the transaction clause is superseded, and the residual race is named rather than hidden.**
There is no longer any read-modify-write: a held ref is simply not written, so nothing is re-written
over stale state. What remains is a lock answer that can be microseconds old, whose only two outcomes
are (a) a write admitted that a just-arrived assignment would have blocked, or (b) a write skipped that
a just-terminated assignment would have allowed. Both self-correct on the next frame or tick, and
neither destroys a row. **A future writer must not "fix" this by pulling the assignment read back into
`global-work-store.mjs`** — that is A1's HIGH regression's own habitat, and the arch-test clause now
forbids it.

### B3 — PINS the price of exporting `wholesaleDelete`, and ratchets it

Exporting it is **justified**: after the cut nothing sweeps `work_items`, so "the sweep is refused" is
provable from outside only by calling the guard by name (task 00's litmus (a)), and the class gate
genuinely sits inside the function — verified behaviourally, not by reading it. But the private
function could only ever be called from its own module; the exported one opens **every projection
table in the shared store** to a wholesale sweep from anywhere. That is a widened surface with no
named caller set. **Ruling: the caller set is PINNED to `src/global-work-store.mjs` and ratcheted in
`acd-work-items-single-writer`; a second caller needs an ADR, not an import.**

### B4 — RULES the codebase-health finding, and ratchets THAT too. `src/global-work-store.mjs` is on `mesh-worker-execution.mjs`'s trajectory

Measured 2026-08-02, against ADR-011's own table:

| Signal | 2026-08-01 | 43/01 review | 43/02 review | Trend |
|---|---|---|---|---|
| `src/` files | 202 | 203 | **203** | flat — this story adds NO module |
| `src/` root-level `.mjs` | 99 | 100 | **100** | flat |
| `src/` lines | 50,744 | 51,378 | **51,861** | +483 |
| `src/global-work-store.mjs` | 885 | 885 | **1,233** | **+39% in one story** |
| store openers (TECH_DEBT 12) | 17 | 17 | **17** | flat |

The good news is real and should be said: this story added **no new root sibling**, no new store
opener, and no new god-node. The bad news is the single-writer module. It is now the 5th-largest file
in `src/`, the declared sole writer of four fact tables, and a 17-dependent node — and ADR-009 routes
**more** into it (43/04's storage→wire mapper, the staleness predicate, the Resync door all read this
table). `mesh-worker-execution.mjs` reached 3,187 lines exactly this way: one justified block at a
time, no single diff ever looking wrong.

**Ruling: no refactor is required OF THIS STORY** — a 1,200-line split forced into the milestone's
riskiest diff is the scope explosion the health rule warns against, and the same reasoning ADR-011
applied to the god-file applies here. **But the ratchet is due and is committed now**: a line ceiling
on `src/global-work-store.mjs` in `acd-work-items-single-writer`, green today and red on the next
block. **This is a REQUIREMENT on `43/04`, not a wish:** its mapper/predicate/Resync code lands in a
module of its own (ADR-005 already creates `src/work-read.mjs` for exactly this read seam) and is
*called* from the store — a call site, not a block. Raising the ceiling is an ADR decision.

### B5 — RULES the P0.3 claim: it is NOT retired, and the fix is owed by this story

AC5 and ADR-004 both assert that collapsing the frame doors onto the row seam retires P0.3 — *"one
partial delta rolls back the ENTIRE `BEGIN IMMEDIATE` txn and silently drops every OTHER item in the
same frame"*. **Measured against the build under review: it does not.** `upsertWorkItems` opens ONE
`BEGIN IMMEDIATE` for the whole `rows` array and, on any error, `ROLLBACK`s and rethrows. Its screen
(`isCompleteItemRow`) checks the four NOT NULL columns, but the statement **binds eight row-derived
values**: `status`, `title` and `parent` are unscreened. A row that passes the screen and carries a
non-bindable value for any of the three aborts the entire frame.

Both halves measured, not argued:

- **Frame path** — a delta carrying `43/01`, a `43/02` whose `status` is an object, and `43/03`:
  `applyStreamFrame` **throws** (`TypeError: Provided value cannot be bound to SQLite parameter 5`),
  **zero rows land**, and in production the accept loop's `.catch` swallows it into `reportDegrade` —
  a sink ADR-010/R6.5 already records as having no reader until 43/06. Silent whole-frame loss: the
  milestone's own disease.
- **Disk path** — and it is reachable from ordinary operator input, not a malicious frame.
  `parseFrontmatter` deliberately parses an inline list, so a record doc with `title: [alpha, beta]`
  yields an ARRAY. Measured: the control's publish tick returns `published: false` with
  `ERR_INVALID_ARG_TYPE`, and **the whole workspace's rows stop updating** — every other item's status
  frozen — until that one doc is changed.

The defect is **pre-existing** (HEAD binds the same values in the same transaction), so this is not a
regression the story introduced. But the story's own headline says it retired it, the fix is three
lines inside the seam this story owns, and shipping the claim without the fix is how AC5 becomes a
lie the next milestone trusts. **Ruling: fix in this story.** Every value the statement binds is
screened; a row that cannot be stored is SKIPPED AND COUNTED with its own reason (the `incomplete-row`
discipline already there), never allowed to abort its siblings. The `title: [alpha, beta]` case gets a
scenario — the litmus is that the OTHER items still publish.

### B6 — PINS the two reported gaps as ONE finding, and routes it out of this story

The developer reported two unbuilt things. They are the same disease and must not be filed as two:
**a ref that no longer exists on the control's disk but carries a FOREIGN author's row is unreachable
by every deletion path except `removeWorkspaceFromCache` (which takes the whole workspace).**

- ADR-010/D1 named the cure — *"an **operator-initiated delete** … may retract the ref regardless of
  `node_id`, and is refused while locked"* — and it is not built. The build's `operatorRefs` door
  widens the UPSERT only; the retraction loop still reads `node_id = <me>`.
- A renumber makes it bite without any operator delete at all. Verified: `stream.reindexed`'s reactor
  list is `remap-run-refs`, `remap-notion-map`, `remap-projection`, `remap-control-facts` — **there is
  no publish reactor on that event**, and `work_items` carries no `refRemap` entry. So after a
  renumber the control's next tick upserts the NEW refs and retracts the OLD ones **it** authored,
  while every worker-authored row keeps the OLD ref forever.

**This is a genuine behaviour REGRESSION relative to HEAD** (the wholesale rebuild self-healed a
renumber on the next tick) and it must be said as one, not as a pre-existing hole. It does **not**
block this story: no AC covers it, aof has no item-delete verb for the operator door to hang on, and
`work_items`'s exclusion from the ref-remap tables is a decision ADR-004 and the store registry both
predate. **Route: `wiki/work/TECH_DEBT.md` item 13**, cited in the verdict, with the natural home
named — 43/04 owns Resync, which is the door that already asks an owning node to re-report.

**Two comments in the diff assert the opposite and must be corrected in this story**, because they are
the justification a future reader would trust: `effects/table.mjs`'s *"The cascade's own publish step
(below) reconciles it at the end"* (there is no publish step) and the pre-existing *"it is rebuilt
wholesale by the publish reactor declared below on the same event"* at `remap-projection`.

### B7 — CLARIFIES the two authority questions the build answered without an ADR, and accepts both

- **The same-author-only `stale-report` rule** (a node never moves its OWN row backwards in time) is
  **admitted**, and it does not contradict ADR-010/D1. D1 forbids `syncedAt` as a tiebreaker **between
  nodes**, because that hands the outcome to clock skew; within one author there is one clock and one
  monotonic sequence, and frames are re-sent on reconnect by construction, so a redelivered older
  report is a real ordering rather than a hypothetical one. The build's scoping (`existing.node_id ===
  reporter`) is exactly the line D1 draws. **PINNED: the comparison may never widen to two node ids.**
- **The operator door is a REF SET, not a flag** — **PINNED, and it is the better reading of D1.**
  Publish-on-mutate carries the whole workspace's rows while the operator touched one item; a boolean
  would have let one `work:feedback` seize every worker's row in the workspace. Deriving the set from
  the event's own payload is the reactor contract ("rebuild from the payload, never re-read racing
  state") applied correctly. Two consequences named: the operator door is **subordinate to the lock**
  (the lock gate runs first, so a held ref is refused whichever door asked), and `operatorRefsFor`'s
  `remap` branch is **dead code** — `publish-projection` is registered on `run.started`,
  `run.completed` and `feedback.recorded` only, none of which carry `remap`. Delete it or wire it;
  do not leave a branch whose doc-comment describes an event that never arrives.

### B8 — ACCEPTS the two smaller judgement calls, with their consequences named

- **`readWorkspaceProjectionItems`'s two additive keys** (`authoritative`, `errors[].ref`) — accepted.
  The signature is still one argument and the row shape is byte-unchanged, which is what task 07 pins;
  the keys exist because "there is nothing" and "I could not look" became a *deletion* decision the
  moment the rebuild went away. Without `authoritative`, `listItems`' empty-list-on-missing-dir would
  retract a node's entire slice on a transient fault. This is the sharpest judgement call in the build
  and it is right.
- **A frame no longer writing `workspaces.last_published_at`** — accepted, and the consumer check was
  made rather than assumed. `queryGlobalWorkProjection` reads `work_items` with **no join** to
  `workspaces`, so no cached row disappears. The one gate that reads the column
  (`mesh-assignment.mjs:93`'s `assignment-repo-unavailable`) is unreachable-by-this-change: a frame is
  refused `unknown-workspace` unless a `global_workspace_descriptors` row exists, and descriptors are
  written only by the local node's own `publishGlobalRegistryDescriptorsToStore` — which runs in the
  same call as the publish that writes `last_published_at`. The column's meaning legitimately narrows
  from "anything touched this workspace's cache" to "this node last published its own slice", which is
  the more honest fact and the one 43/04's staleness surface wants.

**Consequences.**
- ADR-011/A1 is narrowed to what it measured and its transaction clause is retired, so the next reader
  does not "restore" the regression in its name.
- The milestone's own disease class (one bad row silently taking a batch) is closed in the seam rather
  than asserted closed in a heading.
- Two widened surfaces (`wholesaleDelete`'s export, the single-writer module's size) leave this review
  with ratchets instead of with the reviewer's memory.
- The one thing the cut genuinely cannot do — reach a foreign author's row for a ref that no longer
  exists — is written down as debt rather than discovered by a phantom item on a board.

---

## ADR-013: Build-time reconciliation for story 03 — the mechanism is built and the TRIGGER is not, because nothing declares it and its argv cannot survive a tracked file; ADR-010/R3.E's "never restored" is SUPERSEDED for a marked hook entry (a marker is aof's claim, and un-marking is the operator's escape hatch); the queue file is per-node runtime state and must be git-ignored; and the enqueue hook's sanctioned silence must be COUNTED honestly

**Status:** Accepted
**Date:** 2026-08-02

**Context.** Structural review of `43/03`'s build (uncommitted at review time, HEAD `069ead2`). Eleven
of twelve ACs conform; the manifest, the drain, the content hash and the co-authored merge are all
built as decided, and AC11 is a genuine removal rather than a guard. What does **not** hold is the one
thing the story is named for: **the trigger is never installed in any workspace.** Two independently
sufficient reasons, both measured, plus one they share. Each ruling below is labelled **SUPERSEDES** /
**PINS** / **CLARIFIES** in ADR-010's form, and each was verified at source or by running the code.

**Codebase-graph grounding.** Rebuilt at this review — `aof graph build src` → **2,389 nodes, 6,212
edges, 114 communities**, built `2026-08-02T21:27:46Z` (up from ADR-012's 2,336/6,266 nodes). `aof
graph impact` read back for every file in the diff. Actual, not inferred:

- The four new modules are genuine leaves/near-leaves with distinct subjects, exactly as the ADRs
  required: **`work-artifacts.mjs` 5-in / 0-out** (a true pure leaf, as ADR-007 demanded),
  **`artifact-sync.mjs` 2-in / 1-out**, **`claude-settings.mjs` 4-in / 2-out**,
  **`work-content-read.mjs` 2-in / 3-out**. None is a hub; none imports the store.
- **`src/global-work-store.mjs`'s fan-in FELL from 17 to 16** — the publisher stopped importing the
  content read from it. The story reduced coupling on the milestone's widest node, which is what
  ADR-012/B4 asked for and is worth saying.
- **`src/mesh-launcher.mjs` is 2-in / 30-out** — the widest out-degree in `src/` and, at 1,660 lines,
  the third-largest file. It is a *sink*, the shape ADR-012/B4 named on `mesh-worker-execution.mjs`.

### C1 — RULES the story's central gap: the TRIGGER is not delivered. `Write|Edit|NotebookEdit` exists in this repo only inside two test fixtures, and no shipped surface declares a claude-runtime hook

Measured: `grep -rn "Write|Edit|NotebookEdit" src/ .aof/` returns **nothing**. Every occurrence is in
`test/artifact-sync-enqueue-hook.test.mjs` and `test/claude-settings-merge.test.mjs`, in a fixture
constant the tests build themselves. The merge is fed from the **project's** `.aof/aof.config.json`
(`applyClaudeSettingsMerge(targetDir, (await readConfig(targetDir)).config)` at `work-init.mjs:116`,
`work-update.mjs:125`, and the loaded config at `commands/assets-apply.mjs:136`), and no bundle member
declares such a hook — `src/bundle/bundle.json` carries three `kind: "hook"` members, all `codex`.

The asymmetry is structural, not cosmetic, and it is worth naming because AC11's removal created it.
`synthesizeBundleConfig` builds `{ hooks: bundle.hooks }` and hands it to the render pipeline: that is
how the bundle's own codex hooks reach `.codex/hooks.json` without an operator writing anything. The
claude equivalent used to be `claudeSettingsJson` reading the *same* synthesized config. AC11 deleted
that renderer — correctly — but wired its replacement to a **different config source**. So after this
story: aof can ship a codex hook to every workspace and cannot ship a claude hook to any.

**Ruling: the story is INCOMPLETE, and the missing piece is owed by it, not by the milestone gate.**
`aof work init` in a fresh workspace must install the trigger, or AC1 is a claim about a fixture. The
declaration belongs where the codex hooks already live — a `kind: "hook"` bundle member with
`runtimes: ["claude"]`, `event: "PostToolUse"`, `matcher: "Write|Edit|NotebookEdit"` — and
`applyClaudeSettingsMerge` must be fed the **union** of the bundle's claude hooks and the project
config's, through ONE resolver, so the two doors cannot answer differently about "which hooks does aof
install". Two config sources for one question is the drift this milestone keeps paying for.

This does NOT reopen the safety rule: the declaration goes in **aof's bundle**, never in this repo's
own `.aof/aof.config.json`, and this repo arms only when the operator chooses to. `aof work init` in a
scratch workspace is the observable.

### C2 — SUPERSEDES ADR-001's "a queue file whose absolute path was stamped into its argv at hook-install time". An install-time absolute path is correct on exactly the machine that ran the install, and `.claude/settings.json` is TRACKED

Verified: `git ls-files --error-unmatch .claude/settings.json` succeeds — the file is committed. A mesh
worker builds its checkout with `git worktree add`, so it inherits the committed settings verbatim. The
entry's argv would then name **another checkout's** script and **another checkout's** queue.

Both halves fail, and the second fails worse than the ADR's own guarantee allows:

- **The queue path** resolves outside the worktree. The append either lands in a foreign checkout's
  queue (whose drain runs against a different worktree and will never name those artifacts) or throws
  and is swallowed. The hook becomes inert; the reconciliation backstop carries everything. Never worse
  than today, but never better either.
- **The script path** is the sharp one. `args[0]` is an absolute path to `.claude/hooks/aof/…`; on a
  node where that path does not exist, **`node` itself exits non-zero before the script's `exit 0,
  always` can apply**. AC4's guarantee is a property of the script, and the entry can defeat it from
  outside. The `@manual` cross-node scenario is precisely where this surfaces.

**Ruling: an argv element in a TRACKED file may not carry an install-time absolute path.** ADR-001's
"the queue destination is an ARGUMENT, never a derivation" survives intact — its subject was workspace
*identity* (TECH_DEBT item 4), not path composition. Two admissible shapes, builder's choice:

- **(a) derive from the script's own installed location.** The harness passes the script's absolute
  path as `process.argv[1]`; the script lives at `<root>/.claude/hooks/aof/`, so the queue is a fixed
  relative walk from it. This is checkout-local by construction, needs no environment variable, and
  keeps AC1's "names no environment variable" clause unchanged.
- **(b) a harness-supplied project-directory token**, substituted by Claude Code at fire time. This is
  an argument the harness supplies, not a value the hook computes — but it costs AC1 its no-env-var
  clause and it is a version assumption ADR-001 deliberately avoided taking on. (a) is preferred.

Either way **AC1's Then "one `args` element is the absolute path of the queue file" is amended** to
"names the queue by a checkout-local rule, never by a path that was absolute when the entry was
written". C2 is a **precondition on C1**: the trigger may not be declared until its argv is
checkout-local, because declaring it is what puts the absolute path into a tracked file.

The durable class, which is bigger than this milestone and is why this is an ADR clause rather than a
note: **anything aof writes into a tracked file must be checkout-relative or resolved at run time.**

### C3 — SUPERSEDES ADR-010/R3.E's "a hand-edited marked entry is DRIFT-WARNED, never silently restored". The build restores AND warns; that is right, and R3.E's stated reason is wrong for an ENTRY

R3.E's reasoning — *"restoring it would be the wholesale-overwrite reflex at entry granularity, and the
operator marked their intent by editing it"* — is the bundle's drift-preserve semantics, and this story
correctly applies exactly those semantics to the enqueue **script** (AC12: a hand-modified script is
reported as drift and preserved). Applying them to the **entry** is not the same act:

- A bundled file is self-contained. Preserving a drifted copy leaves the operator holding a file they
  can read, whose divergence is theirs.
- A hook entry carries `aofManaged` — **aof's own claim of authorship**. Preserving a drifted marked
  entry leaves aof *claiming* an entry it no longer controls, pointing at a queue aof does not believe
  in, in a file aof will keep re-reading every run. There is no state in which that is the honest one.

The option neither R3.E nor task 03 named is the one that resolves it: **the marker IS the ownership
boundary, and removing it is the operator's escape hatch.** The build already honours that half — an
unmarked look-alike is the operator's forever, neither adopted, edited nor retracted. So the operator
who genuinely wants a different entry has a precise, total and already-built way to say so.

**Ruling: restore AND report, as built.** With one REQUIREMENT, because an escape hatch nobody is told
about is not an escape hatch: the drift-warning line must name it. `formatClaudeSettingsOutcome`
(`src/claude-settings.mjs:274`) currently says *"…had been edited; restored to the configured value"*;
it must also say how to keep an edit — remove the `aofManaged` key and the entry becomes yours.

### C4 — PINS the queue file as per-node runtime state that must be GIT-IGNORED, and rules it a fix owed by THIS story

Measured: `git check-ignore .aof/artifact-sync-queue.ndjson` → **not ignored**. `AOF_GITIGNORE_ENTRIES`
(`src/aof-gitignore.mjs:29`) names three derived artefacts and neither the queue nor its `.batch`
sibling. The queue is the same class as every entry already there — derived, regenerable, per-node,
never an authoritative copy — and it is written into **every worktree an agent runs in**.

Two ways it bites, the second across a story boundary:

- Every agent worktree grows an untracked file that shows in `git status`, in an agent's own diff read,
  and in any operator glance at a run.
- **ADR-008 (43/05) refuses gate propagation on a DIRTY worktree.** A permanently-untracked runtime file
  in every worktree is exactly the input that refusal is not meant to fire on. Story 05 would inherit a
  defect this story created, three stories away from its cause.

**Ruling: fix in this story** — one entry each for the queue and its `.batch` sibling. And the second
half, which is the part that would otherwise be missed: `ensureAofGitignore` is called by
`work-init.mjs:123` **and by nothing else**, so an existing workspace never receives a new baseline
entry. `work update` must call it too, or the entry reaches only workspaces initialised after today.

### C5 — RULES the amended silent-catch baseline: the sanctioned-floor rationale HOLDS, but the file's count does not. The ratchet is guarding a number that is not true

The rationale for `"bundle/hooks/artifact-sync-enqueue.mjs": 1` is accepted on its merits and is the
same shape as `degrade.mjs` / `mesh-log.mjs`: the file may not import the degrade sink (a *second*
fitness function, `acd-artifact-sync-hook-derivation-free`, fails the build if it tries), must write
nothing on stdout, and must exit 0. Its queue-append fault genuinely has nowhere to report, and its
compensating control is architectural. That is a sanctioned floor, not a relaxation.

**But the same diff put a SECOND runtime silence in the same file, which the detector does not count:**

```js
} finally {
  if (fd != null) try { closeSync(fd); } catch { fd = null; }
}
```

`fd` is block-scoped and never read again — the assignment is dead. The body is a statement, so
`countSilentCatches` scores it 0, and the gate's own self-check asserts *"a body with a statement is
handling, not silence"*. Here it is silence wearing a statement. The file's true count is 2 and its
pin says 1, so the shrink-only ratchet now protects a number that understates its subject.

**Ruling: the entry stays; the count must become true.** Preferred fix, because it removes the site
rather than declaring it: **drop the `finally` entirely.** This is a process that exits within
milliseconds of the append; the OS closes the descriptor, and an explicit `closeSync` buys nothing that
justifies a second catch in the one file in the repo forbidden from reporting. The file then really
does have exactly one silent catch and the pinned `1` is honest. (If the close is kept for any reason,
the baseline must read `2` and the comment must name both sites.)

### C6 — CLARIFIES what the merge does NOT retract, and accepts it

`claudeSettingsPatch` spreads `config.settings.claude` into the merged document's top level (so
`settings.claude.model` still becomes `.claude/settings.json`'s `model`, as `work-orchestrator.mjs`'s
surface depends on). Unlike a hook entry, a spread settings key carries **no marker**, so removing it
from config does not remove it from the file — where the deleted whole-file renderer would have dropped
it. **Accepted, deliberately.** For a co-authored file, aof declining to delete a top-level key it
cannot prove it authored is the conservative direction, and it is the same principle as C3's escape
hatch read from the other side. Recorded so the next reader does not "fix" it into a deletion.

### C7 — RULES the codebase-health finding: four new root siblings are each ADR-earned, `global-work-store.mjs` bought back 29 lines of headroom, and `mesh-launcher.mjs` is now the file on the god-file trajectory

Measured 2026-08-02 against HEAD (`069ead2`), `.mjs` only, so every column is comparable:

| Signal | 2026-08-01 | 43/01 | 43/02 (HEAD) | **43/03** | Trend |
|---|---|---|---|---|---|
| `src/` `.mjs` files | 202 | 203 | 203 | **208** | +5 (4 root + 1 bundle asset) |
| `src/` root-level `.mjs` | 99 | 100 | 100 | **104** | **+4 — the flat trend ends** |
| `src/` `.mjs` lines | 50,744 | 51,378 | 51,927 | **52,980** | +1,053 |
| `src/global-work-store.mjs` | 885 | 885 | **1,279** | **1,250** | **−29 — headroom bought back** |
| `src/mesh-launcher.mjs` | — | — | 1,585 | **1,660** | +75 |
| store openers (TECH_DEBT 12) | 17 | 17 | 17 | **17** | flat |

Three readings, and the first two are good news that should be said as plainly as the bad:

- **The single-writer module SHRANK.** ADR-012/B4 set a 1,280-line ceiling; HEAD sat at **1,279** — one
  line from red. By moving the worker-side content read into `work-content-read.mjs` this story took it
  to 1,250 and its graph fan-in from 17 to 16. B4's ruling was *"the NEXT block lands in a module of its
  own and is called from the store"*, and this is the first block that arrived after it, handled exactly
  as ruled. **43/04's 30 lines of headroom are still 30 lines**: its mapper, staleness predicate and
  Resync door land in their own module (ADR-005's `src/work-read.mjs`), and raising the ceiling remains
  an ADR decision.
- **The four new root modules are each ADR-earned and each leaf-shaped**, confirmed on the graph rather
  than argued: `work-artifacts.mjs` (ADR-007 names it, 5-in/**0-out**), `claude-settings.mjs` (ADR-002
  names it, 4-in/2-out), `work-content-read.mjs` (ADR-012/B4 requires it, 2-in/3-out),
  `artifact-sync.mjs` (ADR-001's mechanism, 2-in/1-out). None is a hub, none opens a store, none is a
  bag of leftovers. **This is not sibling-sprawl by subject.**
- **It IS sprawl by directory, and the milestone's own health table has been calling it "flat".** 99 →
  104 in three stories, and ADR-005 still owes a fifth (`work-read.mjs`) in 43/06. TECH_DEBT item 10's
  argument stands — a root-file-count ceiling imposed today would fail CI for everyone else's reasons
  before the grouping exists — so **no ratchet now**, but the measurement is written into item 10 so the
  overhaul is scheduled against a number rather than an impression.

**The new finding is `src/mesh-launcher.mjs`: 1,660 lines, 2-in / 30-out — the widest out-degree in
`src/`.** The story did the right half (the drain mechanism lives in `artifact-sync.mjs`) and then
inlined ~60 lines of *orchestration* — four `emitWarning` blocks, the hash-map lifecycle, the
delivery-confirm sequencing — directly into `pushActiveWorktreeState`. That is how
`mesh-worker-execution.mjs` reached 3,187: one justified block at a time. **Ruling: no refactor required
of this story** (the same reasoning ADR-012/B4 applied), **but the B4 requirement now extends to it**:
43/04 and 43/05 add a *call site* to `mesh-launcher.mjs`, never a block. A named function in
`artifact-sync.mjs` that takes the tick's inputs and returns `{ frames, warnings }` is where a second
block belongs. Routed to TECH_DEBT item 10 beside the god-file it is following.

Two smaller items, both fix-in-story: `src/work-orchestrator.mjs:9` still names the deleted
`runtime-config.claudeSettingsJson`, and `:169` tells the operator to *"run `aof apply` to re-render
.claude/settings.json"* — advice that is now wrong in both verbs and mechanism. And the tick derives one
fact twice: `listItems(worktreeWs.workDir)` is walked for `resolveDrainedArtifacts` and again inside
`readWorkspaceContentRecords`, per tick per worktree.

### C8 — SUPERSEDES AC5's *"reads current content for the named artifacts **only**"*. The queue bounds the WIRE, never the local read; the cost argument was always the HASH's, and a cadence split would break three other ACs to buy back a cost no ADR was defending

QA measured the headline scenario with the worktree constant and only the queue varied: the exact three
names, an empty queue, three wrong names and no queue file **all produce the identical frame**. That is
correct: `changedDocs` comes from `content.docs` (the full reconciliation read) gated by
`selectChangedArtifacts`, and `resolved.named` feeds only the three warning channels. The finding is
sound and the scenario cannot fail. `src/artifact-sync.mjs:16-27` documents the deviation honestly; the
record does not, which is the defect.

**The tension is inside AC5 itself** — *"named artifacts only"* AND *"one loop does both jobs … the
reconciliation backstop STATE mandates keeping"* — and the backstop is a full read by definition. One
of the two clauses has to go.

**Ruling: (b). Amend AC5 to the truth. The drain's shape does NOT change** — the three other findings on
that code can be fixed in the same pass with no redesign.

The coordinator's lean toward (a) rests on "(b) quietly concedes the cost argument that justified the
hook". Checked against the ADRs' own words, it does not, because **the cost argument was never the
hook's**:

- ADR-007: *"Artifacts travel with a per-artifact content hash, and an unchanged artifact is never
  re-sent … **With it, the tick is cheap** and ADR-001's hook-named change list is what usually decides
  the batch."*
- ADR-001, Consequences: *"Widening the artifact set (ADR-007) becomes affordable, **because the tick
  stops re-sending unchanged content**."*

Both assign affordability to the **hash**, and both were written about the *send*. The hook's unique
contribution is the wire plus two signals a scan can never produce. What (b) concedes is one sentence in
ADR-001's Context that said "re-scan-**and-send**" and then reasoned only about the send.

**And (a) is not free — it breaks three AC-named cases**, because it makes convergence depend on a
runtime-specific hook being installed:

1. **AC4 says the degraded path is *"never worse than today"***, and today is a full read every tick.
   Moving the backstop to every Nth tick makes an unwritable queue N× slower than HEAD — AC4 contradicted
   directly by the fix meant to honour AC5.
2. **`Bash`-written artifacts** are deliberately outside the matcher and are STATE's named reason for
   keeping the backstop. Under (a) they wait for the reduced cadence, and task 00's *"within one stream
   tick"* Thens become false.
3. **A codex worker has no `PostToolUse` hook at all** (the enqueue script ships `runtimes: ["claude"]`).
   Under (a) its queue is permanently empty, so its ordinary tick sends nothing and *all* of its artifact
   sync runs at the reduced cadence. This is the silent-no-fire class ADR-001 rejected the `http` type
   for, re-entering through the read path. **(1) and (3) apply to every node today**, since C1 has just
   established that no node has the entry installed.

QA's closing scenario (*"two edited, one named → only the named one rides"*) is satisfiable **only**
under a cadence split, because the unnamed-but-edited artifact has to ride *some* later tick. So it is
not an independent test of (a) — it is (a) restated, and it inherits (1)–(3).

**(a) becomes right the day the trigger is universal** — every runtime, every write path, installed
everywhere — at which point the backstop is genuinely redundant rather than load-bearing. That is a
future ADR with a real precondition, recorded here so the option is not lost: it needs a `Bash`-covering
trigger and a codex equivalent, not a cadence knob.

**AC5's replacement text** (the property the build has, and which IS falsifiable):

> 5. **The daemon owns batching and the wire.** The worker daemon drains the queue on its **existing**
>    stream tick (`pushActiveWorktreeState`), de-duplicates by path, and sends one batched frame carrying
>    **only artifacts whose content hash moved**. The queue bounds the **wire and the reporting**, not
>    the local read: the tick still performs the full reconciliation read STATE mandates, because a
>    `Bash`-written file and a node with no hook installed must both still converge on the very next
>    tick. What the queue buys that no re-scan can: a named-but-now-missing artifact becomes a coded
>    degrade instead of a silence, an `unresolved-path` line reaches an operator, and the drain is
>    **idempotent and loss-averse** — it consumes by rename-then-read, so a crash mid-drain **re-sends
>    rather than loses**. One loop does both jobs.

**And the headline scenario is replaced** by one on a channel the backstop cannot reproduce. Task 01's
`Scenario: one tick drains the queue and sends a single batched frame carrying exactly the named
artifacts` becomes:

```gherkin
  @executable
  Scenario: one tick drains the queue, sends one frame of only what changed, and reports what only the queue could know
    Given the queue holds one line each for STORY.md, `tasks/00_a.feature` and `tasks/01_b.feature`
    And STORY.md has been deleted from the worktree since the line naming it was written
    When the stream tick runs once
    Then exactly one artifact frame is sent for "43/03" in that tick
    And the frame carries bodies for exactly the two feature files
    And the frame carries no body for any artifact whose bytes did not change
    And `aof mesh logs --node <the worker's node name> --json` shows exactly one coded
      `artifact-sync-artifact-missing` degrade, naming STORY — which no re-scan could produce,
      because a re-scan sees only that the file is absent, never that an agent had just written it
    And the consumed batch file no longer exists, so a subsequent tick re-offers none of the three lines
    And after the tick the control node's `aof work tasks 43/03 --json` lists both feature files
```

Its litmus already permits this: channel (d) is `aof mesh logs`, and the batch file's own bytes are the
one artefact the backstop never touches.

### C9 — RULES F-4/G2: AC7 was guarded by nothing, and the answer to "is the compatibility clause still meaningful" is NO — the AC survives as an ANTI-DRIFT rule, not a migration promise

QA's plant is confirmed, and the guard was worse than weak — it was **blind**. `declares()` matches
`= (Object.freeze()? [{`; the real derived form is `= Object.freeze(Object.fromEntries(`, which matches
neither, so `WORK_ITEM_DOC_FILES` was never detected at all and the "both names in the same module"
branch never executed. A stale literal beside the manifest satisfied every proof.

**The invariant was never "one file"; it is "ONE DEFINITION, one DERIVED view — never two literal
lists", and that is a property of the INITIALIZER.** `acd-work-artifact-set-single-home` gains the clause
that reads it (written and green at this review): the declaration must exist in the manifest module, its
initializer must name `WORK_ITEM_ARTIFACTS`, it may not open with an object/array literal, and the
derived value must equal the manifest's `file`-kind entries in manifest order. QA's plant trips two
clauses; the real form passes; a module with no declaration is reported rather than skipped.

**On the importer question — measured: `WORK_ITEM_DOC_FILES` has ZERO production importers.** The only
occurrences in `src/` are its declaration and the re-export from `global-work-store.mjs`; `commands/doc.mjs`,
the last real consumer, moved to `resolveArtifactRequest`. So AC7's *"so every existing importer keeps
working unchanged"* is now a claim about the empty set — **true, and meaningless**. It should not be
deleted, because the constant is still exported from two modules and the moment anyone imports it the
drift risk is live again; it should be **re-stated as what it now is**:

> 7. **`WORK_ITEM_DOC_FILES` is DERIVED from the manifest** (its `file`-kind entries) and re-exported
>    from `global-work-store.mjs`. It is a compatibility view with **no importers left in `src/`** — the
>    migration it existed for is complete — and it is kept exported, and derived, so that the next caller
>    to reach for "the record-doc names" gets the manifest's answer rather than writing a fifth literal
>    list. One definition, one derived view — **never two literal lists**, enforced on the initializer,
>    not on the filename.

The honest reading of the AC's history is worth one line for the retro: a compatibility clause outlived
the compatibility it promised, and nobody noticed because the guard was watching the wrong noun.

### C10 — RULES F-11: run records get the SAME hash gate, in this batch

Measured: three steady-state ticks with one run record send three frames (`docs: []`, `runs: [1,1,1]`).
It is **pre-existing HEAD behaviour**, not a regression, and no AC is falsified — task 02's scenario says
*"no artifact **body** is carried"*, which is true. So this is not a correctness finding.

It is ruled **fix-now** on cost-of-fix rather than severity: the tick already holds the sent-hash map,
`selectChangedArtifacts` / `recordSentArtifacts` are already generic over `{ ref, doc|runId, hash }`, and
the change is a handful of lines in the same function. The alternative is a frame per tick per active
worktree on every worker, forever, for a fact that stopped changing when the run ended — and the fix never
gets cheaper than "the map is already here". Two conditions, both already true of the doc path and both
required of the run path: the hash is over the **serialized record**, and the map is updated **only after
delivery**, so an interruption re-sends. With docs and runs both gated, a genuinely idle tick sends **no
content frame at all**, which is the end state AC8 describes.

**Consequences.**
- AC5 stops claiming a property the build does not have, and its headline scenario stops being a test of
  the backstop; the drain's shape is unchanged, so the remaining findings fix in one pass.
- The option (a) foreclosed here is foreclosed *with its precondition written down*, so a future
  milestone can take it deliberately rather than rediscover the argument.
- The story's mechanism is sound and its trigger is not shipped; C1 + C2 say so together, because the
  reason it cannot ship yet (a tracked absolute path) is the reason it must not be armed first.
- ADR-010/R3.E's blanket rule is replaced by a boundary that already exists in the build — the marker —
  so "who owns this entry" has one answer and one operator-visible way to change it.
- A runtime file the milestone introduces stops being story 05's inherited defect.
- The one fitness function this story relaxed leaves the review with a true count rather than a
  rationale, and `acd-claude-settings-co-authored` gains the UNCONDITIONAL removal assertion AC11
  deserves (previously the clause armed only when this repo's own config declared a claude hook — which
  the story's own safety rule forbids, so the invariant was protected by nothing here).

---

## Fitness functions (the enforced invariants)

Arch-tests live under `test/arch/acd-*.test.mjs` (node:test-style `archTests` arrays, registered in
`scripts/test.mjs`). Following m41's practice (`acd-reindex-engine-blast-radius`: *"a clean skip … arms
the moment the engine lands"*), each file below mixes assertions that are **GREEN TODAY** — invariants
that hold at HEAD and must not regress — with **ARMED** guards that skip cleanly while their subject is
unbuilt and bind the moment it lands. No file is committed RED.

| File | ADR | State |
|---|---|---|
| `acd-artifact-sync-hook-derivation-free` | 001 | green (2 live proofs) + **the armed clause FIRED at `43/03` and is green** against the real enqueue script |
| `acd-claude-settings-co-authored` | 002 | green (canary on the operator's keys) + armed at the hazard + **an UNCONDITIONAL removal proof added by ADR-013**: `claudeSettingsJson` exists in no `src/` module, and `renderConfigOutputs` emits no `.claude/settings.json` for a config declaring BOTH a claude hook and `settings.claude` — with the codex leg of the same call as the non-vacuity control. The armed clause was keyed on THIS repo's config declaring a claude hook, which 43/03's own safety rule forbids, so AC11's removal was protected by a clean skip until now. |
| `acd-item-lock-single-door` | 003 | green (single `executionScopeRef` definition; mint seam imports the lock module; no command re-derives the scope check) + armed — **amended by ADR-010/R1.1** (the armed clause forbids a command module deciding the SCOPE lock, and no longer flags the sanctioned exact-ref `findActiveAssignment`) and **by ADR-011/A1**: a further clause — *the publish path reads no `global_assignments` state* — is due at `43/02`, where authority becomes a `node_id` column and the assignment read disappears. Not committed now: it would be red against `43/01`'s interim carry. **DISCHARGED at `43/02`** (ADR-012/B1–B2): the clause is committed and green, in two halves — no `FROM global_assignments` in the store module, and `executionScopeRef` as the ONLY import it may take from the assignment leaf. |
| `acd-work-items-single-writer` | 004 | green (single DML module; the armed reclassification clause FIRED at `43/02` and is green) + **two ratchets added by ADR-012**: `wholesaleDelete`'s exported caller set is pinned to one module (B3), and `src/global-work-store.mjs` carries a line ceiling so the milestone's single-writer module does not become the next god-file (B4) |
| `acd-cache-read-surface-boundary` | 005 | green (worker/structural readers PINNED) + armed — **amended by ADR-010/R6.3**: `promote-gap-to-chore.mjs` moved from the control-side list into the positively-pinned STRUCTURAL list |
| `acd-cache-staleness-single-predicate` | 006 | green (strict `>`, no time-predicated DELETE) + armed |
| `acd-work-artifact-set-single-home` | 007 | green (one declaration site) + **a DERIVATION clause added by ADR-013/C9**: `WORK_ITEM_DOC_FILES`' initializer must name `WORK_ITEM_ARTIFACTS`, may not be an object/array literal, and its value must equal the manifest's `file`-kind entries in manifest order. The pre-existing clause was blind — its detector matched `= (Object.freeze()? [{` and the real derived form is `= Object.freeze(Object.fromEntries(`, so a stale literal declared beside the manifest passed every proof (QA-planted, 43/03). The invariant is a property of the INITIALIZER, not of the filename. |
| `acd-gate-propagation-never-discards` | 008 | green (no history-rewriting git op) + armed |

**Invariants MOVED here out of the feature layer** — these are structural and must never be written as a
Gherkin scenario on a task:

- "no reader outside the sanctioned worker/structural set imports the disk readers" (ADR-005) — a source
  fact, not a behaviour.
- "there is exactly one staleness predicate / one threshold" (ADR-006) — a *sameness* property; a
  scenario can only ever sample it at one instant.
- "the settings writer never writes the file wholesale" (ADR-002) — a property of every possible run.
- "the lock check sits in front of the single mint door" (ADR-003) — the *placement* is the invariant;
  the refusal itself is behavioural and belongs in a scenario.
- "no history-rewriting git operation exists on the branch-advance path" (ADR-008) — an absence, which no
  scenario can prove.

**Prose fitness criteria** (behavioural, covered by the stories' `@executable` scenarios at per-story
refine — NOT committed red now):

- A held item refuses a second assignment, a local `run-start` and a `run-retry` with
  `item-locked-by-assignment`, and admits its holder's own mint (ADR-003).
- The control's publish tick no longer changes a row a worker is authoring (ADR-004) — the alternation
  test: publish, stream a delta, publish again, assert the worker's row survives.
- An item settled by a worker still reads correctly on the control after the worktree is deleted
  (ADR-004 + ADR-007).
- A cached row past the window is marked stale and is **never** deleted (ADR-006).
- A gate edit made on the control reaches a continuing item; a dirty tree and a conflicting merge each
  refuse with their code and leave the branch byte-unchanged (ADR-008).

---

## Codebase health (measured this refine, and where each finding is routed)

Every structural review answers "is the tree this lands in still sound?" Measured 2026-08-01 against
TECH_DEBT item 0's own 2026-07-26 baseline:

| Signal | 2026-07-26 | 2026-08-01 | 43/01 review, 2026-08-02 | Trend |
|---|---|---|---|---|
| `src/` files | 147 | **202** | 203 | +37% |
| `src/` lines | 41,348 | **50,744** | 51,378 | +23% |
| `src/` **root-level** `.mjs` | — | **99** (of 202) | 100 | half the tree is one flat directory |
| `src/mesh-worker-execution.mjs` | 2,163 | **3,174** | 3,187 (+13) | **+47%** — the largest file in the repo |

**43/01's own contribution, measured 2026-08-02:** +1 root module (`item-lock.mjs`, 274 lines — the one
this ADR set pre-authorised; graph: 6 dependents, 5 dependencies, a near-leaf as designed), +634 lines
across `src/`, and **+13** lines into the god-file — the "a call site, not a 100-line block" requirement
kept. No file crossed a size threshold and no new god-node appeared.

Two findings, both routed:

1. **`src/mesh-worker-execution.mjs` is a 3,174-line god-file and TWO of this milestone's stories land
   in it** (`artifact-sync-on-write`'s drain wiring, `gate-propagation`'s reuse-door advance). It grew
   47% since it was named in TECH_DEBT item 0. **Route: refactor NOT required of this milestone** — its
   stories add tens of lines to it, not hundreds, and forcing a 3,000-line extraction into a milestone
   about cache authority would be exactly the scope explosion the health rule warns against. **Routed to
   `wiki/work/TECH_DEBT.md` item 10**, with the measured trend as its evidence. The one thing this
   milestone DOES owe: `gate-propagation`'s advance logic must live in `mesh-worktree.mjs` (the module
   that already owns every git verb, imports 0 mesh modules) and be *called* from the reuse door — so
   this milestone adds a call site, not a new 100-line block, to the god-file. That is a requirement of
   the verdict, not a wish.
2. **`planApplyActions`' ungated overwrite is a defect class, not one file's bug** (ADR-002). Any
   co-authored file with no prior lock entry is silently overwritable by `work init`/`work update`.
   **Route: `wiki/work/TECH_DEBT.md` item 9**; this milestone closes only the `.claude/settings.json`
   instance, and `acd-claude-settings-co-authored` is the ratchet that stops the second instance.

**A third shape is worth naming but not yet ratcheting:** 99 flat root-level modules in `src/`. This
milestone adds up to three more (`work-read.mjs`, `work-artifacts.mjs`, `item-lock.mjs`) — each
justified above by a graph-cited coupling argument, each a leaf or near-leaf. The Nth-instance rule says
a ratchet is due; but a root-file-count ceiling imposed by an unrelated milestone would fail CI for
everyone else's reasons. It is recorded in TECH_DEBT item 10 alongside the god-file, as one finding
about the same disease (the tree has no interior structure), for the m42-class overhaul to schedule.

---

## ADR-014: Build-time reconciliation for story 04 — the m08 collision is resolved by AMENDMENT and the rule it earns is stated; a resync aimed at THIS node is not "not connected" and needs its own code; the request leg's bound must exceed the drain cadence it waits on; the one-mapper clause becomes a RATCHET because a second translation was already living in the merge; and comment-trimming is not how a line ratchet is satisfied

**Status:** Accepted
**Date:** 2026-08-03

**Context.** Story 04's `src/` half landed the read side of schema v8: the storage→wire mapper
(`src/cache-provenance.mjs`, a near-leaf — 1 import, 5 dependents by `aof graph impact`, 2026-08-03),
the `{ items, stalenessSeconds }` list envelope, per-row and per-artifact provenance on three routes,
and the Resync transport (`src/mesh-resync.mjs` + `src/commands/resync.mjs` + a control-tick drain).
45 story scenarios and every touched arch test are green. Three questions were raised by the developer
rather than worked around; five findings came out of the review. Rulings are lettered **E** — `D` is
taken by ADR-010's refine-time defect ledger, and this milestone has already paid once for citation
ambiguity.

### E1 — RULES the cross-milestone contract collision. The AMENDMENT is correct, the seven-field row contract is genuinely unweakened, and the rule this earns is an ACCEPT-time obligation on the superseding ADR

m08's locked `00_routes-byte-for-byte.feature` asserts `GET /api/work/list` returns the milestone-03
envelope byte-for-byte; ADR-010/R4.1 makes it `{ items, stalenessSeconds }`. Both are accepted
contracts and they cannot both hold.

**Verified at source, not accepted on report.** All six collateral surfaces were read and re-run:
`board-api`, `board-face-contract` and `work-ui-board-serves-unchanged` still assert
`Object.keys(item).sort() === ["dir","parent","ref","slug","status","title","type"]` per row — the
same exact key-set equality, moved one level down to `body.items`; `board-serve`, `mesh-ui-serve` and
`acd-board-single-server` only ever asserted array-ness (their subjects are the single origin and the
single port), and still do. No assertion was relaxed, none was deleted, and the CLI face — the contract
that genuinely did NOT move — is still pinned by `acd-work-list-contract`'s exact key-set equality plus
the story's own spawned-CLI scenario. **The developer's claim is accurate.**

**Ruling: the amendment is the right structural resolution, and editing m08's scenario would have been
the wrong one.** A locked contract of a done milestone is a historical record of what was accepted; the
resolution is a dated, reasoned amendment that names the superseding ADR and the file that carries the
new oracle — which is exactly what the PO wrote. Silently rewriting the older scenario would destroy
the evidence that the contract ever changed, which is the only thing that makes the change reviewable.

**The rule it earns, and it is not this story's to pay:** `aof work validate` checks a stream's
structure, never whether one milestone's accepted ADR has just falsified an earlier milestone's locked
scenario. **An ADR that changes a route, an envelope or a wire shape named in a prior milestone's
contract must name every prior contract it supersedes, at ACCEPT time, while the author still knows.**
Found here only because a developer read an older milestone's feature file unprompted. Recorded in
STATE's feedback for the retro; a `grep`-able cross-milestone route index is the cheap mechanical cure
and is out of this milestone's scope.

### E2 — RULES the self-authored Resync: `resync-owner-not-connected` is the WRONG code, and this case earns a FIFTH. Declining to invent one was the right instinct applied to the wrong boundary

Today `work:resync` on a row this node authored answers `resync-owner-not-connected` (muted) with the
message *"…which is this node — there is no peer to fetch it from"*. The code and its own message
disagree about what happened, and the code names a connectivity fact that was never tested: nothing was
asked of the network at all.

- **The four pinned codes are a WIRE vocabulary** — outcomes of a node→node call (`no-owner` = there is
  nobody to ask; `owner-not-connected` = we looked for a socket and found none; `owner-unreachable` =
  the send did not complete; the timeout = we asked and waited). The self-authored case makes no call,
  so it cannot be an outcome of one. R4.2 pinned the vocabulary for the door it was describing; it did
  not rule on a case it never considered. **PINS are narrowed by measurement in this milestone as a
  matter of course** (ADR-012/B1 narrowed ADR-011/A1 for exactly this reason).
- **The operator consequence is a misdiagnosis, and it is the common case, not the exotic one.** A
  control-authored row goes stale precisely when the control's own publish tick stops — daemon down,
  workspace unregistered, publish erroring. "Owner not connected" points the operator at the network
  for a wholly local condition, and this milestone exists to make surfaces say what is actually wrong.
- **REJECTED: `resync-no-owner`.** There IS an owner, and that code is DESIGN's `destructive`
  "refused" — a rejection tone for a state where nothing is broken.

**Ruling: add a fifth code, `resync-owner-is-self`, MUTED**, whose message says the row is this node's
own publication and names what refreshes it. It is DESIGN's tone rule applied honestly — nothing was
rejected, and nothing failed. It is additive to R4.2's four, not a replacement of any.

**RECORDED as the stronger alternative, deliberately not required here:** the symmetric answer is for
the control to do to itself what it asks a worker to do — run its own publish now. A worker's answer to
a resync frame is `pushStreamSnapshot()`; the control's answer to a resync of its own row could be the
publish tick, immediately. That is the better feature and it is a different one: it needs the publish
seam wired into a command door, and it belongs to whichever story owns the control's publish path, not
to this one. Recorded here, in the decision log, rather than silently dropped — a fifth code today does
not foreclose it, because `resync-owner-is-self` is exactly the state that feature would then satisfy.

### E3 — RULES the line ratchet: no split is due, ADR-012/B4's actual requirement WAS met, and trimming comments to fit a ceiling is not the sanctioned response even though that is not what happened here

Measured: `src/global-work-store.mjs` 1,250 → **1,276** lines, ceiling **1,280**. `git diff --numstat`
reads **26 insertions, 0 deletions** — so no pre-existing comment was sacrificed to the ceiling; the
developer cut their OWN draft before it landed, which is ordinary editing, not ratchet evasion. The
26 lines are ~6 of code (one `SELECT` accessor, one import, one spread into `mapItemRow`) and ~20 of
rationale.

- **B4's requirement was met, and it was the requirement that mattered:** the mapper, the predicate and
  the whole Resync door live in NEW modules (`cache-provenance.mjs`, `mesh-resync.mjs`,
  `commands/resync.mjs`), and the store gained call sites rather than blocks. That is precisely the
  escape hatch B4 named.
- **`readWorkspaceItemProvenance` belongs in the store and nowhere else.** It is a prepared statement
  against `work_items`, and `acd-work-items-single-writer` requires every `work_items` SQL to live in
  the declared module. Moving it out to satisfy a line count would break a stronger invariant to
  satisfy a weaker one.
- **The general rule, stated so it cannot be mistaken later:** a line ceiling is a proxy for structural
  cost, and deleting rationale to fit under it *raises* the real cost while lowering the measured one.
  **If a change cannot fit under the ceiling without removing existing explanation, the change belongs
  in another module — that is the ratchet working, not the ratchet being satisfied.**

**Ruling: the ceiling STANDS at 1,280 and is NOT raised.** With four lines of headroom the module is
effectively closed, which is the intended state: ADR-005 already requires 43/06's read seam to be
`src/work-read.mjs`, so the next story has its home. A future story needing store code raises the
ceiling by ADR or splits the module — never by editing comments.

### E4 — RULES the one-mapper clause: it was asserted BEHAVIOURALLY and a second translation was already living in the merge. It becomes a RATCHET, and the second translation must go

ADR-006's third clause ("the storage→wire mapping has ONE home … applied identically to rows and to
artifacts") was proven by a scenario asserting that a row and an artifact produce the same key names.
That can only ever show the mapper's output agreeing with itself; it cannot see a second translation
elsewhere. **Measured: one exists.** `src/board-worker-stream.mjs:247` (`mergeWorkerItems`) sets
`reportedBy: overlay?.get?.(row.ref)?.nodeId ?? null` on every child row the merge inserts — the
ASSIGNMENT overlay's target node, i.e. *"which node was this item assigned to"*, wearing the wire key
this story defines as *"which node reported this row"*. Two different facts, one key.

It is currently harmless only because `applyCachedProvenance` runs afterwards and overwrites it, and
the build KNOWS this — `commands/list.mjs:59-62` says so in a comment. **Correctness by later
overwrite, documented in prose, is the shape this milestone has already been burned by.** It also
leaves a row that carries `reportedBy` with no `syncedAt` beside it — the exact asymmetry AC 3 forbids
— on any path where the stamp does not reach.

**Ruling, three parts:**
1. **The line goes.** Attribution is the provenance stamp's job, at one application point.
2. **`test/board-mesh-execution.test.mjs:162`** asserts the overlay-derived value and must be amended.
   This is m20/R1 for the third time in this milestone: **an ADR that redefines what a wire key MEANS
   must enumerate the existing tests that assert the old meaning** — a test asserting a superseded fact
   is a green claim that the old contract still holds.
3. **The clause becomes a ratchet**, added to `acd-cache-staleness-single-predicate` (ADR-006's own
   home, which already carries the predicate and never-evict halves): no module in `src/` other than
   `cache-provenance.mjs` may build a `reportedBy`/`syncedAt` key out of a storage spelling
   (`node_id`/`nodeId`/`updated_at`/`updatedAt`). Going through the mapper and passing an
   already-mapped wire value along are both explicitly not translations, with a self-check for each.
   ONE named baseline is carried: `upsertWorkItems`' `authored-elsewhere` skip detail, a diagnostic on
   the writer's own return value rather than a row on any wire — named, not counted, so a second
   cannot hide behind it (ADR-013/C5).

### E5 — RULES a defect the story's own tests cannot see: the request leg's 10s bound is SHORTER than the 15s control drain cadence it waits on, so "no answer" is manufactured for ~a third of healthy requests

`commands/resync.mjs`'s `DEFAULT_REQUEST_TIMEOUT_MS = 10_000`; the drain rides
`controlDispatchReclaimTicker` at `cadenceFromConfig(ws)`, whose documented default is
`DEFAULT_CADENCE_SECONDS = 15` (`mesh-launcher.mjs:122`) — and this repo's own
`.aof/aof.config.json` sets no `mesh.sync.cadenceSeconds`, so 15s is the live value here. A request
arrives at a uniformly random point in the tick, so **roughly one healthy request in three reports
`resync-pending` ("no answer") while the dispatch is still pending and lands seconds later.** On the
CLI face that is exit-non-zero, because `render` throws on `!ok`.

This is ADR-010/R4.3's own rule, one leg over: *"Without this, 'no answer' would be structurally
guaranteed rather than measured."* A bound shorter than the cadence it waits on does not measure the
world; it measures the clock.

**Ruling: the request-leg bound must be derived from, and strictly exceed, the drain cadence it is
waiting on** — the same `mesh.sync.cadenceSeconds` the tick reads, with headroom (indicatively
`max(10s, 2 × cadence)`), and the derivation stated where the constant is. A hard-coded bound that
happens to be shorter than a configurable cadence is a defect that gets worse the moment an operator
slows the tick down. The DESIGN default of "10s for the request round trip" was written against an
assumed-instant dispatch; the mechanism that was actually built is tick-drained, and the bound must
follow the mechanism.

### E6 — RULES the coverage gap: the Resync transport is 483 lines of new node→node code with no behavioural test, and two of its four coded outcomes are produced by nothing

`src/mesh-resync.mjs` (273) and `src/commands/resync.mjs` (210) have no test file. The only exercise is
the two registry guards, which hit `work resync 03/01` against a non-mesh fixture and get
`resync-no-owner` **before** any row is written, any tick runs or any frame is built. So
`runResyncDispatchTick`, `applyResyncResultFrame`, `buildResyncFrame`, the worker's `onResync`/
`sendResyncResult` lane and the bounded poll are all unexecuted, and `resync-owner-not-connected` /
`resync-owner-unreachable` — two of R4.2's four codes — are produced by no test at all. The precedent
this module is modelled on has `test/mesh-recovery-push.test.mjs`; the sibling shipped without one.

Tasks 05/06 cannot close this: both are `@ui`, and their litmus is the rendered board with *"the
owner's answer controlled at the network/route layer"* — the control-daemon half is unreachable from
either.

**The transport itself is sound** — I exercised it directly at review (isolated store, faked stream
server): requested → dispatched with a well-formed frame; not-connected → `failed` +
`resync-owner-not-connected`; a throwing dispatch → `failed` + `resync-owner-unreachable`; a result
frame on the WRONG connection → `resync-result-not-owner` with the row untouched, including the spoof
where the frame self-declares the owner. That is the T6 discipline holding. **Which is exactly why the
test is owed: the behaviour is right today and nothing would tell us when it stops being.**

**Ruling: a behavioural suite for the transport is a must-fix of this story**, covering at minimum the
three tick outcomes, the authorization refusal (including the spoofed frame), the re-request reset, and
the door's own coded outcomes. Model: `test/mesh-recovery-push.test.mjs`. It is registered in
`scripts/test.mjs` like the story's other three.

### E7 — RULES the codebase-health findings. Two are routed to the ledger with their trend lines; one is a ratchet the milestone can afford now

Measured 2026-08-03, continuing ADR-012/B4's and ADR-013/C7's table:

| Signal | 2026-08-01 | 43/01 | 43/02 | 43/03 | **43/04** | Trend |
|---|---|---|---|---|---|---|
| `src/` files | 202 | 203 | 203 | 208 | **211** | +3 |
| `src/` root-level `.mjs` | 99 | 100 | 100 | 104 | **106** | +2 (25 are now `mesh-*`) |
| `src/` lines | 50,744 | 51,378 | 51,861 | 53,215 | **54,126** | +911 |
| `src/global-work-store.mjs` | 885 | 885 | 1,233 | 1,250 | **1,276** | +26 (ceiling 1,280) |
| store openers (TECH_DEBT 12) | 17 | 17 | 17 | 17 | **19** | **+2 — the first move since it was raised** |

- **The two new root siblings are ADR-earned**, on ADR-013/C7's test: `cache-provenance.mjs` is
  required by ADR-012/B4 (the read-side code in its own module) and is a genuine near-leaf;
  `mesh-resync.mjs` is R4.2's transport and sits beside the `mesh-recovery-push.mjs` it mirrors. **No
  new root-count ratchet is set, and the reason is not squeamishness:** ADR-005 already REQUIRES 43/06
  to add `src/work-read.mjs`, so a ceiling set today is one a standing ADR obliges the next story to
  break. A ratchet a decision already contradicts is worse than none. The `mesh-*` family reaching 25
  flat siblings is added to TECH_DEBT item 10's evidence as the shape a `src/mesh/` partition would
  cure.
- **Store openers 17 → 19** — `src/commands/resync.mjs` and `src/mesh-resync.mjs`. TECH_DEBT item 12's
  own stated cure names this exact threshold: *"a ratchet: `openGlobalWorkProjectionStore` may be
  called from exactly one module, and the 18th opener fails CI."* This story shipped the 18th and the
  19th. **Route: ledger** — item 12 updated with the count and the crossing, because the cure is a
  per-invocation store handle threaded through `ctx`, which is a repo-wide refactor and precisely the
  scope explosion the health rule warns against inside a story. It is also evidence for E8: each
  feature of this class now costs two openers, because the CLI half and the transport half each open
  their own.
- **`mesh-resync.mjs` vs `mesh-recovery-push.mjs` — HONEST at two instances, and the shape is now
  named.** The duplication is near-total in structure: two wire kinds, four identical lifecycle state
  strings, `ensure*Table`, `request*`, `read*`, `list*Requests`, `mark*State`, `build*Frame`,
  `build*ResultFrame`, `apply*ResultFrame`, `run*DispatchTick` — ~270 lines of the same shape with a
  different key column and one deliberate policy difference (recovery-push retries a disconnected
  target forever; resync answers `failed` on the first tick, because an operator is waiting). Extracting
  a "durable request row + directive dispatch + result apply" seam from two instances would be
  premature and would have to be designed around a difference that is the point of the feature. **No
  refactor required. The THIRD instance extracts the seam** — recorded in TECH_DEBT item 10 so the next
  author meets the decision rather than the pattern. One asymmetry the copy did lose and should regain
  cheaply: recovery-push's tick narrates each outcome on the daemon's log channel; the resync tick
  narrates nothing, so a failure the requester's bounded poll already gave up on is written to a row
  nobody reads again.
- **Six test suites are imported by NEITHER runner, four of them a whole accepted story's** —
  `artifact-sync-{drain,enqueue-hook,manifest}` and `claude-settings-merge` are 43/03's behavioural
  suites; they are green when run by hand and have never run in `npm test`. Also orphaned:
  `mesh-ui-write-isolation-bounded` (m25-era, red, tests a retired `/api/mesh/issue` route) and
  `work-observe`. **This story did it right** — its three suites are registered — which is what makes
  the omission visible as a class rather than a habit. **Route: a ratchet is due and is cheap** (every
  `test/**/*.test.mjs` is imported by `scripts/test.mjs` or `scripts/test-unit.mjs`, with the current
  orphan set as a named, shrink-only baseline), and **re-registering 43/03's four green suites is a
  must-fix of this story** — they are four lines in `scripts/test.mjs`, a file this diff already edits,
  which is the health rule's "fits the story" test met exactly. `mesh-ui-write-isolation-bounded` is
  NOT this story's: it is a m25 orphan whose siblings were retired into
  `wiki/work/35_.../reference/retired-dispatch-tests/` and which was missed — ledgered, not fixed here.
  **The ratchet is written and registered** (`test/arch/acd-test-suite-registration.test.mjs`, the
  generalisation of `acd-roundtrip-registration`'s own argument). It is RED as delivered, on exactly
  three things the story still owes: 43/03's four suites, and the two `@ui` suites the in-flight half
  has created but not yet registered (`board-provenance-attribution`, `board-resync-door`) — which is
  the ratchet doing its job on live work rather than a defect in it.

### E8 — ACCEPTS the two smaller judgement calls, and NAMES one thing the module header claims that is not true

- **`cacheFreshness` has no production caller.** The wire carries facts (`syncedAt`, `reportedBy`) and
  the window; every verdict is computed client-side by `ui/src/board/freshness.mjs`. That is the right
  architecture and it is ADR-006's own — but it means `src/`'s "read boundary predicate" is called only
  by its own test, and `cache-provenance.mjs`'s header calling it *"the read boundary's predicate"*
  describes a consumer that does not exist. That is TECH_DEBT item 0's fourth shape, the one this
  milestone's own refine already flagged: a forward-looking claim that reads to the next author as an
  existing contract. **Accepted, with the header corrected to say what is true** — it is the `src`-side
  definition of record, so that a server-side reader (a future CLI freshness view, doctor) has one
  place to reach for and cannot hand-roll a comparison; today its only caller is the test that judges
  the wire the way a client must. **`withProvenance` is exported and called by nothing at all: delete
  it.** An unused export of a one-home module is a second sanctioned way to do the thing.
- **The worker's resync answer ignores the frame's `workspaceId`/`itemRef`** and pushes its launch
  workspace's snapshot, replying `ok: true` regardless. Accepted: the contract is explicitly "it
  reports the CALL, never the DATA", the frame deliberately carries no command, and the honest proof is
  the fresher `syncedAt` arriving. Named here so it is a known property rather than a surprise: a
  resync for a workspace that worker does not have loaded answers `ok` and can never clear the badge,
  which the surface then reports as "no answer" after its watch window — the designed degrade, reached
  by a path nobody wrote down.
- **The fleet face memoises the window for the daemon's whole lifetime** while the board resolves it
  per request. Accepted (the fleet is a machine-wide surface and the memo mirrors `controlNodeId`), and
  recorded: the same configuration change reaches the two faces on different schedules.

---

## ADR-015: SECOND-PASS reconciliation for story 04 — the UI half and the test infrastructure under it. ADR-006's `ui/` clause was held by a detector a RENAME satisfies, so the invariant is re-stated over the SUBJECT; `DetailPanel.tsx` is running `global-work-store.mjs`'s curve and gets B4's answer; the widened `reportedBy` silently retired the m03 empty states; R4.4 said LIFT the clock and the build ADDED one; and ADR-010/R4.1's envelope wording is CORRECTED here rather than edited there

**Status:** Accepted
**Date:** 2026-08-03

**Context.** ADR-014 reviewed story 04's `src/` half and deferred the UI half explicitly. This is
that pass: `ui/src/board/{freshness,resync}.mjs` + `.d.mts`, `StaleBadge.tsx`, the changes in
`Board.tsx` / `DetailPanel.tsx` / `BoardLanes.tsx` / `Overview.tsx` / `api.ts` / `fleet/*`, and the
test infrastructure beneath them — `react-app-harness.mjs` (the surface-agnostic core extracted from
the fleet harness), `fleet-app-harness.mjs` (now a thin wrapper), `board-app-harness.mjs`,
`board-face-fixture.mjs`, `mini-react.mjs`. Rulings are lettered **F**: `D` is ADR-010's defect
ledger, `A`/`B`/`C`/`E` are stories 01–04's build-time rulings, and this milestone has already paid
once for citation ambiguity.

**Measured before ruling.** Every suite was re-run isolated, focused: the four pre-existing fleet
harness consumers (**45 pass**), the story's five `@ui` suites (**52 pass**), its three data-layer
suites plus the Resync transport (**65 pass**), and the touched arch tests (**21 pass**). Nothing
below is inferred from reading alone; the two behavioural findings (F5, F6) were reproduced against
the real mounted board before being written down.

**Codebase-graph grounding.** Rebuilt at this review — `aof graph build src` → **2,429 nodes, 6,190
edges, 114 communities**, built `2026-08-03T13:57:13Z`. `aof graph impact` on the serving surfaces:
`src/cache-provenance.mjs` is a **near-leaf, 5 dependents / 1 import** (`board-ui`,
`board-worker-stream`, `global-mesh-query`, `global-work-store`, `mesh-ui-serve` → `run-store`) —
the one-home shape ADR-014/E4's ratchet assumes is actual, not asserted. `src/board-ui.mjs` is
**1 dependent / 2 imports**, a true face leaf, which is what makes R4.1's "the envelope is a face
concern" cheap. `src/board-worker-stream.mjs` is **5 dependents** (`continue`, `doc`, `list`,
`run-status`, `tasks`) — so the provenance stamp added there reaches five commands, which is why F3
matters. The graph does not cover `ui/`; the `ui/` coupling cited below is measured by grep and is
labelled as such.

### F1 — RULES question 3: `acd-cache-staleness-single-predicate`'s `ui/` clause holds the window's WIRE NAME, not ADR-006's invariant. It is satisfiable by a rename, MEASURED, and is now re-stated over the SUBJECT

ADR-006 says **"exactly ONE module in `ui/` evaluates freshness"** and **"`ui/` carries no default and
no literal."** The detector proved both by counting files that mention the identifier
`stalenessSeconds`.

**Measured at this review, not argued.** A complete second evaluator —
`const stale = now - Date.parse(row.syncedAt) > windowSeconds * 1000;` — mentions
`stalenessSeconds` nowhere and passes every clause in the file. This is not a contrived evasion:
`windowSeconds` is what **every** downstream consumer in `ui/` already calls the number
(`Board.tsx`, `Fleet.tsx`, `StaleBadge.tsx`, `freshness.d.mts`), so the renamed spelling is the
*natural* one for a second evaluator to be written in. The literal half is evadable the same way:
`const FIVE_MINUTES = 300; const w = envelope.stalenessSeconds ?? FIVE_MINUTES;` passes.

- **What the detector DOES hold is real and is kept**: exactly one module in `ui/` knows the wire
  field's name, so no other module can read it, default it, or grow a second copy of it. That is a
  genuine structural fact and it is why `readStalenessWindow` exists.
- **What it does NOT hold is the clause ADR-006 actually states.** A sameness property proved by
  counting one identifier is proved against the spelling, not against the behaviour.

**Ruling: the invariant is re-stated over the one thing a second evaluator cannot rename away — the
INSTANT it must read to have an opinion at all.** Only `ui/src/board/freshness.mjs` may read
`syncedAt` off a record (member access, bracket access or destructuring); handing the **whole
record** to the ramp is not a read and stays legal, which is exactly what every legitimate consumer
does today. Written, green as delivered with exactly one hit (the one home), self-checked against
the renamed evaluator, the destructured and bracket spellings, the legal whole-record pass-through,
and the wire TYPE declaration in `api.ts` which must stay legal. The scan also gains `.mts`, which
was invisible to every clause in the file.

**The general rule this earns, because the milestone has now met it twice:** ADR-014/E4 found the
same shape from the other side — a clause proved BEHAVIOURALLY that could only show the mapper
agreeing with itself. **A sameness invariant ("exactly one X") is held by a detector keyed on the
SUBJECT of X, never on the spelling of one identifier that today's implementation happens to use.**
A detector that a rename satisfies is a detector that measures the author's vocabulary.

### F2 — RULES question 5: `DetailPanel.tsx` IS repeating `global-work-store.mjs`'s trajectory, one layer over. `ProvenanceLine` must move to its own module, and `ui/` gets the ratchet `src/` already has

Measured from this repo's own history (`git show <rev>:<file> | wc -l`), continuing ADR-014/E7's
table into `ui/`:

| file | m03 (06-21) | m26 (07-02) | 07-30 | 43/03 | **43/04** | Δ this story |
|---|---|---|---|---|---|---|
| `ui/src/board/DetailPanel.tsx` | 434 | 707 | 814 | 839 | **1,123** | **+284 (+34%)** |
| `ui/src/fleet/Fleet.tsx` | — | 508 | 1,463 | 1,463 | **1,521** | +58 |
| `ui/src/board/Board.tsx` | 315 | 367 | 437 | 485 | **581** | +96 |
| `ui/src` files | 29 | 33 | 48 | 48 | **53** | +5 |

**`DetailPanel.tsx` grew more in this ONE story (+284) than in the entire month before it (+132),
and crossed 1,000 lines in that diff.** That is ADR-012/B4's curve verbatim (885 → 1,233 in one
story), which is itself `mesh-worker-execution.mjs`'s curve (TECH_DEBT item 10) — "one justified
block at a time, with no single diff ever looking wrong."

**And the escape hatch was available and taken three times in the same story.** The freshness ramp's
pure logic went to `freshness.mjs`; the Resync state machine to `resync.mjs`; the badge and both
legends to `StaleBadge.tsx`. That discipline is exactly right and it is most of why this story is a
good one. What did not follow it is **`ProvenanceLine`** — a ~180-line self-contained component with
four hooks, a clean prop boundary (`item`, `freshness`, `pollMs`, `onResyncWatch`), its own pure
module already extracted, its own two behavioural suites, and a sibling (`StaleBadge.tsx`) that is
precisely the right home shape. It landed as a **block inside** `DetailPanel.tsx`. Same story, same
author, both moves on the table — which is what makes this a ratchet worth setting rather than a
judgement worth repeating.

**Ruling, two parts:**
1. **`ProvenanceLine` (and its Resync wiring) moves to its own module** — a required outcome of this
   review, not a wish. It fits the story by the health rule's own test: same files, no scope
   explosion, mechanical move, and the harness addresses the rendered provenance row **structurally**
   (by class signature and `aria-live` role, never by component identity), so the existing suites
   prove the move behaviour-preserving without being touched.
2. **`acd-ui-surface-file-budget` is written**, the `ui/` twin of ADR-012/B4: a NAMED table of the
   surface modules this milestone measurably enlarged, each with its own ceiling and reason.
   `DetailPanel.tsx` → **1,000** (below the delivered 1,123 on purpose — a ratchet that ratifies the
   size it was raised against is decoration; post-extraction the file lands near 950, leaving real
   headroom without dictating the shape of the move). `Fleet.tsx` → **1,560**, just *above* its
   delivered 1,521, and that asymmetry is deliberate: this story added 58 lines there, so its size
   is a debt 43/04 did not create and must not be made to pay; the ceiling holds the line for the
   next author. **`Board.tsx` is deliberately NOT capped** — it is the composition ROOT, its +96 is
   almost entirely prop threading and two effects, and capping a root pushes state back down into
   the leaves, which is the opposite of the shape being protected. That reason is recorded in the
   test so a later reviewer meets the decision rather than the omission.

**ADR-014/E3 binds here verbatim and is restated in the file:** a ceiling is a proxy for structural
cost, and trimming rationale to fit under it raises the real cost while lowering the measured one.
The sanctioned response is always another module.

**The ratchet is RED as delivered, on exactly the one thing this review requires.** That is the same
posture E7 took and for the same reason: a ratchet doing its job on live work is not a defect in the
ratchet.

### F3 — RULES question 4: the developer is RIGHT. `nodeId` on the list envelope is OUT of the one-mapper ratchet's scope, and the boundary is pinned here so it is not relitigated

The claim under test: `/api/work/list` now answers `{ items, stalenessSeconds, nodeId }`, and
`nodeId` is the serving surface's own identity rather than a wire provenance key, so ADR-014/E4's
ratchet does not reach it.

**Verified at source, and the reasoning holds on three independent grounds:**

- **Different SOURCE.** E4's ratchet forbids building a `reportedBy`/`syncedAt` wire key out of a
  STORAGE spelling (`node_id`/`nodeId`/`updated_at`/`updatedAt`). The envelope's `nodeId` is read
  from `workspace.config?.mesh?.nodeId` (`board-ui.mjs:89`) — the loaded workspace's config, over
  which `loadWorkspace` has already overlaid the per-install identity sidecar (verified in
  `work.mjs:87-128`). It never touches `work_items`, so there is no storage→wire translation to
  perform or to duplicate.
- **Different SUBJECT, and this is the load-bearing one.** A row's `reportedBy` answers *"which node
  authored this copy"* — a per-row FACT. The envelope's `nodeId` answers *"which machine is serving
  this read"* — the QUALIFIER a reader applies to those facts, and one fact for the whole response.
  They are the same *shape* of datum about categorically different subjects, and the milestone has
  already been burned once (E4) by exactly the opposite error: two different facts sharing one wire
  key. Putting them under one rule would be that mistake with the sign flipped.
- **Structurally identical to `stalenessSeconds`, which R4.1 already ruled on.** Both are one fact
  for the whole response; both would be a second spelling of one fact if carried per row; both are
  face concerns and leave the command result byte-identical. `nodeId` is not a new envelope
  precedent — it is R4.1's precedent applied a second time, on the same route, in the same diff.

**Ruling: `nodeId` is a SURFACE-IDENTITY key, not a provenance key, and the one-mapper ratchet
correctly does not see it.** The boundary, stated once so the next author has a rule rather than a
precedent to interpret: **a key whose subject is the ROW is provenance and goes through
`cache-provenance.mjs`; a key whose subject is the RESPONSE is an envelope concern and is resolved
by the face.** `reportedBy`/`syncedAt` are the first kind; `stalenessSeconds`/`nodeId` are the
second.

**Two things NOTED rather than required, because neither is this story's to pay:**
- **The discipline was applied asymmetrically in `ui/`.** `stalenessSeconds`' wire name is
  deliberately *not* spelled in `api.ts` — `readStalenessWindow` is its one reader — while `nodeId`
  IS declared on `WorkListEnvelope` (`ui/src/board/api.ts`). So a future author can read
  `envelope.nodeId` directly off a typed envelope without going through `readCacheNodeId`, which is
  the one-reader property `stalenessSeconds` has and `nodeId` does not. Harmless today (one reader
  exists), and the honest note is that the two keys are protected to different standards.
- **`config.mesh.nodeId` is read by raw optional-chain in seven places in `src/`**
  (`board-ui:89`, `mesh-ui-serve:235`, `mesh-assignment:165`, `continue:148`, `commands/resync:136`,
  `mesh-identity:255`, plus `meshNodeIdOf` in `commands/mesh-gate.mjs`). `board-ui.mjs:89` is one
  more instance of a pre-existing idiom, correctly justified at the call site by the layering rule
  (`acd-command-layer-imports-downward` forbids a face importing `src/commands/`). Not a regression,
  and not a new home — but "this node's identity" genuinely has no single home below the command
  layer. Ledgered, not fixed here.

### F4 — RULES questions 1 and 2: the harness extraction is drawn in the right place and the fleet's four consumers are unweakened — MEASURED, not merely green. The opt-in `Date.now()` takeover is the right seam, with one condition that is now stated

**The boundary.** `react-app-harness.mjs` keeps what is surface-agnostic (bundle the real `.tsx`,
substitute only what React itself provides, instrument every request, run a controllable clock);
each surface harness supplies exactly three things — its ENTRY + export name, its STUBS, its
ACCESSORS. That is the correct cut. The evidence it is correct is that the board harness needed
**zero** new core concepts to exist: it declares two stubs and its accessors, and everything else it
needs was already surface-agnostic. A boundary that a second consumer lands on without pushing back
into the core is a boundary drawn at the right place.

**"Unweakened" was checked as a claim about the OBSERVATION SURFACE, not about the suites' colour.**
Green would prove only that today's assertions still pass; a harness that quietly narrows what it
can *see* is green on the day it is weakened. Compared function-by-function against
`HEAD:test/support/fleet-app-harness.mjs`:

- The driver is a strict **superset**: every member the old harness exposed (`clock`, `flush`,
  `renderOnly`, `tree`, `requests`, `holdNext`, `advance`, `advanceHeld`, `statusLoads`,
  `assignPosts`, `cards`, `cardByTitle`, `affordance`, `affordanceIn`) survives with the same name,
  and `requestsMatching` is added.
- Every accessor BODY is byte-equivalent modulo `renderer.tree()` → `driver.tree()` (the same
  function) and `flush()` → `driver.flush()` (the same closure). `statusLoads`/`assignPosts` are
  re-expressed through `requestsMatching`, whose filter is the identical `url.includes(fragment)`.
  Not one predicate was loosened, not one assertion-bearing field (`selectStyle`, `actionSizerStyle`,
  `rowChildTypes`, `messageTitle`, `pickerPlaceholder`) was dropped.
- The two behavioural additions are inert for the fleet: `settle` defaults to `"flush"` (the old
  unconditional behaviour) and `hash` defaults to `""` — and `location.hash` is read by
  `Board.tsx` only, never by `Fleet.tsx` or its siblings (grepped).
- **45 assertions across the four consumers pass unmodified**, and the suites themselves are
  untouched by the diff.

**Ruling: the extraction is sound and the four consumers are genuinely unweakened.**

**Question 2 — the clock.** `createClock({ epoch })` taking `Date.now()` is the **right seam**, and
the reason is that no cheaper one exists: the board's freshness ramp is a function of wall-clock
time, so "the badge appears within one second of the crossing" cannot be driven by advancing timers
alone — the tick would fire while `Date.now()` stood still and the assertion would measure nothing.
It is well built: **opt-in** (`epoch` absent ⇒ `Date` untouched, so the fleet is byte-unaffected),
**narrow** (`Date.now` only, never the `Date` constructor, so `new Date(iso)` and `Date.parse` — how
every timestamp on these wires is read — keep real behaviour), and **restored** in the `finally`.

**But it is a process-global takeover in a fixture that runs the REAL server in the SAME process,
and that condition must be written down rather than discovered.** `Date.now()` is patched for
everything in the process, including `src/` code the in-process face executes while a lane holds the
clock. It is safe today for a measured reason: `BOARD_EPOCH` is a plausible near-present instant
(`2026-08-03T12:00:00Z`), and the fixture's own daemon-side work is `new Date()`-based rather than
`Date.now()`-based. **PINS: an epoch-owning harness must use a plausible near-present epoch, never a
fictional or zero datum**, because the blast radius of the takeover is the whole process and not the
component under test. Recorded as a property, not a hazard.

**One latent trap in the same area, and it is a one-line fix.** `board-face-fixture.mjs` captures
`realSetTimeout` at module load — explicitly, with a comment explaining that the control daemon must
tick on the machine's clock and not the board's — and then arms its drain with a **bare
`setInterval`** (`:356`), which resolves to `globalThis.setInterval` at call time and is therefore
the *fake* one for any lane that calls `controlTick()` after mounting. Every lane today calls it
before `withBoardApp`, so the file is correct by call-order convention while its own header states
the property as structural. **Required: capture `realSetInterval` beside `realSetTimeout`.** The
asymmetry is an oversight, not a design, and the failure it would produce — a drain that only runs
when the board's clock is advanced — is precisely the ordering the comment says the real system
never has.

### F5 — RULES a REGRESSION the story's own suites cannot see: widening `reportedBy` to every cache-published row silently retired the m03 designed empty states, and the discriminator that fixes it is one this story itself introduced

Before 43/04, `reportedBy` reached a `WorkItem` only for worker-streamed rows. After it,
`applyCachedProvenance` stamps **every** row the cache publishes — including the control's own. Two
call sites in `DetailPanel.tsx` gate on that key's mere presence:

- `DocMarkdown` (`:697-698`) — `const node = reportingNode(item); if (node) return <CachedDocAbsent …/>;`
- `RunsEmpty` (`:1077`) — the same test.

Its own comment says *"a plain local item keeps its own m03 copy, unchanged."* **Measured against the
real mounted board, that sentence is now false on every mesh-enabled workspace — which is this
repo, and every operator's control node:**

```
mesh-enabled, this node published its own rows:
  VERIFICATION absent  : "No cached VERIFICATION yet — aof-control has not reported one."
  RETROSPECTIVE absent : "No cached RETROSPECTIVE yet — aof-control has not reported one."
  RUNS empty           : "No cached run history yet — aof-control has not reported one."
mesh NOT configured (the only path that still reaches the m03 copy):
  VERIFICATION absent  : "Not verified yet — run aof:verify (Run agent)"
  RUNS empty           : "No runs yet / This item hasn't been run."
```

The regression is not cosmetic. The replacement copy **states something untrue** — it tells the
operator a reporting node failed to report an artifact, when the truth is that this machine's own
item simply has no VERIFICATION yet — and it **deletes the call to action** (`run aof:verify (Run
agent)`) that the m03 state existed to give. It is the same class of defect the story is
congratulated for fixing at the other end: `RemoteContentNotice` was retired precisely because *"its
old copy became FALSE the moment the cache became the read surface"*. This is that mistake made
again, in the replacement, in the same diff.

**Ruling: must-fix, and the discriminator is already on the wire.** `CachedDocAbsent` is correct
exactly when the artifact lives on **another** machine; the test is therefore
`reportedBy != null && reportedBy !== thisNode` (or `fromWorker`), not `reportedBy != null`.
`thisNode` is the envelope's `nodeId`, read by `readCacheNodeId`, already resolved in `Board.tsx` and
already threaded as far as `freshnessOf` — so the fix is threading one existing value one level
further, not new machinery. **AC 11's `(this node)` and this branch are the same fact asked twice;
they must be answered from the same source.**

**And the coverage lesson, which is the reusable half:** every lane in
`board-provenance-attribution` and `board-resync-*` states a REMOTE reporter (`umairs-mac-mini`), so
the whole suite is blind to the case where the reporter is this node — which is the *common*
deployment, not the exotic one. A surface whose behaviour forks on "is this row mine" needs at least
one lane on each side of that fork.

### F6 — RULES the second cosmetic clock: ADR-010/R4.4 said LIFT the tick, the build ADDED one. The added tick is provably redundant, and the comment claiming "one number" is not true

R4.4's words were *"it exists only inside `DetailPanel`'s runs section and `Fleet.tsx:72` … **Lifting
it a level** is real work and it is required."* What landed is a new root tick in `Board.tsx`
(`CLOCK_TICK_MS = 1000`) with `RunsTab`'s own `setInterval(() => setNow(Date.now()), 1000)`
(`DetailPanel.tsx:880`) left in place — so `ui/` now runs the same cadence from **three** homes with
**three spellings**: `CLOCK_TICK_MS` (Board), a bare `1000` literal (RunsTab), `CLOCK_MS` (Fleet).
`Board.tsx`'s own comment asserts *"one number, so the surfaces cannot drift apart."* That claim is
not true of the code beneath it — TECH_DEBT item 0's fourth shape, which ADR-014/E8 named in this
same story.

**And the second tick is not merely duplicative, it is redundant — measured.** `now` is `Board`
state, and neither `DetailPanel` nor `RunsTab` is memoised, so the root tick already re-renders the
runs section every second. `RunsTab`'s own interval buys nothing except a second render pass per
second and a `now` that drifts out of phase with the root's.

**Ruling: must-fix, and the fix is the one R4.4 asked for.** Thread the root's `now` (or its `nowIso`)
from `Board` through `DetailPanel` to `RunsTab` and delete the local interval — both files are
already in this diff, so it fits the story by the health rule's own test. `Fleet.tsx` keeps its own
tick and correctly so: it is a **separate application root**, not a second home inside one tree.

**The rule, stated because "lift" was read as "add":** *lifting* a derivation a level means the lower
one **goes**. A derivation that exists at two levels of one tree is two homes for one fact, and the
higher one does not become the single home merely by being higher.

### F7 — CORRECTS ADR-010/R4.1's wording. The DECISION is unchanged and was followed; the envelope is three keys, not two — and the correction lands HERE because an ADR is superseded, never edited

R4.1 states *"`/api/work/list` responds with an envelope (`{ items, stalenessSeconds }`)"*. The
delivered envelope is `{ items, stalenessSeconds, nodeId }`.

**The decision R4.1 made is unchanged and was honoured exactly**: the wire envelope is a FACE
concern, and `work:list`'s command result and `aof work list --json`'s flat array stay
byte-identical — re-verified at this review (`acd-work-list-contract`'s exact key-set equality plus
the story's spawned-CLI scenario, both green). Only the enumeration of the envelope's keys drifted,
because `nodeId` was added later by AC 11 and F3 above rules it in scope of R4.1's own rule.

**Ruling: `/api/work/list`'s envelope is `{ items, stalenessSeconds, nodeId }`, and R4.1 is read
subject to this correction.** The correction is recorded as a ruling rather than as an edit to
ADR-010's body, and that is not pedantry: this milestone's own practice is already exactly this —
ADR-010/R1.2 corrected ADR-003's citation *by ruling*, and ADR-012/B1 narrowed ADR-011/A1 the same
way. An ADR is a dated record of what was decided with what was known; silently rewriting one
destroys the only evidence that the contract ever moved, which is precisely the argument ADR-014/E1
made for amending m08's locked scenario rather than editing it. **The document is mine to correct;
the mechanism for correcting it is a new numbered ruling.**

### F8 — RECORDS the two flags withdrawn mid-review, with the ONE material qualification the withdrawal does not cover

Both were handed to me as findings and both were withdrawn while this review was in flight. Both
withdrawals are ACCEPTED. They are recorded because a flag that is raised and dropped without a
record is a flag the next reviewer raises again.

- **`node.local` "has no producer" — FALSE, and my own first grep was wrong too.** It is produced at
  `src/commands/mesh-identity.mjs:~343` (`if (localId != null && id === localId) node.local = true;`)
  off `ws.config.mesh.nodeId` (`:255`). My initial search was for the object-literal spelling
  `local:` and could not have found an assignment; the correction is right and the premise it
  corrects was mine as much as anyone's. **The qualification, which is measured and is not covered by
  the withdrawal:** the only consumer of `node.local` in the web fleet is `NodeCard`
  (`ui/src/fleet/Fleet.tsx:1069`), and `NodeCard` **never mounts there** — the codebase records this
  in its own words at `Fleet.tsx:951-954` (m38 finding F9): *"mesh-ui-serve.mjs serves BOTH scopes
  from queryGlobalMeshStatus, so isGlobalStatus(status) is always true and NodeCard/NodesRegion never
  mount there."* The card that DOES render, `GlobalNodePanel`, reaches `node.local` only through
  `nodePanelFacts`' fallback (`ui/src/fleet/scope.mjs:215`, `role ?? (local ? "this node" : null)`),
  and `shapeGlobalStatus` — the shaper that builds the global payload — sets neither `local` nor a
  serving-node identity, so that slot resolves to the registry's `role` (`"control"`/`"worker"`),
  which is a different fact. **Consequence, and it is the useful part:** the narrower coverage lane
  proposed in place of the withdrawn flag — a check that the fleet's `this node` tag and the board's
  new `(this node)` clause agree about the same machine — **is not writable today**, because the
  fleet payload carries no local marker at all. Writing it needs `shapeGlobalStatus` to state the
  serving node's identity the way `/api/work/list` now does. **Route: ledger** (TECH_DEBT item 18),
  named with that prerequisite. Not story 04's, whose fleet clause is badge + `title` only.
- **The 360px badge yield — WITHDRAWN by DESIGN, and I agree with the reasoning on both legs.**
  Verified independently: the fleet milestone grid is
  `grid-cols-[repeat(auto-fill,minmax(320px,1fr))]` (`Fleet.tsx:482`), so a wider viewport buys
  COLUMNS rather than card width and a viewport-keyed yield is genuinely incoherent there; and the
  badge carries no `mono` class (`text-[11px] font-semibold`, the body face), so an m38-style `ch`
  budget — honest only because its datum is monospace, where `ch` is the exact advance — would be
  false precision. **The form is chosen by the SURFACE, not the viewport** is the right rule and it
  needs no mechanism, so there is no structural gap to route. **The structural residue that DOES
  remain is one line of prose:** `freshness.mjs:41-42` still describes `BADGE_FORMS` as *"the badge's
  three forms and their PINNED yield order"*, which now documents a yield DESIGN has withdrawn, and
  `minimal` has no painter. A reserved rung with a binding `role="img"` + `aria-label` contract and a
  test that pins it is legitimate — that is not E8's unused-export case, because it is a distinct
  rendering rather than a second way to do the same thing — **but it must read as RESERVED rather
  than as a live ladder.** Reword required; the export stays. (`StaleBadge.tsx:120`'s
  `export { BADGE_CLASSES, BADGE_FORMS }` has no importer at all and IS E8's case: delete it.)

### F9 — RULES the remaining codebase-health findings, each with its route

- **`ui/src/board/` has become the de-facto shared UI library, and nothing says so.** `ui/src/fleet/`
  now reaches into it seven times (`runs.mjs`, `status.tsx`, `api.ts` types, and this story's
  `freshness.mjs` ×2 + `StaleBadge.tsx`), up from four — while `ui/src/components/` and `ui/src/lib/`
  exist and are the nominal shared homes. Putting the FIFTH ramp, which both surfaces paint, inside
  one surface's folder is the right call *today* (it keeps the ramp beside the four it must not be
  confused with) and the wrong one *eventually*. **Route: ledger** (TECH_DEBT item 18) with the
  trend, not a refactor: moving five modules is a scope explosion inside a story, and the cure —
  `ui/src/ramps/` or an honest `ui/src/shared/` — is a decision, not a tidy-up.
- **`acd-test-suite-registration` matches a basename anywhere in the runner's TEXT**, so a suite
  named only in a comment counts as registered. Green today (verified: no such false positive), and
  the runners are heavily commented with suite names, so the hole is live. **Route: hardening note**
  — match an import specifier rather than a bare basename. Cheap; not blocking.
- **`bundleSurface`'s cache key is `entry + stub NAMES`** (`react-app-harness.mjs:71`) and omits the
  `resolve` patterns, so two callers with the same entry and stub names but different resolve
  filters would silently share a bundle. Unreachable today (distinct entries). **Route: hardening
  note.** The `for (const entry of resolve)` loop variable also shadows the destructured `entry`
  parameter in the same function — legal, and one rename from being a real bug.
- **The `mesh:resync` tick now narrates on the daemon log channel** (`[mesh-resync] … dispatched` /
  `… marked failed (resync-owner-not-connected)`, observed in every transport lane). That is
  ADR-014/E7's "one asymmetry the copy did lose and should regain cheaply" — **paid**.
- **`src/` health is unchanged by this half**: no `src/` module grew, `global-work-store.mjs` holds
  at 1,276/1,280, and no new root sibling was added. The UI half added five files to `ui/src`
  (29 → 53 since m03), four of which are the story's own new modules and their declarations — every
  one of them an extraction, which is the shape this review wants and F2 is protecting.

**Consequences.**
- ADR-006's `ui/` clause is held by a detector a rename cannot satisfy, and the milestone now has a
  stated rule (F1) covering both times it made this mistake.
- `ui/` gains the file-budget ratchet `src/` has had since ADR-012/B4, scoped to two named modules
  with the composition root deliberately exempt and the reason recorded.
- Two behavioural regressions the story's own suites are structurally blind to (F5, F6) are caught
  before the gate, both fixable with values the story already computes.
- R4.1's envelope is corrected on the record without an ADR being edited, and F3 pins the
  row-vs-response boundary so the third envelope key does not need a fourth ruling.
- Two withdrawn flags are recorded with the one qualification the withdrawal did not cover, and the
  coverage lane proposed in place of one of them is shown to be unwritable until the fleet payload
  states its serving node.

---

## ADR-016: Build-time reconciliation for stories 05 and 06 — the m03 CLI contract is UPHELD and the stamp is stripped at the CLI face (R4.1 for the third time); a symbol-only pin is satisfied by any surviving occurrence, so every pinned reader now carries its SUBJECT; the worktree guard closed ONE of two cache-read doors and `work:doctor` is the other; the overlay reached `freshnessGroup` through its status GATE, which ADR-005 declared disk-only; and the presence tick regressed from one disk scan to 2N store opens

**Status:** Accepted
**Date:** 2026-08-04

**Context.** Story 05 landed committed (`573c18c`): `advanceBranchToBase` in `mesh-worktree.mjs`, the
reuse door's pin gate and advance call site in `mesh-worker-execution.mjs`, four suites. Story 06 is
uncommitted and shares one working tree with story 04's own still-uncommitted half — a fact this
review had to establish before it could attribute anything, and which is recorded here because it
shaped every measurement below. Rulings are lettered **G**: `D` is ADR-010's defect ledger,
`A`/`B`/`C`/`E`/`F` are stories 01–04's, and this milestone has already paid twice for citation
ambiguity.

**Measured before ruling, isolated and focused throughout.** 43/05's four suites — **19 lanes, all
pass**. 43/06's five — **56 lanes, all pass**. The amended collateral (`board-face-contract`,
`board-api`, `command-core-contract`, `work-ui-board-serves-unchanged`,
`staleness-cached-rows-provenance`, `cache-authority-own-disk-read`, `board-mesh-execution`) — **114
lanes, all pass**. The milestone's arch tests (`acd-test-suite-registration`,
`acd-cache-read-surface-boundary`, `acd-gate-propagation-never-discards`,
`acd-cache-staleness-single-predicate`, `acd-ui-surface-file-budget`) — **19 lanes, all pass**.
`acd-work-list-contract`'s exact-key lane is **RED**, on `answeredFrom`, reproduced. Two behavioural
findings (G4, G5) and one regression (G7) were reproduced against real fixtures before being written
down; nothing below is inferred from reading alone.

**Codebase-graph grounding.** Rebuilt at this review — `aof graph build src` → **2,454 nodes, 6,135
edges, 120 communities**, built `2026-08-04T11:28:08Z`. `aof graph impact` on the surfaces under
review: `src/work-read.mjs` is **12 dependents / 4 imports** (`work`, `degrade`,
`board-worker-stream`, `mesh-worktree`); `src/commands/resolve.mjs` is **10 dependents** — ADR-005
cited 8, and `mesh-issue` + `notion-associate` have joined since, so the chokepoint is *larger* than
the decision assumed, which strengthens rather than weakens it; `src/work.mjs` still **imports only
3** and its `src/` importer count fell **34 → 25** (measured by grep at `6b4ab7f` vs the working
tree) — this is the first story in the milestone that SHRINKS the god-node's blast radius, and it is
the single best structural fact in the diff. `src/board-worker-stream.mjs` went **5 → 9 dependents**
and now serves the spine (G8).

### G1 — RULES the cross-milestone collision: cure (b). The stamp is stripped at the CLI `json` adapter; m03/ADR-002 is UPHELD, not amended. The recommendation is CONFIRMED, and on a ground the recommendation did not state

`test/arch/acd-work-list-contract.test.mjs:114` asserts every `aof work list --json` element's key
set is EXACTLY m03's seven fields. `src/commands/list.mjs:111` is `json: (rows) => rows`, and `run`
now returns seam-stamped rows, so the stamp reaches the frozen array. Reproduced: `element 03 has
exactly the seven contract fields, got [answeredFrom, dir, parent, ref, slug, status, title, type]`.

**Confirmed: strip at the face (cure b). Three reasons, the third of which is decisive and is new.**

- **This milestone has already ruled this exact question twice, on this exact route.** ADR-010/R4.1:
  the wire envelope is a FACE concern, and `work:list`'s result and its `--json` flat array stay
  byte-identical — which is why `stalenessSeconds` went on `/api/work/list` and never on the CLI
  array. ADR-015/F7 re-verified it when `nodeId` was added. A third enrichment on the same route
  decided the other way, by a leak rather than a decision, would make R4.1 a rule that holds only
  until it is inconvenient.
- **ADR-005's own words place the fact on the face.** "Every row says which side answered it, **which
  is the same fact DESIGN renders**." DESIGN renders it on the board. The board keeps it: verified,
  `board-ui.mjs:86-90` builds its envelope from `invoke("work:list")`'s result and never touches the
  CLI adapter, so stripping there is invisible to every face DESIGN specifies.
- **THE DECISIVE GROUND, measured: cure (a) would freeze a VARIABLE-WIDTH contract.** The stamp is
  not one key. A disk-answered row carries `answeredFrom` alone; a cache-answered row carries
  `answeredFrom` + `reportedBy` + `syncedAt` (`work-read.mjs:228-232`, by design — rule 3's
  "unobserved freshness is never fabricated"). So `aof work list --json`'s key set would depend on
  whether the machine has a mesh cache and whether that cache holds the row. Amending m03/ADR-002 to
  "the seven plus the stamp" would therefore have to mean "the seven plus up to three optional" —
  which retires the EXACTNESS of an assertion that has caught two regressions, and replaces a
  machine contract with a machine contract-shaped range. **A frozen contract whose width varies by
  deployment is not frozen.**

**REJECTED: cure (a).** Amending a done milestone's ADR to accommodate a newer one is sometimes right
— ADR-014/E1 ruled exactly that for m08's locked scenario, where the route's envelope genuinely
moved and the amendment RECORDED the move. This is the opposite case: nothing about the CLI array
needed to move, and the amendment would be recording an accident.

**The cost, stated so it is a decision and not an omission:** `aof work list --json` becomes the ONE
read whose rows do not say which side answered them. Task 02's two lines that assert it there
(`…/02_control-side-leaves-migrate-independently.feature:157,165`) are answerable from
`aof work find --json`, `aof work next --json` and `/api/work/list`, all of which keep the stamp and
all of which the same scenarios already exercise. **Two conditions on the strip, both required:**
1. **It is a face projection with its reason at the projection**, naming R4.1 and m03/ADR-002 — the
   `find`/`next` adapters' own precedent (`find.mjs:79` already projects `dir`). The command RESULT
   keeps the stamp; only `cli.json` strips it. Anything else is a second authority.
2. **The strip must be pinned to the CLI face alone.** `acd-work-list-contract` keeps its exact-key
   lane; `board-face-contract` and `board-api` keep `assertAnswersFrom` on the route. A future
   author who "tidies up" by stripping at `run` breaks the board, loudly.

### G2 — RULES the relocated pin, and the rule it earns: a pin keyed on a SYMBOL is satisfied by any surviving occurrence of that symbol. **AMENDED at this review; the amendment is mine and is written**

Independently verified. `acd-cache-read-surface-boundary`'s `WORKER_SIDE` pinned
`src/global-work-store.mjs` for `listItems`, to protect what ADR-005 (b) names *"the WORKER-side
content read"* — `readWorkspaceContentRecords`, ADR-005's `global-work-store:601`. **That function
moved to `src/work-content-read.mjs` at 43/03** (`5f4ba67`; it imports `listItems` at `:18` and calls
it at `:41`). The pin has been passing ever since on `global-work-store.mjs:983` — inside
`readWorkspaceProjectionItems`, the publish path's own disk scan, which ADR-005 explicitly classes as
**not** a reader that must migrate. Green detector, relocated guarantee.

**Ruling, and it is a general one: every positive pin names its SUBJECT, and fails when the subject
leaves the module.** This is ADR-015/F1 from the other side — F1 ruled that a sameness invariant must
be keyed on the subject rather than on a spelling, because a *rename* satisfies a spelling detector.
G2 is the same defect produced by a *move*: the spelling stayed and the subject left. **Stated once
for the milestone: a positive pin must fail on BOTH — a rename of what it measures and a relocation
of what it protects.**

**Written and green (5 lanes).** Each `WORKER_SIDE`/`STRUCTURAL` entry now carries the function whose
read is pinned, and the pin fails with "…has MOVED; re-point the pin at its new home, never delete
it". Three further corrections landed with it, all found by the anchor:
- `src/work-content-read.mjs` (`readWorkspaceContentRecords`) is pinned — ADR-005 (b)'s subject, at
  its real home.
- `src/global-work-store.mjs` is KEPT but honestly re-labelled as the **dual-use self-report read**
  (`readWorkspaceProjectionItems`), which is what it always was.
- **`src/mesh-launcher.mjs` is ADDED to `WORKER_SIDE`** (`startLauncher`, the read at `:1532` that
  builds the active worktree's stream frame). It was pinned by NOTHING — the module's own comment at
  `:35` says the import "must stay", and a rule living in a comment is not a rule. The launcher's
  *other* read correctly migrated, so this module is precisely where a later "finish the migration"
  would land.
- The self-check reproduces the measured hole: a module that keeps the symbol but has lost the
  subject passes the symbol pin and fails the anchor.

### G3 — CONFIRMS finding 3, and CONFIRMS the store-opener claim

`acd-test-suite-registration` is **green** (2 lanes): all nine new suites plus 43/03's four orphans
are imported by `scripts/test.mjs`. ADR-014/E7's must-fix is paid and its ratchet is armed.

**TECH_DEBT item 12 holds at 19** — verified by enumeration, not by report: exactly 19 modules name
`openGlobalWorkProjectionStore`, unchanged from 43/04. The three new cache readers
(`readCachedItemRows`, `readCachedActiveRunIds`, `readCachedWorkFacts`) went into
`board-worker-stream.mjs` under its existing `withProjectionStore` rather than opening a twentieth.
**That was the right call and it is the behaviour the ratchet wanted**, and it is why G7 and G8 below
are about that module rather than about a new one.

### G4 — RULES question 2: the seam is the right home for the ENFORCEMENT, but `isMeshWorktree` is a WORKSPACE fact with one door guarded and one open. **`work:doctor` inside a worktree is the open one — MEASURED**

The defect the developer found by mutation is real and the guard closes it: measured at this review,
`findWorkCacheFirst` inside a materialised worktree answers `answeredFrom: "disk"`, status `done` —
the worktree's own value — while the cache says otherwise. The predicate itself is correct: four
levels up from `<origin>/.aof/mesh/worktrees/<id>` is `<origin>`, and it reuses
`isUnderMeshWorktreesRoot`, m35/ADR-004's one definition, rather than re-spelling the convention.

**But the guard is placed on the READ, and the fact is about the WORKSPACE — so it protects only the
readers that go through this seam.** `src/commands/doctor.mjs:118` calls `readCachedWorkFacts`
**directly**, bypassing `work-read.mjs` entirely. Measured, against the story's own fixture, inside a
worker's own worktree:

```
SEAM   (work find):                 answeredFrom "disk", status "not-started"   ← guarded
DOCTOR (readCachedWorkFacts):       rows = [07, 07/01], status "in-progress"    ← NOT guarded
  → findings: cache-status-divergence ×2, plus started-story-no-tasks fired only
    because the OVERLAID status made a not-started story read in-progress
```

`selfNode` inside the worktree is the worker — the same node that reported the row — so
`reportedElsewhere` is false and `cache-status-divergence` fires on every item whose worktree disk has
moved ahead of the last stream tick, which is the normal mid-phase state. **Two false findings and a
third knock-on, in the checkout an agent is working in, from the door the guard does not cover.**

**Ruling: MUST-FIX. The enforcement stays at the seam; the PREDICATE gets one home and every
cache-read door consults it.** `isMeshWorktree` is currently a module-private function in
`work-read.mjs` (`:110`). It must be a named export of one module, and `commands/doctor.mjs`'s read
must consult it — degrading to `cache: null`, which `doctorWork` already treats as "no overlay" and
which therefore costs no new control flow. **The general rule, because this milestone keeps meeting
it: a guard that answers a question about the WORKSPACE belongs where every consumer of that
workspace can reach it; placing it inside one reader makes it a property of that reader.** Whether
the guard ultimately lives in `withProjectionStore` (covering every cache read at once) or is applied
per door is the developer's call; ONE home for the predicate is not.

### G5 — RULES question 3: reading the overlaid status as a GATE is a VIOLATION of ADR-005's "`freshnessGroup` stays disk-only and explicitly so", and it produces R6.1's false-finding class one group over. MEASURED

`src/work-doctor-freshness.mjs` is **untouched by the diff** — and that is the point. `buildSnapshot`
now writes the cache's status into `item.meta.status`, so `freshnessGroup:135`'s
`meta.status === "in-progress"` gate silently became cache-authoritative while every datum it
compares (`created`, `updated`, `newestFileMtimeMs`) stayed the control's own disk.

Reproduced on a control node, remote-authored item, `now` two months past the scaffold:

```
stale-updated WITH overlay   : ['item 07 is in-progress but updated "2026-08-01" is older than the stale window']
stale-updated WITHOUT overlay: []
```

The finding's `path` is the CONTROL's folder; its subject is an item another machine is actively
working; and its claim — "this in-progress item's record has gone stale" — is false about the item
and true only about a scaffold nobody was supposed to be reading. **That is exactly ADR-010/R6.1's
class**: status from the cache, the fact beside it from the disk, a finding predicated on both. R6.1
handled it for the three lifecycle findings and ADR-005 handled it for `freshnessGroup` by declaring
the group disk-only — the build honoured the letter (no code changed there) and broke the rule
(the gate moved anyway).

**Ruling: MUST-FIX, and the value is already on the snapshot.** `freshnessGroup`'s status gate must
read `item.diskStatus`, which `overlayFor` already stamps on **both** branches
(`work-doctor.mjs:151,180`). This is ADR-015/F5's shape a second time — a fix that threads a value
the story itself computes, not new machinery — and the coverage lesson is F5's verbatim: no lane in
`cache-read-doctor-overlay` places a remote-authored item on the far side of the stale window.

**The rule, stated because "disk-only" was read as "unedited":** a group is disk-only when the facts
it READS are the disk's — a gate is a read. **A group's source is a property of what it consumes,
not of whether its file appears in the diff.** The mtime data and the status gate belonging to
different nodes is a comparison across two machines' clocks and two machines' opinions, which is a
defect no matter which line was edited to produce it.

### G6 — RULES question 1: an optional parameter is BESIDE the god-node, not inside it — but only because of what was measured, and the measurement is the ruling

m41/ADR-001 says a new capability lives *beside* the god-node, never inside it. The question is
whether `{ view }` on four readers is "inside".

**Ruling: it is beside, and the test is the blast radius, not the byte count.** Three measured
grounds:
- **`work.mjs` gained no import** — graph-verified, still exactly 3 (`fs`, `node-identity`,
  `workspace`). The module learned no cache vocabulary, opens no store, and cannot name the seam.
  `view` is plain data built outside. That is the whole content of "beside".
- **The blast radius SHRANK, 34 → 25 `src/` importers.** m41/ADR-001 exists to stop the god-node's
  reach growing; this change reduced it by nine. A rule enforced against the story that best serves
  its purpose would be a rule enforced against its own reason.
- **It is a twin, not a second mechanism.** `nextWork` already took `candidacyView` (m26/ADR-005)
  and the two compose (`work-read.mjs:272-275`) rather than compete. A NEW seam with the same shape
  beside an existing one is the duplication this milestone has ruled against three times.

**And the alternative is worse in the way that matters.** Re-deriving the match rule, the depth-first
order and the `nextWork` candidacy walk in `work-read.mjs` would be four facts with two homes — the
defect class this milestone has now paid for at ADR-014/E4, ADR-015/F1 and ADR-015/F6. **The boundary,
so it is a rule and not a precedent: a god-node may gain an OPTIONAL, DEFAULT-ABSENT, PLAIN-DATA
parameter that lets an outside module reuse its rules, and may never gain an import, a store, or a
vocabulary from that module.** Absent ⇒ byte-identical is what makes the parameter free for the 25
modules that do not pass it.

### G7 — RULES a REGRESSION neither story's suites can see, and it is NOT one of the known-red mesh lanes: the presence tick went from one disk scan to 2N store opens per tick, and `mesh-coordination-launcher/03` is RED because of it

`test/mesh-coordination-launcher.test.mjs` "the healthy launcher refreshes this node's durable
presence on each propagation tick" fails against the working tree. **Verified GREEN at `6b4ab7f` in a
detached worktree** (with `node_modules` junctioned), so it is not in the known pre-existing set —
this milestone caused it. Bisected by behaviour, not by guess:

```
base  (6b4ab7f):  presence refreshed at ~27ms
tree  (43/04+06): not refreshed at 31ms; refreshed by ~136ms
```

The cause is 43/06's default swap at `mesh-launcher.mjs:529-531`:
`assembleActiveRunsAndSubsumedWorkspaces` now calls `listItemsCacheFirst` **per workspace**
(→ `readCachedItemRows` → one store open) and then `readCachedActiveRunIds` **per workspace** (→ a
second open) — **2N SQLite opens per propagation tick**, where N is every workspace the control's
fleet aggregation resolves. The test's fixture has ONE workspace and an EMPTY store and still misses
a 25ms budget by 5×.

**Ruling: MUST-FIX, and the ruling is not "raise the budget".** The lane measures the daemon's
responsiveness on its hot loop; a bound that is relaxed to fit the code stops measuring the world and
measures the code, which is ADR-014/E5's rule with the sign flipped. **The migration itself is
correct** — `mesh-launcher:390` is on ADR-005's (a) list, and the launcher going blind to
worker-authored items was a real defect. What is wrong is the per-workspace store open: the store is
ONE file for every workspace (`withProjectionStore` keys on `globalMeshPaths(options)`), so the tick
must open it **at most once**, whatever shape that takes. This is TECH_DEBT item 12 biting for the
first time in production rather than in a count — recorded there as evidence.

**And the coverage lesson: a leaf that "migrates by swapping a default" has no scenario of its own,
so its only oracle is a suite it does not belong to.** 43/06's own five suites are green; the
regression surfaced only because an m33 suite still measures the tick. Task 02's Examples list this
leaf's litmus as "the union it returns" — which is true of the VALUE and blind to the COST.

### G8 — RULES questions 4, 5 and 6, and one wording gap ADR-010/R5.1 already forbids

**Q4 — `activeRuns` unions cached run records: SOUND, and the reasoning is right for a reason the
justification understates.** The union is bounded to `local.skipped` — refs `localItemsOnly` proved
this node has no folder for — so `readActiveRuns(local.items)` and `readCachedActiveRunIds(…skipped)`
partition by construction and cannot double-count. And the subject genuinely permits it:
`presence.activeRuns` is consumed per-WORKSPACE (`mesh-identity.mjs:479-495`, "a board's activeRuns
is its OWNER node's synced presence.activeRuns"), and `mesh-launcher.mjs:520` already documents it as
"the UNION across every resolved workspace's items". A run **on** a workspace, executed elsewhere, is
a run on that workspace. **One thing NOTED, not required:** the 4-line composition
(`localItemsOnly` → `reportReachThroughSkips` → the two-source union) is now spelled twice, at
`commands/mesh-heartbeat.mjs:79-88` and `mesh-launcher.mjs:411-419`, differing only in a label and in
the store options passed. Two homes for one derivation is ADR-015/F6's shape; at two instances and
four lines it is honest, and G7's fix will touch one of them anyway. **The THIRD instance extracts
`readVisibleActiveRuns`** — recorded so the next author meets the decision.

**Q5 — the ordering is CORRECT.** `already-current` decided before the dirty-tree guard
(`mesh-worktree.mjs`, step 1 before step 2) is right, and the reasoning given is the right reasoning:
that path runs no writing git verb, so refusing it would convert a working continue into a coded
failure with nothing gained. Every path that ACTS is behind the guard, including `--ff-only`, and the
comment already says why (`--ff-only` writes tracked files exactly as a merge does) — which is the
non-obvious half and the half a later reader would otherwise get wrong.

**Q6 — the asymmetry is SOUND and is ONE rule, which the code already states and this ruling
pins.** The create door checks availability before materialisation because it needs the commit **to
build** the worktree; the reuse door checks after because it needs the commit **to advance** the
branch, and the worktree it retains on refusal is what every other `failed` outcome retains
(`onCleanup(assignmentId, "failed", worktreePath)`, the same call the other five failure paths make).
**The rule: the availability check runs immediately before the operation that needs the commit.** Two
doors, one rule, and the two task-03 rows are its consequences rather than its cause — which is the
right way round.

**The wording gap, and it is a must-fix because R5.1 already ruled it.** ADR-010/R5.1: *"The refusal
message must name the cure, because a coded failure whose remedy is unstated is how TECH_DEBT item 2
reads."* `baseCommitUnavailableDetail` honours it exactly. The two NEW refusals do not:
`mesh-worker-execution.mjs:2462-2466` emits **one string for both codes**, naming no remedy and — the
sharper omission — **no worktree path**, so an operator reading `aof mesh logs --node` cannot find
the tree they are being asked to inspect. **Required: each code names its own cure and the retained
worktree.** `…-dirty-worktree` → commit or clean `<worktreePath>`, then re-dispatch;
`…-conflict` → the merge was aborted, the branch is unchanged, resolve on the item branch then
re-dispatch. **R5.1's clause is hereby general to every coded refusal this milestone adds**, not
specific to the one it was written about.

### G9 — RULES the staging discharge and the collateral amendments. Both ACCEPTED, one with a condition

**The staging claims: an ACCEPTABLE discharge, and it needs no contract amendment.** Task 00's "no
call site has moved" and task 01's "at stage 1 the leaves have not moved" are genuinely not
simultaneously satisfiable with task 02's stage-3 state in one tree — that is a property of a staged
contract delivered in one build, not a defect in either. What makes the discharge sound is that each
suite (a) asserts the form that is TRUE of the delivered build and carries the same guarantee — for
task 00 that is "`work.mjs`'s four disk readers, called directly, still see the disk and only the
disk", which is the load-bearing half of zero-blast-radius and is stronger than the CLI form it
replaces; (b) DECLARES the deviation in its header rather than quietly re-scoping
(`cache-read-seam.test.mjs:12-22`); and (c) proves the staging claim by MUTATION (`stage1-revert`,
`stage2-revert-leaves`), which is the only instrument that can see a claim about a state the tree is
not in. **Condition: the mutation evidence must be in the story's build report, cited from the
suite header** — a mutation nobody can re-run is an assertion, and the header currently says
"recorded in the story's build report" without naming where. **The general rule: a staged contract
delivered in one build is discharged by asserting the invariant half behaviourally and the ordering
half by mutation — never by asserting a state the tree is not in, and never by silently dropping the
claim.**

**The collateral amendments: verified line by line, and NONE weakens.** `test/support/answering-side.mjs`
replaces five exact-key `deepEqual`s with `assertFrozenShape`, which asserts every frozen key is
present AND that the only additions are the three named answering-side keys — a sixth key fails
exactly as the original would have. Re-pointing five suites at five hand-written new lists would have
replaced one frozen contract with five, and the helper is the better instrument. `board-face-contract`
(×4), `board-api` (×2), `command-core-contract` (×3) and `work-ui-board-serves-unchanged` (×2) each
moved one level down to `body.items` and each ADDED `assertAnswersFrom`, so they assert more than
before. `command-core-contract`'s `work:list` lane strips the stamp and deep-equals against
`listStream` — sharper than the deep-equal it replaces, as its comment claims. **`cache-authority/07`
is the model amendment**: 43/02's claim is not lost but re-asserted at its real subject
(`work.mjs`'s `findWork`/`listStream` still read `not-started` off the control's disk), and the
NEW command behaviour is asserted beside it. That is a supersession that keeps the evidence the
contract moved, which is ADR-014/E1's whole point. **One note, no action:** the helper's own header
claims it holds "nothing was renamed, dropped or **retyped**" — it does not check types, and neither
did the assertions it replaces. TECH_DEBT item 0's fourth shape, one line of prose; correct the
sentence, not the code.

### G10 — RULES the codebase-health findings, each with its route

Measured 2026-08-04, continuing ADR-014/E7's and ADR-015/F2's tables:

| Signal | 43/03 | 43/04 | **43/05+06** | Trend |
|---|---|---|---|---|
| `src/` files | 208 | 211 | **213** | +2 (`work-read`, `mesh-sync-cadence`) |
| `src/` root-level `.mjs` | 104 | 106 | **108** | +2 (26 are now `mesh-*`) |
| `src/` lines | 53,215 | 54,126 | **55,435** | +1,309 |
| `src/global-work-store.mjs` | 1,250 | 1,276 | **1,276** | **±0** — held at the 1,280 ceiling |
| `src/mesh-worker-execution.mjs` | — | 3,187 | **3,254** | +67 (a call site, not a block) |
| `src/board-worker-stream.mjs` | — | 191 | **351** | **+160 (+84%)** — G8 below |
| store openers (TECH_DEBT 12) | 17 | 19 | **19** | ±0 — the right call, G3 |
| `work.mjs` `src/` importers | — | 34 | **25** | **−9** — the god-node shrank |
| `ui/src/board/DetailPanel.tsx` | 839 | 1,123 | **993** | −130, under F2's 1,000 ceiling |

- **The two new root siblings are ADR-earned** on ADR-013/C7's test: `work-read.mjs` is REQUIRED by
  ADR-005 by name, and `mesh-sync-cadence.mjs` is ADR-014/E5's. No root-count ratchet is set, for
  ADR-014/E7's reason: nothing in the milestone now obliges another, so the next story is the right
  place to decide. The `mesh-*` family at **26** flat siblings goes to TECH_DEBT item 10's evidence.
- **ADR-015/F2 and ADR-014/E3 are both PAID**: `ProvenanceLine.tsx` is extracted (204 lines),
  `DetailPanel.tsx` is 993 under its 1,000 ceiling, `Fleet.tsx` 1,530 under 1,560, and
  `global-work-store.mjs` did not move a line. The escape hatch was used, which is the behaviour the
  ratchets were set to produce.
- **`board-worker-stream.mjs` is the shape to watch, and it is ledgered rather than blocked.** It
  grew +84% in one wave and its dependents went **5 → 9**, now including `work-read.mjs`,
  `mesh-launcher.mjs` and `commands/doctor.mjs` — i.e. **the spine imports a module named for a
  face**. Its subject really has widened to "this node's read of the shared cache" (its own header
  says so, `:264-265`), and it contains no render or HTTP code, so this is NAME drift, not a layering
  inversion — ADR-003's "the spine must not import a face" is not breached in substance. **But
  ADR-003's rule was drawn against `board-mesh-execution.mjs` on exactly this reasoning, and a module
  whose name asserts a layer its 9 dependents contradict is how the next author gets it wrong.**
  Route: **ledger** (TECH_DEBT item 10, the `src/` interior-structure item) with the trend and the
  cure named — the cache-read half wants a subject-named home. A rename touching 9 importers is a
  scope explosion inside a story; **the decision to make it is the next milestone's, and the count is
  the trigger.**
- **The `reportedElsewhere` predicate has three homes** — `commands/doc.mjs:91`,
  `commands/tasks.mjs:82` (byte-identical 3-line copies) and `work-doctor-coherence.mjs:83` (the
  snapshot-shaped variant) — and a FOURTH in `ui/` via ADR-015/F5's `reportedBy !== thisNode`. F5's
  own words: *"the same fact asked twice; they must be answered from the same source."* **Route:
  refactor REQUIRED for the two identical `src/commands/` copies** — one exported predicate, and
  `work-read.mjs` is its natural home since it already owns `answeredFrom`. Both files are in this
  diff, both changes are three lines: the health rule's "fits the story" test is met exactly. The
  doctor variant reads `statusFrom` rather than `answeredFrom` and may stay a deliberate second
  spelling, provided it cites the first.
- **`work-read.mjs` at 306 lines is well-shaped** and does not need a ceiling: it is one subject, its
  four readers are four lines each over one builder, and every rule it keeps is stated where it is
  kept. It is the counter-example to the accretion this section usually reports.

**Consequences.**
- The m03 CLI contract survives the milestone unamended, and R4.1's row-vs-face split is now ruled
  three times on one route rather than eroded once.
- Positive pins in this repo fail on relocation as well as on rename; the boundary test gained the
  launcher's worktree read, which nothing was holding.
- Two false-finding paths the overlay opened (G4's second door, G5's status gate) are caught before
  the gate, both fixable with values the stories already compute.
- One regression outside both stories' suites (G7) is attributed by measurement rather than assumed
  pre-existing, and TECH_DEBT item 12 gains its first production instance.
- The god-node's blast radius fell 34 → 25 — recorded, because this section usually reports the
  opposite direction and the difference is the point.

---

## Out of scope / known follow-ups

- **Concurrent workers on one item** — deferred by the operator (SPEC/STATE). The lock's premise is one
  holder; multi-holder arbitration is a later milestone if ever.
- **Reading git for artifacts** — out (SPEC). Git stays the transport for structure (the branch, the
  pin) and the durable history; it is never a read path for item state. ADR-008 touches git *only* to
  advance a branch, never to read an artifact.
- **The `http` hook type** — measured working, rejected as primary (ADR-001) for four recorded reasons.
  If the worker daemon ever grows a loopback listener for another reason, superseding ADR-001 is a small
  change behind an unchanged payload contract.
- **`planApplyActions`' ungated overwrite, repo-wide** — TECH_DEBT item 9.
- **`mesh-worker-execution.mjs`'s size and `src/`'s flat root** — TECH_DEBT item 10.
- **Workspace-removal row deletion** — ADR-004 removes the sweep that used to carry it. The
  `cache-authority` story must name the explicit path that replaces it; it is a consequence, not a
  follow-up to defer.
- **`Bash`-written artifacts** — not covered by the hook (STATE, carried); the retained reconciliation
  tick is the answer and this milestone keeps it running forever, which ADR-007's content hash makes
  affordable.
