---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 34 · Global Mesh Work Store — State

## Progress

- Framed `2026-07-04` by `aof:add-milestone` from the operator request to make recent mesh work
  global: mesh work is machine-wide on the control node; work changes should propagate to global AOF
  state only when mesh support is enabled; node details should be recorded globally; `aof mesh ui`
  becomes global by default with `--local` as the workspace-only view.

- Refined `2026-07-04` by `aof:refine 34` — Decide + Break-down. Memory recall surfaced the milestone
  12 global-store lesson: route global state through `defaultGlobalWorkspaceDir` / `AOF_GLOBAL_HOME`, never
  a hard-coded home. Codebase graph built successfully (**1301 nodes / 3515 edges, egress none**) and
  informed the story cut: store/path substrate, propagation, node descriptors, and UI scope are separate
  seams. Produced [ARCHITECTURE.md](ARCHITECTURE.md), [RESEARCH.md](RESEARCH.md), [DESIGN.md](DESIGN.md),
  and four story spines. Milestone → **in-progress**.

- Contracted `2026-07-04` by `aof:refine 34/00` — authored four `@executable` task features for the global store substrate (path geometry, SQLite open/migrate/refusal, rebuildable workspace projection, query API) and two structural fitness units (`acd-global-mesh-paths-home`, `acd-global-store-no-native-dep`).

- Contracted `2026-07-04` by `aof:refine 34/01` — authored four `@executable` task features for mesh-enabled propagation (explicit enablement predicate, post-mutation publish, publish-failure isolation, launcher convergence) and two structural fitness units (`acd-global-propagation-single-predicate`, `acd-global-publisher-single-seam`).

- Contracted `2026-07-04` by `aof:refine 34/02` — authored four `@executable` task features for global node/workspace descriptors (node materialization, workspace membership, credential redaction, freshness/query API) and two structural fitness units (`acd-global-node-descriptors-redact-secrets`, `acd-global-node-registry-projection-only`).

- Contracted `2026-07-04` by `aof:refine 34/03` — authored four `@executable` task features for mesh UI global scope (CLI scope selection, API scope switch, visible Global/Local UI states, empty/error/health states) and three structural fitness units (`acd-mesh-ui-global-default`, `acd-mesh-ui-local-filter-preserves-status`, `acd-mesh-ui-scope-visible`).

- Built `2026-07-05` by `aof:continue 34/00` — added the global mesh path helper, platform-data global home default, SQLite-backed global work projection open/migrate path, idempotent workspace snapshot publishing, projection query API, and focused/fitness tests. Story 00 → **in-review**. Verification: focused story tests green; `npm run test:unit` green after rerunning outside the sandbox for git-backed fixtures; full `npm test` green with an extended timeout. The earlier sandbox unit run failed only on `spawnSync git EPERM`, and the first full run was killed by the 5-minute tool timeout.

- Built `2026-07-05` by `aof:continue 34/01` — added the shared mesh-enabled global work publisher, wired post-mutation propagation into run start/complete, feedback, and mesh issue, added launcher initial/periodic convergence publishing, and covered failure isolation plus single-predicate/single-seam fitness tests. Story 01 → **in-review**. Verification: focused propagation/store tests green; `npm run test:unit` green after rerunning outside the sandbox for git-backed fixtures; full `npm test` green with an extended timeout.

- Built `2026-07-05` by `aof:continue 34/02` — added global node/workspace descriptor materialization, global registry SQLite rows, host-derived fabric-only node descriptors, redaction before descriptor/index persistence, and projection-only freshness/query APIs. Story 02 → **in-review**. Verification: focused store/registry/fitness tests green after the final fabric-only hardening; `npm run test:unit` was green before that hardening when rerun outside the sandbox for git-backed fixtures. A post-change full-suite rerun was blocked by the approval usage limit.

