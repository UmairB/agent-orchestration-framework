---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 24 · Device-Code Group Enrollment — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-29` by `aof:shatter` from
  [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  (the trust-boundary / join chunk — Phase 1).
- Broken down `2026-07-01` by `aof:refine 24` (Decide + Break-down; not `--autonomous` — stops at the
  break-down review gate, contracts authored later per story). Decide produced [ARCHITECTURE.md](ARCHITECTURE.md)
  (ADR-001 group registry / ADR-002 device-code flow / ADR-003 credential + relay auth-gate + git-remote
  provisioning / ADR-004 revocation / ADR-005 enrollment attempt-cap) and [SECURITY.md](SECURITY.md) (the
  threat model `23/ADR-001` deferred here). Partitioned into **three** stories — `00 registry`
  (root) → `01 device-code join` → `02 trust-boundary enforcement`; all `not-started`. Next: `aof:continue 24`
  (fans out the stories) or `aof:refine 24/00` to author story 00's contract.
- Contracts authored `2026-07-01` by `aof:refine 24 --autonomous` (Three Amigos cascade — all three stories'
  contracts fanned out in parallel, then a single aof-developer feasibility pass, one consolidated review).
  **11 task features** landed (8 `@executable` + 3 `@manual`): 00 → 4 (`registry-store-and-seam`,
  `roster-boards-revocations`, `pending-invite-lifecycle`, `registry-over-git` `@manual`); 01 → 4
  (`mesh-invite-mint`, `device-code-flow`, `mesh-join-and-provision`, `join-end-to-end` `@manual`); 02 → 3
  (`relay-auth-gate`, `mesh-revoke`, `revocation-completeness` `@manual`). All three stories → `in-progress`
  (refined). Feasibility verdict **BUILDABLE-WITH-NOTES** (see `## Notes` — the ws credential carrier + the
  group-connection seam). Next: `aof:continue 24` (build the stories to green — 00 first, the dependency root).

