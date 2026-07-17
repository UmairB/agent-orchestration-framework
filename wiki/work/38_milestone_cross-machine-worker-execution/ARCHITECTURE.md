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

(ADR-006's `acd-worker-checkout-reuses-worktree` re-arms the m35 worktree-scope invariant; noted for completeness.
The twelve armed above + the three ADR-010 SPEC entries (F5/F6/F7, armed at build) are the structural residue of
this milestone's arch-test set.)
