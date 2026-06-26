---
type: story
number: 03
slug: notion-fitness
title: "The notion-sync fitness functions — the seven structural arch-tests that make the integration's invariants load-bearing"
parent: 17
status: in-review
owner: product-owner
created: 2026-06-25
updated: 2026-06-26
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 03 · The notion-sync fitness functions — the integration's invariants, enforced

## User story

As the architect (and every future contributor who touches the Notion integration),
I want the seven structural invariants from ARCHITECTURE.md — mapping-sidecar-only, one-way, opt-in-no-op,
auth-env-ref/no-committed-secret, never-touch-board-schema, CLI-not-MCP, and fail-honestly/never-half-write —
each enforced by a `test/arch/acd-notion-*.test.mjs` arch-test wired into the suite,
so that the load-bearing promises of this milestone (aof never reads Notion as authoritative, an unconfigured
project spawns no CLI, no secret is committed, the board schema is never mutated, no MCP dependency creeps in,
a missing mapping is an honest skip not a half-write) fail CI loudly the moment a change erodes them — not
silently, not only at runtime.

<!-- This is the fitness story (ADR-005). Its "contract" IS the ARCHITECTURE.md fitness table — it has NO
     .feature pass of its own (mirrors 08/03, 12/04, 13/03). It is purely additive test files + the
     scripts/test.mjs aggregator wiring; it touches NO production code. RED-until-built is correct in the
     interim — the modules it references land in stories 00/01/02. -->

## Tasks

<!-- No task `.feature` of its own — the contract is the ARCHITECTURE.md fitness-function table. This story
     authors the seven arch-tests + wires them into scripts/test.mjs. They are RED until stories 00/01/02
     land, then GREEN and load-bearing. NOT YET SCHEDULED for authoring — `aof:refine 17/03` (or
     `aof:continue 17/03`) confirms the seven against the frozen modules. -->

The seven arch-tests to author (one per ADR-005 invariant — see the
[ARCHITECTURE.md](../../ARCHITECTURE.md) fitness-function table for each test's exact assertion):
- [x] `test/arch/acd-notion-mapping-sidecar.test.mjs` — the sidecar is the sole identity store; no
  external-id-property write, no resolve-by-query (ADR-001).
- [x] `test/arch/acd-notion-one-way.test.mjs` — every Notion call is disk→Notion or an addressing read; no
  read-Notion→write-disk path (ADR-003).
- [x] `test/arch/acd-notion-opt-in-noop.test.mjs` — absent config ⇒ no CLI spawn, zero Notion calls, hint
  present (ADR-004; the hard-requirement arch-test STATE called for).
- [x] `test/arch/acd-notion-auth-env-ref.test.mjs` — `tokenEnv` is an env-var NAME, never a token; no secret
  field in the schema (ADR-004).
- [x] `test/arch/acd-notion-no-schema-write.test.mjs` — no create-database / data-source / property / view;
  the only create is a PAGE create (ADR-003).
- [x] `test/arch/acd-notion-cli-not-mcp.test.mjs` — no MCP/`@modelcontextprotocol`/Notion-MCP import; the
  sole Notion egress is the provisioned CLI spawn (ADR-004, the SPEC's explicit MCP exclusion).
- [x] `test/arch/acd-notion-fail-honestly.test.mjs` — an unmapped status is a `skip` + `reason` computed
  before the write; the apply layer issues no write for a skip/noop op (ADR-003/004).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) **ADR-005** (the seven fitness functions + the
Fitness-functions table — each invariant, its arch-test, and the source ADR). This story **owns** the seven
`test/arch/acd-notion-*.test.mjs` files and their wiring into the
[scripts/test.mjs](../../../../../scripts/test.mjs) aggregator (the milestone-13 import-digest pattern). It
authors NO production code and NO task `.feature` — the contract is the fitness table.

**Independent because** it is additive test code over the FROZEN modules the other stories land
(`src/notion/mapping.mjs`, `src/notion/projection.mjs`, `src/notion/sync.mjs`,
`src/commands/notion-sync-work.mjs`, the `NOTION_DESCRIPTOR`). It references them and is **RED until they
exist**, then GREEN — exactly the milestone-08/12/13 fitness-story pattern. **The parallel tail** — it lands
last and goes green as each module arrives; it never blocks the others.
