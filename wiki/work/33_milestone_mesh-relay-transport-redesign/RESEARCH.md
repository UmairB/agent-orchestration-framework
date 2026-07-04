---
doc: research
---
<!--
  Milestone RESEARCH.md — answers ONE question: what did we learn that constrains the choices?
  Owner: researcher. Report facts; the architect decides what to do about them (→ ARCHITECTURE.md).
-->
# 33 · Mesh Relay/Transport Redesign — Research

**Gathered:** 2026-07-04
**Method:** This repo as ground truth for the CURRENT transport (`src/mesh-relay.mjs`,
`src/mesh-relay-client.mjs`, `src/mesh-presence.mjs`, `src/node-identity.mjs`) plus the origin findings
in `wiki/work/32_uat_whole-mesh-acceptance/SESSION.md` (F-3201..F-3204). Tailscale facts from the
vendor CLI reference, the `ipnstate` Go package docs (the actual struct `tailscale status --json`
serializes), the macOS-variants doc, and community write-ups on backend-state detection — no Tailscale
CLI was run locally in this pass (no tailnet available in this environment); every Tailscale claim below
is **vendor-doc or third-party-observed**, not measured on this machine. That gap is flagged per section.
**Status:** Desk research complete. No blockers found for a Tailscale-first design; the load-bearing
unknowns are two vendor behaviors that are documented but NOT independently measured here (peer-map
"is this stale/authoritative" latency, and the exact not-installed vs not-logged-in CLI error shapes on
each OS) — flagged as `@manual` in the fitness/testability notes below, for the architect to schedule.

---

## 1. Self-address discovery

**Finding.** A node learns its own fabric address three ways, all first-party CLI:
- `tailscale ip --4` / `tailscale ip --6` / `tailscale ip --1` (prefer-IPv4-single) → prints ONE bare
  IP to stdout, e.g. `100.121.112.23` (no JSON wrapper on this specific subcommand). Invocation:
  `tailscale ip [flags] [<hostname>]`; flags `--4`, `--6`, `--1`, `--assert=<ip>` (Tailscale CLI
  reference).
- `tailscale status --json` → the `Self` key is a full `PeerStatus` object (see §2 for the shared
  struct) carrying `TailscaleIPs: []netip.Addr` (both v4 and v6, CGNAT + ULA), `DNSName` (the
  MagicDNS FQDN, **trailing-dot form**: `"host.<tailnet>.ts.net."`), `HostName`, `OS`, and the rest of
  the peer fields — i.e. "my own address" is just `Self` read out of the same JSON shape as any peer.
- The IPv4 address is drawn from the **CGNAT range `100.64.0.0/10`** (100.64.0.0–100.127.255.255) by
  default; a v6 ULA (`fd7a:115c:a1e0::/48`-derived) accompanies it. MagicDNS names take the form
  `<hostname>.<tailnet-name>.ts.net`.

**Constraint.** Self-discovery needs no separate code path from peer discovery — `Self` and each
`Peer[...]` entry are the identical struct (`ipnstate.PeerStatus`), so "what is my address" and "what is
peer X's address" are the same parse with a different map key (`.Self` vs `.Peer["nodekey:..."]`).
`tailscale ip` is the cheaper single-purpose call when only the address (not the full peer map) is
needed. The DNSName's trailing dot must be stripped/tolerated by any consumer that compares it to a
non-FQDN form.

**Confidence:** vendor-doc (CLI reference + `ipnstate` Go package docs). NOT measured on a live tailnet
in this pass.
**Sources:** https://tailscale.com/docs/reference/tailscale-cli ,
https://pkg.go.dev/tailscale.com/ipn/ipnstate ,
https://tailscale.com/kb/1015/100.x-addresses ,
https://tailscale.com/docs/reference/reserved-ip-addresses

---

## 2. Peer discovery + liveness

**Finding.** `tailscale status --json` returns one JSON document shaped as the Go `ipnstate.Status`
struct:

