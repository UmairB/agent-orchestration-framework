---
type: story
number: 00
slug: session-presence
title: "Session presence — a live coding-assistant session marks a node working on a repo (TTL liveness), aggregated across ALL the node's workspaces, surfaced in mesh presence + the fleet"
parent: 38
status: done
owner: product-owner
created: 2026-07-10
updated: 2026-07-13
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · Session presence — the fleet stops lying: a node being worked on reads `working`, not `idle`

## User story

As a **mesh operator watching the fleet**, I want a node to read **`working · <repo>`** the moment a coding
assistant is live on any of that node's repos — and drop back to **`idle`** on its own when the assistant
closes or crashes — so that the fleet reflects **live activity** instead of only counting executed aof
task-runs, and a packaged tray app launched from its install dir no longer reads permanently `idle` while
real work happens in the user's actual repos.

<!-- The "always idle" fix (found live in the m36 desktop UAT). Two root causes, both closed here: (1) a
     coding-assistant SESSION mints no run record, so "current work" (activeRuns only) can never see it — we
     add a session signal; (2) the presence publisher reads ONE workspace (the daemon's launch cwd), so a
     tray app launched from the install dir sees an empty workspace — we aggregate across ALL the node's
     registered workspaces. TTL self-expiry means a crashed session never sticks "working". -->

## Tasks

<!-- Contract authored `2026-07-10` via `aof:refine 38 --autonomous` (Three Amigos: PO headline + aof-qa
     Examples + aof-developer feasibility). Inherits ARCHITECTURE ADR-001/002/003/004 + DESIGN.md. -->

- [x] `tasks/00_session-cli-record.feature` — `@executable` — `aof session start|ping|end` are the sole
  producers of a per-`(node, workspace, assistant)` session record (frozen shape `{ nodeId, workspaceId,
  repo, assistant, startedAt, lastPingAt }`) in the node's global mesh home (NOT git); `ping` upserts,
  `end` deletes; each is one atomic single-record write (ADR-002).
- [x] `tasks/01_session-ttl-liveness.feature` — `@executable` — a session is LIVE iff `!isStale(lastPingAt,
  now, ttlMs)` REUSING the shared `mesh-presence`/`run-store` predicate (strict `>`; a session AT the TTL is
  still live); the TTL default resolves from `config.mesh.session.ttlSeconds` via the raw optional-chain
  idiom, falling back to one documented constant; no parallel staleness (ADR-002).
- [x] `tasks/02_presence-additive-sessions.feature` — `@executable` — the presence record grows to the frozen
  FIVE keys `{ nodeId, heartbeatAt, activeRuns, sessions, aofVersion }`; a no-session node emits `sessions:
  []` (absent-is-benign) and its first four keys stay BYTE-identical to the m23 record; each `sessions[i]` is
  the derived live-session projection (ADR-001).
- [x] `tasks/03_presence-aggregate-workspaces.feature` — `@executable` — `assembleCurrentPresenceRecord`
  reads `global_node_workspaces` for this node and UNIONS active runs + live sessions across EVERY registered
  workspace (not the single launch cwd); a store-unreachable read degrades to the launch cwd; injected clock.
  **This is the "always idle" bug's root fix** (ADR-003).
- [x] `tasks/04_fleet-session-render.feature` — `@executable` — the fleet NodeCard status line renders
  `working · <repo> (session)` for a session-only workspace, the run's `ref · title` when a run exists (the
  run WINS the primary line), BOTH lines for a node working two repos, and `idle` when neither; one pure
  projection shared by desktop (36) + web (25) (ADR-004, DESIGN binding checklist).
- [x] `tasks/05_assistant-hook-wiring.feature` — `@executable` — the assistant-agnostic hook seam: wiring
  Claude Code `SessionStart`/`UserPromptSubmit`/`SessionEnd` in `.claude/settings.json` to `aof session
  start|ping|end` (the `aof session` CLI is the seam so any tool can integrate); the wiring is verifiable
  without a live assistant.
