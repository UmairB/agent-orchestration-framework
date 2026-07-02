---
doc: security
---
<!--
  Milestone SECURITY.md — answers ONE question: what could an attacker do, and how do we stop them?
  Owner: security (fanned out at Decide by the architect; conditional — this milestone has a real
  attack surface: it IS the mesh's trust boundary). Does NOT restate controls. A control lives ONCE
  — as a fitness function, an @executable scenario, or an ADR — and this file REFERENCES it. This is
  the threat model + the map from each threat to the control that defends it. It routes into the
  existing three verification surfaces (@executable / fitness / @manual), it is NOT a fourth.

  Coordinates with the parallel ARCHITECTURE.md (architect: device-code / credential / registry /
  relay-auth ADRs + the STRUCTURAL fitness + the story break-down). This file owns the THREAT MODEL
  + the security-specific fitness (device-code brute-force resistance, hashed-code-at-rest,
  constant-time/single-use match, revocation completeness). Same 3-story partition:
  00 group registry / 01 device-code flow / 02 relay-auth + revocation.
-->
# 24 · Device-Code Group Enrollment — Threat Model

> **Why this milestone owns the threat model.** `23/ADR-001 §"Security posture"` stood the relay up
> **PRE-AUTH** — `src/mesh-relay.mjs` binds `127.0.0.1` loopback, its only admission control is the
> pathname destroy (`pathname !== RELAY_PATH ⇒ socket.destroy()`, lines ~141-144), and it states
> plainly: *"the full threat model is authored in m24, not here … the m24 author owns it — not
> silently assumed safe."* This milestone is that transition: **pre-auth loopback relay →
> group-reachable, credential-checked relay**, and the introduction of **group membership as the v1
> trust boundary** (PRD §7.4 **A3**). The threat model is authored here because the trust boundary is
> inseparable from enrollment — a relay without enrollment has nothing to authenticate against.

## v1 scope (the boundary the model is honest about)

**v1 = single-group / trusted-operator** (`SPEC §Scope`; PRD §7.4 A3, §8 Phase-5+). The operator who
runs `aof mesh invite` is trusted; the machines they enrol are theirs; the group shares one git remote.
The model defends the join/trust flow *within* that boundary. Everything past it — untrusted /
cross-org / multi-tenant authz, audit logging, scaled credential rotation/revocation infrastructure,
per-node credential scoping — is the **deferred Phase-5+ platform fork** and is an **explicit non-goal**
(see [Residual risk & explicit non-goals](#residual-risk--explicit-non-goals)). Stated here so a
reviewer reads the boundary as a decision, not an oversight.

## Assets & trust boundaries

**Assets (what is worth attacking):**
- **A-1 · Group membership** — the v1 trust boundary *itself*. To be in the group is to be trusted
  (relay access + git-remote access). Illegitimate membership is the top-line compromise.
- **A-2 · The 6-digit device code** — in-flight (operator reads it off `aof mesh invite`, types it into
  `aof mesh join`) and at-rest (the pending invite on the group registry). A `10^6` secret with a short
  life.
- **A-3 · The mesh credential** — issued on admission: the **relay-auth token** (`src/mesh-relay-client.mjs`
  connects with it), the **stream identity** (which `nodeId` the peer publishes as), and the **git-remote
  grant** (write access to the group's git-of-record). Theft = a standing group member.
- **A-4 · The relay** — `serveRelay` in `src/mesh-relay.mjs`, moving from loopback pre-auth to
  group-reachable. Its ws upgrade handler and the enrollment HTTP endpoint (the natural host: the same
  `http.createServer` that today serves only a 426) are the network-facing surface.
- **A-5 · The git remotes the credential grants** — the group registry's git-of-record and each board's
  git. The credential's git-remote half is the blast radius of a stolen credential.

**Trust boundaries (where trust changes hands):**
- **TB-1 · Unenrolled machine → group member.** Crossed by `aof mesh join <code>` presenting a valid,
  live, unconsumed code to the control node's enrollment endpoint. THE boundary this milestone builds.
- **TB-2 · Anonymous ws connection → authenticated relay peer.** Crossed at the `server.on("upgrade")`
  handler in `src/mesh-relay.mjs` — m23 left this pre-auth (pathname-only); m24 adds the credential gate.
- **TB-3 · The git-of-record registry is the durable, fleet-synced bus** (`src/mesh-store.mjs`: the
  `.mesh/` partition is git-TRACKED, "git IS the bus", 22/ADR-003). Anything written to a registry
  record is committed and pushed to **every peer** and lives in git history — so the pending-invite
  record is *inside* the trust boundary's blast radius the moment it is written.

## Threats & mitigations (STRIDE)

<!-- One row per threat. "Defended by" REFERENCES where the control lives (fitness-function path /
     @executable scenario / ADR / @manual) — it does not describe the implementation. Status tracks
     the CONTROL, not this prose. RED = the control is authored but the owning story has not built the
     mechanism yet (the correct state at Decide). -->

| # | Threat (STRIDE) | Attack | Defended by | Surface | Status | Story |
|---|---|---|---|---|---|---|
| **T1** | Spoofing / EoP | An anonymous machine opens a ws to the group-reachable relay and is brokered signals **without a credential** (the m23 pre-auth window left open) | fitness fn `test/arch/acd-relay-auth-gate-checked.test.mjs` — the upgrade admission calls a credential-verify seam AND rejects on failure, before `clients.add(ws)` | fitness | RED-until-built | 02 |
| **T2** | Spoofing (brute-force) | An attacker on the LAN-reachable enrollment endpoint **walks the `10^6`** code space (or uses a timing oracle) to guess a live code and be admitted | short TTL + **single-use consume** + an **attempt-cap / rate-limit** on the endpoint (ADR, architect) + **constant-time** compare — fitness fn `test/arch/acd-enrollment-code-single-use-constant-time.test.mjs` (constant-time + single-use) + `@executable` `01_device-code-flow.feature` (attempt-cap rejects after N tries; TTL-expired code rejected; admission needs the control node online) | fitness + @executable | RED-until-built | 01 |
| **T3** | Info disclosure | The pending code is stored **plaintext** in the group registry → committed to git + **synced to every peer** + lives in git history (TB-3) | fitness fn `test/arch/acd-enrollment-code-hashed-at-rest.test.mjs` — the code is **hashed** (node:crypto) before the durable write; no bare `code:`/`deviceCode:` field on a persisted record | fitness | RED-until-built | 00 / 01 |
| **T4** | Tampering / replay | A **matched** code (observed on the wire, shoulder-surfed, or re-typed) is **replayed** for a second admission; or two `join`s race the same code | **single-use consume** (a matched invite is burned) + TTL expiry + **constant-time** hash compare (no timing oracle on the compare) — fitness fn `test/arch/acd-enrollment-code-single-use-constant-time.test.mjs` + `@executable` `01_device-code-flow.feature` (a consumed code is rejected on re-present) | fitness + @executable | RED-until-built | 01 |
| **T5** | Info disclosure / EoP | The **mesh credential is stolen** off a joined node (or exfiltrated in transit) → the thief is a standing group member with relay + git-remote write (A-3, A-5) | Credential stored under the node's own config/secret path (ADR, architect) + **v1 accepts the shared-remote blast radius** as documented residual risk (per-node credential scoping is Phase-5+) — see [Residual risk](#residual-risk--explicit-non-goals) R-1 + `@manual` pen-test `credential-at-rest` in `VERIFICATION.md` | ADR + @manual | deferred-scope | 02 |
| **T6** | EoP / spoofing | A **revoked** node keeps relay access (the auth-gate never reads the revocation list) and/or keeps git-remote access (de-provisioning never runs) — a revocation that **only half-applies**, or a credential that is **issued but never checked** (22/R6) | fitness fn `test/arch/acd-relay-auth-gate-checked.test.mjs` (the auth decision reads the **live** revocation/roster; a revoked credential is rejected) + `@executable` `02_relay-auth-and-revocation.feature` (a revoked node's connection is denied) + `@manual` `git-remote-deprovision` in `VERIFICATION.md` (the git-remote half is de-provisioned) | fitness + @executable + @manual | RED-until-built | 02 |
| **T7** | DoS | An attacker floods the enrollment endpoint (guessing) or the relay (oversized/rapid frames) to exhaust the control node | The relay's **frame-size floor** already lands in m23 (`resolveMaxFrameBytes` / the hand-rolled over-limit check + ws `maxPayload`, `src/mesh-relay.mjs`) — **reused, not rebuilt**; the enrollment endpoint's **attempt-cap / rate-limit** (T2's control) doubles as the guessing-flood brake (ADR, architect) | reused fitness (m23) + @executable | partial (m23) + RED (endpoint) | 01 / 02 |

### The device-code brute-force call (T2 — the load-bearing quantification)

A **6-digit** code is a **`10^6` = 1,000,000** space. This is the milestone's sharpest security call, so
it is pinned explicitly rather than left implicit:

- **Where 6 digits sits vs. prior art.** GitHub's device flow uses an **8-character alphanumeric**
  user-code (`~2.8 × 10^12` space) with **slow-polling** and server-side rate-limiting; Tailscale auth
  keys are long high-entropy secrets. A 6-**digit** numeric code is **deliberately weaker** — it is
  chosen for *human transcription* (read off one screen, typed into another), the same ergonomic trade
  GitHub's *device*-code (the short user-facing one) makes. Unmitigated, `10^6` is **walkable**: a naive
  endpoint answering ~100 guesses/sec falls in under ~3 hours, and far faster concurrently.
- **The mitigations that make 6 digits defensible for v1 (all required together — no single one
  suffices):**
  1. **Short TTL (minutes).** The code lives only long enough for the operator to type it. The window
     an attacker has to walk the space is bounded by the TTL, not by the code's lifetime-until-used.
     Pin the default in the ADR; **flag it as a documented knob** (`config.mesh.enrollment.codeTtlSeconds`).
  2. **Attempt-cap / rate-limit on the enrollment endpoint.** The endpoint must **refuse to be walked**:
     a per-code (and per-source) attempt cap so `10^6` cannot be enumerated within the TTL, and the
     control node must be **online** to admit (there is no offline verification path). This is the
     single most load-bearing control — **flag the cap + rate as a documented knob**
     (`config.mesh.enrollment.maxAttempts`), because it is the parameter that turns `10^6` from
     "walkable" into "infeasible within the TTL."
  3. **Single-use consume on match.** A matched code is burned immediately — even a correct guess is
     good exactly once, and the successful path closes the window for everyone else.
  4. **Constant-time compare.** The hash compare uses `crypto.timingSafeEqual`, so response latency
     leaks no match-progress oracle (an attacker cannot narrow the space digit-by-digit via timing).
- **Recommendation (flagged for the architect's ADR).** For v1 trusted-operator, **6 digits +
  short-TTL + attempt-cap + single-use + constant-time is defensible** — the attempt-cap makes the
  space infeasible to walk within the TTL, and the trusted-operator boundary means the attacker is not
  assumed to be on the operator's LAN in the general case. **BUT: make the code length and the
  attempt-cap/rate documented config knobs** — an operator on a hostile LAN should be able to raise the
  code length (e.g. to 8 alphanumeric, the GitHub shape) or tighten the cap without a code change. If
  the architect's ADR does not surface these as knobs, that is a finding (`@finding-` routed to the
  developer): a hard-coded `10^6` with no operator lever is the residual-risk gap this milestone must
  not ship silently.

## Security fitness functions (authored here — RED-until-built)

Each is a `test/arch/acd-*.test.mjs` arch-test, wired into `scripts/test.mjs`, carrying the m03
non-vacuous self-check (the detector demonstrably fires on a planted violation and stays quiet on the
accepted form). All three are **RED now** — the enrollment/registry/relay-auth modules do not exist yet
(the correct Decide-stage state); each turns GREEN when its owning story builds the mechanism.

| Invariant | Enforced by (arch-test) | State now | Owning story |
|---|---|---|---|
| **Hashed-code-at-rest (T3).** The pending device code is stored **hashed** (node:crypto), never as a plaintext `code:`/`deviceCode:` field on a git-committed registry record. | `test/arch/acd-enrollment-code-hashed-at-rest.test.mjs` — (a) an enrollment-surface module imports `node:crypto` + calls a hash; (b) no durable write persists a bare plaintext-code field. Discovers the surface by a source marker (`invite`/`deviceCode`/`codeHash`) so it covers whatever the story names the module. | RED | **00 · group registry** (the registry schema stores the hash) / **01 · device-code flow** (the mint hashes before write) |
| **Single-use + constant-time match (T4 / T2).** A matched code is **consumed** (burned, single-use) and the hash compare is **constant-time** (`crypto.timingSafeEqual`, not a `===` timing oracle on the `codeHash`). | `test/arch/acd-enrollment-code-single-use-constant-time.test.mjs` — (a) the match surface imports `node:crypto` + calls `timingSafeEqual` AND does NOT compare a code/hash with a raw `===`/`!==`; (b) the match/admit path calls a consume/burn/delete verb on the invite. | RED | **01 · device-code flow** |
| **Relay auth-gate + revocation completeness (T1 / T6).** The relay ws upgrade admission **verifies a credential** and **rejects** an absent/invalid/revoked one, reading the **live** roster/revocation — before a signal is brokered (the 22/R6 "the credential is actually used" guard + the pre-auth→authenticated transition). | `test/arch/acd-relay-auth-gate-checked.test.mjs` — (a) `src/mesh-relay.mjs`'s admission calls a credential-verify seam AND rejects (`socket.destroy()` / 401/1008 close); (b) the auth decision reads the live revocation/roster (inline or via an imported credential/registry module). | RED | **02 · relay-auth + revocation** |

**Compatibility note for the architect / developer.** The relay auth-gate (T1/T6) adds a credential-
**verify** seam to `src/mesh-relay.mjs`. This is compatible with m23's `acd-relay-stateless` /
`acd-relay-envelope-neutral` fitness functions: those forbid the relay importing a **record schema for
PERSISTENCE** (`mesh-store` / `mesh-presence`) and forbid a **durable write** — a credential-verify is a
**READ** (authorize a connection), not a persist. The relay stays stateless (no durable write, no
system-of-record) **and** checks the credential. The credential/registry module the auth-gate imports is
a read seam, not the forbidden persist seam. If the developer factors the roster/revocation read such
that it trips `acd-relay-stateless`, that is a finding to resolve at the module boundary, not a reason to
weaken either gate.

## Residual risk & explicit non-goals

<!-- Threats consciously NOT fully mitigated, and why. The honest list. Each links to a @manual/UAT item
     (a pen-test, a manual review) where a human confirms it, or is an explicit Phase-5+ non-goal. -->

**Accepted residual risk (v1 trusted-operator):**
- **R-1 · Shared-remote credential blast radius (T5).** The credential's git-remote half grants write to
  the **shared** group remote — a stolen credential is a standing group member with full write, and v1
  has **no per-node credential scoping**. Accepted because v1 is trusted-operator (the machines are the
  operator's own). Per-node scoping + scoped remotes are **Phase-5+**. Confirmed by `@manual` pen-test
  `credential-at-rest` (where the credential lives on a joined node; can a co-located process read it) in
  `VERIFICATION.md`.
- **R-2 · No audit trail of admissions/revocations (T6-adjacent).** v1 records the roster + revocation
  state (the registry) but keeps **no tamper-evident audit log** of who admitted/revoked whom, when.
  Accepted for trusted-operator; audit is Phase-5+. The registry's git history is the *incidental* record
  (not a designed audit control — do not rely on it as one).
- **R-3 · In-flight code exposure (T2/T4).** The 6-digit code is human-transcribed and presented over the
  relay/enrollment endpoint; on a hostile LAN without TLS it is observable in flight. v1 relies on
  short-TTL + single-use + attempt-cap to bound the value of an observed code, and on the trusted-network
  assumption. Raising the code length / adding transport encryption is the operator-knob + Phase-5+
  hardening. Confirmed by `@manual` pen-test `code-in-flight` in `VERIFICATION.md`.

**Explicit non-goals (Phase-5+ platform fork — PRD §7.4 A3, §8; NOT gaps):**
- Untrusted / cross-org / multi-tenant authz and isolation.
- Audit logging of enrollment/revocation.
- Scaled credential **rotation** and revocation infrastructure (v1 revocation is roster-edit +
  de-provision; it is not a CRL/OCSP-scale mechanism).
- Real authn/authz control plane, per-node credential scoping, scoped git remotes.

These are recorded so a reviewer reads the v1 boundary as a **decision**, not an oversight — the door is
kept clean (the trust boundary is a real seam) but the platform half is not built.

## Verification routing (pointers, not restatements)

- **Fitness** — the three arch-tests above (`scripts/test.mjs` green once stories 00/01/02 land).
- **`@executable`** — the attack-rejected scenarios: `01_device-code-flow.feature` (TTL-expired rejected,
  consumed-code-replay rejected, attempt-cap-exceeded rejected, admission-needs-control-node-online);
  `02_relay-auth-and-revocation.feature` (uncredentialed connection denied, revoked node's connection
  denied). Owned by the task `.feature` files, NOT restated here.
- **`@manual`** (developer-run pen-tests, recorded in `VERIFICATION.md`): `credential-at-rest` (R-1),
  `code-in-flight` (R-3), `git-remote-deprovision` (the T6 git-remote half — the fitness gate covers the
  relay half; a human confirms the remote de-provision actually revokes push access on a real remote).