```go
type Status struct {
    Version, TUN, BackendState, HaveNodeKey, AuthURL string/bool
    TailscaleIPs   []netip.Addr
    Self           *PeerStatus
    ExitNodeStatus *ExitNodeStatus
    Health         []string
    CurrentTailnet *TailnetStatus   // MagicDNSSuffix lives here now (Status.MagicDNSSuffix is deprecated)
    Peer           map[key.NodePublic]*PeerStatus   // keyed by "nodekey:<hex>"
    User           map[tailcfg.UserID]tailcfg.UserProfile
}
```

Each `Peer[...]` value (and `Self`) is a `PeerStatus`:

```go
type PeerStatus struct {
    ID, PublicKey, HostName string
    DNSName        string       // FQDN with trailing dot: "host.<MagicDNSSuffix>."
    OS             string
    TailscaleIPs   []netip.Addr
    Addrs          []string     // candidate ip:port pairs
    CurAddr        string       // the ip:port actually in use, if roaming
    Relay          string       // non-empty ⇒ DERP region name currently relaying this peer
    LastSeen       time.Time    // populated ONLY when Online == false
    LastHandshake  time.Time
    Online         bool
    ExitNode, ExitNodeOption, Active, ShareeNode, InNetworkMap, InMagicSock, InEngine, Expired bool
    KeyExpiry      *time.Time
}
```

**Authoritative liveness signal:** `Peer[x].Online` (bool) is the field to read for "is peer X up" — it
is maintained by the coordination-server control channel, not a local ping. `Active` additionally tells
you whether a WireGuard session is currently established (traffic has flowed recently) vs merely
`Online` (reachable per control-plane, i.e. not disconnected from Tailscale). `LastSeen` is populated
**only when offline**, so it cannot be read as a general last-contact timestamp for online peers.
`Relay` (non-empty) tells you the peer's traffic is currently DERP-relayed rather than direct — but per
§5 this does not change dialability, only the field is diagnostic.

**Constraint.** A node enumerating the fleet without a central broker parses ONE JSON blob
(`tailscale status --json`) into `Self` + `Peer` map — no separate discovery protocol is needed; the
tailnet coordination server (Tailscale's control plane, itself centralized but OUT of this app's control
and already running) is the thing maintaining `Online`. The map is keyed by node **public key**, not by
this app's own `nodeId` — any cross-reference between a Tailscale peer and an aof `nodeId` needs a
join key (e.g. `HostName`/`DNSName` correlation, since aof's `deriveNodeId` also derives from hostname —
`src/node-identity.mjs:80-95`). `--json`'s own doc warns **"format subject to change"** — it is not a
frozen/versioned API contract.

**Confidence:** vendor-doc (`ipnstate` Go package — this is literal ground truth since it's the actual
Go struct marshaled to JSON, not a docs paraphrase). NOT measured live in this pass — the *cadence* of
`Online` transitions (how fast a peer going down is reflected) is undocumented in the sources found and
should be a `@manual` live-fleet measurement, not assumed.
**Sources:** https://pkg.go.dev/tailscale.com/ipn/ipnstate ,
https://tailscale.com/docs/reference/tailscale-cli ,
https://github.com/tailscale/tailscale/issues/17619 (flags `--json` as subject to change)

---

## 3. Cross-OS CLI reality