- [x] `tasks/07_bug-hook-identity-from-cwd.feature` — `@bug` `@finding-F4` `@executable` — **the blocker the
  task-06 live soak caught at `aof:verify 38`.** The BARE hook commands (`aof session start|ping|end`, exactly as
  `.claude/settings.json` fires them) resolve workspace/repo from `identity.payload?.workspace`/`?.repo` — fields
  Claude Code NEVER sends — so every real hook exits 1 (`session-arg-missing-workspace`) and writes nothing: the
  node reads `idle` while actively worked on, the exact bug this milestone exists to fix. The contract
  contradicted its own RESEARCH (§2.2 measured the real field set as `session_id`/`transcript_path`/`cwd`/
  `hook_event_name`). Fix: derive workspace/repo from the payload's **`cwd`** via the CANONICAL
  `config?.mesh?.workspaceId ?? workspaceIdFor(projectRoot)` idiom the presence publisher itself uses (so the id
  the aggregation keys on MATCHES), preserving flag precedence and the loud coded refusal. Corrects task 05's
  false payload clause.
- [x] `tasks/08_bug-web-fleet-presence-plumbing.feature` — `@bug` `@finding-F6` `@executable` — **the WEB fleet's
  read route carries no presence at all.** `/api/mesh/status` (both scopes) is served from `queryGlobalMeshStatus`,
  which builds only a `freshness` ramp and DROPS the presence record — so `Fleet.tsx:631`'s
  `fleetCurrentWorkLines(node.presence ?? {})` always gets `{}` and row 3 is permanently `idle` (the m23
  `running N runs` state has never rendered there either). Fix: carry the frozen five-key presence record through
  the projection, additively, on both scopes; test with the route's REAL response, not a hand-built fixture.
- [x] `tasks/09_bug-desktop-session-render.feature` — `@bug` `@finding-F7` `@finding-F8` `@executable` — **the
  DESKTOP (the surface whose m36 UAT raised this bug) never learned about sessions.** Its Rust view model
  (`app/desktop/crates/core/src/view_model.rs`) has `enum CurrentWork { Running, Idle }` — no session variant —
  and derives the cell from `activeRuns` alone, so a live session renders `idle` (F7). It also reads `activeRuns`
  as OBJECTS (`.get("ref")`/`.get("title")`) when the producer emits a bare `string[]` — F1's exact twin in Rust
  (F8). Fix: add the session state (`working · <repo> (session)`, ADR-004 run-wins, comma-joined for N repos) and
  read `activeRuns` in its real frozen shape; test against a REAL captured `mesh status --json` payload.
- [x] `tasks/10_bug-workspace-workdir-absolute.feature` — `@bug` `@finding-F11` `@executable` — **the milestone's
  headline fix did not work.** `global_workspace_descriptors.work_dir` stored the raw relative `config.work.dir`
  (`"./wiki/work"`) for every workspace, so ADR-003's "aggregate across ALL the node's workspaces" resolved every
  workspace against the daemon's **launch cwd** — reading ONE workspace N times, double-counting runs
  (`running 2 runs` for one run), subsuming EVERY live session, and resolving **ZERO** workspaces from an install
  dir (→ permanently `idle`, the exact bug m38 exists to kill). Fix: store/resolve the work dir **absolute**
  against each workspace's own `project_root` (write side + defensive read side for legacy rows), plus a **loud
  skip** so a zero-workspace aggregate can never again look healthy. Test from a **foreign cwd** against the REAL
  descriptor store.
- [x] `tasks/06_session-presence-soak.feature` — `@uat` — the outsider check for SPEC objective (a): open a
  real coding assistant on a repo → the node reads `working · <repo>` in the fleet within the heartbeat
  window; open a second repo → BOTH show; close/kill the assistant → the node returns to `idle` on its own
  (self-expiring, never stuck). Includes the DESIGN visual-review of the new NodeCard state (a handed
  screenshot; INCONCLUSIVE without one). **Deferred human gate — closed at `aof:verify 38`.**

## Fitness units (proposed)

Inherited from [ARCHITECTURE.md](../../ARCHITECTURE.md) — this story arms:

- `acd-session-presence-additive` (ADR-001) — the presence assembler's key set is the frozen FIVE in order;
  a no-session record's first four keys are byte-identical to the m23 record.
- `acd-session-record-frozen` (ADR-002) — the session-record assembler returns exactly its ordered key set.
- `acd-session-ttl-reuses-isstale` (ADR-002) — the session-liveness path IMPORTS `isStale`/`isNodeStale`; no
  hand-rolled parallel staleness in the session path.
- `acd-session-ttl-self-expires` (ADR-002) — a session past the TTL is not live; one AT the TTL still is.
- `acd-presence-aggregates-node-workspaces` (ADR-003) — `assembleCurrentPresenceRecord` reads
  `global_node_workspaces`, not a single `listItems(ws.workDir)` as its sole item source.
