---
type: story
number: 00
slug: presence-heartbeat
title: "Presence / heartbeat — src/mesh-presence.mjs + mesh:heartbeat + the node-staleness render on mesh:status, the durable git-side substrate"
parent: 23
status: done
owner: product-owner
created: 2026-06-30
updated: 2026-07-01
schema: 1
aofVersion: 0.1.0
---
<!-- Build landed 2026-06-30 (aof:continue 23): tasks 00/01 @executable green, fitness #3/#6 green,
     bijection gate green covering mesh:heartbeat. Task 02 stays @manual (verified at aof:verify).
     status → in-review once the milestone-wide review gate runs. -->

<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · Presence / heartbeat — the durable git-side substrate

## User story

As an operator who wants to *see what other agents are working on* (and the relay that will later accelerate it to sub-5s),
I want each node to publish a presence/heartbeat record — its id, the instant of the heartbeat, and the run ids it currently has in flight — as a git-tracked `presence/<node>.json` on the partition seam milestone 22 reserved, and `aof mesh status` to render every node's presence with a **stale** flag when its heartbeat has aged past the threshold,
so that the fleet's live activity is visible **purely over git** (the poll-for-durability floor, no relay needed) — extending milestone 20's single-node liveness into a fleet signal rather than standing up a parallel heartbeat.

