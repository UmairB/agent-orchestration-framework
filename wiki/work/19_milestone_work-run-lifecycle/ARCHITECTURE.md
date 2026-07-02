---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 19 · Work-Run Lifecycle — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the load-bearing deliverables: the item/run
> split, the run state machine `queued → running → done | failed | cancelled`, and the **derived-record
> invariant** that item frontmatter stays the single source of truth while the run log explains *how it
> got there*, rebuildable + prunable) and `STATE.md` (the two open contract questions — the exact
> `work:run-*` verb set + transition rules, and where the derived run log lives — plus the load-bearing
> **forward-note**: milestone 26 will add a `node` dimension path-partitioned as `runs/<node>/<run-id>.json`,
> which CONSTRAINS the run-log layout here). Prior art: `PRD-work-run-orchestration.md` (the
> "Issue ≠ Task" / state-machine / structured-brief mechanics; note that retryable classification,
> resume-vs-fresh, attempt ceiling, heartbeat/reclaim, status rollback, and dedup/anti-loop are explicitly
> **milestone 20**, and board run observability is explicitly **milestone 21** — both OUT of scope here).
>
> **The precedent this milestone APPLIES and never re-litigates: milestone 08 (cli-command-core).** This
> milestone authors the run lifecycle *as registered command-core commands*, inheriting wholesale:
> `08/ADR-001` (CLI-as-contract over ONE in-process command core — no per-request subprocess);
> `08/ADR-002` (the frozen `{ id, input, run, cli } → result` command contract; `run` returns
> **basis-neutral** data with raw absolute paths; path-display is a **face adapter**, never command logic);
> `08/ADR-004` (the command→CLI bijection + import-guard fitness functions, generalised by `15/ADR-005` to
> be **registry-derived** — every `work:*` command is auto-covered). ADRs below cite these as
> `08/ADR-00n` / `SPEC §…` / `STATE §…` / `PRD §…`.
>
> The seam (confirmed against the codebase graph, `aof graph build src` → 1032 nodes / 2793 edges, builtAt
> 2026-06-29T17:30Z; `aof graph impact` re-run at author time): `src/command-core.mjs` is the **one door**
> every face couples through (dependents: `board-ui.mjs`, `cli.mjs`, `graph-mcp-server.mjs`,
> `memory/graphify-backend.mjs`; dependencies: all `src/commands/*.mjs` + `work.mjs`). A NEW mechanics
> module `src/run-store.mjs` (analogous to `work.mjs`, which 15 modules already couple through) holds the
> run model/store/state-machine; thin `src/commands/run-*.mjs` wrap it and register into the SAME core —
> additive, exactly the 08 precedent (one import + one `COMMANDS` array entry per command). The CLI face is
> wired here; the **board face is NOT touched** (milestone 21).
>
> **Prior-lesson recall** (`work memory recall … --area architecture`): surfaced `17/ADR-001` (a derived
> mapping store is an aof-owned, deterministically-resolved sidecar — honoured: the run log is exactly such
> a derived, regenerable artifact, distinct from authoritative item state) and `m10/R3` (a near-miss: when
> you add a derived artifact that mirrors an existing one, cover the FULL invariant, not just the new-and-
> obvious case — honoured directly by fitness function #1, which asserts the record-doc bytes are untouched
> by BOTH prune AND rebuild, not merely one). No departure from a prior lesson.

## ADR-001: The durable work ITEM is distinct from each RUN of it; a run has the explicit state machine `queued → running → done | failed | cancelled`, and `work:run-start` creates-and-begins directly in `running`

**Status:** Accepted
**Date:** 2026-06-29

**Context.** aof's work stream models a durable **item** — a `NN_type_slug` folder whose record-doc
frontmatter `status` is the single source of truth (`work.mjs:listItems`/`recordDoc`/`parseFrontmatter`:
the folder name is the index, frontmatter `status` the authority). But the item is the *thing to be done*,
not a record of *what actually ran*. `aof autonomous` already loops `refine → build → verify` and claims
to be "resumable", with no durable run state behind the claim (`PRD §Objective`). The PRD's first lifted
mechanic is **"Issue ≠ Task"** (`PRD §Prior-art (a)`): the item is durable; **every trigger produces a new
run**, giving clean audit and retry. This milestone introduces the run as a first-class, durably-recorded
entity distinct from the item, and gives each run an explicit, complete state machine (`SPEC §Scope`, the
states pinned at refine).

