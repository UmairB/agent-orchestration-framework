---
type: story
number: 01
slug: device-code-enrollment
title: "Device-code enrollment (the join) — aof mesh invite (mint) + the relay device-flow HTTP endpoint (match/consume/admit/issue) + aof mesh join <code> (present, receive + store the credential, provision git-remote)"
parent: 24
status: done
owner: product-owner
created: 2026-07-01
updated: 2026-07-02
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / SECURITY / DESIGN / RESEARCH.
  Break-down stage (aof:refine 24): the user story + the ownership map are set; the task
  `.feature` contract is authored later via Three Amigos (`aof:refine 24/01`).
-->
# 01 · Device-code enrollment — join the fleet with a 6-digit code

## User story

As a fresh machine that needs to join the fleet without password infra or manual key copying,
I want to enter a single short-lived **6-digit code** the control node handed me — `aof mesh join <code>` —
and be **admitted to the group and fully set up**: the control node mints the code (`aof mesh invite`), the
code is presented to the control node's relay endpoint, matched (single-use, TTL-bounded, brute-force-capped)
and **consumed**, my node is added to the group roster, and I am **issued my mesh credential** (relay auth +
stream identity) with **git-remote access provisioned** alongside,
so that the headline outcome holds — a fresh machine joins by entering one 6-digit code (no manual credential
copying), is added to the roster, and is issued a working mesh credential — the device-authorization flow (cf.
GitHub device flow / Tailscale auth keys) of PRD §7.2 KF10 / §7.4 A3, KR6.

<!-- This story owns THE JOIN FLOW end-to-end: mint → present → match/admit/issue → store + provision. A
     machine can JOIN and is fully provisioned after it. It does NOT own ENFORCEMENT — the relay does not yet
     CHECK the credential on a live ws connection, and there is no revocation; that is story 02 (the credential
     issued here is what 02's auth-gate checks — the 22/R6 "the credential is actually used" loop closes in
     02). Depends on story 00 (writes the pending invite + the roster through the registry seam). -->

## Tasks

<!-- Contract authored via Three Amigos at `aof:refine 24/01` (2026-07-01): PO headline Scenarios, aof-qa
     Examples/case matrices (the match matrix — good / expired / already-consumed / cap-exceeded / malformed),
     aof-developer feasibility. The structural + security invariants stay as arch-tests below (never a scenario). -->

Authored `2026-07-01` by `aof:refine 24` (`--autonomous` cascade). Four task features under `tasks/`. **Depends on story 00.**

- [x] **[00 · mesh invite (mint)](tasks/00_mesh-invite-mint.feature)** (`@executable`) — `mesh:invite`
      (control-node-guarded) mints a 6-digit code, appends a hashed pending invite to the registry (story 00's
      `writeRegistry`), returns the plaintext **once**; `expiresAt = issuedAt + codeTtlSeconds` (300); a
      non-control invocation refuses. Rides the existing `acd-mesh-command-cli-bijection` gate.
- [x] **[01 · device-code flow](tasks/01_device-code-flow.feature)** (`@executable`) — the `POST /enroll`
      endpoint on `serveRelay`: the match/reject matrix (good → admit + issue + consume; expired / consumed /
      malformed / cap-exceeded → structured rejection, never a throw), the **attempt-cap** (default 5, ephemeral
      in-memory) and TTL bound the 10^6 space, and the `resolveCodeTtlSeconds`/`resolveMaxAttempts` malformed →
      default tolerance. *(SECURITY.md T2/T7 routes here.)*
- [x] **[02 · join + provision](tasks/02_mesh-join-and-provision.feature)** (`@executable`) — `mesh:join <code>`
      reads `config.mesh.relay.url`, POSTs the code, on match stores the credential in `config.mesh.credential`
      (merge-not-clobber) and provisions git-remote via the shell-less `spawnSync("git", ["remote","add",…])`
      argv idiom; a rejection stores nothing (clean face error).
