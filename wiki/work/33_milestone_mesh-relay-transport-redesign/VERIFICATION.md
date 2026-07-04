---
doc: verification
milestone: 33
updated: 2026-07-04
---
<!--
  Milestone VERIFICATION.md — the accept record for milestone 33. Written at aof:verify.
  Pointers, not restatements. Only sections with content appear.
-->
# 33 · Mesh Relay/Transport Redesign — Verification

Verified `2026-07-04` by `aof:verify 33`. Both stories were `in-review`; no `@uat` scenarios
and no UI/DESIGN surface, so no human-acceptance broker and no design-conformance lane. The two
open lanes are both `@manual` (real cross-OS hardware + a live Tailscale tailnet).

## Verification evidence

- **`@executable` suite + fitness functions — GREEN, 2235/2235, 0 failures** (`node ./scripts/test.mjs`).
  - `verifies →` story 00 tasks 00–03 (identity-sidecar-persist, loadworkspace-hydration,
    backcompat-migrate-doctor, self-heal-hostname-mismatch) and story 01 tasks 00–04 (fabric-seam,
    fabric-liveness-cutover, broker-retirement, coordination-launcher, operator-guidance).
  - **Fitness DoDs both un-skipped + GREEN:** `arch/mesh-identity-not-committed` (story 00 DoD, F-3203)
    and `arch/fabric-single-seam` (story 01 DoD, F-3202/F-3204). `verifies →` each story's Fitness unit.
  - **Restored invariant GREEN:** `arch/mesh-partition-write` (the invariant F-3203 broke) + the full
    reused guard set (`*-write-scope`, `mesh-sync-record-neutral`, `mesh-command-cli-bijection`).
- **Broker retirement — verified structurally.** `verifies →` story 01 task 02 + its Retire unit.
  The five relay/presence arch-tests (`acd-relay-stateless` / `-envelope-neutral` / `-auth-gate-checked`
  / `-lease-blind`, `acd-presence-relay-independent` / `-subscriber-cache-only`) are **deleted from disk**
  and **unwired** from `scripts/test.mjs` (only supersession comments — `superseded by 33/ADR-002` —
  remain, per the contract). `src/mesh-presence-subscriber.mjs` + `src/mesh-presence-cache.mjs` are deleted.
- **`mesh:serve` registered run is a NON-BLOCKING, READ-ONLY probe.** `aof mesh serve --json` on the repo
  config (fabric undeclared) returned `{"fabricState":"fabric-undeclared","healthy":false,"selfAddress":null,
  "peerCount":0,"issuanceAuthority":false}` cleanly (exit 0, no crash — the ADR-001.2 fabric-undeclared
  refusal) and `.aof/mesh/` was **byte-unchanged** before/after. `verifies →` story 01 task 03 + the
  story-01 craft fix (the launcher probe minting identity, now read-only).
- **Per-install identity is off committed config (direct inspection).** Committed `.aof/aof.config.json`
  `mesh` block is `{}` (no `nodeId`/`salt`); the git-ignored sidecar `.aof/mesh/identity.json` holds
  `nodeId:"umairs-msi"`, a `salt`, `derivedFrom:"Umairs-MSI"` (the real hostname); `git check-ignore`
  confirms the sidecar is ignored via `.aof/.gitignore:13 (mesh/)`. `verifies →` story 00 tasks 00–01.

## Live / environmental checks

The verify host is `umairs-msi` (Windows), on a **live** Tailscale tailnet (`tailscale 1.98.4`,
`BackendState: Running`) that also carries `umairs-mac-mini` (macOS) under the same `umair@` account —
so the Windows-side + live-fabric-parse halves of both `@manual` lanes were discharged on real hardware
(the RESEARCH §3/§4 gaps the fixtured lanes stood in for). Driven inline against the real `tailscale`.

- **`probeFabric` on the live tailnet →** `{"fabric":"tailscale","state":"Running","healthy":true,
  "reason":null}` — the two-stage probe parsed real `tailscale status --json` and read `BackendState`.
  Closes RESEARCH §4's "live-parse unmeasured" gap for `Running` on Windows.
