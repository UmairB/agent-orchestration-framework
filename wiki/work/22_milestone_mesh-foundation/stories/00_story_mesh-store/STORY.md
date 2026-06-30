---
type: story
number: 00
slug: mesh-store
title: "The mesh-store, the path-partition convention & the aof mesh face contract — src/mesh-store.mjs, the spine the mesh:* commands couple through"
parent: 22
status: done
owner: product-owner
created: 2026-06-30
updated: 2026-06-30
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · The mesh-store, the path-partition convention & the `aof mesh` face contract — the spine

## User story

As the foundation the mesh commands (stories 01 & 02) — and milestones 23 (relay/presence), 24 (enrollment) and 26 (distributed runs) — all couple through,
I want one mechanic, `src/mesh-store.mjs`, that builds every mesh record path from a single node-id-keyed seam, persists each node's record as a git-tracked per-node JSON file written atomically, and an `aof mesh` CLI face whose "a node is just another thin face" premise has structural teeth,
so that two nodes never write the same path (git merges stay add-only, the move that keeps git a clean bus), the run-dimension convention provably composes with milestone 19's frozen run-record seam at milestone 26, and every `mesh:*` command is a registry-derived thin face — exactly the milestone-08 discipline.

<!-- This is the SPINE the milestone exists to make safe: it freezes the partition seam (ADR-002), the
     node-record schema (ADR-003), and bootstraps the greenfield `aof mesh` face + the NEW mesh-namespace
     bijection gate (ADR-001). It owns NO node-id derivation (story 01) and NO sync transport (story 02) —
     only the store mechanic, the path seam, and the face skeleton + structural arch-tests. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 22 --autonomous`, Contract stage). Each behaviour task
     is one `.feature` under tasks/; done when its @executable feature is green. The fitness functions are
     arch-tests (structural invariants → never a behaviour feature) tracked as buildable units below. -->

- [x] `tasks/00_mesh-record-store.feature` — persisting a node record writes exactly one `nodes/<node-id>.json` under the partition root, written atomically (temp+rename via `writeText`), and reads back byte-equivalent; an absent record reads as absent (not an error); the store never writes a record doc.
- [x] `tasks/01_path-partition-convention.feature` — every mesh record path is built by the single seam (`meshDir`/`nodeRecordPath`), keyed by node id; two distinct node ids write two distinct files (never the same path); there is no shared/aggregate file; the run-dimension convention `runs/<node>/<run-id>.json` is the additive delta on milestone 19's frozen `runRecordPath` shape (composition demonstrated, not built). _(Note: the `../escape` / `a/b` Examples' `expected-leaf` literals are mis-specified — flagged in STATE; the seam coerces to a flat leaf per ADR-002.)_
- [x] `tasks/02_aof-mesh-face-skeleton.feature` — `aof mesh` is a registered top-level CLI command; `aof mesh` with no sub renders usage; an unknown sub renders one structured `{ ok:false, error, code }` envelope under `--json` and exits non-zero — the dispatcher skeleton the bijection gate tests against, before any `mesh:*` command lands.
- [x] **Fitness `acd-mesh-partition-write`** (arch-test, ADR-002 / fitness #1) — `meshDir` is the single partition-root seam and `nodeRecordPath` is built **from** it (one join site); every record path embeds a node-id segment; no aggregate/shared filename — so git merges are add-only and the m26 `<node>/` segment slots into the one seam.
- [x] **Fitness `acd-mesh-write-scope`** (arch-test, ADR-002/004 / fitness #2) — every write the store performs joins `meshDir`/`nodeRecordPath` and routes through the atomic `writeText` seam (19/R2); the module references **zero** record-doc filename (`SPEC.md`/`STORY.md`/`STATE.md`/`SESSION.md`).
- [x] **Fitness `acd-mesh-command-cli-bijection`** (arch-test, ADR-001 / fitness #3, the NEW registry-derived gate per 19/R1) — a `mesh:`-filtered mirror of `acd-work-command-cli-bijection`: every `mesh:*` command carries a non-null `cli` adapter, has a reachable `aof mesh <sub>` dispatch branch in `meshCommand`, and `aof mesh <sub> --json` runs clean + parseable. (Board route-coverage is **milestone 25** — not authored here.)

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** the thin-face premise + the NEW
bijection gate; **ADR-002** the partition seam; **ADR-003** the frozen node-record schema). This story
**owns**: `src/mesh-store.mjs` — the partition path seam `meshDir(workspace)` / `nodeRecordPath(workspace,
id)` (**ADR-002**), the frozen node-record JSON schema's persist/read (**ADR-003**), atomic per-node writes
through [fs.mjs](../../../../../src/fs.mjs) `writeText` (**19/R2**) — plus the `aof mesh` top-level CLI
dispatcher **skeleton** (`meshCommand` + the `if (command === "mesh")` case in
[cli.mjs](../../../../../src/cli.mjs)) and the three arch-tests above + their registration in
[scripts/test.mjs](../../../../../scripts/test.mjs). It *reads* the existing
[work.mjs](../../../../../src/work.mjs) workspace model (`workDir` resolves where `meshDir` sits) — it does
**not** rewrite it, and it does **not** author node-id derivation (story 01), the sync transport (story 02),
or any board face (milestone 25).

**Independent because** it consumes nothing new — only the already-shipped `work.mjs`/config + `fs.mjs` +
`node:fs` — and produces the ONE frozen contract (the partition seam + the node-record schema + the face
skeleton + the bijection gate) that stories 01 and 02 wrap. It is the dependency root the call graph dictates
store-first (ARCHITECTURE §Story break-down rationale): `mesh-store.mjs` plays the exact spine role
`run-store.mjs` plays today — a low-fan-out mechanic at the centre of a high-fan-in star (4 dependents / 1
dependency on the graph) — so it can be built and tested in full isolation before any command exists.

**The conscious departure from milestone 19's partition** (recorded in ARCHITECTURE §Story break-down
rationale): m19's store-spine did **not** bootstrap a CLI face (the `aof work` face pre-existed); here the
face is greenfield, so this spine additionally owns the `aof mesh` dispatcher skeleton + the NEW
registry-derived bijection gate — the "node is a thin face" premise is itself a foundational structural
deliverable, shipped with the spine so stories 01/02 stay fully independent parallel siblings.

**Feasibility (developer amigo seat — confirmed at Contract): FEASIBLE.** A small, well-precedented mechanic
modelled near-byte-for-byte on `run-store.mjs` (the one-join-site path seam + atomic `writeText` +
absence-tolerant `try/catch → absent` read), and a `meshCommand` dispatcher modelled on `workCommand` /
`graphCommand` in `cli.mjs`. `meshDir(workspace)` roots cleanly: `ctx.workspace` (from `loadWorkspace`,
[work.mjs:42](../../../../../src/work.mjs)) carries `workDir`, so `join(workspace.workDir, ".mesh")` →
`wiki/work/.mesh/nodes/<id>.json` is reachable from what every command receives. The bijection arch-test is a
mechanical `mesh:`-filtered copy of `acd-work-command-cli-bijection`; **RED-until-commands is correct** (an
empty derived sub set passes the three sub-loops vacuously). **19/R1 no-regression confirmed:** the existing
`work:`-filtered gates (`acd-work-command-cli-bijection`/`-route-coverage`) and the `command-core/00`
`WORK_IDS` allow-list all filter `id.startsWith("work:")` — `mesh:*` adds **no** regression and needs **no**
allow-list widening; `acd-command-namespace` (bundle members) is untripped.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Implementation guidance surfaced at Contract; none is a contract defect (no `.feature`/ADR change). -->

- **Mirror `run-store.mjs` directly:** `meshDir`/`nodeRecordPath` ↔ `runsDir`/`runRecordPath`; persist =
  `mkdir(recursive) → writeText(JSON.stringify(record, null, 2))` (the `writeText` temp+rename in
  [fs.mjs](../../../../../src/fs.mjs) carries the Windows `renameWithRetry` — load-bearing on this platform);
  read = the `readdir`/`readFile` + `try/catch` absence discipline.
- **`meshCommand` skeleton:** model on `graphCommand` — it already does the `console.error(usage);
  process.exitCode = 1` unknown-sub path and the single-`{ ok:false, error, code }` `--json` envelope via the
  `runVerbCli` idiom ([cli.mjs](../../../../../src/cli.mjs)). Add `if (command === "mesh") { await
  meshCommand(rest); return; }` to the top-level dispatch.
- **The `.mesh` leaf is the seam's own choice** — the contract pins only "node-id-keyed, under `workDir`,
  git-tracked, not `.aof/`"; the literal leaf is renameable without a contract change.
- **Arch-test registration:** append the three `import { archTests as … }` + spread into the `tests` array in
  [scripts/test.mjs](../../../../../scripts/test.mjs) (the m19 run-store block is the pattern).
