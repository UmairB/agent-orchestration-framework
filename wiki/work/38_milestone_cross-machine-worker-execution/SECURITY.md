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
- **⇢ Story-02 UPDATE — this residual is being CLOSED for the `github-app` provider.** T4's
  minting-policy residual (R4 — the operator attests the token is short-lived + single-repo
  because no worker test can see the server-side scope) is exactly what story 02 closes. The
  new `github-app` provider at the `mintCloneCredential` seam makes the token **single-repo,
  `contents:read`, ~1h BY CONSTRUCTION** instead of by attestation: the mint's request SHAPE is
  now **control-side code**, fitness-asserted by `acd-minted-token-scoped-single-repo` (T9/F6),
  and the ~1h TTL is a GitHub App property, not an operator setting (T11). So the property the
  operator attested at R4 (the minted token's scope + TTL) **moves from human to code**; what
  stays human is the NARROWER, one-off attestation that the **App itself** is installed
  least-privilege and its key stored appropriately (T8 — see the swapped attestation checklist).
  The `AOF_MESH_CLONE_TOKEN` default (the `⚠` note above) is RETAINED for a single-repo
  bootstrap/dev fleet and still carries its R4 attestation **when selected**; only the
  `github-app` path is code-enforced. New surfaces story 02 opens are threat-modelled as **T8–T11**
  below.

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

## Threat model — story 02 (`clone-credential-mint`): the GitHub-App mint surface (BEFORE it is built)

Story 02 changes only what the ADR-009 `mintCloneCredential(workspaceId, assignmentId)` seam
RETURNS — the F15 (workspace-match) / F16 (active-state) / T6 (holder) gates that PRECEDE the mint
are UNCHANGED and reused verbatim. What is new: the credential SOURCE becomes a **GitHub App
installation token** (minted per-clone, exactly the assigned repo, `contents:read`, ~1h — T4-compliant
by construction), and a NEW durable secret appears — the **App private key at rest on the control
node** (one fleet-wide key, signs the App JWT, NEVER relayed). T8–T11 model that surface.

### T8 — The App private key at rest on the control node — the durable, fleet-wide signing secret · `Info-disclosure` + `AuthZ` · sev **High** (largest single blast radius in this model)

- **NEW surface (story 02 introduces the first durable secret this milestone keeps).** Story 01's
  credential SOURCE was a value the control node was HANDED (`AOF_MESH_CLONE_TOKEN`) or an injected
  mint closing over an external authority. Story 02's `github-app` provider makes the control node
  itself the **minting AUTHORITY**: it holds the GitHub App's **private key** and signs the App JWT
  (RS256, `node:crypto`) on every mint. That key is a **standing secret at rest on the control node**
  for the daemon's whole life, and it is **fleet-wide** — it can mint an installation token for EVERY
  repo the App is installed on.
- **Attack.** Control-node compromise, or exfiltration of the key (a backup, a support bundle, a
  world-readable path, a log line, a stray commit), hands an attacker the ability to mint
  `contents:read` tokens for **every repo the App is installed on**, indefinitely, entirely off-mesh —
  a far larger prize than any single relay token (one repo, ~1h). This is the highest-value secret in
  the whole threat model.
- **Control.** (a) The key lives ONLY on the control node, at a **file-permission-protected path (or
  an OS-keystore reference)** resolved from config/env — **never a committed config key**
  (`config.mesh.repo.cloneUrl` is committed; the key MUST NOT be), never in git, never logged, and
  **never relayed** — only the minted short-lived token ever crosses the wire (fitness-pinned by
  `acd-clone-app-key-not-relayed`, F5). (b) The App's OWN least-privilege installation bounds the
  blast radius even ON compromise: the App is installed `contents:read` on **SELECTED repositories
  only** — never org-wide, never any write scope — so a stolen key mints only read tokens for the
  handful of repos the fleet actually runs, not the whole org. (b) is a GitHub-side property no
  worker/CI test can see → the operator attestation (below) is the ONLY place it is verified.
- **Residual (Accepted — R7; SUPERSEDES R2).** ONE standing key for the whole fleet is the accepted
  trade, and it is **strictly better** than what it replaces: a per-repo PAT (N standing secrets, one
  per repo) or a per-worker deploy key (a durable key on every worker's disk, R2). It collapses N
  durable secrets on N machines to ONE durable secret on ONE machine — the control node — that never
  leaves it. See R7.
- **Evidenced by.** **Fitness** `acd-clone-app-key-not-relayed` (F5, spec below) + the architect's
  ADR-009 mint seam (`mintCloneCredential` — the key is read control-side, never handed to a worker)
  + the **operator attestation** (the App is installed least-privilege + the key is stored
  file-perm-protected — the swap below). No test can assert the server-side installation scope or the
  key's on-disk perms — that residue is the human attestation.

### T9 — Over-scoped mint: the installation token requests more than the one assigned repo + `contents:read` · `AuthZ` · sev **High** — the CODE-ENFORCED closure of T4

- **Attack.** The `github-app` mint exchanges the App JWT for an installation access token but
  requests it **too broadly**: it OMITS the `repositories`/`repository_ids` selector (→ a token
  scoped to ALL repos the installation can reach), or names MORE than the one assigned repo, or
  requests `permissions` beyond `{ contents: "read" }` (`contents: write`, `administration`,
  org-wide). A worker that captures such a token — or a worker compromise — then holds exactly the
  broad, over-scoped credential T4 exists to prevent, re-opening "single-repo, read-only by
  construction".
- **Control.** The `github-app` mint's installation-token request is **structurally constrained to
  EXACTLY the one assigned repo + `contents:read`**: the request body names a **single-element**
  `repositories`/`repository_ids` derived from the mint's `workspaceId` argument (the assignment
  row's workspaceId — already F15-bound to the holder's own assignment before the mint is reached),
  and `permissions` is **exactly `{ contents: "read" }`** — never omitted (omission = the
  installation's full scope), never widened. Unlike the static PAT (whose server-side scope no worker
  could assert — the T4/R4 residual), this request SHAPE is **local control-side code** and therefore
  **fitness-assertable**: `acd-minted-token-scoped-single-repo` (F6, spec below) fails CI on a mint
  whose request omits the repo selector, names >1 repo, or requests any permission beyond
  `contents:read`. This is the invariant that turns T4's operator-attested minting policy into a
  code-enforced one. The App's own least-privilege installation (T8) is defence in depth: even a bug
  that widened the request cannot exceed what the App is installed to grant.
- **Residual.** None accepted for the request SHAPE (structural, fitness-pinned). The token's
  server-side realisation (that GitHub honours the request and issues a token no broader than asked)
  is a GitHub property, bounded by T8's App least-privilege and attested once — not per-soak.
- **Evidenced by.** **Fitness** `acd-minted-token-scoped-single-repo` (F6) + ADR-009 mint seam +
  T8's App-least-privilege attestation.
- **⇢ Story-07 RE-OPENS this — and it stays CLOSED under a TWO-TOKEN model (see T15).** Durable
  push-back (story 07, RESEARCH §4.2) needs `contents:write` (and `pull_requests:write` if it
  auto-opens a PR) to `git push` a worker's branch — a deliberate widening of the least-privilege
  posture THIS threat code-enforced at `mesh-clone-credential-provider.mjs:181`. The resolution does
  NOT relax this invariant: the **CLONE credential STAYS single-repo `contents:read`** (this T9 clause,
  unchanged and still F6-pinned), and a **SEPARATE write-scoped token** is minted single-repo, ONLY at
  the push seam, short-lived, off the clone path. F6 (`acd-minted-token-scoped-single-repo`) is
  REWRITTEN into a TWO-SEAM detector (clone=read, push=write, neither over-scoped, the clone body
  provably never widened) — the exact rewrite direction is **T15**. T9's own "single-repo,
  `contents:read`" assertion survives VERBATIM for the clone mint; the write mint is a new, separately
  bounded clause, not a loosening of this one.

### T10 — Mint-time failure that silently falls back to a broad token or an unauthenticated clone · `AuthZ` + `Info-disclosure` · sev **High**

- **Attack.** The `github-app` provider hits a real fault — App not installed on the repo, private
  key invalid/mis-parsed, GitHub API unreachable, JWT rejected, `403 permission denied`,
  installation-not-found — and, rather than failing loudly, degrades **quietly**: (a) it falls back
  to the `env-token` default (`AOF_MESH_CLONE_TOKEN`), handing out the broad standing PAT T4 warned
  about; or (b) it returns `credential: null`, and the worker — unable to tell "public repo, no cred"
  from "mint failed" (the R6 masking gap) — attempts an **unauthenticated** clone, which on a real
  helper-configured machine F14's ambient-helper bypass would silently rescue with the operator's
  personal keychain PAT (a wrong, broad credential; a masked misconfiguration).
- **Control.** A `github-app` provider fault is a **hard error that THROWS** — never a `null` return,
  never a fallback to `env-token`, never an unauthenticated retry. The existing control-side path
  already converts a thrown mint into the **loud coded `clone-credential-mint-failed`** refusal
  (`applyCloneCredentialRequestFrame`'s `try/catch` → `refuse(CLONE_CREDENTIAL_MINT_FAILED)`,
  `credential: null`, one-target coded reply), and the worker-side resolver already turns a
  refusal/timeout/blank reply into the existing loud coded **`assignment-repo-unavailable`** `failed`
  (`cloneRepoForWorkspace`'s resolver `try/catch`) — the exact posture ADR-005/ADR-009 already fixed
  for an unresolvable clone source. Story 02 adds NO new failure path; it INHERITS this one. Its only
  new obligations: (i) the `github-app` provider must **THROW on fault, never return `null`** — a
  `null` return is reserved for the legitimate "no credential configured" public-repo case, which the
  `github-app` provider (selected precisely BECAUSE the repo is private) must never emit for a fault;
  and (ii) the provider SELECTOR must NOT, on a `github-app` fault, silently fall through to
  `env-token`.
- **Residual.** The public-vs-mint-failed ambiguity of a `credential: null` reply (R6(b)) is
  unchanged and already accepted — but story 02 NARROWS it: when `github-app` is selected, a `null`
  can only mean "public repo", because a fault throws. The T7/F14 `GIT_TERMINAL_PROMPT=0` +
  `credential.helper=` control already converts any resulting unauthenticated private clone to a LOUD
  failure rather than a silent keychain rescue.
- **Evidenced by.** The existing loud coded refusals (`clone-credential-mint-failed` →
  `assignment-repo-unavailable`) — behaviourally pinned by
  `test/mesh-worker-clone-credential-pull.test.mjs` — + a story-02 `@executable`/behavioural check
  (armed at refine) that a `github-app` provider fault yields the coded refusal and **never** an
  `env-token` fallback + the F14 loud-null-path control (T7) + `acd-clone-credential-provider-config-driven`
  (the architect/developer-owned config-driven fitness that pins the `env-token` default path
  UNCHANGED — so a `github-app` selection cannot silently become an `env-token` mint).

### T11 — The minted token's ~1h validity window (and the App-JWT's ≤10-min window) — a captured token outlives the clone · `Info-disclosure` + `AuthZ` · sev **Low** (bounded by construction)

- **Attack.** A GitHub App installation token is valid ~**1 hour** (GitHub-fixed, not caller-tunable),
  but the clone that consumes it takes seconds. A token captured in its exposure window (the askpass
  file R6, a transit exposure R5) is therefore live for up to ~1h after the clone finishes — a window
  longer than the operation that needed it. Separately, the App JWT used to MINT the token has a
  **≤10-min** expiry ceiling (GitHub-enforced) and is signed with the T8 key; a leaked JWT is a
  (short) bearer for minting.
- **Control.** Both windows are **short by construction and NOT operator-tunable** — this is the
  point of the swap: the ~1h token TTL and the ≤10-min JWT window are GitHub App properties, so T4's
  "short-lived" is met WITHOUT any operator setting or attestation (contrast the static PAT, whose
  TTL was unbounded and had to be operator-attested at R4). The token is single-repo, `contents:read`
  (T9), so even a full-window capture reads one repo. The JWT never crosses the relay and is never
  handed to a worker (a control-side mint-time artefact, held as briefly as the token it fetches) —
  the same no-relay/no-log discipline as the T8 key (F5 extends to the JWT signing material). No
  caching/reuse (story scope: "minting per-clone is fine… no cache") — a token is fetched fresh per
  clone and not persisted, so there is no store of ~1h tokens to harvest.
- **Residual (Accepted — R8).** The ~1h token window is longer than the clone but is the shortest
  GitHub offers for an installation token, and is strictly better than the static PAT's unbounded
  life (T4). No code control can shorten it; accepted as the by-construction floor.
- **Evidenced by.** ADR-009 (per-clone mint, no cache) + T9 scope
  (`acd-minted-token-scoped-single-repo`) + T8 no-relay/no-log (`acd-clone-app-key-not-relayed`,
  extended to the JWT signing material) + R8 (accepted window).
- **⚠ DEPENDENCY — the `x-access-token` username (parallel researcher).** If the askpass shim must
  send username `x-access-token` for a GitHub App installation token (a basic-auth requirement for
  installation tokens, distinct from a PAT), that is a **credential-handling change** to story 01's
  shim: it must answer the Username prompt with the literal `x-access-token` and the Password prompt
  with the token — it must **NOT** emit the token as the USERNAME (which would place the secret in a
  second field and the URL git constructs, a T1/T3 re-exposure). Flagged as a dependency on the
  researcher's finding; F2 (`acd-worker-clone-no-credential-persisted`) is the fitness that would pin
  the shim's handling. **The architect reconciles the exact shape — security has NOT invented the
  resolution.**

## Threat model — stories 03–07 (operator-directed expansion: per-org isolation · the UI mutation face · the terminal mirror · durable push-back)

These four threats extend the model for the mid-milestone stories the operator locked in during
`aof:verify 38` (RESEARCH §4). Each is operator-directed with RESEARCH backing — a crisp
threat→attack→control entry, not a re-decided feature. T15 additionally RE-OPENS T9 (updated in-place
above). ADRs are referenced loosely ("the story-NN ADR") — a parallel architect owns them.

### T12 — Per-org App-key confusion: a mis-scoped resolution mints with the WRONG org's App, or the default key dir lands in a sync/world-readable path · `AuthZ` + `Info-disclosure` · sev **High** (story 03)

- **NEW surface (story 03 moves the App IDENTITY from one-per-fleet to one-per-assigned-workspace).**
  Story 02 resolved the `mintCloneCredential` provider ONCE, from the control node's own launch-workspace
  config (`mesh-launcher.mjs:508-513`), so ONE App (or one env-token) mints for EVERY repo across the
  whole mesh regardless of org. Story 03 resolves the App identity (`appId` + `privateKey` + optional
  `installationId`) PER-ASSIGNED-workspace, from THAT workspace's OWN committed `mesh.repo.credential.*`
  config — mirroring how `createResolveWorkspaceCloneUrl` (the story-02 ADR, "Gap A") already resolves
  `cloneUrl` per workspace. The isolation boundary becomes the ORG: each org its own App, key, installation.
- **Attack.** (a) **Cross-org key confusion.** A mis-configured — or hostile — workspace descriptor
  resolves ANOTHER org's App key, so the mint signs org A's repo request with org B's App (or BORROWS
  org B's App when org A has none configured). A confused/stolen App then mints tokens for repos across
  an org boundary the operator believed isolated — the fleet-wide T8 blast radius now leaking ACROSS orgs.
  (b) **The new default private-key directory lands in a sync/world-readable path.** Story 03 adds a
  code-enforced default key dir (`<meshRoot>/credentials/`, i.e. `~/.aof/mesh/credentials/`) for when
  neither `AOF_MESH_GITHUB_APP_PRIVATE_KEY_PATH` nor `config.mesh.repo.credential.githubApp.privateKeyPath`
  is set (`resolveGithubAppPrivateKey`, `mesh-launcher.mjs:131`). If that default ever resolved into a
  Dropbox/iCloud/OneDrive-synced or world-readable location, the T8 fleet-wide signing secret is
  exfiltrated by the sync client itself — a MEASURED operator footgun (the story exists BECAUSE the
  operator had to relocate the story-02 key OUT of a Dropbox-synced folder).
- **Control.** (a) Resolution reads ONLY the assigned workspace's OWN committed config (the descriptor
  lookup, mirroring `createResolveWorkspaceCloneUrl`) — it NEVER reaches for a sibling workspace's App,
  and absent an App/key for the assigned workspace's org the mint fails **LOUD** (the existing
  `clone-credential-mint-failed` → `assignment-repo-unavailable` posture), NEVER silently borrows another
  org's App. A confused/absent descriptor is a refusal, not a cross-org mint. (b) The per-mint scope is
  UNCHANGED and still code-pinned: WHICHEVER App resolves, F6 (`acd-minted-token-scoped-single-repo`)
  still bounds the request to single-repo `contents:read` — even a confused App cannot exceed one repo,
  read-only. (c) The default key dir is a **file-permission-protected, NON-SYNC path under the global
  mesh home** (`<meshRoot>/credentials/`, honoring `AOF_GLOBAL_HOME`) — never a sync-scoped folder —
  re-arming T8's "file-permission-protected path" requirement for the DEFAULT case, built from
  `globalMeshPaths().meshRoot` by the same scoped-seam discipline as `meshCheckoutPath`/F1 (never a
  user-home guess).