- **`selfAddress` →** `100.90.249.80` (matches `Self` in the live status). **`launcherProbe` (fabric
  declared) →** `{"fabricState":"running","healthy":true,"selfAddress":"100.90.249.80","peerCount":5,
  "issuanceAuthority":false}`, hydrated `nodeId:"umairs-msi"` from the sidecar overlay, read-only.
- **Windows PATH reality (RESEARCH §3):** a bare `tailscale` resolves off PATH here
  (`C:\Program Files\Tailscale\tailscale.exe`) — the install-path fallback was not needed.

**Story 00 / task 04 — cross-OS distinct identity: PASS on real hardware.** `umairs-mac-mini` ran
`aof mesh identity` on `f3a4283` and returned its sidecar (via Taildrop): `nodeId:"umairs-mac-mini-local"`,
its own `salt`, `derivedFrom:"Umairs-Mac-mini.local"`. **Distinct** from this box's `umairs-msi` (different
nodeId AND salt); the mac did **not** inherit `umairs-msi` — the F-3203 fix confirmed on a live cross-OS
pair (task 04 scenarios "distinct nodeId" + "own git-ignored sidecar"). BUT the same real observation
surfaced a blocker in the story-01 fabric join — see **F-3302** below.

<!-- CORRECTION: an earlier draft of this section claimed the macOS peer "joined correctly via the DNSName
     leading-label fallback." That was a FALSE POSITIVE — it used a hand-guessed roster (`umairs-mac-mini`,
     without the `.local`), not the mac's REAL aof nodeId. With the real nodeId (`umairs-mac-mini-local`,
     read off the mac's actual sidecar) resolvePeers surfaces the mac UNJOINED. See F-3302. -->

**RESEARCH-gap facts measured (feed back to RESEARCH):** live `tailscale status` `BackendState` on Windows
is `Running`; a bare `tailscale` resolves off PATH on Windows (no install-path fallback needed); macOS
`os.hostname()` carries the mDNS `.local` suffix (`Umairs-Mac-mini.local`), which Tailscale does NOT
(`umairs-mac-mini`) — the divergence behind F-3302.

**Mac-side lanes run at verify (operator decision `2026-07-04`).** The operator chose to run the
two-machine cross-OS e2e on real hardware rather than defer it to the UAT 32 re-run, and stood up
`umairs-mac-mini` on the branch (`f3a4283`, committed + pushed to unblock). Task 04's identity lane was
observed on the mac (sidecar returned via Taildrop) — **PASS on distinct identity, but it surfaced the
BLOCKER F-3302** (the `.local` fabric-join break). **Task 05 (the `--serve` fleet issue→run→watch e2e,
shields-up/ACL, App-Store-split) was NOT reached** — F-3302 halts it, because the mac cannot be seen as an
identified node on the fabric, which is task 05's first precondition ("`mesh:status` shows EVERY node").
Task 05 resumes after F-3302 is fixed.

## Accept decision

**NOT ACCEPTED — milestone 33 stays `in-review` `2026-07-04`; a BLOCKER finding is open (F-3302).**
Every automated + structural gate passed (suite 2235/0, both fitness DoDs green, `arch/mesh-partition-write`
restored, relay guards retired, `aof work validate` PASS), and the cross-OS identity lane (task 04) PASSED
on real hardware — the mac derives a distinct per-install id off committed config. **But the real-hardware
run did its job and caught what the fixtures could not:** on macOS the `os.hostname()` `.local` suffix makes
the aof nodeId (`umairs-mac-mini-local`) diverge from the Tailscale hostname (`umairs-mac-mini`), so the
ADR-002.2 fabric peer→nodeId join leaves the mac **unjoined** — the milestone's "see every node + assign
cross-node" objective is broken for macOS nodes (**F-3302, blocker**). The acceptance rule ("no blocker
finding open") is not met. Route F-3302 to a fix (`@bug` task, `aof:continue` on story 01), then re-verify
the live cross-OS join + run task 05. Retrospective + memory-ingest + STATE compaction run at acceptance,
not now. F-3301 (fleet-shared config) remains minor/deferred.

## Findings

