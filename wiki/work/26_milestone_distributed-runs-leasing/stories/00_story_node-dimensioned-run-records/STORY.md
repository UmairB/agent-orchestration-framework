---
type: story
number: 00
slug: node-dimensioned-run-records
title: "Node-dimensioned run records — the runs/<node>/ partition made real in run-store + the sync root-set, the git substrate (no lease, no relay)"
parent: 26
status: done
owner: product-owner
created: 2026-07-02
updated: 2026-07-03
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · Node-dimensioned run records — the git substrate

## User story

As an operator running aof on more than one machine against one shared work stream,
I want each node's run records written under its own `runs/<node>/<run-id>.json` partition (the m22-frozen convention made real) and moved by the sync engine, while a single-node install keeps writing the flat `runs/<run-id>.json` byte-identically to today,
so that two nodes' concurrent run records merge **add-only** over git — never a content conflict — and every reader (dedup, complete, presence, the board) sees one union of the fleet's runs, which is the substrate leasing (story 01) and fleet reclaim (story 02) stand on.

<!-- This story is the dependency ROOT: it owns the milestone's highest-fan-in spine (run-store ← 6
     dependents) and freezes the contracts the sibling stories build against — the fourteen-key record
     (additive `node`), the union read, the record-driven persist, the RESERVED leaseClaimPath builder,
     and syncMesh's root-set argument. It touches NO command file and NO lease/relay logic. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 26 --autonomous`, Contract stage). Each behaviour
     task is one `.feature` under tasks/; done when its feature is green. The fitness functions are
     arch-tests (structural invariants → never a behaviour feature) tracked as buildable units below. -->

