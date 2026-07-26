<!--
  Milestone SECURITY.md — the threat model. Answers ONE question: what could an
  attacker do, and how do we stop them? Owner: security (a conditional member of the
  architect's technical tier, fired here because running assigned work on a worker is
  remote code execution — the refine-stage trigger STATE.md flagged at framing).

  This doc is the threat→control MAP; it is NOT a fourth verification surface. Every
  control lives ONCE — as a security fitness function (test/arch), an @executable
  scenario (attack rejected), or an ADR (the architect's). SECURITY.md POINTS AT those;
  it never restates them. The residue a test cannot encode is a @manual pen-test or
  @uat, recorded in VERIFICATION.md.
-->
# 35 · Mesh Work Assignment — Security (threat model)

## The one question

> An operator on the control node hands a unit of work to a named worker; the worker
> materialises the ref in a git worktree and **runs it**. Running assigned work is
> **remote code execution**. What could an attacker do, and how do we stop them?

## The inherited trust boundary (a GIVEN — not re-litigated here)

Admission is the **tailnet peer boundary** (milestone 33 / ADR-002, milestone 34 /
ADR-007): a peer whose TCP `remoteAddress` maps to a roster nodeId is trusted, and only
tailnet-visible peers are reachable at all. Milestone 35 **inherits** this boundary — it
does not build a new one. The directive channel rides the milestone-34 WebSocket control
stream, whose upgrade handler already destroys a non-peer socket before any frame is read
(`src/control-stream-server.mjs:293-304`). Identity is the *connection fact*
(`request.socket.remoteAddress` joined to a nodeId via the fabric roster,
`src/control-stream-server.mjs:417-422`), never a self-declared header, and it is
fail-closed (a null/unresolved nodeId is never a peer,
`src/control-stream-server.mjs:37-42`).

## What is OUT of scope (stated explicitly, per SPEC.md:65-68)

- **A hardened remote-execution model beyond the tailnet boundary.** Specifically: *what
  a compromised-but-admitted control node can make a worker run.* Inside the tailnet trust
  boundary, an admitted control node is trusted to dispatch arbitrary refs; auto-accept is
  bounded to that boundary and nothing deeper. Directive signing / per-directive
  authorization / a worker-side accept policy / sandboxing the executed work beyond the
  worktree filesystem scope are all **future work** — flagged, not solved here (this is
  the residual risk of T1 below, accepted).
- **Cross-control-node / cloud federation** (SPEC.md:63-64) — one control node dispatching
  to its own workers, matching milestone-34's single-control-node boundary.
- **Reviving the git-bus / issuance-over-git** (SPEC.md:60-62) — the deleted per-node
  claim-file/git-sync mechanism stays deleted; T2's revocation invariant is re-expressed on
  the WS + global-store transport, NOT resurrected on git.

## Threat model — threat → attack → control → where evidenced

Severity is the impact **inside** the inherited boundary. Type is `RCE`, `AuthZ`,
`Isolation`, `Integrity`, or `Spoofing`.

### T1 — Malicious / rogue directive execution (the core RCE) · `RCE` · sev **High** (residual: Accepted)

- **Attack.** A `directive` frame causes a worker to fetch, materialise, and execute a ref
  as a live process. If a directive could arrive from anywhere, any reachable party would
  own arbitrary code execution on every worker.
- **Control.** A directive is honoured **only** over an admitted, live tailnet-peer
  connection. The upgrade gate destroys a non-peer socket before a ws is ever emitted, so
  no frame — directive included — is read off a non-peer
  (`src/control-stream-server.mjs:293-304`); auto-accept is bounded to exactly that
  boundary. There is no second admission surface for control→worker frames: they ride the
  *same* one persistent connection worker→control state already rides.
- **Residual risk (Accepted / out-of-scope).** A **compromised-but-admitted control node**
  can dispatch an arbitrary ref — that is inside the trust boundary this milestone inherits
  and does not narrow. Recorded here as accepted; a deeper model (directive signing, a
  worker accept policy, execution sandboxing) is future work per SPEC.md:65-68.
- **Evidenced by.** The inherited-admission fitness `arch/directive-only-from-admitted-peer`
  (see T5) is the executable half; the accepted residual is a **`@manual` note** in
  VERIFICATION.md (no test asserts an accepted risk). The architect's milestone-35 ADR on
  the directive channel owns the "one connection, one admission surface" decision.

### T2 — Revoked issuer still dispatching · `AuthZ` · sev **High**

- **Attack.** A node/issuer removed from the roster (revoked) continues to issue directives
  — revocation that only half-applies (the transport half rejects it, the dispatch half
  keeps honouring its in-flight directives). This is the milestone-24 "revocation
  completeness" property (24/T6) carried onto the new dispatch surface — precisely the
  invariant the retired reference pinned
  (`reference/retired-dispatch-tests/acd-issuance-revoked-issuer-filtered.mjs`,
  `.../mesh-routing-revoked-issuer.mjs`).
- **Control.** The dispatch path reads the **live** registry revocation list
  (`isRevoked(registry, nodeId)`, `src/mesh-registry.mjs:256-260`) and a directive whose
  `issuer` is revoked **never routes to execution** — re-read per decision, never a
  serve-start snapshot, mirroring the credential-verify seam's live re-read discipline
  (`src/mesh-registry.mjs:286-289`). Fail-safe direction: the filter only ever *removes*
  routing power, never grants it (an absent/empty registry leaves directives routing
  normally).
- **Evidenced by.** Security fitness `revoked-issuer-directive-never-executes` (below),
  plus the `@executable` "revoked issuer's directive is not dispatched" scenario in the
  story that lands the dispatch route.

### T3 — Directive for an unavailable / foreign repo, or path traversal via the ref · `AuthZ` + `Isolation` · sev **Medium**

- **Attack.** A directive names (a) a repo the worker does not have, so it fails opaquely
  or — worse — silently no-ops (the ADR-008 "loud miss" lesson: a silent miss hides a
  dispatch that never ran); or (b) a ref crafted to escape the intended checkout
  (`../../etc`, an absolute path, a `..`-laden ref) used to read/write outside the work
  tree.
- **Control (a) — repo availability.** A worker runs an assignment only for a repo it
  actually HAS: the `mesh.repo.published` marker in its LOCAL `.aof/aof.config.json`
  (`src/commands/mesh-repo.mjs:33-50`), resolved to nodes via `global_node_workspaces`
  (`src/global-node-registry.mjs:141-143`). A directive for a non-published repo is refused
  with a **clear coded miss**, never an opaque failure (per the SPEC.md:52-54 requirement
  and the ADR-008 visibility lesson).
- **Control (b) — no path construction from the ref.** Ref resolution is repo-relative
  **enumeration + filter**, never path concatenation: `findWork` lists the work items
  (`src/work.mjs:395-432`), each folder name is validated against the strict allowlist
  grammar `ITEM_RE = /^(\d+)_(milestone|story|task|uat)_([a-z0-9-]+)$/`
  (`src/work.mjs:39`), and a ref is matched as a bare number or a `\d+/\d+` pair
  (`src/work.mjs:400-416`) — it selects an already-enumerated `item.dir`, it never *builds*
  a path from attacker text. A ref with `.`, `/` (beyond the single number-pair separator),
  or path separators matches nothing. Milestone 35 must NOT introduce a new
  `path.join(worktree, directiveRef)` seam that bypasses this.
- **Evidenced by.** Security fitness `unpublished-repo-directive-refused` (coded miss, T3a)
  and `worktree-path-scoped` (T3b/T4), plus the `@executable` "directive for an unheld repo
  is refused with code X" scenario.

### T4 — Worktree escape / writes outside the isolation boundary · `Isolation` · sev **Medium**

- **Attack.** Execution in the assignment's worktree reads or writes outside it —
  colliding with the worker's own local work, another concurrent assignment, or arbitrary
  host paths — defeating the isolation that is the milestone's headline capability
  (STATE.md:28-29).
- **Control.** The materialised worktree root is a **scoped, dedicated path per
  assignment** under a single mesh-worktree root; the assigned ref (validated per T3b)
  cannot escape it; cleanup/retention is bounded, and no execution artifact escapes the
  worktree root. The concrete worktree lifecycle (root location, one-per-assignment,
  cleanup, same-ref-twice) is the **architect's ADR** to own (SPEC.md:88-96 framing
  questions); this threat pins the *invariant* that ADR must satisfy.
