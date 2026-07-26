---
type: story
number: 00
slug: group-registry
title: "The group registry — src/mesh-registry.mjs, the single-writer group-level git stream of record (roster + registered boards + pending invites + revocations)"
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
  `.feature` contract is authored later via Three Amigos (`aof:refine 24/00`).
-->
# 00 · The group registry — the group's own durable stream of record

## User story

As a fleet whose durable truth lives in git — where a **board** already keeps its own git of items + runs,
but the **group** (the fleet across boards) has no durable artifact of its own,
I want the group's own lightweight **git stream of record** — a single-writer registry the nominated control
node owns, holding the **roster** of admitted nodes, the set of **registered boards**, the **pending invites**
(the outstanding device codes, stored hashed), and the **revocations**,
so that enrollment has a durable place to record who has been admitted and what has been registered (PRD §7.3
"two levels of git-of-record"), the fleet view (milestone 25) has a group artifact to read, and — because the
control node is the sole writer — the roster is an **add-only, merge-clean** git artifact with no multi-writer
three-way merge (the property that keeps git viable as the group's bus).

<!-- This story owns the DURABLE SUBSTRATE and is the DEPENDENCY ROOT: stories 01 (invite writes a pending
     invite + admit writes the roster) and 02 (revoke writes a revocation; the auth-gate READS the roster +
     revocations) both couple through this module. It is buildable + testable STANDALONE over git — no relay,
     no credential, no command flow. -->

## Tasks

<!-- Contract authored via Three Amigos at `aof:refine 24/00` (2026-07-01): PO headline Scenarios,
     aof-qa Examples/case matrices, aof-developer feasibility. Structural invariants stay as the
     RED-until-built arch-tests below — never restated as a behaviour scenario. -->

Authored `2026-07-01` by `aof:refine 24` (`--autonomous` cascade). Four task features under `tasks/`:

- [x] **[00 · registry store + seam](tasks/00_registry-store-and-seam.feature)** (`@executable`) — the single
      control-node-guarded `writeRegistry` seam (atomic `writeText`, under `meshDir/registry/`), absence-tolerant
      `readRegistry` → empty registry, opaque round-trip (additive keys survive), and the single-writer truth
      table (control node writes / a non-control invocation is a structured no-op).
- [x] **[01 · roster + boards + revocations](tasks/01_roster-boards-revocations.feature)** (`@executable`) —
      add-only aggregate mutations: append to `roster[]` (order-preserving), `boards[]` (set semantics, no dup),
      `revocations[]`; no in-place rewrite of a peer's entry (the merge-clean single-writer property).
- [x] **[02 · pending-invite lifecycle](tasks/02_pending-invite-lifecycle.feature)** (`@executable`) — the
      durable pending shape `{ codeHash, issuedAt, expiresAt, consumedAt }` (a `codeHash`, never a plaintext
      `code`), single-use `consumedAt`, and the TTL read (strict `>` at the `expiresAt` boundary). The code
      **hashing** is story 01's crypto (security-owned fitness); this story owns the durable shape.
- [ ] **[03 · registry over git](tasks/03_registry-over-git.feature)** (`@manual`) — the control node writes
      the registry, a peer reads the roster back purely over git; the m22 payload-agnostic sync engine carries
      the new record type with zero engine change; single-writer ⇒ add-only merge.

_Fitness functions this story owns (arch-tests, already RED-until-built — structural, never a `.feature`):_

- [x] **`acd-registry-write-scope`** (ARCHITECTURE ADR-001) — the registry has EXACTLY ONE write seam
      (`writeRegistry`), control-node-guarded, through atomic `writeText`, joining the `registryPath`/`meshDir`
      partition, referencing zero record-doc filename, and NO OTHER `src/**` module writes `registry/`.
- [ ] **`acd-enrollment-code-hashed-at-rest`** (SECURITY.md T3, security-owned; armed here + in 01) — the
      durable registry record persists a `codeHash`, never a bare plaintext `code`/`deviceCode` field.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** — the group registry as the
group-level, **single-writer** (control-node-owned) second git-of-record; the `22/ADR-002` "no aggregate
roster" tension resolved because a single-writer roster has no multi-writer merge) and
[SECURITY.md](../../SECURITY.md) (**T3** — the pending device code is stored hashed at rest; a plaintext code
on this git-synced record would be committed + pushed to every peer). This story **owns**:
`src/mesh-registry.mjs` (`registryDir`/`registryPath`/`writeRegistry`/`readRegistry`, the schema) + its two
arch-tests + their registration in [scripts/test.mjs](../../../../../scripts/test.mjs).

**The dependency root.** Story 01 writes a pending invite (`mesh:invite`) + writes the roster (admit at the
endpoint); story 02 writes a revocation (`mesh:revoke`) + READS the roster/revocations (the auth-gate). Both
couple through this module's seam — so it is built first and is the milestone's spine (the role
`src/mesh-store.mjs` plays for the per-node dimension). Unlike `mesh-store.mjs`'s per-node partition (which
explicitly forbids an aggregate co-written file), the registry is a **legitimate aggregate** because it is
**single-writer**: only the nominated control node (`relayMode`/control-node predicate) writes it, so git
merges stay add-only.

**Carry-forwards already covered.** The registry lands under `.mesh/` (`meshDir/registry/`), so the m22/R4
self-host `.gitignore wiki/work/.mesh/` and the m22/R5 `.gitattributes` `.mesh/**` `eol=lf` pin (both landed
in m23) already cover it — confirmed in ARCHITECTURE ADR-001. No new ignore/EOL work here.

**22/R6 (data source is pinned).** Every registry mechanic has a real call-site data source: `writeRegistry`
is written by `mesh:invite` (pending), the endpoint (roster), and `mesh:revoke` (revocations); `readRegistry`
is read by the endpoint (match) and the auth-gate (roster/revocations). No dead mechanic.
