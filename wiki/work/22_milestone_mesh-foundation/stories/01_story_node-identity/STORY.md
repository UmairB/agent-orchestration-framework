---
type: story
number: 01
slug: node-identity
title: "Node identity & capability advertisement — src/node-identity.mjs + the mesh:identity / mesh:status commands"
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
# 01 · Node identity & capability advertisement

## User story

As an operator turning one aof install into a node (and the capability-routing milestones that will route work by what a node can run),
I want each install to derive a stable, human-readable node id and assemble a capability descriptor (host, OS, supported runtimes `claude`/`codex`, installed skills), publish it as a git-tracked per-node record, and read back this node's identity and the synced roster through registered `mesh:identity` / `mesh:status` command-core commands,
so that a node advertises *who it is and what it can do* into the work stream — the substrate later milestones route work over — entirely through the milestone-08 one door, the CLI a thin face.

<!-- This story produces the records. It owns the node-identity mechanic + the two identity-record commands;
     it WRITES only through story 00's store seam and NEVER calls the sync engine (story 02 moves the
     records). Parallel with story 02 by construction (it produces records; sync is payload-agnostic). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 22 --autonomous`, Contract stage). Each behaviour task
     is one `.feature` under tasks/; done when its @executable feature is green. The bijection fitness
     function (story 00, registry-derived) auto-covers these commands' presence. -->

- [x] `tasks/00_node-identity-descriptor.feature` — node-id derivation is deterministic + stable (sanitized hostname, persisted to `mesh.nodeId` on first publish, reused thereafter; a collision appends a stable per-install hash); the capability descriptor carries the complete frozen schema — `nodeId`, `host`, `os`, `runtimes` (from config), `skills` (installed bundle), `aofVersion`, `publishedAt` — all present + correctly typed; the descriptor is rebuildable (a projection of config + environment).
- [x] `tasks/01_mesh-identity-status-commands.feature` — the two registered commands carry the frozen `{id,input,run,cli}` shape; `mesh:identity` publishes this node's record (via story 00's store) and reads it back (republish bumps `publishedAt`, the id is stable); `mesh:status` lists the synced node roster (this node + any peers' records in the tree); stable `--json` shapes; an empty roster reads as empty, not an error.
- [x] `tasks/02_mesh-identity-cli-face.feature` — `aof mesh identity` (publish/read self) and `aof mesh status` (list the roster) each `argv → invoke → render`/`--json`; the `--json` face emits one parseable envelope (success or `{ ok:false, error, code }`); the human render lists each node with its id + capabilities; a bad invocation renders the structured error envelope and exits non-zero.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-003** — node-id derivation + the frozen
capability-descriptor schema, git-tracked + derived/rebuildable + additive-friendly; the conscious 17/ADR-001
departure to git-tracked records). This story **owns**: `src/node-identity.mjs` (deterministic id derivation +
descriptor assembly) + `src/commands/mesh-identity.mjs` (the `mesh:identity` + `mesh:status` commands, thin
over story 00's `mesh-store.mjs`), their registration in
[command-core.mjs](../../../../../src/command-core.mjs) (one import + one `COMMANDS` entry each — the additive
08 move), the `aof mesh identity` / `aof mesh status` dispatch branches + `argsFor` cases in
[cli.mjs](../../../../../src/cli.mjs)'s `meshCommand` (the skeleton story 00 ships), and a config read of
`mesh.nodeId` / `config.runtimes`.

**Depends on story 00's frozen contract** (the partition seam + the node-record schema + the `meshCommand`
skeleton) — so this contract is authorable in parallel with story 00 (against the frozen ADRs, the
milestone-08 model). **Parallel with story 02**: it produces records and **never calls the sync engine**;
story 02's transport is payload-agnostic and moves whatever records exist. The only co-touched files are the
additive door (`command-core.mjs`'s `COMMANDS` array + `cli.mjs`'s `meshCommand` dispatcher) — one
import/entry/case, no shared line edited (the 07/ADR-006 discipline).

**Feasibility (developer amigo seat — confirmed at Contract): FEASIBLE.** Every derivation input is in hand:
id = `os.hostname()` sanitized + a persisted config key + a deterministic `crypto` hash suffix on collision;
`host`/`os` = `os.hostname()`/`process.platform`; `runtimes` = `config.runtimes`; `skills` = the installed
bundle skill ids via `loadBundle()` ([work-bundle.mjs](../../../../../src/work-bundle.mjs)); `aofVersion` =
the package version (read via the `bundleRoot()` `import.meta.url` idiom). The two commands mirror
`work:run-status` (a READ) and `feedback` (a WRITE) in shape; the CLI face is the `runVerbCli` single-envelope
idiom.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Implementation guidance surfaced at Contract; none is a contract defect (no `.feature`/ADR change). -->

- **Persist `mesh.nodeId` via the headroom read-merge-write idiom** ([work-headroom.mjs](../../../../../src/work-headroom.mjs):
  `readJson(configPath) → mutate only the one subtree → writeText(2-space + trailing \n)`). **Do NOT** route
  through [config-editor.mjs](../../../../../src/config-editor.mjs)'s `baseConfig()`/`saveEditableSections` —
  that is a deliberate whitelist that would **drop an unknown `mesh` block** on rewrite. (Same seam serves the
  per-install salt persistence for the collision suffix.)
- **Inject hostname + salt** into the derivation function (white-box) so the sanitization matrix + the
  collision-suffix scenarios are testable without touching the real machine.
- **Empty-stem fallback** (resolved mis-spec): when the sanitized hostname is empty, derive
  `node-<install-hash>` (reuse the same stable per-install hash that disambiguates collisions) — never an
  empty/invalid id. The id stays deterministic + `[a-z0-9-]`-only.
- **`skills` source** — read installed skill ids from `loadBundle()` (what this install ships) and/or the
  project config `resources`; the contract leaves the exact source open ("installed bundle skill ids").
- **The `argsFor` case is load-bearing:** the `mesh:`-bijection test's `argsFor` switch throws on an unmapped
  sub (the 19/R1 pattern) — so this story MUST add the `aof mesh identity`/`status` `argsFor` cases in the
  same change that registers the commands, or it leaves the gate RED.
- **Face vs command on a read-miss:** the *command* `mesh:identity` read returns absent (not an error); the
  *CLI face* `aof mesh identity <id>` on an id with no record surfaces `node-not-found` (asking for a specific
  node that doesn't exist is a face-level error) — a deliberate, internally-consistent split (cf. QA's matrix).
