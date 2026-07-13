---
doc: security
---
<!--
  Milestone SECURITY.md — the threat model. Answers ONE question: what could an attacker
  do, and how do we stop them? Owner: security (a conditional member of the architect's
  technical tier, fired here because a CREDENTIAL now crosses the mesh so a worker can
  `git clone` a private repo it lacks — a real attack surface: a secret in transit + at
  rest + inheritable by a spawned agent child).

  This doc is the threat→control MAP; it is NOT a fourth verification surface. Every
  control lives ONCE — as a security fitness function (test/arch), an @executable
  scenario (attack rejected), or an ADR (the architect's). SECURITY.md POINTS AT those;
  it never restates them. The residue a test cannot encode is a @manual pen-test or @uat,
  recorded in the story's VERIFICATION / the milestone's UAT.
-->
# 38 · Cross-machine Worker Execution — Security (threat model)

## The one question

> A worker is handed an assignment for a **private** repo it does not have checked out. To
> clone it, a **credential must cross the mesh** (control → worker) and be fed to `git`.
> What could an attacker do with that credential — read it at rest, steal it out of a
> spawned child's environment, harvest it from a log, wield an over-scoped one, or steer
> the clone at a target of their choosing — and how do we stop them?

## The inherited trust boundary (a GIVEN — not re-litigated here)

Admission is the **tailnet peer boundary** (33/ADR-002, 34/ADR-007), and the RCE posture of
running assigned work inside it was threat-modelled and **accepted** in **35/SECURITY** (T1:
a compromised-but-admitted control node can dispatch an arbitrary ref — future work, out of
scope). Milestone 38 **inherits** both and narrows neither. What is NEW here is not the
execution — it is the **credential** the clone-on-miss step (ADR-005) now moves across that
boundary. This document threat-models that credential's whole lifecycle; it does not re-open
the m35 RCE boundary.

The recommended credential-handling control (RESEARCH.md §1, the measured default the security
review adopts): **`GIT_ASKPASS` pointed at a script that emits a control-minted, per-clone,
short-lived, single-repo-scoped token over stdout, scoped via a per-invocation `env` object
passed to ONLY the clone's `execFile` call — NEVER merged into the worker's ambient
`process.env`.** Fallback (where the control cannot mint an HTTP token for the repo host): a
pre-provisioned per-worker deploy key + `GIT_SSH_COMMAND` (RESEARCH.md §1.2). Every threat
below is defended relative to this control shape.

## What is OUT of scope (stated explicitly, per SPEC.md:60-68)

- **A durable machine-wide secret store / secrets vault.** Auth *transmission* for one clone
  is in scope; *storage* of a standing secret is not (SPEC.md:65-66). Where the recommended
  control needs a place to keep a short-lived token, it is the ephemeral, in-memory/askpass
  path of ONE clone — not a persisted vault. **Defers to:** a future milestone IF the fallback
  deploy-key path (a durable key on the worker's disk, RESEARCH.md §1.2) proves to need
  managed rotation/storage — named here, not built here (residual R2 below).
- **A general remote-shell / arbitrary-command channel** (SPEC.md:61-62). The worker
  provisions ITSELF off the assignment's `workspaceId` — clone ONE known repo to ONE scoped
  path. No way to run an arbitrary command or clone an arbitrary URL on a peer is added
  (ADR-005 closes this structurally — see T5).
- **The m35 RCE boundary** (35/SECURITY T1, Accepted): what a compromised-but-admitted control
  node can make a worker run. Inherited unchanged; not narrowed here.

## Threat model — threat → attack → control → where evidenced

Severity is the impact **inside** the inherited tailnet boundary. Type is `Info-disclosure`,
`AuthZ`, `Isolation`, or `Spoofing`. Controls live ONCE (fitness fn / ADR / scenario / @manual)
— this table points at them.

### T1 — Credential persisted at rest in the checkout's `.git/config` · `Info-disclosure` · sev **High**

- **Attack.** The clone bakes the credential into the new checkout's `.git/config` in
  plaintext, permanently. Anyone who later reads that repo's `.git/config` (a support bundle,
  a backup, a second process, a human debugging) harvests a live credential. This is a
  **MEASURED footgun** (RESEARCH.md §1.1/A1): `git clone --config http.extraHeader=<cred>`
  writes the raw `Authorization` header verbatim into `.git/config` and it survives forever;
  an authenticated clone URL (`https://x-access-token:<tok>@host/…`, §1.1/A2) is worse — git
  records the resolved remote URL into `[remote "origin"] url` **by design**, so the leak is
  structurally guaranteed, not incidental.
- **Control.** The clone uses a **non-persisting** credential path: top-level per-invocation
  `git -c http.extraHeader=…` (MEASURED §1.1/A1 to leave zero trace in `.git/config`) or
  `GIT_ASKPASS` (MEASURED §1.1/A4 to leave zero trace). NEVER the clone-time `--config` flag,
  NEVER an embedded-credential remote URL, NEVER a durable `credential.helper store`, NEVER a
  `url.<cred>@…insteadOf` rewrite. The checkout carries **no secret at rest** (ADR-005
  invariant (a)).
- **Residual.** None accepted — this is a hard structural invariant, fitness-pinned.
- **Evidenced by.** **Fitness** `test/arch/acd-worker-clone-no-credential-persisted.test.mjs`
  (strengthened this milestone: forbids `--config http.*`, `http.extraheader`/`Authorization`
  persistence, `credential.helper store`, `insteadOf` credential-embedding) + the story-01
  **`@executable`** `tasks/03_credential-not-persisted.feature` (clone leaves nothing in
  `.git/config`) + ADR-005 invariant (a).

### T2 — Credential leaking to the spawned agent child via ambient env inheritance · `Info-disclosure` · sev **High**

- **Attack.** The clone step sets the credential (or `GIT_ASKPASS` naming a script that emits
  it) on the worker's **ambient `process.env`**. The worker then spawns the headless agent
  child (`claude -p` / `codex exec`) to drive the ref — and that child **inherits the full
  parent environment**, so the untrusted agent process (running attacker-influenceable model
  output inside the worktree) can read the live clone credential straight out of its own env.
  This is a **MEASURED leak vector** (RESEARCH.md §1.5): Node `execFile` with no `env` key
  inherits the full parent env — verified directly — and this repo's own `defaultSpawnRuntime`
  (`src/mesh-worker-execution.mjs:163-184`) and the spawn call site (`:339`) pass **no `env`
  key**, so they inherit ambient `process.env` today. This is a **NEW threat ADR-005 did not
  fully pin** — this document pins the control.
- **Control.** The clone's credential env is a **distinct `env` object passed to ONLY the
  clone's `execFile` call** (`{ env: { ...process.env, GIT_ASKPASS: <script> } }` local to that
  one spawn) — it is **NEVER assigned onto `process.env`** and **NEVER `Object.assign`-ed into
  it**. Because the credential never touches ambient `process.env`, the later agent-child spawn
  (which DOES inherit ambient env) can never read it. The scope of the secret is exactly one
  `execFile` call, for the duration of one clone.