- **Residual (Accepted — operator-attested, per-org extension of T8/R7).** No worker/CI test can see the
  server-side installation scope of EACH org's App, nor the on-disk perms of a key file — so the T8
  attestation now repeats PER ORG: the operator attests each org's App is installed least-privilege
  (`contents:read`, selected repos, no write / no org-wide) and its key stored file-perm-protected in a
  non-sync path. NARROWER than re-litigating each token; one-off per App/org.
- **Evidenced by.** The **story-03 ADR** (per-workspace App-identity resolution, mirroring Gap A) + the
  story-03 **`@executable`** `tasks/01_cross-org-key-isolation.feature` (a mint for workspace A's org can
  never be produced with workspace B's App; a workspace whose org has no App fails loud, never borrows) +
  `tasks/02_default-private-key-directory.feature` (the default resolves under `<meshRoot>/credentials/`,
  never a sync folder) + **F6** unchanged (per-mint scope stays single-repo `contents:read` whichever App
  resolves) + the **operator attestation** per org (T8/R7 extended).

### T13 — Hostile POST to the fleet-face mutation carve-out (mint work on an arbitrary/ineligible node; CSRF) · `AuthZ` + `Tampering` · sev **High** (story 04)

- **NEW surface (the read-only fleet face gains its FIRST write route).** `mesh-ui-serve.mjs` is
  read-only by ADR-004/ADR-006 — it serves `GET /api/mesh/status` + `GET /api/mesh/board-url`, every
  write method is a clean 405 (`sendMethodNotAllowed`), every WebSocket upgrade is destroyed
  (`server.on("upgrade", socket.destroy)`), and it does ZERO fs write and NO shell-out (verified at
  source). Story 04 adds ONE write route wrapping the existing `aof mesh assign <ref> --to <nodeId>`
  (`mesh-assign.mjs`) so an operator dispatches from the UI. This is the first, single, explicit
  exception to the read-only invariant.
- **Attack.** (a) An **unauthenticated / cross-site POST** minting work on an arbitrary node, or forging
  an assignment to a node that LACKS the repo (an ineligible target). (b) **CSRF**: the face binds
  `127.0.0.1`, but a browser running on the control host can be driven cross-origin (a malicious page
  auto-POSTing to `http://127.0.0.1:4181/…`) to mint work the operator never authorized. (c) A POST that
  bypasses the CLI's arbitration to double-assign a node (breaking the single-runner uniqueness invariant).
- **Control.** (a) The write route is a THIN wrapper that **re-runs the verb's EXISTING gates** —
  node-known (live roster), control-side repo-availability, single-runner uniqueness — so an
  unknown/ineligible/duplicate target is refused **IDENTICALLY to the CLI**; the UI path reimplements no
  arbitration and can mint nothing the CLI could not. (b) **Admission posture required (specify, then
  prove): loopback-bind only (`127.0.0.1`, never `0.0.0.0` — already the face's bind) + local-admission
  at minimum, AND a cross-origin write MUST be refused** (reject on `Origin`/`Sec-Fetch-Site` cross-site,
  or require a non-simple content-type + a custom header a form-POST cannot forge) — closing the CSRF
  vector. (c) **The carve-out is EXACTLY ONE route**: the single new POST endpoint; every OTHER method on
  every OTHER path stays 405/404 exactly as today (the ADR-004 read-only posture is preserved everywhere
  except this one seam).
- **Residual (name the fully-local attacker).** Anyone who can already reach `127.0.0.1` on the control
  host — a local process or logged-in user — can drive the assign route exactly as the operator can
  (identical to running the `mesh assign` CLI). That is the INHERITED local/tailnet admission boundary
  (33/ADR-002; 35/SECURITY T1), NOT widened by this story: the UI face grants no capability the CLI on the
  same host did not already have. What story 04 must NOT do is extend that reach BEYOND the loopback host
  (hence the bind + cross-origin controls above).
- **Evidenced by.** The **story-04 ADR** (fleet-face mutation carve-out — endpoint shape + admission
  gating) + the existing `mesh assign` gates (node-known, repo-availability, single-runner uniqueness)
  reused verbatim + a story-04 **`@executable`** (a POST to an unknown/ineligible node is refused
  identically to the CLI; a cross-site POST is rejected; the assign mints the `assigned` record on the
  happy path) + an **arch-invariant** direction `acd-fleet-face-single-mutation-route` (the fleet face
  exposes EXACTLY one write route; every other path/method stays 405/404 — the structural pin that the
  read-only posture gained precisely ONE exception) + the **operator attestation** of the live bind
  interface (loopback only — no worker/CI test asserts the running bind, R5-style).

### T14 — A worker's live terminal (an agent with credentials + shell) mirrored to the control node · `Info-disclosure` + `Isolation` · sev **High** (story 06)

- **NEW surface (a credentialled interactive terminal now crosses the mesh).** Story 05 replaces
  `claude -p` with an interactive `claude` in the worker's `/ws/terminal` PTY (`terminal-ws.mjs`, a
  FROZEN **bidirectional** bytes envelope) — an agent with shell access and live credentials in its
  process. Story 06 relays that PTY byte stream cross-machine over `mesh-relay.mjs` into the control
  node's fleet view, routed by (nodeId, sessionId). The fleet face's DELIBERATE no-`/ws/terminal`
  refusal (the `server.on("upgrade", socket.destroy)` above) becomes a carve-out.
- **Attack.** (a) Secrets / tokens / source code on-screen become visible to whoever views the control
  fleet view. (b) A compromised control node HARVESTS the worker's terminal output continuously (a richer
  prize than one relay frame). (c) The "read-only mirror" being INTENT not FACT: the `terminal-ws`
  envelope is bidirectional by design, so a reverse **input path** could smuggle keystrokes from the
  fleet view down to the worker PTY — turning a view into remote shell control (the read-WRITE capability
  the story explicitly DEFERS to Phase 2).
