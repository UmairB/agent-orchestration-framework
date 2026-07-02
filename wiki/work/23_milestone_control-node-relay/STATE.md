---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 23 · Control Node + Thin Relay — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-29` by `aof:shatter` from
  [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  (the live-substrate chunk — Phase 1). Stories to be broken down — `aof:refine 23`.
- Refined `2026-06-30` by `aof:refine 23 --autonomous`. The architect authored
  [ARCHITECTURE.md](ARCHITECTURE.md) (3 ADRs + 6 fitness functions); the PO partitioned into **three**
  stories ({00 presence, 01 relay} parallel → 02 integration) and the Three Amigos authored each contract.
  Status → `in-progress`.
  - **00 · presence / heartbeat** (git-side substrate) — `in-review`.
  - **01 · thin stateless relay** (parallel sibling) — `in-review`.
  - **02 · push/poll + degradation** (integration; depends 00+01) — `in-review`.
- Built `2026-06-30` by `aof:continue 23` (stories serialised — they co-touch the additive registration
  door `command-core.mjs`/`cli.mjs`/`scripts/test.mjs`/the bijection `argsFor`, so a sequential build
  avoided edit-races; the relay subtree + presence subtree are otherwise file-disjoint). All `@executable`
  suites green and all six fitness functions green: full suite **1636 → 1690 ok / 0 not ok / exit 0**
  (+54 tests, incl. a post-review maxFrameBytes boundary row). Reviewed at the build gate: **architect → CONFORMS** (3 ADRs honoured, all 6 fitness
  functions non-vacuous, EOL pin resolves at the nested path, `isStale` genuinely shared not duplicated,
  the non-enumerable `relay` result-property sound); **qa → FAITHFUL-WITH-FINDINGS** (53/53 m23 test
  objects green, no flake; 2 test-strength nits); **craft → no blockers** (3 node-side-client robustness
  fixes on the verify-only production path). Confirmed fixes applied (client lifecycle + test-strength +
  a maxFrameBytes boundary row + a hardened envelope-neutral matcher). Stories → `in-review`. **Next:
  `aof:verify 23`** (the `@manual` deliverables below + sign-off).
- **Verified `2026-07-01` by `aof:verify 23` — NOT ACCEPTED (blocker open).** `@executable` suite + all 6
  fitness functions green (1690 ok / 0 not ok / exit 0); the `@manual` git-floor acceptance PASS (render +
  stale + zero-engine-change byte-identity + add-only merge; on-demand git round-trip ~1.4–2.9 s ≤ 30 s);
  the fleet-spike degradation halves PASS (broker fan-out byte-identical sub-5 s; ≤30 s git floor 3.9 s / 5.9 s
  under a killed relay; 0 records lost; re-nomination config-only, no data event). **The ≤5s-over-relay
  reflection half FAILS** ([VERIFICATION.md](VERIFICATION.md) **F1**): the relay is a working broker with no
  consumer — `createRelayClient` is push-only (connect→push→close, no persistent subscription), nothing
  applies a fanned-out signal into what `mesh:status` reads, so a peer's change surfaces only after a ≤30 s
  git sync. Empirically confirmed live (B pushed `relay.pushed:true`; A/C `mesh:status` unchanged for 3 s
  until a git sync). This is the milestone's headline KR1 objective, so **F1 is triaged a BLOCKER by the user
  (PO)** — a new `@bug @finding-F1` task
  ([stories/02/tasks/03_relay-receive-and-apply.feature](stories/02_story_presence-over-relay/tasks/03_relay-receive-and-apply.feature))
  is authored and routed back to **`aof:continue 23`** to build the node-side relay subscriber. Non-blocker
  findings F2–F5 deferred (see VERIFICATION.md). Stories 00 + 01 verified → `done`; story 02 → `in-progress`;
  milestone stays `in-progress`. **Next: `aof:continue 23`** (build F1), then re-run `aof:verify 23`.
- **F1 built `2026-07-01` by `aof:continue 23` (ADR-004) — the receive-and-apply consumer, built + reviewed.**
  The architect had already ratified the fix as **ADR-004 + fitness #7 `acd-presence-subscriber-cache-only`**
  (a design-lock authored alongside the build). Delivered: `src/mesh-presence-cache.mjs` (the in-memory,
  latest-wins-keyed-by-nodeId liveness cache — no disk write), `src/mesh-presence-subscriber.mjs` (the
  **persistent** injected-transport subscriber — distinct from the one-shot push client — + `parseInboundFrame`
  + `createSubscriberTransport`, the production ws@8 seam), `mergePresence` in `src/mesh-presence.mjs` (latest
  wins; **git-durable breaks a tie**, so the cache never becomes a second authority), and the `mesh:status`
  `ctx.presenceCache` overlay (the no-cache CLI path is byte-identical to the story-00 render). All **6
  `@executable` scenarios/rows green** + fitness #7 green: full suite **1690 → 1716 ok / 0 not ok / exit 0**.
  Reviewed at the build gate: **architect → CONFORMS** (ADR-004 + fitness #7 honoured; the consumer is a
  provably in-memory cache — no durable write, no persist-seam import, no `presenceRecordPath`, enforced by a
  non-vacuous whole-surface gate; `mergePresence` keeps git the authority on a tie; no new command-face gate;
  graph confirms a disjoint low-coupling subtree, no cycle); **qa → FAITHFUL-WITH-FINDINGS** (every scenario +
  bad-frame row non-tautologically covered against real production code; the headline "surfaces without a git
  sync" + the liveness-cache-not-authority reconcile genuinely proven; deterministic, no flake; the no-cache
  path preserved; 2 non-blocking test-strength nits). Confirmed fixes applied: dropped a redundant second
  fitness-function draft (`acd-presence-cache-not-authority`) in favour of the ADR-named #7, and swept the
  stale comment/docstring references it left behind. Story 02 → `in-review`; task 03 box ticked; the milestone
  stays `in-progress`. **Next: `aof:verify 23`** — re-run the `@manual` ≤5s fleet re-measurement (now
  runnable with the consumer), record the latency, and flip **F1 → resolved** to accept.
- **ACCEPTED `2026-07-01` by `aof:verify 23` (F1 close-out re-verify).** m23's `@executable` suite + all 7
  fitness functions green (**1719 ok**; the 10 `not ok` are milestone 24's RED-until-built
  enrollment/relay-auth/registry gates — m24 refined not built, out of m23 scope — a shared-suite artifact
  distilled to the retro, not an m23 regression). The `@manual` ≤5s re-measurement **PASSES** on a genuine
  3-node fleet over the real production ws@8 seams (`serveRelay` + `createSubscriberTransport` +
  `startPresenceSubscriber` + the real `mesh:heartbeat` push): B's pushed change surfaced in A's and C's
  `mesh:status` **purely over the relay, no git sync** — worst-case both-nodes reflection **11.9 ms** (run 1) /
  **4.8 ms** (run 2, corroborating), per-round A 1.1–11.9 ms / C 1.5–4.7 ms; B's presence file absent from A/C disk.
  **F1 → resolved.** `aof work validate` → 0 findings. Stories 00 + 01 were `done` at the prior pass; story
  02 → `done`, so the milestone is accepted → **SPEC `status: done`**. Accepting m23 **unblocks m24**
  (`depends: [23]`). RETROSPECTIVE.md written; memory ingested; STATE compacted (below). **Next:
  `aof work next` (→ m24 · group-enrollment).**

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- The relay is a **cache/accelerator, never a system of record** — the hard invariant to defend in the
  ADR: every signal it carries has a durable git counterpart, so killing it loses liveness, not data.
  Blocked until milestone 22 (node identity + git-sync substrate) and milestone 20 (the single-node
  heartbeat + stale-detection this presence extends to the fleet).
- ~~Open for refine: the relay's transport + wire envelope; the control-node nomination / re-nomination
  protocol; how presence extends milestone 20's single-node heartbeat + stale-detection into a fleet
  signal over the relay (the genuine `23 → 20` seam); the staleness threshold; and the relay-liveness
  spike on a 3-node fleet.~~ **All resolved at refine** (`ARCHITECTURE.md` ADR-001/002/003).

### Documented default decisions taken under `--autonomous` (reversible — config/design, no unsafe gate)

- **Relay transport = `ws@8`, the existing serve precedent** (ADR-001). The relay ships as the same aof binary
  in a `relay` mode reusing `board-serve`/`terminal-ws`'s `ws@8` + single `http.createServer` (03/ADR-001/003);
  `ws@^8.21.0` is already a dependency — no new heavy dep. Reversible (a transport swap behind `serveRelay`).
- **Wire envelope `{ kind, nodeId, signal }`, payload-agnostic** (ADR-001) — `signal` is an opaque blob the
  relay forwards unparsed; presence is the first `kind`, leasing (m26) the second, with zero relay change.
- **Control-node nomination = a config flag** (`config.mesh.relay.controlNode` / `.url`), re-nominate-able by
  re-pointing config + standing `relay` mode up elsewhere — **no election protocol** (deliberate; the control
  node is not a durability SPOF). Reversible (a config edit).
- **Staleness threshold = `config.mesh.presence.stalenessSeconds`** (a documented default, e.g. N× the
  heartbeat cadence) reusing milestone 20's `isStale` shape; **cadence = `config.mesh.presence.cadenceSeconds`**
  (documented default within A1's band). Both reversible config.
- **The relay is PRE-AUTH in m23** (ADR-001) — no group credential / relay auth (that is milestone 24). Its
  threat model is **inseparable from m24's enrollment**, so no SECURITY.md is authored here; m23 records only
  the posture (loopback / trusted-LAN bind, opaque ephemeral signals). The pre-auth gap is owned by m24, not
  silently assumed safe. **This is the one scope decision worth a human's eye** — flagged in the review.
- **The m22 carry-forwards F1/R5 (`.gitattributes` EOL pin) + R4 (self-host `.mesh` ignore)** land on the
  presence spine (story 00), per the m22 retro deferral (F1 → m23). R6 (collision data source) is honoured —
  presence is keyed by `mesh.nodeId`, same-host collision is the documented `mesh.nodeId` override.
- **The A1/A5 latency measurement (≤5s relay / ≤30s git on a 3-node fleet) is a verification-time spike**
  (story 02 `@manual`), NOT a refine blocker — mirroring m22/ADR-004's A1 note.

## Feedback (for retro) — ARCHIVED `2026-07-01` (graduated at Accept)

<!-- Compacted at Accept: every lesson here graduated to RETROSPECTIVE.md (R1–R5) + was ingested into
     memory (`aof work memory ingest 23`). The blow-by-blow is archived; the carryable form lives in the
     retro. Kept only as a pointer, per the graduate-then-archive discipline. -->

- All build- and verify-gate feedback distilled into **[RETROSPECTIVE.md](RETROSPECTIVE.md)** and ingested to
  memory (recallable in the next milestone's refine/continue):
  - **R1** — Every observable needs a reader (the F1 decomposition gap: publish + broker + git-read render but
    no node-side consumer → ≤5s KR undeliverable while every task was green).
  - **R2** — A narrow design-lock must LEAD the build, not race it (the ADR-004 dev-vs-design-lock ordering
    inversion + the arch↔dev fitness-function naming drift).
  - **R3** — A git-as-bus EOL pin must match the REAL nested record path (`**/.mesh/**`, not a root anchor;
    22/R5 discharged).
  - **R4** — A ws contract-frame check must fire BEFORE the library's own `maxPayload` limit (floor set above,
    not equal).
  - **R5** — A shared test suite goes red the moment a downstream milestone (m24) is refined; scope "green" to
    the milestone under verify + capture the runner's own exit code (never a pipe's).

## Deferred / flagged for aof:verify — ADJUDICATED `2026-07-01`

- **Receive-and-reflect gap → VERIFICATION.md F1 — BLOCKER (user/PO decision).** The ≤5s relay *transport*
  fans out sub-5s and the node *pushes*, but no node-side subscriber applies a fanned-out signal into what
  `mesh:status` reads (`createRelayClient` is push-only; `mesh:status` reads git-synced records off disk). So
  the milestone's headline KR1 objective — a peer's change reflected ≤5s over the relay — is undeliverable as
  built. Triaged a **blocker** by the user (PO) at verify: build the receive side **in m23**, not defer it. A
  new `@bug @finding-F1` task (`stories/02/tasks/03_relay-receive-and-apply.feature`) is routed to
  `aof:continue 23`. (An earlier verify pass had erroneously recorded this as a non-blocker routed to m25;
  that routing is reverted — the user's decision is BLOCKER → m23.)
  **BUILT `2026-07-01` (`aof:continue 23`, ADR-004): the receive-and-apply consumer is built + reviewed** (the
  persistent subscriber + in-memory cache + `mesh:status` overlay; all `@executable` green, fitness #7 green,
  architect CONFORMS + qa FAITHFUL-WITH-FINDINGS). The `@executable` *mechanism* now closes F1's data-path
  hop; the ≤5s *latency* on a real fleet is the remaining `@manual` re-measurement at `aof:verify 23`, after
  which F1 flips → resolved. See the Progress entry above.
- **Production wiring deferred → VERIFICATION.md F2 (non-blocker, deferred).** `serveRelay`/`relayMode`/
  `startPresenceLoop` are library-only with no production launcher (only the non-blocking `relayStatus`
  probe is wired). Confirmed against the code at verify; consistent m22 precedent (`startSyncLoop` is also
  library-only). The live serve/cadence runner is a later serve-face/packaging concern — but note the F1
  subscriber will need a live daemon, so the launcher question is likely resolved alongside F1.

## Verification

<!-- Pointers, not restatements. -->
- [x] m23 `@executable` suite + all 7 fitness functions green — 1719 ok (re-run at verify `2026-07-01`); the 10 `not ok` are m24's RED-until-built enrollment/relay-auth/registry gates (out of m23 scope — see [VERIFICATION.md](VERIFICATION.md) §Automated evidence + the retro).
- [x] Fitness functions green — all 7 (#1 relay-stateless, #2 relay-envelope-neutral, #3 presence-write-scope, #4 presence-relay-independent, #6 mesh-eol-pinned, #7 presence-subscriber-cache-only + the #5 mesh-bijection ride).
- [x] `@manual` git floor + degradation — [VERIFICATION.md](VERIFICATION.md): story 00/02 two-clone-over-git PASS (~1.4–2.9 s ≤ 30 s); story 02/02 degradation halves PASS (broker fan-out byte-identical sub-5 s; ≤30 s git floor 3.9 s / 5.9 s; 0 lost under a killed relay; re-nomination config-only).
- [x] `@manual` ≤5s-over-relay reflection — **PASS** (F1 resolved): re-measured live on the 3-node ws@8 fleet with the receive-and-apply consumer — worst-case both-nodes reflection 11.9/4.8 ms across two runs, over the relay, no git sync. [VERIFICATION.md](VERIFICATION.md).
- [x] Milestone accept — **ACCEPTED `2026-07-01`** (`aof:verify 23`). SPEC `status: done`; m24 unblocked.