A run's lifecycle in aof's **single-operator, file-based** model differs from Multica's server/daemon
split in one decisive way: there is **no separate scheduler** in this milestone. The operator both
*triggers* a run and *runs* it (their local agent session). So the question "who moves a run from `queued`
to `running`?" has no answer that this milestone needs — there is no enqueue-then-dispatch step. The
scheduler/dedup that *would* produce a `queued` run before anything runs is explicitly **milestone 20**
(`PRD §Prior-art (e)`: dedup = "no duplicate queued run per item"; `SPEC §Out of scope`).

**Decision.** The run state machine is the complete, closed transition table below. `queued` is the
**legal, persisted-representable pre-running state** — a run record may *hold* `state: "queued"` and the
store may *load/validate* it — but this milestone ships **no standalone enqueue verb** that produces one.
`work:run-start` **creates-and-begins** a run directly in `running` (the operator triggers and runs in one
step). `queued` is reserved for milestone 20's scheduler/dedup to produce; reserving it now (rather than
adding it later) keeps the state machine and the persisted schema **complete and forward-stable** so m20 is
a pure consumer, not a schema change.

**The complete transition table (frozen — legal transitions only; everything else is rejected):**

```
FROM \ TO   queued   running   done   failed   cancelled
queued        —        ✓         —       —          ✓        queued → running | cancelled
running       —        —         ✓       ✓          ✓        running → done | failed | cancelled
done          —        —         —       —          —        TERMINAL
failed        —        —         —       —          —        TERMINAL
cancelled     —        —         —       —          —        TERMINAL

Legal:   queued→running, queued→cancelled, running→done, running→failed, running→cancelled.
Initial: work:run-start creates a run ALREADY in `running` (no transition; the operator triggers+runs).
         (queued is representable + the queued→{running,cancelled} edges are legal+validated, but this
          milestone ships no verb that MINTS a queued run — milestone 20's scheduler/dedup is the producer.)
Reject:  any FROM→TO not marked ✓ above — in particular any transition OUT of a terminal state
         (done/failed/cancelled are terminal), and any self-loop. A rejected transition is an error
         (illegal-transition), never a silent no-op and never a write.
```

This `queued`-reserved-but-not-minted choice is a **documented default taken under `--autonomous`**: it is
the YAGNI reading of the single-operator model (no scheduler ⇒ no enqueue verb), it is recorded here so the
PO and milestone 20 can see it, and it is **reversible without rework** — adding a `work:run-enqueue` verb
later is purely additive (the `queued` state and its outbound edges already exist in the frozen machine).

**Alternatives considered.**
- *Ship `queued` as the initial state with a separate `work:run-start` that transitions `queued→running`* —
  rejected for this milestone: it invents a two-step enqueue/dispatch the single-operator model has no
  producer for (no scheduler), so the `queued` row would be unreachable dead state. Reserving `queued` in
  the machine without minting it keeps the schema complete for m20 *without* shipping an unreachable verb.
- *Omit `queued` entirely (states `running → done|failed|cancelled` only)* — rejected: milestone 20's
  dedup mechanic ("no duplicate **queued** run per item") needs a representable pre-running state; omitting
  it now would force m20 to widen the frozen state set (a breaking schema change), the exact rework the
  STATE forward-note + foundation-first framing exist to avoid.
- *Fold the run state INTO item frontmatter (no separate run entity)* — rejected: it violates the
  derived-record invariant (ADR-002) and erases the item/run distinction the PRD's "Issue ≠ Task" mechanic
  is built on (one item, many runs — auditable, retryable).