- **Control.** (a) **Read-only IN FACT this story — pinned structurally.** The bridge relays PTY
  **output** bytes ONLY; there is NO wire path from the fleet face to the worker's `/ws/terminal` input.
  Arch invariant `acd-fleet-terminal-mirror-read-only`: the cross-machine terminal frame carries the
  output direction only, and NO fleet-originated input/keystroke frame is forwarded onto the worker's PTY
  socket (the bidirectional envelope is used output-only on this bridge; the input direction has no code
  path). (b) **Who may view = the SAME admission posture as T13** (loopback-bound control fleet face +
  local-admission; the cross-machine relay rides the tailnet peer boundary, 33/ADR-002, exactly as the
  credential relay does — R5). (c) **The credential MATERIAL never streams**: the minted token lives ONLY
  in the one-shot askpass file (T7/R6), never echoed to the PTY; the App key / JWT / mint are
  control-side (T8/F5), never on the worker terminal at all. The existing credential-handling invariants
  (T1/T2/T7 keep the token off argv/env/log; F5 keeps the key off every sink) already keep the secret
  MATERIAL out of the mirrored bytes — the mirror can leak only what the agent itself PRINTS on screen.
- **Residual (name it — inherent to a terminal mirror).** On-screen secrets are inherently visible to an
  AUTHORIZED viewer: any token, file content, or env value the agent prints to its OWN terminal is, by
  construction, visible to anyone permitted to view the mirror — no control can redact an arbitrary
  on-screen byte stream. Accepted; and the compromised-admitted-control-node case is the INHERITED
  35/SECURITY T1 boundary (not widened — but its prize now includes live terminal output). The soak's
  **`@manual`** inspection watches for a credential appearing on-screen in the mirrored stream.
