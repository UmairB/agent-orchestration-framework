---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 33 · Mesh Relay/Transport Redesign — State

## Progress

- Framed `2026-07-04` by `aof:add-milestone` — spawned from the **rejected UAT 32** (whole-mesh
  acceptance). The live cross-OS shakedown (Windows + macOS over Tailscale) proved the mesh does not
  deliver its integrated promise: no relay launcher (F-3201), no reachability model (F-3202), identity
  inherited on clone (F-3203), and — deciding — the relay architecture is wrong for a mesh-VPN
  transport (F-3204). **Not started** — a frame only; `aof:refine 33` breaks it into stories.

- **Refined `2026-07-04` by `aof:refine 33 --autonomous`** — Decide + Break-down + Contract, one
  consolidated review. Decide (fabric-first, per `STATE §Notes`): a researcher pinned the Tailscale
  realities ([RESEARCH.md](RESEARCH.md)); the architect recorded ADR-001..004 + a fitness ledger
  ([ARCHITECTURE.md](ARCHITECTURE.md)) and authored two PENDING fitness functions. Broken into TWO
  stories (see `SPEC §Stories`), each contract authored via Three Amigos. Milestone → **in-progress**.

- [x] **00 · per-install node identity** (F-3203) — broken down + contract authored
- [x] **01 · fabric-native transport + coordination launcher** (F-3201/F-3202/F-3204) — broken down + contract authored

- **Built + reviewed `2026-07-04` by `aof:continue 33` (story 00 first, per the identity-first soft edge).**
  Story **00 → in-review**: tasks 00–03 `@executable` green; the DoD migration landed (committed
  `.aof/aof.config.json` `mesh` block stripped of `nodeId`/`salt` → the git-ignored sidecar
  `.aof/mesh/identity.json`); fitness **`acd-mesh-identity-not-committed` un-skipped + GREEN**; task 04
  (`@manual`, real cross-OS) deferred to `aof:verify`. Full suite **2242/0**. Review: qa CONFORMS
  (behavioural fidelity complete), architect CONFORMS on the identity design (inv 2–7 hold), automated
  craft pass surfaced **two real correctness bugs in un-scenarioed `loadWorkspace` paths — both fixed**
  (self-heal churning a collision-suffixed id every load; a nodeId-only sidecar clobbering a committed
  `salt`), + a minor DRY consolidation of the sidecar read-merge-write. Story 01 build follows.

- **Story 01 built + reviewed `2026-07-04` → in-review.** Tasks 00–04 `@executable` green; the NEW
  `src/mesh-fabric.mjs` is the sole `tailscale` seam (fitness **`acd-fabric-single-seam` un-skipped +
  GREEN**); the fabric peer-map liveness cutover landed (`mergePresence` body + git assembly byte-unchanged);
  the ws@8 broker retired from the liveness path (`mesh-presence-subscriber.mjs` + `mesh-presence-cache.mjs`
  DELETED; heartbeat relay-push removed); the per-node presence+sync daemon `mesh:serve` verb shipped
  (registered run is the non-blocking probe — rides `acd-mesh-command-cli-bijection`); per-fabric operator
  guidance + the macOS App-Store preflight in `work doctor`. **All four `acd-relay-*` arch-tests retired**
  (deleted + unwired, ADR-002). Task 05 (`@manual` live-tailnet cross-OS) deferred to `aof:verify`. Full
  suite **2235/0**. Review: qa CONFORMS (behavioural fidelity + the 7 test-deletions audited legitimate —
  no regression hole), architect CONFORMS on inv 1/3/4/5/6/7 and forced the **all-4 arch-test retirement**
  (the broker is dead code; keeping `acd-relay-lease-blind` was a dangling green guard — fixed), craft
  surfaced a **HIGH bug: the non-blocking `mesh:serve` probe minted the identity sidecar on a fresh install
  — fixed** (`resolveNodeIdentity` made read-only) + a latent dialer-contract defect (fixed). **Milestone
  33 both stories are now in-review — next: `aof:verify 33`.**

