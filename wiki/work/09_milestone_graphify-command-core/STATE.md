---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 09 · Graphify Command Core — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- **Framed 2026-06-21** (`aof:shatter wiki/planning/PRD-graphify-integration.md`) → `not-started`.
  Spine only (SPEC objective + scope). The foundation of the three-milestone graphify arc (09 → 10/11).
- **Refined 2026-06-21** (`aof:refine 09 --autonomous`) → `in-progress`. Researched graphify's reality
  (RESEARCH.md), authored 6 ADRs (ARCHITECTURE.md; ADR-001/005/006 amended at the Three-Amigos pass),
  broke down into **5 independent stories** (00 spine · 01/02/03/04 fan out), and authored the contracts
  for 00/01/02/04 (Three Amigos: PO scenarios + QA examples/tags + developer feasibility). 03's contract
  is ADR-006 (six arch-tests, no `.feature` pass). All five `in-progress` (contracted, ready to build).
  - **00 graph-command-core** · **01 binary-provisioning** · **02 rendered-faces** ·
    **03 graph-fitness** · **04 mcp-server-runtime**.
- **Built + reviewed 2026-06-21** (`aof:continue 09`) → all five stories `in-review`. Built in waves
  (00 spine → 01/02/04 → 03 fitness). The `@executable` suite + all six ADR-006 fitness functions are
  **green** (`node ./scripts/test.mjs` → 945 pass / 0 fail; `node ./scripts/check.mjs` → exit 0).
  Structural (architect) + behavioural (QA) review: **no blockers**; both flagged deviations ratified —
  (1) 08's registry-closure traceability test narrowed to the `work:*` namespace (the spine was always
  open to new namespaces; 08's intent preserved); (2) the MCP server hand-rolled as minimal stdio
  JSON-RPC (no `@modelcontextprotocol/sdk` dep) to keep aof lean — ADR-005 amended to record it.
  Confirmed should-fixes applied: `offline` now forbids a network backend (ADR-001); `PINNED_GRAPHIFY_VERSION`
  wired into a doctor drift-warning (ADR-002/004); a `serveStdio` over-pipe test; the egress classifier +
  no-face-spawn bare-literal guard hardened. **Live-binary `@manual` lanes deferred to `aof:verify`** (the
  real `graphify extract`/`query`/`prs --triage` build, the live version probe, the live MCP round-trip).
  **Next:** `aof:verify 09` — run the `@manual` lanes against a real `uv tool install graphifyy`, sign off,
  and accept.
  - All five `in-review`: **00** · **01** · **02** · **03** · **04**.
- **MCP face split (Three-Amigos finding, 2026-06-21).** The developer seat found aof ships **no MCP server
  runtime** (no `@modelcontextprotocol/*` dep, no stdio `Server`, no `aof … serve`) — so ADR-005's
  "MCP server asset that invokes aof graph" is two things: a rendered **config entry** (free on the existing
  machinery → story 02) and a net-new **server runtime** (MCP SDK dep + `aof graph serve` fronting `invoke`).
  **PO decision (user-chosen at refine):** split the server into its own **story 04**; 09 still delivers a
  working MCP face. ADR-005 + ADR-006 inv. 2 amended to record it.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- **Origin (2026-06-21).** Shattered from [PRD-graphify-integration.md](../../planning/PRD-graphify-integration.md).
  The arc integrates graphify into aof along two value axes over one foundation: this milestone is the
  foundation — graphify exposed **as aof CLI commands** (the milestone-08 CLI-as-contract spine), so
  every consumer (Claude skill, MCP, board UI, ACD agents) is a thin face over the commands.
- **Carry-forward to refine.** Two load-bearing decisions for the ADR: (1) the graph command verbs +
  result shape, authored into 08's command registry; (2) the Python-binary install path — generalize
  `src/frameworks.mjs` beyond its npx-only assumption, or assets-only + an `aof project doctor` check.
  The milestone-06 headroom "one shared contract, two faces" move and 08's registry are the precedents.