- **Evidenced by.** The **story-06 ADR** (cross-machine terminal bridge; read-only mirror; (nodeId,
  sessionId) routing) + the **arch invariant** `acd-fleet-terminal-mirror-read-only` (armed at build: the
  bridge + the fleet-face terminal route carry OUTPUT frames only; NO code path forwards a fleet-originated
  input frame to the worker PTY — the "read-only in fact" pin) + the inherited credential-off-PTY
  invariants (T7/F2 token only in the askpass file; T8/F5 key/JWT control-side) + the admission posture as
  T13/R5 (operator-attested bind + tailnet relay) + the **`@manual`** soak inspection (no secret visible
  in the mirrored stream on a real run).

- **⚠ AS-BUILT REVIEW (story 06 HYBRID transport, `aof:continue 38/06` closing F-38.06, 2026-07-19) —
  GO-WITH-FIXES. One control the ADR CLAIMS is not implemented (F17); the other four T14 concerns HOLD at
  source.** The hybrid moved the cross-machine leg onto the FABRIC (`worker-stream-client.sendTerminalFrame`
  → `control-stream-server`'s `onTerminalFrame` branch) and the same-machine leg onto a loopback `serveRelay`
  broker. Verified at source:
  - **Concern #1 (no credential in the stream) — HOLDS, but the structural pin drifted off the live path.**
    The live frame builder is now `worker-stream-client.sendTerminalFrame(sessionId, bytes)`, fed by
    `mesh-launcher`'s `onOutputChunk: (chunk, sessionId) => client.sendTerminalFrame(sessionId, String(chunk))`,
    fed by `mesh-worker-execution.mjs`'s `term.onData` (`:1002-1014`) — every hop carries ONLY the PTY chunk;
    no askpass file, no `process.env`, no mint reply is read in. The accepted T14 residual (a secret the agent
    PRINTS to its own terminal) IS the only residual; the wiring introduced no new leak. **BUT** the T14
    credential-source detector in `acd-fleet-terminal-mirror-read-only` still scans the RETIRED
    `wireTerminalBridge` (now dead — no production import), NOT the live `sendTerminalFrame` path. Closed this
    review by the new fitness `acd-fleet-terminal-frame-connection-identity` (green clause: the live builder +
    `onOutputChunk` fold no credential material).
  - **Concern #2 (routing identity cannot be spoofed) — VIOLATED (F17, High-ish). The ADR-014 AMENDMENT's
    "re-stamped control-side" invariant is NOT implemented.** `control-stream-server` correctly resolves the
    CONNECTION-bound `nodeId = meta.nodeId` and passes it to the sink (`onTerminalFrame(frame, { nodeId })`,
    `:900-906`) — but the frame it hands still carries the worker's self-declared `frame.nodeId`, and
    `mesh-launcher.mjs:719` DISCARDS the connection identity and pushes the RAW frame:
    `onTerminalFrame: (frame) => controlTerminalPush?.push(frame)`. The loopback broker forwards it verbatim
    and `mesh-terminal-mirror.apply` routes by `envelope.nodeId` — the SELF-DECLARED value. A malicious-but-
    admitted worker that sends a raw `{ kind:"terminal-frame", nodeId:"<victim>", signal:{ sessionId, bytes } }`
    up its OWN authenticated fabric socket injects arbitrary bytes onto the VICTIM node's fleet card — cross-node
    impersonation/tampering of the operator's view, the exact spoof the T6 discipline exists to prevent. It does
    NOT disclose another node's stream (a worker cannot subscribe to the loopback broker off-host), persist, or
    give RCE — but it can also corrupt the very @manual on-screen-secret inspection T14 leans on (inject a fake
    secret → false alarm; flood → mask a real leak). **Fix (developer, one line): re-stamp control-side —
    `onTerminalFrame: (frame, { nodeId }) => controlTerminalPush?.push({ ...frame, nodeId })` (or re-stamp inside
    control-stream-server before the sink call).** Pinned RED-until-fixed by the new fitness (below).
  - **Concern #3 (read-only IN FACT) — HOLDS.** `mesh-ui-serve.mjs`'s `/ws/terminal-view` upgrade block
    (`:349-401`) is server→browser only: it registers NO `ws.on("message", …)` and calls no `term.write`; the
    bridge/mirror modules have no `term.write`/PTY-stdin sink. Pinned by `acd-fleet-terminal-mirror-read-only`
    (structural + behavioural). No mesh→PTY input path exists.
  - **Concern #4 (no persistence) — HOLDS. inv.3 is HARDER now.** The terminal-frame branch in
    `control-stream-server` returns BEFORE `applyStreamFrame` (no store apply, `:900-907`); `applyStreamFrame`
    carries no terminal-frame kind; the bridge/mirror import no fs/store seam and write nothing. Pinned by
    `acd-terminal-stream-transport-wired` inv.6 + `acd-fleet-terminal-mirror-read-only` inv.3.
  - **Concern #5 (loopback broker exposure) — HOLDS.** `serveRelay` binds `127.0.0.1` ONLY
    (`mesh-relay.mjs:622`, no injectable bind address), so a non-loopback peer literally cannot reach the
    terminal fan-out; the group-vs-loopback auth gate is unchanged (loopback trusted, an unreachable group path
    stays fail-closed). The broker shares `servicePort` (parsed from `config.mesh.relay.url`) with the
    fabric-bound control-stream server, but on a DISTINCT bind address (`127.0.0.1` vs the fabric self-address)
    — no admission ambiguity; the only same-port edge is a clean EADDRINUSE degrade when the control server has
    itself fallen back to loopback (relay simply does not start — a functional degrade, not an exposure).

### T15 — Widened write-scoped mint for push-back — RE-OPENS T9 · `AuthZ` · sev **High** (story 07)

- **NEW surface (least-privilege deliberately widened for `git push`).** Durable push-back (story 07,
  RESEARCH §4.2) needs `contents:write` to push a worker's branch (and `pull_requests:write` if it
  auto-opens a PR) — a widening of the single-repo `contents:read` posture story 02 code-locked at
  `mesh-clone-credential-provider.mjs:181` (`{ repositories:[repo], permissions:{contents:"read"} }`) and
  pinned by `acd-minted-token-scoped-single-repo` (T9/F6). This RE-OPENS T9 (updated in-place above).
