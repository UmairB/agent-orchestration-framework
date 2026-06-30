---
type: verification
milestone: "20"
slug: autonomous-run-resilience
verifier: QA (inline)
date: 2026-06-30
verdict: PASS
---

# Verification — milestone 20 · autonomous-run-resilience

Acceptance of all three stories (`00 resilience-core` · `01 resilience-commands` ·
`02 resilience-skill`). Two lanes are in scope — **`@executable`** (stories 00/01,
10 task features) and **`@manual`** (story 02, 3 task features, agent-observed). There is
**no `@uat`** scenario and no UAT session in this milestone, so no human sign-off lane is
owed (a purely technical/foundational milestone). There is **no DESIGN surface** (the board
face is milestone 21, `SPEC §Out of scope`), so no design-conformance render/judge lane runs.

## Verification evidence

**`@executable` suite + fitness functions — GREEN.** `node scripts/test.mjs` → **1535 pass /
0 fail** (exit 0). The 10 story-00/01 traceability files all pass; each `@executable` feature
traces to a test file (`run-resilience-record-keys`, `run-failure-classification`,
`run-retry-lineage`, `run-heartbeat-reclaim`, `run-dedup-atomic-persist`, `run-retry-command`,
`run-retry-cli-face`, `run-status-rollback`, `run-resilience-acceptance`, `run-complete-reason`).
The six m20 fitness functions (`acd-run-retry-classification`, `acd-run-retry-resumes-lineage`,
`acd-run-reclaim-stale-only`, `acd-status-rollback-bounded`, `acd-run-persist-atomic`,
`acd-run-dedup-no-duplicate`), the inherited m19 guards (`acd-run-record-derived`,
`acd-run-partition-ready`, `acd-run-write-scope`), and the three registry-derived gates for the
new `work:run-retry` verb (CLI bijection `argsFor`, `/api/work` route-coverage `BOARD_DEFERRED`,
`command-core/00` `WORK_IDS` allow-list) are each green.

**Agent-observed `@manual` demonstration (story 02).** The skill wiring was read in
`src/bundle/commands/autonomous.md` and its mechanics driven live through the registered CLI
(`bin/aof.mjs`) over a throwaway fixture milestone (separate OS processes, real filesystem):

| Procedure (live, real CLI over a fixture) | Result | verifies → |
| --- | --- | --- |
| `run-start --session sess-live` → `run-complete --outcome failed --reason timeout` → `run-retry` | retry **RESUMED**: `attempt 2`, `retryOf` = the failed runId, `sessionId` = `sess-live` carried forward; then `run-complete --outcome done` | `02/00 retry-resume-and-reclaim` — *resume-on-infra via run-retry within the maxAttempts loop* |
| `run-start --session sess-bad` → `run-complete --outcome failed --reason agent_error` → `run-retry` → `run-start --session sess-fresh` | `run-retry` refused with code **`not-retryable`** (exit 1); the fresh `run-start` minted `attempt 1`, `retryOf null`, `sessionId sess-fresh` — the poisoned session is **not** replayed | `02/00 retry-resume-and-reclaim` — *a rejected (agent_error) output is restarted fresh via run-start, not resumed* |
| `maxAttempts=2`: fail(timeout) → retry→attempt 2 → fail(timeout) → `run-retry` at the ceiling | `run-retry` returned code **`attempts-exhausted`** (exit 1), minting no further run — the ceiling halts a genuinely-failing item instead of looping | `02/01 ceiling-and-unchanged-stops` — *a lineage that exhausts maxAttempts halts via the existing maxAttempts-exhausted stop* |
| seed a stale `running` orphan (heartbeat from 2020) on an `in-progress` item → `run-start` (restart path) → `run-status` + `work next` | the orphan was reclaimed to `state failed`, `failureReason runtime_offline`, `reclaimedAt` set; the item's `SPEC.md status` rolled `in-progress → not-started`; `aof work next` re-offered it (`ready`, `not-started`) | `02/00 retry-resume-and-reclaim` — *the loop runs the reclaim scan at restart … item rolled back to not-started … re-offered by aof work next* |

**Skill-prose wiring (read, not re-driven).** `src/bundle/commands/autonomous.md` carries, at the
right loop points: the **reclaim-at-restart** backstop (`<process>` opening — before the first
`aof work next`); **ask-the-store-not-the-table** (`run-retry` → follow the coded result; the
classification table is *not* restated in prose); **fresh-on-rejection** (`not-retryable` →
`run-start`); the **anti-loop** skip-self-trigger policy over the store's `retryOf`/`brief.initiator`
facts, with the store `duplicate-run` rejection treated as an in-loop event; and the **unchanged
five-stop set** (`<stop_conditions>` lists exactly `@uat` · `blocked` · wrong/infeasible contract ·
undefaultable decision · `maxAttempts` exhausted — no milestone-20 addition, per ADR-008). The
generated `.claude/commands/aof/autonomous.md` body is byte-identical to the bundle source (only the
generated-frontmatter transform differs), and `acd-bundle-manifest-hashes` passes — verifies
`02/00`'s *the resilience wiring lives in the bundle source and the manifest stays consistent*,
`02/01`'s *`<stop_conditions>` set is exactly the existing five*, and `02/02 anti-loop` (the skill
reads the store facts and skips self-triggers; the dedup backstop is an in-loop event).

## Findings

No new defect or gap was found during verification — every lane is green and all four live
resilience demonstrations passed. The carried-forward MINOR review findings from the build gate
(`STATE §Feedback`) are triaged here; none blocks acceptance.

| id | observed | type | severity | triage | routed-to | status |
| --- | --- | --- | --- | --- | --- | --- |
| F-20-01 | `acd-status-rollback-bounded`'s family-grep scans `work.mjs` + the `run-*` commands, but **17** modules import `work.mjs`; ADR-005's "ONLY status writer" is broader than the grep's scope. Safe today (the others are readers), but a future status write added elsewhere would slip past. | enhancement (fitness-function coverage) | low | **defer** — non-blocker; consider a registry-wide "only `rollbackItemStatus` writes a record-doc status" guard in a later milestone | architect / backlog + retro | open |
| F-20-02 | No `@executable` scenario pins the audit row "re-failing a run with NO `--reason` preserves the prior `failureReason`" (`applyTransition` does `failureReason ?? record.failureReason`). Behaviour is correct; the no-reason-preserves branch is unpinned. | enhancement (test coverage) | low | **defer** — non-blocker; an authoring (refine) follow-up to pin the branch | QA / author + retro | open |
| F-20-03 | `heartbeat` has no state guard (an unconditional persist), so heartbeating a terminal run would bump its `heartbeatAt`/`updatedAt`. Theoretical (only the live loop calls it on a `running` run). | enhancement (hardening) | low | **defer** — non-blocker; a one-line state guard or a note, not a fix | core / backlog + retro | open |

## Accept decision

**ACCEPT (milestone).** The `@executable` suite + all fitness functions are green (1535/0); the
three `@manual` story-02 behaviours were agent-observed live over the real CLI and the skill wiring
read in the bundle source; `aof work validate 20` → PASS (`[]`, exit 0) with traceability + litmus
clean; there is **no open blocker finding** (the three carried findings are all MINOR / deferred,
none a design-gap, none a blocker). All three stories are accepted (`status: done`); the milestone
is accepted (`SPEC.md status: done`). The deferred findings + the build lessons graduate to
`RETROSPECTIVE.md`.