**Consequences.** ADR-003 freezes the verb surface that drives this machine (`work:run-start` mints a
`running` run; `work:run-complete` performs the terminal transition; `work:run-status` reads). The
transition table lives in the `src/run-store.mjs` mechanic (a pure function over a from/to pair), so both
the store and the commands share one authority and an illegal transition cannot slip through a face. No run
command ever writes item frontmatter — status rollback (`running → todo` on failure) is milestone 20
(`PRD §Prior-art (g)`), explicitly OUT of scope (ADR-002/003).

**Invariant.** The state machine is closed and terminal-respecting (an illegal transition is rejected, never
written). Its structural teeth are the **write-scope guard** (ADR-002 / fitness #2: a rejected/illegal
transition produces no write) and the **derived-record invariant** (fitness #1). The *behaviour* — driving a
real run start→complete through the registered commands and observing the recorded state survive a restart —
is a story-01 task `.feature`, NOT a fitness function (it exercises the real seam end-to-end; see the
fitness-function note).

## ADR-002: The run record is a DERIVED log — per-run JSON files under a per-item `runs/` directory (`wiki/work/NN…/runs/<run-id>.json`); NOT appended into `STATE.md`, NOT one monolithic `runs.json`

**Status:** Accepted
**Date:** 2026-06-29

**Context.** This is the load-bearing layout decision and it is essentially **forced** by two constraints
that already hold:

1. **The derived-record invariant** (`SPEC §Objective`, `PRD §Context`, inherited from milestones 05/09 and
   honoured as `17/ADR-001`'s sidecar discipline): a run record is a *derived* artifact — an
   observability/resume log, **never** an authoritative second copy of item state. Item frontmatter `status`
   stays the single source of truth; the run log explains *how it got there* and must be **rebuildable**
   (the directory is regenerable) and **prunable** (deleting a record removes a run with no loss of
   authoritative state).
2. **The milestone-26 forward-note** (`STATE §Forward note`): a later PRD reuses — does not replace — these
   run records, adding a **`node` dimension** path-partitioned as `runs/<node>/<run-id>.json`. The directive
   is to make that a **pure additive path delta**, not a rework: shape the log **partition-ready** here —
   per-run files under a node-addressable path, **not** one monolithic log. This is the one genuine seam
   `26 → 19`.

**Decision.** Each run is **its own JSON file**, named by its `runId`, under the item's **`runs/`
directory**:

```
wiki/work/NN_type_slug/runs/<run-id>.json          # a milestone's runs
wiki/work/NN_milestone_…/stories/SS_story_…/runs/<run-id>.json   # a story's runs live under the story's OWN folder
```

The `runs/` directory sits beside the item's record doc inside the item's existing folder (the `item.dir`
that `listItems` already resolves; a story's runs live under the story folder's own `runs/`, never pooled at
the milestone). The **path is built by a single seam** in `src/run-store.mjs` — `runsDir(item)` →
`join(item.dir, "runs")` and `runRecordPath(item, runId)` → `join(runsDir(item), runId + ".json")` — so the
milestone-26 `<node>/` segment slots in as one additive change to that one function
(`join(runsDir(item), node, runId + ".json")`), with **zero** change to the schema, the commands, or the
faces.

This satisfies all three derived-log properties structurally:
- **Rebuildable** — the `runs/` directory is wholly regenerable; nothing authoritative depends on it.
- **Prunable** — deleting a `<run-id>.json` file (or the whole `runs/` directory) prunes a run / the
  history, and changes **no** item's frontmatter status (fitness #1).
- **Partition-ready** — because each run is a discrete file under a path-built directory, the `<node>/`
  segment is a pure additive path delta; there is no aggregate file to migrate or rewrite (fitness #3).

**Alternatives considered.**
- *Append run records into the item's `STATE.md`* (the SPEC/PRD floated "per-item `STATE.md` or a runs
  log") — **rejected**: `STATE.md` is the PO-owned authoritative running NARRATIVE (the record doc whose
  frontmatter is the source of truth). Mingling derived run data into it (a) couples authoritative narrative
  with regenerable log data, (b) makes "prune the run log" impossible without rewriting an authoritative
  doc — directly breaking the derived-record invariant and the write-scope guard (ADR-001/fitness #2) — and
  (c) is not partition-ready (a `<node>` dimension cannot be expressed as a path delta in a single
  narrative file). This is exactly the half-covered-derived-artifact trap `m10/R3` warns of.
- *One monolithic `runs.json` per item* (all runs in a single aggregate file) — **rejected**: it is **not
  partition-ready**. The milestone-26 `<node>` segment could not be inserted as a pure additive path delta;
  it would force either a nested-by-node object schema (a breaking schema change) or a per-node aggregate
  file split (a rework), the precise outcome the STATE forward-note exists to prevent. A monolithic file
  also makes a single-run prune a read-modify-write of the whole aggregate (a concurrency and partial-write
  hazard) rather than a file delete.

**Consequences.** `src/run-store.mjs` owns the `runs/` path seam and the read/write of per-run JSON files;
it performs **all** filesystem writes for the run lifecycle, and **every** write joins `runsDir(item)` —
never the item record doc (`SPEC.md`/`STORY.md`/`STATE.md`/`SESSION.md`) or its frontmatter (fitness #2,
the write-scope guard). The schema of each file is frozen by ADR-003. Story 00 builds this store + the path
seam; story 01's commands wrap it.

## ADR-003: The frozen run-record schema + the three `work:run-*` commands — the 08 `{ id, input, run, cli } → result` contract applied, with the read/write resolver distinction inherited from `08/ADR-003`

**Status:** Accepted
**Date:** 2026-06-29

**Context.** With the state machine (ADR-001) and the `runs/` layout (ADR-002) fixed, this ADR freezes (a)
the per-run JSON shape and (b) the command surface that drives it. Both are direct applications of milestone
08: each command is a **thin wrapper over `src/run-store.mjs`** — the `next.mjs`-over-`nextWork` idiom
(`commands/next.mjs` is ~50 lines wrapping `nextWork` in `work.mjs`) — carrying the frozen
`{ id, input, run, cli } → result` contract with a stable `--json` shape, basis-neutral results, and
path-display left to the face adapter (`08/ADR-002`). The registered commands enter the SAME registry every
face couples through, so milestone 20 (resilience) and milestone 21 (board observability) inherit them for
free (the `08/ADR-004` bijection) — even though **only the CLI face is wired here** (the board face is m21,
`SPEC §Out of scope`).

The read-vs-write resolver distinction (`08/ADR-003`) is load-bearing and inherited verbatim: a **WRITE**
resolves the target with `resolveItemExact` (no slug fallback — a typo'd/partial ref returns `ref-not-found`
rather than writing a run to the wrong item, exactly as `feedback` does), while a **READ** may tolerate the
slug-fallback `resolveItem` (as `work:doc`/`work:tasks` do).

**The frozen run-record schema (frozen 2026-06-29 — a single per-run JSON file under `runs/`, ADR-002):**

```jsonc
// wiki/work/NN…/runs/<run-id>.json — a derived run record. Persisted as-is by
// src/run-store.mjs; never an authoritative copy of item state (ADR-002).
{
  "runId":     string,   // STABLE + lexically SORTABLE id; the filename stem. Form (frozen):
                         //   "<createdAt-compact>-<seq>" where createdAt-compact is the run's
                         //   creation timestamp as YYYYMMDDTHHMMSSsssZ (UTC, colon/punct-stripped,
                         //   ms precision) and <seq> is a zero-padded per-item monotonic counter
                         //   (the count of pre-existing runs/ files, 4 digits) — so ids sort
                         //   chronologically AND are unique within an item even at the same ms.
                         //   (Date.now() determinism is not a production concern; a creation-
                         //   timestamp id is fine and is what we freeze.)
  "itemRef":   string,   // the resolved item ref this run belongs to ("19" | "19/01").
  "state":     string,   // one of queued|running|done|failed|cancelled (ADR-001's machine).
  "attempt":   number,   // 1-based attempt count for THIS run lineage (foundation: starts at 1;
                         //   milestone 20's attempt-ceiling/retry mechanic increments + caps it).
  "outcome":   string|null, // null until terminal; then EQUALS state ∈ done|failed|cancelled.
  "sessionId": string|null, // the agent session this run is/was driven by (null if not supplied).
  "brief":     object,   // the structured per-run brief recorded AS-PASSED — an OPAQUE object the
                         //   foundation persists verbatim and never interprets. m20 + the skills
                         //   populate it (workspace/initiator/resources/skills; PRD §Prior-art (f)).
                         //   Frozen as opaque so its inner shape can grow with ZERO schema churn here.
  "createdAt": string,   // ISO-8601 UTC; the run's creation instant (also the runId timestamp source).
  "updatedAt": string    // ISO-8601 UTC; bumped on every persisted transition (== createdAt at start).
}
```

The `brief` is deliberately **opaque** (an object the foundation persists and round-trips byte-equivalent,
never reads) so milestone 20 and the skills can populate workspace/initiator/resources/skills without any
schema change here — the same forward-stability discipline as the `node`-ready path (ADR-002).

**The three registered commands (each a thin wrapper over `src/run-store.mjs`; frozen `{id,input,run,cli}`
contract; stable `--json`; basis-neutral results, path-display a face adapter per `08/ADR-002`):**

```
COMMAND             input                                  resolver           kind   result                       transition
work:run-start      { ref, sessionId?, brief? }            resolveItemExact   WRITE  the new run record (running)  (creates in `running`)
work:run-complete   { ref, runId?, outcome }               resolveItemExact   WRITE  the updated run record        running → outcome
                      outcome ∈ done|failed|cancelled                                                              (rejects illegal → illegal-transition)
work:run-status     { ref }                                resolveItem        READ   { ref, runs: RunRecord[] }    (none — observability)

- work:run-start  : creates+persists a NEW run in `running` (ADR-001 initial state) under the item's runs/,
                    returns the run record. resolveItemExact — a typo NEVER writes a run to the wrong item.
- work:run-complete: the terminal transition running→outcome on the target run (runId? defaults to the
                    item's single in-flight `running` run; ambiguous/none → an error). Rejects an illegal
                    transition (e.g. completing an already-terminal run) with illegal-transition; returns
                    the updated record. resolveItemExact (a WRITE).
- work:run-status : the read/observability — the item's run history (or current run) loaded from runs/.
                    resolveItem (slug-fallback tolerated, like work:doc/work:tasks).

ALL writes land ONLY under runs/ (ADR-002 / fitness #2). The run commands NEVER mutate item
frontmatter/status — status rollback is milestone 20 (PRD §Prior-art (g); SPEC §Out of scope).
```

**Alternatives considered.**
- *A single fat `work:run` command with a `--state`/`--action` flag* — rejected: it collapses the
  read/write resolver distinction (a status read and a terminal write would share one resolver) and muddies
  the bijection (`08/ADR-004` wants one CLI sub per command). Three crisp verbs mirror `feedback` (write,
  exact) vs `doc`/`tasks` (read, slug-tolerant) — the established 08 split.
- *Make `work:run-complete` also roll back item frontmatter on `failed`* — rejected: status rollback is
  milestone 20 (`PRD §Prior-art (g)`), and folding it in here would break the write-scope guard (a run
  command writing the item record doc). The derived/authoritative split is the point: run commands write
  only `runs/`.
- *A numeric monotonic-only `runId` (no timestamp)* — rejected: a bare sequence is not self-sorting across
  a prune (delete-then-create could reuse a number) and carries no creation instant; the timestamp+seq form
  is stable, chronologically sortable, and prune-safe.
- *Embed the brief's inner fields in the schema now* (workspace/initiator/resources/skills) — rejected:
  those are populated by milestone 20 + the skills (`PRD §Prior-art (f)`); freezing them here would force a
  schema change when m20 lands. Opaque `brief` keeps the foundation forward-stable.

**Consequences.** Story 01 builds `src/commands/run-start.mjs` / `run-complete.mjs` / `run-status.mjs` (each
thin over `run-store.mjs`) and the CLI dispatch for `work run-start` / `work run-complete` /
`work run-status`, registering all three into `src/command-core.mjs` (one import + one `COMMANDS` entry
each — the additive 08 move the graph confirms). The existing registry-derived bijection arch-test
(`acd-work-command-cli-bijection`) auto-covers their presence (`cli` adapter + dispatch branch +
`--json` clean), but its `argsFor(sub)` switch **throws on an unmapped subcommand**, so story 01 must add an
`argsFor` case for each of the three new verbs (fitness #4). The *observable* end-to-end — a run's lifecycle
driven entirely through the registered commands, the recorded state surviving a restart — is a story-01 task
`.feature`, not a fitness function.

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is the correct state now: src/run-store.mjs and src/commands/run-*.mjs do not
     exist yet; the tests reference them so they fail cleanly until the owning story lands. The
     "From" column names the story (per the two-story partition below) that BUILDS the test. -->

| Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|
| **Derived-record invariant.** Pruning OR rebuilding the `runs/` log changes NO item's frontmatter status — the run record is derived only; item frontmatter stays the single source of truth (`SPEC §Objective`, ADR-002). | `test/arch/acd-run-record-derived.test.mjs` — fixture item with a known frontmatter `status`; capture the **record-doc bytes**; create N runs via the store; then (a) delete `runs/` (prune) and (b) rebuild; assert the record-doc frontmatter is **byte-identical** after BOTH prune and rebuild (covers the full invariant, not just prune — honouring `m10/R3`). | RED until `src/run-store.mjs` creates/prunes/rebuilds runs under `runs/` | **00 · run-store** |
| **Write-scope guard.** Every filesystem write the run mechanic/commands perform lands within the item's `runs/` dir; **no** `writeFile`/`appendFile`/`mkdir` targets the item record doc (`SPEC.md`/`STORY.md`/`STATE.md`/`SESSION.md`) or its frontmatter (ADR-001/002 — status rollback is m20, not here). | `test/arch/acd-run-write-scope.test.mjs` — source-grep `src/run-store.mjs` + `src/commands/run-*.mjs` (call-form, comments discounted per the house discipline) asserting every write path joins `runsDir(...)`/`runs/`, and that **no** write/append targets a record-doc filename; the path builder is the single write seam. | RED until the store + run commands exist with the `runsDir` write seam | **00 · run-store** |
| **Partition-ready layout.** Run records are **per-run files** under `runs/`, never one monolithic aggregate file — so milestone 26's `<node>/` segment is a pure additive path delta (`STATE §Forward note`, ADR-002). | `test/arch/acd-run-partition-ready.test.mjs` — create N runs via the store → assert **N discrete files** under `runs/` and **no** single combined log file (no `runs.json`/aggregate); assert the path builder is a **single seam** (`runRecordPath`/`runsDir`) that the `<node>` segment slots into (source-grep: one join site builds the run path). | RED until `src/run-store.mjs` writes per-run files via the path seam | **00 · run-store** |
| **Command→CLI bijection (extension).** The three `work:run-*` commands are registry-derived-covered by the EXISTING bijection test (each carries a `cli` adapter, has a reachable `aof work <sub>` dispatch branch, and `--json` runs clean + parseable). | `test/arch/acd-work-command-cli-bijection.test.mjs` (EXTENDED) — the test derives its sub set from `listCommands()`, so the three new commands are auto-covered for **presence**; but its `argsFor(sub)` switch **throws on an unmapped subcommand**, so story 01 must add an `argsFor` case for `run-start` / `run-complete` / `run-status` (start+complete WRITE → args target a real fixture item; status READs). | RED (the `argsFor` switch throws on the new subs) until story 01 registers the three commands + adds the three `argsFor` cases | **01 · run-commands** |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors milestone 08's split):
     - The DERIVED-RECORD invariant, the WRITE-SCOPE guard, the PARTITION-READY layout, and the
       BIJECTION extension are true STRUCTURAL invariants over the store, the write surface, the runs/
       file layout, and the registry/dispatch → arch-tests (this table). They are the milestone's
       load-bearing structural deliverable.
     - The OBSERVABLE behaviours — "a run's lifecycle (start → complete) is driven ENTIRELY through the
       registered work:run-* commands with stable --json shapes", and "the recorded run state SURVIVES A
       RESTART (re-load the store from disk and the run is there with its state)" — exercise the real seam,
       the real filesystem, and the real CLI. They belong in story 01's task .feature files, NOT here
       (mirroring 08's split of structural-arch-test vs behavioural-scenario, and 06's "the degrade TABLE
       is an arch-test; the wrapped session ACTUALLY spawning is a .feature").
     - Illegal-transition REJECTION is asserted structurally only insofar as it produces NO write (the
       write-scope guard / #2); the behaviour "completing an already-terminal run is rejected with
       illegal-transition" is a story-01 .feature over the real command. -->

## Story break-down rationale

<!-- Informs the PO's break-down; does NOT itself create stories. The PO partitions milestone 19 into
     exactly two stories. The partition follows the real call/dependency coupling the codebase graph
     reports, not inferred coupling. -->

The PO will partition milestone 19 into **exactly two stories**, and the boundary follows the **real
call/dependency coupling** the codebase graph reports (`aof graph build src` → 1032 nodes / 2793 edges,
builtAt 2026-06-29T17:30Z; `aof graph impact` re-run at author time — cited as **actual** structure, not
inferred):

- **00 · run-store** — the `src/run-store.mjs` mechanic: the run model, the per-run JSON store under
  `runs/` (ADR-002's path seam `runsDir`/`runRecordPath`), and the state-machine transition table
  (ADR-001). Owns fitness functions #1, #2, #3.
- **01 · run-commands** — the thin `src/commands/run-*.mjs` commands (ADR-003) + the CLI `work run-*`
  dispatch (`--json` face), registering into `src/command-core.mjs`. Owns the bijection extension (#4).

**Why this boundary is grounded in the graph, not inferred:**

1. **`src/run-store.mjs` is the spine every run command will couple through** — the *exact* role `work.mjs`
   plays today. `aof graph impact src/work.mjs` reports **15 inbound edges** (`board-ui.mjs`, `cli.mjs`,
   `command-core.mjs`, and every `src/commands/*.mjs` that needs the item model), and `work.mjs` itself
   depends only on `fs.mjs`/`workspace.mjs` — a clean, low-fan-out mechanic at the centre of a high-fan-in
   star. The three `run-*` commands will couple to `run-store.mjs` the same way `next.mjs` couples to
   `work.mjs`'s `nextWork`. The store is therefore the **dependency root**: stories 01's commands cannot be
   built or tested until the store's model + path seam + transition table are frozen. Store-first (00 → 01)
   is the topological order the call graph dictates, and it minimises the cross-story dependency to a single
   direction (commands depend on store; the store depends on neither command).

2. **`src/command-core.mjs` is the one additive door** — `aof graph impact src/command-core.mjs` reports it
   is imported by all four faces (`board-ui.mjs`, `cli.mjs`, `graph-mcp-server.mjs`,
   `memory/graphify-backend.mjs`) and imports every `src/commands/*.mjs` + `work.mjs`. Registering the three
   new commands is **purely additive** (one import + one `COMMANDS`-array entry each — the precedent already
   visible in the registry's m09/m12/m13/m15/m17/m18 additions). Story 01 touches this one door; no face
   re-wiring fans out, because the bijection test already auto-covers any new `work:*` command.

3. **The board face stays untouched (milestone 21).** `aof graph impact src/board-ui.mjs` confirms it
   imports **only** `command-core.mjs` + `work.mjs`; surfacing run history / current-run / a rerun
   affordance on the board is milestone 21 (`SPEC §Out of scope`, `PRD §Milestones`). The two-story
   partition deliberately wires **only the CLI face** — yet because both stories register into the SAME
   core (point 2), milestone 21 and milestone 20 inherit the `work:run-*` commands for free (the 08
   bijection). The graph shows there is no edge from this milestone's work into `board-ui.mjs`, confirming
   the boundary is clean.

The coupling is **advisory**: it informs why store-first is the right cut (the call graph's dependency
direction), but the PO draws the final partition. The graph confirms — it does not dictate.