- **Attack.** (a) A `contents:write` token captured (askpass exposure R6, transit R5) or over-scoped
  writes to repos BEYOND the assigned one — the exact over-scope T4/T9 exist to prevent, now at WRITE
  authority (a captured write token can rewrite / force-push / delete branches). (b) The write grant
  PERSISTS beyond the push instant — a broad exposure window rather than the momentary push. (c) The
  **CLONE credential is silently widened** to `contents:write` (the easiest wrong move — flip the one
  existing mint body from `read` to `write`), collapsing the whole clone-on-miss path to write scope so
  EVERY dispatched worker holds a write token for the whole run.
- **Control — the §4.2 TWO-TOKEN shape (security-preferred; adopt it).** (a) The **CLONE credential STAYS
  `contents:read`** — single-repo, minted on the clone-miss PULL, byte-unchanged (the T9/F6 invariant
  preserved VERBATIM for the clone mint). (b) A **SEPARATE write-scoped token** is minted single-repo,
  **ONLY at the push seam**, short-lived, and NEVER on the clone path: single-element `repositories`
  derived from the assigned repo, `permissions` no broader than `{ contents: "write" }` (+
  `{ pull_requests: "write" }` ONLY if auto-PR) — never `administration`, never org-wide, never omitted.
  (c) The push reuses the ALREADY-BUILT `GIT_ASKPASS` shim (`buildAskpassShim`), so the write token
  inherits the SAME handling invariants as the clone token (T1/T2/T7: never persisted to `.git/config`,
  never on ambient `process.env`, ambient helper reset) — its only NEW property is the wider scope,
  isolated to the push moment.
