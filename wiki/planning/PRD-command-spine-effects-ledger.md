# PRD — Command Spine & Effects Ledger

> Planning PRD for the command/side-effect rearchitecture arc. Origin: the operator's 2026-07-27
> review ("1000s of disparate functions littered everywhere; side effects not happening is the
> biggest problem with this codebase") plus two full codebase maps taken the same day — one of the
> command/dispatch layer, one of the mutable-state stores and their cascades. The design was argued
> to rest in-session (command/event model, locus routing, facts-over-the-bridge) and this PRD records
> the settled shape. **Thesis:** the write seams are already excellent — one writer per store, atomic
> temp+rename, arch-tested — but *cascade* seams do not exist: "what must happen after X" is written
> down nowhere except inline in whichever function needed it first, so every new call site
> re-remembers it from scratch, and forgets. The fix is not more discipline; it is a structure in
> which **effects are declared, not remembered** — a single command spine, mutations that emit
> durable domain events, and one executable effects table that owns every consequence and its
> topology.

> **Relationship to [TECH_DEBT item 0](../work/TECH_DEBT.md) / [milestone 42](../work/42_structural-overhaul/).**
> Item 0 named the disease ("the same fact derived in many places, the same act has several doors,
> failure handled by silence") and m42's waves stopped the bleeding: log sinks, the silent-catch ban,
> the arch gate at zero, liveness/reclaim. This arc is item 0's phase (b) — *consolidate the seams* —
> and its slogan extends item 0's two rules with a third: one home per concept, one door per act,
> **one ledger per consequence**. **Promoted 2026-07-27 (operator direction): this arc executes
> INSIDE milestone 42 as [ROADMAP wave (d)](../work/42_structural-overhaul/ROADMAP.md), legs
> d1–d5** — the same inline discipline as waves (a)–(c), not a shattered set of new milestones. The
> Milestones section below is the design's cut and maps 1:1 onto those legs; this PRD remains the
> design record, the milestone the payment plan.

> **Relationship to other PRDs.** [PRD-acd-loop-engineering.md](./PRD-acd-loop-engineering.md) wants
> event-driven loop triggers ("an event just calls the CLI") — the effects ledger is the substrate
> those triggers subscribe to; this arc ships the ledger, that arc consumes it.
> [PRD-work-run-orchestration.md](./PRD-work-run-orchestration.md) owns run *semantics*; this arc
> changes only how run transitions announce themselves. The CLI-as-contract spine (milestone 08)
> holds throughout: every verb is a registered command, faces stay thin.

## Objective

**Objective.** Make it structurally impossible for a side effect to be silently missed, and reduce
the command layer to one spine. Concretely: (1) **finish the command spine** — every verb is a
registry Command dispatched through one door; `cli.mjs` shrinks to argv → route table → one generic
face; (2) **mutations become facts that emit events** — each fact store's transition function is the
*only* writer and the *only* event-raiser, appending to a durable per-node journal atomically with
the write; (3) **consequences live in one executable table** — `effects.mjs` maps each event to its
reactors, each tagged with the *locus* of the store it mutates; a topology-aware dispatcher runs
local-locus reactors (CLI: synchronously before exit; daemons: on the converge tick) and durably
enqueues remote-locus ones over the mesh bridge; (4) **the bridge carries facts, directives and
queries — never remote effect execution** — so every node's own guards stay in the path;
(5) **integrations ride the same ledger** — Notion becomes a reactor, not a command someone
remembers to run. End state: a crashed process leaves *pending* events, not lost cascades; adding a
consequence is one line in one file; and "what happens when a run completes" is a table you can
read, test, and `aof doctor --explain`.

## Context & Constraints

### Measured 2026-07-27 (the two maps)

**The command layer is one good architecture half-built.** A real registry exists
([command-core.mjs](../../src/command-core.mjs): 39 commands, a clean
`{ id, input, run, cli: { render, json } }` contract, basis-neutral paths, three in-process faces —
CLI, board, MCP). But ~45 of ~84 user-facing verbs bypass it as inline handlers in the 3,415-line
[cli.mjs](../../src/cli.mjs): nine verbatim copies of the same 20-line face function, six parallel
hand-maintained `*_FLAGS` vocabularies, a global boolean-flag allow-list in `parseOptions`, 57
`parseOptions` calls, 41 hand-decided `process.exitCode = 1` sites, 248 `console.log`s, and the
whole assets/packages half re-deriving path/config resolution instead of `loadWorkspace`. Layering
leaks both ways: four lower modules import upward into `commands/`, one confirmed circular import
(`mesh-worker-execution` ↔ `commands/mesh-repo`), and commands import each other's internals rather
than going through `invoke`. The best-factored thing in the tree —
`createPhaseDoorCommand` ([continue.mjs](../../src/commands/continue.mjs)) — is the pattern to
generalise, not an exception to preserve.

**Cascades have no home.** The canonical run-completion cascade
([run-complete.mjs](../../src/commands/run-complete.mjs)) is four steps: complete the run record,
roll back item status on failure, publish the global projection, surface warnings. `completeRun` has
**8 call sites; exactly 1 does the rollback** — a failed mesh run leaves frontmatter `in-progress`
forever, and two terminal-resume paths drop `failureReason`, making resumed failures silently
non-retryable. Global publish is an *import decision*: `work:feedback` (appends a bullet) publishes;
`work:insert-milestone` (renumbers the entire stream) does not. The stale-run reclaim is implemented
twice with complementary halves missing. Re-index mutates refs that are the join key of six stores
(run records, Notion sidecar, five SQLite tables, memory index) and tells none of them — the Notion
map silently mis-binds pages after every insert. Two `aof init`/`project migrate` sites bypass
`writeLock`'s read-merge and wipe the `work`/`planning` lock sections wholesale. And the coupling
registry is literally comments: "the scan ORCHESTRATES, work.mjs WRITES",
"publishWorkspaceSnapshot MUST NEVER touch", "guard-free by design — its callers own the transition
rules" — each precise, none executable.

**There is no event infrastructure to build on** — no bus, no hooks; the nearest things are
`degrade.mjs` (error-only, one-way), per-collaborator injected callbacks threaded by hand, the
worker→control wire frames (an event system, but only across the network and only for mesh), and
the converge ticks. `invoke()` is a bare pass-through.

### Constraints

- **The soak stays live.** Two machines run this system continuously; every step ships as an
  install + restart on the existing deploy loop and must leave the soak running. No big-bang.
- **The write seams are kept, not replaced.** One-writer-per-store, atomic writes, frozen shapes,
  `mapAssignmentRow`, the apply-seam guards (holder check, terminal-never-regresses) all survive —
  transitions wrap them; the ledger sits *behind* them, never beside them.
- **Item frontmatter stays the source of truth for item status**; the SQLite `work_items` tables
  stay derived. The arc makes the fact/projection split *explicit*, it does not move truth.
- **Cross-machine reality:** frames are droppable (the unknown-workspace incident discarded 100% of
  frames for days), workers die mid-run, and a remote's synchronous answer can be a lie from a dead
  process — m42 wave (b) proved this live. The design therefore assumes at-least-once delivery and
  requires idempotent (or event-id-deduped) reactors; it never awaits a remote cascade.
- **Fitness-function culture:** every invariant this PRD introduces lands as a `test/arch/acd-*`
  test, and the existing bijection tests (which grep `cli.mjs` source text for the ladder shape)
  are updated in the same milestone that changes the shape they assert.
- **Windows + POSIX**, basis-neutral paths, `AOF_GLOBAL_HOME` isolation for all tests.

### The settled design

**Loci.** Every reactor mutates exactly one store; every store has one writer; *locus* is where that
writer can run: `checkout` (the repo folder holding the item — e.g. frontmatter rollback), `control-store`
(authoritative mesh SQLite — e.g. assignment settle), `local` (each node's own projection/logs),
`integration:<name>` (external system + credentials — e.g. Notion). Commands never ask "am I a
worker"; the dispatcher compares a reactor's locus to the loci this process can reach.

**The flow:**

```
face (CLI argv / board HTTP / MCP / incoming mesh directive)
  → invoke(command)                      // the ONE door; faces are transport
    → transition(store, edge, payload)   // the ONLY fact-writer AND the only event-raiser
        writes fact + appends event to the per-node journal (same tx for SQLite stores;
        write-then-append with a reconciler scan for file stores — chosen over 2PC, knowingly)
  → drain(journal)                       // CLI: sync before exit, per-reactor outcomes in the
                                         // result envelope; daemon: converge tick
      for each { reactor, locus } in EFFECTS[event]:
        locus reachable here → execute (idempotent, deduped by event id; failures → degrade log,
                                        retried by tick — never silent)
        locus elsewhere      → durable outbox → bridge frame → far side's OWN journal + guards
```

```js
// effects.mjs — the executable coupling graph. One file. Closed vocabulary, like the tag set.
export const EFFECTS = Object.freeze({
  "run.completed": [
    { key: "rollback-status",    locus: "checkout",           apply: rollbackStatusIfFailed },
    { key: "settle-assignment",  locus: "control-store",      apply: settleAssignmentForRun },
    { key: "publish-projection", locus: "local",              apply: publishItemProjection  },
    { key: "notion-sync",        locus: "integration:notion", apply: syncItemStatusToNotion },
  ],
  "stream.reindexed": [
    { key: "remap-run-refs",     locus: "checkout",           apply: remapRunRecordRefs },
    { key: "remap-notion-map",   locus: "integration:notion", apply: remapNotionSidecar },
    { key: "remap-projection",   locus: "local",              apply: remapProjectionRefs },
  ],
});
```

**The bridge: three channels, no fourth.** *Facts* travel worker→control (durable outbox,
ack/cursor, at-least-once, redelivered on reconnect; the control apply-handler shrinks to
guard + append-into-own-journal). *Directives* travel control→worker (durable, correlated id; the
worker runs them as fresh local commands through its own `invoke()`, whose facts carry the directive
id back — async RPC with a durable receipt). *Queries* are synchronous, read-only, allowed to time
out — safe because they mutate nothing. **Mutations never cross the bridge as function calls.**
Events are past-tense facts carrying their own evidence (`{ ref, runId, outcome, priorStatus,
node, seq }`) — never empty pings that force reactors to re-read racing state. The one honest
limit: cascades needing cross-locus *ordering* (retry mints only after rollback landed elsewhere)
stay control-orchestrated as directives; a fitness test keeps them from decaying into
fire-and-forget facts.

**Enforcement (all as arch tests):** store writers importable only by their owning module + the
effects module; no event append outside `transition()`; every reactor idempotent-or-deduped; closed
event vocabulary; no mutation over a query channel; no `withGlobalWorkPropagation` import outside
effects; every registered command reachable from the route table (bijection, re-derived not
grepped).

## Scope

### In scope

- The generic CLI face + registry-derived route table; per-command flag specs; one error envelope
  and exit-code policy; conversion of all ~45 unregistered verbs to Command objects; retirement of
  the nine face copies, six flag sets, and the `parseOptions` allow-list.
- The per-node journal (SQLite: `events` + per-reactor `steps` tables), `transition()` seams for
  the fact stores (run records, item status, assignments), `effects.mjs`, the dispatcher with
  sync-drain (CLI) and tick-drain (daemon), and the durable outbox riding the existing
  worker-stream cursor.
- Porting the known cascades: run completion (all 8 sites), publish-on-mutate, the two reclaim
  halves, insert/reindex (`stream.reindexed`), the lock read-merge bypasses.
- Refactoring `control-stream-server` apply-handlers to guard + append; `mesh-worker-execution`'s
  terminal paths to `transition + drain`.
- Explicit fact/projection classification per store; `aof doctor --explain <event>` and
  `--converge`; the file-store reconciler scan.
- Notion as reactors (status sync + reindex remap), deduped by the sidecar's contentHash.

### Out of scope

- **Run/verify/refine semantics** (what the phases do) — loop-engineering/run-orchestration arcs.
- **Stable item uids** replacing refs as the join key — adjacent (below); this arc ships the
  `stream.reindexed` event so keyed stores converge, which contains the damage without a migration.
- **Workspace identity** (TECH_DEBT item 4) — same disease class, separate organ; not blocked on
  this arc and not blocking it.
- **The board/UI restructure** and any new UI surface — the board remains a face over `invoke` +
  the projection.
- Exactly-once delivery, generic pub/sub for third parties, or any message-broker dependency —
  the journal is a table, not Kafka.

## Milestones

> These are milestone 42's wave (d) legs d1–d5 (see its
> [ROADMAP](../work/42_structural-overhaul/ROADMAP.md)), kept here with their depends edges as the
> design's cut. Foundation-first and soak-safe: the spine is pure mechanics (no behaviour change),
> the ledger proves itself on ONE cascade — the very class the
> `fix/worker-completion-and-milestone-cascade` branch exists for — before anything else ports.
> Every leg leaves the soak running and lands its fitness tests in the same change as the shape
> they assert.

- **command-spine-faces** — the mechanical half. One generic face function replacing the nine
  copies; route table derived from `listCommands()`; per-command flag specs (retiring the six
  `*_FLAGS` sets + the boolean allow-list); one error envelope + exit-code policy; `console.log`
  confined to the face. Convert the ~45 stray verbs to Commands — assets/packages/project first
  (self-contained), then the unregistered work/mesh verbs; invert the four upward imports and break
  the `mesh-repo` cycle. Update the bijection/route-coverage arch tests to derive from the registry
  instead of grepping the ladder. **No behaviour change; byte-identical output where asserted.**
- **effects-ledger-foundation** — the journal (events + steps), `transition()` on the run store,
  `effects.mjs`, the dispatcher with CLI sync-drain and daemon tick-drain, and the **run-completion
  cascade ported end-to-end**: all 8 `completeRun` sites become `transitionRun + drain`;
  `failureReason` carried structurally; per-reactor outcomes in the result envelope; effect
  failures to the degrade log. Independent of command-spine-faces in principle, sequenced after it
  so ported call sites are already registry-shaped. **Exit criterion: kill a worker between
  transition and settle → the assignment settles on the next drain, provably, on the live soak.**
- **bridge-facts-and-outbox** — facts over the bridge. The durable outbox (ack/cursor, redelivery)
  for remote-locus steps; `control-stream-server` apply-handlers reduced to guard + append into
  control's journal; control's tick drains the same effects table; directive responses correlated
  by id. The apply-seam guards (holder, terminal-never-regresses) move inside the shared
  transition so all writers inherit them. **Depends on effects-ledger-foundation.**
- **cascade-ports** — the sweep. Publish-on-mutate becomes a `local`-locus reactor (delete every
  per-command `withGlobalWorkPropagation` import); the two reclaim implementations unify on one
  transition edge + shared cascade; insert/reindex emits `stream.reindexed` (run-record refs,
  Notion sidecar, projection remap); the two `writeLock` bypasses adopt read-merge; Notion status
  sync becomes an `integration:notion` reactor. Each port deletes its inline copies and lands the
  writer-isolation fitness test for its store. **Depends on bridge-facts-and-outbox** (reactors
  must be locus-routable before mesh-adjacent cascades port).
- **fact-projection-split** — the epistemology made explicit. Every store declared FACT or
  PROJECTION; the shared SQLite file's derived tables (`work_items`, descriptors) gated from its
  fact tables (`global_assignments`, directives, branches, recovery pushes) by schema-level
  classification rather than a comment; `aof doctor --explain <event>` / `--converge`; the
  file-store reconciler scan closing the write-vs-append crash window. **Depends on
  cascade-ports** (classification is only honest once writes flow through the ledger).

## Adjacent techniques (separate arcs — captured, not scoped here)

- **Stable item uids.** Refs remain the display key but a frontmatter `uid` becomes the join key
  across run records, Notion sidecar, projection and memory index — retiring `stream.reindexed`'s
  remap fan-out. Needs a migration story for existing stores; deliberately deferred until the
  ledger proves the remap path. → its own milestone when insert/reindex traffic justifies it.
- **Event-driven loop triggers.** Once the journal exists, [PRD-acd-loop-engineering](./PRD-acd-loop-engineering.md)'s
  triggers ("an event just calls the CLI") subscribe to it — a `work.item.accepted` event waking
  the next `aof work loop` leg is one reactor away. Owned by the loop-engineering arc.
- **Scar-comment retirement.** TECH_DEBT item 0 notes 1,670 scar markers; each ported cascade
  retires the prose that was standing in for it (the "MUST NEVER touch" / "callers own the rules"
  paragraphs become arch tests). A closing chore per milestone, not an arc.
- **Degrade-log unification.** `reportDegrade` and effect-failure reporting share a sink family
  today; folding degrade codes into the event vocabulary (failures as first-class events) is a
  natural follow-on once both are stable.
