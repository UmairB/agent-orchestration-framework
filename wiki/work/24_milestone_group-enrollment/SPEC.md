---
type: milestone
number: 24
slug: group-enrollment
title: "Device-Code Group Enrollment — join the fleet with a 6-digit code"
status: not-started
owner: product-owner
created: 2026-06-29
updated: 2026-06-29
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

_To be broken down — `aof:refine 24`._

## Dependencies

- **23 · control-node-relay** — the control node is the enrollment authority and the relay is the
  endpoint `aof mesh join` presents its code to; admission issues the relay-auth half of the mesh
  credential, so enrollment consumes the standing relay directly. The group registry rides the git-sync
  substrate from milestone 22, reached through 23 — enrollment introduces *what* the registry holds, not
  the bus underneath it.