- **Fitness-test rewrite direction — `acd-minted-token-scoped-single-repo` must become a TWO-SEAM
  detector (spec here; ARMED AT BUILD against the real push-mint module, NOT edited in this pass).**
  Today the detector locates "the FIRST `access_tokens` call site" (`accessTokensBodyLiteral`) and asserts
  single-repo + `{ contents: "read" }` — one seam. After story 07 there are TWO mint seams (a read mint
  for clone, a write mint for push), so the rewrite MUST:
  1. **DISCRIMINATE the two seams** — locate BOTH `access_tokens` request bodies (iterate EVERY call site
     rather than `indexOf("access_tokens")` once, or key each body to its own mint function/export: the
     existing clone `createGithubAppMintProvider` vs the NEW push/write mint). Keep the milestone's
     non-vacuity discipline VERBATIM (synthesized `"\n"`-joined plants, real source asserted clean FIRST,
     each plant asserted to DIFFER from its clean baseline — the tree is CRLF).
  2. **CLONE-mint clause (the T9 invariant, unchanged, now seam-scoped): STILL FAIL any clone-path mint
     that is not EXACTLY single-repo `contents:read`** — the clone body deep-equals
     `{ repositories:[repo], permissions:{contents:"read"} }`. ADD a NEW negative plant: a clone-mint body
     carrying `contents: "write"` (or ANY write) MUST trip — the code-pin against attack (c), "the clone
     credential is never silently widened".
  3. **WRITE-mint clause (new): assert the write token is single-repo + minted ONLY at the push seam + no
     broader than `contents:write`(+`pull_requests:write`)** — its `access_tokens` body names a
     single-element `repositories`/`repository_ids` derived from the assigned repo (never omitted, never
     >1), and `permissions` is a subset of `{ contents: "write", pull_requests: "write" }` (auto-PR OFF ⇒
     EXACTLY `{ contents: "write" }`). Plants that MUST trip: OMIT `repositories` (all-repo WRITE — the
     worst case), multi-repo write, an ADDED `administration`/org-wide key, an OMITTED `permissions`. And
     the write mint's `access_tokens` call must live ONLY in the push-mint function — assert the clone
     provider's exported `mintCloneCredential` contains NO write body (the "minted only at push time,
     never on the clone path" seam pin). NEGATIVE control (stays clean): clone body =
     `{ repositories:[repo], permissions:{contents:"read"} }` AND push body =
     `{ repositories:[repo], permissions:{contents:"write"} }` (or `{contents:"write",pull_requests:"write"}`
     when auto-PR is in scope).
- **Residual.** None accepted for the request SHAPE of EITHER seam (structural, fitness-pinned across
  both). The server-side realisation (GitHub honours each request and issues nothing broader) stays
  bounded by the App's own least-privilege installation — but note the App must now be installed
  `contents:write` (+ `pull_requests:write` if auto-PR) for the target repos, a WIDER installation than
  story-02's read-only App, which the operator attests once (T8/R7 extended to the write grant).
- **Evidenced by.** The **story-07 ADR** (durable push-back — branch convention, push, PR, two-token vs
  one-token — the ADR chooses; §4.2 recommends two-token) + the REWRITTEN **F6**
  `acd-minted-token-scoped-single-repo` (two-seam detector, spec above) + the reused `GIT_ASKPASS`/F2
  handling on the write token + the T9 update above + the **operator attestation** of the App's
  now-`contents:write` installation scope (T8/R7 extended).

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
  **⇢ SUPERSEDED by R7 (story 02) for the GitHub path.** The `github-app` provider removes the need
  for a per-repo PAT AND a per-worker deploy key on any GitHub-hosted repo: the durable secret
  collapses to ONE App private key on the CONTROL node (R7/T8), not a key on every worker. R2's
  per-worker deploy-key concern survives ONLY as the documented fallback for a **non-GitHub** forge
  whose token API the control cannot reach (story scope keeps the provider pluggable); for the GitHub
  fleet it no longer applies.
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
- **R7 — Accepted / operator-attested: ONE App private key at rest on the control node (story 02;
  SUPERSEDES R2 for GitHub).** The `github-app` provider keeps a single, fleet-wide App private key
  at rest on the control node (T8). This IS a durable standing secret — the thing SPEC.md:65-66 named
  out of scope for a general vault — but it is the accepted, strictly-better trade: ONE key on ONE
  machine (the control node, which never relays it) replaces N per-repo PATs or per-worker deploy keys
  (R2). It is file-permission-protected (or an OS-keystore ref), never committed, never logged, never
  relayed (F5). Its blast radius on control-node compromise is bounded by the App's OWN least-privilege
  installation (`contents:read`, selected repos, no write — T8), which the operator attests once (the
  swap below). No worker/CI test can see the key's on-disk perms or the App's server-side installation
  scope → operator attestation. Managed rotation/storage of this one key defers to a future
  secrets-vault milestone IF the fleet grows to need it — named here, not built here.
