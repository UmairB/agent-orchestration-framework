---
type: milestone
number: 24
slug: group-enrollment
title: "Device-Code Group Enrollment — join the fleet with a 6-digit code"
status: done
owner: product-owner
created: 2026-06-29
updated: 2026-07-02
depends: [23]
origin: wiki/planning/PRD-decentralized-agent-orchestration.md
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 24 · Device-Code Group Enrollment — join the fleet with a 6-digit code

## Objective

The **trust boundary and the join flow** of the mesh (origin:
[PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md), §7.2/§7.4 A3).
A relay (milestone 23) is only useful once machines can join the group it serves. This milestone makes the
control node the **enrollment authority** and introduces the group's own durable registry.

The flow is **device-authorization style** (cf. GitHub device flow / Tailscale auth keys), no password
infra and no manual key copying: `aof mesh invite` on the control node mints a short-lived **6-digit
code**; `aof mesh join <code>` presents it to the control node's relay endpoint and, on match, admits the
machine to the group and issues its **mesh credential** (relay auth + stream identity). Alongside it lands
the **group registry** — the group's own small durable **git stream of record**: the roster of nodes and
the set of registered boards (PRD §7.3 "two levels of git-of-record"), the new artifact the fleet view
will later read. v1 trust is **single-group / trusted-operator** — git remote access is provisioned
alongside admission; untrusted, cross-org, multi-tenant authz is the deferred Phase-5+ fork.

An outsider can verify the objective is met when a fresh machine joins by entering a single **6-digit
code** (no manual credential copying), is added to the group roster, and is issued a working mesh
credential — on all three OSes (KR6).

## Scope

In scope:
- **Device-code enrollment** — `aof mesh invite` (control node) mints a short-lived 6-digit code;
  `aof mesh join <code>` admits a machine and issues its mesh credential (relay auth + stream identity).
- **The control node as enrollment authority** — code issuance, match, admission, and the
  credential-revocation flow live on the nominated control node.
- **The group registry** — the group-level durable artifact (roster of nodes + set of registered boards)
  as its own lightweight git stream of record (PRD §7.3).
- **Group membership as the v1 trust boundary** — single-group, trusted-operator; git remote access
  provisioned alongside admission.

Out of scope:
- **Untrusted / cross-org / multi-tenant authz, audit, scaled credential revocation** — the deferred
  Phase-5+ platform fork (PRD §7.4 A3, §8).
- **`aof mesh ui` reading the registry** — milestone 25 (this milestone *authors* the registry; the fleet
  view renders it).
- **The relay + presence the credential authenticates against** — milestone 23 (stood up there; here we
  issue credentials for it).
- **Issuance / routing of work into a board** — milestone 27.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 24.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down `2026-07-01` by `aof:refine 24`. The partition follows the codebase-graph coupling
([ARCHITECTURE.md §Story break-down rationale](ARCHITECTURE.md); graph freshly built — 1174 nodes / 3143
edges): **00** is the durable **group registry** — the single-writer group-level git-of-record every other
story couples through (the spine, the role `mesh-store.mjs` plays for the per-node dimension); **01** is the
end-to-end **join flow** (mint → present → match/admit/issue → store + provision), delivering "a fresh machine
joins with a 6-digit code and is fully set up"; **02** is the **enforcement** — the relay actually CHECKS the
credential (paying m23's `23/ADR-001` pre-auth deferral) and makes it REVOCABLE, closing the 22/R6 "the
credential is actually used" loop 01 opens. The cut is a **user-outcome** split (substrate → join → enforce)
that keeps each command file single-owner (`mesh-invite`/`mesh-join` in 01; `mesh-revoke` in 02). Stories 01
and 02 both additively co-touch `src/mesh-relay.mjs` on **file-disjoint surfaces** (01 the HTTP request-handler
enrollment route; 02 the ws upgrade-handler auth-gate) — the accepted `07/ADR-006` additive co-touch, not a
shared-line edit. Contracts (task `.feature` files) are authored per story via Three Amigos at
`aof:refine 24/SS`.

- [x] **00 · [the group registry](stories/00_story_group-registry/STORY.md)** — `src/mesh-registry.mjs`: the
  group's own **single-writer** (control-node-owned) durable git stream of record — the roster of admitted
  nodes + the set of registered boards + the pending invites (hashed codes) + the revocations (PRD §7.3 "two
  levels of git-of-record"). The **dependency root**; buildable/testable standalone over git. Owns
  `acd-registry-write-scope` (+ `acd-enrollment-code-hashed-at-rest`, shared with 01).
- [x] **01 · [device-code enrollment (the join)](stories/01_story_device-code-enrollment/STORY.md)** —
  `aof mesh invite` (mint a short-lived, hashed, single-use 6-digit code) + the relay **device-flow HTTP
  endpoint** on `serveRelay`'s existing `http.createServer` (match/consume/admit/issue, with the attempt-cap
  ADR-005) + `aof mesh join <code>` (present, receive + store the credential, provision git-remote). A machine
  can **join** and is fully set up. **Depends on 00.** Owns `acd-enroll-endpoint-http-not-ws`,
  `acd-enroll-git-argv-no-shell` (provision half), `acd-enrollment-code-single-use-constant-time`.
- [x] **02 · [the enforceable trust boundary](stories/02_story_trust-boundary-enforcement/STORY.md)** — the
  relay **ws auth-gate** (verify a connecting node's credential against the live roster/revocation before
  brokering — pays the `23/ADR-001` pre-auth deferral) + `aof mesh revoke <node>` (remove from roster +
  de-provision git-remote + record a revocation). The group is **enforced** and revocable; the 22/R6 loop
  closes. **Depends on 00 + 01.** Owns `acd-relay-auth-gate-checked` (+ `acd-enroll-git-argv-no-shell`,
  de-provision half).

## Dependencies

- **23 · control-node-relay** — the control node is the enrollment authority and the relay is the
  endpoint `aof mesh join` presents its code to; admission issues the relay-auth half of the mesh
  credential, so enrollment consumes the standing relay directly. The group registry rides the git-sync
  substrate from milestone 22, reached through 23 — enrollment introduces *what* the registry holds, not
  the bus underneath it.
