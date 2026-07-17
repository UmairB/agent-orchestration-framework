---
type: uat
number: 32
slug: whole-mesh-acceptance
title: "Whole-Mesh Acceptance — the mesh + runs + console delivery as an integrated whole (18–28)"
status: blocked
owner: qa
depends: [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]
created: 2026-07-03
updated: 2026-07-04
schema: 1
aofVersion: 0.1.0
---
<!--
  UAT SESSION.md — the record doc for an acceptance session. Answers ONE question:
  is the delivery so far acceptable as an integrated whole, and have we confirmed it?
  Owner: qa. A uat session GROUPS no stories and delivers no new behaviour — it references existing
  scenarios across the milestones it accepts (`depends:`), re-runs what can be automated, and brokers
  the irreducibly-human acceptance. THE RULE: reference scenarios (verifies →), NEVER restate them.
  It gates the stream: downstream work that `depends:` on it waits until status is `done`.
-->
# 32 · Whole-Mesh Acceptance — UAT Session

## Scope

This session accepts the **runs → mesh → console** delivery as one integrated whole — the experiential
human acceptance the operator elected to perform holistically rather than per-milestone (see
[27/VERIFICATION.md](../27_milestone_work-issuance-routing/VERIFICATION.md) "User sign-off"). Each
milestone below is already accepted on its OWN gate; this session confirms they hold **together**.

- **Accepts** (the `depends:` span):
  - `18_milestone_integration-descriptor`, `19_milestone_work-run-lifecycle`,
    `20_milestone_autonomous-run-resilience`, `21_milestone_board-run-observability` — the durable/
    resumable run substrate the fleet runs ride on.
  - `22_milestone_mesh-foundation`, `23_milestone_control-node-relay`, `24_milestone_group-enrollment`,
    `25_milestone_mesh-ui`, `26_milestone_distributed-runs-leasing`,
    `27_milestone_work-issuance-routing` — the mesh support proper (identity → relay → enrollment →
    fleet view → leasing → issuance/routing).
  - `28_milestone_console-app` — the cross-platform console/packaging that ships it.
- **Entry:** every accepted milestone is `done` (its own `@executable` + `@manual` lanes green).
  **BLOCKED until `27` (done ✓) and `28` (in-progress — verifying) are both accepted.**
- **Exit:** every check below has a result, and no **blocker** finding is open.

## Plan

The `@executable` suite + fitness functions across 18–28 are re-run as ONE integrated regression sweep
(green) before any human lane; only the human-judgment scenarios need a person.

- [ ] Regression sweep — re-run the `@executable` suite + fitness functions across 18–28 (green as an integrated whole)
- [ ] Re-run agent-runnable `@manual` scenarios across the accepted span (evidence below)
- [ ] Broker the human `@uat` scenarios across the accepted span (sign-off below)

## Live / environmental checks

The two headline human/environmental lanes the operator carried forward from milestone 27's accept
(27/VERIFICATION.md findings F-2701 + the delegated affordance click-through), plus the full `@uat`/
`@manual` set across 18–28 that `aof:verify 32` enumerates at run time.

- [ ] **KR3 on a real 3-OS fleet** — issue on one node, picked up + run on an eligible node on a
      DIFFERENT OS, ≥95% coverage, ≤2 sync intervals, no manual file shuffling.
      verifies → `@manual "≥95% of issued items are picked up and run on an eligible node within ≤2 sync intervals"`
      (in `27_milestone_work-issuance-routing/stories/01_story_mesh-issue-routing-pickup/tasks/06_kr3-soak.feature`)
      Environment: three OS-distinct machines (Windows + macOS + Linux), each an aof mesh node cloned
      from one shared bare remote (m27 verify measured this single-OS at 100%/≤2/0/no-shuffle — this lane
      supplies the macOS/Linux breadth, F-2701).
      1. Stand up the 3-OS fleet; issue a pool across node/capability/any targets from the control node.
      2. Run each node's sync + next + run-start cadence over the soak window.
      Expected: ≥95% picked up + run on an eligible node ≤2 sync intervals; 0 ineligible runs; no manual shuffle.
      Result: ___   By: ___   Date: ___

