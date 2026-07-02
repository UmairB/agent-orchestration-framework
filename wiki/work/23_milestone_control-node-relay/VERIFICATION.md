---
doc: verification
milestone: 23
updated: 2026-07-01
---
<!--
  Milestone VERIFICATION.md — the record of WHAT was checked and WHAT was found.
  Written by aof:verify. Pointers + evidence, never restatements. Sections with no
  content are omitted (absence is information). No @uat scenarios in this milestone,
  so there is no `## User sign-off`; no UI surface (mesh ui is m25), so no
  design-conformance section.
-->
# 23 · Control Node + Thin Relay — Verification

## Automated + fitness evidence

- **m23's `@executable` suite + all 7 mesh fitness functions: green.** `node ./scripts/test.mjs`
  (re-run this verify session, F1-close-out re-verify `2026-07-01`) → **1719 ok / 10 not ok**. Every m23
  behavioural test group is green — `mesh-relay/*` (18 ok), `mesh-presence*` (15 ok, incl. the 6 new
  `mesh-relay-receive-apply/03` rows), `mesh-node/identity/store` (39 ok) — and the 7 arch-tests below all
  green + non-vacuous.
- **The 10 `not ok` are entirely milestone 24's RED-until-built fitness functions**, NOT an m23 regression:
  exactly `arch/enroll-git-argv-no-shell`, `arch/enrollment-code-hashed-at-rest`,
  `arch/enrollment-code-single-use-constant-time`, `arch/registry-write-scope`, `arch/relay-auth-gate-checked`
  (2 objects each). m24 (**group-enrollment** — device-code enrollment + the relay's credential issuance +
  the registry) was **refined but not yet built**; its fitness functions are registered in the shared
  `scripts/test.mjs` and correctly RED until m24's implementation lands (the ACD gate-before-code discipline).
  Enrollment / relay-auth / registry are **explicitly out of m23 scope** (SPEC §Scope → "milestone 24"), so
  none of the 10 touches an m23 surface. The build's earlier "1690/0" tally was true at m23 build time; m24's
  subsequent refine registered the red gates. A shared-suite artifact worth a retro note (an upstream
  milestone's re-verification no longer shows a clean whole-suite once a downstream milestone is refined) —
  see RETROSPECTIVE.
- The 7 fitness functions, each green + non-vacuous (`verifies →` ARCHITECTURE.md fitness #1–#7):
  - `arch/relay-stateless` (#1) — `src/mesh-relay.mjs` imports no record schema for persistence
    (mesh-store / mesh-presence / node-identity), performs no `writeText`/`writeFile` of a record, imports
    no fs persistence seam — it brokers frames in memory, never a system of record.
  - `arch/relay-envelope-neutral` (#2) — the relay imports neither `mesh-presence.mjs` nor `node-identity.mjs`,
    never parses/branches on a signal's CONTENT (routes by `{ kind, nodeId }`, forwards the opaque `signal`),
    and frames a malformed/oversized input as the frozen `{ type:'error' }` control-frame, never a throw.
  - `arch/presence-write-scope` (#3) — every presence write joins `presenceRecordPath`/`meshDir`, routes
    through atomic `writeText` (not a bare `writeFile`), references zero record-doc filename.
  - `arch/presence-relay-independent` (#4) — the git write (`publishPresenceRecord`) is NOT nested inside the
    relay-push try-block; the relay push is wrapped in a caught-never-thrown try/catch; no `if (push) { writeGit }`
    inversion — the structural form of "data safe, liveness lost".
  - `arch/mesh-command-cli-bijection` (#5, the m22 gate ridden by the new verbs) — every registered `mesh:*`
    (incl. `mesh:heartbeat`, the non-blocking `mesh:relay` probe) carries a non-null cli adapter with a
    reachable dispatch branch; `--json` parses for each.
  - `arch/mesh-eol-pinned` (#6) — `.gitattributes` pins `**/.mesh/** text eol=lf`; matcher is non-vacuous.
  - `arch/presence-subscriber-cache-only` (#7, the F1-close-out gate — ADR-004) — the receive side is a
    liveness cache, never a second system of record: `src/mesh-presence-subscriber.mjs` +
    `src/mesh-presence-cache.mjs` perform NO durable write (no `writeText`/`writeFile`), import NO
    write/persist seam (`node:fs` / `fs.mjs` / `mesh-presence.mjs` / `mesh-store.mjs`), reference NO
    `publishPresenceRecord`, and never touch `presenceRecordPath` — enforced over comment-AND-string-stripped
    source with paired self-checks (the sanctioned carve-out: the frozen `PRESENCE_SIGNAL_KIND` literal + the
    shared frame-size floor). Closes the gap fitness #3 could not see (a NEW subscriber module).

Environment for the `@manual` spikes below: node v22.22.2, ws 8.21.0, git 2.47.0.windows.1, win32.

## Verification evidence

Fixtures: isolated bare-remote fleets under the session scratchpad — a 2-clone fleet for git-only presence,
a 3-clone fleet + an **in-process** `serveRelay` broker (`aof mesh relay --json` confirmed a non-blocking
status probe, not a live daemon, so the live broker was stood up via `serveRelay`/`relayMode`). All mesh
mutations driven only through `node src/cli.mjs mesh <sub> --json` — `.mesh/` never hand-edited. `.gitattributes`
carries `**/.mesh/** text eol=lf`. Two independent agent runs this session corroborate every result below.

### `@manual` 23/00/02 — presence over git, the ≤30s poll-for-durability floor (no relay) — PASS
`verifies →` `stories/00_story_presence-heartbeat/tasks/02_presence-over-git.feature`
(the SPEC §Objective ≤30s-git-fallback half of KR1).

**Procedure (agent-run, registered `aof mesh` face only).** Two clones over a shared bare remote, distinct
`mesh.nodeId`s, no relay configured. Node A `work run-start` → `mesh heartbeat` → `mesh sync`; node B
`mesh sync` → `mesh status`.

**Result — all four feature scenarios PASS:**
- *Render + stale flag over git* — B's status lists node-A with `presence.activeRuns=["<A's running run id>"]`,
  `stale=false`; on-demand A-push → B-reflect wall-clock **~1.4–2.9 s** (≤ 30 s). With B `stalenessSeconds`
  small, node-A flips `stale=true` once the synced heartbeat ages past the threshold — the predicate holds
  across the git seam. (`mesh status` has no `--now` flag — see finding F5.)
- *Zero-engine-change sync + byte-identity* — the sync envelope carried `.mesh/presence/<A>.json` (`pushed`
  on A, `pulled` on B); A-written vs B-checked-out `cmp` exit 0, identical sha256, **0 CR / LF-only** (the
  eol=lf pin holds on Windows). `mesh-sync.mjs` has zero presence references — it stages the whole `.mesh/`
  root via `git add -- <meshDir>`, payload-agnostic and unmodified (22/ADR-004 re-confirmed end-to-end).
- *Concurrent add-only merge* — A and B publish concurrently; after B pulls, both records present, `git status
  --porcelain` empty, no conflict markers, B's own record byte-identical before/after, A's record byte-identical
  across partitions. Disjoint per-node paths → add-only union.

### `@manual` 23/02/02 — 3-node fleet spike (relay + degradation) — PASS (all four halves)
`verifies →` `stories/02_story_presence-over-relay/tasks/02_relay-liveness-fleet-spike.feature`
+ `stories/02_story_presence-over-relay/tasks/03_relay-receive-and-apply.feature` (the `@manual` ≤5s
re-measurement, F1 close-out) — the SPEC §Objective outsider-verifiable KR1 + liveness-half-of-KR5 acceptance.

**Broker baseline.** Raw `ws` sockets to the in-process `serveRelay`: publisher B's frozen
`{ kind:"presence", nodeId, signal }` frame fanned out **byte-identical** to connected listeners, no
self-echo, sub-ms broker delay — **the broker works**.

- ✅ *≤5s relay reflection into `mesh status`* — **PASS (finding F1 resolved by the receive-and-apply
  consumer, ADR-004).** Re-measured `2026-07-01` on a genuine 3-node fleet exercising the **real production
  ws@8 seams** (not the `@executable` injected stubs): control node A stands the broker up via the config-gated
  `relayMode` (`controlNode === nodeId`) — no production launcher yet (F2), so in-process — and A, B, C each hold
  a **persistent subscriber** over `createSubscriberTransport` → `startPresenceSubscriber` (all `connected:true`),
  with three *independent* `.mesh` dirs and **no shared git remote**, so a peer's change can ONLY arrive over the
  relay. B publishes via the real two-publish path (`publishPresenceRecord` git write into B's own tree, then
  production `createRelayClient` + `pushPresenceSignal`, `pushed:true`). Across three successive B beats the
  broker fanned each out to A's and C's held connections, whose caches applied it, and `mesh:status` (with
  `ctx.presenceCache` injected) surfaced B's **latest** pushed presence (its newest `heartbeatAt`) — the
  measured worst-case (the slower of A / C) reflection was **11.9 ms** (run 1) / **4.8 ms** (run 2,
  corroborating), per-round A 1.1–11.9 ms / C 1.5–4.7 ms: the first beat carries a one-time socket warm-up,
  later beats settle to ~1–2 ms — all ≪ 5 000 ms. Proof it arrived over the relay, not git: **no `node-b.json`
  on A's or C's disk** (`readPresenceRecord → null`), yet both render B live. Fan-out is general, not
  B-specific — a C→A change reflected in **14.2 ms** (run 1) / **10.8 ms** (run 2). The push-side one-shot
  socket that raced the fan-out in the prior pass is now irrelevant — the **persistent subscriber holds an open
  connection**, so it is in the broker's fan-out set when B's frame arrives. The ≤5s-over-relay half of KR1 is
  now achievable and achieved. (Harness: `scratchpad/fleet-relay-remeasure.mjs`, two independent runs; both
  `OVERALL: PASS`.)
- ✅ *Durable-authority invariant (live, F1's load-bearing guard)* — after B's relay-fed change is cached on A,
  a git sync of B's **same-heartbeat** durable record onto A makes `mesh:status` reconcile to the **git-durable
  bytes** (`mergePresence` breaks the tie toward disk) — the cache never becomes a second system of record. The
  subscriber wrote no durable record: the only `presence/node-b.json` on A is the one the sync wrote.
- ✅ *≤30s git floor with the relay killed* — relay killed (port no longer LISTENING). B's heartbeat: git write
  succeeded, `relay={pushed:false, attempted:true, error:"connect ECONNREFUSED …"}`, **exit 0** (caught, never
  thrown). A reflected B's change over git in **3897 ms**, C in **5923 ms** — both ≤ 30 s, carried purely by git.
- ✅ *Liveness-not-data (0 records lost)* — with the relay dead, the remote holds exactly 3 presence records,
  each byte-identical (`cmp -s`) to its writer's local copy — **0 lost, 0 corrupted**. Every node's status shows
  3 nodes with presence over git-only. Liveness lost, data safe (the liveness half of KR5).
- ✅ *Re-nomination (no election protocol; no data event)* — re-pointing all three configs to `controlNode=node-B`
  + a new url is a pure config edit: `mesh relay` shows B `nominated=true`, A/C `nominated=false`; `relayMode(cfgA)`
  returns null (no listener bound), `relayMode(cfgB)` stands the broker up (config-gated); fan-out through B's new
  relay byte-identical; all durable records byte-identical to the pre-re-nomination baseline. The "sub-5s liveness
  resumes" sub-clause now **holds** (F1 resolved): a subscriber pointed at B's new relay applies fanned-out
  signals into `mesh status` sub-5s, exactly as it did against A's relay above.

## Findings

| id | observed | type | severity | triage (PO) | routed-to | status |
|----|----------|------|----------|-------------|-----------|--------|
| F1 | The relay is a working **broker** with no **consumer**. `createRelayClient` (`src/mesh-relay-client.mjs`) is push-only — connect → push one frame → dispose; its only `on("message")` handler resolves the join-ack then ignores every subsequent frame; nothing writes a fanned-out signal into the store `mesh status` reads (`meshStatusCommand.run` is a pure disk read of `.mesh/nodes` + `.mesh/presence`). A full-tree grep for `on("message")` finds only the broker, the client's join-ack handler, and the unrelated board terminal — no receive-and-apply site. Empirically: B pushed a real delta over the live relay (`relay.pushed:true`) and A/C `mesh status` stayed unchanged for 3 s until a git sync. So the SPEC §Objective / PRD KR1 headline — "a peer's change shows on another node within ≤5s over the relay" — is **not deliverable as built**; only the ≤30s git floor is end-to-end, and the relay accelerates nothing observable. Root cause: the refine break-down covered publish + broker + git-read render but no node-side **consuming** hop of the observable's data-path. | task-gap (missing receive-and-apply consumer) | **blocker** | **blocker (user/PO decision at verify).** The milestone's headline objective — sub-5s liveness git can't give — is unmet; a milestone `done` here would report done when the load-bearing KR1 half is not. Build the receive side **in m23**. New `@bug @finding-F1` task authored: a node-side **persistent relay subscriber** whose `on("message")` applies each fanned-out `{kind:"presence"}` frame into the store `mesh status` reads (git stays the durable authority — the applied signal is a liveness cache, never a second system of record; malformed/oversized frames ignored; relay-down degrades to the git floor). | `stories/02_story_presence-over-relay/tasks/03_relay-receive-and-apply.feature` → `aof:continue 23` | **resolved `2026-07-01`** — built (`aof:continue 23`, ADR-004): `src/mesh-presence-subscriber.mjs` (persistent injected-transport subscriber + `createSubscriberTransport` ws@8 seam) + `src/mesh-presence-cache.mjs` (in-memory latest-wins cache) + `mergePresence` (git breaks the tie) + the `mesh:status` `ctx.presenceCache` overlay. All 6 `@executable` rows + fitness #7 green; the `@manual` ≤5s re-measurement PASSES on a real 3-node ws@8 fleet (worst-case both-nodes reflection 11.9 ms / 4.8 ms across two runs; no git sync — no `node-b.json` on A/C disk). |
| F2 | `serveRelay`/`relayMode`/`startPresenceLoop` are built + unit-proven in-process but have **no production launcher** — only the non-blocking `relayStatus` probe (`aof mesh relay --json`) is wired; nothing runs the relay serve or the presence cadence as a live daemon. | deferred production wiring | low | non-blocker | backlog. Note: the F1 subscriber needs a live daemon, so the launcher question will likely be resolved alongside F1. Consistent m22 precedent (`startSyncLoop` is also library-only). | deferred |
| F3 | `mesh status` builds its roster from `readNodeRecords` and attaches presence per node — a node with a presence record but **no node record** (never ran `mesh:identity`) does not surface. Arguably correct (realistic onboarding is `mesh:identity` then `mesh:heartbeat`), but the presence-only-node contract is undocumented. | contract clarification | low | non-blocker | backlog: document the "onboard via `mesh:identity` first" contract (or surface presence-only nodes) — fold into the m25 presence surface. | deferred |
| F4 | The `aof mesh` usage banner (`MESH_USAGE`, `src/cli.mjs:465`) still reads "routing only; verbs arrive with later stories" although `identity`/`status`/`sync`/`heartbeat`/`relay` are all wired and dispatched. Cosmetic/doc drift — the verbs work; only the no-sub help text is stale. | doc drift | low | non-blocker | backlog: refresh `MESH_USAGE` to list the live verbs (fold into the F1 fix batch or a docs pass). | deferred |
| F5 | `mesh status` exposes no `--now` injection flag (`cli.argv:()=>({})` drops options), so the staleness-across-the-git-seam scenario can only be driven by config + elapsed wall-clock, not a deterministic clock. Not a defect (the white-box `mesh:heartbeat` takes an injected `now`, and `isStale` is unit-proven); it only makes the `@manual` render harder to drive deterministically. | test-affordance gap | low | non-blocker | backlog: optionally expose a `--now` read affordance on `mesh status` for deterministic verification. | deferred |

**No blocker finding is open (F1 resolved `2026-07-01`)** — the milestone is **accepted**. F2–F5 remain
non-blockers deferred to backlog. All four acceptance halves are now verified green: the ≤5s-over-relay reflection
(via the F1 receive-and-apply consumer), the ≤30s git floor, clean degradation with 0 records lost, and
re-nomination with no data event — over a provably stateless broker.

## Accept decision

**ACCEPTED — `2026-07-01` by `aof:verify 23` (F1 close-out re-verify).** F1, the sole blocker, is **resolved**: the
node-side receive-and-apply consumer (ADR-004 — a persistent relay subscriber + an in-memory liveness cache +
the `mesh:status` overlay, with git the durable authority via `mergePresence`) was built (`aof:continue 23`) and
verified this session — all 6 `@executable` rows + fitness #7 green, and the `@manual` ≤5s re-measurement PASSES on
a real 3-node ws@8 fleet (worst-case both-nodes reflection 11.9 ms / 4.8 ms across two independent runs; no git
sync — no durable `node-b.json` on A/C disk). The milestone's load-bearing KR1 — a peer's change reflected ≤5s over the relay AND ≤30s
with the relay killed, losing liveness not data — is delivered end-to-end.

m23's `@executable` suite + all 7 fitness functions are green (1719 ok). The 10 residual `not ok` are milestone
24's RED-until-built enrollment/relay-auth/registry gates (m24 refined, not built — out of m23 scope), not an m23
regression; recorded in §Automated evidence and flagged for the retro (shared-suite artifact). `aof work validate`
→ 0 findings.

Stories 00 (presence git substrate) and 01 (the thin relay) were verified `done` at the prior pass; story 02
(the integration + the F1 consumer) is now verified and set `done`, so the milestone is accepted. Accepting m23
**unblocks** m24 (`depends: [23]`).

<!-- Note (integrity): an earlier verify pass this session erroneously recorded F1 as a non-blocker, routed it
     to m25, and marked the milestone ACCEPTED prematurely; that was reverted, F1 was correctly adjudicated a
     BLOCKER → m23, the consumer was built (aof:continue 23), and THIS pass accepts on the now-green receive-and-
     apply path with the ≤5s latency re-measured live. This document is the authoritative verify record. -->