- **Residual.** None accepted — hard structural invariant, fitness-pinned.
- **Evidenced by.** **Fitness** `test/arch/acd-worker-clone-no-credential-persisted.test.mjs`
  (strengthened this milestone: proof #2 forbids any `process.env.<X> = …` /
  `Object.assign(process.env, …)` in the worker-execution module, and its self-check confirms
  the CORRECT scoped-`env`-on-the-clone-exec form stays clean) + the story-01 **`@executable`**
  `tasks/03_credential-not-persisted.feature` (assert the agent-child spawn receives no
  credential) + ADR-005 invariant (a, extended).

### T3 — Credential harvested from a log or error message · `Info-disclosure` · sev **Medium**

- **Attack.** A failed clone's `stderr` echoes an authenticated remote URL (or the credential
  itself), and the worker logs it verbatim into a run record / console / error frame — a
  passive attacker with log access harvests it. `git` error text routinely echoes the URL it
  tried, so a URL-embedded credential (T1/A2) surfaces here for free even if the URL never
  reached `.git/config`.
- **Control.** No credential value is written to a log/console/error line, and the clone does
  not use a URL-embedded credential in the first place (T1) so there is no credential in the
  URL git could echo. The redaction discipline `acd-global-node-descriptors-redact-secrets`
  (34/ADR-005) already governs secret-shaped fields at the store boundary; the clone path adds
  no un-redacted log of a credential (ADR-005 invariant (b)).
- **Residual.** `git`'s own stderr on a failed clone is git-controlled text; the worker MUST
  redact/omit it rather than forward it raw. The residue that a structural test cannot fully
  encode (that the *redacted* failure message on a REAL failed private clone carries no
  credential) is the **`@manual`** soak's inspection point.