- [ ] **The fleet `[⊕ assign]` affordance — interactive click-through** — open the picker, stage a
      target, issue, observe the submitting → success (or error → retry) states on a real control node.
      verifies → `@uat "clicking [assign] opens the anchored target picker with the three grouped kinds"` +
      `@uat "submitting POSTs to /api/mesh/issue and shows the quiet in-flight then the calm success confirmation"`
      (in `27_milestone_work-issuance-routing/stories/02_story_fleet-ui-issue-affordance/tasks/02_assign-affordance.feature`)
      Environment: `aof mesh ui` on a control node with a populated fleet; a browser.
      (m27 verify confirmed the static states CONFORMS — idle + gated-absent; this lane supplies the live
      interactive-state experiential confirmation.)
      1. Open the fleet view; click `[⊕ assign]` on a board tile; pick a target; click `Issue ▸`.
      Expected: anchored picker (Any/Nodes/Capabilities); quiet in-flight; calm success micro-ack; a
      failed issue shows the tile-scoped accent/crimson error + teal Retry.
      Result: ___   By: ___   Date: ___

## Acceptance judgment (human, not a scenario)

- [ ] **Does the whole mesh actually deliver "issue anywhere, run anywhere, watch from one place"?**
      The whole-is-more-than-its-parts question: work issued/targeted from the fleet view flows across
      real machines, runs durably/resumably, and is observable — as one product, not six milestones.
      Owner: umair (operator)   Result: ___   Date: ___

## Findings

Raw acceptance observations captured during the session (via `aof:feedback 32`). Type / severity /
triage / routed-to are left blank deliberately — they are decided at this session's `aof:verify`
triage, not at capture.

