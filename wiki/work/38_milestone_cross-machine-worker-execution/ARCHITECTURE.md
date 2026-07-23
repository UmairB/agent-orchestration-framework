---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 38 · Cross-machine worker execution & session presence — Architecture Decisions

> Inputs: `SPEC.md` (a node's presence must reflect live coding-assistant SESSIONS aggregated across ALL its
> workspaces — not just executed task-runs from the daemon's one launch cwd — and a worker must provision
> itself for an assignment it lacks the repo for: clone + worktree), `STATE.md` (both gaps traced live in the
> milestone-36 desktop UAT — "current work" counts only `running` run records, and the presence publisher reads
> `listItems(ws.workDir)` for ONE workspace), the milestone-23 FROZEN presence contract (`{ nodeId,
> heartbeatAt, activeRuns, aofVersion }`, key order load-bearing, byte-equivalence asserted — `mesh-presence.mjs`
> + `acd-presence-write-scope`), the milestone-34 global store (`global_node_workspaces` maps a node → its
> registered workspaces), and the milestone-35 worker-execution + worktree machinery (`mesh-worker-execution.mjs`
> repo-guard + `mesh-worktree.mjs` `addWorktree`/`removeWorktree`/`sweepRetainedWorktrees`, ADR-004/005).
>
> **Codebase-graph grounding.** `aof graph impact` (built at refine) reports the two dimensions this milestone
> touches are cleanly separable:
> - `src/mesh-presence.mjs` is **central — imported by 9** (heartbeat, node-identity, run-start,
>   `control-stream-server`, `global-node-registry`, `mesh-assignment-reclaim`, `mesh-launcher`, the lease/liveness
>   paths). Its FROZEN 4-key schema and its `isStale`/`isNodeStale` staleness predicate are load-bearing for that
>   whole set, so the session signal MUST be additive (ADR-001) and TTL liveness MUST reuse the existing predicate
>   (ADR-002), never fork it.
> - `src/mesh-worker-execution.mjs` is **imported ONLY by `mesh-launcher.mjs`** and imports `mesh-worktree.mjs`;
>   `src/mesh-worktree.mjs` is **imported only by `worker-execution` and imports nothing**. So the worker-execution
>   dimension is a near-leaf — its clone-on-miss change (ADR-005) has a blast radius of exactly one importer.
> - The two dimensions share only `mesh-launcher.mjs` as a distant common importer and touch **disjoint
>   functions** there (`assembleCurrentPresenceRecord` for presence; the `workerExecution`-gated
>   `createMeshWorkerExecutionHandler` wiring for the worker). This is the graph fact that licenses the two-story
>   partition (ADR-007) — they do not collide at the one file they both touch.
> - `global_node_workspaces` (schema, `global-work-store.mjs:158`, PK `(node_id, workspace_id)` + workspace index)
>   already maps a node → its registered workspaces; it is the read source for the presence-aggregation fix
>   (ADR-003) and is already the worker's repo-membership fact (`localNodeWorkspaceMembership`,
>   `mesh-worker-execution.mjs:105`).
>
> The graph is one input; the boundaries below are the architect's call.

---

## ADR-001: The live-session signal is an ADDITIVE fifth key on the presence record — a `sessions` array beside `activeRuns` — evolving the FROZEN m23 schema without breaking its byte-equivalence / key-order discipline

**Status:** Accepted
**Date:** 2026-07-10

**Context.** The presence record schema is FROZEN by 23/ADR-002: EXACTLY `{ nodeId, heartbeatAt, activeRuns,
aofVersion }`, in that order, with a byte-equivalence assertion on read-back (`assemblePresenceRecord`,
`mesh-presence.mjs:75`; the frozen-key + byte-equivalence tests in `mesh-presence-record.test.mjs`). Nine modules
import this module (graph). But the milestone's whole point is that a node is `working` when a coding-assistant
SESSION is live even with **zero** run records — `activeRuns` alone structurally cannot express that (a session
mints no run). The record must carry a second, session-derived liveness signal. The hazard: any change that
reorders keys, or that emits a new key even when no session exists, would break the m23 byte-equivalence tests
and every downstream consumer that hashes/compares the record. This is precisely the additive-evolution shape
23/ADR-002 anticipated for future signals.

**Decision.**
- **One new key, appended last, holding a `sessions` array.** The presence assembler grows to EXACTLY five keys,
  in this order: `{ nodeId, heartbeatAt, activeRuns, sessions, aofVersion }` — `sessions` is inserted **before
  `aofVersion`** (the trailing provenance string) so the semantic run/session liveness pair sits together; the
  m23 four keys keep their relative order. (An alternative — append strictly last, after `aofVersion` — was
  rejected: it would split the two liveness signals across the provenance string, and the assembler already
  groups liveness before provenance.) The frozen key set is re-frozen at FIVE and re-asserted order-sensitively.
- **Absent-is-benign.** When a node has NO live sessions, `sessions` is the empty array `[]`, NOT omitted — the
  key is always present (so the shape is stable), but its emptiness carries the same "nothing to report" meaning
  the empty `activeRuns` already does. A reader that predates this key (a peer on an older build, or the m23
  byte-equivalence expectation) sees a record whose FIRST FOUR keys are byte-identical to before; the new key is
  ignorable. The record is still a PURE projection (23/ADR-002 rebuildability): the same clock + run records +
  session records yield a content-equivalent record.
- **Each session entry is a projection, not an authority.** A `sessions[i]` is `{ workspaceId, repo, assistant,
  lastPingAt }` — `workspaceId` (the global-store canonical id, the join key), `repo` (a human label for the
  fleet line), `assistant` (which tool — `claude-code`, …), `lastPingAt` (the ISO-8601 UTC-Z liveness stamp the
  TTL predicate reads, ADR-002). The array is DERIVED by reading the live (non-expired) session records
  (ADR-002) across the node's workspaces (ADR-003) — the presence module does not become a second authority over
  session state, exactly as `activeRuns` reads-but-never-mutates the run records.
- **The write discipline is unchanged.** Publishing still routes through the m22 `presenceRecordPath` + atomic
  `writeText` temp+rename seam (`acd-presence-write-scope`); this ADR changes only the record's SHAPE, never its
  write site.

**Consequences.**
- The m23 byte-equivalence discipline is preserved for the frozen four keys; the fitness function
  `acd-session-presence-additive` (this milestone) re-freezes the five-key order AND asserts the no-session
  record's first four keys are byte-identical to an m23 record.
- A node reads `working` off a live session with no run — the headline correctness fix — without any consumer
  that only reads `activeRuns` regressing.
- The signal is rebuildable: drop the presence record and the next heartbeat re-derives it from the same session
  + run records.

---

## ADR-002: A per-`(node, workspace, assistant)` session record with TTL self-expiry — liveness REUSES the m23 `isStale` predicate (strict `>`, injected clock); a crashed session self-expires, never sticks "working"

**Status:** Accepted
**Date:** 2026-07-10

**Context.** The session signal is fed by a coding assistant through an assistant-agnostic CLI seam (`aof session
start|ping|end`, wired from editor hooks — Claude Code `SessionStart`/`UserPromptSubmit`/`SessionEnd`). The hard
requirement (SPEC): a crashed assistant (SIGKILL, laptop lid, lost network) never fires `end`, so liveness CANNOT
rest on an explicit `end` — it must self-expire on a TTL, exactly as node presence self-expires on
`isNodeStale`. The existing staleness definition (`isStale` in `run-store.mjs`, re-exposed as `isNodeStale` in
`mesh-presence.mjs:202` — strict `>`, UTC-Z `Date.parse`, injected `nowMs`/`thresholdMs`) is the SAME predicate
the whole mesh already shares (23/ADR-002, 35/ADR-005). Forking a parallel staleness rule here would be the exact
"two heartbeats" mistake the fitness functions guard against.

**Decision.**
- **A session record per `(nodeId, workspaceId, assistant)`.** The tuple is the key: one assistant, one
  workspace, one node → one record. A node running two assistants on one repo, or one assistant on two repos,
  holds two records (the "node working two repos shows both" SPEC requirement falls out of this key). The record
  shape is `{ nodeId, workspaceId, repo, assistant, startedAt, lastPingAt }` — `lastPingAt` is the liveness
  stamp.
- **Where it lives — the node's OWN machine-wide store, NOT git, NOT a per-repo dir.** Session records are
  transient per-install liveness facts (like presence, like identity), so they live under the global mesh home
  (`globalMeshPaths(...).meshRoot`, honoring `AOF_GLOBAL_HOME`) in a `sessions/` partition — never committed,
  never in the repo working tree, never synced over git (the 23/ADR-001 relay-stateless + 33/ADR-004 clone-safe
  discipline). This co-locates them with the very `global_node_workspaces` registry the aggregation reads
  (ADR-003), so one store-open covers both.
- **`aof session start|ping|end` are the SOLE producers.** `start` writes the record (`startedAt = lastPingAt =
  now`); `ping` refreshes `lastPingAt = now` (idempotent — an unknown session is upserted, so a `ping` without a
  prior `start` still works); `end` deletes the record. Each is a single-record mutation through the atomic
  write seam — never a bare write. This mirrors the m35 assignment-state "sole producer per state" discipline.
- **TTL liveness REUSES `isStale` — no parallel predicate.** A session is LIVE iff `!isStale(record, nowMs,
  ttlMs)` where the predicate is IMPORTED from `mesh-presence.mjs`/`run-store.mjs` (strict `>`; a session AT the
  TTL is still live, 60 > 60 is false), reading `record.lastPingAt` (the record is shaped so `isStale`'s
  `heartbeatAt ?? updatedAt` fallback resolves to `lastPingAt` — we pass `lastPingAt` explicitly). The TTL
  default is a DOCUMENTED constant resolved from config (`config.mesh.session.ttlSeconds`, falling back to a
  single named default) via the raw optional-chain idiom (NOT the config-editor whitelist — the 22/story-01
  lesson), mirroring `resolveStalenessSeconds`. A default around the session-ping cadence's headroom (indicative
  120s — comfortably above the assistant hook's `UserPromptSubmit` ping cadence) so a live-but-quiet session is
  not falsely expired; the Three Amigos pin the exact number.
- **The presence assembler reads LIVE sessions only.** When ADR-001's `sessions` array is built, it filters the
  session records through this SAME `isStale` predicate — an expired (crashed) session is simply absent from the
  next presence record, so the node returns to `idle` on its own within one heartbeat window. There is no
  reaper daemon; expiry is a read-time projection (the derived/rebuildable discipline).

**Consequences.**
- A crashed assistant self-heals: no `end` ever fires, but the record ages past TTL and the node reads `idle` —
  never a stuck `working`. `acd-session-ttl-self-expires` pins this behaviourally.
- The run layer, the node layer, AND the session layer share ONE staleness definition — `acd-session-ttl-reuses-
  isstale` fails CI on any parallel/hand-rolled staleness in the session path.
- Session state is clone-safe and never leaks over git (it lives in the global home, like identity/presence).
- `aof session` is a new CLI verb-namespace with a clean producer discipline; the record has a sole producer per
  mutation.

---

## ADR-003: Presence AGGREGATES across ALL of a node's registered workspaces — `assembleCurrentPresenceRecord` reads `global_node_workspaces` for this node and unions active runs + live sessions across every workspace, replacing the single `listItems(ws.workDir)` read

**Status:** Accepted
**Date:** 2026-07-10

