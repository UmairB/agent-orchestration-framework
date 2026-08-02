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

## Fitness functions (the enforced invariants)

Arch-tests live under `test/arch/acd-*.test.mjs` (node:test-style `archTests` arrays, registered in
`scripts/test.mjs`). Following m41's practice (`acd-reindex-engine-blast-radius`: *"a clean skip … arms
the moment the engine lands"*), each file below mixes assertions that are **GREEN TODAY** — invariants
that hold at HEAD and must not regress — with **ARMED** guards that skip cleanly while their subject is
unbuilt and bind the moment it lands. No file is committed RED.

| File | ADR | State |
|---|---|---|
| `acd-artifact-sync-hook-derivation-free` | 001 | green (2 live proofs) + armed |
| `acd-claude-settings-co-authored` | 002 | green (canary on the operator's keys) + armed at the hazard |
| `acd-item-lock-single-door` | 003 | green (single `executionScopeRef` definition; mint seam imports the lock module; no command re-derives the scope check) + armed — **amended by ADR-010/R1.1** (the armed clause forbids a command module deciding the SCOPE lock, and no longer flags the sanctioned exact-ref `findActiveAssignment`) and **by ADR-011/A1**: a further clause — *the publish path reads no `global_assignments` state* — is due at `43/02`, where authority becomes a `node_id` column and the assignment read disappears. Not committed now: it would be red against `43/01`'s interim carry. |
| `acd-work-items-single-writer` | 004 | green (single DML module) + armed at the reclassification |
| `acd-cache-read-surface-boundary` | 005 | green (worker/structural readers PINNED) + armed — **amended by ADR-010/R6.3**: `promote-gap-to-chore.mjs` moved from the control-side list into the positively-pinned STRUCTURAL list |
| `acd-cache-staleness-single-predicate` | 006 | green (strict `>`, no time-predicated DELETE) + armed |
| `acd-work-artifact-set-single-home` | 007 | green (one declaration site) |
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