| id | observed | type | severity | triage | routed-to | status |
|----|----------|------|----------|--------|-----------|--------|
| **F-3201** | `2026-07-03` — Relay launcher was a **shipped gap**: no foreground serve verb — `aof mesh relay` is only the non-blocking status probe; the long-lived serve ("the launcher's job", `command-core.mjs`) was never delivered, and m28 node mode ships *"everything but mesh relay"* (`cli.mjs:42`). This blocks the device-code-enrollment + live-presence lanes of a real cross-machine fleet (relay unreachable ⇒ `mesh join` has no `/enroll` to POST to). **Prototyped this session** (operator elected "quick working prototype"): `aof mesh relay --serve [--host <h>] [--port <n>]` — a foreground launcher over `serveRelay` with a configurable bind (default `127.0.0.1` loopback; opt-in `0.0.0.0`, safe because the m24 ws auth-gate rejects uncredentialed non-loopback peers — `acd-relay-auth-gate-checked` + the loopback-vs-group behavioural test stay green). Verified serve → `/enroll` reject → SIGTERM stop; full suite green **2221/0**. Proposed route: harden into new **milestone 33**. Raised by: umair (operator). | | | | | open |
| **F-3202** | `2026-07-03` — No **"relay provider" seam**: the relay knows how to *serve* but has no model of how it becomes *reachable* across machines — the operator must hand-derive the peer `ws(s)://…/ws/relay` URL and stand up Tailscale/tunnels manually, unguided. Proposed `mesh.relay.provider` config seam (`tailscale` \| `cloudflare` \| `ngrok` \| `devtunnel` \| `lan` \| `manual`) that resolves **both** the bind host **and** the peer URL **and** drives per-provider guidance — e.g. `tailscale` → `tailscale ip -4` + "both nodes must be on the same tailnet"; tunnels → launch the tunnel as a **managed child** reusing the milestone-12 managed-tool registry / store-first / uv-npx lanes (cloudflared/ngrok/devtunnel are just managed tools); `manual` → today's behavior. Proposed route: new **milestone 33** (relay-launcher hardening + provider seam), refine with architect + security lenses. Raised by: umair (operator). | | | | | open |
| **F-3203** | `2026-07-03` — **Node identity is inherited on clone.** The macOS node derived `nodeId: umairs-msi` (this Windows node's id) while its `host` correctly read `Umairs-Mac-mini.local`. Root cause: `config.mesh.nodeId` (+ `mesh.salt`) live in the **committed** `.aof/aof.config.json`, and `deriveNodeId` honours a pinned id **verbatim** (precedence rule 1, `node-identity.mjs:74`) — so a clone/copy inherits the origin machine's identity instead of deriving its own from hostname. **Impact:** two machines sharing a nodeId both own `nodes/<id>.json` at the same path — violating the mesh partition / add-only-merge invariant (mesh-sync ADR-002: "every record file is owned by exactly one node id at exactly one path"); they clobber each other's record (and here it collided with the control node's own id). The same rationale that git-ignores `mesh/` (machine-specific state must not be committed) applies to `mesh.nodeId` / `mesh.salt`. **Resolved direction (with operator):** split `config.mesh` into **fleet-shared** (committed: `relay.controlNode`, `relay.url`, provider — same for every clone) vs **per-install identity** (git-ignored: `nodeId`, `salt`). Identity is **derived from hostname** by default and **persisted to a git-ignored sidecar** (`.aof/mesh/identity.json`, under the already-ignored `mesh/` tree — no new ignore entry), NOT the committed config; operator override lives in the sidecar (or an `aof mesh identity --node-id` flag). On load, hydrate `config.mesh.nodeId` from the sidecar so downstream readers are unchanged; committed `mesh.nodeId` stays a back-compat fallback + a `doctor` warn-to-migrate. New fitness function: no per-install identity (`nodeId`/`salt`) in committed config. Immediate workaround: set a distinct `mesh.nodeId` + fresh `mesh.salt` on the Mac, re-run `aof mesh identity`, re-enroll. Proposed route: **milestone 33** (mesh hardening). Raised by: umair (operator). | | | | | open |
| **F-3204** | `2026-07-04` — **The relay architecture is the wrong abstraction for a mesh-VPN transport (Tailscale) and needs a rewrite.** The live shakedown showed the current model — a central control-node WebSocket **broker** + **device-code enrollment** + **git-remote grant** + **loopback bind needing tunnels** — solves reachability/NAT/identity problems that a mesh VPN (Tailscale / WireGuard) **already solves**: on that fabric every node has a stable, directly-addressable IP and NAT is handled, so the broker + tunnel-punching + device-code dance is redundant overhead. Operator's call: rewrite the relay/coordination logic around *"nodes are directly addressable on the mesh fabric; presence + issuance ride that"* rather than hub-and-spoke. **Absorbs F-3202** (Tailscale is not merely "a provider" — it changes the topology). **Blocker for whole-mesh acceptance** — this is why the session is halted. Route: **milestone 33 — mesh relay/transport redesign (Tailscale-first)**. Raised by: umair (operator). | | | blocker | milestone 33 (redesign) | open |

## Sign-off / verdict

- **Verdict: rejected — halted for relay/transport redesign.**   By: umair (operator)   Date: `2026-07-04`
- **What the gate found.** The accepted milestones (18–28) each hold on their own gates and the integrated `@executable` + fitness-function regression sweep is **green (2221/0)**. But the *whole-mesh* acceptance question — *"does this deliver 'issue anywhere, run anywhere, watch from one place' as one product?"* — is **not yet met** in a real cross-OS run: standing up a live 2-node fleet (Windows + macOS over Tailscale) surfaced four blocking gaps (F-3201 no relay launcher shipped; F-3202 no reachability/provider model; F-3203 node identity inherited on clone; **F-3204 the relay architecture itself is wrong for a mesh-VPN transport**). The mesh is not usable as an integrated whole without the milestone-33 rework.
- **Not accepted; not done.** Session `status: blocked`. Re-run this UAT after the milestone-33 relay/transport redesign lands. The individually-accepted 18–28 milestones are **unaffected** — their own gates stand; this gate rejects the *integration*, not the parts.
