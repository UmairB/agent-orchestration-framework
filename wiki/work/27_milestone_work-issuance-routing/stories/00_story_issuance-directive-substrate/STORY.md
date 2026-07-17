---
type: story
number: 00
slug: issuance-directive-substrate
title: "The issuance directive substrate + the eligibility matcher — the git-pure .mesh/issuance/ record + nodeSatisfiesTarget, the dependency root (no command, no UI)"
parent: 27
status: done
owner: product-owner
created: 2026-07-03
updated: 2026-07-03
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · The issuance directive substrate + the eligibility matcher — the git substrate

## User story

As an operator running aof across more than one machine against one shared work stream,
I want a fleet-reachable **issuance directive** record — one per-issuer partitioned `.mesh/issuance/<issuer>/<item-ref>.json` file with a frozen six-key schema — plus a pure **targeting matcher** that answers "does this node satisfy this directive's target?" against the m22 capability descriptor read as data,
so that routing (story 01) and the fleet-UI affordance (story 02) build on **one** frozen contract, two nodes' directives merge **add-only** over git (never a content conflict), and an issued item can be matched to an eligible node by node id or by capability (runtime / skill) with a single, testable, side-effect-free predicate.

<!-- This story is the dependency ROOT: it owns the milestone's new substrate module and reserves its
     path builder on the mesh-store spine, freezing the contracts stories 01/02 build against — the
     six-key directive, the `target` discriminated union, `issuanceDirectivePath`, `readIssuanceDirectives`,
     and `nodeSatisfiesTarget`. It touches NO command file, NO relay, NO UI. Git-pure — provable over plain
     git fixtures (the `mesh-lease.mjs` shape). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 27 --autonomous`, Contract stage). Each behaviour
     task is one `.feature` under tasks/; done when its feature is green. The fitness functions are
     arch-tests (structural invariants → never a behaviour feature) tracked as buildable units below. -->

- [x] `tasks/00_issuance-directive-record.feature` — the six-key directive assembly + the union read (ADR-001): `assembleDirective` yields EXACTLY `{ itemRef, issuer, target, state, issuedAt, aofVersion }` for each `target` kind (any / node / capability), carrying `state:"issued"`, an ISO-8601-Z `issuedAt`, and `aofVersion` provenance; `readIssuanceDirectives(workspace)` reads the UNION across every issuer partition (two different issuers with a directive for the same item ⇒ both returned; many items across many issuers ⇒ all returned); absence-tolerant (no `.mesh/issuance/` ⇒ `[]`, never a throw); a torn/unparseable directive file is skipped and the rest still read; an assembled directive round-trips through `issuanceDirectivePath(ws, issuer, ref)` byte-faithfully. Story-00 writes are FIXTURE-WRITTEN (the production write is story 01's).
- [x] `tasks/01_targeting-matcher.feature` — the `nodeSatisfiesTarget` truth table (ADR-003): `{kind:"any"}` ⇒ true for every descriptor (incl. a bare install with empty runtimes+skills); `{kind:"node", nodeId}` ⇒ true iff `descriptor.nodeId === nodeId`; `{kind:"capability", value}` ⇒ true iff `value` ∈ `runtimes[]` OR ∈ `skills[]` (runtime-only match, skill-only match, no-match, bare-install-false — absent fields coerce to `[]`, never a crash); an unknown/malformed `target.kind` ⇒ false (fail-safe: an unroutable directive offers to nobody, never everybody); the verdict reads only `nodeId`/`runtimes`/`skills`, never the other frozen descriptor fields. Pure-data fixtures, zero fs.
- [x] `tasks/02_add-only-directive-merge.feature` — the outsider-verifiable add-only property (ADR-001 + ADR-005): two clones over a shared bare remote each write a directive under their OWN issuer partition (fixture-written at `issuanceDirectivePath`); both sync over the DEFAULT `[meshDir]` root set (no runs pathspec — the directive lives under `.mesh/`); the merge is add-only (distinct issuer paths, no content conflict, no wedged MERGING state); each clone then reads the union with BOTH directives intact byte-for-byte; two issuers issuing the SAME item ⇒ two files at DISTINCT paths, both survive the merge (the partition invariant held strictly). `@executable` over real git fixtures (the m22 transport-task / m26 story-00 `02_add-only-run-merge` precedent).
- [x] **Structural deliverable — `issuanceDirectivePath` RESERVED** (ADR-001.1, the m22→m23→m26 seam-reservation idiom): the pure builder `issuanceDirectivePath(workspace, issuerNodeId, itemRef)` = `join(meshDir(workspace), "issuance", flatLeaf(issuerNodeId), flatLeaf(itemRef) + ".json")` lands in `mesh-store.mjs` beside `leaseClaimPath`/`presenceRecordPath`, routed through the SAME `flatLeaf` boundary — named, not built: it writes nothing (story 01 builds the writes).
- [x] **Fitness `acd-issuance-record-frozen`** (arch-test, ADR-001 / fitness #2) — `assembleDirective`/`readIssuanceDirectives` carry EXACTLY the six keys `itemRef, issuer, target, state, issuedAt, aofVersion` in that name/order; `state ∈ {issued, withdrawn, fulfilled}`; `target` is the discriminated union `{kind: any|node|capability}`; AND the `.gitattributes` `**/.mesh/** text eol=lf` rule MATCHES the real nested sample path `wiki/work/<item>/.mesh/issuance/<node>/<ref>.json` by git-semantics matching (never a literal grep; NO new pin authored — the existing rule covers it). The schema half is SPECIFY (RED-until-module); the EOL-match half is **green now**.
- [x] **Fitness `acd-targeting-matcher-descriptor-pure`** (arch-test, ADR-003 / fitness #3) — `nodeSatisfiesTarget(descriptor, target)` in `src/mesh-issuance.mjs` reads ONLY the frozen `22/ADR-003` fields (`nodeId`/`runtimes`/`skills`); `any` ⇒ true, `node` ⇒ nodeId match, `capability` ⇒ runtimes-or-skills membership, unknown kind ⇒ false; the module imports NO `node-identity.mjs` (no derive/assemble — the matcher re-derives nothing); m03 planted-violation self-check. SPECIFY (RED-until-module).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) — **ADR-001** (the per-ISSUER partitioned
`.mesh/issuance/<issuer>/<item-ref>.json` record; the frozen six-key schema `{ itemRef, issuer, target,
state, issuedAt, aofVersion }`; the `issued → withdrawn | fulfilled` lifecycle; it rides the DEFAULT
`[meshDir]` sync with zero engine change and the existing `**/.mesh/**` EOL pin already covers it — no new
`.gitattributes` rule owed), **ADR-003** (the pure matcher `nodeSatisfiesTarget(descriptor, target)`:
`any` ⇒ true, `node` ⇒ nodeId match, `capability` ⇒ membership in `runtimes[]`/`skills[]`, unknown kind ⇒
false; reads only the m22-FROZEN descriptor fields, imports no `node-identity.mjs` mechanic).

This story **owns**: `src/mesh-issuance.mjs` (NEW — `assembleDirective` the six-key record;
`readIssuanceDirectives` the `readLeaseClaims`-shaped absence-tolerant / torn-file-skipping walk one level
deeper; `nodeSatisfiesTarget` the pure matcher) and the RESERVED `issuanceDirectivePath(workspace,
issuerNodeId, itemRef)` pure builder in `src/mesh-store.mjs` (beside `leaseClaimPath`/`presenceRecordPath`,
routed through the SAME `flatLeaf` boundary — named, writes nothing; story 01 builds the writes).

Arms fitness **#2** (`acd-issuance-record-frozen` — the six-key schema + the EOL-match; the EOL-match half
is green-now) and **#3** (`acd-targeting-matcher-descriptor-pure` — the matcher reads only frozen descriptor
fields + imports no node-identity mechanic). The directive WRITES (`issueDirective`/`withdrawDirective`) are
story 01's, behind `mesh:issue`.

**The dependency root.** Graph-grounded: the new module couples the SAME way `mesh-lease.mjs` does
(git-pure, into `mesh-store`'s reserved path builder + `mesh-presence`), so it needs neither the relay nor
the command nor the UI to be proven; the `issuanceDirectivePath` reservation is ONE additive builder on the
`mesh-store.mjs` partition spine (← 7 dependents), exactly where `leaseClaimPath` sits. No other story
co-edits this story's files.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Feasibility verdict at Contract: all three features FEASIBLE, zero retags, all five QA flags locked
     into the feature comments (the RESOLVED blocks). Implementation guidance surfaced here; no ADR change. -->

**Verdict:** FEASIBLE. Every `@executable` scenario runs against the proven shapes: task 00/01 run
in-process, pure-data, zero fs (the `assembleClaimRecord`/`resolveArbitration` idiom,
[src/mesh-lease.mjs](../../../../../src/mesh-lease.mjs)); task 02 runs over a real bare-remote git fixture,
the exact
[test/mesh-git-sync-transport.test.mjs](../../../../../test/mesh-git-sync-transport.test.mjs) /
m26 story-00
[02_add-only-run-merge.feature](../../../../26_milestone_distributed-runs-leasing/stories/00_story_node-dimensioned-run-records/tasks/02_add-only-run-merge.feature)
precedent. Zero scenarios retag `@executable → @manual`.

**The five QA flags — resolved (locked in the feature comments):**
- **(task 00) `assembleDirective` + `issuanceDirectivePath` in-process import** — LOCKED to the
  `assembleClaimRecord` shape ([src/mesh-lease.mjs:56](../../../../../src/mesh-lease.mjs#L56), a bare
  object-literal return, zero fs/config/network): `assembleDirective({ itemRef, issuer, target, state =
  "issued", issuedAt, aofVersion })` in `src/mesh-issuance.mjs`, issuer/aofVersion/issuedAt ALWAYS supplied
  as injected data (never a live config read inside the assembler — the Background's "assembly accepts an
  injected issuedAt instant and provenance supplied as data" is the CONTRACT). `issuanceDirectivePath`
  exports from `src/mesh-store.mjs` beside `leaseClaimPath`
  ([src/mesh-store.mjs:90](../../../../../src/mesh-store.mjs#L90)), the exact reservation idiom.
- **(task 00) `issuedAt` determinism** — LOCKED to the injected-clock precedent, exact-value assert stays.
  `issuedAt` is a REQUIRED parameter the assembler stamps verbatim (no internal `new Date()` fallback,
  unlike `assembleDescriptor`'s `now ?? new Date().toISOString()`,
  [src/node-identity.mjs:143](../../../../../src/node-identity.mjs#L143)) — the stricter
  `assembleClaimRecord` form, where the caller always supplies `claimedAt`
  ([src/mesh-lease.mjs:61](../../../../../src/mesh-lease.mjs#L61), sourced from `acquireLease`'s injected
  `nowIso` at [:298](../../../../../src/mesh-lease.mjs#L298)). A wall-clock default is story 01's
  `mesh:issue` command concern, out of this story's pure-assembly scope.
- **(task 01) `nodeSatisfiesTarget` pure two-arg import** — LOCKED to the `claimLiveness` /
  `resolveArbitration` pure-predicate shape
  ([src/mesh-lease.mjs:147](../../../../../src/mesh-lease.mjs#L147),
  [:162](../../../../../src/mesh-lease.mjs#L162)): `export function nodeSatisfiesTarget(descriptor,
  target)`, two plain-data positional args, no injected roster/fs/config/clock. `runtimes`/`skills` are read
  via inline `Array.isArray(x) ? x : []` coercion (the `assembleDescriptor` field-coercion idiom,
  [src/node-identity.mjs:140-141](../../../../../src/node-identity.mjs#L140)) — no separate helper module,
  so nothing further needs a purity certificate.
- **(task 02) Windows EOL byte-stability** — LOCKED to the PROVEN m22/m26 harness neutralisation: per-clone
  `core.autocrlf false` + `core.eol lf` plus a fixture-level `.gitattributes` of `* -text`
  ([test/mesh-git-sync-transport.test.mjs:45-56,94](../../../../../test/mesh-git-sync-transport.test.mjs#L45)),
  strictly stronger than `eol=lf` for byte-stability. The REAL production pin (`**/.mesh/** text eol=lf`,
  [.gitattributes:21](../../../../../.gitattributes#L21)) is asserted SEPARATELY by fitness #2's
  git-semantics check over the real nested `wiki/work/<item>/.mesh/issuance/<node>/<ref>.json` sample path —
  the fixture neutralisation never masks it. Byte-for-byte assertions stay unweakened; every git spawn
  routes through `spawnSyncHardened`
  ([test/support/cli-spawn.mjs](../../../../../test/support/cli-spawn.mjs)).
- **(task 02) Default-root sync vs scripted transport** — LOCKED to the real bare-remote round trip, default
  root set. `syncMesh(workspace)` with NO second argument resolves `rootSet = roots ?? [meshDir(workspace)]`
  ([src/mesh-sync.mjs:148-149](../../../../../src/mesh-sync.mjs#L148)) — no runs pathspec, the identical
  default every existing caller already rides (`26/ADR-002`). The fixture is the REAL
  bare-remote-plus-two-clones harness (`buildFixture`/`clonePeer`), NOT a scripted envelope sequence — the
  scripted stand-in the m26 lease-of-record RESOLVED contract used is for the LEASE ARBITRATION unit
  (`mesh-lease.mjs`'s injected `runSync` closure), a different concern from this feature's TRANSPORT
  property proof.

**`src/mesh-issuance.mjs` (NEW) — the exported surface:**
- `assembleDirective({ itemRef, issuer, target, state = "issued", issuedAt, aofVersion })` — pure
  projection, returns EXACTLY the six keys in order `{ itemRef, issuer, target, state, issuedAt, aofVersion
  }` (the `assembleClaimRecord` idiom, [src/mesh-lease.mjs:56](../../../../../src/mesh-lease.mjs#L56)); no
  fs, no config, no clock — `issuedAt`/`aofVersion`/`issuer` are always caller-supplied data.
- `readIssuanceDirectives(workspace)` — the `readLeaseClaims` walk one level deeper
  ([src/mesh-lease.mjs:86-100](../../../../../src/mesh-lease.mjs#L86)): `readdir(join(meshDir(workspace),
  "issuance"), { withFileTypes: true })`, absence ⇒ `[]` (ENOENT caught, never thrown); for each issuer
  subdirectory, read every `*.json` file, `JSON.parse`, skip a torn/unparseable file (the `readClaimDir`
  per-file try/catch discipline, [src/mesh-lease.mjs:102-120](../../../../../src/mesh-lease.mjs#L102));
  return the flat union across every issuer partition — `itemRef` always read from the RECORD, never
  re-derived from the flatLeaf'd directory/file name.
- `nodeSatisfiesTarget(descriptor, target)` — the pure matcher (ADR-003), a total switch on `target?.kind`:
  `"any"` ⇒ `true`; `"node"` ⇒ `descriptor?.nodeId === target.nodeId`; `"capability"` ⇒
  `(coerce(descriptor?.runtimes).includes(target.value) || coerce(descriptor?.skills).includes(target.value))`
  where `coerce = (x) => Array.isArray(x) ? x : []`; any other/missing `kind` (including `target == null`)
  ⇒ `false`. Imports NOTHING from `src/node-identity.mjs` (fitness #3's structural gate).
- No write function lands in this story (`issueDirective`/`withdrawDirective` are story 01's, behind
  `mesh:issue` — ADR-001 consequences).

**`src/mesh-store.mjs` — the reservation:**
- `issuanceDirectivePath(workspace, issuerNodeId, itemRef)` = `join(meshDir(workspace), "issuance",
  flatLeaf(issuerNodeId), flatLeaf(itemRef) + ".json")`, landing beside `leaseClaimPath`
  ([src/mesh-store.mjs:90](../../../../../src/mesh-store.mjs#L90)), routed through the SAME `flatLeaf`
  boundary ([src/mesh-store.mjs:62](../../../../../src/mesh-store.mjs#L62)) — a PURE builder, writes
  nothing (the `presenceRecordPath`/`leaseClaimPath` "named, not built" reservation idiom, comment included).

**The fixture approach (task 02, add-only merge):** mirror
`test/mesh-git-sync-transport.test.mjs`'s `buildFixture`/`clonePeer` — a bare remote + two clones, each with
`configIdentity` (`core.autocrlf false`, `core.eol lf`, `commit.gpgsign false`) and the fixture-level `*
-text` `.gitattributes`. Each clone places its directive file DIRECTLY at `issuanceDirectivePath(ws,
ownIssuer, ref)` via a test helper (no production write exists yet), then drives a REAL `syncMesh(workspace)`
tick (no `roots` argument — the default `[meshDir]`) over `spawnSyncHardened`-wrapped git calls. Assert:
tick success envelopes, no `MERGING` state (`git status` / `.git/MERGE_HEAD` absence), both issuer paths
present with byte-identical content, and `readIssuanceDirectives` returning the converged union
directive-for-directive across both clones.

**Existing-test ripple:** none expected — `mesh-issuance.mjs` is a wholly NEW module and
`issuanceDirectivePath` is a NEW additive export; no existing `FROZEN_KEYS`-style literal or import-surface
assertion in `test/` enumerates `mesh-store.mjs`'s export list exhaustively (unlike m26 story-00's
`runNodeRecordPath` re-export flip, which rippled five `FROZEN_KEYS` literals). `.gitattributes` gains no
new rule (`**/.mesh/** text eol=lf` already covers `issuance/`, confirmed at
[.gitattributes:21](../../../../../.gitattributes#L21) — checked against the real nested sample path).

**The two arch-tests — registration in `scripts/test.mjs`:**
- **`acd-issuance-record-frozen`** (fitness #2) — SPLIT: the schema half (`assembleDirective`/
  `readIssuanceDirectives` carry exactly the six keys in name/order; `state ∈ {issued, withdrawn,
  fulfilled}`; `target` the discriminated union) is SPECIFY, RED-until-module (mirrors
  `acd-run-record-node-additive`'s RED-until-module posture pre-implementation) — it will go GREEN once
  `src/mesh-issuance.mjs` exists. The EOL-match half (the `**/.mesh/** ` rule matching the real nested
  `wiki/work/<item>/.mesh/issuance/<node>/<ref>.json` sample path via `git check-attr`, the `acd-runs-eol-pinned`
  method — NEVER a literal grep) is GREEN NOW, since the rule and the repo already exist; this half needs no
  module and should be written+registered as its own always-passing assertion inside the same arch-test file
  (the `acd-runs-eol-pinned` precedent of asserting an out-of-scope path reports `unspecified` as the
  non-vacuous control).
- **`acd-targeting-matcher-descriptor-pure`** (fitness #3) — SPECIFY, RED-until-module: asserts
  `src/mesh-issuance.mjs` imports NO `node-identity.mjs` (an import-specifier grep, the
  `acd-run-store-mesh-free` idiom) AND the matcher body reads only `nodeId`/`runtimes`/`skills` off its
  first argument (an m03 planted-violation self-check — inject a mutated source string that reads e.g.
  `descriptor.host` and confirm the gate flags it, the non-vacuous-control discipline every arch-test in this
  codebase carries).
- Both register as new `archTests` exports (`test/arch/acd-issuance-record-frozen.test.mjs`,
  `test/arch/acd-targeting-matcher-descriptor-pure.test.mjs`) imported and spread into `scripts/test.mjs`'s
  suite array under a new `// milestone 27 (story 00) — work-issuance-routing: the issuance directive
  substrate + the eligibility matcher` block comment, following the exact block-comment + spread idiom `scripts/test.mjs:1111-1120`
  uses for m26 story-00 (three behavioural suites + N arch-test spreads, each import annotated with what it
  covers). Neither arch-test is authored THIS stage (feasibility only) — this note fixes their eventual home
  and RED/GREEN posture for the build wave.