<!-- This story produces the presence RECORD + the node-staleness render, working over GIT ALONE. It owns the
     presence mechanic + mesh:heartbeat (git-only publish) + the mesh:status extension; it reuses milestone
     20's isStale shape (never a parallel staleness), reads activeRuns FROM the run records, and lands the two
     m22 carry-forwards on the same bus (the .gitattributes EOL pin + the self-host .mesh ignore). It is
     PARALLEL with story 01 (the relay) — it imports no relay; story 02 adds the relay push on top. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 23 --autonomous`, Contract stage). Each behaviour task
     is one `.feature` under tasks/; done when its feature is green. The fitness functions are arch-tests
     (structural invariants → never a behaviour feature) tracked as buildable units below. -->

- [x] `tasks/00_presence-record.feature` — `mesh:heartbeat` assembles + publishes THIS node's presence record (the complete frozen schema — `nodeId` = the same `mesh.nodeId` as the node record, `heartbeatAt` ISO-8601 UTC-Z, `activeRuns` the in-flight run ids **read from the run records** not re-scanned, `aofVersion`) to the m22-reserved `presence/<node>.json` via the store's atomic write; the record reads back byte-equivalent; it is rebuildable (a projection of the clock + run records); republishing bumps `heartbeatAt` and leaves a peer's presence record untouched.
- [x] `tasks/01_node-staleness-and-status.feature` — `mesh:status` is extended to render presence + a **stale** flag per node: a node is stale when `now − heartbeatAt > threshold` (the **exact** milestone-20 `isStale` shape — strict `>`, so a node at the threshold is still live; UTC-Z `Date.parse`), a fresh heartbeat is live, a node with no presence record reads as no-presence (not an error); the threshold is `config.mesh.presence.stalenessSeconds` with a documented default; stable `--json` shape carrying each node's presence + stale flag; an empty roster reads as empty, not an error.
- [x] `tasks/02_presence-over-git.feature` `@manual` — the outsider-verifiable poll-for-durability acceptance: two clones over a shared (bare) remote — one publishes presence + `mesh:sync` (the m22 payload-agnostic engine moves the presence record with **zero** engine change), the other `mesh:sync`s and renders the peer's presence + correct stale flag, **purely over git, no relay**. Agent-run; evidence in `VERIFICATION.md`. Ties to the **≤30s git-fallback half of KR1**. _Verified `aof:verify 23`: 26/26 PASS, git round-trip ~1.4 s ≤ 30 s (VERIFICATION.md §23/00/02)._
- [x] **Fitness `acd-presence-write-scope`** (arch-test, ADR-002 / fitness #3) — every presence write joins the reserved `presenceRecordPath`/`meshDir` seam and routes through the atomic `writeText` seam (19/R2); the presence mechanic references **zero** record-doc filename (`SPEC.md`/`STORY.md`/`STATE.md`/`SESSION.md`).
- [x] **Fitness `acd-mesh-eol-pinned`** (arch-test, ADR-002 / fitness #6, the F1/R5 carry-forward) — the git-tracked `.mesh/**` records (or the record `*.json`) are pinned `text eol=lf`/`-text` in `.gitattributes` (mirroring the existing `src/bundle/** text eol=lf`), so a mixed-OS fleet sees byte-stable record files and the 22/R5 byte-divergence cannot recur.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-002** — presence as a node-staleness
signal that **EXTENDS** milestone 20's run heartbeat to the fleet, published as a derived, git-TRACKED
`presence/<node>.json` on the m22-reserved seam; the `.gitattributes` pin + self-host ignore land here). This
story **owns**: `src/mesh-presence.mjs` (the presence-record assembly, the node-staleness predicate reusing
20's `isStale` shape, the `activeRuns` read of the run records) + `src/commands/mesh-heartbeat.mjs`
(`mesh:heartbeat` — the **git-only** publish via story-00's reserved `presenceRecordPath`) + the extension of
`mesh:status` (which lives in [commands/mesh-identity.mjs](../../../../../src/commands/mesh-identity.mjs)) to
render presence + the stale flag, their registration in
[command-core.mjs](../../../../../src/command-core.mjs) (one import + one `COMMANDS` entry), the `aof mesh
heartbeat` dispatch branch + `argsFor` case in [cli.mjs](../../../../../src/cli.mjs)'s `meshCommand`, the two
arch-tests above + their registration in [scripts/test.mjs](../../../../../scripts/test.mjs), **and the two
carry-forward structural deliverables**: the `.gitattributes` `.mesh/**` EOL pin (F1/R5) and the self-host
`.gitignore wiki/work/.mesh/` (R4 — the aof self-host repo is not itself a mesh node, so a live `mesh:*` run
must not pollute the tracked stream).

**The genuine `23 → 20` seam (inherited, INSIDE this story — not a cross-story edge):** the node-staleness
predicate is the milestone-20 `isStale` shape (`src/run-store.mjs` ~378–386) applied to `heartbeatAt`, so the
run-layer (m20) and node-layer (m23) share **one** staleness definition — never a parallel heartbeat (the
`SPEC §Dependencies` constraint). `activeRuns` is **read** from the run records m20/19 sit on — it does not
re-implement a run scan and does not mutate a run record.

**Depends on milestone 22's frozen substrate** (the reserved `presenceRecordPath` seam in
[mesh-store.mjs:73](../../../../../src/mesh-store.mjs#L73), the atomic-write discipline, the payload-agnostic
sync engine that moves the new presence record unchanged) and **milestone 20's `isStale`/heartbeat shape** —
both already shipped. **The dependency root for presence within m23**: it works over **git alone**, so it is
authorable + buildable + testable with **no relay**. **Parallel with story 01** (the relay) — it imports no
relay module; **story 02** is the integration that adds the best-effort relay push on top.

**New verb rides the existing gate (inverse-22/R1, CLEAN):** `mesh:heartbeat` is auto-covered by the existing
`acd-mesh-command-cli-bijection` (22/fitness #3, `id.startsWith("mesh:")`) **provided** this story adds its
`aof mesh heartbeat` dispatch branch + `argsFor` case in the same change — m23 authors **no new**
registry-derived gate (the namespace + its gate already exist from m22).

**Feasibility (developer amigo seat — confirmed at Contract): FEASIBLE.** Every seam this story needs is
already shipped and frozen, and the mechanic is a straight composition of them — no blocker. The presence
record is assembled in a new `src/mesh-presence.mjs` mirroring the `mesh-store`/`run-store` idiom (`{nodeId,
heartbeatAt, activeRuns, aofVersion}`; `activeRuns` = `readRuns(item)` across the work items, filtered to
`state === "running"` — confirmed the run state-machine's sole in-flight state, `src/run-store.mjs`:159/204/406
— mapped to run ids, **no** re-implemented scan, **no** run-record mutation), persisted git-only via the
m22-reserved `presenceRecordPath` ([mesh-store.mjs:73](../../../../../src/mesh-store.mjs#L73)) through the
atomic `writeText` seam. The node-staleness predicate reuses 20's `isStale` shape verbatim (strict `>`, UTC-Z
`Date.parse` on `heartbeatAt`, [run-store.mjs:382–386](../../../../../src/run-store.mjs#L382)). `mesh:status`
extends the existing render in [commands/mesh-identity.mjs:138–169](../../../../../src/commands/mesh-identity.mjs#L138).
The two carry-forwards (the `.gitattributes` `.mesh/** text eol=lf` pin + the self-host `.gitignore
wiki/work/.mesh/`) are one-line additive deliverables on files that already exist. The `aof mesh heartbeat`
`argsFor` case is confirmed **load-bearing**: the bijection test derives `subcommands()` from the registry and
its `argsFor` switch `default` THROWS ([acd-mesh-command-cli-bijection.test.mjs:93–107](../../../../../test/arch/acd-mesh-command-cli-bijection.test.mjs#L93)),
so registering `mesh:heartbeat` without the `argsFor` case + the `subcommand === "heartbeat"` dispatch branch
turns the gate RED (the m22 lesson). **The two QA flags are resolved (both LOCKED into the `.feature` files):**
- **Flag 1 — task 02 `@manual` vs `@executable`:** **STAYS `@manual`** (no tag change; the in-feature flag
  comment is updated to record the resolution). The genuine two-clone-over-bare-remote fleet render is
  agent-run, mirroring the m22/story-02/task-02 precedent (there the real over-remote end-to-end render stayed
  `@manual`, while the add-only merge was proven `@executable` in the transport task) and honouring the 22/R3
  Windows-spawn-flake caution. The `.gitattributes` `.mesh/** text eol=lf` pin (fitness #6) is the **structural
  fix that makes the byte-identity assertions SOUND** (it forces LF on B's checked-out record regardless of
  `autocrlf`, so "byte-for-byte as node A wrote it" holds across the git seam) — but it does not make the
  two-clone render reliably `@executable`. What the `@manual` feature **measures** is the **≤30s git-fallback
  half of KR1** (the poll-for-durability floor, relay killed).
- **Flag 2 — the never-beat node's `stale` literal (under-specified by ADR-002):** **LOCKED to "no-presence /
  unknown liveness", `stale: false`** — `isStale` applies ONLY once a `heartbeatAt` exists, so a node with a
  node record but no presence record has nothing to compare and is **not** asserted stale (distinct from a node
  that beat and then aged out). Edited the QA's deliberately-unasserted scenario in
  `tasks/01_node-staleness-and-status.feature` ("a node with a node record but no presence record reads as
  no-presence **and not stale**") to assert `"node-x" stale is false`, and made `node-bare`'s `stale false`
  explicit in the `--json`-shape scenario for internal consistency (the 22/R2 boundary-literal discipline).

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Implementation guidance surfaced at Contract; the two flag resolutions above required `.feature` edits
     (task 01 + task 02's flag comment); no ADR change. -->

- **`src/mesh-presence.mjs` — the record assembly + the staleness predicate, mirroring `mesh-store`/`run-store`.**
  Assemble `{ nodeId, heartbeatAt, activeRuns, aofVersion }` in that frozen key order (the task-00
  "carries no keys beyond the frozen schema" + byte-equivalence assertions turn on it). `nodeId` = the same
  `config.mesh.nodeId` the node record carries (read it, do **not** re-derive — a never-published node has no
  id; that path is the node-identity story's, not presence's). `aofVersion` = the package version via the
  `aofVersion()` `import.meta.url` idiom already in [mesh-identity.mjs:37–44](../../../../../src/commands/mesh-identity.mjs#L37)
  (reuse it; do not re-read package.json a second way). `heartbeatAt` = the injected `now` (white-box) or
  `new Date().toISOString()` — UTC-Z. Persist via `presenceRecordPath` + `writeText(JSON.stringify(record,
  null, 2))` mirroring `publishNodeRecord` ([mesh-store.mjs:102–105](../../../../../src/mesh-store.mjs#L102))
  — pretty JSON, opaque/as-is, so read-back is byte-equivalent.
- **`activeRuns` is a READ of the run records, never a re-scan or a mutation (ADR-002, the `23 → 20 → 19` seam).**
  `activeRuns` = the in-flight run ids across the work items: `readRuns(item)` ([run-store.mjs:240](../../../../../src/run-store.mjs#L240))
  per item, `filter(run => run.state === "running")` (the **sole** in-flight state — `queued` is pre-running,
  `done`/`failed`/`cancelled` are terminal, confirmed in the closed transition table), `.map(run => run.runId)`.
  Do **NOT** re-implement a run scan and do **NOT** call `heartbeat`/`persist`/`applyTransition` (the task-00
  "byte-identical run record after the heartbeat" scenario fails the moment presence writes the run dimension).
  The item-list-as-input shape is the same one `reclaimStaleRuns` takes ([run-store.mjs:399](../../../../../src/run-store.mjs#L399))
  — pass the items, never assume a single directory.
- **Node-staleness reuses 20's `isStale` shape — never a parallel heartbeat (the genuine `23 → 20` seam).**
  The predicate is `now − Date.parse(heartbeatAt) > threshold` (strict `>`, UTC-Z) — the **exact** shape at
  [run-store.mjs:382–386](../../../../../src/run-store.mjs#L382) applied to the presence record's `heartbeatAt`.
  `isStale` there is module-private (not exported); export it from `run-store.mjs` (additive) and import it into
  `mesh-presence.mjs`, OR mirror the three-line shape verbatim with a citing comment — prefer the export so the
  two layers provably share one definition. The AT-threshold row (age 60 == threshold 60 ⇒ **live**, because
  `60 > 60` is false) is load-bearing (task-01 Scenario Outline); the strict `>` is what makes it pass.
- **The never-beat / no-presence path (Flag 2, locked).** In `mesh:status`'s render, a node with a node record
  but no presence record yields `{ nodeId, stale: false }` with `presence` absent (omit the key, do not emit
  `presence: null` unless the task asserts null — it asserts "presence is absent"). Compute `stale` ONLY when a
  presence record with a `heartbeatAt` exists; otherwise `stale: false`. This is the locked post-rule value.
- **`mesh:heartbeat` — a NEW one-shot command in `src/commands/mesh-heartbeat.mjs`, git-only.** Model it on the
  `mesh:identity` publish path ([mesh-identity.mjs:80–135](../../../../../src/commands/mesh-identity.mjs#L80)):
  the `{ id:"mesh:heartbeat", input, run, cli }` shape, `run` assembles + persists the record and returns it,
  `cli` carries `argv`/`render`/`json`. This story ships it **git-only** (no relay import — story 02 adds the
  best-effort relay push on top; story 01 is parallel). Register it in
  [command-core.mjs](../../../../../src/command-core.mjs) (one import + one `COMMANDS` entry) and add the
  `subcommand === "heartbeat"` dispatch branch in `meshCommand` ([cli.mjs:467](../../../../../src/cli.mjs#L467),
  reusing the shared `meshVerbCli` face, `positionalAllowed: false`) — additive, the same idiom as the
  `identity`/`status`/`sync` branches.
- **The `argsFor` case is load-bearing — add it in the SAME change.** Add `case "heartbeat": return ["mesh",
  "heartbeat", "--json"];` to the bijection test's `argsFor` switch ([acd-mesh-command-cli-bijection.test.mjs:93](../../../../../test/arch/acd-mesh-command-cli-bijection.test.mjs#L93)).
  The switch `default` THROWS on an unmapped sub (the 19/R1 pattern), so registering `mesh:heartbeat` without
  this case leaves the gate RED. Confirm `aof mesh heartbeat --json` runs clean + parseable in the test fixture
  (it publishes git-only against a local fixture — no remote needed).
- **Read `config.mesh.presence.stalenessSeconds` via the headroom read-merge-write idiom — NOT
  `config-editor.mjs`.** Read it off `ws.config.mesh?.presence?.stalenessSeconds` for the threshold; an
  absent/malformed/negative/null value falls back to a **documented default** (task-01 Scenario Outline — pick
  and document the constant, e.g. the m20 run-staleness default if one exists, else a sensible 60–90s). If any
  presence config is ever WRITTEN, use the [work-headroom.mjs](../../../../../src/work-headroom.mjs)
  `readJson → mutate only the one subtree → writeText(2-space + trailing \n)` idiom (the same
  `resolveInstallSalt` pattern at [mesh-identity.mjs:62–78](../../../../../src/commands/mesh-identity.mjs#L62)).
  Do **NOT** route through `config-editor.mjs`'s `baseConfig()`/`saveEditableSections` whitelist — it would
  **drop an unknown `mesh` block** on rewrite (the m22 story-01 lesson).
- **Extend `mesh:status`'s render in place ([mesh-identity.mjs:138–169](../../../../../src/commands/mesh-identity.mjs#L138)).**
  Today `mesh:status` returns `{ nodes: readNodeRecords(ws) }`. Extend `run` to read each node's presence
  record (a `readPresenceRecord(ws, id)`/`readPresenceRecords(ws)` mirroring `readNodeRecord`/`readNodeRecords`
  — add these to `mesh-store.mjs` or `mesh-presence.mjs`, absence-tolerant: ENOENT → null/skip, the same
  benign-absence discipline) and compute `stale` per node, yielding the locked `{ nodes: [ { nodeId,
  presence?, stale } ] }` shape. Accept an injected `now` (white-box over the staleness inputs — never
  wall-clock, the 22/R2 discipline; the task drives `now` + `heartbeatAt` as injected values). Status stays a
  **pure read** (task-01 "partition root is byte-unchanged" — write nothing).
- **The two carry-forwards are one-line additive edits.** (a) `.gitattributes` — add a `.mesh/** text eol=lf`
  rule mirroring the existing `src/bundle/** text eol=lf` pin (fitness #6 / `acd-mesh-eol-pinned`). (b) the
  self-host `.gitignore` — add `wiki/work/.mesh/` (R4: the aof self-host repo is not itself a mesh node, so a
  live `mesh:*` run must not pollute the tracked stream; a real node where `.mesh/` IS the committed bus is a
  different repo with no such ignore).
- **The two arch-tests + their registration.** Author `test/arch/acd-presence-write-scope.test.mjs` (fitness #3:
  source-grep `mesh-presence.mjs` + `mesh-heartbeat.mjs` — every write joins `presenceRecordPath`/`meshDir`,
  routes through `writeText` not a bare `writeFile`, references zero record-doc filename) and
  `test/arch/acd-mesh-eol-pinned.test.mjs` (fitness #6: read `.gitattributes`, assert the `.mesh/**` pin),
  mirroring the m22 `acd-mesh-write-scope`. Register both in
  [scripts/test.mjs](../../../../../scripts/test.mjs). The relay-coupled fitness #1/#2/#4 are NOT this story's
  (stories 01/02).
