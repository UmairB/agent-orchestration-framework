---
doc: verification
---
<!--
  Milestone VERIFICATION.md — the record of the aof:verify pass: automated + agent-run evidence,
  design conformance, findings (with triage + routing), and the accept decision. Owned by verify;
  evidence subagents never author this doc. Only sections with content are written.
-->
# 34 · Global Mesh Work Store — Verification

Verified `2026-07-05` by `aof:verify 34`. No `@uat` scenarios exist in this milestone (foundational/
technical), so no human-acceptance lane ran — verification is automated + agent-run, plus the design
render→judge gate. All five stories were `in-review` at entry.

## Verification evidence

### `@executable` suite + fitness functions — GREEN

- **`npm run test:unit`** → **835 passed / 0 failed** (run outside the sandbox for the git-backed
  fixtures, per the story-00 note). Covers every story's focused tests and all structural fitness units.
- **`npm test` (full suite)** → **2352 passed / 0 failed**. The CLI-spawn contention flake STATE flagged
  (`mesh-ui-global-scope.test.mjs`) did **not** reproduce this run — a fully clean sweep.
- **Fitness functions** green — the ADR-001…007 arch invariants, incl.:
  `acd-global-mesh-paths-home` (every mesh root derives from `AOF_GLOBAL_HOME`), `acd-global-store-no-native-dep`
  (`node:sqlite`, no new npm dep), `acd-global-propagation-single-predicate` / `acd-global-publisher-single-seam`,
  `acd-global-node-descriptors-redact-secrets` / `acd-global-node-registry-projection-only`,
  `acd-mesh-ui-global-default` / `acd-mesh-ui-local-filter-preserves-status` / `acd-mesh-ui-scope-visible`,
  the ADR-007 role-predicate + dial-address invariants, and `acd-control-stream-address-bound`
  (P1.6: `remoteAddress`→nodeId admission, never `0.0.0.0`). *verifies →* every story's `@executable` tasks +
  fitness units.

### `@manual` (agent-run) — machine-wide global default vs `--local` filter — PASS

Procedure (agent-run): seeded a temp `AOF_GLOBAL_HOME` with **two mesh-enabled workspaces** (`let-shield`,
`voice-vox-web`) + **one mesh-disabled workspace** (`aof-sandbox`), a control node (`umairs-msi`) and a
worker node (`umairs-mac-mini`) with tailnet fabric addresses, then booted the real serve face and probed
the API + rendered the UI.

- **`aof mesh ui` (default, no flag)** served **global** scope: combined machine-wide view — `scope:"global"`,
  **3 workspaces**, **7 work items** across workspaces (workspace identity on each row), **2 nodes**
  (control + worker, fabric addresses), diagnostics reporting the 1 disabled/skipped workspace.
- **`aof mesh ui --local --target <ws>`** served **local** scope: `scope:"local"`, `currentWorkspace` = the
  target workspace, node/work data narrowed to that workspace only.