- [ ] **[03 · join end-to-end](tasks/03_join-end-to-end.feature)** (`@manual`) — a fresh machine joins with a
      single 6-digit code, no manual credential copying (KR6); the `credential-at-rest` (R-1) + `code-in-flight`
      (R-3) residual-risk pen-tests (evidence in `VERIFICATION.md`).

_Fitness functions this story owns / arms (arch-tests, already RED-until-built — structural, never a
`.feature`):_

- [x] **`acd-enroll-endpoint-http-not-ws`** (ARCHITECTURE ADR-002) — enrollment is an HTTP route; the ws
      `{ kind, nodeId, signal }` envelope branches on NO enrollment `kind` (payload-agnostic preserved).
      _(GREEN today against m23's relay; goes RED if a `kind === "enroll"` ws branch is planted.)_
- [x] **`acd-enroll-git-argv-no-shell`** (ARCHITECTURE ADR-003; armed here for provision + in 02 for
      de-provision) — every enrollment `git` spawn is the shell-less `spawnSync("git", [ … ])` argv form, no
      `exec(`/shell string, no write against a foreign source.
- [x] **`acd-enrollment-code-single-use-constant-time`** (SECURITY.md T2/T4, security-owned) — the match
      consumes the pending invite (single-use) and compares via `timingSafeEqual` (no `===` timing oracle).
- [x] **`acd-enrollment-code-hashed-at-rest`** (SECURITY.md T3, security-owned; shared with story 00) — the
      `invite` write persists a `codeHash`, never a plaintext `code`.
- [x] The **attempt-cap** observable is `@executable` (ADR-005 — no new arch-test): cap rejects after
      `maxAttempts` (default 5) tries; a TTL-expired code (default 300s) is rejected; admission needs the
      control node online.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-002** — invite mints + the device-flow
HTTP endpoint matches/consumes/admits/issues + join presents/stores; **ADR-003** — the mesh credential
contents + git-remote provisioning at join; **ADR-005** — the enrollment attempt-cap/rate-limit + the
documented knobs `config.mesh.enrollment.codeTtlSeconds` (300s) / `maxAttempts` (5), the counter EPHEMERAL
in-memory, reconciled with `acd-relay-stateless`) and [SECURITY.md](../../SECURITY.md) (**T2** brute-force —
the attempt-cap is THE load-bearing control that makes the 10^6 space defensible for v1; **T3** hashed-at-rest;
**T4** replay/single-use; **T7** DoS/guessing-flood). This story **owns**: `src/commands/mesh-invite.mjs`,
`src/commands/mesh-join.mjs` (incl. the join client + credential storage + git-remote provisioning), the
**HTTP enrollment route** added to `src/mesh-relay.mjs`'s `http.createServer` request handler, and the
enrollment-side arch-tests' registration.

**Depends on story 00.** `invite` writes a pending invite and admit writes the roster through story 00's
`writeRegistry`; the endpoint reads pending invites through story 00's `readRegistry`. Built after 00.

**The `mesh-relay.mjs` co-touch is additive + file-disjoint within the module (07/ADR-006).** This story adds
an HTTP **request-handler** route (above the `426` fallback); story 02 adds a **ws upgrade-handler** auth-gate
— different surfaces of the same leaf module (the relay has 0 outbound deps, so neither surface drags a shared
record dependency). Accepted additive co-touch, not a shared-line edit (ARCHITECTURE §Story break-down
rationale).

**New verbs ride the existing gate (inverse-22/R1, CLEAN):** `mesh:invite` + `mesh:join` are auto-covered by
the existing `acd-mesh-command-cli-bijection` gate **provided** each adds its `subcommand === "<sub>"` branch
in `cli.mjs`'s `meshCommand` + a `cli` adapter + the `argsFor` case in the SAME change (the m22/R1 lesson — the
bijection `argsFor` switch THROWS on an unmapped sub). No new command-face gate.

**22/R6 (the credential is USED — but the loop closes in 02).** The credential issued + stored here is the
data source story 02's auth-gate + git-remote checks read. Story 01 delivers issuance + provisioning; story 02
delivers the CHECK — an issued-but-never-verified credential would be the exact 22/R6 dead-mechanic
anti-pattern, which is why story 02 is a required sibling, not optional polish.