- **Evidenced by.** Security fitness `worktree-path-scoped` (below), plus the `@executable`
  worktree-materialisation scenario asserting the path is under the dedicated root.

### T5 — Unauthenticated / forged directive injection · `Spoofing` · sev **High**

- **Attack.** A non-peer opens (or forges a frame on) the control stream and injects a
  `directive` frame, obtaining RCE without ever being an admitted peer.
- **Control.** The WS upgrade rejects a non-tailnet-peer connection at the gate —
  `socket.destroy()` before any ws is emitted, so no frame is ever read from a non-peer
  (`src/control-stream-server.mjs:293-304`, `:250-251`). The directive channel adds no new
  ingress: directives are honoured only from the admitted control connection, over the same
  upgrade-gated socket. There is no self-declared identity header to forge — identity is the
  connection's `remoteAddress` join (`:417-422`, `acd-control-stream-address-bound`
  already pins "no `x-aof-node-id` header").
- **Evidenced by.** Security fitness `directive-only-from-admitted-peer` (below), which
  extends the existing `acd-control-stream-tailnet-only` /
  `acd-control-stream-address-bound` invariants to the new directive frame.

### T6 — Assignment / status spoofing · `Integrity` + `Spoofing` · sev **Medium**

- **Attack.** A worker forges status for an assignment it does not hold, or a peer advances
  another node's assignment lifecycle — corrupting the fleet view or masking a stalled run
  as done.