- Built + reviewed `2026-07-05` by `aof:continue 34` (stories 03 + 04, serialised — the story-00–02 dependency code is uncommitted so worktree isolation was impossible, and 03/04 share `cli.mjs` + the global store/registry + the test runners, so concurrent same-tree agents would clobber). Also fixed a pre-existing story-02 gap: `scripts/test-unit.mjs` imported the story-02 test arrays but never spread them into its run list (they ran only in the full `npm test`) — now executed under `test:unit` too.
  - **Story 03 (mesh UI global scope)** built: `serveMeshUi({ scope })` branches the `/api/mesh/status` read (global → the new `global-mesh-query.mjs` composition seam over the story-00/02 projection queries; local/`?scope=local` → the existing `invoke("mesh:status")`), `aof mesh ui --local` CLI + unknown-flag rejection, the fleet React surface (scope control, workspaces summary, work-items table, node panel, diagnostics; empty/loading/error states) with a testable `ui/src/fleet/scope.mjs`, and 3 fitness units. Story 03 → **in-review**. All 4 `@executable` tasks green.
  - **Story 04 (worker live-state stream)** built: the ONE shared `meshRole()` predicate (`mesh-role.mjs`), the persistent worker stream client (snapshot-first-then-deltas, capped backoff, ADR-004 failure isolation), the always-on control-node stream server (tailnet-only admission, apply+redact into the global store, per-worker liveness), stream retry + reconnect-snapshot reconciliation, launcher hosting (control→server / worker→client), and 4 fitness units. Delta wire schema `{ kind, nodeId, workspaceId, items, at }` (resolves ADR-007 open-Q3). Story 04 → **in-review**. Tasks 00–03 `@executable` green; task 04 is the deferred `@manual` two-machine soak. The 33/ADR-002 supersession note was applied to milestone 33's ledger (ADR-007's required amendment).
  - **Review** (architect + qa + designer + code-reviewer): a consolidated fix round landed — worker `workspaceId` derivation, live admission-roster refresh (`updatePeers` per peer-poll), delta-apply no longer rolls back the whole workspace on a partial row, backoff resets on reconnect, and the task-03 503-body `path` (now carried to the API body + rendered in the UI error state — the scenario was incidentally-green before). **Admission hardened properly** (not left as the ADR-007-open-Q4 interim): `defaultResolveOrigin` now joins the tailnet `remoteAddress` to a nodeId (never a spoofable `x-aof-node-id` header) and the server binds the fabric self-address, never `0.0.0.0` (+ a new `acd-control-stream-address-bound` fitness). **Design gaps fixed**: the mobile (≤390px) horizontal-overflow of the work-items table/paths, and the fabric-address slot now degrades to `unknown` rather than vanishing (rendered + judged via a seeded store + headless-Chromium screenshot at 390/768/1280). Green: `npm run test:unit` **835/0**; full `npm test` **2351 pass + 1 confirmed CLI-spawn contention flake** (`mesh-ui-global-scope.test.mjs` passes 3/3 in isolation).

- [x] **00 · global store substrate** — built and in review (`tasks/00`–`03` + two fitness units)
- [x] **01 · mesh-enabled work propagation** — built and in review (`tasks/00`–`03` + two fitness units)
- [x] **02 · global node registry** — built and in review (`tasks/00`–`03` + two fitness units)
- [x] **03 · mesh UI global scope** — built and in review (`tasks/00`–`03` + three fitness units)
- [x] **04 · worker live-state stream to control node** — built and in review (`tasks/00`–`03` `@executable`
  + four fitness units; task 04 is the deferred `@manual` two-machine soak). Contracts were authored at
  `aof:refine 34/04` (Three Amigos) — the earlier "spine only" note above is superseded. Delivers the
  operator-chosen **live stream**: a worker holds a persistent WebSocket to the control node (dial address via
  `resolvePeers`), streams snapshot-then-deltas (reconnect + heartbeat), the control node runs an always-on
  WebSocket server that applies the stream into the global store (tailnet-`remoteAddress` admission, redacted),
  the WebSocket stream is the cross-machine sync path. **REINSTATES the persistent-connection server 33/ADR-002 eliminated**
  (ADR-007; 33/ADR-002 amended). Live per-mutation delta feed + two-machine validation deferred to `aof:verify`.


- **Verified + accepted `2026-07-05` by `aof:verify 34`.** Automated pass: `test:unit` **835/0**, full
  `npm test` **2352/0** (the flagged CLI-spawn flake did not reproduce); all ADR-001…008 fitness units green.
  Agent-run `@manual` machine-wide check **passed** against a real serve face over a seeded two-workspace
  global store (`aof mesh ui` combined view; `--local` narrowed; ADR-002 propagation gate held). Design gate
  = **GAPS** (all non-blocking); the contested mobile ≤390px overflow was **refuted by CDP measurement**
  (`overflowPx: 0`). Architect ruled the `EADDRNOTAVAIL`→loopback silent-degrade → **[ADR-008]**
  (accept-with-follow-up). Three findings logged, **all non-blockers** ([F-3401](VERIFICATION.md) data-merge,
  [F-3402](VERIFICATION.md)/ADR-008 loopback-signal, [F-3403](VERIFICATION.md) local workspace-identity);
  the story-04 two-machine soak is a deferred operator-run check. `aof work validate` **PASS**. All five
  stories → **done**; milestone → **done**. Lessons distilled to [RETROSPECTIVE.md](RETROSPECTIVE.md) and
  ingested into memory (`work memory ingest`, 292 records reindexed). See [VERIFICATION.md](VERIFICATION.md)
  for the full evidence + accept decision.