- [x] `tasks/00_node-dimensioned-records.feature` — the fourteen-key record + the record-driven persist + the union readers (ADR-001): a run minted **with** a `node` persists at `runs/<node>/<run-id>.json` (exactly the m22-frozen `runNodeRecordPath` shape) and carries `node` as the fourteenth key; minted **without** ⇒ the flat legacy path with `node: null`, byte-identical to today (the store reads no config — the node id arrives as data); a legacy thirteen-key record on disk reads forward with `node: null` (absence is benign); `readRuns` returns the UNION of flat entries + one level of node subdirs (same normalization, same torn-file tolerance); the dedup guard refuses a duplicate non-terminal run **across nodes**; `completeRun`'s no-runId resolution sees every node's running runs; runId uniqueness spans the union — two nodes minting at the same instant get distinct ids.
- [x] `tasks/01_sync-root-set.feature` — the sync-scope generalisation (ADR-002): `syncMesh(workspace, { roots })` defaults to `[meshDir]` and preserves today's behaviour **byte-for-byte** for every existing call site; a mesh-aware root set adds the runs pathspec so run-record writes commit/push on the tick; an operator's unrelated working-tree edit is NEVER swept into a mesh commit; the engine stays content-agnostic (moves bytes, parses nothing); the honest failure envelopes (`push-failed`/`pull-failed`) are unchanged.
- [x] `tasks/02_add-only-run-merge.feature` — the outsider-verifiable add-only property (ADR-001 + ADR-002): two clones over a shared bare remote each mint a run for the SAME item under their own node dirs; both sync; the merge is add-only (no content conflict, no wedged MERGING state); each clone then reads the union with BOTH nodes' records intact byte-for-byte. `@executable` over real git fixtures (the m22 transport-task precedent).
- [x] **Structural deliverable — `leaseClaimPath` RESERVED** (ADR-003.1, the m22→m23 seam-reservation idiom): the pure builder `leaseClaimPath(workspace, itemRef, nodeId)` = `join(meshDir, "leases", flatLeaf(itemRef), flatLeaf(nodeId) + ".json")` lands in `mesh-store.mjs` beside `presenceRecordPath`, routed through the SAME `flatLeaf` boundary — named, not built: it writes nothing (story 01 builds the writes).
- [x] **Fitness `acd-run-node-path-single-builder`** (arch-test, ADR-001 / fitness #1) — `runNodeRecordPath` defined ONCE in `run-store.mjs` (built FROM `runsDir`, the frozen shape byte-identical); `mesh-store.mjs` RE-EXPORTS it; no second `join(runsDir…, node…)` in `src/`; the persist path routes through the builder.
- [x] **Fitness `acd-run-record-node-additive`** (arch-test, ADR-001 / fitness #2) — the fourteen-key freeze: `20/ADR-001`'s thirteen unchanged in name/order + `node` appended defaulting `null`; a thirteen-key record normalizes forward.
- [x] **Fitness `acd-runs-eol-pinned`** (arch-test, ADR-001 / fitness #3, the 23/R3 carry-forward) — `.gitattributes` rules MATCH the real sample paths `wiki/work/<item>/runs/<node>/<run-id>.json` + the flat shape (git-semantics matching, never a literal grep); asserts `.mesh/leases/**` is already covered by `**/.mesh/**`.
- [x] **Fitness `acd-run-store-mesh-free`** (arch-test, ADR-001 / fitness #4) — `run-store.mjs` imports NO mesh module and reads no config; the mint's `node` is parameter-sourced.
- [x] **Fitness `acd-sync-root-set`** (arch-test, ADR-002 / fitness #5) — the root-set default `[meshDir]`, the pathspec iteration, the runs-pathspec resolver's single home; the existing `acd-mesh-sync-record-neutral` re-arms green over the modified engine.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** — the `<node>/` segment lands
in `run-store.mjs`; the fourteen-key freeze superseding `20/ADR-001`; union readers; the builder-authority
move with the `mesh-store.mjs` re-export — the import direction forbids the reverse; the R3 pin on the REAL
nested path. **ADR-002** — `syncMesh(workspace, { roots })` defaulting `[meshDir]`; the engine stays
content-agnostic; work-stream record docs deliberately NOT in the staged set). This story **owns**:
`src/run-store.mjs` (the fourteen-key record, union readers, record-driven persist, union-probing mint),
`src/mesh-store.mjs` (the `runNodeRecordPath` re-export flip + the RESERVED `leaseClaimPath`),
`src/mesh-sync.mjs` (the root-set argument + the runs-pathspec resolver + the honest header comment), and
`.gitattributes` (the R3 pin). It touches NO command file (the `node` pass-through is story 02's) and NO
relay/lease logic.

**The dependency root.** The frozen contracts the siblings build against: the fourteen-key record + the
`node` mint option, the union read, `leaseClaimPath`, `syncMesh(workspace, { roots })`. Graph-grounded:
`run-store.mjs` is the milestone's widest-fan-in spine (← 6 dependents) — it is frozen here, alone, first;
no other story co-edits any of this story's files.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Feasibility verdict at Contract: all three features FEASIBLE, zero retags, all four QA flags locked
     into the feature comments (the RESOLVED blocks). Implementation guidance surfaced here; no ADR change. -->

**Verdict:** FEASIBLE. Every `@executable` scenario runs in-process over `src/run-store.mjs` /
`syncMesh` against `mkdtemp` fixtures — the proven idiom in
[test/run-dedup-atomic-persist.test.mjs](../../../../../test/run-dedup-atomic-persist.test.mjs) (makeRepo /
milestoneItem / writeRecord, injected-`now` same-instant seq assertion) and
[test/mesh-git-sync-transport.test.mjs](../../../../../test/mesh-git-sync-transport.test.mjs) (bare remote +
two clones, the add-only merge already green).

**The four QA flags — resolved (locked in the feature comments):**
- **(task 00) "byte-identical to today"** — wire as parsed-record assertions (placement at `runRecordPath`,
  the thirteen legacy values verbatim, `node: null`), NOT a raw-byte file compare: key ORDER is fitness #2's
  seam. (values verbatim) ∧ (fitness #2's order freeze) ∧ (the unchanged `JSON.stringify(record, null, 2)`
  persist, [run-store.mjs:145](../../../../../src/run-store.mjs#L145)) jointly equal byte-identity.
- **(task 01) pull-failed rows** — `git remote set-url origin <tmp>/does-not-exist.git` (the fetch-url
  sibling of `breakPushRemote`'s `set-url --push`): `hasRemote` stays true
  ([mesh-sync.mjs:72](../../../../../src/mesh-sync.mjs#L72)), the pull fails offline + deterministically, and
  the engine returns `pull-failed` before any push ([:165–170](../../../../../src/mesh-sync.mjs#L165)).
- **(task 02) fixture EOL** — the m22 neutralisation (`core.autocrlf false` + `core.eol lf` + fixture
  `.gitattributes` `* -text`); `-text` is strictly stronger than `eol=lf` for byte-stability, and fitness #3
  asserts the REAL R3 pin separately over this repo's `.gitattributes` — so nothing is weakened, assertions
  stay strict byte-for-byte.
- **(task 02) spawn discipline (22/R3)** — route every git spawn through `spawnSyncHardened` from
  [test/support/cli-spawn.mjs](../../../../../test/support/cli-spawn.mjs) (retries only `status===null`).

**`src/run-store.mjs` — the node dimension (all additive on existing seams):**
- **Builder:** define `runNodeRecordPath(item, node, runId)` = `join(runsDir(item), node, runId + ".json")`
  beside `runRecordPath` ([:59](../../../../../src/run-store.mjs#L59)) — byte-identical to the m22-frozen
  shape at [mesh-store.mjs:85](../../../../../src/mesh-store.mjs#L85); no `flatLeaf` here (fitness #1 asserts
  shape-equality).
- **`buildRecord`** ([:155](../../../../../src/run-store.mjs#L155)) — `node = null` in the options; append
  `node` as the FOURTEENTH key after `reclaimedAt`. **`normalizeRecord`**
  ([:177](../../../../../src/run-store.mjs#L177)) — append `node: raw.node ?? null`.
- **`persist`** ([:143](../../../../../src/run-store.mjs#L143)) — record-driven placement:
  `record.node ? runNodeRecordPath(item, record.node, record.runId) : runRecordPath(item, record.runId)`.
  This one edit gives completion / heartbeat / reclaim their persist-back-at-node-path for free (all route
  through `persist` via `applyTransition`).
- **Union resolver (new private `findRunPath`):** check flat `runRecordPath`, else scan one level of subdirs
  for `<sub>/<runId>.json` (ENOENT-tolerant). Consumers: `readRun`
  ([:266](../../../../../src/run-store.mjs#L266)) and the mint write-if-absent probe
  ([:219](../../../../../src/run-store.mjs#L219), exists-anywhere-in-union).
- **`countRunFiles`** ([:128](../../../../../src/run-store.mjs#L128)) + **`readRuns`**
  ([:240](../../../../../src/run-store.mjs#L240)) — `readdir(..., { withFileTypes: true })`: files → flat,
  directories → one-level `*.json` read; per-file torn-skip stays per entry; the existing runId sort already
  yields the union ordering. `retryRun`'s node-threading is story 02's command business — NOT here.
- **LOAD-BEARING existing-test ripple:** five files freeze the thirteen-key list and WILL go red on the
  fourteen-key supersede — append `"node"` to each `FROZEN_KEYS` literal:
  [run-commands.test.mjs:25](../../../../../test/run-commands.test.mjs#L25),
  [run-retry-command.test.mjs:23](../../../../../test/run-retry-command.test.mjs#L23),
  [run-store-record.test.mjs:22](../../../../../test/run-store-record.test.mjs#L22),
  [run-dedup-atomic-persist.test.mjs:23](../../../../../test/run-dedup-atomic-persist.test.mjs#L23),
  [run-resilience-record-keys.test.mjs:25](../../../../../test/run-resilience-record-keys.test.mjs#L25) (its
  `RESILIENCE_KEYS` is untouched). Thirteen-key *fixtures* elsewhere read forward benignly — no change.

**`src/mesh-store.mjs` — the re-export flip + the reservation:**
- [:36](../../../../../src/mesh-store.mjs#L36) import gains `runNodeRecordPath`; delete the local definition
  [:85–87](../../../../../src/mesh-store.mjs#L85); add it to the re-export at
  [:91](../../../../../src/mesh-store.mjs#L91). Every import site is unchanged.
- **`leaseClaimPath` RESERVED** beside `presenceRecordPath` ([:73](../../../../../src/mesh-store.mjs#L73)):
  `join(meshDir(workspace), "leases", flatLeaf(itemRef), flatLeaf(nodeId) + ".json")` through the same
  `flatLeaf`, with the writes-nothing RESERVED comment (the `presenceRecordPath` idiom).

**`src/mesh-sync.mjs` — the root set (every pathspec site):**
- [:114](../../../../../src/mesh-sync.mjs#L114) → `syncMesh(workspace, { roots } = {})`; resolve
  `rootSet = roots ?? [meshDir(workspace)]` (the default literal fitness #5 greps).
- Stage [:128](../../../../../src/mesh-sync.mjs#L128) — **one `git add -- <root>` per root** (git add aborts
  on a no-match pathspec; the per-root form keeps the tolerated-non-zero semantics per root). Staged-names
  diff [:134](../../../../../src/mesh-sync.mjs#L134) → `-- ...rootSet`. Commit
  [:150](../../../../../src/mesh-sync.mjs#L150) → pass ONLY roots that had staged paths (compute staged names
  per root) so an unmatched commit pathspec can never abort the tick. Pull
  [:165](../../../../../src/mesh-sync.mjs#L165) — UNCHANGED (branch-wide). Pulled-names diff
  [:174](../../../../../src/mesh-sync.mjs#L174) → `-- ...rootSet` (flips the pulled-report rows).
- **Runs-pathspec resolver, single home:** `runsPathspec(workspace)` beside `syncMesh` returning the
  `<workDir>/**/runs/**` glob. At spawn, normalize a glob-containing root to a repo-relative forward-slash
  glob-magic pathspec (`":(glob)" + relative.split(sep).join("/")`) — a real Windows trap; plain roots
  (meshDir) pass through absolute as today.
- Amend the header over-promise ([:8–11](../../../../../src/mesh-sync.mjs#L8) and
  [:85–99](../../../../../src/mesh-sync.mjs#L85)) to the honest claim: content-agnostic always, scope by
  argument.
- **HIDDEN ripple (must-do):** the existing gate
  [acd-mesh-sync-record-neutral.test.mjs:206–208](../../../../../test/arch/acd-mesh-sync-record-neutral.test.mjs#L206)
  asserts the commit argv matches `/["'`]--["'`]\s*,\s*root\b/` — the roots-set form will NOT match. Extend
  that regex (and its non-vacuous self-checks) to accept the set form while still failing on an unscoped
  commit — the "re-arms GREEN over the modified engine" clause (fitness #5), made concrete.

**`.gitattributes` — the R3 pin.** Append after the `**/.mesh/**` rule
([:21](../../../../../.gitattributes#L21)): `**/runs/**/*.json text eol=lf`. The `/**/` matches
zero-or-more dirs, so ONE rule covers both the flat `wiki/work/<item>/runs/<run-id>.json` and the nested
`.../runs/<node>/<run-id>.json`; the `*.json` scope avoids marking a future binary artifact as text.
`.mesh/leases/**` needs no new rule (`**/.mesh/**` already covers it).

**The five arch-tests (approach + registration):** #1 assert function identity
`meshStore.runNodeRecordPath === runStore.runNodeRecordPath` (the strongest re-export proof) + shape-equality
+ a comment-stripped grep for a second `join(runsDir(...), <node>, ...)`; #2 mint→`deepEqual(Object.keys,
FOURTEEN_KEYS)` + a thirteen-key record reads forward with `node: null`; #3 **git-semantics** (`git
check-attr text eol -- <real nested sample> <flat sample> <.mesh/leases sample>` parsed, an out-of-scope
path reports `unspecified` as the non-vacuous control — the R3 method, NOT a literal grep); #4
`importSpecifiers(run-store.mjs)` matches no `mesh-*` + no `config` read + the mint's `node` is
parameter-sourced; #5 grep the default `[meshDir(workspace)]`, the pathspec iteration, `runsPathspec` defined
once, and ENUMERATE the re-armed `acd-mesh-sync-record-neutral`. Register three behavioural suites +
the five arch imports in [scripts/test.mjs](../../../../../scripts/test.mjs) as a new "milestone 26 (story
00)" block (the established block-comment + spread idiom).