**Context.** THE BUG (traced live in the m36 UAT, STATE.md): `assembleCurrentPresenceRecord(ws, nodeId)`
(`mesh-launcher.mjs:71`) reads `listItems(ws.workDir)` for exactly ONE workspace — the daemon's launch cwd. A
packaged tray app launched from its install dir reads an empty workspace and is PERMANENTLY `idle`, no matter how
much work happens in the user's actual repos. This is a correctness fix, not merely additive: the presence
record's scope is wrong. The machine-wide truth already exists — `global_node_workspaces` (PK `(node_id,
workspace_id)`, `global-work-store.mjs:158`) maps THIS node to every workspace it has registered; it is the same
table the worker's repo-membership check already reads (`localNodeWorkspaceMembership`).

**Decision.**
- **Read the node-workspaces registry, not the launch cwd.** `assembleCurrentPresenceRecord` no longer takes its
  work items from a single `listItems(ws.workDir)`. Instead it resolves the set of workspaces this `nodeId` owns
  by reading `global_node_workspaces WHERE node_id = ?` from the node's OWN local global store (the same store,
  same `AOF_GLOBAL_HOME`, the launcher already publishes into). This read is the NAMED SEAM that replaces the
  single-cwd read — call it `resolveNodeWorkspaces(nodeId, options)` (in the aggregation module, injectable store
  opener, degrades to the launch-cwd workspace if the store is unreachable so a standalone/pre-registry node is
  never worse off than today).
- **Union active runs + live sessions across every resolved workspace.** For each of the node's workspaces:
  read its active runs (the existing `readActiveRuns` over that workspace's items) and its live sessions
  (ADR-002's read, filtered by `isStale`). `activeRuns` becomes the UNION across all workspaces; `sessions`
  (ADR-001) is the union of live session records across all workspaces. The launch-cwd workspace is included in
  the set (it is a registered workspace like any other) — so no work is lost, and work in a non-cwd workspace is
  now seen.
- **Resolving a workspace to its items stays behind the existing work.mjs seam.** Mapping a `workspace_id` back
  to its `workDir` to enumerate items reuses the store's descriptor (`global_workspace_descriptors` /
  `descriptor_path`) + the ordinary `loadWorkspace`/`listItems` path — the aggregation does NOT invent a second
  item-enumeration strategy (the enumerate-then-filter discipline `mesh-worker-execution` already keeps). A
  workspace whose descriptor no longer resolves on disk is skipped (absence-is-benign), never a crash.
- **The read is failure-isolated + clock-injected.** A store-read fault degrades to "just the launch cwd"
  (never a daemon crash — the never-crash discipline every launcher tick keeps); `now` is injected (the record
  stays a pure projection over its inputs).

**Consequences.**
- The "always idle" bug is fixed at its root: a tray app launched from its install dir now sees every repo the
  node works; a node working two repos surfaces both (ADR-004 renders both lines).
- `acd-presence-aggregates-node-workspaces` fails CI if `assembleCurrentPresenceRecord` reverts to a single
  `listItems(ws.workDir)` read with no `global_node_workspaces` consultation.
- The aggregation reaches the global store only through a sanctioned seam (the `acd-global-publisher-single-seam`
  posture) — the launcher itself gains no direct SQLite dependency it did not already have via the reclaim
  orchestrator.

---

## ADR-004: Session ↔ run reconciliation — the concrete task-RUN wins the fleet's primary "current work" line; a live session is the FALLBACK `working · <repo> (session)` only when no run exists for that workspace; a node working N repos shows N lines

**Status:** Accepted — **AMENDED 2026-07-12 (as-built correction; see the AMENDMENT block at the end of this
ADR).** The reconciliation RULE below stands unchanged and shipped. Its **placement** claim ("it lives in the
fleet model") and its **single-function** claim ("both UIs consume the SAME projection function") were both
FALSIFIED by the live soak at `aof:verify 38` (findings F1, F8, F9) and are struck through below. Read the
AMENDMENT for the as-built architecture.
**Date:** 2026-07-10

**Context.** The second open question (SPEC/STATE): when BOTH a live session AND a `running` task-run exist for
the same workspace, which wins the "current work" line, and do they merge? Both signals now ride on the presence
record (`activeRuns` + `sessions`, ADR-001), so the fleet render must have ONE documented rule — otherwise two
UIs (desktop 36 / web 25) drift on how they collapse the pair.

**Decision.**
- **The run wins the primary line — it is the concrete "executing" signal.** A `running` task-run is the
  stronger, more specific fact (an aof run is actually executing the ref); a session is the weaker "an assistant
  is open on this repo" fact. So for a given workspace: if an active run exists, the fleet line is the run's
  `ref · title` (today's render, unchanged). The session for that same workspace does NOT add a second line — it
  is subsumed (the assistant driving the run is the same activity).
- **The session is the FALLBACK line when no run exists.** A workspace with a live session but no active run
  renders `working · <repo> (session)` — the `(session)` suffix distinguishes it from a run line so an operator
  can tell "an assistant is open here" from "aof is executing a ref here". This is the case the whole milestone
  exists for (a node worked-on with zero run records).
- **Per-workspace, not per-node — N repos → N lines.** Reconciliation is decided PER WORKSPACE. A node with a
  run in repo A and a session-only in repo B shows BOTH: repo A's `ref · title` and repo B's `working · <repoB>
  (session)`. The node's overall state is `working` if ANY workspace has a run OR a live session, else `idle`
  (self-expiring via ADR-002). "A node working two repos shows both" is the SPEC's acceptance line, satisfied
  structurally.
- **Reconciliation is a PURE projection over the presence record — ~~it lives in the fleet model~~, not a new
  authority.** The render derives lines from `{ activeRuns, sessions }` on the already-published presence record;
  it does not re-read runs/sessions or introduce a third signal. ~~Both UIs consume the SAME projection function
  (the m36 single-data-path discipline) — never two divergent collapse rules.~~
  *(Both struck clauses are FALSE as built — see the AMENDMENT below. The projection stays PURE and adds no
  authority; that half held.)*

**Consequences.**
- One documented, testable rule: `acd-session-run-reconciliation` pins that a run+session on one workspace
  yields ONE line (the run's), a session-only workspace yields the `(session)` fallback, and two workspaces
  yield two lines.
- ~~The desktop and web fleet views cannot drift — the collapse is one shared pure function over the presence
  record.~~ *(False — see the AMENDMENT: the desktop is Rust and CANNOT import the JS helper. Drift is
  prevented by a shared captured PAYLOAD, not by a shared function.)*
- No new signal or authority: reconciliation reads only what ADR-001 already published.

### AMENDMENT (2026-07-12, `aof:verify 38` — the live soak; findings F1, F8, F9)

**What was falsified.** The decision above was written as if reconciliation were a RENDER-TIME collapse shared by
one function across both UIs. Neither half survived contact with the producer:

1. **The subsumption does NOT live in the fleet model — it cannot.** The wire's `activeRuns` is the FROZEN m23
   `string[]` of BARE RUN IDS (23/ADR-002); it carries NO workspace attribution. A render helper handed only
   `{ activeRuns, sessions }` therefore CANNOT decide "does this run belong to the same workspace as this
   session?" — the fact it would need is not on the wire. F1 caught the first `acd-session-run-reconciliation`
   fitness test feeding `fleetCurrentWorkLines` attributed run OBJECTS (`{ runId, workspaceId }`) — a shape the
   producer never emits. The rule could not have fired in production.
2. **Both UIs do NOT share one projection function — they cannot.** The desktop is a **Rust/Tauri app**
   (`app/desktop/crates/core/src/view_model.rs`); it is structurally incapable of importing
   `ui/src/fleet/runs.mjs`. Codebase-graph fact (graph rebuilt at this amendment, 1844 nodes / 4426 edges over
   `src/`): the producer's import graph contains **ZERO nodes** under `ui/src/fleet/**` or `app/desktop/**` —
   both render surfaces sit entirely OUTSIDE the producer's dependency graph, and the Rust one is a separate
   language island. "One shared function" was never available to be true.

**The AS-BUILT architecture (what actually shipped).**

- **Where reconciliation lives: in the PRESENCE ASSEMBLER, before publish.** `assembleCurrentPresenceRecord`
  (`src/mesh-launcher.mjs`) already loops per workspace to build `activeRuns` — it is **the only place workspace
  attribution exists**. It therefore performs the ADR-004 subsumption there: a live session whose `workspaceId`
  already has a running run is DROPPED before the record is published. **`sessions[]` on the wire is
  PRE-SUBSUMED.** (Graph: `mesh-presence.mjs` — imported by 9 — now imports `mesh-session.mjs`, so runs and
  sessions converge in exactly one module; the launcher's assembler is the single join site.)
- **Render layers are PURE FORMATTERS over `{ activeRuns: string[], sessions: [...] }`.** They must NEVER
  re-derive liveness (the TTL filter is applied upstream) and NEVER re-derive subsumption (it is applied
  upstream). They format already-decided facts — nothing more. A render layer that tries to attribute a run to a
  workspace is, by construction, inventing data.
- **Cross-language surfaces: ONE documented RULE, N implementations.** The reconciliation rule has two
  implementations by necessity — JS `fleetCurrentWorkLines` (`ui/src/fleet/runs.mjs`, called by the web fleet via
  `nodeCurrentWork`) and Rust `current_work` (`app/desktop/crates/core/src/view_model.rs`). The duplication is
  STRUCTURAL, not sloppiness; it may not be argued away.
- **The binding discipline that REPLACES the false "same function" guarantee:** *every implementation of the rule
  MUST be exercised against the SAME REAL CAPTURED PRODUCER PAYLOAD.* Sameness of behaviour is bought with a
  shared **payload**, never assumed from a shared **import**. This is the cross-language case of ADR-008.
- **Each surface renders the rule within its own row affordance, and that difference is DOCUMENTED, not
  accidental:** the web card emits a LINE PER SIGNAL (a `running N runs` line and, for any unsubsumed session, a
  `working · <repo…> (session)` line — SPEC's "a node working two repos shows both"); the desktop row 3 is a
  SINGLE cell, so when a run exists it renders `running N runs` and shows no session line (m38 DESIGN §Surface 1:
  "the run wins the primary line even if a session also exists"). **Known residual divergence:** for a node with a
  run in workspace A *and* an unsubsumed live session in workspace B, the web shows both facts and the desktop
  shows only the run. That is a row-affordance limit of the desktop's single-cell design, recorded here so it
  cannot widen silently — the fitness functions below pin the two surfaces to identical output on every captured
  payload they can both render.

**Consequences (as built).**
- `acd-session-run-reconciliation` now exercises the REAL assembler end-to-end (a hermetic repo, a real run
  record, a real session record) and asserts the record is ALREADY subsumed on the wire — the render helper is
  proven separately as a formatter. Its self-check plants an un-subsumed assembler.
- `acd-active-runs-frozen-string-array` (new) pins the wire shape across BOTH languages, so no consumer — JS, TS
  or Rust — can re-invent the attributed-object shape that F1/F8 both assumed.
- `acd-captured-producer-fixture` (new) pins the cross-language binding discipline: the Rust surface's fixtures
  must be REAL CAPTURED producer stdout, must still match what the producer emits today, and must render the
  SAME line the JS projection derives from the SAME payload.
- The single-data-path discipline survives, restated honestly: **one data path, one rule, one captured payload —
  N formatters.**

---

## ADR-005: Worker clone-on-miss EXTENDS m35/ADR-004 — the `!hasRepo` refusal becomes resolve-clone-location → clone into a SCOPED root → register the workspace (so `workerHasRepo` then passes) → fall through to the UNCHANGED worktree+run flow; the credential MECHANISM defers to RESEARCH/SECURITY, but the structural invariants are pinned here

**Status:** Accepted
**Date:** 2026-07-10

**Context.** Today the worker handler (`mesh-worker-execution.mjs:278`) refuses an assignment for a repo it
lacks: `if (!hasRepo) { sendAssignmentStatus(..., "failed", { code: "assignment-repo-unavailable" }); return; }`.
`workerHasRepo` is a JOIN of the local `mesh.repo.published` marker AND `global_node_workspaces` membership
(`mesh-worker-execution.mjs:135`). The milestone turns that refusal into a clone-then-proceed: a worker
provisions itself off the assignment. The private-repo auth-transmission MECHANISM is a genuine open question
that needs `aof-researcher` (prior art) + `aof-security` (threat model) — it BLOCKS the story's build. But the
STRUCTURAL invariants that keep a self-provisioning worker safe do not depend on which auth mechanism wins, so
they are pinned here now.

**Decision.**
- **The clone SOURCE comes from a NEW config key.** The repo's clone URL is resolved from
  **`config.mesh.repo.cloneUrl`** (indicative name; the `config.mesh.repo.*` block already exists — it holds the
  `published`/`workspaceId` marker `writeRepoPublishedMarker` writes, `commands/mesh-repo.mjs:44`). This is a
  fleet-shared, committed key (the clone SOURCE is not per-install identity), read via the raw optional-chain
  idiom, NOT the config-editor whitelist. An assignment for a workspace with no resolvable `cloneUrl` stays a
  LOUD coded `failed` (the existing `assignment-repo-unavailable` posture — never a silent hang), so a
  misconfigured fleet fails honestly.
- **The clone TARGET is a SCOPED path under a dedicated root — never arbitrary, never `os.tmpdir()`.** The
  checkout lands under a dedicated `checkouts/` root inside the global mesh home
  (`globalMeshPaths(...).meshRoot` → `<meshRoot>/checkouts/<workspaceId>/`, honoring `AOF_GLOBAL_HOME`), keyed by
  `workspaceId` — the SAME "one dedicated, scoped, keyed root" discipline `meshWorktreePath` keeps for worktrees
  (35/ADR-004). A `meshCheckoutPath(workspaceId)` seam is the ONE place the checkout path is built; it is
  composed from `workspaceId` (a store-canonical id, never directive/ref text), so a traversal id constructs no
  escaping path. NEVER `os.tmpdir()`, never a path built from unsanitised directive text.
- **After a successful clone, REGISTER the workspace, then the existing guard passes.** The worker writes the
  local `mesh.repo.published` marker for this `workspaceId` (the `writeRepoPublishedMarker` seam) AND inserts its
  own `global_node_workspaces (nodeId, workspaceId)` row — the two facts `workerHasRepo` joins. The handler then
  RE-CHECKS `workerHasRepo` (now true) and FALLS THROUGH to the EXISTING flow: `addWorktree` → resolve ref in
  worktree → `startRun` → `spawnRuntime` → `completeRun` → cleanup (35/ADR-004, UNCHANGED). Clone-on-miss is a
  PREFIX to the existing path, not a rewrite of it.
- **Credential structural invariants (mechanism deferred).** The specific credential-transmission mechanism
  (short-lived token over the relay? pre-provisioned deploy key? fabric identity?) is deferred to `RESEARCH.md`
  (`aof-researcher`) + `SECURITY.md` (`aof-security`) — this ADR does NOT choose it. But regardless of mechanism,
  these invariants hold and are fitness-pinned: (a) a credential is NEVER persisted into the clone's
  `.git/config` (no `url.<cred>@` rewrite, no `credential.helper store` pointing at a durable file) — the clone
  uses an ephemeral, in-memory/askpass path so the checkout carries no secret at rest; (b) a credential value is
  NEVER written to a log or an error message (the redaction discipline `acd-global-node-descriptors-redact-
  secrets` already keeps). The git spawn stays argv-form, shell-less (the `mesh-worktree`/`enroll-git-argv-no-
  shell` precedent).
- **A general remote-shell channel is explicitly out (SPEC).** The worker provisions ITSELF off the assignment's
  `workspaceId` — clone one known repo to one scoped path. This ADR adds no way to run an arbitrary command or
  clone an arbitrary URL on a peer.

**Consequences.**
- A worker assigned work for a repo it lacks clones it and proceeds with no manual pre-setup — the headline
  cross-machine capability.
- The clone target is provably scoped: `acd-worker-clone-target-scoped` fails CI if the checkout path is built
  from anything but the dedicated `meshCheckoutPath` root (no `os.tmpdir()`, no directive-text path).
- No credential is left in `.git/config` or a log: `acd-worker-clone-no-credential-persisted` structurally
  forbids a `.git/config` credential rewrite / a credential in a log line in the clone path.
- The m35 worktree+run flow is reused verbatim — clone-on-miss is additive prefix logic, so the existing
  `acd-assignment-*` fitness functions stay green unchanged.
- The auth mechanism is a clean, separately-reviewable deferral (RESEARCH + SECURITY) that does not block pinning
  the safety structure.

---

## ADR-006: The framed `worker-worktrees` story is SUBSUMED by m35/ADR-004 — it has NO net-new work; the worker checkout story reuses `addWorktree`/`removeWorktree`/`sweepRetainedWorktrees` VERBATIM. The milestone collapses from three framed stories to TWO

**Status:** Accepted
**Date:** 2026-07-10

**Context.** The PO framed THREE story seeds (SPEC): `session-presence`, `worker-repo-checkout`, and
`worker-worktrees` ("the worker creates an isolated git worktree per assignment to execute in"). But the FULL
worktree mechanics ALREADY EXIST and ALREADY SHIP: `mesh-worktree.mjs` (35/ADR-004, task 00/03) provides
`addWorktree` (detached-at-commit `git worktree add` under the ONE `meshWorktreePath` seam), `removeWorktree`,
`listWorktrees`, `sweepRetainedWorktrees` (bounded retention ceiling), and the worker handler
(`mesh-worker-execution.mjs`) already calls `addWorktree`/`removeWorktree` in its accepted-directive flow.
Graph-confirmed: `mesh-worktree.mjs` is imported ONLY by `mesh-worker-execution.mjs` and is complete. The
`worker-worktrees` seam is a solved problem re-listed.

**Decision.**
- **`worker-worktrees` is folded away — it has zero net-new work.** After ADR-005 clones the repo and registers
  the workspace, the worker falls through to the EXISTING m35 flow, which ALREADY creates the per-assignment
  worktree via `addWorktree` and cleans up via `removeWorktree`/`sweepRetainedWorktrees`. There is nothing to
  build for "the worker creates a worktree" — it is delivered. The checkout story (`worker-repo-checkout`)
  reuses these verbs verbatim; it does not re-implement, wrap, or extend them.
- **The milestone is TWO stories, not three** (ADR-007 draws the boundary): `session-presence` and
  `worker-repo-checkout`. This is the breakdown-collapse decision, recorded so the PO creates two folders and no
  one re-opens a `worker-worktrees` scope that would only duplicate m35.

**Consequences.**
- No duplicate worktree machinery is built; the m35 seam stays the single source of worktree truth.
- The milestone's story count is honest about actual net-new work — the PO scaffolds two stories.
- `acd-worker-checkout-reuses-worktree` fails CI if the checkout path introduces a SECOND `git worktree add`
  call site outside the `mesh-worktree.mjs` `addWorktree` seam (re-arming the m35 `acd-assignment-worktree-path-
  scoped` invariant against a regression from this milestone).

---

## ADR-007: The milestone partitions into TWO independent stories along the graph's clean seam — `session-presence` (the presence dimension) and `worker-repo-checkout` (the worker-execution dimension); they touch `mesh-launcher.mjs` at DISJOINT functions and do not collide

**Status:** Accepted
**Date:** 2026-07-10

**Context.** Story boundaries should follow REAL coupling (the codebase graph), not inferred coupling, so the two
stories can be built in parallel with minimal cross-story dependency. The graph (grounding block above) shows the
presence dimension and the worker-execution dimension are cleanly separable: they touch disjoint module sets and
share only `mesh-launcher.mjs` as a distant common importer — and there they touch disjoint functions.

**Decision — the two stories:**
- **`session-presence`** — the presence dimension. Owns: the ADR-001 additive `sessions` key on
  `mesh-presence.mjs`; the ADR-002 session record + `aof session start|ping|end` CLI + TTL-reuse-of-`isStale`;
  the ADR-003 aggregation across `global_node_workspaces` (the `assembleCurrentPresenceRecord` rewrite in
  `mesh-launcher.mjs`); the ADR-004 reconciliation + UI fleet render (desktop 36 / web 25). Fixes the "always
  idle" + single-workspace-scope bug. Graph blast-radius: `mesh-presence.mjs` (imported by 9 — hence the
  additive/reuse discipline), plus a new session module + `aof session` CLI + the launcher's presence function +
  the two UIs.
- **`worker-repo-checkout`** — the worker-execution dimension. Owns: the ADR-005 clone-on-miss extension of the
  `!hasRepo` branch in `mesh-worker-execution.mjs`; the new `config.mesh.repo.cloneUrl` key + the scoped
  `meshCheckoutPath` root; the workspace-registration-after-clone; and the auth-transmission open question
  (RESEARCH + SECURITY). Reuses the m35 worktree verbs VERBATIM (ADR-006). Graph blast-radius: near-leaf —
  `mesh-worker-execution.mjs` is imported ONLY by `mesh-launcher.mjs` and imports only `mesh-worktree.mjs`.

**Where they touch `mesh-launcher.mjs` — disjoint, no collision.** Both stories edit `mesh-launcher.mjs`, but at
DISJOINT functions:
- `session-presence` rewrites `assembleCurrentPresenceRecord(ws, nodeId)` (the presence assembly, `line 71`) to
  aggregate across workspaces (ADR-003). It touches nothing in the worker-execution wiring.
- `worker-repo-checkout` changes only the `createMeshWorkerExecutionHandler(...)` collaborator wiring (the
  `workerExecution`-gated block, `line 349`) — passing the clone-location resolver/config through the existing
  injection seam. It touches nothing in the presence assembly.

These are non-overlapping edit sites in the same file; a mechanical merge of the two stories has no conflicting
hunk. The graph confirms the coupling is a distant common-importer relationship, not a shared function — so the
partition follows actual structure, not inference.

**Consequences.**
- Two stories build in parallel with a trivial, non-conflicting merge at their one shared file.
- `worker-repo-checkout` carries the ONLY blocking research/security dependency (auth transmission), isolated to
  one story so it does not gate the presence fix.
- `worker-worktrees` is folded away (ADR-006) — the partition is honest about net-new work.

---

## ADR-008: Wherever we do not own the PRODUCER — a vendor hook payload, an HTTP route, a cross-language surface — the contract test MUST be fed a REAL CAPTURED payload from that producer; and a component must be tested through the component production ACTUALLY renders. A green suite is not evidence a feature works; only a producer-fed path is

**Status:** Accepted
**Date:** 2026-07-12
**Context supersedes nothing — this ADR records the structural rule the milestone EARNED at `aof:verify 38`.**

**Context.** The m38 pipeline (hook → session record → presence aggregate) was correct, well-tested and entirely
green — and shipped **five** defects, every one of them the SAME root cause: *a component exercised against a
fixture shaped to its own convenience, never against its real producer.* The evidence:

| # | Surface (producer we do NOT own) | The convenient fixture | What production actually emitted |
|---|---|---|---|
| **F1** | the presence assembler (JS) | the fitness test fed attributed run **objects** `{ runId, workspaceId }` | a bare `string[]` of run ids — the collapse rule could never fire |
| **F4** | the **Claude Code hook** payload | the CLI read `payload.workspace` / `payload.repo`; the "wiring" test inspected a **command string** | the real hook carries **`cwd`** (RESEARCH.md §2.2 had already MEASURED this) — every real hook exited 1, no session record was ever written |
| **F6** | the **HTTP route** `/api/mesh/status` | the render test fed a hand-built presence record | the route carried **no `presence` key at all** — the card always got `{}` → always `idle` |
| **F9** | the **mounted component** | the row-3 render test drove `NodeCard` | `mesh-ui-serve.mjs` serves BOTH scopes from `queryGlobalMeshStatus`, so the payload is ALWAYS the global shape → the app ALWAYS mounts `GlobalNodePanel`, which had no current-work line. **`NodeCard` was DEAD CODE in production**, green all milestone |
| **F7/F8** | the **cross-language** desktop (Rust) | hand-written Rust fixtures | no session variant at all (F7); `activeRuns` read as **objects** via `.get("ref")` (F8 — F1's exact twin, in Rust) |

Each of these tests PASSED. Each proved only that a function agrees with a fixture its own author wrote. The
common failure is not carelessness — it is that a test author, given no captured payload, will unconsciously
invent the payload that makes the code under test look right.

**Decision.**
- **A contract test at a boundary we do not own MUST be fed a REAL CAPTURED payload from the real producer.**
  "Producer" means: a vendor/tool that calls us (an editor hook), a route/transport that carries our data, a
  store/aggregate that assembles it, or a surface in ANOTHER LANGUAGE that consumes it. If we did not write the
  emitter, we may not imagine its output.
- **Capture is a step in the work, and the fixture records HOW it was captured.** The fixture is the VERBATIM
  stdout/body of a real invocation (`aof mesh status --json`, the real hook's stdin envelope, the route's actual
  JSON response), and it carries a provenance comment naming the command, the machine and the date it was taken
  from. A fixture with no provenance is a hand-authored fixture wearing a captured fixture's clothes.
- **Where captured fixtures live.** Same-language boundaries prefer LIVE producer-fed tests over stored
  fixtures — stand the real thing up in-process (`test/mesh-fleet-presence-plumbing.test.mjs` boots the REAL
  `/api/mesh/status` server and asserts on its ACTUAL response; `acd-session-run-reconciliation` drives the REAL
  assembler over a hermetic repo). A stored capture is for the boundary a test cannot stand up: the
  cross-language surface keeps its captured payloads INSIDE the consuming crate's test module (the
  `REAL_CAPTURED_*` consts in `app/desktop/crates/core/src/view_model.rs`), where the fixture and the code it
  feeds live together and cannot drift apart unnoticed.
- **A stored capture is PINNED TO ITS PRODUCER, and CI holds it there.** `acd-captured-producer-fixture` asserts
  every captured fixture still matches a record assembled by the REAL producer in that test run (key set + key
  order, `activeRuns` a bare `string[]`, the producer's exact session keys). Producer changes shape + fixture not
  re-captured ⇒ CI fails. A frozen lie cannot survive a shape change.
- **A component must be tested through the component PRODUCTION RENDERS / INVOKES.** Before asserting on a
  component, establish — from the producer — WHICH component the real payload mounts. F9's `NodeCard` was
  perfectly correct and perfectly irrelevant. `acd-rendered-component-fed-by-route` derives the mounted branch
  from the REAL route's payload and requires EVERY per-node card renderer to carry the current-work derivation, so
  no branch of the page can host a dead feature path.
- **"Wiring" is not a contract.** A test that asserts a command STRING is well-formed (F4) proves nothing about
  the payload the vendor actually sends. Assert on the RUN of the thing, with the vendor's real envelope.
- **Corollary — a green suite is not evidence a feature works.** Only a producer-fed path is. Evidence for an
  acceptance claim must name the producer whose output fed it.

**Consequences.**
- Three new fitness functions (below): the frozen wire shape across both languages, the captured-fixture
  discipline for the cross-language surface, and the mounted-component guard. Each carries a self-check that
  plants the ORIGINAL defect (the verbatim F1/F8 lines; the pre-F9 `GlobalNodePanel`) and proves the guard trips.
- Capturing a producer payload becomes routine work at the boundary, not an afterthought at verify — the cost is
  one real invocation, paid once, versus five findings surviving a whole milestone.
- Cross-language duplication of a rule is now SAFE to accept when it is structural (ADR-004's amendment): the
  duplicated implementations are bound to one captured payload, so they cannot silently disagree.
- This rule is a candidate for the PROJECT architecture reference (it is not m38-specific — it applies to every
  vendor hook, route and non-JS surface aof will ever grow); the retrospective decides whether to lift it.

---

## ADR-009: The clone credential is **PULLED by the worker at the moment it hits a clone miss** — a request/response frame pair on the EXISTING persistent stream — never PUSHED down the directive path. The frozen five-key directive frame is NOT broken. In production the credential reaches the handler through an injected async **resolver** (`requestCloneCredential`), supplied by the launcher — NOT the static `cloneCredential` test seam

**Status:** Accepted
**Date:** 2026-07-13
**Arms the credential MECHANISM that ADR-005 explicitly deferred. Closes finding F12 (`aof:verify 38`, BLOCKER).**

**Context.**

ADR-005 pinned the clone-on-miss STRUCTURE and deliberately deferred the credential **mechanism** to
`RESEARCH.md` + `SECURITY.md`. Those landed: **RESEARCH §1 adopts A4** — `GIT_ASKPASS` pointed at a short-lived,
control-minted, **per-clone** token passed over the relay (A1's `-c http.extraHeader` and the `--config` form
persist to `.git/config`; the token-in-URL form is worst-scoped; the fallback is a deploy key +
`GIT_SSH_COMMAND`). **SECURITY T4** adopts the same default and fixes the token's shape as **per-clone**
("minted for one assignment, not reused"), **short-lived**, **single-repo-scoped**; the *minting policy* (exact
TTL, scope, control-side minting authority) is an **Accepted residual, operator-verified at `aof:verify`** — not
a code concern and not decided here. **T1/T2/T3** already pin the worker-side invariants (no credential into
`.git/config`, none onto ambient `process.env`, none into logs) and are fitness-guarded by
`acd-worker-clone-no-credential-persisted`.

What NOBODY specified is the one thing that actually blocks the feature: **by what channel does the token get
from the control node to the worker?** Story 01 built the entire `GIT_ASKPASS` consumer — the shim, the scoped
per-invocation env, the redaction — and it works. But:

- `mesh-worker-execution.mjs:356` — `const credential = options.cloneCredential ?? null;`
- the source itself documents `cloneCredential` as *"a fake token string **(tests only)** … absent for a
  public-repo clone"*;
- the **only** production constructor, `mesh-launcher.mjs:485`, builds the handler with
  `{ loadWs, nodeId, sendAssignmentStatus, now, ...(options?.workerExecutionOptions ?? {}) }` — and
  `workerExecutionOptions` is a documented **test-injection** seam. `aof mesh serve --serve` passes none.

So `cloneCredential` is **always `null` in production**, and the shipped worker can clone only a **PUBLIC** repo.
**SPEC objective (b)** — *"the worker clones it (from a configured location, with auth)"* for a **private** repo —
cannot be met by the shipped code. Every `@executable` test is green because every one of them **injects a fake
token** and asserts what the code does *with* one. **Nobody asked where the credential comes from.**

**This is the SEVENTH instance of this milestone's defect class, and ADR-008 named it exactly:** *a component
validated against a fixture, never against its real producer.* F1/F4/F6/F7/F8/F9 were payload-shaped instances
(the test author invents the payload that makes the code look right); **F12 is the same failure at the WIRING
seam** — the test author injects the collaborator that makes the code look right, and never asks whether the real
producer supplies it. ADR-008's corollary applies verbatim: *a green suite is not evidence a feature works; only
a producer-fed path is.* Here the producer is the **launcher**, and it produces nothing.

**The constraint that makes the channel a real decision.** The directive down-frame is a **FROZEN, fitness-pinned
shape** (35/ADR-002): `buildDirectiveFrame` returns *"a pure projection — exactly five keys"*
`{ kind, to, assignmentId, itemRef, workspaceId, at }` (`control-stream-server.mjs:240`), guarded by
`test/mesh-directive-down-frame.test.mjs` and the `test/arch/acd-directive-*` family.

**The graph fact that decides it.** `aof graph impact` (built fresh at this decision: 1845 nodes / 4722 edges;
egress none) reports `mesh-launcher.mjs` is the **SOLE importer** of all three seams —
`control-stream-server.mjs` (with `mesh-assignment-reclaim.mjs`), `worker-stream-client.mjs` (sole), and
`mesh-worker-execution.mjs` (sole) — so there is exactly **ONE** production wiring site to fix, and
`worker-stream-client.mjs` has **ZERO outbound edges** (a pure transport leaf, which must stay one: it may carry
a credential frame, never resolve or mint a credential). Actual structure, not inference.

**And the fact that kills every PUSH design.** The predicate that decides *"is a clone even needed?"* is
`workerHasRepo` = the worker's own on-disk `mesh.repo.published` marker JOINed with its own
`global_node_workspaces` row. The source states the asymmetry outright
(`mesh-worker-execution.mjs:149-152`): *"Unlike the control-side gate (which **has no filesystem access to a
remote worker's config** and must proxy via `global_node_workspaces` + `workspaces.last_published_at`), the
WORKER-side check reads its OWN local marker AND its OWN local registry table directly."* **Control cannot know
whether a directive will clone.** Therefore any push design must mint and transmit the token **speculatively, on
every directive** — which is **per-directive, not per-clone**, and per-clone is precisely what SECURITY T4
*requires*. The overwhelming majority of directives never clone (a worker normally already holds the repo), so a
push pays the maximum exposure for a benefit it takes on ~none of them.

**Decision.**

- **PULL, not push. The worker REQUESTS a clone credential from control at the moment it actually hits a clone
  miss** — a request/response frame pair on the ALREADY-OPEN persistent stream, immediately before
  `cloneRepoForWorkspace`. No secret crosses the wire for any directive that does not clone.
- **A NEW frame-kind PAIR — the frozen directive frame is untouched.** Both channels already dispatch by
  `frame.kind` and both ignore an unknown kind, so this is purely **additive**:
  - **up** (worker → control): `{ kind: "clone-credential-request", nodeId, assignmentId, workspaceId, at }` —
    a new builder in `worker-stream-client.mjs` beside `buildAssignmentStatusFrame`, sent through the SAME
    `sendFrame` failure-isolation seam; a new branch in `applyStreamFrame`'s kind-dispatch
    (`control-stream-server.mjs:201`).
  - **down** (control → worker): `{ kind: "clone-credential", to, assignmentId, credential, at }` — routed
    through the SAME `sendDirective` targeting map. The worker's receive listener
    (`handleTransportMessage`, `worker-stream-client.mjs:125`) today early-returns on any
    `frame.kind !== "directive"`; it gains ONE sibling branch resolving the pending request for that
    `assignmentId`.
  - `buildDirectiveFrame` **keeps exactly its five keys**. **35/ADR-002 is NOT broken, and no frozen-frame test
    changes** — the credential rides its own kind. (Had the decision been (a), this ADR would have had to
    supersede 35/ADR-002 and re-baseline `test/mesh-directive-down-frame.test.mjs`. It does not.)
- **Control AUTHORIZES the mint with the check it ALREADY has.** The request is honoured only if the requesting
  **connection's authenticated `nodeId`** is the assignment's **holder** — the identical `target_node_id ===
  connectionNodeId` test `applyAssignmentStatusFrame` already applies (SECURITY T6,
  `control-stream-server.mjs:188`), never a self-reported `frame.nodeId`. A worker can therefore only ever obtain
  a credential for an assignment **it actually holds**, for **that assignment's** `workspaceId`. This is the
  authorization a push design cannot express at all (control-initiated, so there is no requester to authorize).
- **The mint is per-clone by CONSTRUCTION, and the token is opaque to the worker.** Control mints on the request
  (the `mintCloneCredential(workspaceId, assignmentId)` seam — injected, exactly like every other collaborator on
  this daemon; its TTL/scope/authority is T4's Accepted operator-verified residual, NOT a code concern). The
  worker **only CONSUMES** the token (SECURITY T4, verbatim: *"the worker only CONSUMES a token; it cannot verify
  the token's server-side scope"*) — it never parses, stores, caches, or reuses it. It goes straight into the
  existing `GIT_ASKPASS` shim (RESEARCH §1/A4) and the shim directory is removed in the existing `finally`.
- **THE PRODUCTION WIRING — named explicitly, because its omission IS F12.** The handler's credential
  collaborator changes from a **static value** to an **async per-clone RESOLVER**:
  - `createMeshWorkerExecutionHandler` **DELETES** the `cloneCredential` option and takes
    **`requestCloneCredential({ assignmentId, workspaceId, cloneUrl })` → `Promise<string|null>`** in its place.
    `cloneRepoForWorkspace` calls it **on the clone-miss path only**, and passes the resolved value into the
    per-invocation `GIT_ASKPASS` env exactly as today.
  - `mesh-launcher.mjs` (the `workerExecution !== false` block, **:485**) supplies it as a **LITERAL key in the
    `createHandler({...})` argument — BEFORE, and OUTSIDE, the `...(options?.workerExecutionOptions ?? {})`
    spread**: `requestCloneCredential: (request) => client.requestCloneCredential(request)`, closing over the
    worker's own stream client. A test may still OVERRIDE it through the spread (that seam keeps working); it may
    no longer be the ONLY way to reach it. *A collaborator whose sole supplier is the test-injection seam is
    production-dead — that sentence is F12.*
  - The resolver is **type-shaped to the invariant**: a static string on the options is per-handler (one per
    worker **process**) and cannot be per-clone; an async resolver called from the miss path can only be
    per-clone. **The seam's TYPE enforces SECURITY T4**, rather than a comment asking politely.
- **Failure is LOUD, never a hang.** A credential request that is refused, errors, or does not answer within a
  bounded wait resolves to the EXISTING coded `assignment-repo-unavailable` `failed` — the posture ADR-005
  already fixed for an unresolvable clone source. A worker never blocks forever waiting on a token, and a
  **public** repo still clones with **no** request issued (resolver returns `null` → no `GIT_ASKPASS`, byte-identical
  to today's public path).
- **`worker-stream-client.mjs` stays a pure transport leaf** (zero outbound edges, per the graph). It carries the
  credential frame; it never mints, resolves, persists, or logs one.

**Alternatives rejected.**

- **(a) Add a credential key to the directive frame.** *Rejected — worst on every axis.* It **breaks a frozen,
  fitness-pinned contract** (35/ADR-002's "exactly five keys") and would force a re-baseline of
  `test/mesh-directive-down-frame.test.mjs` + the `acd-directive-*` family. It puts a **secret on EVERY
  directive**, including the ~all that need no clone — the **broadest exposure surface for the least benefit**.
  It is **per-directive, not per-clone** (violates SECURITY T4 head-on). Blast radius: any log/trace of a routine
  directive frame now leaks a live token, and a compromised worker harvests a token per assignment whether or not
  it ever needed one.
- **(b) A separate credential frame PUSHED alongside/before each directive.** *Rejected — it fixes only the
  cosmetic half of (a).* It preserves the frozen frame (good), but the secret **still crosses the wire on every
  directive**, because — the decisive graph/source fact above — **control cannot read the worker's local
  `mesh.repo.published` marker and therefore cannot know a clone is needed**. It must mint speculatively for every
  dispatch: still per-directive, still violating T4's "per-clone, minted for one assignment, not reused", still
  the same blast radius as (a) minus the contract break. It also mints tokens that are, in the common case,
  **never used** — pure exposure for zero benefit. Marginally simpler than (c) (no round-trip); not simpler enough
  to buy a permanent, unnecessary secret-on-the-wire.
- **(c) PULL — ADOPTED.** A secret crosses the wire **only on an actual clone miss** (rare: once per
  `(worker, workspace)`, at first assignment). It is **per-clone by construction** — the mint is *caused by* the
  clone, which is exactly RESEARCH §1/A4's and SECURITY T4's specification ("per-clone… minted for one
  assignment, not reused"), not merely compatible with it. The frozen frame is untouched. It is the **only** shape
  in which control can *authorize* the mint (the holder check it already has). If a directive frame is logged, it
  contains **no secret**; a compromised worker can obtain a token only for an assignment it **already holds** and
  only when it genuinely lacks the repo. **Costs:** one round-trip on the (rare) clone path, one new frame pair,
  and a pending-request correlation + bounded wait on the worker. Both channels already kind-dispatch and already
  ignore unknown kinds, so the cost is additive and small — and it is paid on the *miss* path, which is already
  doing a full `git clone`, where a round-trip is noise.
- **(d) Deploy key + `GIT_SSH_COMMAND` (RESEARCH's own fallback).** *Not chosen as the default, deliberately kept
  as the documented fallback.* No secret crosses the relay at all — but the cost is a **durable, standing
  credential at rest on every worker** (RESEARCH §1.1: "permanently present"), which is a strictly worse T4 blast
  radius than a short-lived per-clone token, and it needs the out-of-scope secrets-vault story to manage rotation
  (SECURITY R2). It remains correct for a repo host where control cannot mint an HTTP token; the resolver seam
  above accommodates it without re-deciding this ADR (a resolver that returns `null` while a
  `GIT_SSH_COMMAND` deploy key does the work).

**Structural invariants (each testable; armed by `acd-clone-credential-pull-not-pushed`).**

1. **The directive frame stays the frozen five.** `buildDirectiveFrame` returns EXACTLY
   `[kind, to, assignmentId, itemRef, workspaceId, at]`, order-sensitive; a caller that passes a credential to it
   gets nothing on the frame. (35/ADR-002 preserved.)
2. **No credential is minted or sent on the directive dispatch path.** `buildDirectiveFrame` /
   `sendDirective` / `dispatchDirectiveOverTargets` name no credential/token/secret at all — structurally
   forbidding both (a) and (b).
3. **No credential collaborator may be reachable ONLY through the test-injection seam.** Every credential-shaped
   option `createMeshWorkerExecutionHandler` consumes must appear as a **literal key** at the production
   `createHandler({...})` call site in `mesh-launcher.mjs` — not merely inside
   `...(options?.workerExecutionOptions ?? {})`. **This is the F12 detector**, and it is ADR-008's rule applied to
   wiring rather than payloads.
4. **The production credential path is never a STATIC value.** The launcher must never pass a static credential
   option (e.g. `cloneCredential: <token>`); the credential is obtained per-clone through an async resolver.
   (SECURITY T4 "per-clone", enforced by the shape of the seam.)
5. **Inherited and still armed (SECURITY T1/T2/T3, `acd-worker-clone-no-credential-persisted`):** the credential
   is never persisted into `.git/config`, never assigned onto ambient `process.env` (so the spawned agent child
   cannot inherit it), never logged. The new control-side request handler is held to the same no-logging rule.

**Consequences.**

- **The feature can actually work in production.** A private-repo clone is possible for the first time: the
  launcher supplies a real resolver, so `GIT_ASKPASS` receives a real token. The machinery story 01 built stops
  being production-dead.
- **A secret crosses the wire rarely and narrowly** — only on a genuine clone miss, only to the holder of the
  assignment, only for that assignment's workspace, and only for as long as the mint's TTL allows.
- **No frozen contract is broken.** 35/ADR-002's directive frame is byte-for-byte unchanged; the existing frame
  tests (`test/mesh-directive-down-frame.test.mjs`, `test/arch/acd-directive-*`) need **no update** — an explicit
  outcome of choosing (c), and the main reason it beats (a).
- **A round-trip is added to the clone-miss path** (only). The worker needs a pending-request correlation keyed by
  `assignmentId` and a bounded wait; a timeout is the existing loud `assignment-repo-unavailable` failure, never a
  hang.
- **Public repos are unaffected** — the resolver returns `null`, no request is sent, and the clone runs with no
  `GIT_ASKPASS` exactly as today.
- **T4's minting policy stays an operator-verified residual** — this ADR chooses the CHANNEL and the seam
  (`mintCloneCredential`), never the TTL/scope/authority. No fitness function asserts a server-side minting
  policy (SECURITY, verbatim).
- **ADR-008's rule now has teeth at the wiring seam, not just the payload seam.** F12 proves "fed by its real
  producer" is not only about *payload shape* — a collaborator can be fixture-fed too. Invariant 3 generalises:
  a green suite that injects its own collaborator proves nothing about production. This is a strong candidate to
  lift into the project architecture reference alongside ADR-008; the retrospective decides.

---

## ADR-010: The `mintCloneCredential` seam becomes a **config-selected credential-mint PROVIDER** — `env-token` (default, byte-unchanged) | `github-app` (new). The provider is resolved from `config.mesh.repo.credential.provider` and passed as a LITERAL key at the ONE production wiring site; the `github-app` provider signs the App JWT with `node:crypto`, resolves owner/repo from a CONTROL-trusted source (never the worker's frame), and exchanges a single-repo `contents:read` installation token — a fault THROWS, never a silent fallback. The askpass shim becomes prompt-aware.

**Status:** Accepted
**Date:** 2026-07-13
**Arms story 02 (`clone-credential-mint`). Changes only what the ADR-009 `mintCloneCredential(workspaceId, assignmentId)` seam RETURNS — the F15/F16/T6 gates that PRECEDE the mint are UNCHANGED and reused verbatim. Does NOT re-open ADR-009's PULL channel. Builds on RESEARCH §3 and SECURITY T8–T11 / F5 / F6.**

**Codebase-graph grounding (built fresh at this decision).** `aof graph build src` → 1849 nodes / 4662 edges / 82 communities, `builtAt` this session (egress: none). `aof graph impact src/control-stream-server.mjs src/mesh-worker-execution.mjs`:
- `control-stream-server.mjs` — **imported/called by ← 2** (`mesh-launcher.mjs`, `mesh-assignment-reclaim.mjs`); imports → 4 (`assignment-record`, `global-node-registry`, `global-work-store`, `mesh-presence`). **UPDATE to ADR-009's "single dependent" note:** the graph reports TWO inbound edges, but the second is a **comment/reference edge, not an import** — `mesh-assignment-reclaim.mjs` explicitly does NOT import the module (verified at source, `:147`: *"…so this module does not import that module…"*). The ONLY caller of `startControlStreamServer` (hence the ONLY production injection site for `mintCloneCredential`) is `mesh-launcher.mjs:419-434`. So the mint-seam's production-wiring blast-radius is exactly **one module** — this is the actual structure the provider selection wires into, and the same single-site fact ADR-009's F12 fix relied on.
- `mesh-worker-execution.mjs` — **imported/called by ← 1** (`mesh-launcher.mjs`, sole); imports → 7. Near-leaf, as ADR-005/007 found. The prompt-aware `buildAskpassShim` change (below) therefore has a blast-radius of one importer.
- **Verified-at-source graph fact that shapes Gap A:** the worker's request up-frame `buildCloneCredentialRequestFrame(nodeId, assignmentId, workspaceId, now)` (`worker-stream-client.mjs:71`) carries **no `cloneUrl`**, and the client's `requestCloneCredential({ assignmentId, workspaceId })` (`:298`) **drops** the `cloneUrl` that `cloneRepoForWorkspace` passes into the resolver — so the control node NEVER receives a worker-supplied clone URL. This is not incidental: it is the F15 posture (the requester must not steer the mint's repo scope). The mint's repo must be resolved control-side.

The graph is one input; the decisions below are the architect's call.

**Context.**

ADR-009 armed the credential CHANNEL (PULL on a clone miss) and left the mint SOURCE an injected seam whose default (`defaultMintCloneCredential`, `control-stream-server.mjs:213`) reads a single standing `process.env.AOF_MESH_CLONE_TOKEN`. SECURITY T4 flagged that default as a bootstrap only: its scope/TTL are not worker-assertable, so the operator ATTESTS them at every soak (R4), and a multi-repo fleet needs one hand-made PAT per repo. Story 02 replaces that attestation with an **automated, config-selected provider** that produces T4-compliant tokens **by construction**. RESEARCH §3 measured the whole mint flow on this machine:

- **§3.1** — `node:crypto` alone signs a spec-compliant RS256 App JWT (≤10-min `exp`, `iat` backdated 60s), and GitHub's real backend parses it as well-formed (a `404 "Integration not found"` for a fake App id, not a `401`). PKCS#1 (`BEGIN RSA PRIVATE KEY`, GitHub's download format) and PKCS#8 both sign directly, no conversion. Native `fetch` is present (Node 22). **Zero new dependencies** — no `jsonwebtoken`/`jose`/octokit.
- **§3.2/§3.3** — mint = App JWT → `POST /app/installations/{id}/access_tokens` with `{ repositories: [repo], permissions: { contents: "read" } }` → a ~1h token; `installation_id` via `GET /repos/{owner}/{repo}/installation` (App-JWT auth; `404` when the App is not installed on the repo). Over-scope is **rejected, never silently widened**. `installation_id` is NOT stable across an uninstall/reinstall (a hard-coded id can go silently stale).
- **§3.4 (⚠)** — the existing shim sends `username == password == token` (measured on the wire), NOT the documented `x-access-token`. Whether GitHub accepts that shape for an **App installation** token is INFERRED (PAT-doc + community corroboration), not the guarantee GitHub's App docs make. Git passes distinguishing prompt text to askpass (`"Username for…"` vs `"Password for…"`), so a prompt-aware shim is cheap and mechanical.
- **§3.5** — `mintCloneCredential(workspaceId, assignmentId)` is never handed a `cloneUrl`; nothing threads a `workspaceId → owner/repo` map into the mint; GHES's API base is `HOSTNAME/api/v3`, not `api.github.com`.
- **§3 (measured budget)** — `DEFAULT_CLONE_CREDENTIAL_TIMEOUT_MS = 15000` (`worker-stream-client.mjs:79`) bounds the WHOLE round-trip incl. the relay hop; `applyCloneCredentialRequestFrame` adds no inner timeout, so the mint's external calls run inside that 15s.

SECURITY threat-modelled the new surface as **T8** (the App private key at rest — the largest single blast radius), **T9/F6** (over-scoped mint — the code-enforced closure of T4), **T10** (no silent fallback on a mint fault), **T11** (~1h token / ≤10-min JWT window + the `x-access-token` dependency the architect must reconcile). The two security fitness functions **F5** (`acd-clone-app-key-not-relayed`) and **F6** (`acd-minted-token-scoped-single-repo`) are SPEC-only, armed at build against the real provider module — SECURITY deferred them deliberately (a detector against an absent module is vacuous). This ADR must be consistent with all of that.

**Decision.**

**1 — The provider abstraction at the `mintCloneCredential` seam (config-selected).**
- A NEW selector seam, **`resolveCloneCredentialProvider(config, deps)`** (exported from the new provider module below), reads **`config.mesh.repo.credential.provider`** via the RAW optional-chain idiom (the m22 story-01 lesson, ADR-005 — NOT the config-editor whitelist, which would drop unknown sibling mesh keys on rewrite) and returns a `mintCloneCredential(workspaceId, assignmentId)` closure:
  - `"env-token"` (default when absent) → the EXISTING `defaultMintCloneCredential`, **byte-unchanged** (reads `AOF_MESH_CLONE_TOKEN`, `null` when absent — the public-repo reply).
  - `"github-app"` → `createGithubAppMintProvider({...deps})` (below).
  - PRESENT-but-unknown provider string → a **LOUD throw at startup** (a misconfiguration surfaced, never a silent degrade to `env-token` — the T10 no-silent-fallback rule applied to selection itself). Absent config → `env-token` (backward compatible).
- **Where it is resolved and injected — the ONE production wiring site (the F12 discipline, verbatim).** `mesh-launcher.mjs` (the `role === "control"` block, `:427-434`) calls `resolveCloneCredentialProvider(config, deps)` and passes the result as a **LITERAL `mintCloneCredential:` key in the `startServer({...})` argument — BEFORE, and OUTSIDE, the `...(options?.controlStreamServerOptions ?? {})` test-injection spread.** A test may still OVERRIDE it through the spread (that seam keeps working); it may no longer be the ONLY way to reach a provider. *A provider whose sole supplier is the test-injection seam is production-dead — that sentence is F12; ADR-009 invariant 3 generalises to the provider here.* The `startControlStreamServer` signature is UNCHANGED — `mintCloneCredential` is already an injectable parameter (`control-stream-server.mjs:557`); story 02 changes only WHAT the launcher passes into it, not the seam.
- **`control-stream-server.mjs` gains no `config` dependency.** It stays transport-pure (it has none today). The provider is resolved at the launcher (where `config` lives) and handed down as an already-built closure — consistent with every other collaborator on this daemon.

**2 — Gap A: how the `github-app` provider resolves `workspaceId → owner/repo` (control-trusted, never the worker's frame).**
- The provider closes over an injected **`resolveWorkspaceCloneUrl(workspaceId) → string|null`** seam supplied by the launcher. Its SOURCE OF TRUTH is the **control node's own committed workspace config** — the SAME fleet-shared, committed `config.mesh.repo.cloneUrl` key ADR-005 established and SECURITY T5(a) trusts — resolved per-workspace through the ADR-003 descriptor seam (`global_workspace_descriptors` → `descriptor_path` → `loadWorkspace` → the EXISTING `resolveCloneUrl(ws)` reader), with the control's OWN launch workspace as the single-repo/bootstrap fallback. **No new config shape, no new store table** — it reuses the descriptor-resolution seam ADR-003 already sanctioned and the `resolveCloneUrl` reader ADR-005 already ships.
- **The seam signature `mintCloneCredential(workspaceId, assignmentId)` STAYS byte-identical.** I considered extending it to also receive a `cloneUrl` (option: `mint(workspaceId, assignmentId, { cloneUrl })`) and REJECTED it: the frame handler has no trusted cloneUrl to pass — the worker's cloneUrl is dropped at the client boundary (graph fact above) and MUST be, or F15 re-opens (the requester steers the repo). Threading a cloneUrl through the seam would force the frame handler to ALSO resolve it control-side, duplicating the provider's own resolution. Cleaner: the provider OWNS its resolution via the injected `resolveWorkspaceCloneUrl` closure, keyed by the `workspaceId` the frame handler ALREADY F15-binds to `existing.workspace_id` before the mint is reached (`control-stream-server.mjs:316,332`). So the worker-supplied text NEVER steers the mint's repo scope — the provider re-arms F15's posture at its own layer.
- **The parse.** A new exported **`parseRepoFromCloneUrl(cloneUrl) → { host, owner, repo, apiBaseUrl } | null`** in `mesh-worker-execution.mjs` LAYERS ON `isWellFormedCloneUrl`'s acceptance surface (the measured parser, §3.5): handles `https://`, `ssh://`, scp-style `git@host:owner/repo(.git)`, trailing-slash/`.git`/query/hash, lower-cases only the host (never the path — §3.5). It applies the host→API-base RULE — `github.com` → `https://api.github.com`; anything else → `https://<host>/api/v3` (GHES convention, §3.5) — with an OPTIONAL `config.mesh.repo.credential.githubApp.apiBaseUrl` override for a GHES instance whose API host/port differs (use `url.host`, incl. port, not `url.hostname`). A `< 2`-segment URL parses to `null` → the provider THROWS (never a guess).

**3 — Gap B: installation-id — AUTO-RESOLVE on demand (default), with an optional explicit override.**
- **Recommend: auto-resolve** via `GET /repos/{owner}/{repo}/installation` (App-JWT auth), then `POST …/access_tokens`. Judged against the 15s budget (§3, `worker-stream-client.mjs:79`): two sequential `api.github.com` round-trips (each typically ≤~0.5s) plus a local/instant JWT sign fit inside 15s with ample headroom even after the relay hop. Auto-resolve is **self-healing** (no silent staleness on an uninstall/reinstall, §3.3/#13) and matches AC 6 — *"onboarding a NEW private repo needs only the App installed + its cloneUrl configured"* — i.e. NO installation-id to hand-configure.
- **Fallback (the escape hatch):** an OPTIONAL **`config.mesh.repo.credential.githubApp.installationId`** short-circuits the resolve call (one fewer round-trip) for a latency-sensitive setup, at the operator's own staleness risk (§3.3). Absent → auto-resolve.

**4 — The `x-access-token` reconciliation: make the shim PROMPT-AWARE now.**
- **Decision: `buildAskpassShim` becomes prompt-aware** — it answers the **Username** prompt with the literal **`x-access-token`** (a public constant, not a secret) and the **Password** prompt with the token. Justification: §3.4 measured the fix is cheap and mechanical (git supplies the distinguishing prompt text to askpass as argv); GitHub's App docs GUARANTEE the `x-access-token` form, whereas the current same-value shim rests on INFERRED, community-corroborated-but-undocumented leniency a vendor could tighten server-side without notice. Building on the documented contract RETIRES the residual risk rather than betting on it. This also satisfies SECURITY T11's dependency clause exactly: the token is emitted **only** on the Password prompt, **never** as the username (which would place the secret in a second field / the URL git constructs — a T1/T3 re-exposure).
- **Story 02 additively touches `buildAskpassShim`** (`mesh-worker-execution.mjs:262`): the generated shim must forward git's prompt argv (`%*` / `$*`) to the helper, and the helper inspects it — prompt starts with `"Username"` → write `x-access-token`; otherwise (Password) → write the scoped token file. The token still lives ONLY in the one-shot scoped file, never `.git/config` / clone argv / `process.env` / a log — so story-01's **F2 (`acd-worker-clone-no-credential-persisted`) stays green** (the `x-access-token` username is a constant; the token's handling is unchanged in every axis F2 pins).
- **Provider-agnostic bonus:** `x-access-token` is a non-blank username, which GitHub's PAT docs guarantee works for a PAT too (username ignored, only non-blank required) — so the prompt-aware shim serves BOTH the retained `env-token` PAT path AND the `github-app` installation-token path; the retained default is not broken, it is made more correct.

**5 — Composition with the authorization gates (T6/F15/F16 unchanged) and loud failure (T10).**
- The provider is invoked ONLY after `applyCloneCredentialRequestFrame`'s holder (T6), workspace-match (F15, `!==` on `existing.workspace_id`), and active-state (F16, `isActiveAssignmentState`) gates pass — **UNCHANGED, reused verbatim** (`control-stream-server.mjs:303-327`). Story 02 swaps only the mint IMPLEMENTATION behind them.
- **A `github-app` provider fault THROWS** — App not installed on the repo, key invalid/mis-parsed, GitHub unreachable, JWT rejected, `403`, installation-not-found, an unresolvable/`<2`-segment cloneUrl. The EXISTING frame-handler `try/catch` (`:331-335`) already converts any throw into the loud coded **`clone-credential-mint-failed`**, which the worker resolver turns into the existing loud coded **`assignment-repo-unavailable`** `failed`. **Story 02 adds NO new failure path — it inherits ADR-009's.** Its only new obligations: (i) the `github-app` provider THROWS on fault, **never returns `null`** (a `null` return is reserved for the `env-token` "no credential configured" public-repo case; a `github-app` provider is selected precisely BECAUSE the repo is private, so it must never emit `null` for a fault); and (ii) the SELECTOR must **never** fall through to `env-token` on a `github-app` fault (that would hand out the broad standing PAT — T10's exact attack). Together with the T7/F14 `GIT_TERMINAL_PROMPT=0` + `credential.helper=` control (already shipped), a mint fault becomes a LOUD failure, never a silent broad/unauthenticated clone.

**6 — Structural invariants (each testable).**
1. **The provider is config-resolved and literally wired (F7, this ADR).** `resolveCloneCredentialProvider` selects on `config.mesh.repo.credential.provider`; no single hard-coded provider; the launcher passes the result as a LITERAL `mintCloneCredential:` key at the production `startServer({...})` site (before/outside the `controlStreamServerOptions` test spread — the F12 shape). Absent → `env-token`, byte-identical to today; present-but-unknown → loud startup throw, never a silent `env-token` fallback.
2. **The App private key flows ONLY into the JWT signer (F5, security-owned — SECURITY spec, armed at build).** The key (PEM / configured material) reaches NO frame builder (`buildCloneCredentialFrame` / `sendDirective` / `ws.send`), NO `console.*`/`logger.*`/`warn`/`onWarning`/`Error(...)` sink — only `node:crypto` `createSign`/`sign`. Extends F4 (the minted token) to the KEY and the mint-time App JWT (T8/T11).
3. **The mint request names EXACTLY the one assigned repo + `contents:read` (F6, security-owned — SECURITY spec, armed at build).** A single-element `repositories`/`repository_ids` derived from the mint's `workspaceId` arg (never omitted, never `>1`), and `permissions` deep-equals `{ contents: "read" }` (never omitted, never `write`, never broader). The code-enforced closure of T4.
4. **Owner/repo is control-trusted, keyed by `existing.workspace_id` — never the worker's frame.** The provider parses owner/repo from `resolveWorkspaceCloneUrl(workspaceId)` (control-side committed config), never from any worker-supplied cloneUrl (dropped at the client boundary; re-arms F15).
5. **A `github-app` fault THROWS (T10).** Never a `null`-on-fault, never a selector fall-through to `env-token`; the throw rides ADR-009's existing `clone-credential-mint-failed` → `assignment-repo-unavailable` path.
6. **The shim is prompt-aware and F2-preserving (T11).** Username → `x-access-token`, Password → token; the token never becomes the username; the token stays only in the scoped one-shot (F2 green).
7. **@executable tests inject the HTTP / sign / key seams + a FAKE key; the real GitHub mint is the `@manual` soak (ADR-008).** The provider is testable against a captured/faked producer; no `@executable` test ever hits a real `api.github.com` or holds a real key.

**Fitness functions (specified here; authored where non-vacuous TODAY, deferred to build otherwise).**
- **`acd-clone-credential-provider-config-driven` (F7 — this ADR; architect/developer-owned) — SPEC, armed at BUILD.** Invariant: #1 above. Plant strategy (the milestone's non-vacuity discipline, verbatim — synthesized snippets joined with explicit `"\n"` for the CRLF tree, the real source asserted clean under the detector FIRST, each plant asserted to DIFFER from its clean baseline before asserting the trip): plants that MUST trip — (1) a hard-coded single provider (the selector ignores config and always returns the `github-app` or always the `env-token` provider); (2) the F12 shape — `mintCloneCredential` reachable ONLY through the `controlStreamServerOptions` test spread, with no literal key at the production call site; (3) a `github-app`-fault catch that silently returns `defaultMintCloneCredential` (the T10 fall-through); (4) a mutation of the `env-token` default so the unconfigured path is no longer byte-identical (reads a different env var / hard-codes a token). Negative control that MUST stay clean: the config-driven selector returning `env-token` when unconfigured and `github-app` when configured, passed as a literal key at the production site. **DEFERRED to build, deliberately, consistent with SECURITY's F5/F6 deferral (ADR-008's hard lesson):** the config-driven selection wiring (`resolveCloneCredentialProvider` + the literal-key call-site + the launcher's provider-selection block) does NOT exist yet (story `not-started`); a detector authored now would either scan an absent call-site shape (a **vacuous** real-tree assertion — the very failure this milestone earned its lesson on) or go RED against a shape that is not built. The detector's DESIGN is tied to the real call-site's structure, which cannot be finalised against absent source. Armed at build against the real wiring, with the plant strategy above.
- **`acd-clone-app-key-not-relayed` (F5) + `acd-minted-token-scoped-single-repo` (F6) — SECURITY-OWNED, SPEC, armed at BUILD.** This ADR does NOT duplicate them; it states the invariants (#2, #3 above) the provider must satisfy so F5/F6 can fail CI on drift. SECURITY.md §"Security fitness functions" carries their full plant strategy. They are deferred for the identical reason (the `github-app` provider module does not exist yet).
- **No arch-test is authored under `test/arch/` by this ADR** — every fitness function it touches (F5, F6, F7) genuinely needs the not-yet-existing provider-selection / provider-module source to be non-vacuous. Authoring a vacuous file "just to have one" is the exact anti-pattern this milestone (ADR-008) exists to forbid. All three are SPEC'd here + in SECURITY.md and armed at build.

**Alternatives rejected.**
- **Resolve the provider inside `control-stream-server.mjs` (grow `defaultMintCloneCredential` into a selector).** *Rejected.* The module is transport-pure and has no `config` today; the mint seam receives only `(workspaceId, assignmentId)`. Adding a `config` dependency there (and a provider switch) couples transport to policy and gives F7 a worse detector target. Resolving at the launcher (where `config` already lives, and the ONE production wiring site sits per the graph) is cleaner and F12-consistent.
- **Extend the seam to `mint(workspaceId, assignmentId, { cloneUrl })`.** *Rejected — decision 2.* The frame handler has no trusted cloneUrl to pass (the worker's is dropped and MUST be, per F15); threading one would duplicate the provider's own control-side resolution and widen the seam for no gain. The provider owns its resolution via `resolveWorkspaceCloneUrl`.
- **Configure the installation-id explicitly as the default.** *Rejected as default (kept as an optional override) — decision 3.* It saves one round-trip the 15s budget does not need, at the cost of silent staleness on an uninstall/reinstall (§3.3) and an extra hand-configured value that contradicts AC 6's "App installed + cloneUrl only". Auto-resolve is self-healing and fits the budget.
- **Rely on the current same-value shim (username == token) with the `@manual` soak as the only proof.** *Rejected — decision 4.* §3.4 shows the leniency is undocumented for App tokens (a vendor could tighten it); the prompt-aware fix is cheap, mechanical, uses the GUARANTEED contract, and serves the retained PAT path too. Betting a shipped feature on undocumented server behaviour when the documented path costs a few lines is the wrong trade.
- **Fall back to `env-token` on a `github-app` fault (or return `null`).** *Rejected — T10, decision 5.* A silent fall-through hands out the broad standing PAT; a `null` masks a private-repo misconfiguration as a public clone. A fault THROWS into ADR-009's existing loud coded refusal.

**Consequences.**
- **T4's minting-policy residual is CLOSED for the `github-app` path (the SECURITY swap).** The minted token's single-repo scope + `contents:read` + ~1h TTL move from operator attestation (R4) to code + GitHub construction (F6 + T11). What stays human is the NARROWER, one-off attestation that the App itself is installed least-privilege and its key stored file-perm-protected (T8/R7) — a GitHub-console + control-filesystem fact no test can see.
- **Onboarding a new private repo needs only the App installed on it + its `cloneUrl` configured** (AC 6) — no per-repo PAT, no per-worker secret, no installation-id.
- **The `env-token` default is byte-unchanged** when unconfigured — every existing test and the single-repo bootstrap fleet keep working; the retained path still carries its R4 attestation when selected.
- **No new dependency** — `node:crypto` + native `fetch` (§3.1). **Zero seam-signature change** — `mintCloneCredential(workspaceId, assignmentId)` and `startControlStreamServer`'s injectable parameter are untouched; the change is additive (a new provider module + selector, a launcher literal-key wiring, an additive `parseRepoFromCloneUrl`, a prompt-aware `buildAskpassShim`).
- **The App private key is the largest single blast radius in the model (T8)** — this ADR pins that it flows ONLY into the JWT signer (F5), never a frame/log/error, and lives only on the control node at a file-perm-protected path resolved via raw optional-chain, never a committed config value.
- **The prompt-aware shim change is worker-side** (`mesh-worker-execution.mjs`), touching story-01's F2 surface additively; F2 stays green.
- **F5/F6/F7 are armed at build, not now** — consistent with the milestone's ADR-008 lesson that a detector against absent production source is vacuous. The `@executable` provider tests inject HTTP/sign/key seams + a FAKE key; the real GitHub mint is the `@manual` soak.

**Known limitation — ONE App identity per control node (surfaced `2026-07-16`, during `aof:verify 38`'s
live soak provisioning; not built, scoped as future work).** Gap A (decision 2) makes `cloneUrl`
resolution per-workspace — a repo in any org resolves correctly via each workspace's own committed
config. The App **identity** does not get the same treatment: `appId` / `privateKeyPath` /
`installationId` are read ONCE, from the CONTROL NODE'S OWN config, at `resolveCloneCredentialProvider`'s
single call site (`mesh-launcher.mjs:508-513`) — not per other-workspace config. So today, one control
node mints with exactly one App (or one `env-token`) for every repo across the whole mesh, regardless of
how many different orgs those repos live in.

This is fine for a single-org fleet (this milestone's soak: one repo, one org). Extending to multiple
orgs has two options, discussed with the operator when a second org's repo was raised as a hypothetical
during the soak's provisioning:
1. **One App, installed across multiple orgs.** Set the App's "Where can this GitHub App be installed?"
   to "Any account"; an admin of each additional org installs the SAME App there, independently scoped
   (`contents:read`, selected repos). No code change. Tradeoff: the control node's one private key becomes
   a cross-org secret — a leak reads every repo across every org the App is installed on (still
   read-only, but a wider surface than one org).
2. **One App per org (operator's stated preference — "keep this locked down and explicit").** Real
   isolation: each org owns its own App + key, no shared cross-org secret. **Not built.** Would need
   `resolveCloneCredentialProvider`'s App-identity inputs to become per-workspace-resolved — the same
   treatment `createResolveWorkspaceCloneUrl` (Gap A) already gives `cloneUrl`, i.e. read
   `appId`/`privateKeyPath`/`installationId` from each OTHER workspace's own committed config instead of
   only the control node's. Scoped as a follow-up for whichever future milestone first needs a
   second org, not built here — this ADR's seam stays single-provider until then.

---

## ADR-011: The clone-credential-mint's App IDENTITY is resolved PER-ASSIGNED-WORKSPACE — the same per-workspace treatment ADR-010 Gap A gave `cloneUrl`, extended to `appId`/`privateKey`/`installationId` — so each org's repos are minted by that org's OWN App; a workspace whose own config resolves no App/key fails LOUD, never borrows a sibling org's key. `resolveGithubAppPrivateKey`'s default directory is a CODE-ENFORCED `<meshRoot>/credentials/`, never a sync-scoped folder

**Status:** Accepted
**Date:** 2026-07-18
**Story 03. Builds option 2 of ADR-010's "Known limitation" (one App per org, the operator's stated preference — "keep this locked down and explicit"). Does NOT re-open ADR-009's PULL channel or ADR-010's provider selection — it changes only WHERE the `github-app` provider reads its App identity from. Security owns the matching threat T12.**

**Codebase-graph grounding (built fresh at this decision — `aof graph build src` → 1948 nodes / 5041 edges / 92 communities, `builtAt` this session, egress none).** `aof graph impact src/mesh-clone-credential-provider.mjs` → **imported/called by ← 1** (`mesh-launcher.mjs`, sole); imports → `control-stream-server.mjs`, `mesh-worker-execution.mjs` (`parseRepoFromCloneUrl`), `mesh-presence.mjs`. The provider module's production-wiring blast radius is exactly **one importer** — the launcher — the same single-site fact ADR-009/010 relied on. `resolveGithubAppPrivateKey` (`mesh-launcher.mjs:131`) and `createResolveWorkspaceCloneUrl` (`:103`) already live in that one importer. The graph is one input; the decision is the architect's call.

**Context.** ADR-010 shipped the `github-app` provider and made `cloneUrl` resolution per-workspace via `createResolveWorkspaceCloneUrl(ws, options)` (`mesh-launcher.mjs:103`, Gap A) — a repo in any org resolves its clone URL from each workspace's OWN committed `mesh.repo.cloneUrl`. The App IDENTITY did NOT get that treatment: `resolveCloneCredentialProvider` reads `appId`/`privateKey`/`installationId` ONCE, from the control node's launch-workspace merged config, at the single call site (`mesh-launcher.mjs:523-528`) — so one control node mints with exactly one App for every repo across the whole mesh regardless of org (ADR-010's recorded "Known limitation"). `loadWorkspace` ALREADY merges the GLOBAL `~/.aof/aof.config.json` mesh config as the base with each project's LOCAL mesh config on top (`work.mjs:176-180`, local wins) — so a single global App is ALREADY the fleet-wide singular default and a project's local config can ALREADY override it; the ONLY gap is that the override is read once from the launch workspace, never re-resolved for the workspace an assignment actually targets. `resolveGithubAppPrivateKey` today (`mesh-launcher.mjs:131`) returns `null` when neither `AOF_MESH_GITHUB_APP_PRIVATE_KEY_PATH` nor `config.mesh.repo.credential.githubApp.privateKeyPath` is set — no default directory — so a key must be pointed at explicitly (as the live soak does, after the operator relocated the key out of a Dropbox-synced folder into `~/.aof/mesh/credentials/`).

**Decision.**
- **App identity is resolved per-assigned-workspace, keyed by the mint's `workspaceId` — mirroring `resolveWorkspaceCloneUrl` verbatim.** The `github-app` provider closes over a NEW injected seam `resolveWorkspaceAppIdentity(workspaceId) → { appId, privateKey, installationId } | null` (name indicative), supplied by the launcher exactly as `resolveWorkspaceCloneUrl` is (Gap A). Its source of truth is each workspace's OWN global-merged committed `config.mesh.repo.credential.githubApp.*`, resolved through the SAME ADR-003 descriptor seam (`resolveWorkspaceProjectRoot` → `loadWorkspace` → the raw optional-chain read) `createResolveWorkspaceCloneUrl` already uses, with the control node's own launch-workspace config as the single-repo/bootstrap fallback (the singular-default case — a single-org fleet needs no per-workspace config at all).
- **The mint-seam signature stays byte-identical** (ADR-010 decision 2, re-armed). `mintCloneCredential(workspaceId, assignmentId)` is UNCHANGED: the identity resolution moves INTO the provider's closure, keyed by the `workspaceId` the frame handler already F15-binds to `existing.workspace_id`. The worker-supplied frame NEVER steers which App/key is used, exactly as it never steers the cloneUrl.
- **Singular App by default, override-able per workspace** (operator, 2026-07-16). Absent a per-workspace `mesh.repo.credential.*` override, resolution falls through to the control node's own (global-merged) default App — the SAME singular behaviour as today, now correctly reached for ANY assigned workspace, not only the launch one. A workspace in a different org sets its own local override to isolate.
- **Cross-org key isolation is STRUCTURAL, not a runtime check.** The App key that mints workspace A's token is resolved FROM workspace A's own committed config, keyed by A's `workspaceId`; there is NO code path that carries a previously-resolved identity across workspaces, and none that reads workspace B's local override to mint A's token. A workspace whose own (global-merged) config resolves NO `appId`, or whose key file is unreadable, resolves to a NULL identity → the provider THROWS the existing loud coded `clone-credential-mint-failed` → `assignment-repo-unavailable` (ADR-009/010's inherited failure path), NEVER a silent fallback to a sibling workspace's / another org's already-resolved App. "Borrowing" is the exact failure this ADR forbids by construction.
- **The private-key default directory is CODE-ENFORCED and never sync-scoped.** `resolveGithubAppPrivateKey` gains a final fallback after env and config path: a CODE-ENFORCED default under the global mesh home — `<meshRoot>/credentials/` (`~/.aof/mesh/credentials/`, honoring `AOF_GLOBAL_HOME`), composed through the `globalMeshPaths` seam — NEVER a path derived from a Dropbox/iCloud/OneDrive/any sync-scoped folder (SECURITY T8's file-permission-protected-at-rest posture). The key is still read only at resolve time and flows only into the JWT signer (ADR-010 F5), never a log/frame/`process.env`.

**Structural invariants (each testable; armed by `acd-cross-org-key-isolation`).**
1. **App identity is per-workspace, keyed by the mint's `workspaceId`** — there is a `resolveWorkspaceAppIdentity`-shaped seam keyed by `workspaceId`; the provider does not close over a single static `appId`/`privateKey` applied to every mint.
2. **No cross-org borrow.** No code path mints workspace A's token with an identity resolved from a workspace whose id ≠ A; a null-resolved identity THROWS the loud coded refusal, never falls back to a sibling's identity or the launch workspace's App.
3. **The default private-key directory is `<meshRoot>/credentials/`**, code-composed via `globalMeshPaths` — never a config-supplied default that could point at a synced tree, never a `homedir()`+sync-folder path.
4. **The mint seam signature and the F15 worker-frame-drops-cloneUrl posture are preserved** — identity is keyed by the F15-bound `workspaceId`, not by the worker's frame.

**Consequences.**
- ADR-010's "Known limitation" is closed for the multi-org case: a leak of one org's App key can mint only THAT org's repos — the isolation boundary is the org, not just the repo inside one shared App.
- The singular-App single-org fleet (this milestone's soak) is byte-unchanged — no per-workspace credential config is required for it; the launch-workspace fallback IS today's behaviour.
- Dropping a key into `~/.aof/mesh/credentials/` needs no explicit path after this ships; a key left in a sync-scoped folder is a configuration the operator must make explicitly, never a silent default.
- **`acd-cross-org-key-isolation` is SPEC, armed at BUILD** — the per-workspace identity seam does not exist yet (story `not-started`); a detector authored now would scan absent wiring (vacuous — the ADR-008 / SECURITY-F5/F6 deferral precedent). Armed at build against the real seam.

---

## ADR-012: The read-only fleet face gains its FIRST live write route — ONE `POST /api/mesh/assign` carve-out wrapping the existing `assignWork` verb VERBATIM, re-running every one of its gates; loopback-bound + same-origin local-admission, adding NO new arbitration. This REALIZES the m35/ADR-007-deferred UI-assign affordance on the m27/ADR-006 bounded-write posture

**Status:** Accepted
**Date:** 2026-07-18
**Story 04. Relaxes m25/ADR-004's + this milestone's ADR-006 read-only fleet-face posture — the FIRST live mutation route on `mesh-ui-serve.mjs`. Honours the m27/ADR-006 bounded-write precedent and realizes the m35/ADR-007 explicitly-deferred UI-assign POST. Security owns T13.**

**Codebase-graph grounding (fresh, this decision).** `aof graph impact src/mesh-ui-serve.mjs` → **imported/called by ← 3**: `src/cli.mjs` (the ONE production importer) plus two references under `wiki/work/35_.../reference/retired-dispatch-tests/` (`mesh-issue-route-same-origin.mjs`, `mesh-ui-issue-route.mjs`) — i.e. the m27 `POST /api/mesh/issue` write route was RETIRED, and the current source confirms it: `mesh-ui-serve.mjs` serves GET-only, a POST is a clean 405, and `server.on("upgrade")` destroys every socket ("there is no fleet mutation route"). `aof graph impact src/commands/mesh-assign.mjs` → **imported/called by ← 7** (`cli`, `control-stream-server`, `global-work-publisher`, `mesh-assignment-reclaim`, `mesh-launcher`, `mesh-presence`, `mesh-worker-execution`) — `assignWork` is a well-coupled, reused core. The UI route becomes an 8th CALLER of that SAME core, never a re-implementation. Actual structure, not inference. The graph is one input; the decision is the architect's call.

**Context.** The fleet face is read-only by ADR-006 (this milestone) and m25/ADR-004: `GET /api/mesh/status` + `GET /api/mesh/board-url`, POST = 405, upgrade destroyed. The dispatch verb already exists and is complete — `assignWork(workspace, ref, nodeId, ctx)` (`commands/mesh-assign.mjs:99`): resolves the ref EXACTLY (`findWork`, refuses `ref-not-found`), enforces the single-runner uniqueness invariant (`findActiveAssignment`, refuses `assignment-already-active`), runs the control-side repo-availability gate (`resolveTarget`: node-known → `assignment-target-unknown`, membership+publish → `assignment-repo-unavailable`), and only THEN mints the `assigned` record in `global_assignments`. Every miss mints nothing and returns a structured `{ ok:false, code }`. The operator's requirement (2026-07-18, RESEARCH §4.5): dispatch from the UI where the terminal lives, never the CLI. Prior art the memory-recall surfaced: m27/ADR-006 already established the bounded-fleet-face-write SHAPE (`POST /api/mesh/issue` → invoke a `mesh:*` verb, same-origin 127.0.0.1, flipping exactly the write-isolation fitness to a bounded shape while single-server/no-core-import stay green) — since retired — and m35/ADR-007 explicitly DEFERRED the UI-assign POST as "a guarded same-origin+json POST is a deferred future affordance." This ADR realizes that deferred affordance on that bounded posture.

**Decision.**
- **ONE new write route: `POST /api/mesh/assign`** (body `{ ref, nodeId }`) — the SINGLE, explicit exception to the read-only invariant. It resolves the current workspace and calls the EXISTING `assignWork(workspace, ref, nodeId, ctx)` core VERBATIM — it adds NO new arbitration, no second uniqueness rule, no bespoke repo check. (Withdraw MAY ride the same route shape as a follow-up; assign is the pinned scope.)
- **The UI path re-runs the verb's OWN gates — a hostile/ill-formed POST is refused by the SAME gates as the CLI.** Because the route wraps `assignWork`, a POST naming an unknown node hits `assignment-target-unknown`, an ineligible node hits `assignment-repo-unavailable`, a duplicate hits `assignment-already-active`, a typo'd ref hits `ref-not-found` — each mints nothing. The route MUST surface the verb's structured `{ ok:false, code }` as a coded HTTP error (the fleet face's existing `sendApiError` envelope), never a 200, never a second success path around the gates.
- **Admission / authorization posture — DOCUMENTED DEFAULT (RESEARCH does not pin this; this is the genuine open decision, taken here).** The route is **loopback-bound** (the fleet face already binds `127.0.0.1` only) and admitted by **same-origin local-admission**: it accepts the POST only from a same-origin browser on the loopback interface (the m27/ADR-006 + board-serve single-user posture), with no cross-origin write and no new credential/token in this story. A single-user 127.0.0.1 server needs no more (the terminal-ws/board precedent). A networked, multi-operator fleet face would need a real auth gate — recorded here as the explicit boundary of this decision, NOT built in this story. Security owns whether this posture is sufficient (T13).
- **The isolation guarantees that must STAY green** (the m27/ADR-006 discipline): the fleet face keeps exactly ONE `http.createServer` bound to loopback; it imports the `assignWork` verb + the existing global query surface, NOT low-level work/run/mesh writers; it still serves no `/ws/terminal` (story 06 opens that carve-out separately). Only the write-isolation invariant flips — from "no mutation route" to "exactly ONE bounded mutation route wrapping one verb."
- **Producer-fed conformance (ADR-008).** This route is a boundary we now own on BOTH sides (the UI POSTs, the route consumes) — so conformance requires a REAL POST from the REAL built UI hitting the REAL route and producing a REAL `global_assignments` record read back through the REAL store. A test that asserts the route handler agrees with a hand-built request body, or that the "assign" button emits a well-formed URL, proves nothing (F4's "wiring is not a contract"). The affordance is proven by the record it mints.

**Structural invariants (each testable; armed by `acd-fleet-face-single-mutation-route`).**
1. **EXACTLY ONE mutation route on the fleet face**, and it is `POST /api/mesh/assign`. Any second write route, or a write method on any other path, trips the detector (the read-only invariant keeps exactly one documented exception).
2. **The write route calls `assignWork` and mints through no other path.** No `insertAssignment` / `global_assignments` write reachable from `mesh-ui-serve.mjs` except through the `assignWork` verb — the gates cannot be bypassed.
3. **A gate miss is surfaced, never swallowed.** The route maps the verb's `{ ok:false, code }` to a coded non-200; it never mints on a gate miss and never returns 200 for a refusal.
4. **The fleet face stays otherwise read-only** — one loopback `http.createServer`, no low-level writer import, no `/ws/terminal` (this story), `GET /api/mesh/status` still 405s a write.

**Consequences.**
- An operator dispatches work from the fleet UI; the assign mints the `global_assignments` record and the UI reflects the `assigned` chip (m35/story-03's read shape) — verifiable independently of the terminal stories.
- The read-only posture gains exactly ONE documented, testable exception; the m27 write-isolation lesson is honoured (bounded, verb-wrapping, single-server, no-core-import).
- **DOCUMENTED DEFAULT for STATE.md:** endpoint = `POST /api/mesh/assign` `{ ref, nodeId }`; admission = loopback-bound + same-origin local-admission, no auth token this story (a networked multi-operator face needs a real gate — explicitly out of scope). Security (T13) reviews whether local-admission suffices.
- **`acd-fleet-face-single-mutation-route` is SPEC, armed at BUILD** — the route does not exist yet; armed against the real handler.

---

## ADR-013: The worker's execution seam replaces `claude -p` with an INTERACTIVE `claude` PTY session — one long-lived interactive session PER ASSIGNMENT, driven by a whole command string typed into stdin, over the EXISTING `terminal-providers`/node-pty seam (on the worker's subscription). Terminal state is an explicit `NEEDS_INPUT` sentinel, not a one-shot JSON `terminal_reason`; the `session_id` is captured; a needs-input session RETAINS its worktree

**Status:** Accepted
**Date:** 2026-07-18
**Story 05. Replaces the `defaultSpawnRuntime`/`buildDriverCommand` `claude -p` driver measured in RESEARCH §4.3. Depends on story 04 (an assignment to consume); precedes story 06 (a terminal to stream). Does NOT reintroduce the Agent SDK / per-token API path (§4.3 — that forces off-subscription billing).**

**Codebase-graph grounding (fresh, this decision).** `aof graph impact src/terminal-ws.mjs` → **imported/called by ← 1** (`src/setup-ui.mjs`, the board server) — the fleet face and the worker do NOT reach it today; the interactive PTY seam is a clean, near-leaf subsystem the worker can reuse. `aof graph impact src/mesh-worker-execution.mjs` → dependents ← 4 (`mesh-repo`, `global-node-registry`, `mesh-clone-credential-provider`, `mesh-launcher`); it imports `mesh-worktree.mjs`. `buildDriverCommand`/`defaultSpawnRuntime` are exported functions with narrow reach — replacing what they SPAWN is a near-leaf change. The graph is one input; the decision is the architect's call.

**Context.** The shipped driver is `claude -p` (`buildDriverCommand` → `claude -p <prompt> --output-format json`, `mesh-worker-execution.mjs:559`; `defaultSpawnRuntime:568`), ONE bounded non-interactive turn whose terminal state is read from the parsed JSON `terminal_reason ?? stop_reason` (`:581`). RESEARCH §4.3 MEASURED two load-bearing limits: (1) `claude -p` cannot pause to ask a human — a question-ended turn reports `terminal_reason: "completed"`, EXACTLY the signal `defaultSpawnRuntime` maps to `outcome: "done"`, so the worker cannot tell "finished" from "ended the turn to ask" and would `done`+force-remove a run a human still owes an answer; (2) the Agent SDK path that COULD ask forces per-token API billing off the worker's subscription. The operator's resolution: drop `claude -p`, use the terminal infrastructure this repo already ships. That infrastructure exists and is a near-leaf: `terminal-providers.mjs` (`resolveProvider("claude")` → `buildArgs()`/`buildEnv()`, spawns interactive `claude`, NOT `-p`), node-pty via `terminal-ws.mjs`'s spawn seam, `terminal-sessions.mjs` (the live-session registry). Interactive `claude` runs on the worker-user's subscription (measured, §4.3), asks mid-session natively, and lets a human attach via `claude --resume <session-id>`. The m03/ADR-006 precedent (memory-recall) is exactly the driving pattern: the board's primary action runs an aof command by TYPING it as ordinary PTY input into the spawned agent.

**Decision.**
- **`buildDriverCommand`/`defaultSpawnRuntime` STOP emitting `claude -p`.** The worker runs interactive `claude` in a node-pty PTY through the EXISTING `terminal-providers` seam (`resolveProvider("claude").buildArgs()` — the empty-args interactive launch, `terminal-providers.mjs:23` — and `buildEnv`), spawned via the same node-pty path `terminal-ws.mjs` uses, cwd = the worktree. The Agent SDK / `canUseTool` / per-token path is explicitly NOT reintroduced (§4.3 — it forces off-subscription API billing).
- **The assignment directive carries a WHOLE COMMAND STRING, typed into the PTY stdin** (the m03/ADR-006 precedent). The control node sends the slash-command the run should execute — `/aof:refine <ref> --autonomous`, `/aof:continue`, `/aof:verify <ref>` — as a first-class field the worker WRITES into the interactive session's stdin (`pty.write`), never a `-p` prompt argv. The directive frame carries the command; the worker types it.
- **Session lifecycle — ONE long-lived interactive `claude` PER ASSIGNMENT (DOCUMENTED DEFAULT, the RESEARCH-leaning shape).** One assignment → one interactive session in one worktree (matching worktree-per-assignment isolation), living for the whole run rather than one turn. NOT one shared session per worker (isolation + a clean per-assignment `session_id` to surface). The `session_id` is CAPTURED (the code DISCARDS it today — `mesh-worker-execution.mjs:580-581` reads only `terminal_reason`/`stop_reason`) and surfaced on the assignment/presence record so story 06 can route the stream and a human can `claude --resume <session-id>`.
- **Terminal-state detection — an explicit `NEEDS_INPUT` sentinel / structured end-signal, NOT a one-shot JSON `terminal_reason` (DOCUMENTED DEFAULT).** The interactive session has no `-p` JSON result to parse. The driver PROMPT instructs the agent, on a genuine judgment call, to STOP and end its turn emitting an explicit `NEEDS_INPUT` sentinel (a documented constant) rather than guess; the worker detects that sentinel in the PTY output and branches to a THIRD terminal state — `needs-input` — BEFORE the done/cleanup path. `done` and `failed` keep their meaning; `needs-input` is new and non-terminal-for-cleanup.
- **Worktree-retention invariant — a needs-input session MUST NOT force-remove its worktree.** The `needs-input` branch RETAINS the worktree exactly as the `failed` path already does (`mesh-worktree.mjs` retention + `sweepRetainedWorktrees` ceiling; `mesh-worker-execution.mjs:894`), so an attached human has a live working directory to `claude --resume` into. Only a `done` outcome force-removes (unchanged, §4.1/§4.3 — the session transcript survives in `~/.claude/projects/...` but the checkout does not, so retention is required for resume to be useful).

**Structural invariants (each testable; armed by `acd-worker-driver-no-headless-print`).**
1. **No `claude -p` / headless-print in the worker driver path.** `buildDriverCommand`/`defaultSpawnRuntime` (and whatever replaces them) name no `-p` + `--output-format json` one-shot for the `claude` driver; the interactive launch resolves through the `terminal-providers` seam.
2. **The command to run is TYPED into the PTY stdin**, carried as a directive field — not baked as a `-p` prompt argv.
3. **`session_id` is captured and surfaced** on the assignment/presence record (no longer discarded).
4. **A `needs-input` outcome retains the worktree** — it takes the `failed`-style retention branch, never the `done` force-remove.

**Consequences.**
- The worker runs real interactive work on subscription billing, can ask a human mid-flight, and a human can attach and answer via `claude --resume`.
- A question-ended turn is no longer mis-read as `done` — the `needs-input` state + worktree retention make human-in-the-loop actually usable.
- **DOCUMENTED DEFAULTS for STATE.md:** one long-lived interactive `claude` per ASSIGNMENT; terminal-state via an explicit `NEEDS_INPUT` sentinel constant → a new `needs-input` outcome (three states: done/failed/needs-input).
- **`acd-worker-driver-no-headless-print` is SPEC, armed at BUILD** — the interactive driver does not exist yet; armed against the real seam. (The `@manual` soak proves subscription-billing + native ask, which no `@executable` test can.)

### AMENDMENT (2026-07-19, `aof:continue 38/05` closing BLOCKER F-38.05 — decision bullets 3 & 4 CORRECTED, the as-built mechanism was producerless)

**This amendment CHANGES two decisions above; it does not merely ratify them.** The 2026-07-19 story-05 verify
pass (VERIFICATION.md §"F-38.05 producer measurement") confirmed at source that the `session_id` and
`NEEDS_INPUT` decisions shipped their CONSUMER halves with NO PRODUCER — the milestone's defining F4
"green ≠ working" class, recurring at the sentinel seam. `extractSessionIdFromOutput`
(`mesh-worker-execution.mjs:739`) scans PTY output for an `AOF_SESSION_ID:` marker nothing emits (a real
`claude` does not print its session id), so `session_id` is ALWAYS `null` in production; and
`driveInteractiveClaudeSession` (`:807-897`) types ONLY `brief.command` into the PTY with no instruction that
makes a real `claude` emit `NEEDS_INPUT`, so the `needs-input` outcome can NEVER fire. The `@executable` lanes
were green because the TESTS emit the markers the real producer was never instructed to emit — and
`acd-worker-driver-no-headless-print` had STRUCTURALLY PINNED that producerless shape (invariant 4 required
`extractSessionIdFromOutput`; invariant 3 asserted an empty argv `spawnCalls[0].args === []`), so its green was
itself part of why the defect shipped inert. Both decisions are corrected below; the fitness function is
rewritten in lockstep to REQUIRE the producer, not lock in its absence.

**Codebase-graph grounding (fresh, this amendment — `aof graph build src`, 2026-07-19: `builtAt` today, 2002
nodes / 4855 edges, 4 files re-extracted).** `aof graph impact src/mesh-worker-execution.mjs` → dependents ← 4
(`commands/mesh-repo`, `global-node-registry`, `mesh-clone-credential-provider`, `mesh-launcher`); dependencies
→ 9, now GAINING a tenth edge to `src/work-observe.mjs`. `aof graph impact src/work-observe.mjs` → dependents ←
1 (`cli.mjs` only), dependencies → 0 (a pure node-builtin leaf: fs/os/path) — so reusing its
`projectSlug`/`claudeProjectsDir` adds ONE edge into a genuine leaf that does NOT import the worker driver: no
cycle, the sanctioned reuse over a re-implemented slug. `resolveInteractiveDriverLaunch` is worker-scoped as
ACTUAL structure, not inference: `aof graph impact` shows the fleet/human `/ws/terminal` path reaching
`terminal-providers.mjs` via `terminal-ws.mjs`, which calls `resolveProvider` DIRECTLY and never calls
`resolveInteractiveDriverLaunch` — so a launch arg appended there is worker-only, never on a human session. The
graph informs; the decision is the architect's call.

**Decision bullet 3 — CORRECTED. `session_id` is captured by a TRANSCRIPT-DIR WATCH, not a PTY-output marker.**
The original bullet 3 ("the `session_id` is CAPTURED") rested on a phantom `AOF_SESSION_ID:` marker the model
was never able to emit. REPLACE it with a deterministic mechanism requiring ZERO model cooperation: a worker
spawning interactive `claude` with `cwd = worktreeCwd` makes Claude Code ITSELF (the real producer) write its
transcript to `~/.claude/projects/<projectSlug(worktreeCwd)>/<session_id>.jsonl` (honouring `CLAUDE_CONFIG_DIR`),
measured live at the verify pass. The worker computes that directory with the EXISTING
`claudeProjectsDir({ cwd: worktreeCwd })` / `projectSlug` helpers in `work-observe.mjs` (reused, never
re-implemented), snapshots the dir's existing `*.jsonl` basenames BEFORE spawn, and the FIRST NEW
`<session_id>.jsonl` basename to appear NAMES the session. Absent/degrade is UNCHANGED from the original task-03
contract: if no transcript appears (the watch times out, the dir never materializes, the watch is aborted),
`session_id` degrades to `null`, never a crash. `AOF_SESSION_ID:` / `SESSION_ID_MARKER` /
`extractSessionIdFromOutput` are RETIRED (they had no producer).

**Decision bullet 4 — CORRECTED. The `NEEDS_INPUT` instruction's home is a worker-scoped
`--append-system-prompt` on the interactive launch (option C).** The original bullet 4 said "the driver PROMPT
instructs the agent" without pinning WHERE that prompt lives — and nothing was built, so no real `claude` was
ever instructed. Three homes were weighed:
- **(A) worker-typed preamble** — type an instruction line into the PTY before the command. REJECTED: it breaks
  the "exactly one `term.write`" shape (invariant 3), a conversational preamble is a weak, turn-wasting
  instruction (Claude answers it AS a turn — it is not a standing directive), and it races the command line.
- **(B) inside the shared `/aof:*` bundle commands** — a standing "if autonomous with no human, emit
  `NEEDS_INPUT`" clause in the driven directive. REJECTED: those commands are ALSO run by humans (where
  `AskUserQuestion` is correct), so the clause would false-fire on human sessions unless conditioned on a
  worker-only env; it couples the contract across every bundle and touches the CLI↔bundle-parity surface.
- **(C) CHOSEN — a worker-scoped `--append-system-prompt` launch arg.** `resolveInteractiveDriverLaunch`
  appends `["--append-system-prompt", NEEDS_INPUT_INSTRUCTION]` to the interactive launch args.
  **Why (C):** the command stays EXACTLY one typed PTY line (invariant 3's single-write shape is UNCHANGED); a
  session-wide directive belongs in a system prompt, not a fragile conversational turn; it is worker-scoped by
  construction (the human `/ws/terminal` path never calls `resolveInteractiveDriverLaunch`, graph-confirmed
  above), so it can never false-fire on a human session the way (B) would; and there is NO coupling to shared
  bundle commands. **Trade-off accepted:** the interactive launch args are no longer strictly empty (invariants
  1/2b/3's argv assertions are ADJUSTED to ALLOW `--append-system-prompt` while STILL forbidding any
  `-p`/`--print`/`--output-format`), and whether `--append-system-prompt` takes effect in interactive
  (non-`-p`) mode is UNMEASURED — acceptable, because ALL of `NEEDS_INPUT`'s real efficacy is soak-territory.

The sentinel DETECTION mechanism is UNCHANGED — `containsNeedsInputSentinel` (the whole-line PTY scan hardened
by the 2026-07-19 fast-follow) still owns detection; this amendment adds the missing PRODUCER, it does not
re-do detection. `NEEDS_INPUT_INSTRUCTION` MUST embed the sentinel via `${NEEDS_INPUT_SENTINEL}` so producer
and detector share one literal.

**`NEEDS_INPUT`'s real efficacy remains the task-04 `@manual` soak's deliverable.** Whether a real interactive
`claude` on a real subscription actually emits the sentinel on a genuine judgment call cannot be proven by any
`@executable` test — that is, and always was, task 04's job. This build ships an HONEST PRODUCER (a real launch
arg, not a phantom marker) and keeps the `@executable` lanes over INJECTED fake-PTY / fake-watch seams.

**Source anchors the developer builds to (stable names; the fitness rewrite pins these verbatim).**
- **`session_id` capture:** `import { claudeProjectsDir } from "./work-observe.mjs"`; a default producer
  `defaultWatchTranscriptSessionId({ cwd, env, signal }) => Promise<string|null>` (never throws, abort-aware,
  computes `claudeProjectsDir({ cwd, env })`, resolves the first new `<session_id>.jsonl` basename or `null`);
  the injected seam `options.watchTranscriptSessionId`, wired as
  `options.watchTranscriptSessionId ?? defaultWatchTranscriptSessionId`; the driver kicks the watch off at
  spawn, ABORTS it at `finish`, and threads its AWAITED (null-degraded) result onto the SAME resolved
  `{ outcome, sessionId }` object (so the value is deterministic, not race-dependent). `capturedSessionId`
  stays the mid-stream variable the story-06 `onOutputChunk(chunk, capturedSessionId)` bridge reads (populated
  by the watch's resolution rather than the retired marker scan). The handler
  `createMeshWorkerExecutionHandler` FORWARDS `watchTranscriptSessionId` into `spawnRuntime(...)`'s options
  (exactly like `ptySpawn`/`which`/`onOutputChunk`) so task-03's test can inject a fake through the one handler
  entry point.
- **`NEEDS_INPUT` producer:** an exported `NEEDS_INPUT_INSTRUCTION` template literal that embeds the sentinel
  via `${NEEDS_INPUT_SENTINEL}` (so producer + detector share one literal) — with NO `//` or `/*` sequence
  inside the template (the fitness function strips comments); `resolveInteractiveDriverLaunch` builds
  `const args = [...provider.buildArgs(), "--append-system-prompt", NEEDS_INPUT_INSTRUCTION];`.
- **Surfacing (UNCHANGED, already correct):** `sessionId` rides the `done` frame
  (`sendAssignmentStatus?.(assignmentId, "done", { runId: runRecord.runId, sessionId })`) and the `needs-input`
  frame (`sendAssignmentStatus?.(assignmentId, "running", { runId: runRecord.runId, sessionId, code:
  "needs-input" })`).

**Structural invariants (SUPERSEDE the four above; armed by the rewritten `acd-worker-driver-no-headless-print`).**
1. No `claude -p` / `--output-format json` one-shot for the `claude` driver (UNCHANGED).
2. The interactive launch resolves through the `terminal-providers` seam (UNCHANGED).
3. The command to run is TYPED into the PTY stdin as exactly ONE `term.write`; the launch argv MAY carry
   `--append-system-prompt <NEEDS_INPUT_INSTRUCTION>` but NEVER `-p`/`--print`/`--output-format`.
4. `session_id` is captured by the transcript-dir watch (`claudeProjectsDir` + the
   `defaultWatchTranscriptSessionId` seam) — NOT a PTY-output marker — and surfaced on the `done` +
   `needs-input` frames.
5. A `needs-input` outcome retains the worktree (UNCHANGED).
6. **(NEW) The `NEEDS_INPUT` PRODUCER EXISTS** — `NEEDS_INPUT_INSTRUCTION` embeds `${NEEDS_INPUT_SENTINEL}` and
   is appended to the interactive launch as `--append-system-prompt`. A revert to "no producer" trips the
   detector.

**Consequences.**
- The producerless `AOF_SESSION_ID:` path is removed; `session_id` is deterministic and model-cooperation-free.
- `NEEDS_INPUT` has a real, worker-scoped home that never false-fires on a human session; its efficacy is
  proven at the task-04 soak, not by a marker the test emits.
- The fitness function now FAILS if either producer is removed — a green fitness function is no longer a barrier
  to the fix (the F-38.05 retro lesson: a fitness function armed at build against an as-built shape can lock in
  a producerless consumer).

### AMENDMENT (2026-07-23, structural review of story 06 / task 04 closing BLOCKER F-38.06c — invariant 3's HOME is ratified; its REPORTING MOMENT is CORRECTED)

**This amendment RATIFIES where the `session_id` lives (a decision the as-built made and only a code comment
recorded) and CORRECTS *when* it is reported (a defect the as-built inherited from story 05).** Invariant 3
said the captured `session_id` is "surfaced on the assignment/presence record" and stopped there — it pinned
neither the HOME nor the MOMENT. Task 04 supplied the home; the moment is still wrong, and the two together are
what decide whether ADR-014's mirror can ever be watched LIVE.

**Codebase-graph grounding (fresh, this amendment — `aof graph build src`, 2026-07-23: 2009 nodes / 4859 edges,
12 files re-extracted).** `aof graph impact src/assignment-record.mjs` → dependents ← 4 (`commands/mesh-assign`,
`control-stream-server`, `global-mesh-query`, `mesh-assignment-reclaim`), dependencies → **0** — a genuine leaf,
so widening its row→record mapper reaches exactly those four readers and nothing else.
`aof graph impact src/global-work-store.mjs` → dependents ← **11** (`commands/mesh-assign`, `commands/mesh-repo`,
`commands/mesh-session`, `control-stream-server`, `global-mesh-query`, `global-node-registry`,
`global-work-publisher`, `mesh-assignment-reclaim`, `mesh-launcher`, `mesh-presence`, `mesh-worker-execution`) —
the **god-node of this milestone's persistence**, which is exactly why the column had to arrive by an idempotent
in-place `ALTER`, never a recreate: eleven modules open that database, on control nodes AND worker nodes.
`aof graph impact src/global-mesh-query.mjs` → dependents ← **1** (`mesh-ui-serve.mjs` only) — the read shape has
a single consumer, so the SURFACE half of the change is genuinely contained. The `ui/` half is OUTSIDE the built
graph (the build was scoped to `src`), so its coupling below is grep-and-infer, stated as such. The graph informs;
the decision is the architect's call.

**RATIFIED — the join key's HOME is a `global_assignments.session_id` column + an ADDITIVE key on the READ
mapper, and DELIBERATELY NOT on the frozen mint.** ADR-001 freezes `assembleAssignmentRecord` at ten keys, in
order (`acd-assignment-record-frozen`), which made the naive reading of invariant 3 ("put it on the record")
impossible to satisfy without breaking a frozen invariant. The as-built resolves that tension correctly, and it
is a real decision that deserves recording:
- **The MINT shape stays frozen at ten.** `assembleAssignmentRecord` is a CONTROL-side dispatch record, minted
  when nothing about a worker session exists yet; a `sessionId` there could only ever be `null`.
- **The READ shape is additive.** `mapAssignmentRow` (`assignment-record.mjs:100-115`) gains an eleventh key,
  `sessionId: row.session_id ?? null` — the row→record mapper every reader already shares, so the value travels
  identically through `readAssignment` / `findActiveAssignment` / `listAssignmentsForItem` / `listAllAssignments`
  without a second shape.
- **The PROJECTION is additive AND absent-not-empty.** `projectAssignment` (`global-mesh-query.mjs:115-131`)
  appends `sessionId` AFTER the eight m35 keys and OMITS the key entirely when uncaptured — an assignment with
  no session yet must not be expressible as "a stream you can open".
- **Only the HOLDER may write it.** The capture rides `applyAssignmentStatusFrame`, BEHIND the pre-existing
  T6 holder gate (`existing.target_node_id !== connectionNodeId` → refuse, `control-stream-server.mjs:226-228`),
  with the connection-bound `options.nodeId` — the SAME discipline F17 restored for terminal frames. It follows
  `runId`'s absent-is-not-a-clear rule (`options.sessionId !== undefined ? … : existing.session_id`), so a later
  state-only frame can never erase a captured id.
- **The PRESENCE record is untouched.** Invariant 3's "assignment/presence" was an either; the assignment
  record is the one chosen, and ADR-001's four-key presence freeze stays byte-unchanged.

**CORRECTED — invariant 3's REPORTING MOMENT. The worker must report the session id WHEN IT IS CAPTURED, not
only when the run ENDS.** Verified at source this review: `capturedSessionId` is populated MID-RUN, the instant
the transcript-dir watch resolves (`mesh-worker-execution.mjs:949,962`), and every terminal-frame from that
moment carries it (`:1014`). But the only `sendAssignmentStatus` calls that carry `sessionId` are
`needs-input` (`:1484`), `done` (`:1523`), `failed` (`:1529`) and the completed branch (`:1533`). The `running`
transition that OPENS the run (`:1448`) is sent BEFORE the driver spawns and carries `{ runId }` only — correctly,
since no session exists yet — and **nothing sends another status frame for the whole life of the run.**
Consequence: for an ordinary run, `global_assignments.session_id` stays NULL until the run REACHES A TERMINAL
STATE, so `projectAssignment` omits the key, `resolveTerminalStream` returns `no-session`, and the fleet card
renders no terminal and opens no socket **for exactly the interval an operator wants to watch**. The worker is
streaming PTY bytes into the mirror the entire time, keyed by an id no browser can learn until there is nothing
left to watch. (The `needs-input` case IS covered — that frame carries the id mid-flight — which is why
ADR-014's named consequence "a human can SEE what a `needs-input` session is asking" holds while the SPEC
objective "watch a dispatched run progress in real time" does not.)

**Structural invariant 7 (NEW; SUPERSEDES nothing — invariants 1-6 above stand unchanged).**
7. **The captured `session_id` is REPORTED WHILE THE RUN IS LIVE.** The worker sends a session-id-carrying
   assignment-status frame at the moment `capturedSessionId` first resolves — not only on the
   `needs-input`/`done`/`failed` frames. A run that reaches the control node with a session id ONLY at a
   terminal state does not satisfy invariant 3, because the join key it surfaces can no longer be used to watch
   anything. The natural shape is a second `running` frame (`{ runId, sessionId }`) emitted from the watch's
   resolution callback, which the control node's absent-is-not-a-clear writer already accepts idempotently.

**Consequences.**
- The join key has ONE home, and the ADR-001 ten-key mint freeze and the eleven-key read shape are no longer in
  apparent conflict — a future reader will not "fix" one by breaking the other.
- **Invariant 7 is SPEC, armed at the FIX** — the mid-run report does not exist yet. The milestone's own F17
  precedent (a fitness armed RED to pin an open finding until the one-line fix lands) is the available shape;
  arming it is the orchestrator's call, not this review's, since it would make the suite red on a tree that is
  otherwise green.
- **This is the milestone's defining class recurring a FOURTH time, one seam further along:** F-38.05 was a
  consumer with no producer; F-38.06 a producer on an unreachable transport; F-38.06c a reachable producer with
  no consumer surface; and now a consumer surface whose join key arrives too late to use. The pattern is not
  "the wiring is missing" — it is "each link was proven in isolation and never against the clock of the run".

---

## ADR-014: The cross-machine terminal BRIDGE relays the worker's `/ws/terminal` PTY bytes over the FROZEN `mesh-relay.mjs` envelope as a NEW `kind` (opaque `signal`, routed by (nodeId, sessionId)) into a READ-ONLY fleet-face mirror — an in-memory ephemeral tail (the mesh-presence-subscriber pattern), NEVER a system of record. NO input-frame path from the fleet face back to the worker PTY exists in this story

**Status:** Accepted
**Date:** 2026-07-18
**Story 06. Depends on story 05 (an interactive terminal to stream). Opens carve-out #2 on the read-only fleet face (a terminal-VIEW route, after story 04's assign). Read-only MIRROR only; read-WRITE control (keystrokes from the fleet) is DEFERRED to Phase 2. Security owns T14.**

**Codebase-graph grounding (fresh, this decision).** `aof graph impact src/mesh-relay.mjs` → **imported/called by ← 4** (`commands/mesh-invite`, `commands/mesh-relay`, `mesh-launcher`, **`mesh-presence-subscriber`**); imports only `mesh-registry`, `mesh-store`. The relay is a payload-agnostic broker: `parseEnvelope` reads ONLY `{ kind, nodeId }` for routing and forwards the ORIGINAL frame bytes unparsed (`signal` is opaque), so an unknown `kind` is fanned out with ZERO relay change (`mesh-relay.mjs:279-298,592-602` — the m26-leasing property). `mesh-presence-subscriber.mjs` is the existing in-memory-cache subscriber (m23/ADR-004): it applies fanned-out frames into an IN-MEMORY liveness cache, writes NO durable record, and is NEVER a second system of record — the exact pattern the terminal mirror follows. The graph is one input; the decision is the architect's call.

**Context.** Both hard halves already exist (RESEARCH §4.3/§4.5): the local PTY-over-WebSocket with a frozen bidirectional envelope (`terminal-ws.mjs`, `/ws/terminal`), and the persistent cross-machine mesh transport (`mesh-relay.mjs` — a stateless ws@8 broker carrying a FROZEN, payload-agnostic `{ kind, nodeId, signal }` envelope, itself modeled on the board-serve/terminal-ws precedent). The net-new work is the BRIDGE. Two constraints: the fleet face deliberately serves no `/ws/terminal` and destroys every upgrade (ADR-006/ADR-012 read-mostly posture); and streaming a live agent terminal cross-machine is a major new capability, so this story ships a READ-ONLY mirror only.

**Decision.**
- **Relay the worker's PTY bytes over the FROZEN relay envelope as a NEW `kind`** (e.g. `"terminal-frame"`) — the m26-leasing shape: a new kind rides the wire with ZERO relay change, and the relay forwards the opaque `signal` byte-for-byte. The worker's `/ws/terminal` PTY output (the `term.onData` byte stream) is wrapped as the `signal` blob; `sessionId` rides INSIDE the signal (the relay never parses `signal`, so routing metadata the fleet needs must be carried there, alongside the `nodeId` the envelope already carries). Routed by **(nodeId, sessionId)**.
- **The fleet face gains a READ-ONLY terminal-VIEW route (carve-out #2).** A server→browser mirror — indicative `GET /ws/terminal-view?nodeId=&sessionId=` — that the fleet face feeds from an IN-MEMORY subscription to the relay's terminal-frames, following the m23/ADR-004 `mesh-presence-subscriber` pattern: an in-memory ephemeral tail that writes NO durable record and is NEVER a second system of record (kill it and the fleet loses the live view, not data — the run's durable bookkeeping is the run record, and its diff is story 07's push). This is the SECOND documented exception to the read-only fleet-face posture (story 04's assign was the first) — an upgrade route where the face today destroys every upgrade.
- **READ-ONLY MIRROR — the load-bearing invariant.** NO input-frame path exists from the fleet face back to the worker PTY in this story. No code path takes a relay/fleet frame and calls `term.write`, and the fleet terminal-VIEW WebSocket is server→browser only — it never forwards a browser keystroke onto the relay as a terminal-input frame toward the worker. Read-WRITE control (keystrokes from the fleet) is explicitly a Phase-2 concern, structurally absent here. (The worker's own local `/ws/terminal` stays bidirectional for a human logged INTO the worker — this invariant is about the MESH/fleet path only.)
- **Multiplexing + assignment discovery.** Multiple workers and multiple sessions are multiplexed by (nodeId, sessionId): the nodeId on the envelope + the sessionId in the signal uniquely key a stream. The fleet discovers "which session belongs to which assignment" via the `session_id` surfaced on the assignment/presence record by ADR-013 (story 05) — so opening an assignment's card resolves its (nodeId, sessionId) and subscribes to that stream.

**Structural invariants (each testable; armed by `acd-fleet-terminal-mirror-read-only`).**
1. **No mesh→PTY input path.** No source that consumes a relay terminal-frame (or a fleet terminal-VIEW message) calls `term.write` / feeds a worker PTY's stdin; the fleet terminal-VIEW route is send-to-browser only.
2. **The relay envelope is untouched** — the terminal bytes ride the opaque `signal` as a new `kind`; the relay's `parseEnvelope` still reads only `{ kind, nodeId }` and forwards `signal` unparsed (no JSON.parse-then-branch on terminal content).
3. **The fleet mirror is in-memory + never a system of record** — the terminal-VIEW subscriber writes no durable record (the `mesh-presence-subscriber`/`acd-relay-stateless` discipline); the stream is liveness, not data.
4. **Routing is by (nodeId, sessionId)** — the sessionId surfaced by ADR-013 is the join key; a frame with no resolvable (nodeId, sessionId) is dropped, never broadcast to an unrelated card.

**Consequences.**
- An operator watches a dispatched run's live terminal from the control node without logging into the worker; a human can SEE what a `needs-input` session is asking (attaching to ANSWER stays the worker-local `claude --resume` path until Phase-2 read-write).
- The frozen relay envelope and stateless-broker guarantees survive — the bridge is additive, byte-for-byte opaque, and never persists.
- **DOCUMENTED DEFAULT for STATE.md:** the fleet terminal-VIEW route is read-only (server→browser); read-write terminal control is Phase-2, out of scope. Security (T14) owns the "agent terminal with credentials/shell exposed to the control node" threat and whether the stream is read-only in fact, not just intent.
- **`acd-fleet-terminal-mirror-read-only` is SPEC, armed at BUILD** — the bridge does not exist yet; armed against the real relay-frame + fleet-route wiring.

### AMENDMENT (2026-07-19, structural review of story 06 as-built — RATIFICATION, no decision changed)

The decision above **stands unchanged and shipped**. The bridge/mirror as-built HONOUR every ADR-014 structural
invariant — verified at source and by `acd-fleet-terminal-mirror-read-only`: the PTY bytes ride the frozen
`{ kind, nodeId, signal }` envelope as an opaque `terminal-frame` kind with `sessionId` INSIDE the signal
(`mesh-terminal-relay-bridge.mjs:34-40`, invariant 2); the bridge subscribes ONLY to `term.onData` and there is
no `term.write`/mesh→PTY sink, and the fleet `/ws/terminal-view` upgrade block deliberately registers NO
`ws.on("message", …)` (`mesh-ui-serve.mjs:382-400`, invariant 1); the mirror is a pure in-memory live-tail with
no fs/store import and no durable write (`mesh-terminal-mirror.mjs`, invariant 3); frames route by
(nodeId, sessionId) and an unresolvable frame is dropped (invariant 4). The fleet face keeps EXACTLY one
`http.createServer` and ONE mutation route — the terminal-VIEW is a read-only upgrade carve-out, not a second
write route (`acd-fleet-face-single-mutation-route` stays green). This block records two premises in the
decision's own framing that the review found STALE, and the one runtime gap that follows — so a future reader
does not mis-read the shipped bridge as riding a transport that is actually live in production.

- **The graph-grounding modules the ADR cites were RETIRED, not existing.** ADR-014's grounding block names
  `mesh-presence-subscriber.mjs` / `mesh-presence-cache.mjs` as "the existing in-memory-cache subscriber
  (m23/ADR-004)". Both were DELETED at m33 (commit `f3a4283`, "mesh relay/transport redesign (fabric-native)":
  `-244` / `-138` lines; neither exists in the tree today). The as-built recovers only their retired DISCIPLINE
  — an in-memory ephemeral tail that writes no durable record — from git history, and `mesh-terminal-mirror.mjs`
  says so at its head. The DISCIPLINE transfer is legitimate and correctly applied; only the "existing" tense of
  the citation was wrong.

- **The transport the bridge is decided to ride — `mesh-relay.mjs`'s `serveRelay()`/`relayMode()` — is NOT
  wired into any production serve entry point, so a real two-machine deploy has NO live relay for the bridge.**
  A git-history audit (recorded in the story-06 build report and flagged in-source at
  `mesh-worker-execution.mjs:1061-1073`) found no production call site, ever, for `serveRelay()`/`relayMode()`.
  Since m33/34 the ACTUAL live worker↔control transport is `control-stream-server.mjs` /
  `worker-stream-client.mjs` (a different module, a different envelope — graph-confirmed: `mesh-launcher.mjs`
  imports `startControlStreamServer`, never `serveRelay`/`relayMode`). Consequently the developer DELIBERATELY
  did not auto-wire the bridge to a broker no role starts: the worker driver's `onOutputChunk` hook is a real,
  tested, production-shaped extension point but the launcher supplies it no push transport
  (`createHandler({…})` at `mesh-launcher.mjs:727-755` passes `requestCloneCredential`/`requestCloneUrl`/
  `requestWriteCredential` as literal keys but NO `onOutputChunk`), and the fleet face's optional
  `startTerminalRelaySubscriber` seam is likewise not supplied by the `aof mesh ui` CLI (`cli.mjs:1112`). Wiring
  a transport pointed at a broker nothing starts would be misleading "wiring", not a working pipe — declining to
  do so is the correct call, not a defect. The bridge/mirror end-to-end is exercised IN-PROCESS by the
  @executable lanes against the real `serveRelay()` broker + `mirror.apply`, which is why they are green.

**What is OWED (at the @manual two-machine soak, task 03 — NOT a build-review blocker).** Before the live
cross-machine terminal VIEW can actually carry a frame, ONE of two transport decisions must be made and wired,
then proven at the soak: (a) start `relayMode()`/`serveRelay()` from the control launcher and point the worker's
`createTerminalRelayPushTransport` + the fleet's `createTerminalMirrorSubscriberTransport` at
`config.mesh.relay.url`; OR (b) PIVOT the bridge onto the already-live `control-stream-server.mjs` /
`worker-stream-client.mjs` fabric transport (the m33/34-native path) as a new opaque frame kind, retiring the
`mesh-relay` dependency for this feature. This is a Phase-2 / soak-owed transport-wiring decision that the
@executable gate structurally cannot prove (a two-machine live relay is inherently `@manual`); it does not
change any invariant above, and the shipped modules are the correct, contract-honouring building blocks for
either choice.

### AMENDMENT (2026-07-19, `aof:continue 38/06` closing BLOCKER F-38.06 — the transport is DECIDED as a HYBRID: the FABRIC carries the cross-machine leg, a LOOPBACK relay carries the same-machine control→UI leg. An earlier option-(a) draft was FALSIFIED at source before it shipped)

**This amendment supersedes the (a)/(b) choice ADR-014 left open, and CORRECTS an option-(a) decision drafted
earlier in this same continue that a source fact falsified before it shipped.** It changes NO ADR-014
structural invariant 1-4 (read-only-in-fact, the frozen `{ kind, nodeId, signal }` envelope, the in-memory
mirror, (nodeId, sessionId) routing all stand); it resolves only WHICH transport carries EACH leg, and it arms
a fitness so the producer wiring is structurally REQUIRED (the F-38.05 lesson: a fitness that pins only the
read-only half lets the feature ship inert).

**Why NOT pure option (a) — the `serveRelay` LOOPBACK-BIND fact (verified at source this session).** `serveRelay`
binds loopback ONLY: `src/mesh-relay.mjs:622` is `server.listen(port, "127.0.0.1", …)` (its own comment: "Bind
loopback (the pre-auth posture, ADR-001)") and it reports `ws://127.0.0.1:<port>/…` (`:628`). There is NO
fabric-address bind path and NO injectable `bindAddress` parameter on `serveRelay`. So a worker on another
machine literally cannot reach the relay broker — it is unreachable off-host BY CONSTRUCTION. Meanwhile the
LIVE fabric transport binds the fabric-resolved self-address ON PURPOSE (`control-stream-server.mjs:749`
`server.listen(port, bindAddress, …)`, review-fixed to default loopback ONLY as a fallback and NEVER
"0.0.0.0", `:764-766`). That asymmetry is deliberate — it is precisely why m33 moved the worker↔control
transport ONTO the fabric. Consequence: **option (a) cannot carry a terminal frame between two machines — the
entire SPEC objective of story 06.** (I searched for a tunnel/forward that would make the loopback relay
reachable cross-machine — a fabric address in `config.mesh.relay.url` forwarded to loopback; there is none, and
`serveRelay` has no bind parameter that could accept one. Option (a) is dead for the cross-machine leg. The
draft (a) build also bound the broker to an EPHEMERAL port to dodge the live-mesh `:4182` fixture collision
while the clients dial the fixed `config.mesh.relay.url` — a second reason it could not connect even
same-machine.)

**DECISION — a HYBRID: each transport used for the leg its BIND fits.**
- **Cross-machine leg (worker → control): the FABRIC.** The worker relays its PTY bytes as a NEW opaque
  `terminal-frame` kind UP its EXISTING `worker-stream-client` → `control-stream-server` connection — the ONLY
  transport reachable off-host. The frame is the frozen `{ kind: "terminal-frame", nodeId, signal: { sessionId,
  bytes } }` envelope (reusing `buildTerminalFrameEnvelope` / `TERMINAL_FRAME_KIND`), opaque to the fabric.
  `control-stream-server` BRANCHES `terminal-frame` BEFORE `applyStreamFrame` and hands it to an injected
  `onTerminalFrame` sink — it is NEVER store-applied, NEVER persisted (ADR-014 inv.3; `applyStreamFrame` gains
  NO terminal-frame branch). Routing identity is the CONNECTION-bound nodeId (`meta.nodeId`), re-stamped
  control-side, never the worker's self-declared `frame.nodeId` (the T6 discipline the credential path keeps).
- **Same-machine leg (control → the SEPARATE `aof mesh ui` process): a LOOPBACK relay.** The control launcher
  (same process as `control-stream-server`) runs `serveRelay` bound to the KNOWN loopback port named in
  `config.mesh.relay.url`; `onTerminalFrame` PUSHES each fabric-received frame INTO that loopback broker
  (control-side `createTerminalRelayPushTransport(config)`, a loopback client of its own broker). The SEPARATE
  `aof mesh ui` process subscribes to the loopback broker via the UNCHANGED
  `createTerminalMirrorSubscriberTransport(config)` + `startTerminalMirrorSubscriber` → `mirror.apply`.
  **`serveRelay`'s loopback bind — which DISQUALIFIES it from the cross-machine leg — is exactly what QUALIFIES
  it for this same-machine leg.**

**Why this over pure (b).** Pure option (b) (terminal-frames on the fabric AND a bespoke new control→UI
fan-out) is unnecessary: the fabric already carries the cross-machine leg, and the same-machine fan-out the
split-process topology needs (graph fact: `mesh-ui-serve.mjs`'s dependencies → 6 do NOT include
`control-stream-server.mjs`; there is no push channel between the two processes) is PRECISELY what `serveRelay`
(a loopback broker) already is. So the hybrid reuses BOTH as-built mirror seams and adds no bespoke fan-out
server — it is the minimal honest shape the two bind-addresses force.

**Operational constraint (documented, not accidental).** The `aof mesh ui` fleet face subscribes over LOOPBACK,
so it must run on the SAME machine as the control node's `aof mesh serve --serve` (mission-control lives on the
control node). A cross-machine fleet UI is a Phase-2 concern (it would dial the control node's fabric address —
another future), out of scope here, recorded so it cannot silently regress.

**The frozen envelope survives BOTH legs (inv.2).** `{ kind, nodeId, signal }` rides the fabric (branched by
`kind`; `signal` never parsed) and then the loopback relay (forwarded byte-for-byte; `signal` opaque)
UNCHANGED end-to-end. The mirror (`mesh-terminal-mirror.mjs`) is transport-agnostic and does not change.

**The exact production wiring (the developer builds this; the fitness `acd-terminal-stream-transport-wired`
REQUIRES it). This REWORKS the earlier option-(a) draft — the fleet-consumer leg survives; the worker + control
legs move.**
- **Worker fabric send — `src/worker-stream-client.mjs` (NEW method).** Add `sendTerminalFrame(sessionId, bytes)`
  (imports `buildTerminalFrameEnvelope` / `TERMINAL_FRAME_KIND` from `mesh-terminal-relay-bridge.mjs`), exported
  on the client's returned object. BEST-EFFORT, fire-and-forget: send ONLY when already connected (`connected &&
  handle != null`), swallow faults, and NEVER call `markDropped()`/`warn()` — a dropped terminal frame is a gap
  in the LIVE view, never a correctness fault, and must not thrash the reconnect state on a high-frequency
  stream (so it is NOT routed through `sendFrame`).
- **Worker PRODUCER — `src/mesh-launcher.mjs`, worker branch, the `createHandler({...})` call site.** KEEP
  `onOutputChunk` as a LITERAL key (the F12 / F-38.05 discipline), but re-point it from the loopback push to the
  FABRIC send: `onOutputChunk: (chunk, sessionId) => client.sendTerminalFrame(sessionId, String(chunk)),`.
  REMOVE the worker-side `terminalPush = createTerminalRelayPushTransport(config)` (the worker no longer pushes
  to the loopback relay — it cannot reach it off-host). `sessionId` is the driver's `capturedSessionId`
  (2nd arg); an early null-session frame is dropped downstream (inv.4).
- **Control fabric→loopback bridge — `src/control-stream-server.mjs`.** Import `TERMINAL_FRAME_KIND`; in
  `ws.on("message")`, BEFORE `applyStreamFrame`, branch `frame.kind === TERMINAL_FRAME_KIND` → call injected
  `onTerminalFrame(frame, { nodeId: meta.nodeId })` (re-stamp the connection nodeId), then return WITHOUT a
  store apply. Add `onTerminalFrame` to `startControlStreamServer`'s params (default a no-op). `applyStreamFrame`
  is UNCHANGED — it gains NO terminal-frame kind, so a terminal frame can never be store-applied (inv.3).
- **Control launcher — `src/mesh-launcher.mjs`, control branch.** Start the loopback broker on the KNOWN port:
  `serveRelay`/`relayMode(config, { port: <the port parsed from config.mesh.relay.url> })` — NEVER an ephemeral
  `port: 0`/`?? 0`. Construct the control-side loopback push `const controlTerminalPush =
  createTerminalRelayPushTransport(config)`, and pass `onTerminalFrame: (frame) => controlTerminalPush?.push(frame)`
  as a LITERAL key to the `startServer({...})` call. Options-gated (`options?.relay !== false`), clean-degrade on
  bind fault; both disposed on `handle.stop()`. **Test isolation from the live-mesh `:4182` collision is via
  `options.relay === false` (skip the bind) or an injected `serveRelay`/`relayMode`/`startServer` seam — NEVER
  production code binding a random port to protect fixtures.**
- **Fleet CONSUMER — `src/cli.mjs`, `meshUiCommand` (~1124). SURVIVES the earlier draft UNCHANGED.** Keep
  `startTerminalRelaySubscriber: (mirror) => startTerminalMirrorSubscriber({ transport: createTerminalMirrorSubscriberTransport(config), mirror }),`
  as a LITERAL key; `config` resolved best-effort via `loadWorkspace(projectDir)` (degrade to no-subscriber off
  a mesh workspace). `config.mesh.relay.url` is now the LOOPBACK broker url on the control machine.
- **Config keys (pre-existing; no new schema).** `config.mesh.relay.url` = the LOOPBACK broker url on the control
  node (e.g. `ws://127.0.0.1:<knownPort>/ws/relay`), naming the KNOWN port `serveRelay` binds AND the loopback
  port the fleet subscriber dials; `config.mesh.relay.controlNode` / `config.mesh.nodeId` gate the broker role.
  The CROSS-machine leg needs NO relay config — it rides the fabric the worker already dials.

**Structural invariants ADDED by this amendment (armed by `acd-terminal-stream-transport-wired`; ADR-014
invariants 1-4 stay armed by `acd-fleet-terminal-mirror-read-only`, unweakened).**
5. **The worker producer sends over the FABRIC.** `onOutputChunk` is a LITERAL key at the production
   `createHandler({...})` call site AND the launcher references `client.sendTerminalFrame` (the fabric send) AND
   `worker-stream-client.mjs` EXPOSES `sendTerminalFrame` — a revert to no-`onOutputChunk`, or a wiring to the
   loopback-only `serveRelay` push instead of the fabric send, TRIPS CI.
6. **The control node bridges fabric→loopback WITHOUT persisting, on a KNOWN port.** `control-stream-server.mjs`
   branches `terminal-frame` to an `onTerminalFrame` sink; `applyStreamFrame` carries NO terminal-frame kind
   (never a store apply — inv.3); the launcher passes `onTerminalFrame` at the `startServer({...})` call site,
   starts a `serveRelay()`/`relayMode()` broker, and binds it to the port derived from `config.mesh.relay.url`
   (NOT an ephemeral `?? 0`) — a missing branch, a persisted terminal-frame, an unwired sink, or an ephemeral
   bind each TRIPS CI.
7. **The fleet consumer subscribes over loopback.** `startTerminalRelaySubscriber` is a LITERAL key at the
   production `serveMeshUi({...})` call site in `cli.mjs` AND the CLI references
   `createTerminalMirrorSubscriberTransport` — a revert to `serveMeshUi({ projectDir, port, scope })` TRIPS CI.

**Consequences.**
- The terminal VIEW carries a frame on a REAL two-machine deploy: worker → (FABRIC) → `control-stream-server`
  → (loopback relay) → fleet mirror; F-38.06 is closed at the transport that is actually reachable off-host.
- The producer wiring is STRUCTURALLY required — a green suite can no longer coexist with an inert bridge (the
  milestone's defining F4/F-38.05 class, closed at this seam).
- inv.3 is HARDER: terminal-frames branch before the store apply and never persist; `applyStreamFrame` stays
  store-only.
- **Deferred to the task-03 `@manual` two-machine soak (un-fakeable):** the real cross-machine fabric leg
  carrying PTY bytes, the loopback control→UI hop on a real control node, the T14 no-credential-on-screen
  inspection, and reconnect/backpressure under a real high-frequency stream. The `@executable` lanes drive the
  REAL `worker-stream-client` → REAL `control-stream-server` (asserting the frame reaches `onTerminalFrame` and
  NEVER the store) and the REAL `serveRelay` loopback broker → REAL mirror in-process (producer-fed, never a
  convenience fake).

**Finding F-38.06b (structural-review ratification, 2026-07-19 — the `config.mesh.relay.url` double-duty
footgun): RULED — force the relay dial to LOOPBACK.** As-built, `config.mesh.relay.url` does DOUBLE DUTY: its
PORT + PATH drive the fabric control-stream endpoint (`configuredServicePort` / `configuredServiceUrlForAddress`,
which SUBSTITUTE the peer's fabric host and IGNORE the url's own host), while the control-side push
(`createTerminalRelayPushTransport`, `mesh-terminal-relay-bridge.mjs:114`) and the fleet subscriber
(`createTerminalMirrorSubscriberTransport`, `mesh-terminal-mirror.mjs:210`) dial the RAW url host. Because
`RELAY_PATH === DEFAULT_CONTROL_STREAM_PATH === "/ws/relay"` and both services share `servicePort`, the loopback
relay broker binds `127.0.0.1:<servicePort>` while the control-stream binds `<fabric-ip>:<servicePort>`
(coexisting). The hybrid connects end-to-end ONLY IF `relay.url` is LOOPBACK-hosted; an operator who sets it to
the control node's FABRIC address silently points the relay push + fleet subscriber at the control-stream server
(wrong protocol → the `{type:'joined'}` ack never arrives → both transports clean-degrade to NO frames, NO
error surfaced). That silent-break-on-the-most-intuitive-value is the exact silent-inertness class this
milestone exists to kill (F1/F4/F6/F-38.06). **Ruled (b), minimal hardening — APPLIED as built (FIX 2,
2026-07-19):** the relay dial does NOT trust the url host — a shared `loopbackRelayUrl(config)`
(`mesh-terminal-relay-bridge.mjs:43`) derives only the PORT + PATH from `config.mesh.relay.url` and FORCES the
host to `127.0.0.1`; BOTH `createTerminalRelayPushTransport` (`:146`) and `createTerminalMirrorSubscriberTransport`
(`mesh-terminal-mirror.mjs:215`) dial THAT, so the raw `config.mesh.relay.url` read is confined to the helper.
Rationale: `serveRelay` binds loopback BY CONSTRUCTION and the fleet UI runs on the control node BY DESIGN (the
Phase-2 note above), so there is NO legitimate non-loopback relay dial — the url's host is a config degree of
freedom that can only ever be wrong for the relay leg; forcing loopback also makes the host component
consistently ignored (matching `configuredServiceUrlForAddress`), resolving a latent inconsistency. No new
config key, no schema change. **Pinned:** `acd-terminal-stream-transport-wired`'s F-38.06b clause asserts both
factories dial `loopbackRelayUrl` and never the raw `config.mesh.relay.url` host — RED-if-reverted, so the
footgun cannot silently return. **DESIGN/VERIFICATION requirement to document:** the fleet
UI (`aof mesh ui`) runs on the control node, and `config.mesh.relay.url` is loopback-hosted
(`ws://127.0.0.1:<servicePort>/ws/relay`, its port = the control service port); the cross-machine leg needs no
relay config (it rides the fabric).

### AMENDMENT (2026-07-23, structural review of story 06 / task 04 closing BLOCKER F-38.06c — RATIFICATION of the BROWSER consumer; invariants 1-4 unchanged, invariant 1's `term.write` clause SCOPED, invariant 3 clarified against the new persistence)

**The decision and invariants 1-7 above stand unchanged and shipped.** Task 04 added the browser CONSUMER the
mirror never had (`ui/src/fleet/terminal-view/{stream,view-state}.mjs` + `FleetTerminalView.tsx`, mounted from
`Fleet.tsx`'s work-item card). Verified at source and by the extended
`acd-fleet-terminal-mirror-read-only`: the component registers no `onData`, calls `.send(...)` on no socket,
renders no input/textarea/contenteditable/send control, constructs its xterm with `disableStdin: true`, and
carries an explicit `read-only` LABEL (inv.1 + T14 + DESIGN V2/V5/V6); it resolves only through
`resolveTerminalStream` and dials only `/ws/terminal-view`, so a half-tuple yields NO url, NO header and NO
socket (inv.4 + V1/V8). This block records the three readings a future reader would otherwise get wrong.

**Codebase-graph grounding (fresh, this amendment — same build as the ADR-013 amendment above, 2026-07-23:
2009 nodes / 4859 edges).** `aof graph impact src/mesh-ui-serve.mjs` → dependencies → 6, now including
`src/mesh-terminal-mirror.mjs` and `src/global-mesh-query.mjs` — so the fleet face is the ONE module that holds
both halves of the join (the read shape that surfaces the tuple and the mirror that routes by it), which is why
the consumer belongs on its surface and nowhere else. `aof graph impact src/mesh-terminal-relay-bridge.mjs` →
dependents ← 4 (`control-stream-server`, `mesh-launcher`, `mesh-terminal-mirror`, `worker-stream-client`),
dependencies → **0** — the envelope builder stays a leaf, untouched by this task, so inv.2's frozen envelope is
structurally out of the blast radius. The `ui/` tree is OUTSIDE the built graph (the build was scoped to `src`);
the browser-side coupling asserted here is grep-and-infer, and it is instead pinned mechanically by the
whole-`ui/src/fleet`-surface clause of `acd-fleet-terminal-mirror-read-only`. The graph informs; the decision is
the architect's call.

- **Invariant 1's `term.write` clause is SERVER-SIDE ONLY — SCOPED here so a naive grep never mis-reads the
  browser.** `FleetTerminalView.tsx` DOES call `terminal.write(...)`: that is the RENDER direction — bytes the
  server already sent, painted into a browser-side xterm SCREEN. There is no PTY, no child process and no stdin
  on that side of the wire. Invariant 1's clause governs a source that feeds a WORKER's PTY stdin (the bridge,
  the mirror, the route) and structurally cannot bind to a browser. What DOES bind on the browser surface is the
  browser→socket direction, and that is what the fitness polices. **Any future re-reading of invariant 1 must
  keep this split** — collapsing it would either false-fire on every terminal renderer or, worse, invite someone
  to "fix" the false positive by weakening the clause that guards the real sink.

- **Invariant 3 is NOT breached by persisting the `session_id` — the mirror still writes nothing.** Task 04 adds
  a durable column, which reads at a glance like persistence arriving in the terminal story. It is not: what is
  persisted is the ADR-001 dispatch record's JOIN KEY (which session an assignment launched — a fact about the
  ASSIGNMENT, durable exactly as `runId` is), never terminal-frame CONTENT. The mirror
  (`mesh-terminal-mirror.mjs`) remains a pure in-memory ephemeral tail; `applyStreamFrame` still carries no
  terminal-frame kind and the terminal-frame branch still returns before any store apply
  (`control-stream-server.mjs:910-917`). Kill the mirror and the fleet loses the live view, not data — unchanged.

- **The view is OPT-IN — a `Watch terminal` toggle — which SUPERSEDES the decision's "opening an assignment's
  card … subscribes" prose.** The decision's Multiplexing bullet described discovery, not a binding invariant,
  and auto-subscribing every rendered card would open one socket per assignment on a fleet-wide board. As built,
  a card with a RESOLVED tuple renders its identity header (V1) and a toggle; the socket opens only on the
  operator's click. That is the better shape and is ratified here as the decision, so it is not later "restored"
  to auto-subscribe. A card with an UNRESOLVED tuple renders nothing at all — no header, no toggle.

**Accepted residuals (named, not fixed — neither is a regression introduced by this task).**
- **The routing tuple's TRUST SPLIT is asymmetric, and that is what makes it safe.** The `nodeId` half is
  CONTROL-authored (`target_node_id`, set at mint, never writable by any worker frame) and, on the frame side,
  re-stamped from the connection identity (F17, `mesh-launcher.mjs:729`). The `sessionId` half is
  WORKER-reported, but only by the assignment's holder. So a worker can at worst mis-point its OWN card at
  another session ON ITS OWN NODE; it can never target another node's card — the cross-node spoof F17 closed
  stays closed, and the new persist path opens no equivalent hole.
- **`routingKey` is a `::`-joined string (`mesh-terminal-mirror.mjs:42`), mirrored client-side by
  `terminalStreamKey`.** Pre-existing (story 06), but task 04 changes its exposure: the `sessionId` half now
  reaches the operator's subscribe AUTOMATICALLY rather than only by a hand-typed url. A node id containing
  `::` could therefore alias two distinct tuples. Derived node ids are `[a-z0-9-]+` (`node-identity.mjs`
  `sanitizeHostname`) so this is unreachable by derivation; only an OPERATOR-SET verbatim `config.mesh.nodeId`
  could contain `::`, and the worst outcome is one card mislabelling another node's bytes to an operator already
  authorized to view both. Accepted; the cheap hardening if it ever matters is to encode each half before the
  join, in `routingKey` and `terminalStreamKey` together.

### AMENDMENT (2026-07-23, BLOCKER F-38.06e — the terminal-frame protocol gains an END-OF-STREAM marker INSIDE the opaque `signal`, emitted from the driver's ONE settle point; the fleet route CLOSES the browser socket rather than injecting an in-band control message)

**This amendment ADDS a mechanism; it changes no decision and weakens no invariant 1-7.** QA's F-38.06e is
CONFIRMED at source: the terminal-frame protocol has **no end-of-stream signal at all**
(`buildTerminalFrameEnvelope`, `mesh-terminal-relay-bridge.mjs:63-69`, emits only `signal: { sessionId, bytes }`),
and the fleet route unsubscribes ONLY on the **browser's** own close/error (`mesh-ui-serve.mjs:393-394`). Nothing
in the system ever tells a watching browser that the session it is mirroring has ended. So
`TERMINAL_VIEW_STATES.ENDED` is **unreachable from a real session end**: after the worker's PTY exits, an open
view sits on `streaming` / `live: true` / `motion: "pulse"` indefinitely. That is DESIGN §Surface 3 **V9's exact
forbidden state** — "a dead stream must not masquerade as a live one" — and it is the F-38.05 class (a consumer
with no producer) relocated onto the state axis. It passed the task-04 review because the V9 contract row was
discharged by calling the `terminalViewOnClose` reducer DIRECTLY, never by a transition a real stream caused.

**Codebase-graph grounding (fresh, this amendment — `aof graph build src`, 2026-07-23: 2009 nodes / 4859 edges).**
`aof graph impact src/mesh-terminal-relay-bridge.mjs` → dependents ← 4 (`control-stream-server`, `mesh-launcher`,
`mesh-terminal-mirror`, `worker-stream-client`), dependencies → **0** — the envelope builder is a pure leaf that
ALL FOUR hops already import, so a sibling builder added there is visible to every hop with no new edge and no
new module. `aof graph impact src/worker-stream-client.mjs` → dependents ← **1** (`mesh-launcher.mjs` only),
dependencies → 1 (that same bridge leaf) — the worker send seam is a private, single-consumer surface, so adding
a send method there cannot leak into any other role. `aof graph impact src/mesh-terminal-mirror.mjs` → dependents
← 2 (`cli.mjs`, `mesh-ui-serve.mjs`) — the mirror has exactly two consumers, so widening its listener contract is
a two-call-site change. This is what makes the ruling below cheap: the whole end-to-end path already exists and
every hop already imports the leaf that would carry the marker. The graph informs; the decision is the
architect's call.

**THE DECIDING SOURCE FACT — `finish()` is the ONE settle point, and it covers `needs-input` TOO.**
`driveInteractiveClaudeSession`'s `finish(result)` (`mesh-worker-execution.mjs:984-1000`) settles EXACTLY once
for ALL THREE outcomes and calls `cleanupSubs()`, disposing `dataSub` — i.e. **`onOutputChunk` stops being called
at precisely that line**, which is the literal definition of "this stream has ended". `done`/`failed` reach it via
`term.onExit` (`:1031-1033`); `needs-input` reaches it via the sentinel branch, which **`term.kill()`s the PTY
first** (`:1025-1028`) because — the driver's own comment at `:1021-1024`, citing RESEARCH §4.3 — a human resumes
via a FRESH `claude --resume` process on a NEW session, never by reattaching to a still-running one. So a
`needs-input` session's stream is **genuinely over**, and `finish` also resolves the `sessionId` deterministically
(`capturedSessionId ?? await watchPromise`, `:990-997`), guaranteeing the end frame has a tuple to route on.

**RULING — (a), shaped as an end marker INSIDE the opaque `signal` on the EXISTING kind. (b) is REJECTED. (c) is
ADOPTED only as a subordinate backstop.**

- **(a) CHOSEN — a real end-of-stream signal, emitted from `finish()`, riding INSIDE `signal` on the EXISTING
  `TERMINAL_FRAME_KIND`.** A sibling builder `buildTerminalEndEnvelope(nodeId, sessionId)` →
  `{ kind: TERMINAL_FRAME_KIND, nodeId, signal: { sessionId, end: true } }`. **Inside `signal`, NOT a new `kind`
  and NOT a fourth top-level key** (inv.2 is honoured either way, but the choice is deliberate): a second `kind`
  would need a new branch at THREE hops that switch on kind — `control-stream-server`'s
  `frame.kind === TERMINAL_FRAME_KIND` branch, the loopback push, and `mirror.apply`'s kind guard — and every one
  of those is a place a future refactor drops a branch and re-inerts the seam, which is this milestone's entire
  failure history. Riding inside `signal` means the control path needs **zero** new branches: the existing branch
  forwards it verbatim with the F17 nodeId re-stamp, and `routingKey(envelope.nodeId, signal.sessionId)` routes it
  to exactly that stream's subscribers, so inv.4 holds **by construction** with no new routing surface. The signal
  is already the sanctioned home for "routing metadata the fleet needs" (decision bullet 1).
- **The PRODUCER is `finish()`, via a SEPARATE optional hook wired as a LITERAL key.** `finish` calls
  `options.onSessionEnd?.(capturedSessionId)` — a hook DISTINCT from `onOutputChunk` (never a sentinel smuggled
  through the byte hook — see the in-band ruling below) — wired at the SAME production `createHandler({...})`
  call site in `mesh-launcher.mjs` that already carries `onOutputChunk` as a literal key, to
  `client.sendTerminalEnd(sessionId)`. Best-effort fire-and-forget on the fabric, EXACTLY like
  `sendTerminalFrame`: send only when connected, swallow faults, and NEVER `markDropped()`/`warn()` — a lost end
  frame is a stale view, never a correctness fault, and must not thrash the reconnect state (the inv.5 discipline).
- **The fleet route CLOSES the browser socket; it does NOT inject an in-band control message.** `mirror.apply`
  delivers the end to that tuple's subscribers distinctly (an additive second listener argument, e.g.
  `listener(signal.bytes, { end: true })` — the two consumers are `cli.mjs` and `mesh-ui-serve.mjs`, per the
  graph), and the terminal-VIEW listener responds with `ws.close()`. **TWO reasons this must be a transport close
  and never a marker in the byte stream:** (1) the browser writes received bytes STRAIGHT into xterm, so making it
  sniff control content out of terminal bytes is the "JSON-parse-then-branch on terminal content" shape inv.2
  forbids in spirit and turns the dumb painter into a parser; (2) **security** — a worker's own PTY output would
  then be able to FORGE an end by printing the marker, letting an agent (or anything it runs) close the operator's
  view at will and defeat the T14 `@manual` on-screen-secret inspection. At the transport layer that forgery is
  structurally impossible.
- **The browser needs NO change.** `socket.onclose` → `terminalViewOnClose(current)` → `ENDED`
  (`ui/src/fleet/terminal-view/view-state.mjs:88-92`), and its already-shipped rule that an
  ALREADY-`DISCONNECTED` view stays disconnected keeps a transport failure from being laundered into a clean
  finish. The reducer was always correct; it simply never received the event. **This amendment makes the existing
  reducer REACHABLE rather than replacing it** — which is also why the V9 lane must be re-driven end-to-end and
  not by calling the reducer.
- **(b) REJECTED — the mirror must NOT close subscribers off the assignment's terminal state.** It would require
  `mesh-terminal-mirror.mjs` to READ assignment state, putting a store/registry dependency into the one module
  inv.3 deliberately keeps store-free and transport-agnostic (the 2026-07-19 ratification's own words: "a pure
  in-memory live-tail with no fs/store import and no durable write"). That inverts inv.3 to fix V9. It is also
  semantically wrong: the assignment's terminal state is a CONTROL-side fact arriving on a DIFFERENT transport at
  a DIFFERENT time from the PTY's actual exit, and it gets `needs-input` exactly backwards — that assignment
  state is `running`, so (b) would keep painting "live" forever on the one case where a human is being waited on.
- **(c) ADOPTED AS A SUBORDINATE BACKSTOP ONLY — never the mechanism.** A card MAY degrade its view from the
  assignment state it already holds, to cover the UN-SIGNALLED death (worker crash, machine off, fabric partition)
  where no end frame is ever emitted and no terminal status frame ever arrives either. It is derived, lagging and
  lossy, and on `needs-input` it is actively wrong (see above), so it can never stand in for (a). It composes
  with, and does not pre-empt, the designer's V10 state-aware-copy ruling.
- **EXPLICITLY REJECTED — a client-side inactivity timeout.** "No bytes for N seconds ⇒ ended" would invent an
  `ended` the source never asserted, which is V9's own rule run backwards. A distinct `stale` state that says
  literally "no output for N s" would be honest, but it is NOT `ended` and is NOT this fix.

**Structural invariant 8 (NEW; invariants 1-7 stand unchanged).**
8. **The stream's END is PRODUCED, not inferred.** A terminal-frame end marker exists inside the opaque `signal`
   on the EXISTING `TERMINAL_FRAME_KIND` (never a fourth top-level envelope key, never a second `kind`); it is
   emitted from the driver's single `finish()` settle point for ALL THREE outcomes (`done`/`failed`/`needs-input`)
   through a hook DISTINCT from `onOutputChunk`, wired as a LITERAL key at the production `createHandler({...})`
   call site; the mirror routes it by the SAME (nodeId, sessionId) tuple (inv.4 unchanged) and never persists it
   (inv.3 unchanged); and the fleet terminal-VIEW route responds by CLOSING the browser socket — it never sends
   an in-band control message down the byte stream, so a worker's PTY output can never forge a stream end. A
   protocol with no end marker, an end emitted anywhere but the settle point, an unwired hook, or an in-band
   marker each TRIP.

**Consequences.**
- V9 becomes reachable from a REAL session end, for all three outcomes, with **no change to the browser state
  machine** and **no new branch on the control path** — the smallest honest shape the existing hops allow.
- inv.3 is protected from the (b) shortcut that would have coupled the ephemeral mirror to the system of record.
- **The V9 acceptance lane must be re-driven END-TO-END** (real driver `finish` → real fabric → real mirror →
  real `/ws/terminal-view` → an observed browser-side close), because "call the reducer and assert it returns
  `ended`" is precisely the evidence shape that let F-38.06e ship.
- **Armed RED now** by `acd-terminal-view-live-observable` clause (b) — see the fitness register.

---

## ADR-015: The worker checks out a REAL branch (`aof/mesh/<itemRef>-<assignmentId>`) not a detached HEAD, and on a successful run PUSHES it via the ADR-009 `GIT_ASKPASS` shim BEFORE the worktree is force-removed — retaining the worktree until the push succeeds. The push uses a SEPARATE write-scoped token minted ONLY at push time; the clone credential stays `contents:read`. This re-opens SECURITY T9

**Status:** Accepted
**Date:** 2026-07-18
**Story 07. Independent of stories 05/06 (needs only a run that produces commits); precedes story 08 (memory syncs only once output is durable). Widens the least-privilege credential posture story 02 established — security owns the T9 re-model and the rewrite of `acd-minted-token-scoped-single-repo` to permit the write-token ONLY at the push seam.**

**Codebase-graph grounding (fresh, this decision).** `aof graph impact src/mesh-worktree.mjs` → imported ONLY by `mesh-worker-execution.mjs` (a leaf; `addWorktree`/`removeWorktree`/`sweepRetainedWorktrees` are its verbs). `mesh-worker-execution.mjs` owns `buildAskpassShim` (`:349`) — the SAME `GIT_ASKPASS` one-shot the clone uses (ADR-009's PULL). So the branch+push change lands in exactly the two files that already own the worktree + askpass mechanics; blast radius is that pair. The graph is one input; the decision is the architect's call.

**Context.** MEASURED live against the real remote (RESEARCH §4.1, confirmed on `let-shield-portal`): `addWorktree` runs `git worktree add --detach` (a detached HEAD, no branch — `mesh-worktree.mjs:101`); a `done` outcome force-removes the worktree (`removeWorktree(..., { force: true })`, `mesh-worker-execution.mjs:892`); there is NO `git push` anywhere in `src/`. The earlier "successful" chore soak's entire output existed only as an untracked local file on the worker — never committed, never pushed, never merged; garbage-collected the instant the worktree was force-removed. Detached-HEAD-then-force-remove is correct ONLY for a throwaway chore whose deliverable is a side effect; for feature work whose deliverable IS the diff, the output must survive. The credential is code-locked to `contents:read` (`mesh-clone-credential-provider.mjs:181`), guarded by `acd-minted-token-scoped-single-repo` (SECURITY T9) — a `git push` is a `contents:write`, so durable push-back necessarily re-opens T9 (RESEARCH §4.2).

**Decision.**
- **A REAL branch, not a detached HEAD (DOCUMENTED DEFAULT naming).** The worker checks out a real branch named `aof/mesh/<itemRef>-<assignmentId>` — a scoped, collision-free convention keyed by `assignmentId` (mirroring `meshWorktreePath`'s assignmentId key, `mesh-worktree.mjs:47`; `itemRef` sanitized to a git-ref-safe slug for readability). Implemented either by changing `addWorktree`'s `--detach` call to create the branch, or a `git switch -c <branch>` inside the worktree before the run — the Three Amigos pick the exact mechanic; the invariant is "a named branch, not detached HEAD."
- **PUSH on a successful run, BEFORE force-remove, reusing the ADR-009 shim.** On a `done` outcome the worker runs `git push origin <branch>` from inside the worktree, reusing `buildAskpassShim` (`mesh-worker-execution.mjs:349`) — the SAME `GIT_ASKPASS` credential-transmission path the clone uses (ADR-009's PULL), pointed at a push instead of a clone; NO new wire mechanism. The push happens BEFORE `removeWorktree`, and the worktree-retention MUST NOT remove until the push succeeds — a failed push RETAINS the worktree (the `failed`-style retention, so the commits are recoverable + retryable), never force-removes over unpushed work.
- **Credential widening — the §4.2 PREFERRED two-token shape (pinned; security owns the T9 re-model).** The CLONE credential stays `contents:read` (ADR-010, unchanged); a SEPARATE write-scoped token — `contents:write`, plus `pull_requests:write` ONLY if auto-opening a PR — is minted ONLY at push time, isolating the write grant to the one instant it is needed. Mechanism follows ADR-009's PULL by analogy: the worker requests a WRITE credential at the push seam via its own frame-pair / distinct write-scoped mint request, authorized by the SAME holder check (`target_node_id === connectionNodeId`, SECURITY T6) and single-repo-scoped, minted through the ADR-010 provider extended to the write scope. The clone mint is NOT widened. This re-opens T9: SECURITY owns re-modelling the threat and rewriting `acd-minted-token-scoped-single-repo` so it permits the write-token EXCLUSIVELY at the push seam and still forbids a write scope on the clone mint. This ADR pins the STRUCTURE (two tokens, write-scoped only at push, via the same askpass shim); the minting policy (TTL/scope/authority) stays SECURITY's residual, exactly as ADR-005/009/010 deferred the clone mint's.
- **What "done" means — DOCUMENTED DEFAULT: a PUSHED BRANCH (the honest minimum); a PR is optional/manual.** A successful run means the branch is pushed to `origin` for review. Opening a PR is a separate, optional/manual step (no `pull_requests:write` needed for the default); auto-opening a PR via the GitHub API with the wider scope is an opt-in the operator may enable, not the default. "Merged" is explicitly NOT the worker's job — a human reviews and merges (story 08's syncback triggers on that merge).

**Structural invariants (each testable; armed by `acd-write-token-scoped-to-push`).**
1. **The clone mint stays `contents:read`.** No `contents:write` on the CLONE credential path — the write scope appears ONLY at the push seam (the T9 rewrite pins this cross-seam).
2. **The write token is minted ONLY at push time**, single-repo-scoped, holder-authorized — never a run-long standing write credential, never widened onto the clone.
3. **The worktree is NOT removed until the push succeeds** — a failed push retains (the `failed`-style branch), never force-removes over unpushed commits.
4. **The push reuses the ADR-009 `buildAskpassShim`** — no new credential wire mechanism; the token never persists into `.git/config`, `process.env`, or a log (the inherited `acd-worker-clone-no-credential-persisted` discipline holds for the push token too).

**Consequences.**
- A dispatched milestone/story's real diff survives — pushed to a named branch for review — the difference between a mesh that does disposable chores and one that does real work.
- The least-privilege posture is preserved for everything except the push instant; the clone stays read-only.
- **DOCUMENTED DEFAULTS for STATE.md:** branch = `aof/mesh/<itemRef>-<assignmentId>` (sanitized); "done" = pushed branch + optional/manual PR (not merged, not auto-PR by default). Security re-opens T9 and rewrites `acd-minted-token-scoped-single-repo`.
- **`acd-write-token-scoped-to-push` is SPEC, armed at BUILD** — the push + write-mint path does not exist yet; armed against the real push seam (SECURITY co-owns it with the T9 rewrite).

### AMENDMENT (2026-07-18, structural review of story 07 as-built — RATIFICATION, no decision changed)

The decision above **stands unchanged and shipped**. This block records the AS-BUILT credential-pull wire
so a future reader does not mis-read decision 2/invariant 4's "no new wire mechanism" as forbidding the new
frame pair the review found — the two clauses govern DIFFERENT wires, and both were honoured:

- **The credential PULL is a NEW dedicated frame pair — this is decision 3's "its own frame-pair" option,
  taken as-built, NOT a footprint beyond the ADR.** Decision 3 already pinned "the worker requests a WRITE
  credential at the push seam via **its own frame-pair** / distinct write-scoped mint request." As built that
  is `write-credential-request` (up) / `write-credential` (down): `applyWriteCredentialRequestFrame`
  (`control-stream-server.mjs`), `requestWriteCredential` (`worker-stream-client.mjs`), dispatched by a new
  `applyStreamFrame` branch. The clone-credential-request frame was NOT extended — a `requestWriteCredential`
  collaborator hung on the clone path would trip the pre-existing F12 guard
  `acd-clone-credential-pull-not-pushed` (its `CREDENTIAL_SHAPED` clause), so a FULLY SEPARATE frame pair was
  the F12-correct shape. The git-side PUSH transmission (decision 2 / invariant 4) separately reuses
  `buildAskpassShim` VERBATIM in `pushWorktreeBranch` — that is the wire the "no new wire mechanism" clauses
  govern, and it added none.
- **The new pull honours the clone pull's holder-authorization gates VERBATIM (verified at source).**
  `applyWriteCredentialRequestFrame` reproduces `applyCloneCredentialRequestFrame`'s three gates in order:
  T6 holder (`existing.target_node_id === connectionNodeId`, resolved from the CONNECTION-bound
  `options.nodeId`, never `frame.nodeId`) → F15 workspace-match (refuses `workspace-mismatch` on
  `frame.workspaceId !== existing.workspace_id`, and mints with the ROW's own `existing.workspace_id`, never
  the requester's) → F16 active-state (`isActiveAssignmentState(existing.state)`, imported, not a drifting
  copy). The worker frame never steers which repo/scope is minted; `autoPr` is control-side only, never read
  off the frame.
- **The write token is minted ONLY at the push seam and single-repo-scoped.** The worker calls
  `requestWriteCredential` only inside the `completed.state === "done"` branch, immediately before
  `pushWorktreeBranch` and before any force-remove. The mint is `createGithubAppPushMintProvider` — a FULLY
  SEPARATE export from the clone mint (no shared identity/JWT/scope helper), body
  `{ repositories:[repo], permissions:{contents:"write"}(+pull_requests:"write" iff autoPr) }`; the clone
  mint's `{contents:"read"}` body is byte-unchanged. Both mints are wired as LITERAL keys at their production
  call sites (`mintWriteCredential:` at `startServer({...})`, `requestWriteCredential:` at
  `createMeshWorkerExecutionHandler({...})`), before the test-injection spreads — the F12 discipline, so the
  path is producer-wired, not test-only. `resolveWriteCredentialProvider` returns `undefined` for
  `env-token`/unconfigured (→ `defaultMintWriteCredential` → `null`), so a static standing PAT is never a
  write grant.

**Consequence for the arch-test set:** the as-built is fully covered by `acd-write-token-scoped-to-push`
(invariants 1–4, incl. a behavioural non-holder refusal against the real `applyWriteCredentialRequestFrame`)
and the rewritten two-seam `acd-minted-token-scoped-single-repo`. No further fitness function is owed. The
only residual is a STALE source comment (below, in the review findings) that claims the launcher "does not
yet supply" the resolver — the launcher DOES supply it; the comment is a documentation defect, not a wiring
gap.

---

## ADR-016: Worker-verified knowledge syncs to the control node by RIDING GIT — record docs, `RETROSPECTIVE R<n>`, `ADR-NNN` blocks are plain markdown that travels on story-07's push-back/merge; the graphify RECALL INDEX (`graphify-out/graph.json`) is gitignored, machine-local, DERIVED, and NEVER crosses the mesh. The control node rebuilds ITS index by a documented `git pull` + `aof work memory ingest` — no index bytes on the wire

**Status:** Accepted
**Date:** 2026-07-18
**Story 08. Depends on story 07 (durable output first — memory syncs only once the markdown reaches the control node's checkout). The last story that makes milestone 38 a mesh doing REAL verified work end-to-end. No new wire protocol — knowledge rides git, the index is rebuilt locally.**

**Memory-recall grounding.** `aof work memory recall` surfaced the durable-index principle this ADR rests on: m10/ADR-005 — "both the records AND the graph are fully rebuildable from `.md` source; the backend holds no fact absent from its `.md`"; m10/R3 (near-miss) — "a half-covered git-ignore passes a green suite; extend the FULL ignore baseline"; m05/ADR-005 — "the derived index lives git-ignored." This ADR is the mesh-transport corollary of those: the index is derived, so it is never the payload.

**Context.** MEASURED (RESEARCH §4.4, source read): the durable knowledge a verify produces — RETROSPECTIVE `R<n>` lessons, `ADR-NNN` blocks, updated record docs — is plain markdown committed into the repo, so once story-07's push-back lands and the branch merges, it travels to the control node by ordinary `git pull` like any other file. The graphify RECALL INDEX (`<projectRoot>/graphify-out/graph.json`, `src/graph-normalize.mjs`) is gitignored (`.gitignore:4`, enforced by `src/aof-gitignore.mjs`) and machine-local by design — a DERIVED cache rebuilt from the markdown, not a source of truth; `aof work memory ingest` only updates whichever machine runs it. So there is NOTHING to transmit over the mesh: the knowledge rides git, and each machine rebuilds its own index locally.

**Decision.**
- **Durable knowledge rides GIT, not the mesh.** Record docs, `RETROSPECTIVE R<n>`, and `ADR-NNN` blocks are markdown that reaches the control node when story-07's pushed branch merges and the control node pulls — no mesh frame carries them. This ADR adds NO wire protocol.
- **The recall index NEVER crosses the mesh — the load-bearing invariant.** No `graphify-out/graph.json` (or any derived index/graph bytes) is ever placed on a relay frame, a directive/status frame, or any mesh stream. It is gitignored, machine-local, and DERIVED (m10/ADR-005 — fully rebuildable from the `.md`); transmitting it would be shipping a cache that each machine can and must rebuild itself.
- **The control node rebuilds ITS index by re-ingesting its own checkout — DOCUMENTED DEFAULT: a MANUAL step (the honest minimum).** After a worker-verified milestone/story's branch merges, the control node runs `git pull` (the markdown arrives) + `aof work memory ingest` (its OWN `graphify-out/graph.json` rebuilds from the now-shared markdown). This is a documented operator step in this story. An AUTOMATIC re-ingest — the control node detects a merged worker-branch (or a worker-`done` assignment whose record docs changed) and re-ingests itself — is the RICHER option, noted as future work; the manual step is what this story pins so the end-to-end is provable without a new watcher/hook.

**Structural invariants (each testable; armed by `acd-memory-index-never-on-mesh`).**
1. **No index/graph bytes on any mesh stream.** No source places `graphify-out/`, `graph.json`, or a normalized-index payload onto a relay frame / directive / status frame / any mesh transport — the index is never the payload.
2. **`graphify-out/` stays gitignored + derived** — the m10/R3 full-ignore-baseline discipline holds; the index carries no fact absent from the markdown, so a lost index rebuilds from `git pull` + `ingest`.
3. **Syncback is a re-ingest of the control node's OWN checkout** — the trigger runs `git pull` + `aof work memory ingest` locally; it does not fetch a remote index or a peer's cache.

**Consequences.**
- Knowledge produced on a worker becomes recallable on the control node in the next `aof:refine`/`aof:continue` — via `aof work memory recall` — once the branch merges and the control node re-ingests.
- No new mesh protocol, no index-transport threat surface — the mesh stream carries nothing here; git carries the markdown, each machine rebuilds its own index.
- **DOCUMENTED DEFAULT for STATE.md:** the syncback trigger is a documented MANUAL step (`git pull` + `aof work memory ingest` on the control node after the worker-branch merges); an auto re-ingest on merge/`done`-with-record-doc-change is noted as the richer future option, not built this story.
- **`acd-memory-index-never-on-mesh` is SPEC, armed at BUILD** — the syncback path does not exist yet; armed against the real trigger + the mesh-frame builders it must never touch.

---

## Fitness functions (this milestone)

Each ADR's structural invariant is encoded as an arch-test under `test/arch/`, wired into `scripts/test.mjs`
and failing CI on violation. They live HERE, never in a task `.feature` (a structural assertion is a fitness
function, not a Gherkin scenario):

1. `acd-session-presence-additive` (ADR-001) — the presence assembler's key set is the frozen FIVE
   `[nodeId, heartbeatAt, activeRuns, sessions, aofVersion]`, order-sensitive; a no-session record's first four
   keys are byte-identical to the m23 four-key record (additive, absent-is-benign).
2. `acd-session-record-frozen` (ADR-002) — the session-record assembler returns EXACTLY its ordered key set
   `[nodeId, workspaceId, repo, assistant, startedAt, lastPingAt]`.
3. `acd-session-ttl-reuses-isstale` (ADR-002) — the session-liveness path IMPORTS `isStale`/`isNodeStale` from
   the shared module and hand-rolls NO parallel staleness (no second `Date.parse(...) - ... >` comparison in the
   session path).
4. `acd-session-ttl-self-expires` (ADR-002) — behaviourally, a session whose `lastPingAt` is older than the TTL
   is NOT live (self-expires); one AT the TTL is still live (strict `>`).
5. `acd-presence-aggregates-node-workspaces` (ADR-003) — `assembleCurrentPresenceRecord` reads
   `global_node_workspaces` for the node and does NOT read from a single `listItems(ws.workDir)` as its sole
   item source.
6. `acd-worker-clone-target-scoped` (ADR-005) — the clone target is built ONLY from the dedicated
   `meshCheckoutPath` root under the global mesh home; no `os.tmpdir()`, no path built from directive/ref text.
7. `acd-worker-clone-no-credential-persisted` (ADR-005) — the clone path writes NO credential into `.git/config`
   (no `url.<x>@` rewrite, no durable `credential.helper store`) and logs no credential value.

**Added at the as-built amendment (2026-07-12, `aof:verify 38`) — ADR-004 AMENDMENT + ADR-008:**

8. `acd-session-run-reconciliation` (ADR-004, as-built) — REWRITTEN against the real producer: the REAL assembler
   (hermetic repo, real run record, real session record) publishes an ALREADY-SUBSUMED `sessions[]`; the render
   helper is proven separately as a pure formatter. Self-check: a planted un-subsuming assembler shape renders a
   duplicate line the real one does not.
9. `acd-active-runs-frozen-string-array` (ADR-004 AMENDMENT + ADR-008) — the wire's `activeRuns` is a bare
   `string[]` on EVERY surface, in BOTH languages: the REAL producer emits only string elements (behavioural);
   every declared type is `string[]` / `Vec<String>` (TS + Rust); and no source binds an `activeRuns` element —
   directly or through a local alias — and reads an object field off it (`.ref`/`.title`/`.runId`/`.workspaceId`/
   `.get("ref")`). Self-check: the VERBATIM F1 (JS) and F8 (Rust) defect lines, plus object-shaped declarations in
   both languages, are each flagged by the same detectors the real tree passes.
10. `acd-captured-producer-fixture` (ADR-008) — the cross-language surface's fixtures are REAL CAPTURED producer
    stdout (provenance required), are still PRODUCER-SHAPED (compared against a record assembled by the real
    producer in-test — a producer shape-change with a stale fixture fails CI), and the TWO implementations of the
    ADR-004 rule render the SAME line for the SAME captured payload. Self-check: an un-captured fixture, a
    producer-drifted fixture (object-shaped `activeRuns` / 4-key presence / invented session key) and a drifted
    Rust render literal are each flagged.
11. `acd-rendered-component-fed-by-route` (ADR-008) — the component production ACTUALLY mounts renders the
    feature: the REAL route data source (`queryGlobalMeshStatus`) returns a `workspaces`-carrying payload for BOTH
    scopes (so the GLOBAL branch is what mounts), the fleet face keeps ONE status source, and EVERY per-node card
    renderer in `Fleet.tsx` derives its current-work line from the ONE shared projection. Self-check: the analyzer,
    run over the real `Fleet.tsx` with the F9 defect re-planted, reports exactly `GlobalNodePanel`.

**Added at ADR-009 (2026-07-13, `aof:verify 38` — finding F12, BLOCKER):**

12. `acd-clone-credential-pull-not-pushed` (ADR-009 + ADR-008; SECURITY T4) — the clone credential is PULLED on a
    clone miss, never pushed: (a) `buildDirectiveFrame` still returns EXACTLY the five 35/ADR-002 keys and a
    credential passed to it reaches no frame (behavioural, real producer); (b) the directive build/dispatch path
    (`buildDirectiveFrame`/`sendDirective`/`dispatchDirectiveOverTargets`) names no credential/token/secret —
    structurally forbidding candidates (a) and (b); (c) **the F12 guard** — the production `createHandler({...})`
    call site in `mesh-launcher.mjs` passes no STATIC credential, and every credential-shaped collaborator
    `createMeshWorkerExecutionHandler` consumes must be a LITERAL key there, never reachable only through the
    `workerExecutionOptions` TEST-INJECTION spread. Self-check: a credential key planted on the frozen directive
    frame, a mint/push planted on the dispatch path, a static credential planted at the production call site, and
    **the F12 shape itself** (the `requestCloneCredential` resolver consumed by the handler but supplied by no
    producer — reachable only through the test spread) ALL trip the detector; the correct PULL wiring (the
    resolver as a literal key at the production call site) stays clean. Each plant asserts it genuinely rewrote
    the source before asserting the trip (the tree is CRLF — a non-landing plant would leave the self-check
    vacuous, which is the very failure this milestone is about).

**Added at ADR-010 (2026-07-13, story 02 `clone-credential-mint`) — SPEC, armed at BUILD (deliberately deferred, per ADR-008 / SECURITY's F5/F6 precedent — a detector against the not-yet-existing provider-selection wiring would be vacuous or RED):**

13. `acd-clone-credential-provider-config-driven` (ADR-010; SECURITY T10 backstop; architect/developer-owned) —
    the mint provider is resolved from `config.mesh.repo.credential.provider` at the `mintCloneCredential` seam
    (`env-token` default | `github-app`), with NO single hard-coded provider; the launcher passes the resolved
    provider as a **LITERAL `mintCloneCredential:` key** at the production `startServer({...})` call site, BEFORE
    and OUTSIDE the `controlStreamServerOptions` TEST-INJECTION spread (the F12 discipline generalised to the
    provider); the `env-token` path is byte-unchanged when unconfigured; a present-but-unknown provider throws
    LOUDLY at startup (never a silent `env-token` fallback). Self-check plants that MUST trip: (1) a hard-coded
    single provider ignoring config; (2) the F12 shape — `mintCloneCredential` reachable only through the test
    spread, no literal key at the production site; (3) a `github-app`-fault catch that silently returns the
    `env-token` default (T10 fall-through); (4) an `env-token`-default mutation breaking byte-identity. Negative
    control that stays clean: the config-driven selector (env-token unconfigured / github-app configured) passed
    as a literal key at the production site. Synthesized plants joined with explicit `"\n"` (CRLF tree), the real
    source asserted clean under the detector first, each plant asserted to have LANDED before asserting the trip.
    **DEFERRED to build:** the `resolveCloneCredentialProvider` seam + the launcher literal-key wiring do not
    exist yet; the detector's design is tied to that call-site shape, so it is armed at build, not authored now.
    (SECURITY-owned `acd-clone-app-key-not-relayed` (F5) + `acd-minted-token-scoped-single-repo` (F6) — the
    App-key-not-relayed + single-repo-mint invariants ADR-010 §6.2/§6.3 states — are likewise SPEC/armed-at-build,
    owned + fully plant-specified in SECURITY.md; not duplicated here.)

**Added at ADR-011–ADR-016 (2026-07-18, stories 03–08 — the durable/interactive-worker mega-scope) — all SPEC, armed at BUILD (each story is `not-started`; a detector against absent production wiring would be vacuous or RED, the ADR-008 / SECURITY-F5/F6 deferral precedent):**

14. `acd-cross-org-key-isolation` (ADR-011; SECURITY T12) — the `github-app` mint's App identity is resolved from
    the mint's OWN `workspaceId` (a `resolveWorkspaceAppIdentity`-shaped per-workspace seam), never a single
    launch-workspace identity applied to every mint; a null-resolved identity THROWS the loud coded
    `clone-credential-mint-failed` → `assignment-repo-unavailable`, never falls back to a sibling workspace's key;
    and `resolveGithubAppPrivateKey`'s default directory is the code-enforced `<meshRoot>/credentials/` via
    `globalMeshPaths`, never a config-supplied / sync-scoped path. Plant: a static single-App provider applied to
    all workspaces; a null-identity fall-through to the launch App; a sync-folder default dir — each trips.
15. `acd-fleet-face-single-mutation-route` (ADR-012; SECURITY T13) — the fleet face (`mesh-ui-serve.mjs`) exposes
    EXACTLY ONE mutation route, `POST /api/mesh/assign`, and it mints only through the existing `assignWork` verb
    (no `insertAssignment`/`global_assignments` write reachable except through the gated verb); a gate miss maps to
    a coded non-200, never a 200; the face keeps its ONE loopback `http.createServer`, no low-level writer import.
    Plant: a second write route; a write path that bypasses `assignWork`; a 200 on a gate miss — each trips.
16. `acd-worker-driver-no-headless-print` (ADR-013) — the worker driver path emits NO `claude -p` + `--output-format
    json` one-shot; the interactive `claude` launch resolves through the `terminal-providers` seam; the command to
    run is typed into PTY stdin (a directive field, not a `-p` prompt argv); `session_id` is captured (not
    discarded); a `needs-input` outcome takes the retain-worktree branch, never the `done` force-remove. Plant: a
    re-introduced `claude -p` driver; a discarded `session_id`; a needs-input path that force-removes — each trips.
17. `acd-fleet-terminal-mirror-read-only` (ADR-014; SECURITY T14) — no source consuming a relay terminal-frame (or
    a fleet terminal-VIEW message) calls `term.write` / feeds a worker PTY stdin (no mesh→PTY input path); the relay
    envelope is untouched (terminal bytes ride the opaque `signal` as a new `kind`, no JSON-parse-then-branch on
    terminal content); the fleet mirror writes no durable record (the `mesh-presence-subscriber` in-memory
    discipline). Plant: a fleet frame routed into `term.write`; a durable write of streamed bytes — each trips.
18. `acd-write-token-scoped-to-push` (ADR-015; SECURITY T9 re-opened, co-owned) — the CLONE mint stays
    `contents:read`; a `contents:write` scope appears ONLY at the push seam, single-repo-scoped + holder-authorized
    + minted only at push time (never a run-long standing write credential, never widened onto the clone); the
    worktree is not removed until the push succeeds; the push reuses `buildAskpassShim` (no new credential wire, no
    token in `.git/config`/`process.env`/log). Plant: a `contents:write` on the clone mint; a force-remove before a
    successful push; a standing write token — each trips. (SECURITY owns the `acd-minted-token-scoped-single-repo`
    rewrite that permits the write-token EXCLUSIVELY at the push seam.)
19. `acd-memory-index-never-on-mesh` (ADR-016) — no source places `graphify-out/`/`graph.json`/a normalized-index
    payload onto a relay frame / directive / status frame / any mesh transport (the index is never the payload);
    `graphify-out/` stays gitignored + derived (rebuildable from the `.md`, m10/ADR-005); the syncback trigger
    re-ingests the control node's OWN checkout (`git pull` + `aof work memory ingest`), never fetches a peer's
    cache. Plant: an index payload on a mesh frame builder; a de-gitignored index; a remote-index fetch — each trips.

**Added at the ADR-014 AMENDMENT (2026-07-19, `aof:continue 38/06` closing BLOCKER F-38.06 — the HYBRID
transport: FABRIC cross-machine, LOOPBACK relay same-machine; a COMPANION to `acd-fleet-terminal-mirror-read-only`,
which keeps the read-only / stateless half unweakened):**

20. `acd-terminal-stream-transport-wired` (ADR-014 AMENDMENT 2026-07-19; invariants 5/6/7) — the terminal
    bridge's PRODUCER is structurally wired for the HYBRID, so it cannot ship inert (the F-38.05 lesson at this
    seam): (5) the worker branch supplies `onOutputChunk` as a LITERAL key at the production `createHandler({...})`
    call site in `mesh-launcher.mjs` (never reachable only through the `workerExecutionOptions` test spread — the
    F12 discipline) wired to `client.sendTerminalFrame` (the FABRIC send, NOT the loopback-only `serveRelay`
    push), and `worker-stream-client.mjs` EXPOSES `sendTerminalFrame`; (6) `control-stream-server.mjs` branches
    `terminal-frame` to an `onTerminalFrame` sink with `applyStreamFrame` carrying NO terminal-frame kind (never
    persisted — inv.3), the launcher passes `onTerminalFrame` at the `startServer({...})` call site, starts a
    `serveRelay()`/`relayMode()` broker, and binds it to the KNOWN port derived from `config.mesh.relay.url`
    (never an ephemeral `?? 0`); (7) the `aof mesh ui` production `serveMeshUi({...})` call site in `cli.mjs`
    supplies `startTerminalRelaySubscriber` (the loopback subscribe) as a LITERAL key and the CLI references
    `createTerminalMirrorSubscriberTransport`. Plant (synthesized, non-vacuous, CRLF-safe): a `createHandler`
    with no `onOutputChunk`; an `onOutputChunk` wired to a loopback push with no fabric `sendTerminalFrame`; a
    control server with no `onTerminalFrame`; a `terminal-frame` branch INSIDE `applyStreamFrame` (would persist);
    a broker bound to an ephemeral `?? 0` port; a `serveMeshUi({ projectDir, port, scope })` with no subscriber —
    each trips; the correctly-wired hybrid shapes stay clean. **RED-until-wired BY DESIGN:** the fabric-send +
    control-bridge real-source gates fail on the inert option-(a) tree that the F-38.06 draft shipped, and go
    green only when the developer reworks to the hybrid; the fleet-consumer gate already passes (that leg
    survives the rework); the synthesized self-check proves the detectors correct regardless of tree state.

**Extended at the ADR-013 + ADR-014 AMENDMENTS (2026-07-23, story 06 / task 04 closing BLOCKER F-38.06c — the
BROWSER consumer surface; no existing clause weakened):**

17b. `acd-fleet-terminal-mirror-read-only` gains its **BROWSER half** (two entries; the four server-side clauses
    above are untouched). (a) COMPONENT-level: the real `FleetTerminalView.tsx` is asserted CLEAN first, then
    eight hand-written plants on a synthesized baseline each assert they LANDED before asserting the trip —
    a browser→socket `.send`, an `onData`→socket path, a live input row, a DISABLED input row (absent, not
    greyed), a send control, the read-only LABEL removed, `disableStdin` removed, the sanctioned seam swapped
    for the board's bidirectional `/ws/terminal`, and a hand-assembled tuple bypassing `resolveTerminalStream`.
    (b) WHOLE-SURFACE: every `.ts/.tsx/.mjs` under `ui/src/fleet` is scanned for an input source or socket send,
    and — per prior lesson R5(m03) — the PRESENCE half is pinned too (the `/ws/terminal-view` consumer EXISTS,
    lives in exactly the sanctioned `.mjs`+`.tsx` pair, and `Fleet.tsx` MOUNTS it), because F-38.06c was the
    ABSENCE of code, which a purely negative invariant scores as a pass. Non-vacuity is proven against a REAL
    shipped file rather than a plant: the same two detectors DO fire on `ui/src/board/TerminalDock.tsx`, which
    legitimately wires `onData`→`socket.send` for a human at their own machine. **Known narrowness (SHOULD-FIX,
    recorded so it is not mistaken for coverage):** `BROWSER_SOCKET_SEND` is receiver-NAME-bound
    (`socket|ws|websocket|conn|connection|channel`), so `socketRef.current.send(…)` / `wsRef.current.send(…)` /
    `mirrorSocket.send(…)` evade it, and `TERMINAL_INPUT_SOURCE` matches only `.onData(`, so xterm's `onKey` /
    `attachCustomKeyEventHandler` / `onBinary` evade it. The load-bearing guarantee does NOT rest on these —
    the ROUTE registers no `ws.on("message")` sink at all (clause #1, server-side), so a browser frame reaches
    no PTY even if one were sent — but the browser clauses should be widened to a receiver-agnostic
    `\.send\s*\(` on a file that names a WebSocket, plus the three other xterm input events.
17c. `acd-vibeyard-attribution` is WIDENED by one file — `ui/src/fleet/terminal-view/FleetTerminalView.tsx` is
    added to `ADAPTED_FILES` because DESIGN V3 requires reusing the dock's vibeyard-derived xterm pane wiring,
    and the attribution travels with the derivation. Every entry in that list must carry an
    "Adapted from … vibeyard … (MIT)" notice, so an added entry is an ADDED assertion: nothing was removed and
    no assertion loosened. **Widened, not weakened.**

**Added at the ADR-013 + ADR-014 AMENDMENTS (2026-07-23 — armed RED-until-fixed by design, the F17 /
`acd-fleet-terminal-frame-connection-identity` precedent this milestone already set. BOTH CLAUSES CLOSED GREEN
the same day; the entry is kept in full because the RED it pinned is the reason the producers exist):**

21. `acd-terminal-view-live-observable` (ADR-013 inv.7 + ADR-014 inv.8; DESIGN §Surface 3 V7/V9) — the fleet
    terminal-VIEW is observable ACROSS THE WHOLE LIFE OF A RUN, not merely at its edges. **Clause (a), ADR-013
    inv.7 — GREEN (was RED at arming):** the transcript-watch resolution in `mesh-worker-execution.mjs` must REPORT the captured
    session id (a live-report seam invoked from the resolution chain) AND that seam must be supplied as a
    LITERAL key at the production `createHandler({...})` call site in `mesh-launcher.mjs` (the F12 discipline),
    with the pre-existing terminal-state reports still carrying `sessionId` (the live report is ADDITIVE, never
    a move). **Clause (b), ADR-014 inv.8 / BLOCKER F-38.06e — GREEN (was RED at arming):** `buildTerminalEndEnvelope` exists on the
    bridge leaf, reuses the EXISTING `TERMINAL_FRAME_KIND`, carries the marker INSIDE `signal`, and adds no
    fourth top-level envelope key (inv.2 checked positively, by extracting the returned literal's top-level
    keys); `worker-stream-client.mjs` exposes `sendTerminalEnd`; the driver's ONE `finish()` settle point emits
    it through a hook DISTINCT from `onOutputChunk`; the launcher wires that hook as a LITERAL key to
    `client.sendTerminalEnd`; `mirror.apply` delivers the end distinctly to the tuple's subscribers; and the
    `/ws/terminal-view` listener CLOSES the browser socket rather than sending an in-band control literal.
    NEGATIVE clauses that must STAY true: `control-stream-server.mjs` branches `TERMINAL_FRAME_KIND` EXACTLY
    once (the end rides the existing branch, adding none) and `applyStreamFrame` still carries no terminal-frame
    kind (inv.3 — never persisted). Plants (synthesized, hand-written, CRLF-safe, each asserting it LANDED): a
    watch resolution that reports to nobody; an unwired report hook; a "moved" report that drops the terminal
    one; a protocol with no end builder; the marker as a fourth top-level key; an end emitted anywhere but the
    settle point; an unwired end hook; an IN-BAND control message instead of a close; a route that never closes;
    a SECOND control-path branch; a mirror that still delivers bytes only — each trips. The two SYNTHESIZED
    self-check lanes pass REGARDLESS of tree state, so the arming red was provably a finding about the TREE and
    not a broken detector; both failure messages carried the exact fix.
    **STATUS — BOTH CLAUSES CLOSED GREEN (2026-07-23), verified at source by this review, not on report.** All
    four lanes green; QA's `test/fleet-terminal-view-producer-fed.test.mjs` 4/4; the arch sweep moved 683→685
    pass and 11→9 fail, i.e. exactly the two armed reds flipping with zero collateral. The as-built follows the
    ADR-014 amendment's ruling verbatim: `buildTerminalEndEnvelope(nodeId, sessionId)` →
    `{ kind: TERMINAL_FRAME_KIND, nodeId, signal: { sessionId, end: true } }`
    (`mesh-terminal-relay-bridge.mjs:92`); `sendTerminalEnd` in `sendTerminalFrame`'s best-effort posture
    (`worker-stream-client.mjs:448`, exported `:677`); produced from the ONE `finish()` settle point via an
    `onSessionEnd` hook DISTINCT from `onOutputChunk` (`mesh-worker-execution.mjs:1051`), wired as a LITERAL key
    at the production call site (`mesh-launcher.mjs:876`); `mirror.apply` passing
    `meta = { end: signal.end === true }` (`mesh-terminal-mirror.mjs:85`); the route calling `ws.close()`
    (`mesh-ui-serve.mjs:404`) rather than any in-band marker; and **`control-stream-server.mjs` UNTOUCHED — still
    exactly ONE `TERMINAL_FRAME_KIND` branch**, which was the whole point of putting the marker inside `signal`.
    QA added a FOURTH producer-fed lane for the `needs-input` end case this review identified: the assignment
    stays `running` while the view reads `ENDED` — the precise divergence that made option (b) (closing off the
    assignment's terminal state) wrong, now pinned by a test rather than by an argument.
    **Each clause goes RED again if its producer is reverted** — that is the entry's standing job now that the
    findings are closed: the detectors are unchanged, so removing the live report, the end builder, the
    `finish()` emission, either literal-key wiring, the mirror's `meta`, or the route's close re-trips
    immediately, and an in-band marker or a second control-path branch trips too.
    **Caveat recorded with the arming — IT STILL STANDS, and outlives these two findings.** This tree carries 9
    unrelated RED arch tests: 4 stale ones reading the m33-deleted `src/mesh-sync.mjs` (`acd-sync-root-set`,
    `acd-claim-relay-independent`, `acd-fleet-reclaim-guarded` — all still REGISTERED in `scripts/test.mjs`, so
    they are gates that can never pass), plus `acd-command-namespace` from the concurrent m41 changeset. A RED
    that hides in a field of REDs pins nothing; RED-until-fixed only works while red is RARE. These two clauses
    were closed within the day, so the technique held this time — but that is not evidence it will next time.
    The stale set is being routed separately for triage/retirement; until it is, treat "the arch suite is red" as
    carrying no information and read the named lanes instead.

(ADR-006's `acd-worker-checkout-reuses-worktree` re-arms the m35 worktree-scope invariant; noted for completeness.
The twelve armed above + the three ADR-010 SPEC entries (F5/F6/F7) + the six ADR-011–016 SPEC entries (all armed at
build) are the structural residue of this milestone's arch-test set.)