- **Corrected in place `2026-07-05` by operator order.** The milestone now treats mesh identity and mesh state as machine-wide: one global home (`AOF_GLOBAL_HOME` or `~/.aof`), one machine identity at `<global>/mesh/identity.json`, one global SQLite projection, and WebSocket worker->control sync only. The extra story 05 that was added during the confused reopen has been removed from the active milestone records; the identity correction is folded back into story 00 (global substrate) and story 02 (node registry/descriptors). The physical story folder still needs deletion once filesystem permission allows. The git-bus, per-repo `.aof/mesh` active store, lease overlays, and issuance routing are retired from this milestone.

## Notes on the added story (04)

- **Why it's a story, not a patch (operator call `2026-07-05`).** Real-time worker→control-node streaming is
  a cross-machine transport concern distinct from story 01 (intra-machine local publish) and story 02 (reading
  the local roster). It has its own predicate, stream client, always-on server, connection lifecycle, and
  failure/retry posture → its own story.
- **The big reversal to make honest at refine (ADR-007).** Live streaming brings back the CLASS of
  persistent-connection machinery 33 spent a whole milestone deleting (the ws@8 broker + subscriber + cache).
  33/ADR-002's "the broker is eliminated" now holds only for PRESENCE; real-time work-state gets a stream
  server back. **When 34/04 lands, 33/ADR-002 must be amended** with a supersession note so the two milestones
  don't read as silently contradictory. Also: the control node becomes an **always-on daemon** (answering the
  operator's earlier "does a server run continually?" with a now-yes), and a live stream is materially harder
  to test than a one-shot write — budget for two-machine lifecycle testing (the 33/F-3302 fixtures lesson).

## Decisions (graduated to ARCHITECTURE.md)

All in-flight decisions graduated to durable ADRs at accept — see [ARCHITECTURE.md](ARCHITECTURE.md)
**ADR-001…009**: global mesh state under `globalWorkspacePaths().workspaceDir/mesh` honoring
`AOF_GLOBAL_HOME` (001); explicit `config.mesh.enabled === true` propagation gate (002); SQLite as a
no-new-dep rebuildable projection (003); one snapshot-based idempotent publisher (004); global JSON
descriptors alongside indexed rows (005); `aof mesh ui` global-by-default + `--local` filter (006); the
worker→control live stream reinstating the persistent-connection server, 33/ADR-002 amended (007); and the
verify-added ruling that the control-stream loopback fallback stays but must emit an operator-visible
degraded signal (008); machine-wide identity in global AOF home (009).

## Feedback (for retro) — archived

Graduated to [RETROSPECTIVE.md](RETROSPECTIVE.md) at `aof:verify` (R1 integration-wiring test mandatory;
R2 assert at the altitude the scenario names; R3 admission binds `remoteAddress`; R4 a promise-weakening
degrade must signal by construction — the `EADDRNOTAVAIL`→loopback ruling, [ARCHITECTURE.md](ARCHITECTURE.md)
ADR-008; R5 cross-source merges need precedence; R6 measure `scrollWidth` for overflow calls; R7 spawn-heavy
CLI-suite flake). Lessons ingested into memory. No live feedback remains open.

## Verification

- [x] `@executable` suite green — every story's tasks; `npm run test:unit` **835/0**, full `npm test` **2352/0**
- [x] Fitness functions green — ADR-001…008 units (incl. `acd-control-stream-address-bound`)
- [x] `@manual` (agent-run) — `aof mesh ui` global/default combined view + `--local` filter verified over a
  seeded two-workspace global store; ADR-002 propagation gate held (see [VERIFICATION.md](VERIFICATION.md))
- [x] Design conformance — rendered global populated/empty/error + local at 390/768/1280, designer-judged;
  GAPS all non-blocking; mobile-overflow claim refuted by CDP measurement
- [ ] `@manual` (story 04, task 04) — **deferred, operator-run**: real worker(macOS)→control(Windows) live
  stream over Tailscale (real-time UI update, severed-connection recovery + reconciliation, stopped-worker
  stale-marking, latencies recorded). Not agent-executable on a single host; non-blocking (stream seams +
  loopback-socket admission + launcher wiring are `@executable`-green; stream retry/reconnect coverage)


## Post-cleanup verification

- 2026-07-05: syntax checks + full runner import passed; targeted non-spawn checks passed 14/0. `npm run test:unit` and `npm run ui:build` both hit sandbox `spawn EPERM`; escalated retries were refused by the environment quota. Rerun full verification outside this sandbox before final accept.