- **Verified `2026-07-04` by `aof:verify 33` → NOT ACCEPTED (blocker F-3302 open); stays in-review.**
  Automated + structural all green (suite 2235/0; both fitness DoDs `acd-mesh-identity-not-committed` +
  `acd-fabric-single-seam` green; relay guards retired; `aof work validate` PASS). Live-fabric lanes run on
  the real tailnet from `umairs-msi` (probe/self-address/launcher-probe all healthy, read-only). Operator
  chose to run the cross-OS e2e on real hardware now (branch committed + pushed `f3a4283`; `umairs-mac-mini`
  stood up). **Task 04 (cross-OS identity) PASSED** — the mac derives a distinct `umairs-mac-mini-local` off
  committed config (F-3203 holds on real hardware) — **but the same run surfaced BLOCKER F-3302**: the macOS
  `os.hostname()` `.local` suffix makes the aof nodeId (`umairs-mac-mini-local`) diverge from the Tailscale
  hostname (`umairs-mac-mini`), so the ADR-002.2 fabric peer→nodeId join leaves the mac UNJOINED — "see every
  node + assign cross-node" is broken for macOS nodes. The `mesh-fabric-seam` fixtures used idealized rosters
  (nodeId == HostName, no `.local`) so CI was green over it. **Task 05 (fleet e2e) not reached** (F-3302 is
  its precondition). Next: fix F-3302 (`@bug`, `aof:continue` story 01) → re-verify the live join + task 05.
  Full finding + evidence in [VERIFICATION.md](VERIFICATION.md).

- **Accepted `2026-07-05` → milestone `done` (owner decision, with reservations).** F-3302 fixed + closed
  on the live tailnet (mac's migrated `umairs-mac-mini` joins the fabric); suite 2237/0; validate PASS.
  Accepted as a **deliberate move-to-34** — 34 (`global-mesh-work-store`) supersedes 33's user-facing
  surface (global `aof mesh ui`, fabric-composed node registry) and is where the mesh becomes openable +
  single-machine testable. Design debt R2 (fabric ≠ discovery plane at the UI) + R3 (vestigial control node)
  carried to 34, recorded in [RETROSPECTIVE.md](RETROSPECTIVE.md). Task 05 (full fleet e2e) not run → UAT 32.

## Notes & decisions in flight

- **Pin the fabric before the coordination layer.** UAT 32's retro lesson: the relay was designed
  hub-and-spoke without deciding the network fabric; once Tailscale/WireGuard is the transport, most of
  that machinery is redundant. The Decide stage (`aof:refine`) must settle the fabric assumption in an
  ADR **first**, then design coordination on top of it.
- **Reuse, don't re-accept.** The m19–21 run lifecycle, m22 record-store + partition convention, and
  m26/m27 leasing/issuance are the substrate — this milestone changes the transport/identity/launcher,
  not the record model. Guard the reused invariants with the existing fitness functions.
- **Prototype context (thrown away, by design).** A quick `aof mesh relay --serve` launcher was
  prototyped during UAT 32 to prove the gaps were real (it worked: serve → enroll → stop, suite green
  2221/0), then reverted — the redesign supersedes it. See UAT 32 · F-3201 for what it demonstrated.

- **DECISION taken at refine (ADR-002 — the deciding call, F-3204): the WebSocket broker is ELIMINATED**
  as the presence/liveness transport. The mesh VPN already supplies a control-plane liveness signal
  (`tailscale status --json` → the peer map + `Online`), so the fast-path becomes a fabric peer-map read;
  git presence/sync stay the durable floor, untouched; the residual "control node" survives only as an
  issuance-authority git-write role, decoupled from any listening socket. This directly implements the
  operator's already-recorded F-3204 direction — **it is refine executing a recorded decision, not a new
  unsafe call** — but it is the headline of the review gate (the build story RETIRES `mesh-relay.mjs`'s
  broker + the `acd-relay-auth-gate-checked` family). Confirm at the single review.

- **DECISION taken at refine (documented default): TWO stories, not three.** SPEC's provisional 3-way
  split assumed a launcher-over-a-broker; ADR-002 eliminates the broker, so the launcher (F-3201) is no
  longer a standalone thing — it becomes a per-node presence+sync daemon that is one deliverable of the
  fabric-native transport story. Merging avoided scaffolding a now-empty standalone "launcher" story.
  Identity (F-3203) stays the one clean independent cut (graph: `node-identity.mjs`, 2 dependents).

- **The fabric seam is pluggable but Tailscale-only shipped (ADR-001).** Non-VPN fabrics (raw-LAN /
  public-tunnel) are a later story at most (`SPEC §Scope`); `mesh-fabric.mjs` refuses any non-`tailscale`
  `config.mesh.fabric` cleanly (06/ADR-002 designed-not-shipped) rather than pretending support.

- **Open risk carried to build/verify (RESEARCH §3): the macOS App-Store-vs-Standalone client split.**
  The App-Store Tailscale build's CLI is sandboxed/degraded — an operator on the wrong Mac build sees
  self/peer discovery silently fail in ways that look like a transport bug. Owned as a `work doctor` /
  launcher preflight (story 01, task 04). Nothing in RESEARCH was measured on a live tailnet (no tailnet
  in the refine environment) — the live-parse + cross-OS lanes are `@manual`, scheduled at verify.

## Feedback (for retro)

<!-- Raw, attributed notes captured at build/review — distilled into RETROSPECTIVE.md at aof:verify. -->

- **Story 00 · heal-predicate contract gap (caught at craft review, fixed).** The task-03 contract's stated
  self-heal predicate — `sanitizeHostname(currentHostname) !== sidecar.nodeId` — compares a bare hostname
  stem against the *resolved* nodeId, which for a **collision-suffixed** id (`shared-host-c4f8`) never
  matches, so the heal fired on **every** `loadWorkspace` and, because that call site passes no `takenIds`,
  the roster-less re-derive dropped the suffix — churning a supposedly-stable per-install id each load. The
  contract's own reasoning assumed the heal re-derive always has the collision roster; the roster-less
  `loadWorkspace` call site breaks that. Fix: compare against `sanitizeHostname(sidecar.derivedFrom)` (the
  recorded derivation host) — collision-safe, roster-free, and identical to the authored matrix for every
  row (all have `nodeId === derivedFrom`). **Lesson:** a heal predicate must compare hostname-to-hostname,
  never hostname-to-resolved-id; and a `@executable` matrix that only exercises the injectable helper can
  miss the real (roster-less) integration call site — add a call-site-level regression row.
- **Story 00 · DoD migration ran as a live derive, not the sanctioned `migrateIdentity` (benign here).**
  The migration of aof's own committed config produced the sidecar via a fresh `deriveNodeId` (a new salt +
  a `derivedFrom` key), not a byte-verbatim `migrateIdentity` of the committed `salt`. Harmless for this
  repo (it is not a live mesh node; `nodeId` is unchanged and `umairs-msi` carries no collision suffix, so
  the id is salt-independent), but the report's "migrate moved it" claim was inaccurate. **Lesson:** when a
  DoD requires migrating the live repo, drive it through the sanctioned `migrateIdentity` (which preserves
  the committed salt verbatim *and* the fleet-shared siblings), not an ad-hoc identity command run.
