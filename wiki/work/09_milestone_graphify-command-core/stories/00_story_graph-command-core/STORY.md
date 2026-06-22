---
type: story
number: 00
slug: graph-command-core
title: "The graph command core — graph:build/query/triage registered into the 08 core + the sole graphify driver (the spine)"
parent: 09
status: in-review
owner: product-owner
created: 2026-06-21
updated: 2026-06-21
---
# 00 · The graph command core — the registered commands + the sole graphify driver (the spine)

## User story

As the graphify command contract every other face and consumer milestone (10, 11) builds on,
I want graphify's operations registered as three first-class commands — `graph:build` / `graph:query` / `graph:triage` — in the **same** `src/command-core.mjs` registry milestone 08 froze, each driven through **one** adapter (`src/graphify.mjs`) that is the only place graphify is ever spawned and that derives every result from `graph.json` rather than graphify's drifting markdown stdout,
so that the aof CLI is the single source of truth for graphify, the contract is stable against graphify's version drift, and the faces/consumers couple to aof's `--json` result — never graphify's raw output.

<!-- This is the SPINE the milestone exists to make safe: it freezes the command/result contract
     (ADR-001) and the driver seam (ADR-002) the three sibling stories couple through. It owns no
     provisioning/doctor wiring (story 01), no rendered faces (story 02), and no arch-tests (story 03). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 09/00`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] **00 · [graph-commands-registered](tasks/00_graph-commands-registered.feature)** — the three `graph:*` commands carry the frozen `{id,input,run,cli}` shape, register into the SAME core, and dispatch from `aof graph <verb>` with `--json` (the 08 bijection, extended). _@executable green._
- [x] **01 · [graph-json-normalization](tasks/01_graph-json-normalization.feature)** — the driver normalizes `graph.json` reading `links` (NOT `edges`), preserving `confidence`/`confidenceScore`, keeping `hyperedges` separate — against a committed fixture (ADR-003). _@executable green._
- [ ] **02 · [driver-spawn-and-cwd](tasks/02_driver-spawn-and-cwd.feature)** — `src/graphify.mjs` is the sole graphify spawn site; resolves the `graphify` binary, cwd's into `projectRoot` (#756), pins a version; a real build over a folder produces `graphify-out/graph.json` (live → **@manual, deferred to `aof:verify`**).
- [x] **03 · [query-triage-results](tasks/03_query-triage-results.feature)** — `graph:query` / `graph:triage` carry graphify's **opaque** markdown `stdout` + a `graphPath` to the whole graph (ADR-001 amendment — no per-query subgraph, no structured `prs[]`); both fail clearly when no `graph.json` exists yet (the build precondition). _@executable rows green; live success rows @manual (verify)._

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** the command/result contract,
**ADR-002** the driver seam, **ADR-003** the `graph.json` normalization). This story **owns**:
`src/graphify.mjs` (the driver + normalizer — `resolveGraphifyBinary`/`runGraphifyBuild`/`runGraphifyQuery`/
`runGraphifyTriage`/`readGraph`), `src/commands/graph-build.mjs` / `graph-query.mjs` / `graph-triage.mjs`
(the three command bodies, added to the `COMMANDS` array in [command-core.mjs](../../../../../src/command-core.mjs)),
the new top-level `aof graph <verb>` dispatch in [cli.mjs](../../../../../src/cli.mjs), and a committed
`graph.json` fixture for the normalizer contract test. It **calls** the existing 08 registry mechanics
(`getCommand`/`listCommands`/`invoke`, `ctx = { workspace }`) — it does **not** rewrite them. It does
**not** touch `config-inspect.mjs` doctor wiring (story 01), the rendered faces (story 02), or `test/arch/*`
(story 03).

**Independent because** it consumes only the already-frozen 08 command core and graphify's published
binary, and produces the ONE frozen contract (ADR-001/002) that 01/02/03 consume; it is the spine they fan
out from and consumes none of their surfaces. The keystone is ADR-001's **graph-derived result**: structured
data always comes from `graph.json` (`links`, confidence, separate hyperedges), and graphify's markdown
`stdout` is carried opaque — which is what makes the contract stable against graphify's verb/output drift.

**Feasibility (developer amigo seat — confirmed at Contract):** **Buildable as written.** The three
`graph:*` modules are a verbatim extension of the 08 idiom: each is the same `{id,input,run,cli}` object
the existing `src/commands/*.mjs` carry (confirmed against `feedback.mjs`), added to the `COMMANDS` array
in `command-core.mjs` (no registry rewrite — `getCommand`/`listCommands`/`invoke` are reused unchanged),
and the `aof graph <verb>` dispatch is a new top-level `if (command === "graph")` branch in `cli.mjs`
(sibling to the existing `work` branch at `cli.mjs:55`) that fans into a `graph <verb>` subcommand switch
exactly as `workCommand` switches on `find/list/validate/...` and calls `getCommand("graph:…")` →
`invoke(...)` → `render`/`--json`. Nothing about the dispatch is novel.
The **normalizer is the safe, fully-testable core** — confirmed: it is a pure function over a committed
`graph.json` fixture (no binary, no spawn), so task 01 (`graph-json-normalization`) is genuinely
`@executable` and is the keystone that anchors the contract; the `links`-not-`edges` spelling,
`confidence`/`confidenceScore` preservation, and separate-`hyperedges` handling are all assertable against
the fixture exactly as the feature's Scenario Outline enumerates (including the INFERRED-with-no-score →
absent boundary). **Hard parts (both bounded, both honestly gated):** (1) `src/graphify.mjs` is net-new but
small — binary resolution off PATH, the #756 `cwd = projectRoot` discipline, version pinning, and the
graph.json read — and the *spawn* path cannot be exercised in CI, so task 02's real-build scenarios are
correctly `@manual` (the verb set, `--version`, and #756 behaviour are live-only, RESEARCH §A3/A4/A5).
(2) Per the ADR-001 amendment, `query`/`triage` carry NO graph-derived structured field — only opaque
`stdout` + `graphPath`; task 03's title still reads "returns a graph-derived subgraph … / ranked PRs",
language the amendment supersedes (the `.feature` body is correct and tests only `stdout` opaque +
`graphPath` + the missing-graph precondition). Not a contract change, just a stale task-list caption —
flagging it to the PO to align the wording. No blockers.
