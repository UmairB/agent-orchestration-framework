---
doc: retrospective
ref: "09"
---
# 09 · Graphify Command Core — Retrospective

Distilled lessons from how execution actually went. One `R<n>` per lesson; append-only, never renumber.
Clean catches with no process lesson are not entries — they live in VERIFICATION/STATE. This milestone
drove an **external, doc-drifting tool** (graphify) behind a frozen command contract, and that shape
produced its lessons: R1–R4 are the carried `## Feedback (for retro)` notes (now archived at the close),
R5–R6 are distilled from the two blocker findings the verify gate caught and fixed (`@finding-F1`,
`@finding-F2`) plus the deferred `@finding-F3`. The unifying theme of R1/R5/R6: a contract or test frozen
against *documented / assumed* tool behaviour, where the *live pinned* tool differed.

## R1 — Cross-check every claimed structured result field against an actual derivable machine artifact before freezing the contract

- **Kind:** misunderstanding · **Area:** contract · **Stage:** refine · **Owner:** product-owner · **Raised by:** aof-architect (Three-Amigos)
- **What happened:** ADR-001's first cut asserted graph-*derived* structured fields on `graph:query` ("the
  subgraph the query touched") and `graph:triage` (`prs[]`) while the *same* ADR forbade parsing
  graphify's markdown stdout — and RESEARCH §C/§H establish query/triage have no `--json`/MCP path, so
  those fields were never derivable. Caught only when the PO went to author `.feature`s against it; amended
  in place to `{…, stdout, graphPath}`.
- **Why:** the result shape was designed top-down from "what an agent would want" without checking each
  field against a real machine artifact the pinned tool actually emits.
- **Lesson:** before freezing a result contract over an external tool, map every claimed structured field
  to a concrete derivable artifact (a `--json` file, a stable key) — if the only source is drifting
  human stdout you forbade parsing, the field is infeasible, not just risky.
- **Refs:** STATE `## Feedback (for retro)`; ADR-001 (amended); RESEARCH §C/§H.

## R2 — Phrase registry-closure invariants per-namespace, so milestone N+1 extending the registry need not re-touch N's traceability

- **Kind:** mistake · **Area:** architecture · **Stage:** build · **Owner:** developer · **Raised by:** orchestrator (build)
- **What happened:** registering `graph:build/query/triage` into the same `command-core.mjs` `COMMANDS`
  array collided with milestone-08's frozen closed-world assertion "the registry exposes exactly the six
  work commands … and no others". The 08 `.feature` was left untouched; 08's traceability test was
  narrowed to scope "exactly six" to the `work:*` namespace.
- **Why:** an accepted "no other commands" invariant in milestone N becomes a maintenance collision the
  moment milestone N+1 deliberately extends the same registry.
- **Lesson:** phrase registry-closure invariants **per-namespace** (or name the extension seam in the
  feature), so a later milestone's sanctioned extension doesn't force a re-touch of the earlier
  milestone's frozen contract.
- **Refs:** STATE `## Feedback (for retro)`; `test/command-core-contract.test.mjs` (narrowed to `work:*`).

## R3 — When an ADR says "ship it as aof's own asset," name the concrete shipped HOME in the task/SPEC

- **Kind:** misunderstanding · **Area:** architecture · **Stage:** build · **Owner:** developer · **Raised by:** orchestrator (build)
- **What happened:** ADR-005 said aof authors the graphify faces as "its own assets in `.aof/` config" but
  left the *shipped-resource home* ambiguous. The obvious home — the ACD `src/bundle/` — is the WRONG
  home: the milestone-01 `acd-bundle-membership` fitness function freezes the bundle to a pinned member
  set and the loader supports neither `skill` members nor `mcpServers`. Resolved with a new shipped module
  `src/graph-faces.mjs` exporting a config-shaped fragment `renderConfigOutputs` consumes unchanged.
- **Why:** "ship as aof's own asset" reads as obvious but "the bundle" is not automatically the home when
  the bundle is a frozen, membership-pinned set.
- **Lesson:** when an ADR mandates "ship it as aof's own asset," name the concrete shipped HOME — and
  check it against any membership/freeze invariant before assuming the default home fits.
- **Refs:** STATE `## Feedback (for retro)`; ADR-005; `src/graph-faces.mjs`; milestone-01
  `acd-bundle-membership`.

## R4 — Phrase ADR build estimates as the CAPABILITY needed, not a named dependency, so the dep-vs-handroll call stays open at build

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** developer · **Raised by:** developer (build, ratified at review)
- **What happened:** ADR-005's amendment estimated the net-new MCP server as "an MCP SDK dependency + a
  stdio `Server`". The developer deviated: the server is hand-rolled, no `@modelcontextprotocol/sdk` —
  ~40 lines of line-delimited JSON-RPC for a 3-tool read-mostly surface, keeping aof's lean (3-dep)
  supply-chain posture. The structural boundary (server reaches the graph only via `invoke`, spawns
  nothing) is unchanged; ratified at review.