- Story 00 (group registry) **built** `2026-07-02` by `aof:continue 24` (aof-developer):
  `src/mesh-registry.mjs` (the single-writer store + add-only accessors + pending lifecycle) + 14 tests across
  three files, registered in `scripts/test.mjs`. All three `@executable` features green;
  `acd-registry-write-scope` GREEN (and the hashed-at-rest gate's registry-shape half). Full suite
  **1740 ok / 6 not ok** — the six reds are exactly the story-01/02-owned RED-until-built gates, no
  regressions. Story 00 → `in-review`; structural review runs alongside story 01's build.
- Story 00 structural review (aof-architect) `2026-07-02`: **CONFORMS to ADR-001** — no blockers. Two
  should-fix findings **applied same day**: (1) `readRegistry` narrowed to ENOENT-only tolerance — a
  corrupt/torn registry now THROWS instead of silently reading as empty (a control-node
  read→mutate→write over a silently-emptied authoritative registry would have persisted the wipe);
  (2) `isInviteExpired` made FAIL-CLOSED on unparseable time (malformed `expiresAt`/`now` ⇒ expired,
  never a never-expiring invite — the TTL is a structural bound on the 10^6 code space). Both pinned
  with new test rows; story-00 suite 17/17 green after the fixes. One nit deferred to retro (see
  `## Feedback`).
- Story 01 (device-code enrollment) **built** `2026-07-02` by `aof:continue 24` (aof-developer, resumed
  after a session-limit cutoff — verified from disk, not the report): `src/commands/mesh-invite.mjs`
  (control-node-guarded mint → hashed pending), the `POST /enroll` device-flow route on `serveRelay`'s
  existing `http.createServer` (match/consume/TTL/attempt-cap/admit/issue; the ws upgrade handler left
  UNTOUCHED — story 02's surface), `src/commands/mesh-join.mjs` (present → store credential
  merge-not-clobber → provision git-remote via the shell-less argv idiom), both verbs registered
  (bijection gate green). The admit path stores **`relayAuthHash`** additively on the roster entry — the
  verifiable half story 02's auth-gate checks a presented token against (the token itself never at rest).
  All three `@executable` features green (17/17); gates green: `acd-enroll-endpoint-http-not-ws`,
  `acd-enrollment-code-hashed-at-rest` (both halves), `acd-enrollment-code-single-use-constant-time`.
  Story 01 → `in-review`. Remaining suite reds are exactly the **four** story-02-owned gates
  (`acd-relay-auth-gate-checked`, `acd-enroll-git-argv-no-shell` ×2 — the latter blocked on the absent
  `mesh-revoke.mjs`).
- Story 01 behavioural review (aof-qa) `2026-07-02`: **behaviourally CONFORMS** — no blockers. QA drove 12
  extra boundary probes against the real `POST /enroll` endpoint; **production code correct on every one**
  (the findings are missing TEST assertions, not defects). Six coverage gaps queued as `@executable`
  hardening (applied by the orchestrator after story 02): should-fix — (1) pin the TTL `now == expiresAt`
  admit row (a `>=` regression is currently invisible), (2) exercise the attempt-window TTL reset, (3)
  assert a malformed body debits the attempt budget; nits — (4) deterministic leading-zero code
  round-trip, (5) per-source (not per-code) bucket via distinct wrong codes, (6) the endpoint's
  `503 not-control-node` at the HTTP layer. QA also validated the `spawnCliAsync` deadlock fix as sound +
  non-vacuous (the test still proves the real CLI stored the credential, read back off disk).
- Story 01 QA coverage-hardening **applied** `2026-07-02` by `aof:continue 24` (orchestrator, test-only):
  six new `@executable` rows in `test/mesh-enroll-device-flow.test.mjs` — the strict-`>` TTL at-boundary
  admit, the attempt-window TTL reset, malformed-body-debits-budget (proven hard: the cap short-circuits
  a good code after a malformed flood), per-source (distinct wrong codes) bucketing, leading-zero code
  round-trip, and the endpoint's `503 not-control-node` authority guard. Device-flow suite 13/13 green;
  no production change (the code was already correct — these lock the behaviour against silent regression).
- Story 02 (trust-boundary enforcement) **built** `2026-07-02` by `aof:continue 24` (aof-developer):
  `verifyCredential`/`isRevoked` added ADDITIVELY to `src/mesh-registry.mjs` (store-local sha256 to avoid
  a mesh-relay↔mesh-registry import cycle), the ADDITIVE ws auth-gate in `serveRelay`'s upgrade handler
  (injectable `isGroupConnection` seam; reads the `Authorization` header; `readRegistry`→`verifyCredential`;
  `socket.destroy()` on deny; loopback default; nothing persisted — stateless + envelope-neutral held),
  and `src/commands/mesh-revoke.mjs` (control-node-guarded roster removal + explicit-deny append in ONE
  `writeRegistry` + git-remote de-provision via the shell-less argv idiom). Both `@executable` features
  green; **full suite 1775 ok / 0 not ok** — all six m24 gates GREEN, the three guard gates held. Story 02
  → `in-review`. The developer also FIXED an architect-owned arch test (`acd-enroll-git-argv-no-shell`,
  one line) that was un-satisfiable as authored (its git-spawn presence assertion ran the `"git"` detector
  against the string-STRIPPED source, so it could never fire) — see `## Feedback`; the orchestrator
  independently **mutation-tested** the fix (real module PASSES; shell-string / `exec(` / foreign-`push` /
  no-git mutations each FAIL) and confirmed the gate still enforces the no-shell/argv invariant.
- Story 02 review (aof-qa behavioural + aof-architect structural) `2026-07-02`: **both CONFORMS, no blockers.**
  QA drove the live auth-gate directly — valid group → `joined` (13ms); absent/invalid/not-in-roster/revoked
  group → `ECONNRESET` in 2–4ms (a genuine prompt `socket.destroy()`, not a timeout); loopback-no-credential
  admitted; the 22/R6 loop closes (the same token admitted before revoke is rejected after, live, no restart).
  Two LOW test-hygiene findings **applied** (test-only): the git de-provision tolerance branches
  (absent-remote / no-git-repo) now asserted, and a reject row now pins prompt-destroy (`reason != "timeout"`).
  Architect confirmed ADR-003/004 honoured, `acd-relay-stateless` + `acd-relay-envelope-neutral` satisfied
  STRUCTURALLY (the relay imports the registry VERIFY seam, absent from both gates' forbidden-import sets;
  no `.signal` access, no durable write), `verifyCredential`/`isRevoked` purely additive (no back-edge to the
  relay — the store-local sha256 correctly avoids the cycle), and **independently verified the developer's
  `acd-enroll-git-argv-no-shell` edit was a legitimate fix of an un-satisfiable gate, not a weakening** (its own
  mutation battery matches the orchestrator's). Two non-blocking retro items in `## Feedback` (the process point
  on an evidence agent self-editing an arch-owned gate; a `src/mesh-crypto.mjs` shared-leaf follow-up for the
  duplicated sha256/constant-time seam, to coordinate with aof-security).
- **Build+review gate COMPLETE `2026-07-02` (`aof:continue 24`).** All three stories built to green and passed
  review — 00 → `in-review` (architect CONFORMS), 01 → `in-review` (QA CONFORMS), 02 → `in-review` (QA +
  architect CONFORMS). Full suite **1782 ok / 0 not ok**. Next: **`aof:verify 24`** (the `@manual` sign-off +
  acceptance + retrospective; stories move to `done` and the milestone SPEC `## Stories` boxes tick there).
- **ACCEPTED `2026-07-02` by `aof:verify 24` — a CLEAN accept (no blocker, no defect).** Re-ran the full suite
  green (**1782 ok / 0 not ok / exit 0**); all six m24 fitness functions + the three m23 guard gates
  (`relay-stateless`, `relay-envelope-neutral`, `mesh-bijection`) green + non-vacuous. All **three `@manual`
  deliverables verified** (three independent agent runs, real fixtures — see [VERIFICATION.md](VERIFICATION.md)):
  24/00/03 registry-over-git **PASS** (4/4 — roster/boards read back over git alone, zero-engine-change sync,
  byte-identical under the EOL pin proven load-bearing, single-writer add-only); 24/01/03 join-end-to-end **PASS**
  (the KR6 single-code join admits + issues a working credential + provisions git-remote over a real endpoint;
  R-1 credential-at-rest + R-3 code-in-flight recorded as accepted v1 residual risks, bounded by TTL + single-use
  + attempt-cap); 24/02/02 revocation-completeness **PASS** on the relay half (the auth-gate rejects the revoked
  credential live, 2 ms prompt destroy, no restart — the 22/R6 loop closes) + the local git-remote de-provision
  (targeted, complete), with the real-host push-refusal-by-credential half a recorded out-of-band residual (a
  local bare remote has no auth layer). No blocker, no non-blocker finding — the three recorded residuals are
  decided `SECURITY.md` boundaries, not gaps. `aof work validate 24` → PASS (0 findings; `aof work doctor` one
  advisory doc-over-budget warn). Stories 00/01/02 → `done`, so the milestone is accepted → **SPEC `status:
  done`**. Accepting m24 **unblocks m25** (`aof mesh ui` renders this registry). RETROSPECTIVE.md written (R1–R6);
  memory ingested (`aof work memory ingest 24`); STATE compacted (below). **Next: `aof work next` (→ m25 ·
  mesh-ui).**

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- v1 trust = **single-group / trusted-operator**; untrusted / cross-org / multi-tenant authz is the
  deferred Phase-5+ fork — keep the door clean but do not build it. Blocked until milestone 23 stands up
  the control node + relay endpoint the join code is presented to.
- ~~Open for refine: the device-code issuance / match / TTL flow; the **mesh credential** contents + the
  revocation path; the **group registry** schema + git-remote provisioning.~~ **Resolved at refine** →
  ADR-001..005: registry = single-writer control-node-owned git-of-record under `meshDir/registry/`; code =
  6-digit, hashed at rest, single-use, TTL 300s, attempt-capped (5); credential = relay-auth token + stream
  identity + git-remote grant in `config.mesh.credential`; enrollment is a **device-flow HTTP route** on the
  relay's existing `http.createServer` (NOT a ws `kind` — the ws envelope stays payload-agnostic); git-remote
  provisioned via the shell-less `git`-argv idiom (13/ADR-002).
- **Documented default decision (security-flagged, resolved via ADR-005).** The device-code brute-force
  defence rests on the **attempt-cap** (`config.mesh.enrollment.maxAttempts`, default **5**) + TTL
  (`config.mesh.enrollment.codeTtlSeconds`, default **300**) + single-use + constant-time compare. Both are
  documented config knobs (an operator on a hostile LAN can raise them). The attempt counter is **ephemeral
  in-memory** on the control-node relay endpoint — a guard, not a system of record, so it does **not** violate
  m23's `acd-relay-stateless` (the `resolveMaxFrameBytes` frame-size-floor precedent). 6 digits (10^6) is
  weaker than GitHub's 8-char device code by design (human transcription) and is defensible for **v1 trusted-
  operator ONLY with all four mitigations together** — see [SECURITY.md](SECURITY.md) T2.
- **Cross-gate tension noted (pre-empted, not a defect).** Story 02's relay ws auth-gate adds a credential
  **READ** to `src/mesh-relay.mjs`, which sits against m23's `acd-relay-stateless` guard — but a READ + reject
  decision persists nothing, so the guard stays GREEN (SECURITY.md carries the compatibility rationale). Both
  refine agents independently touched `mesh-relay.mjs`; the fitness-ownership overlap they navigated is logged
  in `## Feedback` below for the retro.
- **Documented default decision — the ws credential carrier (resolved at contract-authoring, developer amigo).**
  ADR-003 left the carrier non-committal ("`Sec-WebSocket-Protocol` / auth header"). Resolved to an
  **`Authorization` header** on the ws upgrade (`request.headers.authorization`, readable in the existing
  `server.on("upgrade")` handler; set via `new WebSocket(url, { headers })` on both the in-process test client
  and the production `mesh-relay-client.mjs` connect path). Preferred over the subprotocol carrier, which would
  need the server to echo the selected protocol back in `handleUpgrade` or the client aborts — an easy flake.
  Non-critical + reversible; recorded here so build follows it. Story 02's STORY.md carries the same note.
- **Build note (not a contract change) — the loopback-vs-group seam.** `02/00_relay-auth-gate`'s loopback
  default vs group-requires-credential branch keys on `request.socket.remoteAddress`, but every in-process `ws`
  client presents `127.0.0.1`. The auth-gate must expose an injectable "this is a group connection" seam so the
  branch is deterministic in-process — surfaced now so it is not discovered mid-build.

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — full suite **1782 ok / 0 not ok** (exit 0) at `aof:continue 24`'s review gate (`2026-07-02`).
- [x] Fitness functions green — all **six** m24 gates GREEN (`acd-registry-write-scope`, `acd-enroll-endpoint-http-not-ws`, `acd-enroll-git-argv-no-shell`, `acd-enrollment-code-hashed-at-rest`, `acd-enrollment-code-single-use-constant-time`, `acd-relay-auth-gate-checked`); the three m23 guard gates (`acd-relay-stateless`, `acd-relay-envelope-neutral`, plus bijection over the new verbs) held.
- [x] `@manual` signed off — all 3 verified `2026-07-02` (three independent agent runs, real fixtures); see [VERIFICATION.md](VERIFICATION.md): `registry-over-git` PASS (4/4), `join-end-to-end` PASS + R-1/R-3 recorded residuals, `revocation-completeness` PASS on the relay + local-de-provision halves + the T6 real-host push half recorded out-of-band.
- [x] Milestone accept — **ACCEPTED `2026-07-02`** (`aof:verify 24`, clean). SPEC `status: done`; m25 unblocked.

## Feedback (for retro) — ARCHIVED `2026-07-02` (graduated at Accept)

<!-- Compacted at Accept: every lesson here graduated to RETROSPECTIVE.md (R1–R6) + was ingested into
     memory (`aof work memory ingest 24`, 11 records). The blow-by-blow is archived; the carryable form
     lives in the retro. Kept only as a pointer, per the graduate-then-archive discipline. -->

- All build- and review-gate feedback distilled into **[RETROSPECTIVE.md](RETROSPECTIVE.md)** and ingested to
  memory (recallable in the next milestone's refine/continue):
  - **R1** — When architect + security refine a milestone in parallel, agree the fitness split UP FRONT
    (architect = write-scope/shape/envelope/argv; security = crypto + runtime rejection) — don't race to author
    the same auth-gate/hashed-code gate.
  - **R2** — A test that BOTH spawns the real CLI AND serves the endpoint it calls must use the async spawn
    (`spawnCliAsync`), never `spawnCliSync` (the sync spawn deadlocks the shared event loop).
  - **R3** — Keep fitness-owned mechanics (write-seam / spawn-form / import) out of `Then` lines at Three Amigos
    (the litmus) — a `.feature` is a behavioural contract, not a source-grep.
  - **R4** — When SECURITY/ARCHITECTURE pre-name the `@executable` files at Decide, reconcile the routing pointers
    at contract-authoring once the Three Amigos split the lane (the m24 SECURITY.md stale-pointer near-miss).
  - **R5** — A RED-until-built arch-test must be proven REACHABLE (non-vacuous) at authoring — smoke-run its
    presence assertion against a stub, so a matcher-on-the-wrong-stripped-variant bug is caught at refine, not the
    final story's build (`acd-enroll-git-argv-no-shell`).
  - **R6** — An evidence agent that finds a fitness function un-satisfiable must ROUTE A FINDING to the architect,
    never silently rewrite an arch-owned test (the untrusted-evidence-write protocol).
- Carried, not distilled (backlog craft): a shared dependency-free `src/mesh-crypto.mjs` leaf for the
  sha256Hex/timingSafeEqual duplicated across `mesh-relay.mjs` + `mesh-registry.mjs` (coordinate with
  aof-security); doctor's advisory doc-over-budget warn on ARCHITECTURE.md (766 > 700 lines — ADRs are immutable,
  not a compaction target).