- **Story 00 · fleet-shared `mesh.relay.controlNode` lost + the fitness is blind to it (deferred to 01).**
  The pre-build cleanup left the committed `mesh` block `{}` — `relay.url` removal is correct (ADR-002
  retires the broker URL), but the fleet-shared `relay.controlNode` (ADR-002.5 / ADR-004.1) was dropped and
  `mesh.fabric` is not yet declared. `acd-mesh-identity-not-committed` only asserts per-install keys are
  *absent*, so it silently passes over the *wrongful deletion* of fleet-shared keys. Restoring
  `relay.controlNode` + declaring `mesh.fabric: "tailscale"` is **story-01 fleet-shared-config work**
  (deferred there deliberately). **Lesson:** an "absence-of-X" guard cannot catch "wrongful-deletion-of-Y";
  a migration that touches a split subtree wants a companion assertion that the fleet-shared siblings survive.
- **Story 00 · a MINOR DRY refactor rippled into a reused m22 guard.** Consolidating the sidecar
  read-merge-write into one `writeSidecarPatch` (`node-identity.mjs`) relocated the atomic write, so
  `acd-mesh-write-scope`'s module scan had to add `node-identity.mjs` to keep its non-vacuity (`sawWriteText`)
  satisfied. The change *strengthens* the guard (three modules scanned, not two; still non-vacuous), but it
  is a reminder that a DRY cleanup which moves a *guarded* write touches the reused fitness function — weigh
  that cost against the cleanup's value.
