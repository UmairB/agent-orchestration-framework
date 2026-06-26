---
type: story
number: 03
slug: validate-keystone-wiring
title: "Validate keystone wiring — run work:doctor after work:validate in the /aof:validate skill, lane-grouped"
parent: 15
status: done
owner: product-owner
created: 2026-06-25
updated: 2026-06-25
---
# 03 · Validate keystone wiring — the deterministic floor beneath the lint skill

## User story

As the `/aof:validate` lint keystone,
I want to run `aof work doctor [scope]` immediately after `aof work validate [scope]` and report both lanes grouped — validity findings (the hard non-zero gate) and health findings (advisory until `--strict`) — beneath the skill's existing agent-only layer (traceability, UAT-gate integrity, litmus),
so that the skill gains a deterministic *health* floor without `aof work validate` ever ceasing to be the keystone — doctor is added, never substituted.

<!-- A docs/bundle change only: it edits the shipped `/aof:validate` skill to add the doctor step,
     with the same scope passthrough and a lane-grouped report. It touches NO engine source and cannot
     collide with stories 00/01/02 — it depends on story 00 only in that the `aof work doctor` command
     it invokes must exist. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 15/03`, Contract stage). One task; done when its
     verification is satisfied (verification tag — @executable doc-content assertion or @manual run —
     is QA's call at Contract). -->

- [x] **00 · [doctor-after-validate](tasks/00_doctor-after-validate.feature)** — the skill runs `aof work doctor $ARGUMENTS` after `aof work validate $ARGUMENTS` (same scope); the combined report groups findings by lane (validity / health); validate stays the hard gate (PASS requires its exit 0), doctor is advisory (a `warn`-only health result does not fail the skill); doctor is added beneath — never replacing — the existing structural keystone and agent-only layer.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (ADR-002 validate is the gate, doctor is
advisory). This story **owns** the edit to the shipped lint skill
[src/bundle/commands/validate.md](../../../../../src/bundle/commands/validate.md) — adding the
`aof work doctor` step after the existing `aof work validate` step and the lane-grouped reporting prose.
It touches no `src/*.mjs` and no test/arch fitness function; it changes only the bundled skill doc (and so
its rendered `.claude/commands/aof/validate.md` flows from `aof work update`, not a hand-edit).

**Independent because** it edits exactly one artifact — the bundle skill doc — that no other story touches,
and consumes only the `aof work doctor` CLI surface story 00 ships. Build-time it needs story 00's command
to exist; it is otherwise parallel to stories 01 and 02. (It is most *meaningful* once 01/02 land real
check-groups, but the WIRING — doctor runs after validate, lane-grouped, advisory — is contract-complete
with the command present.)

**Feasibility (developer amigo seat — confirmed at Contract):** a one-step addition to an existing skill
doc that already runs `aof work validate $ARGUMENTS` and reports its findings verbatim — the doctor step is
the same shape (run the CLI, report its findings, do not re-derive). The only design choice is the
verification tag: a deterministic assertion that the shipped `validate.md` invokes `aof work doctor` after
`aof work validate` (`@executable`, a bundle-content check in the house of the bundle-membership arch-test)
versus a `@manual` run of the skill — QA fixes it in the feature at Contract.
