---
type: story
number: 02
slug: git-sync
title: "The git-sync engine — src/mesh-sync.mjs + the mesh:sync command + the background-loop runner, the mesh's only transport"
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
# 02 · The git-sync engine — the mesh's only transport

## User story

As a node in a group sharing a git remote (and the operator who wants to *see what other agents are working on* with no relay yet),
I want a payload-agnostic git-sync engine — a one-shot `mesh:sync` command that commits this node's published records, pulls peers', and pushes, plus a background loop that repeats it on a tunable cadence,
so that each node publishes its own records and reads back every other node's purely over git — the "decentralization is mostly *using* git" thesis — while git stays the single system of record: the engine *moves* records, it never becomes a second authority.

<!-- This story moves the records. It owns the transport + the loop runner; it is PAYLOAD-AGNOSTIC (it
     moves whatever files exist under the partition root, never parsing record content), so it is parallel
     with story 01 by construction. Its add-only-merge safety RESTS ON story 00's partition convention. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 22 --autonomous`, Contract stage). Each behaviour task
     is one `.feature` under tasks/; done when its feature is green. The fitness function is an arch-test
     (structural invariant → never a behaviour feature) tracked as a buildable unit below. -->

- [x] `tasks/00_git-sync-transport.feature` — `mesh:sync` is a one-shot registered command that stages + commits this node's records under the partition root, pulls, and pushes; it is **payload-agnostic** (it moves files, never parsing or re-authoring record content); a working tree with no staged mesh changes is a clean no-op (no empty commit); `--json` emits a stable sync-result envelope (what was pushed/pulled).
- [x] `tasks/01_sync-cadence-loop.feature` — the background loop is a thin face over `mesh:sync`: it invokes the command on the tunable cadence (`config.mesh.sync.cadenceSeconds`, default 15s) and carries **no** transport logic; batching means one commit per tick that has staged changes (not one per record); the cadence is read from config and a malformed/absent value falls back to the default.
- [ ] `tasks/02_two-node-render-over-remote.feature` `@manual` — the outsider-verifiable acceptance: two clones over a shared (bare) remote each publish their identity and `mesh:sync`; each then renders the **other's** node record (via `mesh:status`), purely over git, **merge-clean** (the partition convention makes concurrent publishes add-only). Agent-run; evidence recorded in `VERIFICATION.md`. Ties to PRD A1 (the 3-node durable-bus measurement spike).
- [x] **Fitness `acd-mesh-sync-record-neutral`** (arch-test, ADR-004 / fitness #4) — the sync engine moves files under the partition root **without** importing the node-record schema or doing a `JSON.parse`-then-rewrite of record content (git stays the system of record); the transport is a one-shot unit (`mesh:sync`) the loop is a thin timer over.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-004** — the payload-agnostic git
transport on a tunable cadence; structured AS `mesh:sync` with the loop a thin face; git stays the system of
record; add-only merges safe **because of** ADR-002's partitioning). This story **owns**:
`src/mesh-sync.mjs` (the git transport) + `src/commands/mesh-sync.mjs` (`mesh:sync`) + the background-loop
runner + the cadence config (`mesh.sync.cadenceSeconds`), their registration in
[command-core.mjs](../../../../../src/command-core.mjs) (one import + one `COMMANDS` entry), the `aof mesh
sync` dispatch branch + `argsFor` case in [cli.mjs](../../../../../src/cli.mjs)'s `meshCommand`, and the
arch-test above + its registration in [scripts/test.mjs](../../../../../scripts/test.mjs).

**Depends on story 00's partition convention** (the add-only-merge safety the transport rests on) — but on
nothing story 01 produces. **Parallel with story 01**: the transport is payload-agnostic — it moves whatever
files land under `meshDir`, so it is built and tested against fixture records without story 01's identity
mechanic. The only co-touched files are the additive door (`COMMANDS` array + `meshCommand` dispatcher) — one
import/entry/case (the 07/ADR-006 discipline). It does **not** add a relay or presence (milestone 23) and
does **not** extend the run record (milestone 26).

**Verification-time spike (not a refine blocker):** PRD A1 — "git is a good-enough durable bus" at a
15s-cadence — is a measurement on a 3-node fleet, captured by `tasks/02`'s `@manual` acceptance + recorded as
a verification deliverable surfaced at `aof:verify`. The *correctness* (records sync, merges add-only) is
proven by `tasks/00`/`02`; the *measurement* (latency, merge volume under real concurrency) is the spike.

**Feasibility (developer amigo seat — confirmed at Contract): FEASIBLE.** The transport spawns `git`
(add/commit/pull/push); the loop-as-thin-face is testable with an injected ticker (no wall-clock wait); the
payload-agnostic property is grep-enforceable (arch-test #4). **Open question RESOLVED — `tasks/00` stays
`@executable`:** a bare remote + two working trees set up in a `mkdtemp` temp dir, offline, is the *same*
pattern the harness already proves in [import-recovery.test.mjs](../../../../../test/import-recovery.test.mjs)
+ [roundtrip-harness.mjs](../../../../../test/support/roundtrip-harness.mjs) (`spawnSync("git", …)` +
`git config user.email/user.name` + `commit.gpgsign false`). The add-only merge is *specifically* safe to
assert in CI because the partition convention guarantees the two nodes wrote different paths (a fast-forward,
never a content three-way) — no flakiness. `tasks/02` stays `@manual` (the fleet/A1-spike end-to-end). Git
2.47 is present.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Implementation guidance surfaced at Contract; none is a contract defect (no `.feature`/ADR change). -->

- **Spawn `git` via `spawnSync("git", [...])`** (the import-recovery precedent), **never a shell string** (the
  no-shell-string discipline the namespace's other arch-tests enforce). Stage **only** paths under `meshDir`
  (`git add -- <meshDir>`) so a tick never sweeps unrelated working-tree changes — this keeps the "clean
  no-op when no staged mesh changes" scenario honest.
- **Cadence config** reads off `workspace.config.mesh.sync.cadenceSeconds` (raw `readJson`, not schema-gated).
  The schema has no `mesh` block yet, but the top-level schema has **no** `additionalProperties:false`, so a
  `mesh` block validates cleanly — a `mesh` `$def` in `schemas/aof.schema.json` is a nice-to-have a later
  milestone may add, **not** required for m22.
- **The `argsFor` case is load-bearing** (same as story 01): add the `aof mesh sync` `argsFor` case in the
  same change that registers `mesh:sync`, or the `mesh:`-bijection gate stays RED.
- **Coordination note (additive co-touch, not a defect):** stories 01 and 02 both append to
  `command-core.mjs`'s `COMMANDS` array, `cli.mjs`'s `meshCommand` ladder, and the bijection test's `argsFor`
  switch — a textual add-only merge (different lines, same files), the standard 07/ADR-006 co-touch.