- **Default decisions taken at refine (`--autonomous`) — surfaced for review.**
  - **Install path = Option B** (ADR-004): assets-only provisioning + an `aof project doctor`
    `graphify-binary` check; `src/frameworks.mjs` (npx-only) is left **untouched**. Driver: graphify is
    a published tool aof drives-but-does-not-own; the npx lane structurally cannot install Python; B is
    the lower-blast-radius fit (RESEARCH §G). Option A (generalize the installer with a uv/pipx lane) is
    recorded as the rejected heavier alternative + the graduation path. **Reversible** — revisit if a
    future milestone needs aof to manage the graphify install lifecycle.
  - **Command verbs/result shape** (ADR-001): a small stable façade `graph:build`/`graph:query`/
    `graph:triage`, each result **derived from `graph.json`** (graphify has no stable `--json`;
    RESEARCH §C). graphify's markdown `stdout` is carried opaque, never parsed for data.
  - **No `@graph` tag domain.** The `work.tags` vocabulary is closed (`aof:validate` enforces it); the
    graph work maps to existing tags (driver → `@adapter`; faces → `@assets`/`@distribution`;
    provisioning/doctor → `@scaffold`; fitness → `@validate`). A dedicated `@graph` domain was
    consciously NOT added — flag if a domain is wanted before milestones 10/11.
  - **Live-only assumptions gated `@manual`** (RESEARCH §A3/A4/A5/A6/A7): the real verb set per pinned
    version, the `graphify --version`/health command, whether the #756 cwd bug survives the pinned
    version, the exact MCP tool list, and that `uv tool install graphifyy` yields a `graphify` binary on
    PATH. The ADRs pin a version and degrade clearly rather than trust drifting docs; these re-verify on
    any graphify version bump.

## Feedback (for retro)

- **Architect, 2026-06-21 (caught at Three-Amigos).** ADR-001's first cut asserted graph-*derived*
  structured fields on `graph:query` ("the subgraph the query touched") and `graph:triage` (`prs[]`)
  while the same ADR forbade parsing graphify's markdown stdout — and RESEARCH §C/§H establish query/
  triage have no `--json`/MCP path, so those fields were **never derivable**. An internally-infeasible
  contract, only caught when the PO went to author `.feature`s against it. Amended in place (query/triage
  now `{ …, stdout, graphPath }`). **Lesson for retro:** cross-check every claimed structured result
  field against an actual derivable machine artifact *before* freezing the contract.
- **Developer, 2026-06-21 (caught at build, 09/00).** Registering `graph:build/query/triage` into the
  SAME `src/command-core.mjs` `COMMANDS` array (09/ADR-001) directly collides with milestone-08's frozen
  `00_registry-contract.feature` scenario "the registry exposes exactly the six work commands … and there
  are no other registered commands" — a closed-world assertion that 09 deliberately opened. The 08
  `.feature` is left untouched (not mine to edit); the 08 **traceability test** (`command-core-contract.
  test.mjs`) was narrowed to scope "exactly six, no more" to the `work:*` namespace, so it still protects
  08's real intent (the six work ops re-homed, none missing/extra) while permitting the sanctioned `graph:*`
  extension. **Lesson for retro:** an accepted "no other commands" closed-world invariant in milestone N
  becomes a maintenance collision the moment milestone N+1 extends the same registry — phrase such
  registry-closure invariants per-namespace (or note the extension seam in the feature) so the later
  milestone needn't re-touch the earlier one's traceability.
