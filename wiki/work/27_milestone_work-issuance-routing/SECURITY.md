---
doc: security
---
<!--
  Milestone SECURITY.md — answers ONE question: what could an attacker do, and how do we stop them?
  Owner: security (fanned out at Decide by the architect; conditional — this milestone has a real
  attack surface: it opens the mesh's FIRST cross-machine WRITE affordance). Does NOT restate
  controls. A control lives ONCE — as a fitness function, an @executable scenario, or an ADR — and
  this file REFERENCES it. This is the threat model + the map from each threat to the control that
  defends it. It routes into the existing three verification surfaces (@executable / fitness /
  @manual), it is NOT a fourth.

  Coordinates with the parallel ARCHITECTURE.md (architect: ADR-001 the directive record + issuance
  authority; ADR-002 the mesh:issue command; ADR-004 the routing filter; ADR-006 the POST
  /api/mesh/issue fleet-UI write route — ADR-006.4 hands the threat model HERE). This file owns the
  THREAT MODEL + the security-specific fitness (the cross-origin/CSRF guard on the loopback write
  route; the revoked-issuer directive filter). The write-route + CSRF control land in story 02
  (the fleet-UI join); the revoked-issuer filter, if adopted, lands in story 01 (routing).
-->
# 27 · Cross-Machine Issuance & Routing — Threat Model

> **Why this milestone owns a threat model.** `25/ADR-004` locked the fleet view READ-ONLY and
> EXPLICITLY deferred "the issue/assign write affordance + its genuinely new authz surface to
> milestone 27, where its authz belongs." This is that milestone. It opens the mesh's **FIRST
> cross-machine WRITE affordance**: a node issues a directive that an eligible PEER picks up and
> **RUNS**. Two surfaces are genuinely new. (1) **`POST /api/mesh/issue`** — the first *inbound
> mutation* on the loopback fleet face (`27/ADR-006`); a GET read route (m25) has no cross-origin
> side-effect exposure, the first write route does. (2) **Issuance as a capability** — writing a
> directive is the act that causes another machine to execute work. This file is the security lens
> `27/ADR-006.4` charters; it does NOT re-litigate the m24 trust boundary (it RIDES it) — it models
> only what *issuance/routing* newly opens on top of that boundary.

## v1 scope (the boundary the model is honest about)

**v1 = single-group / trusted-operator** (`SPEC §Scope`; PRD §7.4 A3, §5 out-of-segment, §8 Phase-5+).
The group shares one git remote; to be in the group (git-remote access provisioned at enrolment,
`24/ADR-001`/A3) is to be trusted to issue work into the shared stream. The model defends the *new*
issuance/routing surface **within** that boundary. Everything past it — **untrusted / cross-org /
multi-tenant issuance authz** (who-may-issue-to-whom across a trust boundary, per-target
authorization, capability-scoped issuance grants) — is the **deferred Phase-5+ platform fork** and is
an **explicit non-goal** (see [Residual risk & explicit non-goals](#residual-risk--explicit-non-goals)).
Stated here so a reviewer reads the boundary as a decision, not an oversight: `27/ADR-006.3` frames
the write as riding the EXISTING m24 primitive — **issuance mints no new trust primitive**, so the
authz surface this file must fully model is the *loopback write route* + the *revoked-issuer edge*,
not a new authorization control plane.

## Assets & trust boundaries

**Assets (what is worth attacking):**
- **A-1 · The issuance affordance itself** — the ability to write a directive that causes an eligible
  peer to RUN work. In the trusted squad this is the *intended capability* (KF6); the asset worth
  protecting is that only a legitimate operator on the operator's own machine can exercise it.
- **A-2 · The loopback write route** — `POST /api/mesh/issue` on `src/mesh-ui-serve.mjs` (`27/ADR-006`),
  bound `127.0.0.1`. Its network-facing edge is a browser on the operator's own machine — which is
  precisely the CSRF surface (A malicious page the operator visits shares that browser).
- **A-3 · The directive record** — the git-tracked `.mesh/issuance/<issuer>/<ref>.json` (`27/ADR-001`).
  It carries provenance + routing only (`itemRef, issuer, target, state, issuedAt, aofVersion`) —
  **no secret** (unlike the registry's `relayAuthHash`/`codeHash`). Its integrity concern is
  *provenance* (which node issued it), not *confidentiality*.
- **A-4 · The consuming node's run lifecycle** — the machine that picks a directive up via the
  mesh-aware `next` (`27/ADR-004`) and mints a run under the m26 lease. The directive influences WHICH
  work it offers; the m26 lease + its own run lifecycle still arbitrate whether/who runs.

**Trust boundaries (where trust changes hands):**
- **TB-1 · A browser page → the loopback write route.** Crossed by an HTTP `POST /api/mesh/issue`
  reaching `src/mesh-ui-serve.mjs`. A same-origin fleet-UI request is legitimate; a **cross-origin
  request forged by a malicious page** in the same browser is the attacker. THE new boundary this
  milestone stands up (m25's read-only face had no such boundary). Modelled by **T1**.
- **TB-2 · A node → the shared git-of-record.** Crossed when `mesh:issue` writes a directive under
  `.mesh/` and `syncMesh` pushes it (`27/ADR-002.4`). This is the EXISTING m24 boundary (git-remote
  access = group membership) — issuance does not stand up a new one; it writes into its own partition
  (`27/ADR-001.1`, per-issuer, add-only). Modelled by **T2** (rides m24) + **T4** (the revoked-issuer
  residue in git).
- **TB-3 · A directive → the consuming node's `next`.** Crossed when a peer's mesh-aware `next` reads
  a synced directive and lets it narrow candidacy. A directive is a **HINT, never a grant**
  (`27/ADR-001.3`/`27/ADR-004.2`): routing NARROWS candidacy, the m26 lease ARBITRATES the claim.
  Modelled by **T3**.

## Threats & mitigations (STRIDE)

<!-- One row per threat. "Defended by" REFERENCES where the control lives (fitness-function path /
     @executable scenario / ADR / @manual) — it does not describe the implementation. Status tracks
     the CONTROL, not this prose. RED = the control is authored but the owning story has not built the
     mechanism yet (the correct state at Decide). -->

| # | Threat (STRIDE) | Attack | Defended by | Surface | Status | Story |
|---|---|---|---|---|---|---|
| **T1** | Spoofing / Tampering (CSRF) | A malicious web page the operator visits issues a **cross-origin `POST http://127.0.0.1:<port>/api/mesh/issue`** from the operator's own browser (a CORS "simple request" — `text/plain` body, no preflight; the attacker never needs to READ the response, the mutation side-effect IS the attack). Loopback bind alone does NOT stop this — the operator's browser IS on loopback. Result: an attacker-chosen directive is issued, causing an eligible peer to run attacker-influenced work | **Same-origin + non-simple-content-type guard on the write route** — fitness fn `test/arch/acd-mesh-issue-route-same-origin.test.mjs`: the `POST /api/mesh/issue` handler REJECTS a cross-origin request (an `Origin`/`Sec-Fetch-Site` present-and-foreign check) AND requires `content-type: application/json` (a bare HTML-form `POST` — the classic CSRF vector — is refused), before it reaches `invoke("mesh:issue")` | fitness | RED-until-built | **02** |
| **T2** | Spoofing / EoP (issuance authz) | An **unauthorized node** writes a directive / triggers a peer to run work without being a legitimate group member | **INHERITED — the m24 group-membership boundary**: a directive is a `.mesh/` write admitted by git-remote access provisioned at enrolment (`24/ADR-001`/A3); a revoked node is rejected by the relay auth-gate (`24/SECURITY T1/T6`, `verifyCredential`/`isRevoked`). Issuance MINTS NO NEW TRUST PRIMITIVE (`27/ADR-006.3`). The UI path is additionally control-node-framed via `isControlNode(config)` (`27/ADR-001.4`/`27/ADR-006.3`). No NEW control owed here — the boundary is m24's | inherited (m24) | inherited-green | (24) 02 |
| **T3** | Tampering / EoP (forged/stale directive → double- or mis-execution) | A **forged or replayed directive** (or a directive for an already-done item) tries to make a peer double-run, or grant itself a claim | **INHERITED — the m26 lease arbitrates, routing only narrows.** A directive is a HINT (`27/ADR-001.3`/`27/ADR-004.2`): the routing verdict can only make `next` offer an item to FEWER nodes (skip), never MORE — so no directive can manufacture a double-offer the lease would double-grant; the m26 lease (`26/ADR-003`, KR2) is the sole mutual-exclusion. Structurally pinned by the EXISTING `27/fitness #4` (mesh-free injected candidacy) + `#5` (every-ready-return); the routing-narrows-never-grants property is `27/ADR-004`'s @executable | inherited (m26) + ADR | inherited-green + RED-until-built (@executable) | (26) / 01 |
| **T4** | Spoofing / EoP (revoked-issuer residue) | A node **revoked** after issuing (m24 `isRevoked`) leaves **lingering directives** in git history / the synced tree; a consuming node's `next` keeps honouring them, so a revoked member still routes work across the fleet after its credential is dead | **Revoked-issuer directive filter** (v1 control) — fitness fn `test/arch/acd-issuance-revoked-issuer-filtered.test.mjs`: the routing read (`readIssuanceDirectives` consumed under the `next` candidacy build, `27/ADR-004.4`) SKIPS a directive whose `issuer` is in the live revocation list (`isRevoked(registry, issuer)`), reading the SAME live registry the relay auth-gate reads (revocation completeness, `24/T6`) — so revocation applies to routing as it applies to the relay | fitness | RED-until-built | **01** |
| **T5** | Info disclosure (directive at-rest) | The git-tracked, fleet-synced directive record leaks a **secret** (the `24/T3` hazard: a plaintext credential committed to git history forever) | **No secret is introduced — confirmed structurally.** The frozen six-key directive (`27/ADR-001.2`) is `itemRef, issuer, target, state, issuedAt, aofVersion` — provenance + routing only, NO `code`/`token`/`hash`/`secret` field. Guarded by the EXISTING `27/fitness #2` (frozen six-key schema — an added secret key breaks the key-set assertion) + `27/fitness #1` (write-scope: the write joins the reserved seam via `writeText`, references no record-doc, own-issuer only). No NEW control owed — the schema freeze IS the at-rest guarantee | inherited (27/#1,#2) | green-when-#1/#2-land | (27) 00/01 |
| **T6** | DoS (loopback write flood) | A malicious page (or a co-located process) floods `POST /api/mesh/issue` to spam directives / exhaust the fleet face | **Accepted bounded residual (v1 trusted-operator).** The same-origin guard (T1) already refuses the cross-origin browser flood; a co-located hostile *process* on the operator's own machine is outside the v1 trust boundary (it already has the operator's git credential — a directive flood is strictly weaker than what it can already do). No rate-limit is built v1; noted as residual R-2 with a named Phase-5+ home. The consuming side is self-limiting (a directive is a hint; the m26 lease + walk bound actual execution) | accepted residual + T1 guard | accepted | — |

### The CSRF / same-origin call (T1 — the load-bearing new-surface quantification)

This is the milestone's sharpest NEW security call — the first inbound mutation on the loopback face —
so it is pinned explicitly rather than left implicit.

- **Why loopback bind is NOT enough (the prior-art gap this milestone must close).** Today the two
  existing inbound-write faces defend with **loopback bind ALONE, no Origin check**: the board's
  `POST /api/work/feedback` (`src/board-ui.mjs`) and the m24 enrollment `POST /enroll`
  (`src/mesh-relay.mjs`) both check only method + pathname, then read the JSON body. Loopback bind
  stops a *remote network* attacker — it does **NOT** stop a **CSRF** attacker: any web page the
  operator visits in the same browser can `fetch("http://127.0.0.1:<port>/api/mesh/issue", { method:
  "POST", body: "…" })`. With a `text/plain`/form content-type this is a CORS **simple request** — the
  browser sends it **without a preflight** and the attacker does **not need to read the response**
  (CORS blocks the *read*, not the *send*). The side effect — a directive issued → a peer runs
  attacker-influenced work — is the entire attack. A GET read route (m25) is exempt (no side effect);
  **the first write route is not** — this is exactly the "genuinely new authz surface" `25/ADR-004`
  flagged.
- **The minimal control that closes it (both halves required — neither alone suffices):**
  1. **Same-origin check.** The handler rejects a `POST` whose `Origin` header is present and not the
     loopback origin (`http://127.0.0.1:<port>` / `http://localhost:<port>`), and/or whose
     `Sec-Fetch-Site` is present and not `same-origin`. (Both headers are browser-attached and
     un-forgeable by page JS — a page cannot set `Origin`/`Sec-Fetch-*` on a `fetch`.) A same-origin
     fleet-UI request carries the matching `Origin` and passes; a cross-origin forgery is refused with
     a clean 403.
  2. **Non-simple content-type requirement.** The handler requires `content-type: application/json`.
     This forces a **preflight** for any cross-origin `fetch` (so the same-origin check on the
     preflight blocks it) AND refuses a bare HTML-`<form>` POST (which can only send
     `text/plain`/`urlencoded`/`multipart` — the one CSRF vector that escapes the preflight
     requirement entirely). The board's `readJsonBody` already parses JSON; making the content-type a
     *requirement* (not just an assumption) is the closing half.
- **Why NOT a CSRF token.** A synchronizer/double-submit CSRF token is the heavier control; it is
  **not warranted for v1** because the same-origin-header + non-simple-content-type pair fully closes
  the browser-CSRF vector for a loopback SPA, with no token-issuance/rotation machinery, no cookie
  (the fleet face is cookie-less — there is no ambient credential for CSRF to ride; the *only* reason
  the forgery is dangerous is the loopback *reachability*, and same-origin closes exactly that). A
  token would be belt-and-braces over an already-closed vector. If a later milestone gives the face an
  ambient cookie/session, revisit — recorded as R-3.
- **Recommendation (the verdict handed to story 02 / `27/ADR-006`).** For the v1 loopback,
  cookie-less write route, **Origin/Sec-Fetch same-origin + `application/json`-required is the minimal
  sufficient control** — and it is STRUCTURAL (a greppable handler shape), so it is pinned as a
  security fitness function (below, fitness S-1). Story 02 MUST add this guard when it lands the route;
  a `POST /api/mesh/issue` that reaches `invoke("mesh:issue")` with no Origin/content-type gate is a
  finding (`@finding-` routed to the developer) — shipping the loopback write route with only the
  board's inherited loopback-bind posture would leave T1 open.

  <!-- Prior-art note for the retro: the board POST /api/work/feedback and m24 POST /enroll routes
       ALSO lack an Origin check today (loopback-bind only). That is a pre-existing CSRF gap on those
       write routes — lower severity (feedback is a note; enroll is code-gated by the 10^6 device
       code) but the same class. Surfaced via aof:feedback below, NOT fixed here (out of m27 scope);
       m27 closes it for the NEW route and flags the pattern so the existing two can be retrofitted. -->

## Security fitness functions (authored here — RED-until-built)

Each is a `test/arch/acd-*.test.mjs` arch-test wired into `scripts/test.mjs`, carrying the m03
non-vacuous self-check (the detector demonstrably fires on a planted violation and stays quiet on the
accepted form). Both are the security-OWNED gates for the NEW surface; the STRUCTURAL controls the
architect's `27/fitness #1–#7` table already pins (write-scope, frozen schema, matcher purity,
mesh-free injected candidacy, every-ready-return, bijection, bounded-write) are RIDDEN, not duplicated
— this file adds only the two the threat model newly implies.

| Invariant | Enforced by (arch-test) | State now | Owning story |
|---|---|---|---|
| **S-1 · Same-origin + non-simple-content-type on the write route (T1).** The `POST /api/mesh/issue` handler on `src/mesh-ui-serve.mjs` REJECTS a cross-origin request (a present-and-foreign `Origin`/`Sec-Fetch-Site` guard → 403) AND requires `content-type: application/json`, BEFORE reaching `invoke("mesh:issue")`. So a browser-CSRF forgery (simple-request or form POST) cannot drive the mutation. | `test/arch/acd-mesh-issue-route-same-origin.test.mjs` — SPECIFY-at-build (the route does not exist yet, `27/ADR-006` story 02): source-analysis of `src/mesh-ui-serve.mjs` — the `/api/mesh/issue` branch references an `origin`/`sec-fetch` header read AND a `content-type`/`application/json` check on the same path that reaches `invoke("mesh:issue")`; a planted route with a bare `invoke` and no guard fails the detector. Green-now in the **`existsSync`-guarded / XOR** form: **either** the face has no `/api/mesh/issue` route (the current m25 read-only tree — vacuously satisfied) **or** the route is present AND carries both guards. It tightens its satisfied side when story 02 lands the route. | **RED-until-route** (GREEN vacuously on today's tree; the guarded-route half arms when story 02 builds `POST /api/mesh/issue`). | **02** |
| **S-2 · Revoked-issuer directives are filtered from routing (T4).** The routing candidacy build (`27/ADR-004.4`, in `src/commands/next.mjs`, under the `config.mesh.nodeId` gate) SKIPS a synced directive whose `issuer` is revoked, reading the LIVE registry (`isRevoked`), so revocation applies to routing exactly as it applies to the relay (`24/T6` revocation completeness). | `test/arch/acd-issuance-revoked-issuer-filtered.test.mjs` — SPECIFY-at-build (the routing filter is story 01, `src/mesh-issuance.mjs`/`src/commands/next.mjs`): the routing read couples a revocation check (`isRevoked`/the revocation list) to the directive `issuer` before a directive contributes a routing verdict; a planted filter that reads directives WITHOUT consulting revocation fails the detector. Green-now `existsSync`-guarded on the not-yet-built module (vacuous-safe), arming when story 01 lands the routing filter. | **RED-until-module** (`src/mesh-issuance.mjs` / the routing filter do not exist yet); GREEN vacuously today, arms with story 01. | **01** |

**Compatibility note for the architect / developer.** S-1 adds an Origin/content-type READ to the
`POST /api/mesh/issue` handler — this is compatible with `27/fitness #7` (the bounded-write flip):
`#7` asserts the ONE write route reaches the mutation ONLY via `invoke("mesh:issue")` with no direct
`mesh-issuance` import; the same-origin guard is a REQUEST-VALIDATION read *in front of* that invoke
(a header check, not an operation import), so both hold together — the guard runs, THEN the invoke.
S-2 adds a revocation read to the routing candidacy build in `commands/next.mjs`; this is compatible
with `27/fitness #4` (mesh-free `work.mjs`): the revocation filter runs in `commands/next.mjs` under
the config gate (where the candidacy view is composed), NOT inside `work.mjs` — `work.mjs` still
imports no mesh module and receives only the already-filtered candidacy view as plain data. If the
developer factors either read such that it trips an existing gate, that is a finding to resolve at the
module boundary, not a reason to weaken either control.

## Residual risk & explicit non-goals

<!-- Threats consciously NOT fully mitigated, and why. The honest list. Each links to a @manual/UAT
     item where a human confirms it, or is an explicit Phase-5+ non-goal. -->

**Accepted residual risk (v1 trusted-operator):**
- **R-1 · Malicious/unwanted execution WITHIN the trusted squad (T2/T3 boundary).** In v1, group
  membership = you trust who can push to the shared git = you trust who can issue work at a peer. A
  legitimate-but-careless (or compromised-credential) member CAN issue work targeted at a peer, and
  that peer will run it. This is the **intended capability** (KF6), not a defect — the trust
  assumption is stated plainly so it reads as a decision: v1 does not authorize issuance *per target*
  or *per capability grant*; any member may issue to any node. The consuming node's own run lifecycle
  + the m26 lease still bound *how* it runs, but not *whether a trusted member may ask*. Per-target /
  capability-scoped issuance authz is **Phase-5+** (see non-goals). Confirmed by `@manual` pen-test
  `issuance-blast-radius` in `VERIFICATION.md` (what a single compromised member credential can drive
  across the fleet — the same blast radius as `24/R-1`'s stolen credential, one hop further:
  now it can also *route work*).
- **R-2 · No rate-limit on the loopback write route (T6).** The same-origin guard (S-1) refuses the
  cross-origin browser flood; a co-located hostile *process* on the operator's own machine is outside
  the v1 boundary (it already holds the git credential). No per-source rate-limit is built v1;
  Phase-5+ if the face is ever exposed beyond loopback. The consuming side self-limits (hint, not
  grant). Confirmed by `@manual` pen-test `issue-route-flood` in `VERIFICATION.md`.
- **R-3 · No CSRF token / no transport encryption on the loopback face.** S-1 closes the browser-CSRF
  vector for a cookie-less loopback SPA without a token; a token becomes warranted only if the face
  later gains an ambient cookie/session (none today). The loopback face is plain HTTP (no TLS) — an
  on-host process sniffing loopback is the R-2 co-located-process boundary. Both are the operator-knob
  / Phase-5+ hardening line, not a v1 gap. Confirmed at the S-1 fitness + the `@manual`
  `issue-route-flood` review.

**Explicit non-goals (Phase-5+ platform fork — PRD §5, §7.4 A3, §8; NOT gaps):**
- **Untrusted / cross-org / multi-tenant issuance authz** — who may issue to whom ACROSS a trust
  boundary, per-target authorization, capability-scoped issuance grants, issuance audit. v1 is
  single-group trusted-operator: any member issues to any node (R-1). This is the sharpest
  scoped-OUT fork — `27/ADR-001.4`/`27/ADR-006.3` explicitly defer it; do NOT design it here.
- **Issuance audit trail** — v1 keeps no tamper-evident log of who issued/withdrew what, when. The
  directive's `issuer`/`issuedAt` + git history are the *incidental* record (not a designed audit
  control — do not rely on it). Phase-5+.
- **Per-node / per-target credential scoping** — inherits `24`'s R-1 non-goal verbatim; a stolen
  credential is a standing member that can now also route work (R-1). Scoped remotes + scoped
  issuance are Phase-5+.

These are recorded so a reviewer reads the v1 boundary as a **decision**, not an oversight — the door
is kept clean (the write route + revocation filter are real seams) but the untrusted-issuer platform
half is not built.

## Verification routing (pointers, not restatements)

- **Fitness** — the two security-owned arch-tests above (**S-1** same-origin write-route guard, story
  02; **S-2** revoked-issuer routing filter, story 01), PLUS the architect's `27/fitness #1–#7` this
  model RIDES (the frozen six-key schema #2 = the T5 at-rest guarantee; the mesh-free injected
  candidacy #4 + every-ready-return #5 = the T3 hint-not-grant substrate; the bounded-write flip #7 =
  the surface S-1 guards). `scripts/test.mjs` green through Decide (both S-tests vacuous-safe now);
  each arms when its owning story lands the mechanism.
- **`@executable`** — the attack-rejected / hint-not-grant scenarios (owned by the task `.feature`
  files, NOT restated here): the `27/ADR-004` routing behaviour (a node-targeted item is offered only
  on the eligible node; two eligible nodes both offered a targeted item still contend the m26 lease
  safely — routing never double-grants, T3); a withdrawn directive stops offering the item; the
  fleet-UI `POST /api/mesh/issue` issues a directive a peer picks up (story 02) and a cross-origin
  `POST` is refused (the S-1 behavioural half — a foreign-`Origin` POST → 403).
- **`@manual`** (developer-run pen-tests, recorded in `VERIFICATION.md`): `issuance-blast-radius`
  (R-1 — what one compromised member credential can drive across the fleet, now including routing
  work at peers), `issue-route-flood` (R-2/R-3 — the loopback write route under a same-origin flood +
  a co-located-process probe). The `24` inheritances (`credential-at-rest`, `git-remote-deprovision`)
  are m24's, ridden not re-run.