- **R8 — Accepted: the minted installation token's ~1h validity window (T11).** Longer than the clone
  that consumes it, but the shortest GitHub offers for an installation token, single-repo/`contents:read`-scoped
  (T9), un-cached, and strictly better than the static PAT's unbounded life (T4). No code control can
  shorten it; accepted as the by-construction floor. Not a soak blocker — the token is dead within ~1h
  regardless of the operator.
- **R9 — OPEN (story 06, F17, GO-WITH-FIXES). The terminal-frame routing identity is NOT re-stamped
  control-side — a soak BLOCKER for the T14 read-only-mirror claim until the developer's one-line fix
  lands.** `mesh-launcher.mjs:719` pushes the raw self-declared frame (`onTerminalFrame: (frame) =>
  controlTerminalPush?.push(frame)`), so `mesh-terminal-mirror` routes by the worker's own `frame.nodeId`
  rather than the connection-bound `meta.nodeId` the control server computed. A malicious admitted worker can
  inject bytes onto another node's fleet card. This is NOT accepted — it is a fix owed by the developer
  (re-stamp: `(frame, { nodeId }) => controlTerminalPush?.push({ ...frame, nodeId })`), pinned RED-until-fixed
  by `acd-fleet-terminal-frame-connection-identity` (F8). Until it lands, the task-03 `@manual` soak's
  on-screen-secret inspection is itself spoofable (an attacker could inject a fake secret to fake a leak, or
  flood to mask a real one), so the soak's T14 inspection is only trustworthy AFTER F17 closes.

### What the OPERATOR must attest at `aof:verify` before the private-repo soak (R1/R4)

**Now ENFORCED IN CODE (CI-pinned — the human need NOT re-verify these; a regression fails CI):**
F15 (mint scoped to `existing.workspace_id`, mismatch refused), F16 (terminal assignments mint
nothing), and F14 (the clone resets the ambient `credential.helper` chain + sets
`GIT_TERMINAL_PROMPT=0` on both paths) — each fixed, re-verified at source by security (probe +
live-git), and pinned by `test/mesh-worker-clone-credential-pull.test.mjs` (behavioural) and the
strengthened security fitness `acd-worker-clone-no-credential-persisted` (structural, T7/F14
clause). These are no longer open review items. **⇢ Story-02 ADDS to this CI-pinned set:** with the
`github-app` provider selected, the minted token's **scope** (single-repo + `contents:read`) is
CI-pinned by `acd-minted-token-scoped-single-repo` (T9/F6) and its ~1h **TTL** is a GitHub property
(T11) — so the token's scope/TTL is **no longer an operator judgement**. The App private key's
no-relay/no-log posture is CI-pinned by `acd-clone-app-key-not-relayed` (T8/F5).

**Still requires the HUMAN to personally confirm before the soak (a test cannot assert these):**