**Finding — Windows.** `tailscale.exe` installs under `C:\Program Files\Tailscale\` (MSI/GUI installer
docs use `C:\Program Files\Tailscale IPN\` in some builds — the exact folder name has varied across
releases; both are cited in current vendor/community docs). The docs do not confirm the installer adds
this directory to system `PATH` automatically; a `spawn`/`execFile` of a bare `tailscale` on Windows can
legitimately ENOENT even when Tailscale is installed and running, if PATH was not updated — this is the
generic Windows `child_process` PATH-resolution gap (Node's `spawn` on Windows resolves executables
differently from `exec`, a long-documented Node issue), not Tailscale-specific.

**Finding — macOS.** THREE distinct client variants exist, with DIFFERENT CLI availability
(https://tailscale.com/docs/concepts/macos-variants):
1. **Standalone** (downloaded from Tailscale's own site, uses a system extension) — full CLI (`yes`).
2. **Mac App Store variant** (Apple Network Extension, sandboxed) — **CLI access does NOT work the
   same**; sandboxing prevents the CLI/GUI app from reliably reaching the daemon in all cases, and at
   least one specific subcommand (`tailscale ssh`) is explicitly disabled on this variant ("no, must use
   the regular ssh command"). Community-reported: calling the CLI from within a macOS sandboxed context
   can fail to detect whether the daemon is even running.
3. **Open-source `tailscaled`** (CLI-only, no GUI, kernel `utun`) — full CLI (`yes`).

**Finding — Linux.** No sandboxing variant issue; the CLI ships as a normal `tailscale` binary via the
package manager / official install script, invoked identically to the open-source macOS path.

**Constraint (direct de-risk of F-2701, the 3-OS soak lane).** The transport CANNOT assume "the
`tailscale` CLI behaves identically everywhere it is installed" — on macOS specifically, the OPERATOR
must be steered to the **Standalone** (or open-source `tailscaled`) build, not the **App Store** build,
or CLI-based self/peer discovery silently degrades. This is an install-time/doctor-check concern, not
something the transport code can detect-and-fix at runtime beyond "CLI call failed, tell the operator
why." Windows PATH is a second, generic cross-OS variable to verify (fall back to the well-known
install path if a bare `tailscale` ENOENTs).

**Confidence:** vendor-doc (macOS-variants page is Tailscale's own) for the macOS finding — high
confidence, directly on-point for F-2701. Windows PATH behavior is inferred from install docs + generic
Node ENOENT reports, NOT measured on a real Windows box with a real Tailscale MSI install in this pass —
flag as `@manual` (install real Tailscale on the Windows/macOS/Linux boxes used for the F-2701 soak and
confirm `tailscale` resolves off PATH + `--json` parses identically on all three).
**Sources:** https://tailscale.com/docs/concepts/macos-variants ,
https://tailscale.com/kb/1189/install-windows-msi ,
https://tailscale.com/kb/1022/install-windows ,
https://github.com/nodejs/node/issues/8077 (Windows spawn PATH resolution)

---

## 4. Membership / not-installed detection

**Finding.** `BackendState` (a `string` field on the top-level `Status`, i.e.
`tailscale status --json | jq .BackendState`) is an enum documented as one of: `NoState`,
`NeedsLogin`, `NeedsMachineAuth`, `Stopped`, `Starting`, `Running` (`ipn.State` in
`tailscale/tailscale`'s `ipn/backend.go`). A community script
(alexwlchan, cited) drives an operational check purely off this field: `Running` → healthy;
`Stopped` → daemon present but not up; anything else → warn/investigate — and notes that **in
practice only `Running` and `Stopped` are commonly observed**, i.e. `NeedsLogin` (logged out / tailnet
not joined) is real but rarer in the wild than the enum's breadth suggests.

**Two distinct failure classes, distinguished at the process-invocation layer, not inside the JSON:**
1. **Not installed** — the `tailscale` binary is absent from PATH. In Node, `child_process.spawn`/
   `execFile("tailscale", …)` rejects with `ENOENT` (this is a generic Node behavior, not Tailscale-
   specific — confirmed against this repo's own `execFile`/`spawn` convention already used for `git`
   and other managed external tools, e.g. `src/cli.mjs`, `src/tool-store.mjs`). This is the
   "give actionable guidance to install Tailscale" branch.
2. **Installed but not usable** — the process runs and returns JSON, but `BackendState !== "Running"`
   (`NeedsLogin` = logged out / never authenticated; `Stopped` = daemon present but disabled;
   `NeedsMachineAuth` = admin approval pending). This is the "run `tailscale up` / contact your tailnet
   admin" branch — a parseable, non-throwing outcome, distinct from ENOENT.

No exact exit-code table for `tailscale status` itself was found in the sources gathered (the CLI
reference documents an exit-code contract only for `tailscale wait`: **0 on success, non-zero on
failure/timeout**); `tailscale status`'s own exit code on a logged-out/stopped daemon was not
independently confirmed in this pass.

**Constraint.** A robust "is the fabric usable" check is a TWO-STAGE probe: (1) can the `tailscale`
binary be spawned at all (ENOENT ⇒ not installed) — this must not hang, i.e. use a fire-and-parse
`execFile` with a timeout, not a blocking daemon call; (2) if spawnable, parse `--json`'s
`BackendState` and branch on the enum — `Running` is the only "good" state, everything else needs a
distinct, actionable message (`NeedsLogin` → "run `tailscale up`"; `Stopped` → "the daemon isn't
running"; `NeedsMachineAuth` → "waiting on tailnet admin approval"). Windows' 25H2-era regression
(GitHub issue #17875, "stuck in NeedsLogin, CLI returns 401 Unauthorized") is a real-world instance of
state (2) that any doctor-style check should treat as "the fabric itself is unhealthy," not a bug in
this tool.

**Confidence:** vendor-doc for the `BackendState` enum values (Go source `ipn/backend.go`, cited by
secondhand doc but matches the `ipnstate` struct doc); inferred/community-observed for exit codes and
the ENOENT-vs-BackendState split (not independently run on this machine — no tailnet/Tailscale install
present in this environment). Flag as `@manual`: run `tailscale status --json` in the three concrete
states (not installed / installed-logged-out / installed-running) on each target OS and record the
literal exit code + stderr text.
**Sources:** https://alexwlchan.net/notes/2025/check-if-tailscale-is-running/ ,
https://github.com/tailscale/tailscale/blob/main/ipn/backend.go ,
https://github.com/tailscale/tailscale/issues/17875 ,
https://tailscale.com/docs/reference/tailscale-cli (tailscale wait exit-code note)

---

## 5. Direct addressability semantics

**Finding.** Tailscale's own "Connection types" doc states plainly that all connection kinds (direct
P2P, DERP-relayed, and the newer peer-relay) are "end-to-end encrypted with WireGuard" and differ only
in "performance, not security" — i.e. an application dialing `100.x.y.z:port` **does not need to know or
select** which transport is underneath; the IP:port is uniformly dialable once both peers are `Online`.
Tailscale's stated internal success rate for **direct** P2P NAT traversal is "well north of 90%" of
connections; the rest fall back through DERP relay (and, more recently, peer-relay) automatically and
transparently to the socket layer.

**The one documented exception: `--shields-up`.** `tailscale up --shields-up` (or `tailscale set
--shields-up`) sets a device to **reject ALL inbound connections** from the tailnet (outbound still
works) — default is **off** (inbound allowed). A node running with shields-up is technically "Online"
in the peer map but is **not actually dialable** by other peers for anything (including ICMP ping) —
this is invisible in `PeerStatus` (no dedicated field surfaces it; you'd only discover it by a failed
dial). Tailnet **ACLs** (a server-side policy, not a local flag) can similarly restrict which peer pairs
may connect at all, independent of `Online`/`Addrs` looking healthy.

**Constraint.** "Peer is Online in the JSON" is NECESSARY but not SUFFICIENT for "peer is dialable by
me" — shields-up and ACL policy are both silent failure modes not reflected in `tailscale status --json`
fields. Any reachability model built on this fabric should treat a connect attempt's actual
success/failure as the ground truth, with the peer map as a fast pre-filter/liveness hint, not a
guarantee. This is the load-bearing fact for treating "peer IP ⇒ just reachable" as a working
assumption in the common case, while leaving room for a connect-refused outcome the app must still
handle (shields-up / ACL deny / a peer that dropped between the status snapshot and the dial).

**Confidence:** vendor-doc (Tailscale's own "Connection types" + `tailscale up` CLI reference for
`--shields-up`); the "90%+ direct" figure is Tailscale's own published metric, not independently
measured here.
**Sources:** https://tailscale.com/docs/reference/connection-types ,
https://tailscale.com/blog/how-nat-traversal-works ,
https://tailscale.com/docs/reference/tailscale-cli (up, --shields-up) ,
https://github.com/tailscale/tailscale/issues/4881 (shields-up exceptions FR, confirms current
all-or-nothing behavior)

---

## 6. The pluggable-seam fallback — prior art

**Finding.** Searches for a comparable tool's "reach a peer across fabrics" abstraction surfaced mostly
adjacent, not identical, prior art:
- **Headscale** — an open-source reimplementation of Tailscale's **control-plane/coordination server**
  only; it does not change the client-side reachability model at all (same `tailscale` client, same
  `status --json` shape, same direct/DERP transport) — it substitutes WHO runs the coordination server,
  not HOW a node discovers/dials a peer. Relevant to this milestone only as evidence that the
  coordination-plane and the data-plane/reachability model are already separable concerns in the
  Tailscale ecosystem itself.
- **Syncthing** — commonly deployed WITH Tailscale as the transport (all Syncthing traffic forced over
  the tailnet), i.e. treated as "just a network," with no fabric-abstraction layer of its own — Syncthing
  does not attempt to unify Tailscale/LAN/tunnel under one seam; it runs its own discovery (local
  broadcast + a relay pool + global discovery servers) UNLESS confined to a VPN, in which case the VPN's
  addressing is used as-is.
- **Docker network drivers** — the closest STRUCTURAL analogy for "pluggable how-do-I-reach-a-peer":
  a driver interface (`bridge`/`host`/`overlay`/`macvlan`/`none`) selected per network, each owning its
  own addressing scheme; Docker's overlay driver (VXLAN) is itself evidence that "the fabric changes the
  addressing model, not just the transport" — structurally the same shape F-3204 raises (Tailscale
  isn't "a provider," it changes the topology).
- No first-party evidence was found of a tool that abstracts "Tailscale vs raw-LAN vs WireGuard vs a
  public tunnel (cloudflared/ngrok/devtunnel)" behind ONE reachability seam with equivalent semantics —
  the tunnel tools (cloudflared/ngrok/devtunnel) are fundamentally a DIFFERENT shape (they mint an
  ephemeral externally-routable URL/hostname for ONE process, not a persistent fabric-wide address per
  node), which is exactly the asymmetry F-3204 already named ("Tailscale changes the topology, not
  merely the provider").

**Constraint.** Nothing found contradicts F-3204's premise. The clearest prior-art precedent for a
"provider seam" shape (Docker network drivers) is itself evidence that different fabrics genuinely have
different addressing primitives (a driver isn't just a different transport wire-format; it changes what
"a node's address" even means) — supporting the idea that a naive `provider: tailscale | lan | tunnel`
enum-with-shared-shape (F-3202's original proposal) would be modeling three genuinely different
topologies as if they were one interface. This is a fact pattern, not a recommendation — the choice of
whether/how to keep ANY seam (vs hard-coding Tailscale) is the architect's call.

**Confidence:** inferred (no single authoritative "how comparable tools solve this" doc exists; this is
a synthesis across several vendor pages and this repo's own F-3202/F-3204 framing).
**Sources:** https://github.com/juanfont/headscale ,
https://docs.docker.com/engine/network/drivers/overlay/ ,
https://tailscale.com/opensource

---

## Open questions for the architect

These are genuine design choices this research deliberately does NOT answer:

- Central coordinator vs fully peer-to-peer for aof's OWN coordination layer (issuance/routing), now
  that Tailscale already supplies a control plane for *network* reachability — does aof still need its
  OWN "control node" concept for anything beyond today's `relay.controlNode` git-remote-grant role?
- Whether the Tailscale-fabric assumption is enforced via a **sidecar check** (a `doctor`-style runtime
  probe of `tailscale status --json`) vs a **static config declaration** the operator asserts once —
  and what happens when the probe and the declared config disagree.
- Whether ANY pluggable seam survives F-3204's "topology, not provider" framing — e.g. a much thinner
  seam (just "how do I resolve a peer's dial address" as one function) vs no seam at all (Tailscale
  hard-coded, LAN/tunnel deferred to "a later story" as SPEC.md already scopes out).
- How aof's own `nodeId` (hostname-derived, `src/node-identity.mjs`) is correlated with a Tailscale
  peer's identity (public key / `HostName` / `DNSName`) — same value reused, or a join performed at
  presence-publish time.
- What replaces the current device-code enrollment + git-remote grant (F-3201/`mesh-registry.mjs`) once
  "already on the tailnet" is the trust boundary — is tailnet membership itself sufficient authorization
  to join the aof mesh, or is a second, lighter admission step still wanted.
- How `shields-up`/ACL-deny failures (§5) are surfaced to an operator mid-flow (a connect refusal is
  indistinguishable from "peer just went offline" at the socket layer) — a UX/diagnostics design choice.
- Whether the `--json` "format subject to change" warning (Tailscale's own caveat, github#17619) is
  significant enough to warrant a compatibility-shim/version-pin strategy, or accepted as a low risk.