- **Control.** Assignment lifecycle is written **from the authenticated connection's
  nodeId** — the server already binds `nodeId` from the admitted origin at connection time
  and threads it into the apply path, never trusting a self-reported `frame.nodeId`
  (`src/control-stream-server.mjs:306-308`, `:320-323`; the `applyPresenceFrame`
  `ownerNode ?? frameNode` precedence at `:120-124` is the shape to follow — the connection
  nodeId wins). A node only advances **its own** assignment; the control writes an
  assignment's lifecycle keyed to the connection that holds it.
- **Evidenced by.** Security fitness `assignment-status-authored-by-holder` (below), plus
  the `@executable` "a status frame for an assignment held by another node is not applied"
  scenario.

## Security fitness functions (SPECIFIED — invariant + assertion method + story that turns it green)

These are **specified only** at refine — no executable test files are written yet. Each
follows the codebase idiom (source-analysis or behaviour-driven arch-test with **non-vacuous
planted-violation self-checks**, the m03 lesson) already proven in the retired reference
(`reference/retired-dispatch-tests/acd-issuance-revoked-issuer-filtered.mjs`,
`.../acd-issuance-write-scope.mjs`) and the live siblings
(`test/arch/acd-control-stream-tailnet-only.test.mjs`,
`.../acd-control-stream-address-bound.test.mjs`). Each is written by security under
`test/arch`; a failure routes to the developer via the orchestrator.

Where the dispatch surface does not yet exist, the function is **SPECIFY-at-build /
vacuous-safe** (green vacuously — no directive is honoured at all, so none is honoured
wrongly — and ARMS when the named story lands the surface), exactly the posture the retired
`acd-issuance-revoked-issuer-filtered` reference documents.

