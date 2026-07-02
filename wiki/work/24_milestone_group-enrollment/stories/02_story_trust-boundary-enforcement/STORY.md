---
type: story
number: 02
slug: trust-boundary-enforcement
title: "The enforceable trust boundary — the relay ws auth-gate (verify the credential against the live roster/revocation) + aof mesh revoke (remove from roster + de-provision git-remote + record a revocation)"
parent: 24
status: done
owner: product-owner
created: 2026-07-01
updated: 2026-07-02
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / SECURITY / DESIGN / RESEARCH.
  Break-down stage (aof:refine 24): the user story + the ownership map are set; the task
  `.feature` contract is authored later via Three Amigos (`aof:refine 24/02`).
-->
# 02 · The enforceable trust boundary — the credential is checked, and revocable

## User story

As an operator whose group is only as safe as its boundary is **enforced**,
I want the relay to actually **check** a connecting node's mesh credential against the live group roster before
it brokers any signal — turning milestone 23's pre-auth loopback relay into a credential-gated group — and I
want to **revoke** a node (`aof mesh revoke <node>`) so it loses BOTH relay access and git-remote access at
once,
so that group membership is a real trust boundary, not just an issued token: an absent / invalid / **revoked**
credential is rejected at the relay (the 22/R6 "the credential is actually used" guard — closing the loop
story 01 opened), and removing a compromised or retired node is a single durable act that de-provisions its
access — the credential-revocation flow PRD §7.4 A3 flags as "needing care."

<!-- This story owns ENFORCEMENT — the receive-side counterpart to story 01's issuance. It makes the credential
     story 01 issues LOAD-BEARING (checked at the relay) and REVOCABLE. Depends on 00 (reads the roster +
     revocations; writes a revocation) AND 01 (the credential it checks is the one 01 issues + stores). It pays
     the 23/ADR-001 pre-auth deferral: m23's relay bound loopback pre-auth; this story adds the auth-gate. -->

## Tasks

<!-- Contract authored via Three Amigos at `aof:refine 24/02` (2026-07-01): PO headline Scenarios, aof-qa
     Examples/case matrices (the admit/reject matrix — valid / absent / invalid / revoked / not-in-roster),
     aof-developer feasibility. The enforcement invariant stays the security-owned arch-test (never a scenario). -->

Authored `2026-07-01` by `aof:refine 24` (`--autonomous` cascade). Three task features under `tasks/`. **Depends on stories 00 + 01.**

- [x] **[00 · relay auth-gate](tasks/00_relay-auth-gate.feature)** (`@executable`) — `serveRelay`'s ws upgrade
      handler CHECKS the credential against the **live** roster/revocation before brokering: valid → admitted;
      absent / invalid / not-in-roster / **revoked** → `socket.destroy()` (never joins the clients set); loopback
      stays the local default; the relay persists nothing at the gate (`acd-relay-stateless` stays GREEN).
- [x] **[01 · mesh revoke](tasks/01_mesh-revoke.feature)** (`@executable`) — `mesh:revoke <node>`
      (control-node-guarded) removes the node from the roster + appends a revocation (story 00's `writeRegistry`)
      + de-provisions git-remote via the shell-less `spawnSync("git", ["remote","remove",…])` argv idiom; after
      it, the auth-gate rejects that node's credential (the loop story 01 opened closes).
- [ ] **[02 · revocation completeness](tasks/02_revocation-completeness.feature)** (`@manual`) — a revoked node
      loses BOTH relay access AND git-remote access; the T6 `git-remote-deprovision` pen-test on a real remote
      (evidence in `VERIFICATION.md`).

**Documented default decision (from the developer feasibility pass, `aof:refine 24` `--autonomous`).** The
credential carrier on the ws upgrade — left non-committal by ADR-003 ("`Sec-WebSocket-Protocol` / auth header") —
is resolved to an **`Authorization` header** on the upgrade request (`request.headers.authorization`, readable in
the existing `server.on("upgrade")` handler; settable via `new WebSocket(url, { headers })` in both the in-process
test client and the production `mesh-relay-client.mjs` connect path). Preferred over `Sec-WebSocket-Protocol` to
avoid the subprotocol-echo handshake flake. **Build note:** the auth-gate needs an injectable "this is a group
connection" seam so the loopback-vs-group branch is deterministic in-process (every in-process `ws` client
presents a `127.0.0.1` remote address) — expose it at build so it is not discovered mid-build.

_Fitness functions this story owns / arms (arch-tests, already RED-until-built — structural, never a
`.feature`):_

- [x] **`acd-relay-auth-gate-checked`** (SECURITY.md T1/T6, security-owned) — the relay upgrade admission
      verifies a credential, rejects on failure, and reads the LIVE revocation/roster (imports
      `mesh-registry.mjs`/the credential seam) before brokering — the 22/R6 "the credential is actually USED"
      guard + the pre-auth→authenticated transition.
- [x] **`acd-enroll-git-argv-no-shell`** (ARCHITECTURE ADR-003/ADR-004; armed here for de-provision + in 01
      for provision) — every enrollment `git` spawn (incl. `mesh:revoke`'s de-provision) is the shell-less
      `spawnSync("git", [ … ])` argv form, no `exec(`/shell string.

_Compatibility note (does not conflict with m23's relay gates):_ the auth-gate is a **READ** (of the
roster/revocations) + a reject decision — it persists **nothing**, so m23's `acd-relay-stateless` (no durable
*write* / no system of record) stays GREEN, and it branches on the credential in the **upgrade** handler, not
on a `signal`'s content, so `acd-relay-envelope-neutral` stays GREEN. SECURITY.md carries the full
compatibility rationale.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-003** — the mesh credential + the relay
auth-gate additive to `serveRelay`'s upgrade handler, paying the `23/ADR-001` pre-auth deferral; **ADR-004** —
revocation removes from roster + records a revocation + de-provisions git-remote, and the auth-gate rejects a
revoked credential) and [SECURITY.md](../../SECURITY.md) (**T1** the enrolled-relay trust boundary; **T6**
revocation completeness — a revoked node must lose BOTH relay and git-remote; the pre-auth→authenticated
transition). This story **owns**: the **ws auth-gate** added to `src/mesh-relay.mjs`'s upgrade handler,
`src/commands/mesh-revoke.mjs`, the credential-verify seam (`src/mesh-credential.mjs` or equivalent, per the
architect's ADR-003 module map), and the enforcement arch-test's registration.

**Depends on stories 00 and 01 — the genuine integration/enforcement story.** It READS story 00's roster +
revocations (the auth-gate) and WRITES a revocation (`mesh:revoke`); it CHECKS the credential story 01 issues +
stores. It is the receive-side that makes 01's issuance load-bearing — the 22/R6 loop (issue in 01 → check in
02) closes here.

**The `mesh-relay.mjs` co-touch with story 01 is additive + file-disjoint within the module (07/ADR-006).**
Story 01 adds an HTTP **request-handler** route; this story adds a **ws upgrade-handler** auth-gate — different
surfaces of the same leaf module. Accepted additive co-touch (ARCHITECTURE §Story break-down rationale).

**New verb rides the existing gate (inverse-22/R1, CLEAN):** `mesh:revoke` is auto-covered by the existing
`acd-mesh-command-cli-bijection` gate **provided** it adds its `subcommand === "revoke"` branch + `cli` adapter
+ the `argsFor` case in the SAME change. No new command-face gate.
