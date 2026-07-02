---
doc: verification
milestone: 24
updated: 2026-07-02
---
<!--
  Milestone VERIFICATION.md — the record of WHAT was checked and WHAT was found.
  Written by aof:verify. Pointers + evidence, never restatements. Sections with no
  content are omitted (absence is information). No @uat scenarios in this milestone,
  so there is no `## User sign-off`; no UI surface (mesh ui is m25), so no
  design-conformance section.
-->
# 24 · Device-Code Group Enrollment — Verification

## Automated + fitness evidence

- **m24's full `@executable` suite + all six m24 fitness functions + the m23 guard gates: green.**
  `node ./scripts/test.mjs` (this verify session, `2026-07-02`) → **1782 ok / 0 not ok** (exit 0). No
  reds anywhere — the six RED-until-built m24 gates that were correctly failing on an upstream milestone's
  re-verify (see `23/VERIFICATION.md §Automated`) all turned GREEN when stories 00/01/02 landed, and no m23
  behavioural test or guard gate regressed.
- The **six m24 fitness functions**, each green + non-vacuous:
  - `arch/registry-write-scope` (ARCHITECTURE fitness, ADR-001) — the registry mechanic references zero
    record-doc filename and every registry write joins the `registryPath`/`registryDir`/`meshDir` partition
    seam through the atomic `writeText`; the write is SINGLE-WRITER (guarded by the control-node predicate,
    never unconditional); NO other `src/**.mjs` writes the registry subtree (exactly one write owner,
    `src/mesh-registry.mjs`) — the `22/ADR-002` no-aggregate-roster tension resolved by single-writer.
  - `arch/enroll-endpoint-http-not-ws` (ARCHITECTURE fitness, ADR-002) — the ws envelope stays
    payload-agnostic (`parseEnvelope` / the wss message handler branch on NO enrollment `kind`); the
    enrollment surface, when present, lives in the `http.createServer` request handler (an HTTP route), not
    the ws message path.
  - `arch/enroll-git-argv-no-shell` (ARCHITECTURE fitness, ADR-003/004) — every `git` spawn in the
    enrollment path (`mesh-join` + `mesh-revoke`) is the shell-less `spawnSync("git", [ … ])` argv form (no
    shell string, no `exec(`); the path makes no git WRITE verb against a foreign source tree (it configures
    the joining/control node's OWN clone — remote add/remove, the read-only-source discipline).
  - `arch/enrollment-code-hashed-at-rest` (SECURITY fitness, T3) — the enrollment/registry surface hashes
    the device code via `node:crypto` before the durable write; no enrollment-surface module persists a bare
    plaintext-code field (`code:`/`deviceCode:`/`plaintext:`) — the durable invite carries a hash, never the
    raw code.
  - `arch/enrollment-code-single-use-constant-time` (SECURITY fitness, T2/T4) — the code match uses a
    CONSTANT-TIME compare (`crypto.timingSafeEqual`, not a raw `===` on the `codeHash` — no timing oracle on
    the 10^6 space); the match/admit path CONSUMES the invite (single-use burn — a matched code cannot be
    replayed).
  - `arch/relay-auth-gate-checked` (SECURITY fitness, T1/T6) — the relay's upgrade admission calls a
    credential-verify seam AND rejects on failure (a connection without a valid credential is denied — the
    pre-auth→authenticated transition, the `22/R6` "the credential is actually used" guard); the auth
    decision consults the LIVE revocation/roster state (a revoked credential is rejected — revocation
    completeness, T6).
- The **m23 guard gates held** (the additive co-touch did not regress them): `arch/relay-stateless` (the
  relay imports no record schema for persistence, performs no durable write, imports no fs persistence seam —
  the auth-gate is a READ, not a persist), `arch/relay-envelope-neutral` (the relay never branches on a
  signal's content and frames a bad input as the frozen `{ type:'error' }` control-frame), and
  `arch/mesh-bijection` (every registered `mesh:*` — now incl. `mesh:invite` / `mesh:join` / `mesh:revoke` —
  carries a non-null cli adapter with a reachable dispatch branch; `--json` parses for each). The
  behavioural companion `mesh-relay-auth-gate/00` re-confirms the auth-gate persists nothing (the workspace
  is byte-unchanged across both a rejected and an accepted group upgrade).

Environment for the `@manual` runs below: node v22.22.2, ws 8.21.0, git 2.47.0.windows.1, win32.

## Verification evidence

Fixtures: isolated bare-remote git fleets + an **in-process** `serveRelay` under the session scratchpad,
driving the REAL production modules (`src/mesh-registry.mjs`, `src/mesh-sync.mjs`, `src/mesh-relay.mjs`,
`src/commands/mesh-invite.mjs` / `mesh-join.mjs` / `mesh-revoke.mjs`) — the same fixture patterns the
`@executable` suite uses. Mesh mutations driven through the registered commands (`invoke(...)` / the
`serveRelay` `/enroll` route); `.mesh/` and config never hand-edited on the read-back side. The clock is
INJECTED where a TTL is exercised (the `22/R2` discipline). `.gitattributes` carries `**/.mesh/** text
eol=lf`. Three independent agent runs this session, one per feature; no production defect surfaced on any run.

### `@manual` 24/00/03 — the group registry over git, no relay — PASS (all four scenarios)
`verifies →` `stories/00_story_group-registry/tasks/03_registry-over-git.feature`
(the SPEC §7.3 "two levels of git-of-record" acceptance — the registry is a real durable git stream a peer
reads over git ALONE).

**Procedure (agent-run).** A bare remote + a `control` clone + a `peer` clone (both with `core.autocrlf=true`
to STRESS the EOL pin, and the repo's real `**/.mesh/** text eol=lf` pin reproduced in the fixture). No relay
imported or started (the git-only floor). Control admits `node-a` (+ board `board-x`), `writeRegistry`, then
the REAL `mesh-sync` engine stages/commits/pushes; the peer pulls and `readRegistry`.

**Result — all four PASS:**
- *Roster/boards over git* — the peer's baseline clone (pre-write) has **no** registry, so it could only
  arrive by a later pull; after `control push → peer pull` (`pulled:["…/registry/group.json"]`, a genuine
  over-the-wire pull), the peer reads `roster:[{nodeId:"node-a", admittedAt, boards:["board-x"]}]` and
  `boards:["board-x"]`. No relay used (structural — no relay module imported; causal — the registry reached
  the peer solely through the git pull).
- *Zero-engine-change sync* — the registry landed under the peer's `meshDir/registry/`; `src/mesh-sync.mjs`
  has NO `/registry/` reference and NO `mesh-registry` import — it stages the generic `git add -- <meshDir>`
  and moved a record type it has never seen as bytes (`22/ADR-004` re-confirmed end-to-end).
- *Byte-identity, subject to the EOL pin* — control 509 bytes ≡ peer 509 bytes (`Buffer.compare == 0`),
  pure-LF on both despite `autocrlf=true`; all four lists (roster/boards/pending/revocations) read equal. A
  control experiment proved the pin is **load-bearing**: with `autocrlf=true` and the pin REMOVED, git
  rewrote the checked-out registry to CRLF (byte-identity would break); with the real pin in place it stayed
  LF — byte-identity holds *because of* `22/R5`.
- *Single-writer add-only* — the peer wrote only its OWN per-node record (pushed only `nodes/peer-node.json`,
  never `registry/`); after the control's registry revision-2 pull, `git diff --diff-filter=U` is empty (no
  unmerged paths, no conflict markers), the peer's own record is byte-unchanged, and the registry matches the
  control's latest — the peer never three-way-merges the registry (`22/ADR-002` tension resolved).

### `@manual` 24/01/03 — single-code join end-to-end (KR6) + the R-1/R-3 residual-risk pen-tests — PASS + residuals recorded
`verifies →` `stories/01_story_device-code-enrollment/tasks/03_join-end-to-end.feature`
(the SPEC §Objective outsider-verifiable headline: one 6-digit code admits a fresh machine, no manual key
copying — the KR6 single-code half; the OS-matrix half is the cross-milestone UAT, not this task).

**Procedure (agent-run).** An in-process `serveRelay` control node over its own registry workspace (with an
`enrollment.gitRemote` grant); the operator runs the real `mesh:invite`; a SEPARATE fresh-machine workspace
(own `git init` repo, `mesh.nodeId` set, `mesh.relay.url` → the relay, **no** credential) runs the real
`mesh:join` with ONLY the minted code. Clock injected for TTL determinism.

**Result:**
- *KR6 headline — PASS.* `mesh:invite` minted `129127`; the durable pending record holds `codeHash`
  (`2c267fd9…`) ONLY — the registry serialization does not contain the plaintext. `mesh:join <code>` admitted
  the node (`roster += {nodeId:"fresh-machine-x", admittedAt, boards:[], relayAuthHash:"de5497ec…"}` — the
  roster carries the token HASH, never the token), stored `config.mesh.credential = {relayAuth:<64 hex>,
  nodeId, gitRemote:{url,name}}` (merge preserved `mesh.nodeId`/`mesh.salt`/`mesh.relay.url`), and configured
  the git remote (`git remote -v` shows `aof-mesh → https://git.example.test/group.git`, fetch+push). The
  ONLY value transported by hand was the 6-digit code; the `relayAuth` token was minted server-side and
  delivered in the join response — never copied. Both R4 halves pinned (only the code by hand AND the machine
  fully provisioned).
- *R-1 credential-at-rest pen-test — RECORDED RESIDUAL (accepted, not mitigated).* The credential lives at
  `config.mesh.credential` in the joined node's own `.aof/aof.config.json`; `relayAuth` sits in **cleartext**
  (not hashed, not encrypted). A separate co-located `node -e` process with no privilege read the identical
  token (exit 0); `icacls` shows the file inherits the standard user/SYSTEM/Administrators ACL — no
  file-level secret isolation. This is the documented v1 shared-remote blast-radius residual **R-1**
  (per-node credential scoping is Phase-5+; `SECURITY.md §Residual risk R-1` / T5). Recorded as evidence, not
  a defect.
- *R-3 code-in-flight pen-test — RECORDED RESIDUAL (accepted, not mitigated).* The transport is `ws://` →
  `deriveEndpoint` yields `http://` (no TLS). A loopback wire-tap captured the real `mesh:join` request:
  `POST /enroll` … `{"code":"139902","nodeId":"fresh-machine-x"}` — the 6-digit code in cleartext, no TLS
  handshake. The captured code's value is BOUNDED, confirmed against the real endpoint: replay of the
  consumed code → `409 consumed`; a code presented +360s past the 300s TTL → `410 expired`; seven wrong codes
  from one source → attempts 1–5 `404 no-match`, 6–7 **`429 attempt-cap`**. This is the documented v1 in-flight
  residual **R-3** (transport encryption / longer-code operator knob is Phase-5+; `SECURITY.md §Residual risk
  R-3` / T2/T4). Recorded as evidence, not a defect.

### `@manual` 24/02/02 — revocation completeness (T6): relay + git-remote both revoked — PASS (relay + local de-provision) + real-remote-push residual recorded
`verifies →` `stories/02_story_trust-boundary-enforcement/tasks/02_revocation-completeness.feature`
(the SECURITY T6 acceptance: a revocation must not half-apply — a revoked node loses relay access AND
git-remote access together).

**Procedure (agent-run).** A control-node `serveRelay` (`isGroupConnection: () => true` so a loopback ws
counts as a group connection) with a roster seeded with `node-x` + `node-y` (each a real `relayAuthHash`); the
control clone provisioned with `node-x-remote` / `node-y-remote` / `origin` (`node-x-remote`'s url carries a
space, to prove the argv de-provision does not word-split). ws-connect both nodes → `mesh:revoke node-x`
(real command) → re-connect both + inspect `git remote -v` + the live registry.

**Result:**
- *Relay half — PASS (live, no restart).* Before revoke: `node-x` admitted (`joined`, 10ms), `node-y`
  admitted (`joined`, 5ms). `mesh:revoke node-x` → `revoked:true`, live registry `roster has node-x:false`,
  `revocation for node-x:true`. After revoke, on the SAME running relay reading the LIVE revocation list:
  `node-x` **rejected** (`error`, **2ms** — a prompt `socket.destroy()`, `reason != "timeout"`), `node-y`
  still admitted (`joined`, 2ms). The `22/R6` loop closes live — the token admitted before revoke is rejected
  after, no relay restart.
- *git-remote half (local de-provision) — PASS (targeted + complete).* `git remote -v` before →
  `node-x-remote`, `node-y-remote`, `origin`; after `mesh:revoke` → `node-y-remote` + `origin` only,
  `node-x-remote` GONE (argv-form `git remote remove`, the space-in-url proving no word-split). Targeted: the
  unaffected `node-y-remote` and `origin` preserved. Both halves gone together — no half-applied revocation.
- *Real-remote push-refusal-by-credential — RECORDED RESIDUAL (@manual-by-nature).* The `Then` line "the
  real remote REFUSES the push" needs a live auth-enforcing git host and is NOT honestly provable by an
  in-process fixture: the agent stood a local bare-file remote and pushed to it — status 0, NO credential
  check (`localBareRemoteEnforcesAuth:false`), so a bare remote structurally cannot refuse a push by
  credential. This half remains to confirm **out-of-band** on a real host (after `mesh:revoke node-x`, a
  push presenting node-x's revoked credential to the group git-of-record is refused with a host-side
  403/denied while node-y still pushes) — exactly the feature's own QA feasibility flag and `SECURITY.md`'s
  `@manual git-remote-deprovision` routing. The relay half of T6 is covered by the fitness gate +
  behavioural suite; only the real-host push-auth observation is deferred out-of-band.

## Findings

No **defect or gap** surfaced in either the automated or the `@manual` lane — every `@executable` scenario,
all six m24 fitness functions, and every agent-run `@manual` scenario passed on the reachable surface, on
three independent runs, with no production change. **No blocker and no non-blocker finding is open.**

Three items are RECORDED (as accepted residual risk / an out-of-band confirmation), NOT logged as findings —
they are the honest-boundary records the `@manual` features are designed to capture, already decided in
`SECURITY.md`, not newly-discovered gaps:

| id | recorded | type | disposition |
|----|----------|------|-------------|
| R-1 | Credential at rest is cleartext at `config.mesh.credential`; a co-located process reads it (no per-node scoping). | accepted residual (SECURITY T5) | v1 trusted-operator — per-node scoping is Phase-5+. Recorded in §Verification evidence 24/01/03. |
| R-3 | The 6-digit code is observable in cleartext HTTP in flight; its value is bounded by TTL + single-use + attempt-cap. | accepted residual (SECURITY T2/T4) | v1 trusted-operator — transport TLS / longer-code knob is Phase-5+. Recorded in §Verification evidence 24/01/03. |
| T6-remote | The "real remote refuses a revoked credential's push" half is not reachable by an in-process fixture (a local bare remote has no auth layer). | out-of-band confirmation | @manual-by-nature — confirm on a live auth-enforcing host. The relay half + local de-provision are verified green. Recorded in §Verification evidence 24/02/02. |

## Accept decision

**ACCEPTED — `2026-07-02` by `aof:verify 24`.** The milestone's load-bearing objective is delivered and
verified: a fresh machine joins the fleet by entering a single 6-digit code (no manual credential copying),
is admitted to the group roster, and is issued a working mesh credential (relay auth + stream identity +
git-remote grant) — proven end-to-end over a real `/enroll` endpoint + a real git remote (24/01/03, KR6). The
group registry is a real durable second git-of-record a peer reads purely over git, single-writer add-only,
byte-identical under the EOL pin (24/00/03). The trust boundary is enforced and revocable: the relay
auth-gate rejects an absent/invalid/revoked credential reading the live roster/revocation, and `mesh:revoke`
removes relay + local git-remote access together (24/02/02) — the `22/R6` "the credential is actually used"
loop, and the `23/ADR-001` pre-auth deferral, both paid.

m24's full `@executable` suite + all six m24 fitness functions are green (**1782 ok / 0 not ok**); the three
m23 guard gates (`relay-stateless`, `relay-envelope-neutral`, `mesh-bijection`) held under the additive
co-touch. `aof work validate` → PASS (0 findings). No blocker and no non-blocker finding is open; the three
recorded residuals (R-1, R-3, the T6 real-host push half) are accepted v1 residual risks / an out-of-band
confirmation, each already a decided `SECURITY.md` boundary, not a gap.

All three stories were verified this session and set `done` — 00 (the group registry, structural review
CONFORMS), 01 (device-code enrollment, behavioural review CONFORMS), 02 (the enforceable trust boundary,
behavioural + structural review CONFORMS) — so the milestone is accepted. Accepting m24 **unblocks** m25
(`aof mesh ui` renders the registry this milestone authored).