- **Evidenced by.** **Fitness** `test/arch/acd-worker-clone-no-credential-persisted.test.mjs`
  (proof #3: no credential value flows into a `console.*`/`logger.*` call) + the existing
  `test/arch/acd-global-node-descriptors-redact-secrets.test.mjs` (the redaction discipline it
  extends) + the **`@manual`** soak inspection (story-01 `tasks/04_private-clone-soak.feature`:
  a real failed clone's surfaced error carries no credential).

### T4 — Over-scoped / long-lived credential (blast radius on worker compromise) · `AuthZ` · sev **High**

- **Attack.** The credential minted for the clone is a broad, long-lived Personal Access Token
  (all-repos, all-scopes, no expiry). A worker that is later compromised — or a momentary
  transit exposure (the token in argv/env for the clone, RESEARCH.md §1.1 leak surfaces) —
  yields an attacker a durable, org-wide credential, not one throwaway repo-read.
- **Control.** The recommended default (RESEARCH.md §1, this review adopts it) is a token that
  is: **per-clone** (minted for one assignment, not reused), **short-lived** (expires on the
  clone-cadence timescale, so a captured token is dead within minutes), and **single-repo,
  read-scoped** (it can clone exactly the assigned `workspaceId`'s repo and nothing else).
  Blast radius of a captured token is therefore "read one repo, for a few minutes" — not
  "org-wide, forever". The **fallback** deploy key (RESEARCH.md §1.2) is likewise
  single-repo-scoped and independently revocable from the repo's settings without touching any
  other credential — but is a **durable** credential (a different risk shape, see R2).
- **Residual (Accepted, operator sign-off).** The *minting policy* — the token's exact TTL,
  scope, and the control-side minting authority — is a control-node/forge-integration concern
  that no worker-side arch-test can assert (the worker only CONSUMES a token; it cannot verify
  the token's server-side scope). This is an **operator-verified** property at `aof:verify`:
  the operator confirms the minted token is short-lived + single-repo-scoped before signing off
  the private-clone soak.
- **⚠ The shipped DEFAULT weakens this control — stated plainly (as-built review, ADR-009).**
  `defaultMintCloneCredential` (control-stream-server.mjs) reads a single
  **`process.env.AOF_MESH_CLONE_TOKEN`** on the control node. That is a **standing, long-lived,
  operator-provisioned token** — the SAME value handed to every clone-miss, for the daemon's
  whole lifetime. It is exactly the "broad, long-lived PAT" T4's *attack* describes, not the
  "per-clone / short-lived / single-repo" T4's *control* requires: it is **NOT per-clone**
  (reused every mint), **NOT short-lived** (no TTL — dies only when the operator rotates it),
  and **its repo-scope is whatever the operator set** (the default does nothing to scope it —
  and see **T7/F15**: the mint is asked for the *requester-named* workspaceId, so the default
  cannot even bind the token to one repo by construction). The "dead within minutes / one repo"
  blast-radius promise of T4 is met **only** if the operator injects a real
  `mintCloneCredential` seam (a forge App installation token, ~1h TTL, single-repo read) at
  `startControlStreamServer(...)`. The default is a **bootstrap/dev** convenience, not a T4-
  compliant posture. **Correct posture for the soak:** either (a) wire a real short-lived
  single-repo mint, OR (b) set `AOF_MESH_CLONE_TOKEN` to a **fine-grained, read-only,
  single-repo** PAT and explicitly accept — in writing at `aof:verify` (R4) — that it is
  long-lived (T4's "short-lived" is UNMET, only "single-repo, read-scoped" is), and rotate it
  on the soak's own cadence.
- **Evidenced by.** ADR-005 (defers the mechanism to RESEARCH/SECURITY; this document adopts
  the short-lived/single-repo default) + the **`@manual`/@uat`** operator sign-off at
  `aof:verify` (story-01 `tasks/04_private-clone-soak.feature`: the operator attests the token
  scope/TTL before the soak). No fitness function asserts a server-side minting policy — the
  worker cannot see it.

### T5 — Over-scoped clone target: SSRF-ish steer, or path traversal on the checkout · `AuthZ` + `Isolation` · sev **Medium**

- **Attack.** (a) A directive steers the worker to clone an **attacker-chosen URL** (exfiltrate
  the credential to an attacker's host masquerading as the repo, or clone a malicious repo whose
  hooks run) — an SSRF-shaped abuse of the self-provisioning worker. (b) A crafted
  `workspaceId` builds a **traversal checkout path** (`../`, absolute, `..`-laden) so the clone
  lands outside the scoped root, colliding with the worker's own tree or writing arbitrary host
  paths.
- **Control (a) — clone SOURCE is committed fleet config, never directive text.** The clone URL
  is resolved from **`config.mesh.repo.cloneUrl`** — a fleet-shared, **committed** config key
  (ADR-005), read via the raw optional-chain idiom. It is NOT taken from the attacker-shaped
  directive frame. A directive cannot name the URL to clone; it can only name a `workspaceId`
  whose repo the fleet's own committed config already trusts. A `workspaceId` with no resolvable
  `cloneUrl` stays a **LOUD coded `assignment-repo-unavailable` failed** (never a silent hang).
- **Control (b) — clone TARGET is the scoped `meshCheckoutPath(workspaceId)` seam.** The
  checkout lands under `<meshRoot>/checkouts/<workspaceId>/` (honoring `AOF_GLOBAL_HOME`), built
  by the ONE `meshCheckoutPath` seam from the store-canonical `workspaceId` only — **NEVER
  `os.tmpdir()`, NEVER a path composed from directive/ref text.** This re-arms the 35/ADR-004
  worktree-scope discipline for the new clone target; a traversal id constructs no escaping path
  (the same enumerate/scoped-seam discipline T3b of m35 keeps for the ref).
- **Residual.** None accepted for the target scoping (structural). The SSRF-via-cloneUrl surface
  reduces to "the fleet's committed config is trusted" — which is the same trust the tailnet
  boundary already grants an admitted control node (35/SECURITY T1, inherited).
- **Evidenced by.** **Fitness** `test/arch/acd-worker-clone-target-scoped.test.mjs` (no
  `os.tmpdir()`, no `path.join(root, directive.*|itemRef)`, any `git clone` routes through
  `meshCheckoutPath`) + the story-01 **`@executable`** `tasks/00_clone-location-config.feature`
  (URL from `config.mesh.repo.cloneUrl`; no-cloneUrl → loud coded failed) +
  `tasks/01_clone-into-scoped-checkout.feature` (target is `meshCheckoutPath(workspaceId)`) +
  `test/arch/acd-worker-checkout-reuses-worktree` (ADR-006: no second worktree call site) +
  ADR-005 invariants (SOURCE + TARGET) and the "no arbitrary-URL/arbitrary-command" scope.

### T6 — Relay-borne credential: mint scoped to the REQUESTER, not the assignment (over-scope + terminal-reuse) · `AuthZ` · sev **High** — **CLOSED (F15 High, F16 Medium — fixed + re-verified at source)**

- **NEW surface (this is now CODE, not design intent).** ADR-009 makes the credential ride a
  live PULL exchange: worker sends `{ kind:"clone-credential-request", nodeId, assignmentId,
  workspaceId, at }` up the stream; control mints and replies `{ kind:"clone-credential", to,
  assignmentId, credential, at }`. T4's "passed over the relay" was a *design intent*; the
  request/mint/reply is now real, so its authorization is threat-modelled here.
- **Control that HOLDS (verified at source, T6 genuinely on the path before the mint).** Only
  the assignment's HOLDER may ask: `applyCloneCredentialRequestFrame` resolves the requester
  from the **CONNECTION-bound `options.nodeId`** (never the self-reported `frame.nodeId`) and
  refuses `clone-credential-not-holder` unless `existing.target_node_id === connectionNodeId`.
  An **unknown assignment** → `clone-credential-unknown-assignment`; a malformed request →
  `clone-credential-request-invalid`; a mint fault → `clone-credential-mint-failed`. Every
  refusal is a **LOUD coded reply down the requester's own connection** (one target, no
  fan-out), never a silent drop and never a mint. Correlation is keyed on `assignmentId` in a
  per-worker pending map; a non-matching / late / unsolicited reply is a no-op, and a
  never-answered request times out **loudly** (`clone-credential-timeout`, default 15s) — no
  wrong-assignment credential, no hang (all measured at source).
- **Attack that SUCCEEDS today — F15 (the mint is scoped to attacker-chosen text).** The holder
  check authorizes on `assignmentId`, but the mint is then called as
  `mint(frame.workspaceId, assignmentId)` — the **requester-supplied** `frame.workspaceId`,
  **never cross-checked against the row's own `existing.workspace_id`**. Measured: a node
  legitimately holding `asg-1` (workspace `ws-a`) sends a request naming
  `workspaceId: "ws-b-SOMEONE-ELSES-REPO"` and control mints
  `token-scoped-to-ws-b-SOMEONE-ELSES-REPO` and delivers it. A malicious-but-admitted worker
  holding **any** trivial assignment can therefore direct the control node to mint a credential
  scoped to **any other repo in the fleet** — the exact over-scope T4/T5 exist to prevent, at
  the mint authority. The "single-repo" property of T4 is not merely weakened by the default
  (above) — it is **removed**: the requester picks the repo.
- **Attack that SUCCEEDS today — F16 (credential outlives the assignment's active lifecycle).**
  The holder check never verifies the assignment is still ACTIVE. Measured: control mints a
  live token for an assignment in **every terminal state** — `done`, `failed`, `withdrawn`,
  `reclaimed`. A worker that already completed the work — or was `withdrawn`/`reclaimed` OFF it
  by control — can still pull a fresh repo credential against it indefinitely, weakening T4's
  "short-lived / per-clone" (the pull is not gated on the assignment being live).
- **Control LANDED + RE-VERIFIED at source (2026-07-13, `applyCloneCredentialRequestFrame`).**
  (a) the mint is scoped to the **row's own `existing.workspace_id`**, and a
  `frame.workspaceId !== existing.workspace_id` is refused **`clone-credential-workspace-mismatch`
  — the mint is NEVER called** (re-run of the exact F15 probe: holder of `asg-1`/`ws-a` naming
  `ws-b` → refused, 0 mint calls, `credential:null`, loud coded reply; strict `!==` — a
  trailing-space `workspaceId` is refused, no silent trim/substitution; the legitimate path
  passes `existing.workspace_id` to the mint). (b) the mint is refused
  **`clone-credential-assignment-inactive`** unless `isActiveAssignmentState(existing.state)`
  (imported from assignment-record.mjs — no drifting copy): re-run of the F16 probe shows
  `done`/`failed`/`withdrawn`/`reclaimed` each mint **nothing**, while `assigned`/`accepted`/
  `running` still authorize. The T6 holder check still refuses a non-holder before either gate.
- **Residual.** The server-side TTL/scope of the minted token stays an operator-attested
  property (T4/R4). Nothing else outstanding on this threat.
- **Evidenced by.** Findings **F15**/**F16** — **CLOSED**; the existing T6 holder check
  (`acd-assignment-status-authored-by-holder`, reused verbatim on this path); the developer's
  **behavioural fitness** `test/mesh-worker-clone-credential-pull.test.mjs` (drives the real
  `applyCloneCredentialRequestFrame`: asserts the workspace-mismatch + terminal-state coded
  refusals, mint-never-called, and the mint scoped to `existing.workspace_id`) — corroborated by
  security's own independent source-probe re-run; + the T4/R4 operator attestation at `aof:verify`.

### T7 — Relay token bypassed / persisted by the worker's AMBIENT git credential environment · `Info-disclosure` + `AuthZ` · sev **High** — **CLOSED (F14 High — fixed + re-verified with live git)**

- **NEW surface (T2 re-derived on the real clone).** The clone runs on a real worker machine
  whose `git` reads the machine's **own** credential configuration — a `credential.helper`
  (Git Credential Manager, `wincred`, `osxkeychain`, `store`), a `~/.gitconfig`, a keychain.
  T1/T2 pinned that WE don't persist a secret; T7 is the inverse the review MEASURED: the
  ambient git environment can **defeat** or **persist** the scoped relay token.
- **Attack that SUCCEEDS today — F14 (GIT_ASKPASS is not authoritative when a helper exists).**
  The clone runs bare argv `git clone <url> <path>` with a scoped `env` adding only
  `GIT_ASKPASS`. But **MEASURED on this very box** (stock Git-for-Windows: system helper
  `manager`, global `wincred`): when a `credential.helper` is configured, **the helper WINS and
  `GIT_ASKPASS` is never called** — git only consults askpass when no helper supplies a
  credential. Two security consequences on the soak's real machines:
  1. **T4 silently defeated.** The relay-minted short-lived scoped token in the askpass shim is
     **bypassed**; git authenticates with the operator's **personal, broad, long-lived** PAT
     from the OS keychain instead — and the clone **succeeds**, so nobody notices the central
     T4 mitigation evaporated.
  2. **T1 credential-at-rest reappears (the out-of-scope durable store).** MEASURED: on a
     successful clone git runs the helper's `approve` → **store**. If the askpass token *is*
     used on a box that also has a helper (the empty-helper case), git **persists that relay
     token into the OS keychain/`store`** — a credential surviving far beyond the one clone,
     landing squarely in the "durable secret store" this milestone explicitly refused
     (SPEC.md:65-66), defeating T4's "short-lived".
- **Control LANDED + RE-VERIFIED with LIVE GIT (2026-07-13 — this finding was a live
  measurement, so the fix was re-measured the same way, not read).** The scoped clone now runs
  `git -c credential.helper= clone <url> <path>` with `env` always including
  `GIT_TERMINAL_PROMPT=0` (GIT_ASKPASS added only when a credential exists) — on BOTH the
  credentialled and the public/null paths. Re-measured on this stock Git-for-Windows box (system
  `manager` + global `wincred`):
  1. **Askpass authority restored.** WITHOUT the reset the ambient helper wins and `GIT_ASKPASS`
     is never called; WITH `-c credential.helper=` the askpass shim fires and the **relay token**
     is what git uses. The bypass is closed.
  2. **Store-on-success suppressed.** WITHOUT the reset, `git credential approve` reaches the
     helper's `store`; WITH `-c credential.helper=` the store is **not** invoked — the relay
     token is no longer persisted into the OS keychain.
  3. **Public/null path fails LOUDLY.** With `GIT_TERMINAL_PROMPT=0` + the helper reset + no
     askpass, a real 401 clone fails immediately — `fatal: could not read Username … terminal
     prompts disabled` — no interactive hang, no silent keychain rescue.
  The `-c credential.helper=` mechanism is **git-core, not platform-specific** (it resets the
  helper list before any platform helper — `osxkeychain`/`libsecret`/`manager`/`wincred`/`store`
  — is consulted), so the control holds cross-platform; it was measured on Windows and the soak's
  `@manual` inspection re-confirms on the actual second machine's OS (attestation item 2).
- **Residual.** The `.askpass/<uuid>/token` file is written **mode 0666** (MEASURED — no
  `chmod 0600`, and on Windows perms are advisory) and sits on disk in the global mesh home for
  the clone's duration; it is removed in a `finally` (verified, even on throw) and lives under a
  random-uuid scoped dir, so exposure is one-clone-bounded — but it is **not permission-
  hardened**. Recorded as **R6**; hardening is a follow-up, not a soak blocker (the window is
  short and single-user), but the F14 fix also shrinks it (a bypassed askpass writes a token
  file that is never even used — pure exposure for no benefit).
- **Evidenced by.** Finding **F14** — **CLOSED**; the security-owned fitness
  `acd-worker-clone-no-credential-persisted` (F2), **now STRENGTHENED** (this review) with a
  positive T7/F14 clause — the clone path MUST reset the ambient helper (`-c credential.helper=`)
  and disable the interactive prompt (`GIT_TERMINAL_PROMPT`), with a synthesized self-check that
  trips on either omission; the developer's behavioural `test/mesh-worker-clone-credential-pull.
  test.mjs` (asserts the argv leads with `["-c","credential.helper="]` and `GIT_TERMINAL_PROMPT=0`
  on both paths) — corroborated by security's own live-git re-measurement; + the **`@manual` soak**
  inspection on the real target machine (attestation item 2).

## Residual risk (the honest list) → route to VERIFICATION / UAT

- **R1 — `@manual` / two-machine private-clone soak (T1/T2/T3, live transport).** The real
  credential crossing a real tailnet, a real private `git clone` on a second machine, a real
  agent child spawned WITHOUT the credential in its env, and a real failed clone's redacted
  error — none is exercisable by `@executable` (which never touches a real forge or a real
  credential). Verified once by story-01 `tasks/04_private-clone-soak.feature` (`@manual`,
  gated on this SECURITY-approved mechanism, closed at `aof:verify 38`).
- **R2 — Accepted / deferred: durable secret store for the deploy-key fallback.** IF the
  fallback (a pre-provisioned per-worker deploy key on the worker's disk, RESEARCH.md §1.2) is
  chosen for a repo host whose token API the control cannot reach, that key is a **durable
  standing credential at rest on the worker** — a different risk shape than the per-clone
  short-lived token (T4). Managing its rotation/storage is the **out-of-scope secrets-vault**
  concern (SPEC.md:65-66) — named here as the place it defers to a future milestone if the
  fallback path proves needed. Accepted, operator-acknowledged at `aof:verify`.
- **R3 — Inherited (35/SECURITY T1, Accepted).** The compromised-but-admitted control-node RCE
  boundary is inherited unchanged. A note in the m35 VERIFICATION already records it; not
  re-tested here.
- **R4 — Accepted / operator-verified: token minting policy (T4).** The token's server-side
  TTL + repo-scope is not worker-assertable; the operator attests it at `aof:verify` before the
  R1 soak. No test asserts an accepted, server-side property. **Extended this review:** the
  shipped default (`AOF_MESH_CLONE_TOKEN`) is a **standing, long-lived** token — the attestation
  MUST now state whether a real short-lived per-repo mint is wired, or the operator is accepting
  a long-lived single-repo PAT (T4's "short-lived" UNMET). See the attestation checklist below.
- **R5 — Accepted / operator-attested: the credential now rides a `ws://` (plaintext) relay,
  protected SOLELY by the tailnet's transport encryption.** The clone-credential reply carries a
  live token; `configuredServiceUrlForAddress` defaults the scheme to **`ws:`** (cleartext) and
  `ws.send(JSON.stringify(frame))` writes the token over that socket. This is a NEW property of
  this frame — earlier stream frames carried work-state, not secrets. It is acceptable ONLY
  because admission is the tailnet peer boundary (33/ADR-002) and the control-stream server binds
  the fabric self-address / loopback (never `0.0.0.0`), so the token crosses inside the tailnet's
  WireGuard tunnel. If the control-stream server is ever bound to a non-tailnet interface, or the
  tunnel is bypassed/downgraded, the token crosses in **cleartext**. Operator-attested at
  `aof:verify` (below); no worker-side test can assert the live bind interface.
- **R6 — Accepted / follow-up: `.askpass` token file perms + the `credential: null` masking
  gap.** (a) The one-shot askpass token file is written **mode 0666** (not 0600) for the clone's
  duration (T7 residual). (b) Because control cannot know whether the repo is private (the whole
  ADR-009 rationale), a `credential: null` reply is **indistinguishable** between "public repo,
  no cred needed" and "private repo, operator forgot `AOF_MESH_CLONE_TOKEN`" — the worker then
  attempts an **unauthenticated** clone with the ambient git config live, which F14's ambient-
  helper bypass would silently rescue on a real machine (masking the misconfiguration and using
  the operator's personal credential). The T7/F14 fix (`credential.helper=` + `GIT_TERMINAL_
  PROMPT=0` on the null path too) converts this to a LOUD failure. Follow-up hardening; recorded
  so the soak operator watches for a "succeeded but with the wrong (personal) credential" outcome.

### What the OPERATOR must attest at `aof:verify` before the private-repo soak (R1/R4)

**Now ENFORCED IN CODE (CI-pinned — the human need NOT re-verify these; a regression fails CI):**
F15 (mint scoped to `existing.workspace_id`, mismatch refused), F16 (terminal assignments mint
nothing), and F14 (the clone resets the ambient `credential.helper` chain + sets
`GIT_TERMINAL_PROMPT=0` on both paths) — each fixed, re-verified at source by security (probe +
live-git), and pinned by `test/mesh-worker-clone-credential-pull.test.mjs` (behavioural) and the
strengthened security fitness `acd-worker-clone-no-credential-persisted` (structural, T7/F14
clause). These are no longer open review items.

**Still requires the HUMAN to personally confirm before the soak (a test cannot assert these):**

1. **Minting policy (R4/T4) — the ONE unavoidable human judgement.** Which is true: (a) a real
   `mintCloneCredential` seam is wired, emitting a **short-lived, single-repo, read-scoped**
   token; OR (b) `AOF_MESH_CLONE_TOKEN` is a **fine-grained, read-only, single-repo** PAT and the
   operator **accepts it is long-lived** (T4's "short-lived" unmet) and will rotate it on the
   soak's cadence. A broad/all-repo/all-scope PAT is NOT acceptable. *No worker-side test can see
   the server-side scope/TTL of the minted token — this is irreducibly human.*
2. **Live-transport confirmation of the F14 fix on the ACTUAL second machine (R1/T7).** The
   `-c credential.helper=` mechanism is git-core (measured on Windows; platform-independent by
   design), but the soak is the first run on the real target OS/helper: confirm the private clone
   succeeds **with the relay token**, not the machine's keychain PAT — inspect by temporarily
   removing the operator's own keychain entry for the repo host and confirming the clone still
   succeeds, and that no relay token was written into the keychain afterward.
3. **R5 transport bind.** Confirm the running control-stream server binds the **tailnet
   self-address / loopback only** (never `0.0.0.0`) — the `ws://`-borne credential rides inside
   the WireGuard tunnel (no worker-side test can assert the live bind interface).
4. **T3 live (R1).** On a REAL failed private clone, the surfaced/redacted error carries **no
   credential value**, and the spawned agent child's environment carries **no** `GIT_ASKPASS` /
   token (T2 on the real spawn).
5. **R6 watch-item (not a blocker).** Note the `.askpass` token file is mode 0666 for the clone
   window (hardening deferred); watch for any "clone succeeded but with the wrong (personal)
   credential" outcome during the soak.

## Security fitness functions (owned by security, under `test/arch`)

Structural + behavioural invariants that are security's own, wired into `scripts/test.mjs` and
failing CI on violation.

| # | Name (`test/arch/…`) | Threat | Invariant | Assertion method | State |
|---|---|---|---|---|---|
| F1 | `acd-worker-clone-target-scoped` | T5 | The clone target is built ONLY from the dedicated `meshCheckoutPath` root under the global mesh home, keyed by `workspaceId` — never `os.tmpdir()`, never `path.join(root, directive.*/itemRef)`; any `git clone` routes through the scoped seam. | **Source-analysis** over `src/mesh-worker-execution.mjs`. Self-check (m03 non-vacuous): a planted `os.tmpdir()` target, a directive-text target, and a seam-less `git clone` all trip the detector. | GREEN (armed) |
| F2 | `acd-worker-clone-no-credential-persisted` **(strengthened this review — T7/F14)** | T1, T2, T3, **T7** | The clone path (a) persists NO credential into `.git/config`; (b) assigns NO credential onto the worker's **ambient `process.env`**; (c) logs no credential value; **(d) NEW — RESETS the ambient credential.helper chain (`-c credential.helper=`) and DISABLES the interactive prompt (`GIT_TERMINAL_PROMPT`), so GIT_ASKPASS is authoritative and no token is persisted to the keychain (T7/F14).** | **Source-analysis** over `src/mesh-worker-execution.mjs`. Self-check: the (a)/(b)/(c) plants as before, PLUS a clone that OMITS the `credential.helper=` reset and one that OMITS `GIT_TERMINAL_PROMPT` each trip the new (d) detector; the correct reset+prompt shape stays clean. | GREEN (F14 clause added + verified) |
| F3 | `acd-clone-credential-pull-not-pushed` | T4 | The credential is PULLED on a clone miss, never pushed on the directive; the resolver is production-wired as a literal key (the F12 guard); no static per-worker credential option exists. | Source + behavioural, over control/launcher/worker. Self-check synthesizes each plant. | GREEN (armed) |
| F4 | `acd-clone-credential-relay-not-logged` **(NEW this review)** | T3 (re-derived on the relay frame) | Neither the control send-side (`buildCloneCredentialFrame`/mint) nor the worker receive-side (`requestCloneCredential`) passes a `credential` value into a `console.*`/`logger.*`/`warn`/`onWarning` sink — the credential rides the wire (`ws.send`) only, never a log. | **Source-analysis** over `src/control-stream-server.mjs` + `src/worker-stream-client.mjs`. Self-check: a `console.log(frame.credential)`, a `logger.debug(minted)`, and an `onWarning({message: credential})` all trip; the real `warn(code, error)` failure-isolation shape stays clean. | GREEN (added) |

**T7/F15 + T7/F16 pinned (fix landed).** The mint-scoping (keyed on `existing.workspace_id`,
mismatch refused) and terminal-state gates are pinned **behaviourally against the real producer**
by the developer's `test/mesh-worker-clone-credential-pull.test.mjs` (asserts both coded refusals,
mint-never-called, and the mint scoped to the row's own workspaceId) — corroborated by security's
own independent source-probe re-run (a holder of `asg-1`/`ws-a` naming `ws-b` → refused, 0 mint
calls; all four terminal states → refused, 0 mint calls). Security reviewed these as the CI pin
and did not duplicate them as a redundant arch-test.

**What F2 gained this milestone (the review's substantive addition):** the original F2 caught
only `.git/config` persistence + logged tokens. It now ALSO forbids (i) the MEASURED
clone-time `--config http.*` footgun (T1, RESEARCH §1.1) as a distinct, precisely-messaged
failure, and (ii) any write of a credential onto ambient `process.env` (T2, RESEARCH §1.5 — the
env-inheritance leak into the spawned agent child that ADR-005 did not fully pin). Its
self-check adds a **negative control** confirming the correct discipline — a scoped `env`
passed to ONLY the clone's `execFile` — stays clean.

## Coordination note (division of ownership)

The **architect** owns ADR-005 (clone-on-miss structure) and ADR-009 (the PULL credential
CHANNEL + the `mintCloneCredential`/`requestCloneCredential` seams). **Security** owns this
threat→control map and the fitness functions F1–F4 above (F4 added this review). Where a
fitness function names an invariant an ADR must satisfy (T5 scoped target, T1/T2/T3 credential
handling), that is the coordination point — the ADR states the decision, the fitness function
fails CI if the implementation drifts. T4's minting policy and R1/R2/R4/R5/R6 residuals are
**operator sign-off** at `aof:verify` — no test asserts a server-side or accepted risk.

**As-built review verdict — INITIAL (at `aof:verify 38` story-01): CHANGES REQUESTED.** The PULL
channel's transport, correlation, timeout/failure paths, T2 env-isolation, and T3 no-log were
SOUND, but three defects were measured at source: **F14** (High) — the clone did not isolate git
from the ambient credential environment (relay token bypassed / persisted on a real
helper-configured machine); **F15** (High) — the mint was scoped to the requester-supplied
`frame.workspaceId`, so a holder of any assignment could pull a credential for any repo; **F16**
(Medium) — a terminal-state assignment still minted a live credential.

**As-built review verdict — RE-REVIEW (2026-07-13, developer fixes verified by the finder):
ALL THREE CLOSED. GO for the private-repo soak, subject to the human-attestation items above.**
Security re-drove the real producers (not the developer's report):
- **F15 — CLOSED.** Re-ran the exact probe: holder of `asg-1`/`ws-a` naming `ws-b` → refused
  `clone-credential-workspace-mismatch`, **mint never called**, `credential:null`, loud coded
  reply; strict `!==` (a trailing-space workspaceId is refused — no silent trim/substitution);
  the legitimate path passes `existing.workspace_id` to the mint.
- **F16 — CLOSED.** `done`/`failed`/`withdrawn`/`reclaimed` each refuse
  `clone-credential-assignment-inactive` with the mint never called; `assigned`/`accepted`/
  `running` still authorize. T6 non-holder refusal still fires before either gate.
- **F14 — CLOSED (re-measured with LIVE GIT, since the finding was a live measurement).** With
  `-c credential.helper=` the ambient helper is reset and `GIT_ASKPASS` becomes authoritative
  (the relay token wins); the `approve`→store persistence is suppressed (no token written to the
  keychain); and `GIT_TERMINAL_PROMPT=0` makes a no-credential private clone fail LOUDLY
  (`could not read Username … terminal prompts disabled`), never a silent keychain rescue. The
  reset is git-core, so it holds cross-platform (measured on Windows; soak re-confirms on the
  target OS). The strengthened F2 fitness now pins this structurally. **R6** (askpass token file
  mode 0666) remains an accepted follow-up, not a soak blocker.

**Overall go/no-go on the credential path: GO** — the code-level attack surface is closed and
CI-pinned; what remains is the irreducibly-human minting-policy attestation (R4/T4) and the
live-transport confirmations (R1/R5) that no test can assert, listed above.
