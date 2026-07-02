---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 22 · Mesh Foundation — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the load-bearing deliverables: **node identity &
> capability advertisement**, **the git-sync engine**, and **the path-partitioning convention** that keeps
> git viable as a bus, all authored **as registered command-core commands** so a node is "just another thin
> face"; the load-bearing invariant **git stays the system of record** — the sync engine *moves* records,
> never becomes a second authority) and `STATE.md` (the open contract points refined here: the `mesh:*` verb
> set + `--json` shapes, the partition layout `presence/<node>.json` / `runs/<node>/…`, node-id derivation +
> the capability descriptor, sync cadence + batching). Prior art:
> `PRD-decentralized-agent-orchestration.md` (§3 "decentralization is mostly *using* git" + "a node is just
> another thin face"; §7.2/§7.3 the durable substrate; A1 "git as a good-enough durable bus"; A4 "each node
> runs the operator's own local agent sessions"). The **coherence seam with milestone 19** (`SPEC §Coherence
> seam`) is adopted verbatim: 19 has frozen the run-record *store* with a single path seam
> (`runsDir(item)` / `runRecordPath(item, runId)`, 19/ADR-002) deliberately shaped so a `<node>/` segment is
> a one-line additive delta — this milestone authors the partition *convention* and **adopts that frozen
> shape as the reference**, so convention (22) and store (19) provably compose at milestone 26.
>
> **The precedent this milestone APPLIES and never re-litigates: milestone 08 (cli-command-core).** Node
> identity + the git-sync engine are authored *as registered command-core commands*, inheriting wholesale:
> `08/ADR-001` (CLI-as-contract over ONE in-process command core — no per-request subprocess);
> `08/ADR-002` (the frozen `{ id, input, run, cli } → result` command contract; `run` returns
> **basis-neutral** data with raw absolute paths; path-display is a **face adapter**, never command logic);
> `08/ADR-004` (the command→CLI bijection + import-guard fitness functions, generalised by `15/ADR-005` to
> be **registry-derived**). ADRs below cite these as `08/ADR-00n` / `SPEC §…` / `STATE §…` / `PRD §…`.
>
> The seam (confirmed against the codebase graph, `aof graph build src` → **1076 nodes / 2925 edges**,
> builtAt 2026-06-29; `aof graph impact` consulted at author time — cited as **actual** structure, not
> inferred). `src/command-core.mjs` is the **one door** every face couples through (dependents ←
> `board-ui.mjs`, `cli.mjs`, `graph-mcp-server.mjs`, `memory/graphify-backend.mjs` = 4; dependencies → all
> `src/commands/*.mjs` + `work.mjs` = 20). `src/run-store.mjs` is a **low-fan-out spine** (dependents ← the
> four run-`*.mjs` commands = 4; dependencies → `fs.mjs` = 1) — **the exact role the new `src/mesh-store.mjs`
> plays**: a clean mechanic at the centre of a small star, with the four `mesh:*`-bearing modules coupling
> through it. `src/work.mjs` is the high-fan-in item model (17 dependents); `src/fs.mjs` is the atomic-write
> seam (16 dependents) the mesh-store joins. Registering a `mesh:*` command is **one import + one `COMMANDS`
> entry** — the additive 08 move the m09–m20 registry history (graph/project/import/notion/run-*) already
> demonstrates.
>
> **Prior-lesson recall** (`work memory recall … --area architecture`) surfaced four near-misses; each is
> acknowledged as honoured or as a conscious departure:
> - **17/ADR-001** — an aof-owned mapping store is a git-**IGNORED** `.aof/` sidecar, resolved
>   deterministically. **CONSCIOUS DEPARTURE:** the mesh node-identity + partition records are git-**TRACKED**
>   in the work stream — *git IS the bus*, the whole decentralization thesis (PRD §3/§7.3). The records stay
>   **derived/rebuildable** (the sidecar's *other* property is honoured — ADR-003); only their *location*
>   departs (tracked, not ignored). Recorded explicitly so the departure is visible, not silent.
> - **20/ADR-001** — resilience metadata extends the run record as ADDITIVE top-level keys (superseding 19's
>   nine-key freeze). **HONOURED:** the node-record schema (ADR-003) is frozen **additive-friendly** so
>   capability routing (later milestones) grows it with zero churn — the same forward-stability discipline.
> - **10/ADR-001 & 13/ADR-005** — derived/rebuildable-index invariants: the store is the system of record,
>   the derived artifact is never a second authority. **HONOURED:** git stays the system of record; the
>   sync engine MOVES records and never re-authors them (ADR-004's load-bearing invariant).
> - **07/ADR-006** — independent stories each own a disjoint set of files; one derived co-touched artifact
>   (there: `manifest.json`) is acceptable additive co-touch. **HONOURED:** here the only co-touched files
>   are `command-core.mjs`'s `COMMANDS` array + `cli.mjs`'s `meshCommand` dispatcher — additive-only, one
>   import/entry/case per command (the breakdown rationale below).
>
> **Scope-precision carry-forwards (19/R1 + 19/R2).** **19/R1:** an ADR that registers a command-core command
> must enumerate **EVERY** registry-derived fitness gate the registration trips. Here the existing
> bijection/route-coverage gates filter `id.startsWith("work:")`, so they do **not** cover `mesh:*` — adding
> `mesh:*` to the registry does **not** break them (no regression) and does **not** add bundle members (so
> `acd-command-namespace`, which renders bundle skill `.md` members from `loadBundle()`, is untripped).
> Therefore this milestone must **AUTHOR a NEW registry-derived gate** for the mesh namespace. Per 19/R1's
> scope precision: a `mesh:*` command in m22 has a **CLI face only** → it trips a **CLI bijection** gate; the
> **board route-coverage is milestone 25** (`aof mesh ui`) — explicitly **deferred, not authored here**.
> **19/R2:** every record write routes through the atomic temp+rename seam (`writeText` in `src/fs.mjs`);
> the mesh-store's per-node writes do too (fitness #2).

## ADR-001: A node is a thin face over registered `mesh:*` command-core commands — a new low-fan-out mechanic `src/mesh-store.mjs`, a NEW top-level `aof mesh` CLI face, and a NEW registry-derived mesh-namespace bijection gate

**Status:** Accepted
**Date:** 2026-06-30

**Context.** The milestone's load-bearing premise (PRD §3; `SPEC §Objective`/`§Scope`) is that **a node is
just another thin face** — node identity and the sync ops are not a parallel subsystem with its own
plumbing, they are *capabilities behind milestone 08's one door*, so the CLI / board / node faces inherit
them through the same registry the work surface already uses. The graph confirms the shape that makes this
true: `src/command-core.mjs` is the one door (4 dependents ← every face; 20 dependencies → every
`src/commands/*.mjs` + `work.mjs`), and `src/run-store.mjs` is a clean low-fan-out spine (4 dependents ← its
commands; 1 dependency → `fs.mjs`). The new mesh mechanic plays `run-store`'s spine role exactly.

Two structural facts force NEW surface that milestone 19 did not need. (1) There is **no `aof mesh` CLI
command today** — `cli.mjs`'s top-level dispatch routes `assets`/`packages`/`project`/`work`/`graph`/
`planning`/`import`, and `mesh` is absent. Milestone 19 wired its commands under the *pre-existing* `aof
work` face (`workCommand`); here the face is **greenfield**. (2) The existing registry-derived bijection and
route-coverage gates filter `id.startsWith("work:")`, so they give `mesh:*` **zero** coverage — the "node is
a thin face" premise has **no structural teeth** unless this milestone authors them.

**Decision.** Three additive structural moves, all applying 08:

1. **One mechanic — `src/mesh-store.mjs`.** A low-fan-out spine holding the partition path seam (ADR-002),
   the frozen node-record schema + its atomic per-node read/write (ADR-003), addressed only by node id. It
   couples down to `work.mjs`/config/`fs.mjs` and is depended on by the `mesh:*` command modules — the
   `run-store.mjs` role the graph confirms. It is the dependency root (story 00).

2. **One NEW CLI face — `aof mesh <sub>`.** A `meshCommand` dispatcher in `cli.mjs`, **analogous to
   `workCommand`** (an `if (subcommand === "<sub>") …; return;` ladder), reached from the top-level dispatch
   by a new `if (command === "mesh") { await meshCommand(rest); return; }` case — the exact additive shape
   the `graph`/`work` branches already take. Each `mesh:*` command is a thin
   `argv → invoke("mesh:<sub>") → render/--json` adapter (the `workListCommand`/`graphVerbCommand` idiom),
   carrying the frozen `{ id, input, run, cli } → result` contract, a stable `--json` shape, basis-neutral
   results, and path-display left to the face (`08/ADR-002`).

3. **One NEW registry-derived gate — `acd-mesh-command-cli-bijection`** (fitness #3), a deliberate **mirror**
   of `acd-work-command-cli-bijection` but filtered `id.startsWith("mesh:")`: every `mesh:*` command carries
   a non-null `cli` adapter (`argv`/`render` functions), has a reachable `aof mesh <sub>` dispatch branch in
   `meshCommand`, and `aof mesh <sub> --json` runs clean + parseable. This is the **structural teeth** of the
   "node is a thin face" premise (the milestone's load-bearing invariant, `SPEC §Objective`).

Per **19/R1**, the *complete* set of registry-derived gates the `mesh:*` registration arms:
- **CLI bijection** — covered by the NEW `acd-mesh-command-cli-bijection` this milestone authors (above).
- **Board route-coverage** (`acd-work-command-route-coverage`) — **NOT armed**: it filters `work:*`, so it
  ignores `mesh:*` entirely. The mesh board face (`aof mesh ui`) is **milestone 25**; its route-coverage gate
  is authored *there*, not here. Explicitly deferred (the conscious 19/R1 scope-precision call).
- **`command-core/00` known-commands allow-list** — if (and only if) that test enumerates an exact id set,
  story 00 widens it to include the `mesh:*` ids (the precedented m15-doctor `WORK_IDS` widening). A
  registry-derived allow-list needs no edit.
- **`acd-command-namespace`** — **NOT armed**: it asserts over `loadBundle()`'s bundle skill `.md` members;
  `mesh:*` commands add **no bundle members**, so it is untripped (verified: the test counts command/agent
  *resources*, not registry commands).

Adding `mesh:*` to the registry does **not** regress the `work:`-filtered gates (their `subcommands()` /
`commandOps()` derive from `id.startsWith("work:")`, which excludes `mesh:`).

**Alternatives considered.**
- *Put the mesh commands under `aof work mesh …` (no new top-level face)* — rejected: it forces the
  `work:`-filtered bijection to either swallow `mesh:*` (muddying the work surface's allow-list and route
  coverage) or grow a sub-prefix exception. A sibling `aof mesh` face — exactly as `aof graph` is a sibling
  to `aof work` (09/ADR-001) — keeps the namespaces clean and the gate filters crisp.
- *A standalone mesh subsystem (its own store + dispatch, not command-core commands)* — rejected: it
  abandons the "node is a thin face" premise (PRD §3) and the 08 one-door discipline, duplicating
  invoke/contract/`--json` plumbing and breaking the inheritance the CLI/board/node faces depend on.
- *Defer the bijection gate to when the first command lands* — rejected: 19/R1 is explicit that the gate is
  the structural teeth of the premise; authoring it RED in story 00 (the spine) makes the premise a
  *foundational deliverable*, not an afterthought.

**Consequences.** Story 00 builds `src/mesh-store.mjs` + the `meshCommand` dispatcher SKELETON in `cli.mjs`
(the `if (command === "mesh")` top-level case + the empty/unknown-sub ladder) + the NEW
`acd-mesh-command-cli-bijection` gate (RED until commands land). Stories 01/02 each add one import + one
`COMMANDS` entry + one `argsFor` case + one `meshCommand` dispatch branch — additive only. The mesh mechanic
references **zero** record-doc filename (ADR-002/fitness #2), exactly as `run-store.mjs` does.

## ADR-002: The path-partitioning convention — every mesh record file is owned/addressed by exactly one node id, built by a single seam in `src/mesh-store.mjs`, ADOPTING 19's frozen `runRecordPath` shape as the reference for the run dimension

**Status:** Accepted
**Date:** 2026-06-30

**Context.** This is the **load-bearing conflict-avoidance move** that keeps git viable as the mesh's bus
(`SPEC §Objective`/`§Scope`; PRD §3, A1). Git merges of disjoint files are **add-only** — never a three-way
content merge — *if and only if* two nodes never write the same path. So the partition convention is not a
convenience; it is the precondition under which ADR-004's add-only sync is safe (ADR-004 cites this
dependency). Two constraints already hold and shape the layout:

1. **The system-of-record discipline** (PRD §7.3; recall 10/13): the records are **derived/rebuildable** from
   each install's config — git stays the single authority, the records are a published projection.
2. **The milestone-19 coherence seam** (`SPEC §Coherence seam`): 19 froze `runRecordPath(item, runId)` =
   `join(runsDir(item), runId + ".json")`, deliberately shaped so a `<node>/` segment is a one-line additive
   delta. The directive is to **adopt that frozen shape as the reference** so the convention (22) and the
   store (19) provably compose at milestone 26 — not invent a second, divergent partition scheme.

**Decision.** Every mesh record path is built by a **single seam** in `src/mesh-store.mjs`, keyed by node id:

```
wiki/work/<mesh-root>/nodes/<node-id>.json        # this milestone BUILDS — the per-node identity record
wiki/work/<mesh-root>/presence/<node-id>.json     # RESERVED shape (milestone 23 builds it) — not built here
wiki/work/NN…/runs/<node-id>/<run-id>.json        # the run dimension — CONVENTION only here (m26 builds it)
```

The path builders (frozen seam — the only join sites; the `git-tracked partition root` lives inside the work
stream, sibling to the work items, so git carries it as the bus):

```jsonc
// src/mesh-store.mjs — THE single mesh-path seam (the only place a mesh record path is built).
meshDir(workspace)            // → the git-TRACKED partition root in the work stream (e.g.
                              //   join(workspace.workDir, ".mesh") — a tracked dir, NOT a .aof/ sidecar:
                              //   the conscious 17/ADR-001 departure, recorded in ADR-003).
nodeRecordPath(workspace, id) // → join(meshDir(workspace), "nodes", id + ".json")   — built FROM meshDir
// RESERVED (named, not built — milestone 23):
//   presenceRecordPath(workspace, id) → join(meshDir(workspace), "presence", id + ".json")
```

**The invariant (frozen).** *Every record file is owned and addressed by exactly one node id, so two nodes
never write the same path.* Per-node identity → `nodes/<node-id>.json`; per-node presence (m23) →
`presence/<node-id>.json`; per-(node,run) record (m26) → `runs/<node>/<run-id>.json`. There is **no shared or
aggregate file two nodes co-write** — the property that makes git merges add-only.

**The run dimension — CONVENTION only.** This milestone authors the *path shape* `runs/<node>/<run-id>.json`
and **adopts 19's frozen `runRecordPath(item, runId)` = `join(runsDir(item), runId + ".json")` as the
reference**. It does **NOT** extend the run record and does **NOT** insert the `<node>/` segment — that is
milestone 26, a pure additive delta `join(runsDir(item), node, runId + ".json")` on 19's *one* join site. By
adopting 19's exact shape as the reference, the convention (22) and the store (19) **provably compose at
m26** with no divergent scheme to reconcile (the `SPEC §Coherence seam` directive). The presence/heartbeat
shape `presence/<node>.json` is named here as the convention's **reserved** form; milestone 23 builds it.

**Alternatives considered.**
- *One aggregate file per partition (e.g. `nodes.json` listing all nodes)* — rejected: it is the exact
  three-way-merge hazard the convention exists to prevent. Two nodes publishing simultaneously would write
  the same path, forcing a content merge git cannot do add-only — breaking A1 and the whole "git as a bus"
  thesis. Per-node files merge add-only.
- *A git-ignored `.aof/` sidecar for the records (the 17/ADR-001 default)* — rejected (the conscious
  departure recorded in ADR-003): git IS the bus, so the records must be git-**tracked**; a sidecar would
  never reach a peer over a shared remote, defeating the objective.
- *A run-dimension partition that diverges from 19's seam (e.g. `runs.<node>.json` or a nested object)* —
  rejected: it would make the m26 merge a rework, not an additive delta — exactly what the coherence seam
  exists to prevent. Adopting 19's frozen `runRecordPath` shape verbatim is the directive.

**Consequences.** `src/mesh-store.mjs` owns `meshDir`/`nodeRecordPath` (and names the reserved
`presenceRecordPath`); every mesh write joins this seam and routes through the atomic `writeText` (fitness
#1/#2). The store references **zero** record-doc filename (`SPEC.md`/`STORY.md`/`STATE.md`/`SESSION.md`) —
record-doc resolution lives in `work.mjs`, never here (fitness #2, the write-scope guard). Story 00 builds
the seam + the frozen node-record schema (ADR-003); story 02's sync engine moves whatever files land under
`meshDir` without parsing them (ADR-004).

## ADR-003: Node identity — a deterministic, stable, human-readable node id + a forward-stable capability descriptor, published as a git-TRACKED, derived per-node record

**Status:** Accepted
**Date:** 2026-06-30

**Context.** Capability-based routing (later milestones) needs each install to advertise *what it can run*:
its identity, OS, runtimes (`claude`/`codex`), and installed skills (`SPEC §Scope`, move 1; PRD §7.2). The
record must be (a) **stable** — the same install keeps the same id across publishes, so peers track a node,
not a churn of ids; (b) **deterministic + human-readable** — derivable from the install with no central
allocator (there is no server, PRD §7.3); (c) **forward-stable** — additive-friendly so capability routing
grows it with zero churn (the 20/ADR-001 discipline); and (d) **derived/rebuildable** from the install's
config (the 10/13 discipline) yet git-**tracked** (the conscious 17/ADR-001 departure — git is the bus).

**Decision.** Freeze the node-record schema, additive-friendly (top-level keys only, new keys append):

```jsonc
// wiki/work/<mesh-root>/nodes/<node-id>.json — a DERIVED, git-TRACKED per-node identity record.
// Persisted as-is by src/mesh-store.mjs through the atomic writeText seam. Rebuildable from the
// install's config (ADR-002/fitness #1); never a second authority over git (ADR-004).
{
  "nodeId":      string,    // STABLE, human-readable, unique-per-install. Derivation = a DOCUMENTED
                            //   DEFAULT (--autonomous, below): sanitized hostname, persisted to config
                            //   (mesh.nodeId) on first publish so it is stable + operator-overridable.
  "host":        string,    // the raw hostname (os.hostname()) — the human label behind the id.
  "os":          string,    // the platform (process.platform: win32|darwin|linux).
  "runtimes":    string[],  // from config.runtimes — the supported agent runtimes (claude|codex).
  "skills":      string[],  // the installed bundle skill ids — the CAPABILITY advertisement (what work
                            //   this node can take). Grows as the install gains skills; additive.
  "aofVersion":  string,    // the publishing install's aof version (provenance + compat signalling).
  "publishedAt": string     // ISO-8601 UTC; the instant this record was (re)published. The UTC-Z
                            //   toISOString() assumption is preserved across every persist (19/R2).
}
```

**Node-id derivation — a documented default taken under `--autonomous`** (recorded so the PO + later
milestones see it; **reversible without rework** — overriding `mesh.nodeId` is a config edit, no schema
change): the default id is the **sanitized hostname** (lowercased, non-`[a-z0-9-]` collapsed to `-`),
**persisted to config (`mesh.nodeId`) on first publish** so subsequent publishes reuse it (stability) and an
operator can override it. **Collision** (the same hostname on two machines) is resolved by **appending a
short, stable per-install hash** (a deterministic digest of an install-local salt), so two `laptop` hosts
become `laptop-a1b2` / `laptop-c3d4` — stable per install, never colliding at the path level (ADR-002's
one-node-per-path invariant holds).

The record is **DERIVED/rebuildable** — it is a projection of the install's config + environment, regenerable
at any time (the 10/13 rebuildable-index discipline). It is **git-TRACKED** under `meshDir` (the conscious
17/ADR-001 departure — git is the bus, so a peer reads this node's identity straight from the synced tree).
The schema is **additive-friendly** (20/ADR-001): capability routing (later milestones) adds top-level keys —
e.g. `load`, `tags` — with **zero** churn to this freeze.

**Alternatives considered.**
- *A random UUID node id* — rejected: not human-readable (peers and operators read raw ids in the tree) and
  carries no provenance; a sanitized-hostname id is legible and the collision case is handled by the
  per-install hash suffix. (Stability is what matters; a UUID buys stability at the cost of legibility.)
- *Derive the id fresh on every publish (no persistence)* — rejected: a non-persisted hostname can change
  (a rename) and would churn the node's identity, breaking peer tracking. Persisting `mesh.nodeId` on first
  publish pins it (and makes it overridable).
- *Embed the capability descriptor's future fields now (load/tags/routing weights)* — rejected: those are
  populated by later capability-routing milestones; freezing them here would force a schema change when they
  land. Additive-friendly + opaque-growth keeps the foundation forward-stable (the 20/ADR-001 discipline).
- *Store identity in a git-ignored `.aof/` sidecar (17/ADR-001's default)* — rejected (the recorded
  departure): a sidecar never reaches a peer; the record must be git-tracked for git to be the bus.

**Consequences.** Story 01 builds `src/node-identity.mjs` (deterministic id derivation + descriptor
assembly) + `src/commands/mesh-identity.mjs` (`mesh:identity` — publish/read this node's record via the
mesh-store) + its `aof mesh identity` dispatch case + `argsFor` case. It writes only under `meshDir`
(fitness #2) and **never** calls the sync engine — it produces records; ADR-004's engine moves them. The
*observable* end-to-end (publishing a real identity record and reading it back) is a story-01 task
`.feature`, not a fitness function.

## ADR-004: The git-sync engine — a payload-agnostic transport that MOVES records over git on a tunable cadence; git stays the system of record. Structured AS the command `mesh:sync`; the background loop is a thin face

**Status:** Accepted
**Date:** 2026-06-30

**Context.** The mesh's **only transport** is git (`SPEC §Objective`/`§Scope`; PRD §3/§7.3 "Explicitly NOT"
a server/daemon/relay). Each node must publish its own records and read back peers' — over a shared git
remote, on a tunable cadence, with **no daemon-to-daemon networking** (the relay/presence substrate is
milestone 23). A1 asserts git is a *good-enough durable bus* on a 10–30s cadence; the load-bearing invariant
is that the engine **never interprets or re-authors records** — git stays the single system of record (recall
10/13). For the transport logic to be unit-testable while the background loop stays a thin face, the
transport must be a discrete, one-shot unit — not buried in a timer.

**Decision.**
- **Structure the transport AS a command — `mesh:sync`** — a **one-shot** registered command-core command
  (the testable transport unit): stage + commit this node's published records under `meshDir`, pull peers',
  push. The **background loop is a thin face/runner** — a timer that repeatedly invokes `mesh:sync`, exactly
  as the board server is a thin face over the core (the `serveSetupUi`/`graphServeCommand` idiom). So the
  transport logic is unit-testable in isolation and the timer carries no logic.
- **Tunable cadence** — `config.mesh.sync.cadenceSeconds`, a **documented default of 15s** (taken under
  `--autonomous`, within A1's 10–30s band; reversible — a config edit). **Batching** keeps commit volume sane
  (one commit per cadence tick that has staged changes, not per record).
- **Payload-agnostic** — the engine moves whatever files exist under `meshDir`; it **never imports the
  node-record schema (ADR-003) to parse or re-author content**. A new record type (presence in m23, runs in
  m26) syncs with **zero** engine change.
- **The load-bearing invariant** — git stays the single system of record; the engine MOVES records, never
  becomes a second authority (recall 10/13). It is the mesh's only transport — no relay (m23).

Add-only merges are **SAFE because of ADR-002's partitioning** (the explicit dependency): every record is
owned by one node id at one path, so concurrent peer publishes never collide — git merges them add-only,
never three-way. The engine's safety *rests on* the convention.

**Verification note (not a refine blocker).** A1 — "git is a good-enough durable bus" — is a
**verification-time measurement spike on a 3-node fleet** (does a 15s-cadence push/pull stay merge-clean and
within latency under real concurrent publishes?), not a refine-time decision. Recorded here as a
verification deliverable, so refine does not stall on a measurement it cannot make at design time.

**Alternatives considered.**
- *A background daemon with a long-lived sync loop holding the transport logic inline* — rejected: it makes
  the transport untestable except through the timer and conflates the loop (a face concern) with the
  transport (a command). Structuring `mesh:sync` as a one-shot command + a thin timer face mirrors the
  established board-server-is-a-face split (08/ADR-001).
- *A relay or daemon-to-daemon channel* — rejected: out of scope (m23), and it abandons the "git is the only
  transport" thesis (PRD §7.3 "Explicitly NOT"). git-only is the point of the foundation.
- *An engine that reads + validates record content as it syncs* — rejected: it would make the transport a
  second authority over git (breaking the system-of-record invariant) and couple the payload-agnostic
  transport to every record schema (forcing an engine edit per new record type in m23/m26). Payload-agnostic
  file movement keeps git the authority and the engine forward-stable.

**Consequences.** Story 02 builds `src/mesh-sync.mjs` (the payload-agnostic git transport) +
`src/commands/mesh-sync.mjs` (`mesh:sync`, and a read `mesh:status` if the sub-surface warrants it) + the
background-loop runner + the cadence config + its `aof mesh sync`/`status` dispatch cases + `argsFor` cases +
fitness #4. It depends only on ADR-002's partition convention (add-only safety) — **parallel with story 01**
(it moves whatever files exist; it does not call node-identity). The *observable* end-to-end (two clones over
a shared remote each publish + render the other's records, merge-clean) is a story-02 task `.feature` (and
the A1 fleet spike a verification deliverable), not a fitness function.

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is the correct state now: src/mesh-store.mjs, src/node-identity.mjs,
     src/mesh-sync.mjs, the mesh:* commands, and the aof mesh dispatcher do not exist yet; the tests
     reference them so they fail cleanly until the owning story lands. "From" names the owning story. -->

| Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|
| **Partition discipline.** Every mesh record path is built by the single seam (`meshDir`/`nodeRecordPath`), keyed by node id; there is **no** shared/aggregate file two nodes co-write — so git merges are add-only and the m26 `<node>/` segment slots into the one join site (compose-with-19) (ADR-002). | `test/arch/acd-mesh-partition-write.test.mjs` — source-analysis of `src/mesh-store.mjs` (call-form, comments discounted): assert `meshDir` is the single partition-root seam and `nodeRecordPath` is built **from** `meshDir` (one seam); assert every record path embeds a node-id segment (no aggregate/shared filename); assert the seam is the one join site the `<node>` segment slots into (mirroring 19's `acd-run-partition-ready`). | RED until `src/mesh-store.mjs` builds the seam | **00 · mesh-store** |
| **Write-scope guard.** Every write the mesh-store performs joins `meshDir(...)`/the partition root and routes through the atomic `writeText` seam (19/R2); **no** write targets an item record doc (`SPEC.md`/`STORY.md`/`STATE.md`/`SESSION.md`) or its frontmatter (ADR-002/004). | `test/arch/acd-mesh-write-scope.test.mjs` — source-grep `src/mesh-store.mjs` (+ the `mesh:*` command modules) asserting every write path joins `meshDir`/`nodeRecordPath`, that writes route through `writeText` (not a bare `writeFile`), and that the module references **zero** record-doc filename (mirroring 19's `acd-run-write-scope`). | RED until `src/mesh-store.mjs` exists with the `meshDir` write seam | **00 · mesh-store** |
| **Mesh-namespace bijection** (the NEW registry-derived gate, 19/R1). Every `mesh:*` command (filter `id.startsWith("mesh:")`) carries a non-null `cli` adapter (`argv`/`render` functions), has a reachable `aof mesh <sub>` dispatch branch in `meshCommand`, and `aof mesh <sub> --json` runs clean + parseable. | `test/arch/acd-mesh-command-cli-bijection.test.mjs` — a deliberate **mirror** of `acd-work-command-cli-bijection`, filtered `mesh:`: (a) registry-derived `cli`-adapter presence; (b) source-grep `meshCommand` in `cli.mjs` for a `subcommand === "<sub>"` branch per derived sub; (c) CLI spawn-and-parse `aof mesh <sub> --json` over a fixture. **Board route-coverage is deferred to m25** — NOT authored here. | RED until story 00 lands the `aof mesh` dispatcher skeleton + the gate (commands land in 01/02) | **00 · mesh-store** |
| **Sync is payload-agnostic / git stays the system of record.** The sync engine moves files under the partition root **without parsing or mutating record CONTENT** — it never imports the node-record schema to re-author it; git stays the single authority (ADR-004). | `test/arch/acd-mesh-sync-record-neutral.test.mjs` — source-discipline grep of `src/mesh-sync.mjs`: assert it does **not** import `node-identity.mjs`/the record schema and performs no `JSON.parse`-then-rewrite of record content (it stages/commits/pulls/pushes files, not fields); assert the transport is a one-shot unit (`mesh:sync`) the loop is a thin timer over. | RED until `src/mesh-sync.mjs` + `mesh:sync` exist | **02 · git-sync engine** |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors milestone 08/19's split):
     - PARTITION DISCIPLINE, the WRITE-SCOPE guard, the MESH-NAMESPACE BIJECTION, and SYNC-IS-PAYLOAD-
       AGNOSTIC are true STRUCTURAL invariants over the path seam, the write surface, the registry/
       dispatch, and the sync engine's source → arch-tests (this table). They are the milestone's
       load-bearing structural deliverable.
     - The OBSERVABLE behaviours — "a node publishes its identity record and reads it back through the
       registered mesh:* commands with stable --json shapes", and "two clones over a shared remote each
       publish + render the OTHER's records, merge-clean, purely over git" — exercise the real seam, the
       real filesystem, and real git. They belong in story 01's / story 02's task .feature files, NOT here.
     - A1 ("git is a good-enough durable bus") is a VERIFICATION-TIME measurement spike on a 3-node fleet
       (ADR-004), not a fitness function and not a refine blocker. -->

## Story break-down rationale

<!-- Informs the PO's break-down; does NOT itself create stories. The PO partitions milestone 22 into
     exactly three stories. The partition follows the real call/dependency coupling the codebase graph
     reports, not inferred coupling. -->

The PO will partition milestone 22 into **exactly three stories**, and the boundary follows the **real
call/dependency coupling** the codebase graph reports (`aof graph build src` → **1076 nodes / 2925 edges**,
builtAt 2026-06-29; `aof graph impact` consulted at author time — cited as **actual** structure, not
inferred):

- **00 · mesh-store, the path-partition convention & the `aof mesh` face contract** (THE SPINE — like
  19/00). Owns `src/mesh-store.mjs` (the partition seam `meshDir`/`nodeRecordPath`, ADR-002; the frozen
  node-record schema, ADR-003; atomic per-node read/write through `writeText`), the **`aof mesh` top-level
  CLI dispatcher SKELETON** (`meshCommand` in `cli.mjs` + the `if (command === "mesh")` top-level case,
  ADR-001), and the structural arch-tests **#1 / #2 / #3** (RED until commands land). Consumes only
  `work.mjs` / config / `fs.mjs` → independent, the **dependency root**.
- **01 · node identity & capability advertisement** — owns `src/node-identity.mjs` (deterministic id
  derivation + capability-descriptor assembly, ADR-003) + `src/commands/mesh-identity.mjs` (`mesh:identity` —
  publish/read this node) + its **one additive** `aof mesh identity` dispatch case + `argsFor` case + the
  one `COMMANDS` entry. Depends on 00; **parallel with 02** (it produces records; it never calls sync).
- **02 · the git-sync engine** — owns `src/mesh-sync.mjs` + `src/commands/mesh-sync.mjs` (`mesh:sync`) + the
  background-loop runner + cadence config + its **one additive** `aof mesh sync`/`status` dispatch case +
  `argsFor` case + the one `COMMANDS` entry + arch-test **#4**. Depends on 00's partition convention
  (add-only merge safety); **parallel with 01** (payload-agnostic — moves whatever files exist).

**Why this boundary is grounded in the graph, not inferred:**

1. **`src/mesh-store.mjs` is the spine every `mesh:*` command will couple through — the exact role
   `src/run-store.mjs` plays today.** `aof graph impact src/run-store.mjs` reports **4 dependents** (the four
   run-`*.mjs` commands) and **1 dependency** (`fs.mjs`) — a clean, low-fan-out mechanic at the centre of a
   small star. The mesh-store will sit identically: the `mesh:*` command modules couple *to* it; it couples
   *down* only to `work.mjs`/config/`fs.mjs`. It is therefore the **dependency root** — stories 01 and 02
   cannot be built or tested until the store's path seam + node-record schema are frozen. Store-first
   (00 → {01, 02}) is the topological order the call graph dictates, and it confines the cross-story
   dependency to a single direction (both command stories depend on the store; the store depends on neither).

2. **`src/command-core.mjs` is the one additive door** — `aof graph impact src/command-core.mjs` reports **4
   dependents** (`board-ui.mjs`, `cli.mjs`, `graph-mcp-server.mjs`, `memory/graphify-backend.mjs`) and **20
   dependencies** (every `src/commands/*.mjs` + `work.mjs`). Registering each `mesh:*` command is **purely
   additive** — one import + one `COMMANDS`-array entry — the precedent the m09–m20 registry history
   (graph/project/import/notion/run-*) already shows. Stories 01 and 02 each touch this one door additively;
   no face re-wiring fans out, because the NEW `mesh:`-filtered bijection (authored in 00) auto-covers any
   new `mesh:*` command's presence.

3. **The only co-touched files are additive — the 07/ADR-006 discipline.** `command-core.mjs`'s `COMMANDS`
   array and `cli.mjs`'s `meshCommand` dispatcher are the only files stories 01 and 02 both touch, and each
   touches them **add-only** (one import / one `COMMANDS` entry / one dispatch case / one `argsFor` case per
   command — no shared line edited). This is exactly the acceptable additive co-touch 07/ADR-006 sanctions
   (there: `manifest.json`). Stories 01 and 02 are otherwise **fully disjoint** file sets
   (`node-identity.mjs`/`mesh-identity.mjs` vs `mesh-sync.mjs`/`mesh-sync.mjs`-command) → genuine parallel
   siblings.

**The one conscious departure from milestone 19's partition.** In m19 the store-spine (00) did **not**
bootstrap a CLI face — the `aof work` face *pre-existed* (the commands wired under `workCommand`). Here the
face is **greenfield** (`aof mesh` does not exist today, confirmed against `cli.mjs`'s top-level dispatch),
so the spine (00) additionally owns **the `aof mesh` dispatcher skeleton + the NEW registry-derived
bijection gate**. This is deliberate: the "node is a thin face" premise (PRD §3, the milestone's load-bearing
invariant) is itself a **foundational structural deliverable**, so its teeth ship with the spine — not
bolted on by the first command story. This keeps 01 and 02 fully independent parallel siblings, touching only
the additive co-touched door (point 3).

The coupling is **advisory**: it informs why store-first + a 00-owned face skeleton is the right cut (the
call graph's dependency direction + the greenfield-face fact), but the PO draws the final partition. The
graph confirms — it does not dictate.