- **F-3302 — macOS `.local` hostname suffix breaks the ADR-002.2 fabric peer→nodeId join (BLOCKER).**
  Observed on the live cross-OS pair: macOS `os.hostname()` returns `Umairs-Mac-mini.local` (the mDNS
  suffix), and `sanitizeHostname` (`node-identity.mjs:101`) does NOT strip it — it maps `.` → `-`, deriving
  aof `nodeId:"umairs-mac-mini-local"`. Tailscale's HostName/DNSName for the SAME box is `umairs-mac-mini`
  (no `.local`). `resolvePeers` joins fabric peers to aof nodeIds by HostName / DNSName-leading-label
  (`mesh-fabric.mjs:262-278`), so with the REAL roster (`umairs-msi`, `umairs-mac-mini-local`) read off the
  published node records, the macOS peer matches **neither** key and surfaces **UNJOINED** (`nodeId:null`) —
  verified against live `tailscale status --json` from `umairs-msi`.
  Impact: the milestone's core objective — "**see every node** + assign and run work end-to-end" over the
  fabric — is **broken for any macOS node**: from Windows the mac appears as an unidentified peer, so
  `mesh:status` can't map its fabric liveness to its aof identity and cross-node issuance can't target it by
  nodeId. This is the exact F-3204 integration promise failing on the real fabric. It passed CI because the
  `mesh-fabric-seam/00` fixtures use idealized rosters where the aof nodeId **equals** the Tailscale HostName
  (`umairs-mbp`/`umairs-mbp`, no `.local`) — the `.local` case was never modelled.
  Type: bug (cross-OS integration). Severity: **blocker**. Triage (PO/inline): **blocker** → route to a new
  `@bug` task (`@finding-F-3302`) + fix via `aof:continue`, then re-verify the live cross-OS join.
  **FIX LANDED `2026-07-04`** (`aof:continue`, story 01): `sanitizeHostname` (`node-identity.mjs`) now
  strips a trailing `.local` so macOS derives `umairs-mac-mini` matching Tailscale; the self-heal
  (`healIdentitySidecar`, `work.mjs`) gained a churn-safe **stale-format trigger** (new exported
  `isDerivationOf`) so an existing `.local` id auto-migrates on next load (recognises the collision-suffixed
  form → a legitimate collision id is never churned; self-terminating). Regression tests added: the
  `mesh-fabric-seam/00` **F-3302** case derives the roster nodeId from a `.local` hostname so a revert goes
  RED (the fixture gap that hid this); a `self-heal/03` **F-3302** case locks the auto-migration; the
  codified-wrong `identity-sidecar-persist` row `["MacBook-Pro.local","macbook-pro-local"]` corrected to
  `"macbook-pro"`. Suite **2237/0**. Live-tailnet re-check from `umairs-msi`: the pre-fix id
  (`umairs-mac-mini-local`) resolves UNJOINED; the post-fix id (`umairs-mac-mini`) JOINS the live peer.
  Status: **FIXED in code + verified locally/live; awaiting the mac re-derive (auto-heal) + task 05 re-run
  on real hardware to close.** Routed-to: `aof:continue` (story 01) — done.
- **F-3301 — fleet-shared committed `mesh` config was not restored (minor / non-blocker / defer).**
  Observed: committed `.aof/aof.config.json` `mesh` block is `{}` — neither `relay.controlNode` nor
  `mesh.fabric` is declared (ADR-004.1 says a real node's fleet-shared config holds both). Story 00's
  STATE feedback explicitly flagged restoring these as "story-01 fleet-shared-config work (deferred there
  deliberately)," but story 01's close does not address it and `mesh` is still `{}`.
  Type: gap (un-closed deferred item). Severity: minor. Triage (PO/inline): **defer** — the aof self-host
  repo is **not a live mesh node** (`.aof/.gitignore`: "the aof self-host repo is NOT a live mesh node"),
  so `mesh:{}` is defensible for *this* repo, and the fabric model works because an operator declares
  `mesh.fabric` per real node (as done in the live probe above). The fleet-node config *template*
  (`relay.controlNode` designation + `mesh.fabric`) is properly a concern of the UAT 32 re-run, which
  stands up a real fleet. Routed-to: backlog / the UAT 32 re-run. Status: **open (deferred)** — not a
  blocker for milestone 33 acceptance. Note the `acd-mesh-identity-not-committed` fitness is blind to
  fleet-shared *presence* (it only asserts per-install keys are *absent*), so it cannot catch this class.
