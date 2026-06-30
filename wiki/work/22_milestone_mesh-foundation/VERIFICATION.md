---
doc: verification
milestone: 22
updated: 2026-06-30
---
<!--
  Milestone VERIFICATION.md — the record of WHAT was checked and WHAT was found.
  Written by aof:verify. Pointers + evidence, never restatements. Sections with no
  content are omitted (absence is information). No @uat scenarios in this milestone,
  so there is no `## User sign-off`; no UI surface, so no design-conformance section.
-->
# 22 · Mesh Foundation — Verification

## Automated + fitness evidence

- `@executable` suite + the 4 mesh fitness functions: **green**. `node ./scripts/test.mjs` →
  exit 0, **1598 ok / 0 not ok**, run **3× this session** (on top of the build's 3 consecutive
  green runs) with **zero** failures. The flake-detection process-point (STATE `## Feedback`,
  raised at `aof:verify 21`) is satisfied: the previously-flaky `arch/mesh-bijection` proof (c)
  — the registry-derived `aof mesh <sub> --json` spawn over a `mkdtemp` fixture — passed in every
  run, now routed through the `spawnCliSync` Windows-CreateProcess retry seam.
- The 4 fitness functions, each green (`verifies →` ARCHITECTURE.md fitness #1–#4):
  - `arch/mesh-partition-write` (#1) — `meshDir`/`nodeRecordPath` single partition seam; N ids → N
    discrete files, no aggregate.
  - `arch/mesh-write-scope` (#2) — store + the `mesh:*` command modules reference zero record-doc
    filename and route every write through the atomic `writeText` seam.
  - `arch/mesh-bijection` (#3) — every registered `mesh:*` carries a non-null cli adapter; the
    `meshCommand` dispatcher has a reachable branch per registry-derived sub; `--json` parses for each.
  - `arch/mesh-sync-record-neutral` (#4) — `mesh-sync.mjs` imports no node-record schema, does no
    parse-then-rewrite, the loop holds no git logic, and the commit carries a `-- <partition-root>`
    pathspec (a concurrent operator's pre-staged change is never folded in).

## Verification evidence

### `@manual` 22/02/02 — two nodes on a shared remote each render the other's, purely over git
`verifies →` `stories/02_story_git-sync/tasks/02_two-node-render-over-remote.feature` (the SPEC §Objective
outsider-verifiable acceptance + the PRD A1 durable-bus entry point).

**Procedure (agent-run, driven only through the registered `aof mesh` CLI face — no hand-edited records).**
A shared **bare** git remote; two clones ("node A" id `node-alpha`, "node B" id `node-beta` — distinct
operator-set `mesh.nodeId`s on one host faithfully simulate two hosts, since `mesh:identity` derives the id
locally from `os.hostname()`). Each node ran `aof mesh identity` → `aof mesh sync`, then `aof mesh sync` →
`aof mesh status`. Harness + full transcript: scratchpad `mesh-manual.sh`.

**Result — all three feature scenarios PASS (11/11 assertions, `core.autocrlf=false`):**
- *Round-trip render* — node A's `mesh status` lists **both** `node-alpha` (self) and `node-beta` (peer)
  with id + capabilities (`runtimes: claude, codex; 22 skill(s)`); node B's lists both. Each node's **own**
  record file is **byte-identical** before/after pulling the peer (the pull never rewrote the unaffected
  side — R4). Neither sync returned a failure envelope (no `synced:false`) → the add-only merge held.
- *Concurrent add-only* — both nodes (re)published and synced with **no** non-fast-forward rejection; the
  remote holds **both** records as committed objects; node B's record arrived **byte-identical** in node A's
  tree (owner-authored, not content-merged).
- *Purely over git, no relay* — the remote's git history carries **both** `nodes/*.json` record files as
  ordinary committed blobs; `node-alpha.json` traces to a commit authored by **nodeA**, `node-beta.json` to
  **nodeB** — git alone transported the records (there is no relay in this milestone).

**Note (not a defect).** With the host's `git core.autocrlf=true`, a peer's *checked-out* record copy is
CRLF (634 B) vs the owner's LF original (600 B) — `tr -d '\r'` confirms the content is byte-identical; the
divergence is git's platform line-ending normalization on checkout, orthogonal to the mesh's partition/sync
logic (`mesh:status` reads via `JSON.parse`, so it is line-ending-agnostic). Surfaced as finding **F1**.

## Findings

| id | observed | type | severity | triage (PO) | routed-to | status |
|----|----------|------|----------|-------------|-----------|--------|
| F1 | The git-tracked `.mesh/` record files have no `.gitattributes` line-ending pin. On a node with `core.autocrlf=true` (or a mixed-OS fleet), a peer's checked-out record is CRLF while the owner's original is LF — content-identical, byte-divergent. Not a sync defect (the engine moves bytes faithfully; git normalizes on checkout). | design-gap (bus convention) | low | non-blocker | backlog → m23 (builds presence on the same bus): pin `.mesh/**` (or the record `*.json`) to `eol=lf` / `-text` so records are byte-stable across platforms. | deferred |
| F2 | `mesh:identity.run` derives the node id from `os.hostname()` **without** feeding `takenIds`, so two installs on the **same host** derive the **same** id (`umairs-msi`) → the same `nodes/<id>.json` path → they alias/overwrite each other. ADR-003's collision-suffix mechanic exists in `deriveNodeId` but is unreachable from the command path (a first publish precedes any sync, so there is no roster to disambiguate against). | latent gap (id derivation) | low | non-blocker | backlog + retro: realistic deployment is distinct hosts and an operator can set `mesh.nodeId` (precedence #1); either wire `takenIds` from the post-sync roster on republish, or document the same-host constraint. | deferred |

No **blocker** finding is open — both findings are non-blockers (deferred). The milestone's load-bearing
objective (two nodes each render the other's record, merge-clean, purely over git, no relay) is met.

## Accept decision

**ACCEPTED — `2026-06-30` by `aof:verify 22`.** The `@executable` suite + all 4 fitness functions are green
(3 verify-time runs, 0 failures, flake-detection satisfied); the `@manual` outsider-verifiable acceptance
passes end-to-end (11/11) driven only through the registered `aof mesh` face; the two findings (F1, F2) are
non-blockers deferred to backlog/m23 + retro; `aof:validate 22` → PASS (below). All three stories
(00 mesh-store, 01 node-identity, 02 git-sync) are `done`; the milestone is `done`.