- **Developer, 2026-06-21 (resolved at build, 09/02).** ADR-005 says aof authors the graphify faces as
  "ITS OWN assets in `.aof/` config", but the milestone task left the *shipped-resource home* ambiguous:
  any aof project should be able to adopt the faces, so they need a shipped artifact, yet the obvious
  shipped home — the ACD `src/bundle/` (the `work-bundle.mjs` loader + `bundle.json`) — is the WRONG home.
  The milestone-01 `acd-bundle-membership` fitness function freezes the bundle to "exactly the 8 ACD agents
  + the ACD commands + templates" and asserts "bundle root files == declared member files"; dropping a
  graphify skill/MCP file there would break that frozen invariant, and the bundle loader supports neither
  `skill` members nor `mcpServers` at all. **Resolution (most idiomatic option, implemented):** a new
  shipped module `src/graph-faces.mjs` exports `graphifyFacesConfig()` — a config-SHAPED fragment
  (`{ resources:[skill], mcpServers:[entry] }`) consumed by `renderConfigOutputs` UNCHANGED, mirroring
  `work-bundle.mjs`'s "module that returns a config object the render engine eats as-is" idiom. Any project
  adopts the faces by spreading it into its config. This authors them as aof's OWN config items (ADR-005)
  with NO new render path, NO touch to the frozen ACD bundle, and NO touch to `src/frameworks.mjs`. The
  MCP entry's launch command is `command:"aof", args:["graph","serve"]` (the published `aof` bin + story
  04's verb), agreed with story 04's serve-entrypoint feature; it is NOT `python -m graphify.serve`.
  **Lesson for retro:** when an ADR says "ship it as aof's own asset", name the concrete shipped HOME in
  the task/SPEC — "the bundle" is not automatically it when the bundle is a frozen, membership-pinned set.
- **Developer, 2026-06-21 (decision at build, 09/04 — ADR ratification wanted).** ADR-005's amendment
  estimated the net-new MCP server runtime as "an MCP SDK dependency + a stdio `Server`". I **deviated**:
  the server (`src/graph-mcp-server.mjs`) is **hand-rolled, no SDK** — no `@modelcontextprotocol/sdk` added.
  Rationale: aof is lean (3 runtime deps) and the supply-chain posture is guarded; the MCP wire this face
  needs is line-delimited JSON-RPC 2.0 over stdio with a tiny method set (`initialize` / `tools/list` /
  `tools/call`, plus the `notifications/initialized` ack + `ping`), which is ~40 lines of transport — the
  full SDK is not warranted for a 3-tool read-mostly surface, and avoiding the dep keeps the dependency
  count and audit surface flat. The boundary the amendment asserts is UNCHANGED: the server is a thin
  transport face that reaches the graph ONLY via `invoke("graph:…")` (it imports `getCommand`/`invoke`,
  NOT `src/graphify.mjs`) and spawns nothing — so ADR-006 inv. 2 holds and the `aof graph serve` path is
  greppable as a non-spawn site. The split into a pure-ish `handleMcpMessage(message, ctx)` seam + a thin
  `serveStdio(ctx)` loop keeps the routing unit-testable in-process (the @executable coverage) with the
  live agent-over-stdio round-trip left @manual. **For the architect to ratify at review:** confirm
  hand-rolled-over-SDK is acceptable, or direct adding `@modelcontextprotocol/sdk` (and amend ADR-005
  accordingly). If the SDK is later wanted, `handleMcpMessage` is the routing seam an SDK `Server`'s
  `setRequestHandler` would call into, so the swap is contained.
  **Lesson for retro:** an ADR amendment that names a specific dependency ("an MCP SDK dependency") as the
  build estimate pre-commits a supply-chain decision the developer may rightly revisit against the
  project's lean posture — phrase such estimates as the CAPABILITY needed ("a stdio MCP transport"), not a
  named dependency, so the dep-vs-handroll call stays open at build.

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — `node ./scripts/test.mjs` 945 pass / 0 fail (2026-06-21)
- [x] Fitness functions green — the six `acd-graph-*` arch-tests + `check.mjs` exit 0 (2026-06-21)
- [ ] `@manual` signed off — deferred to `aof:verify 09` (live `graphify` binary + live agent)