| # | Name (`test/arch/…`) | Threat | Invariant | Assertion method | Turns green in |
|---|---|---|---|---|---|
| F1 | `acd-directive-only-from-admitted-peer` | T5 (T1) | A `directive` frame is honoured ONLY from an admitted tailnet-peer connection; a non-peer's directive is refused at the upgrade gate (socket destroyed, no directive read). | **Behavioural** over the real `startControlStreamServer` (the `acd-control-stream-address-bound` in-process ws precedent): a loopback dial NOT in `peersByAddress` never opens, so its directive never reaches the dispatch path; a mapped peer's does. Plus a **structural** guard that the directive-handling branch sits INSIDE the `wss.on("connection")` (post-admission) scope, never on a pre-upgrade surface. | story 01 (directive channel) |
| F2 | `acd-revoked-issuer-directive-never-executes` | T2 | A directive whose `issuer` is in the live registry `revocations` never routes to execution. | **Source-analysis** (clone of `acd-issuance-revoked-issuer-filtered`): the dispatch consumer that reads a directive for execution MUST couple an `isRevoked(...)` / revocation-list read to the directive `issuer`. Vacuous-safe until a dispatch consumer exists; self-checks: the detector FIRES on a revocation-blind dispatch and stays quiet on the checking form; a definition-only substrate is not a consumer. Optionally paired with a **behavioural** `@executable`-driven check over planted directive + registry fixtures (the `mesh-routing-revoked-issuer` fixture shape). | story 01/02 (dispatch route) |
| F3 | `acd-unpublished-repo-directive-refused` | T3a | A directive for a repo NOT `mesh.repo.published` on the worker is refused with a **clear coded miss** (a structured `{ ok:false, code:"…" }`), never an opaque throw or silent no-op. | **Behavioural**: drive the worker dispatch handler with a directive for an unheld workspaceId (no local `mesh.repo.published` marker) and assert a specific miss code; assert the same directive for a published repo is accepted. Self-check: the code is non-empty and stable (the ADR-008 loud-miss discipline). | story 02 (worker execution) |
| F4 | `acd-worktree-path-scoped` | T4 (T3b) | The materialised worktree path is under the dedicated mesh worktree root, and the assigned ref cannot escape it. | **Two-part**: (a) **behavioural** — for a valid ref the resolved worktree/checkout path, normalised, is a prefix-child of the dedicated root; for a traversal ref (`../`, absolute, `..`-laden) resolution yields no item (matches nothing under `ITEM_RE`, `src/work.mjs:39`) rather than a path outside the root. (b) **source-analysis** — the worktree/ref-resolution module builds no `path.join(<root>, <directiveRef>)` from raw directive text (the ref selects an enumerated `item.dir`, never constructs one). Self-check: the traversal detector fires on a planted `path.join(root, directive.ref)` and stays quiet on the enumerate-then-filter form. | story 02 (worker execution) |
| F5 | `acd-assignment-status-authored-by-holder` | T6 | The control writes an assignment's lifecycle ONLY from the connection whose nodeId holds it — a status/lifecycle frame's node is taken from the authenticated connection, never a self-reported `frame.nodeId`, and never advances another node's assignment. | **Source-analysis + behavioural**: (structural) the assignment-apply seam derives its owner from the connection `nodeId` bound at `connection` time (`ownerNode ?? frameNode` precedence, `src/control-stream-server.mjs:120-124` shape), never `frame.nodeId` alone; (behavioural) a status frame arriving on node-A's connection for an assignment held by node-B is not applied. Self-check: the detector fires on a `frame.nodeId`-trusting apply and accepts the connection-nodeId form. | story 01 (assignment lifecycle) |

## Residue that no fitness function encodes → route to VERIFICATION.md

- **`@manual` (T1 residual, Accepted).** The compromised-but-admitted-control-node risk is
  *accepted*, not tested — a note in VERIFICATION.md recording the boundary and the
  future-work pointer (directive signing / worker accept policy / execution sandbox). No
  test asserts an accepted risk.
- **`@manual` / two-machine soak (T1/T4/T5, live transport).** The real ws directive path,
  a real git worktree materialised on a second machine, and a non-peer's real dial being
  refused are exercised only by the two-machine soak (the same posture
  `createWorkerWsTransport` carries — `@executable` always injects a fake transport,
  `src/worker-stream-client.mjs:224-232`). Recorded as the milestone's `@manual` line
  (STATE.md:38): assign from control, worker runs in a worktree, fleet view advances live —
  and a directive dialed from an off-roster host is refused.

## Coordination note (division of ownership)

The **architect** owns the record schema (the frozen directive/assignment record shape —
cf. the retired 6-key `acd-issuance-record-frozen` reference), the channel, arbitration
(exactly-one-runner), and the worktree lifecycle ADR. **Security** owns this threat→control
map and the five fitness functions above. Where a fitness function names an invariant the
architect's ADR must satisfy (T4 worktree root, T2 dispatch-time revocation read, T6
connection-authored lifecycle), that is a coordination point — the ADR states the decision,
the fitness function fails CI if the implementation drifts from it.
