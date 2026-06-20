---
doc: verification
---
# 00 · Work CLI — Verification

## Verification evidence

Every scenario across all seven task features is `@executable` — there is no agent-run `@manual`
lane and no human `@uat` gate. The evidence is the green automated suite, the ADR-001 fitness
function, and the live validator over this stream:

| Lane | Command | Result | verifies → |
|---|---|---|---|
| `@executable` suite | `node scripts/test-unit.mjs` | 226 pass / 0 fail | all 7 task features |
| traceability — resolve | `node --test test/work-resolve.test.mjs` | green | `00_story_resolve-items/tasks/00,01` |
| traceability — validate | `node --test test/work-validate.test.mjs` | green | `01_story_validate-stream/tasks/00,01,02` |
| traceability — order | `node --test test/work-next.test.mjs` | green | `02_story_order-work/tasks/00,01` |
| fitness function (ADR-001) | `node --test test/arch/work-content-free-discovery.test.mjs` | green | `ARCHITECTURE.md` ADR-001 invariant |
| live stream | `aof work validate 00` | PASS (exit 0) | the stream is well-formed |

`aof:validate 00` ran the CLI keystone plus the agent traceability/litmus layer: CLI exits 0, every
`@executable` scenario/outline-row is backed by a passing test, and every `Then` asserts observable
CLI output (no litmus flags).

## Accept decision

**Accepted — 2026-06-17.** All three stories are built, green, and traced; the `@executable` suite
and the ADR-001 fitness function are green; `aof:validate 00` → PASS with no findings. No blocker is
open. Milestone set to `status: done`.