- **Why:** an ADR amendment that names a specific dependency as the build *estimate* pre-commits a
  supply-chain decision the developer may rightly revisit against the project's lean posture.
- **Lesson:** phrase ADR estimates as the **capability** required ("a stdio MCP transport"), not a named
  dependency, so the dep-vs-handroll decision stays open at build. (Seam left for a later SDK swap:
  `handleMcpMessage`.)
- **Refs:** STATE `## Feedback (for retro)`; ADR-005 (amended); `src/graph-mcp-server.mjs`.

## R5 — Pin every RESEARCH-flagged live-only assumption with a real probe of the pinned binary before treating the @executable contract as done

- **Kind:** blocker · **Area:** contract · **Stage:** verify · **Owner:** developer · **Raised by:** orchestrator (verify, `@finding-F2`/`@finding-F3`)
- **What happened:** two contract-vs-reality gaps reached the verify gate because the contract + fixtures
  were frozen against *documented* graphify behaviour while the live 0.8.44 binary differed. **F2:**
  `extract <path>` writes `<path>/graphify-out/` (its `--out` default is the *target*), not `<cwd>/…`, so
  the #756 `cwd=projectRoot` discipline — which fixes the READ verbs — left `aof graph build` writing the
  graph where it couldn't read it (RESEARCH §A5 had flagged the write location as live-only). **F3
  (deferred):** the live tool emits `hyperedges` at top-level, but the normalizer + the committed fixture
  put them under `graph.hyperedges` (RESEARCH §A2), so the @executable test was green against a fixture
  that doesn't match the tool.
- **Why:** the live-only assumptions RESEARCH explicitly listed (§A2/A5) were deferred all the way to
  verify, and the @executable suite ran over *doc-derived* fixtures — proving consistency-with-the-fixture,
  not fidelity-to-the-tool. The #756 discipline also conflated read-location and write-location, which
  differ for `extract`.
- **Lesson:** for each RESEARCH-flagged live-only assumption (especially a spawn-site's output location
  and a parsed artifact's shape), pin it with a real probe of the pinned binary and **derive the contract
  fixture from a captured real artifact**, not from docs, *before* the @executable lane is treated as
  done — a green @executable suite over a doc-derived fixture can't catch a wrong write-location or a
  wrong key. Carries to milestones 10/11, which consume the same graphify reality.
- **Refs:** VERIFICATION `@finding-F2` (fixed), `@finding-F3` (deferred); ADR-002 (amended for the `--out`
  write-location); ADR-003; RESEARCH §A2/A5/A8; `src/graphify.mjs` (`graphifyBuildArgs`, `normalizeGraph`).

## R6 — When milestone N+1 re-points a shared resolver, it owns making N's negative-path tests hermetic against the new source — and a verify that provisions into a shared store must re-run the suite post-provision

- **Kind:** blocker · **Area:** process · **Stage:** verify · **Owner:** developer · **Raised by:** orchestrator (verify, `@finding-F1`)
- **What happened:** milestone 12 re-pointed `resolveGraphifyBinary` **store-first** onto
  `resolveManagedBinary` and provisioned graphify into the shared `~/.aof` store. That turned three of 09's
  binary-*absent* tests red on any provisioned machine: they isolated only the PATH leg
  (`{pathValue:"", useLocator:false}`) and not the new store root, so the resolver found the real store
  copy and returned `found:true`. 12 was accepted `done` while leaving `check.mjs` red on a provisioned
  dev machine; 09's verify surfaced it. Fixed by injecting a fresh empty `AOF_GLOBAL_HOME` in the three
  assertions (resolver behaviour was correct; the tests were non-hermetic).
- **Why:** a negative-path test that isolates only the *original* source silently de-hermeticises the
  moment a later milestone adds a *new* source the resolver consults; and 12's verify did not re-run the
  full suite *after* provisioning into the shared store, so the regression its own provisioning created
  went unseen.
- **Lesson:** (a) absent/negative-path tests must isolate **every** source the resolver consults (PATH
  **and** the managed store root via `AOF_GLOBAL_HOME`), not just the first; (b) a verify that provisions
  a tool into a shared global store must re-run the full suite **post-provision**, since provisioning can
  flip negative-path tests; (c) when milestone N+1 re-points a seam earlier milestones' tests depend on,
  it owns re-hermeticising those tests.
- **Refs:** VERIFICATION `@finding-F1` (fixed); milestone-12 ADR-004 (store-first retrofit),
  `src/tool-store.mjs` `resolveManagedBinary`; `test/graph-binary-provisioning.test.mjs`,
  `test/arch/acd-graph-binary-absent.test.mjs`.