- **Story 01 · a "non-blocking probe" minted identity as a hidden side effect (craft-caught, fixed).** The
  `mesh:serve --json` registered run (`launcherProbe` → `resolveNodeIdentity`) passed a `sidecarPath` into
  `resolveInstallSalt`/`deriveNodeId`, so on a fresh install the *read-only probe* WROTE
  `.aof/mesh/identity.json` — re-introducing the exact "a read command mints identity" anti-pattern story 00
  removed. Every launcher fixture pinned `config.mesh.nodeId`, so the whole `@executable` suite was green
  over the bug. **Lesson:** a "non-blocking / registered-run probe" (and the `acd-mesh-command-cli-bijection`
  gate) must be asserted **side-effect-free** (no FS write), not merely non-blocking — add a "wrote no file"
  assertion to the probe's own test, mirroring `loadWorkspace`'s.
- **Story 01 · "shares a fate" is set-atomic; a guard's liveness follows its subject's reachability.** The
  developer retired 3 of the 4 relay arch-tests and kept `acd-relay-lease-blind`, reasoning per-member that
  its guarded property (envelope kind-blindness) was "still true." But ADR-002's ledger named all four as
  sharing the broker's fate, and the broker (`serveRelay`/`relayMode`) is now DEAD code (no live caller). A
  green fitness asserting a property of an unreachable function is the "dangling green guard over dead code"
  the story contract forbids. **Lesson:** when an ADR ledger names a set that "shares a fate," fitness
  retirement is set-atomic — the right question is *is the subject still reachable?*, not *is the assertion
  still true?* (A future guard could fail when a `test/arch/*.test.mjs` exists but nothing imports it, and
  when a fitness targets a src symbol with no live caller.)
- **Story 01 · "retire" in a contract means delete-the-file, not just unwire.** Three arch-tests were
  unwired from `scripts/test.mjs` but left as orphan files on disk — a future reader mistakes them for live
  guards. Fixed (all four deleted). **Lesson:** tighten the retirement vocabulary; the supersession note
  belongs in the runner + the ADR ledger, never in an orphaned file.
- **Story 01 · a PENDING fitness was authored at Decide with a latent matcher bug.** `acd-fabric-single-seam`
  ran a string-literal spawn matcher over `stripCommentsAndStrings` (which blanks string content), so the
  argv `"tailscale"` literal was erased — the un-skipped check would have been RED-not-green (an empty
  `spawnSites` vs `[mesh-fabric.mjs]`), not vacuous. Caught + fixed at build (switched to `stripCommentsOnly`,
  the sibling `acd-mesh-sync-record-neutral`'s established split). **Lesson:** a PENDING fitness authored at
  Decide should be self-tested at authoring time that its *real* (un-skipped) `run` path would execute and be
  non-vacuous — not only that the placeholder is green.
- **Story 01 · DEFERRED cleanup (out of scope — recorded, not done).** With the broker retired, `serveRelay`/
  `relayMode`/the m24 `/enroll` device-flow route are now **dead-but-parked** code, and the m24 enrollment
  behavioural suites (`meshRelayAuthGate`/`meshEnrollDeviceFlow`/`meshInviteMint`/`meshJoinProvision`/…) still
  run green over that unreachable code. ADR-002.consequence explicitly permits the enrollment path to remain
  "deprecated/optional," and **re-accepting m18–28 is out of scope** (SPEC). So the dead code + its suites were
  LEFT IN PLACE deliberately. Carry-forward: a future milestone (or the UAT 32 re-run cleanup) should either
  delete the enrollment apparatus or mark it `@deprecated` with an ADR-002 amendment. `mesh-join.mjs` still
  reads `config.mesh.relay.url` as the enrollment endpoint (ADR-002.consequence allows `.url` as a deprecated
  no-op for one release) — same parking decision. Also deferred: the launcher's redundant `tailscale status
  --json` spawns (3×/probe, 2×/serve) — a fire-and-parse consolidation (RESEARCH §4), not incorrect.

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — full suite **2235/0** at build+review close (`2026-07-04`)
- [x] Fitness functions green — NEW `acd-mesh-identity-not-committed` (F-3203) + `acd-fabric-single-seam`
  (F-3202/F-3204) un-skipped & green; the four `acd-relay-*` broker guards retired (ADR-002); all reused
  guards (`acd-mesh-partition-write`, `acd-mesh-sync-record-neutral`, `*-write-scope`,
  `acd-mesh-command-cli-bijection`) stay green
- [ ] `@manual` signed off — tasks `00/04` (cross-OS distinct identity) + `01/05` (live-tailnet cross-OS
  fleet e2e) — real Windows+macOS hardware, at `aof:verify`
- [ ] Re-run **UAT 32** (whole-mesh acceptance) — the true acceptance of this rework