1. **Minting policy (R4/T4/T8) — the human judgement, NARROWED by story 02's code-enforcement (THE
   SWAP).** WHICH provider is selected (`config.mesh.repo.credential.provider`) decides what remains
   human:
   - **`github-app` (story 02 — the closing path).** The token's **scope + TTL are NO LONGER
     attested** — they are code-enforced (single-repo + `contents:read` by
     `acd-minted-token-scoped-single-repo`/F6/T9; ~1h by GitHub construction/T11). **The ONE thing the
     operator NOW attests instead:** that the **GitHub App is installed least-privilege** —
     `contents:read`, on **SELECTED repositories only**, **no write / no org-wide scope** — and that
     its **private key is stored appropriately** (a file-permission-protected path or an OS-keystore
     ref on the control node, never in git). *This is a GitHub-console + control-node-filesystem fact
     no worker/CI test can see (T8) — the irreducible human residue, but a NARROWER, ONE-OFF
     attestation (per App, once) than R4's per-repo/per-soak token judgement it replaces.*
   - **`env-token` (retained bootstrap/dev default).** R4's original attestation STANDS unchanged: the
     operator confirms `AOF_MESH_CLONE_TOKEN` is a **fine-grained, read-only, single-repo** PAT and
     **accepts it is long-lived** (T4's "short-lived" unmet), rotating it on the soak's cadence. A
     broad/all-repo/all-scope PAT is NOT acceptable.
   **What moved from human to code (the swap, precisely):** the minted token's per-clone **single-repo
   scope + read-only permission + short TTL** — human at R4 for the static PAT, now code-enforced for
   `github-app` (F6 + GitHub construction). **What is newly human:** the **App's own installation
   least-privilege** + the **key-at-rest storage posture** — a server-side / on-disk fact tests cannot
   reach (T8). *No worker-side test can see either the server-side scope of a minted token OR the App's
   installation config — the human residue simply moved to the smaller, one-off surface.*
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
| F5 | `acd-clone-app-key-not-relayed` **(SPEC — story 02, armed at BUILD)** | **T8, T11** | The GitHub App **private key** (the PEM / configured key material) never (a) crosses the relay — it appears on NO frame builder (`buildCloneCredentialFrame` and every `sendDirective`/`ws.send` payload carry only the minted token, never the key), and (b) reaches no `console.*`/`logger.*`/`warn`/`onWarning`/`Error(...)` message sink. It flows ONLY into the JWT signer (`node:crypto` `createSign`/`sign`). EXTENDS F4 (the minted TOKEN) to the KEY (and to the mint-time App JWT, T11). | **Source-analysis** over the NEW `github-app` provider module + `src/control-stream-server.mjs`. Self-check (spec below). | SPEC — armed at build |
| F6 | `acd-minted-token-scoped-single-repo` **(SPEC — story 02, armed at BUILD)** | **T9, T4** | The `github-app` mint's installation-token request names EXACTLY the ONE assigned repo — a **single-element** `repositories`/`repository_ids` derived from the mint's `workspaceId` arg (never omitted, never >1) — and `permissions` EXACTLY `{ contents: "read" }` (never omitted, never `write`, never a broader set). The **code-enforcement that closes T4**. | **Source-analysis** over the NEW `github-app` provider module (the request-body shape at the `access_tokens` call). Self-check (spec below). | SPEC — armed at build |
| F8 | `acd-fleet-terminal-frame-connection-identity` **(NEW this review — T14 concern #2 + #1)** | **T14** | (a) The terminal-frame's routing `nodeId` is RE-STAMPED with the **connection-bound identity** (`meta.nodeId`) before the loopback push — accepts EITHER fix location (control-side `onTerminalFrame({ ...frame, nodeId }, …)` OR launcher-side `(frame, { nodeId }) => push({ ...frame, nodeId })`); trips when NEITHER re-stamps, so a worker cannot target another node's fleet card via a self-declared `frame.nodeId` (the T6 discipline the credential path keeps). (b) The LIVE fabric builder (`worker-stream-client.sendTerminalFrame` + the launcher `onOutputChunk` wiring) folds NO credential material into the streamed bytes — moving concern #1's structural pin off the retired `wireTerminalBridge` onto the real path. | **Source-analysis** over `src/mesh-launcher.mjs` + `src/control-stream-server.mjs` + `src/worker-stream-client.mjs`. Self-check: synthesized control/launcher shapes — a re-stamp (either side) is clean, the raw-push defect trips, a `frame.nodeId` regression on the control side trips; a `process.env` token folded into the live builder / `onOutputChunk` trips. | **(a) RED — pins finding F17 until the developer's one-line re-stamp lands; (b) GREEN — live path clean** |

**F5 + F6 are SPEC-only until story 02 builds — deliberately, per the milestone's hard lesson.**
The `github-app` provider module does not exist yet (story `not-started`); authoring a detector now
against absent source would produce a **vacuous** self-check (the plant would find nothing to trip and
the negative control nothing to stay clean). Security specifies the invariant + the exact plant
strategy here and arms the arch-test at build against the real module. Both self-checks follow the
milestone's non-vacuity discipline **verbatim** (the F2/F4 precedent): every plant is a SYNTHESIZED
snippet built with explicit `"\n"` joins (never a string-replace on the real file — the tree is CRLF,
and a `"\n"` needle would silently no-op against CRLF source and leave the self-check vacuous); the
real source is asserted clean under the detector first; and each plant asserts it **differs from its
clean baseline** before asserting `problems.length > 0`.

- **F5 `acd-clone-app-key-not-relayed` — plant strategy.** Detector = F4's `LOG_SINK` + `balancedArgs`
  scanner widened to a KEY needle (`privateKey`/`appPrivateKey`/`pem`/`PRIVATE KEY`), PLUS a
  frame/relay scanner (any object literal passed to `buildCloneCredentialFrame` / `sendDirective` /
  `ws.send` whose values reference the key needle). Plants that MUST trip: (1) `console.log("signing
  with " + privateKey)` and `logger.debug("app key", appPrivateKey)` (log sink); (2)
  `buildCloneCredentialFrame(to, { credential: privateKey })` and `ws.send(JSON.stringify({ key:
  privateKey }))` (key on a relayed frame); (3) `throw new Error("bad key: " + privateKey)` (key in an
  error message). NEGATIVE control that MUST stay clean: `createSign("RSA-SHA256").update(jwt).sign(
  privateKey)` — the key flowing ONLY into the signer — and `buildCloneCredentialFrame(to, {
  credential: mintedToken })` (the TOKEN on the frame is correct; only the KEY is forbidden).
- **F6 `acd-minted-token-scoped-single-repo` — plant strategy.** Detector parses the request body
  object passed to the installation `access_tokens` POST and asserts: a `repositories`/`repository_ids`
  key is PRESENT, holds a SINGLE element, and that element is sourced from the mint's repo/workspace
  argument (not a literal multi-element array, not absent); AND `permissions` deep-equals `{ contents:
  "read" }`. Plants that MUST trip: (1) OMIT `repositories`/`repository_ids` (→ all installation
  repos); (2) `repositories: [repoA, repoB]` (multi-repo); (3) `permissions: { contents: "write" }`;
  (4) `permissions: { contents: "read", administration: "read" }` (broader set); (5) OMIT `permissions`
  (→ the installation's full scope). NEGATIVE control that MUST stay clean: `{ repositories: [repo],
  permissions: { contents: "read" } }` (single-repo, read-only). **⇢ Story-07 REWRITES this into a
  TWO-SEAM detector** — the clone mint stays exactly single-repo `contents:read` (with a NEW plant that
  a `contents:write` on the CLONE body trips it), and a SEPARATE push mint is asserted single-repo +
  no broader than `contents:write`(+`pull_requests:write`) + present ONLY at the push seam. The exact
  direction is in **T15**; armed at build against the real push-mint module, never here.
- **F7 (config-driven, NOT security-owned — noted for the seam).** `acd-clone-credential-provider-config-driven`
  (story fitness unit 1) is **architect/developer-owned**: the mint provider is resolved from
  `config.mesh.repo.credential.provider` at the `mintCloneCredential` seam, no hard-coded single
  provider, and the `env-token` default path is byte-unchanged. Security REFERENCES it (it backstops
  T10 — a `github-app` selection cannot silently degrade to an `env-token` mint) but does not own it;
  the architect wires the seam, the developer arms the test.

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
threat→control map and the fitness functions F1–F6 above (F4 added at story-01 review; **F5/F6
specified for story 02, armed at build**). Where a fitness function names an invariant an ADR
must satisfy (T5 scoped target, T1/T2/T3 credential handling, **T8 key-not-relayed, T9
single-repo mint**), that is the coordination point — the ADR states the decision, the fitness
function fails CI if the implementation drifts. R1/R3/R5/R6/**R8** residuals are **operator
sign-off / accepted** at `aof:verify` — no test asserts a server-side or accepted risk.

**Story-02 division of ownership (the mint-source swap).** The **architect** owns the provider
abstraction at the `mintCloneCredential` seam (ADR to be written — the `env-token` | `github-app`
selector, config-driven) and the `github-app` provider's structure (JWT sign → installation-token
exchange). The **developer** builds the provider and arms `acd-clone-credential-provider-config-driven`
(F7 — config-driven selection, `env-token` default unchanged). **Security** owns T8–T11 above and the
two security fitness functions F5 (`acd-clone-app-key-not-relayed`) + F6
(`acd-minted-token-scoped-single-repo`) — the code-enforcement that closes T4's minting-policy
residual. **The attestation SWAP** (T4/R4 → T8): the token's scope/TTL moves from human sign-off to
CI (F6 + GitHub construction); the App's installation least-privilege + key-at-rest storage becomes
the new, narrower, one-off operator attestation (R7/T8, checklist item 1). **Cross-story dependency —
`x-access-token` (T11).** If the researcher confirms the askpass shim must send username
`x-access-token` for an App installation token, that is a credential-handling change to story 01's
shim (F2's surface); the architect reconciles the shape. Security flags it, does not decide it.

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