- `acd-session-run-reconciliation` (ADR-004) — a run+session on one workspace yields ONE line (the run's), a
  session-only workspace yields the `(session)` fallback, two workspaces yield two lines (authored with this
  story's fleet-render task).

## Notes

Inherits **ADR-001** (additive `sessions` key), **ADR-002** (session record + TTL-reuses-`isStale`),
**ADR-003** (aggregate across `global_node_workspaces`), **ADR-004** (session↔run reconciliation) and the
[DESIGN.md](../../DESIGN.md) binding checklist (no mock; the checklist is the conformance source of truth).

**Independent of Story 01** (ADR-007) — the presence dimension and the worker-execution dimension touch
`mesh-launcher.mjs` at disjoint functions (`assembleCurrentPresenceRecord` here; the worker-execution wiring
there). No cross-story dependency; builds in parallel.

**No blocking research/security dependency** — unlike Story 01, this story has no open auth question; it can
be built as soon as its contract is locked.

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Verdict: no retags. Tasks 00–05 stay `@executable` (hermetic, injectable); 06 is genuinely `@uat`/`@manual`.**
The `@executable` lanes reuse proven seams UNMODIFIED — `isStale`/`isNodeStale` (task 01), `readActiveRuns`
(task 03), `writeText` atomic temp+rename (tasks 00/02), `presenceRecordPath`/`meshDir` (task 02) — real
reuse, not aspirational. Task 04's reconciliation is genuinely `node:test`-exercisable via the framework-free
`ui/src/board/runs.mjs` house pattern (no React harness).

- **Net-new infra to budget:** (1) a **session-record store** — a `sessionRecordPath(...)` seam under
  `globalMeshPaths(...).meshRoot/sessions/`, mirroring `mesh-store.mjs`'s partition+flat-leaf pattern; the
  **three-part key** `(nodeId, workspaceId, assistant)` needs a NEW traversal-safe leaf composition (the one
  place this story invents a path rule rather than reusing `flatLeaf` verbatim — apply the `..`/`/`/`\`
  collapse to all three inputs). (2) the **`aof session start|ping|end` CLI** (`commands/…`), following the
  `mesh-heartbeat.mjs` `{ id, input, run, cli }` contract — including a **stdin-JSON / `CLAUDE_SESSION_ID`-env
  identity path the CLI layer has never had before** (genuinely new, not a copied seam). (3) `end` needs an
  **ENOENT-tolerant `unlink`** (`writeText` has no delete counterpart — matches the "end on nonexistent
  session is benign" scenario). (4) the **`resolveNodeWorkspaces(nodeId, options)`** seam (reads the existing
  `global_node_workspaces` + `global_workspace_descriptors` tables). (5) `assemblePresenceRecord` grows one
  key + `assembleCurrentPresenceRecord` is rewritten to loop over resolved workspaces — **the highest
  blast-radius change** (9-importer fan-in via `mesh-presence.mjs`; cover heavily). (6) a **shared fleet-model
  reconciliation helper** both the desktop (36) and web (25) views import — DECIDE its home (new
  `ui/src/fleet/runs.mjs` vs adding to `ui/src/board/runs.mjs`) so task 04's "same projection" holds.
- **Build order:** `00 → 01 → 02 → 03` is a strict record-shape chain; `04` is soft-after-`02` (needs the
  five-key shape frozen, not `03`'s correctness); `05` needs only `00`'s verbs to exist (else independent);
  `06` (soak) is strictly LAST (needs 00–05 merged + 04's render shipped for the visual review).
- **Pin `DEFAULT_SESSION_TTL_SECONDS = 120`** — EXPORTED (like `DEFAULT_PRESENCE_STALENESS_SECONDS`) with a
  `resolveSessionTtlSeconds(config)` reading `config.mesh.session.ttlSeconds` via optional-chain, `0` honoured,
  non-finite/negative/wrong-type → the constant. The task-01 Examples already reference the symbol, not a
  literal — export so the tests import it.
- **Task 05 wording (applied):** "argv-form, shell-less" was unachievable — Claude Code's hook `command` is a
  single SHELL STRING by vendor design (RESEARCH.md §2.2). The scenario now asserts a single unchained
  `aof session <verb>` invocation with no embedded shell chaining, which IS testable by string-inspecting the
  composed command.
- **Windows:** session writes route through `writeText`'s `renameWithRetry`; the `sessions/` nesting depth is
  comparable to the existing `presence/`/`nodes/` partitions (no new longpath concern); an `aof session`
  invocation embeds no absolute Windows path in the hook `command`, avoiding the file-path-quoting footgun.