- **Propagation gate (ADR-002):** the mesh-**disabled** workspace published **no** work snapshot (it surfaces
  only as `diagnostics.skippedWorkspaces[].reason = "mesh-global-disabled"`), confirming non-mesh workspaces
  stay local-only. *verifies →* the SPEC success criterion ("two+ workspaces → global default combined view;
  `--local` narrows to the current workspace") and stories 01/03.
- **Error-state HTTP contract:** a corrupt projection made `GET /api/mesh/status?scope=global` return
  **503** with body `{ code: "global-store-unavailable", path: "…/projection.sqlite" }` — the serve-face
  altitude the task-03 sc.2 review fix targeted. *verifies →* `03/tasks/03` sc.2.

### Design conformance (UI, stories 03/04) — verdict: **GAPS** (all non-blocking)

Render → hand to `aof-designer` (read-only judge, ADR-001 hand-off) → objective CDP measurement to
adjudicate the one contested call. Rendered the live serve face via headless Chromium against a seeded
global store at **390 / 768 / 1280**; states: global populated / empty / error, and local populated.

- **CONFORMS:** global populated (all five DESIGN regions present + correctly ordered) at desktop **and**
  tablet **and** mobile; global **empty** ("No mesh-enabled workspaces yet" + next action, no failure
  implication); global **error** (shows the full global-mesh-store path + Retry); scope Global-vs-Local is
  unmistakable in both modes; **no credential-shaped values** anywhere (only hostnames, roles, last-seen,
  tailnet fabric addrs, skills, version).
- **Mobile ≤390px overflow — CLAIM REFUTED, CONFORMS.** The designer read the static screenshots as a
  whole-page horizontal overflow. Objective CDP measurement at 390px: `scrollWidth == innerWidth == 390`,
  **`overflowPx: 0`** — the page body does **not** scroll; the only element exceeding the viewport is the
  work-items `<table>` (`min-w-[560px]`) inside its own `overflow-x:auto` container (the allowed pattern).
  The build-time fix STATE recorded is intact. Not a finding.
- **Loading — INCONCLUSIVE (not rendered):** transient; behaviourally covered by the green `@executable`
  task-03 suite. Populated layouts are stable (no reserved-space collapse).
- **GAP → F-3403** (below): local mode does not surface the current workspace **name/path** in the UI.

## Live / environmental checks

- **Story 04 / task 04 — two-machine live-stream soak (`@manual`) — DEFERRED, not agent-executable.**
  The scenario requires a real macOS worker (`umairs-mac-mini`) streaming to a real Windows control node
  (`umairs-msi`) over a live **Tailscale** tailnet (real reconnect/heartbeat/staleness latencies). This
  `aof:verify` ran on a single Windows host with no second physical node and no live tailnet peer, so the
  soak **could not be executed** by the agent. **Owner action (operator):** run the `04/tasks/04` narrative
  on the two real hosts and record the three latencies (change→visible, reconnect, time-to-stale).

  **Correction (verify follow-up — see F-3404).** Preparing the operator runbook surfaced that the live
  feed was NOT wired end-to-end in production: the worker daemon pushed exactly ONE snapshot at connect and
  no production path called `sendDelta`, sent heartbeats, or re-snapshot on reconnect (all exercised only by
  injected-transport unit tests). My earlier "the production path is proven, only timings unmeasured" was
  **too generous** — the headline live promise was inert. **Fixed at verify** (F-3404): the worker daemon
  now runs a stream-sync ticker that re-snapshots its current projection faster than the stale window
  (doubles as heartbeat, converges advances within a tick, re-syncs after reconnect), with three launcher
  tests that fail if the path is inert. The soak is now meaningful to run.

## Findings

| id | observed | type | severity | triage | routed-to | status |
|----|----------|------|----------|--------|-----------|--------|
| F-3401 | In the global node registry, a **fabric-only** (presence-less) descriptor write for a node clobbers a richer **node-record** descriptor for the *same* node: `upsertGlobalRegistryRows` (`src/global-node-registry.mjs`) does an unconditional last-writer-wins upsert (`last_seen_at = excluded.last_seen_at`, `record_source = excluded.record_source`), so a later fabric-only publish blanks `last_seen_at` and downgrades `record_source` to `"fabric"`. Reproduced by publishing two mesh-enabled workspaces that each resolve the *other's* node as a fabric peer; the control node then rendered "never seen". Contradicts the intended "fabric-only peers fill gaps, not replace" posture. Production-reachable where the same node is published from a rich source (local node-record **or** the story-04 stream ingest) **and** a fabric-only source, fabric-only landing last — which can silently blank a *streaming* worker's last-seen. | defect (data merge) | low | **non-blocker → defer** | backlog (story-02/04 follow-up) | open (deferred) |
| F-3402 | Control-stream server `EADDRNOTAVAIL → 127.0.0.1` fallback (`listenOrDegradeToLoopback`, `src/control-stream-server.mjs`) is **silent**: on a control node whose fabric self-address genuinely won't bind (persistent misconfig, not a transient race), the stream server stays reachable only on loopback, remote workers can't connect, yet the daemon reports "up" — real-time silently degraded (local truth remains intact, but cross-machine sync waits for WebSocket reconnect). Architect ruling **[ADR-008]**: keep the fallback (never crash the always-on daemon), but a loopback bind is a DEGRADED state that must emit an operator-visible signal (a `degraded` field on the server handle → the launcher's existing `warnings` channel → UI diagnostics) + a fitness. | design-note | non-blocker | **non-blocker → defer** (arch ruled: accept-with-follow-up) | backlog (developer; ref [ADR-008](ARCHITECTURE.md)) | ruled, deferred |
| F-3403 | `aof mesh ui --local` does not surface the **current workspace name/path** in the UI (only the CLI terminal prints `Project: <path>`); DESIGN.md's `--local` contract requires "the current workspace path/name is visible". (The designer's broader claim that local should mirror global's full region vocabulary is **dismissed** — it contradicts ADR-006, which deliberately keeps `--local` as the pre-existing focused fleet view.) | design-gap | low | **design-gap → designer sets DESIGN rule** | `aof-designer` → DESIGN.md (add: local view shows the current workspace name/path in its header/scope region — a small addition to the existing view, not a re-architecture); backlog for build | open (deferred) |
| F-3404 | The story-04 **live feed was inert in production**: the worker daemon (`startLauncher`) pushed exactly ONE snapshot at connect (`defaultConnectWorkerStreamClient`) and NO production path called `streamClient.sendDelta`, sent heartbeats, or re-snapshot on reconnect — all only exercised by injected-transport unit tests. On real hardware a work advance on the worker would never reach the control node's stream view, and a *running* worker would flip "stale" after 30s. Same fixtures-hide-the-wiring class as R1/R4, one layer deeper than the build review caught. Found while preparing the two-machine runbook. | defect (inert integration) | **was blocker for story-04's live promise** | **fixed at verify** | `src/mesh-launcher.mjs` — added the worker **stream-sync ticker** (periodic re-snapshot, cadence < `DEFAULT_HEARTBEAT_WINDOW_SECONDS`: heartbeat + convergence + reconnect re-sync) + 3 launcher tests that fail if inert | **fixed** (`test:unit` 838/0) |

| **F-3405** | The **node identity** the global work store is keyed on is stored **per-workspace** (`.aof/mesh/identity.json` under each project's `aofDir`, `sidecarPathFor`), not machine-globally — so the same machine can resolve a different `nodeId` per workspace, making a machine-wide store keyed on `nodeId` incoherent. This is the milestone's *core* promise (machine-wide global) left unmet; verify accepted it anyway and initially defended it. Found when the operator opened the identity file. | defect (architecture — milestone core) | **blocker** | **fix in place (ADR-009)** | identity globalized in place (one per machine in `AOF_GLOBAL_HOME`/`~/.aof`, init-once, hydrated into every workspace, clone-safe; legacy sidecar → `work doctor` migrate) + fitness `acd-global-node-identity-home` + tests (one id per machine / distinct per machine / legacy migrate). A machine-global identity also broke single-process test hermeticity → per-test global-home isolation in both runners (a minting test had written identity to the real machine home; removed). | **fixed** |

The milestone is **re-opened** (F-3405 is a blocker for its core promise). F-3404 (the one that WAS blocker-severity for story-04's live promise) is
**fixed**; F-3401/F-3403 degrade a display field / a label without losing canonical truth or the milestone's
core value (the machine-wide work view); F-3402 is an architect-ruled design-note.

## Re-accept decision (`2026-07-05`, after in-place identity correction)

**RE-ACCEPTED.** The in-place global per-install node identity correction closes the F-3405 blocker, so the milestone's
core promise — machine-wide *global* mesh state — now actually holds end to end.

- **Identity is machine-wide** (ADR-009): `nodeId`+`salt` in the global AOF home, initialized once, hydrated
  into every workspace; the global work store keyed on `nodeId` is now coherent. Proven by
  `global-node-identity` tests (one id per machine / distinct per machine / legacy→global migrate) and the
  fitness `acd-global-node-identity-home` (identity resolves from the global home, never a per-workspace
  `aofDir`) — the check that was missing at the wrong accept.
- **Suite:** `test:unit` **844/0**; full `npm test` **2360 pass + 1 flake** — the flake is
  `mesh-ui-global-scope/00 --local` (spawn-based stdout assertion), **10/10 green in isolation ×3**, the
  recurring CLI-spawn contention debt already logged as **R7** (not a regression from the identity correction). Honestly
  recorded, not hidden.
- **Test hermeticity fixed:** globalizing identity broke single-process test isolation (a minting test wrote
  identity to the real machine home and cascaded 69 failures in the first full run); both runners now give
  each test its own empty `AOF_GLOBAL_HOME`, and the test-written identity was removed from the machine.
- `aof work validate` — see the gate result recorded at re-accept.
- **Still outstanding (unchanged):** the story-04 two-machine live-stream soak (operator-run) and the
  non-blocker findings F-3401/F-3402/F-3403. F-3404 (live feed) and F-3405 (global identity) are **fixed**.

The prior accept below is retained as the superseded record.

## Accept decision

> **REVERTED `2026-07-05` — re-opened by operator order.** This accept was **wrong**: the milestone
> globalized the work *store* but left the **node identity** it is keyed on **per-workspace**, which is
> incoherent for a machine-wide store (see [RETROSPECTIVE.md](RETROSPECTIVE.md) R8 / F-3405). The in-place global per-install node identity correction globalizes it; the milestone re-accepts only after that correction lands.
> The text below is the superseded original accept record.

**ACCEPTED.** All five stories (`00`–`04`) are done; the milestone is accepted.

- `@executable` suite + all ADR-001…007 fitness functions **green** (`test:unit` 835/0; full `npm test`
  2352/0). The agent-run `@manual` global-default-vs-`--local` machine-wide check **passes** against a real
  serve face over a seeded two-workspace global store, and the ADR-002 propagation gate holds.
- Design conformance is **GAPS** but every gap is **non-blocking**; the one contested pixel-read
  (mobile ≤390px overflow) was **refuted by CDP measurement** (page `overflowPx: 0`).
- Three findings logged, **all non-blockers** (F-3401 data-merge defect → backlog; F-3402 loopback-degrade
  → ADR-008 follow-up; F-3403 local workspace-identity → DESIGN rule). The story-04 two-machine soak is a
  **deferred operator-run** environmental check (not agent-executable), non-blocking by the automated +
  loopback-socket + launcher-wiring coverage and stream retry/reconnect handling.
- `aof:validate 34` — see the gate result recorded at accept time (PASS required).

Accepting the milestone unblocks anything that `depends:` on 34.

## Post-cleanup verification (`2026-07-05`)

After the global-home/WebSocket-only cleanup:

- `node --check` passed for the touched source modules and both test runners.
- `node -e "import('./scripts/test.mjs')"` passed; the full runner imports cleanly after removing deleted mesh-bus modules from the runner.
- Targeted non-spawn checks passed: `global-node-identity`, `worker-role-address`, `acd-global-node-identity-home`, `acd-global-mesh-paths-home`, `acd-global-propagation-single-predicate`, and `acd-global-publisher-single-seam` (**14/0**).
- `npm run test:unit` started and passed through the global store/propagation/query sections, then the sandbox blocked the spawn-based mesh UI test with `spawn EPERM`.
- `npm run ui:build` was likewise blocked by sandbox `spawn EPERM` when Vite/esbuild tried to spawn.
- Escalated retries for both blocked commands were refused by the environment quota, so full local verification must be rerun outside this sandbox.