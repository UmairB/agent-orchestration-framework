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
- **`resolvePeers` joined the macOS peer correctly across a HostName≠nodeId divergence.** The mac's
  Tailscale `HostName` is the human-friendly `"Umair's Mac mini"` (spaces + apostrophe, ≠ any aof nodeId),
  yet the peer joined to `nodeId:"umairs-mac-mini"` via the **DNSName leading-label fallback** — the exact
  trailing-dot-tolerant ADR-002.2 join, now confirmed on real hardware. The mac is a **DISTINCT** node
  (`100.114.105.64`, `online:true`), NOT `umairs-msi` — the F-3203 fix holding on a live cross-OS pair.
- **Windows PATH reality (RESEARCH §3):** a bare `tailscale` resolves off PATH here
  (`C:\Program Files\Tailscale\tailscale.exe`) — the install-path fallback was not needed.

**Mac-side lanes HELD at verify (operator decision `2026-07-04`) — currently BLOCKED on mac exec access.**
The operator chose to run the two-machine cross-OS e2e on real hardware at this verify rather than defer
it to the UAT 32 re-run. The irreducible mac-driven observations require a shell on `umairs-mac-mini`:
story 00 task 04's mac-side `aof mesh identity` derive + the two nodes publishing to distinct
`nodes/<id>.json` on a shared remote + the copied-`.aof` self-heal on the mac; story 01 task 05's launcher
`--serve` on the mac + the full issue→run→watch e2e across both boxes + the real shields-up/ACL
dial-refusal ground truth + the macOS App-Store-CLI-split symptom.

**Blocker — no exec path to `umairs-mac-mini` from the verify host.** Probed `2026-07-04`: plain `ssh`
reaches the mac (sshd up) but returns `Permission denied (publickey,password,keyboard-interactive)` — no
key installed for `Umair@umairs-mac-mini`, no password held; `tailscale ssh` cannot authenticate because
the mac advertises **no SSH host key** (`sshHostKeys: null` in `tailscale status --json`) — Tailscale SSH
server is not enabled on the mac. To unblock, on the mac EITHER `tailscale up --ssh` (lowest friction —
then tailnet ACLs admit `tailscale ssh` as the tailnet user), OR install the verify host's SSH pubkey.
The mac also needs node + the aof CLI, and a shared bare remote (committed config free of `nodeId`/`salt`)
both boxes clone. Until then tasks 04/05 stay unobserved and milestone 33 remains `in-review`.

## Accept decision

**HELD — milestone 33 stays `in-review` (not accepted) `2026-07-04`.** Every automated + structural gate
passed (suite 2235/0, both fitness DoDs green, `arch/mesh-partition-write` restored, relay guards retired,
`aof work validate` PASS) and the Windows-side + live-fabric halves of both `@manual` lanes are confirmed
on the live tailnet. Per the operator's decision the two-machine cross-OS e2e (tasks 00/04 + 01/05) will
be observed on real hardware before acceptance; it is currently blocked on exec access to `umairs-mac-mini`
(see above). No blocker *findings* are open (F-3301 is minor/deferred). Retrospective + memory-ingest +
STATE compaction run at acceptance, once the mac-side lanes are green.

## Findings

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
