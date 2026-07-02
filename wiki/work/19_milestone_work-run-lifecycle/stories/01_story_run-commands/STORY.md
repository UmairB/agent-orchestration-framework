---
type: story
number: 01
slug: run-commands
title: "The work:run-* commands & CLI face — the run lifecycle driven through the registered command core"
parent: 19
status: done
owner: product-owner
created: 2026-06-29
updated: 2026-06-30
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 01 · The work:run-* commands & CLI face

## User story

As the operator driving work (and the CLI / board / MCP faces, and milestones 20 and 21 that consume this foundation),
I want the run lifecycle driven entirely through registered `work:run-start` / `work:run-complete` / `work:run-status` command-core commands with stable, machine-readable `--json` shapes,
so that execution control is inherited through the one registry door (the milestone-08 bijection) — the CLI is a thin face, the board becomes a second thin face for free in milestone 21 — and a run's recorded state survives a restart, so "resumable" finally rests on durable state.

<!-- This story wires the FACE over story 00's frozen store. It owns the three command modules, their
     registration into the SAME core, and the CLI dispatch + --json adapters — no store mechanics
     (those are story 00) and no board route (that is milestone 21). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 19/01`, Contract stage). Each behaviour task is one
     `.feature` under tasks/; done when its @executable feature is green. The bijection fitness function
     is an arch-test (an EXTENSION of the existing one) tracked as a buildable unit below. -->

- [x] `tasks/00_run-commands.feature` — the three commands register into the core carrying the frozen `{id,input,run,cli}` shape; `work:run-start` creates a `running` run (`resolveItemExact` — a typo'd ref returns `ref-not-found`, never writes to the wrong item); `work:run-complete` performs the terminal transition (`resolveItemExact`; `runId?` defaults to the single in-flight `running` run; an illegal/ambiguous case is an error); `work:run-status` returns `{ ref, runs:[…] }` (`resolveItem`, slug-fallback tolerated).
- [x] `tasks/01_cli-face.feature` — `aof work run-start <ref> [--session …] [--brief …]`, `aof work run-complete <ref> --outcome done|failed|cancelled [--run …]`, `aof work run-status <ref>` each `argv → invoke → render`/`--json`; the `--json` face emits one parseable envelope (success or `{ ok:false, error, code }`), paths cwd-projected per the face adapter; a bad ref / illegal transition / bad outcome renders the structured error envelope.
- [x] `tasks/02_lifecycle-survives-restart.feature` — the outsider-verifiable acceptance: a run's lifecycle (start → status → complete) driven **entirely** through the registered commands; the recorded run state **survives a restart** — a fresh `aof work run-status <ref>` process re-loads the persisted run from `runs/` with its state intact.
- [x] **Fitness `acd-work-command-cli-bijection`** (arch-test EXTENSION, ADR-003 / fitness #4) — the registry-derived bijection test auto-covers the three new commands' presence (cli adapter + dispatch branch + `--json` clean); add the `argsFor` cases for `run-start` / `run-complete` / `run-status` (the switch throws on an unmapped sub).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-003** — the command surface, the
read/write resolver split inherited from `08/ADR-003`). This story **owns**:
`src/commands/run-start.mjs` / `run-complete.mjs` / `run-status.mjs` (each a thin wrapper over story 00's
`run-store.mjs`, the `next.mjs`-over-`nextWork` idiom), their registration in
[command-core.mjs](../../../../../src/command-core.mjs) (one import + one `COMMANDS` entry each — the
additive 08 move), and the `work run-start` / `work run-complete` / `work run-status` dispatch + adapters in
[cli.mjs](../../../../../src/cli.mjs). It **extends** `test/arch/acd-work-command-cli-bijection.test.mjs`
with the three `argsFor` cases. It does **not** author store mechanics (story 00) and does **not** touch
`board-ui.mjs` (milestone 21).

**Depends on story 00's frozen contract** (the run-record schema + the store's create/read/transition API),
which the milestone ARCHITECTURE froze — so this contract is authorable in parallel with story 00 (against
the frozen ADR, exactly the milestone-08 model where the faces were authored against story 00's frozen
registry). Its only inbound coupling is to the store; it consumes none of milestone 21's board surface.

**Feasibility (developer amigo seat — confirmed at Contract): FEASIBLE.** A thin face over the store. Each
command mirrors an existing command module byte-for-byte in shape — `feedback.mjs` (a write that resolves
exact via `resolveItemExact` and returns a structured result) for `run-start`/`run-complete`, `doc.mjs`
(`resolveItem` slug-fallback) for `run-status`; the CLI dispatch + `--json` single-envelope mirror
`projectProvisionCli` / `graphVerbCommand`. The error codes are free-form strings on the existing
`commandError(message, code, status)` → `{ ok:false, error, code }` envelope (no enum to extend). The
exact-resolver matrix holds against the real `findWork` (`sameNum` integer equality, so `"1"` does not match
`"19"`; a slug fragment returns a row but fails the `row.ref === ref` exact guard → `ref-not-found`).
`--outcome`/`--session`/`--brief`/`--run` parse as value options through `parseOptions`.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Implementation guidance surfaced at Contract; none is a contract defect (no `.feature`/ADR change).
     All flags resolve inside files THIS story owns (the bijection arch-test fixture + argsFor cases). -->

- **[LOAD-BEARING] The bijection smoke (`acd-work-command-cli-bijection`, fitness #4) will RED for
  `run-complete` unless the fixture seeds a running run.** That test's third arch-test spawns
  `aof work <sub> --json` and tolerates non-zero only for `validate`/`doctor`; against the fresh
  `buildFixture()` stream `run-complete` has no in-flight run → `no-running-run` → exit 1 → fail. **Fix
  (house idiom): `buildFixture()` pre-seeds one `runs/<id>.json` in `running` under `03/01`** (a discrete
  per-run file, exactly the ADR-002 layout), and `argsFor("run-complete")` targets `03/01 --outcome done`
  so complete exits 0. (Do NOT just widen the acceptable-exit set — that would let a broken complete pass.)
- **`argsFor("run-start")`** (a WRITE) targets a resolvable fixture item — mirror feedback's `03/01`:
  `["work","run-start","03/01","--json"]` (run-start creates `runs/` itself). **`argsFor("run-status")`** (a
  READ) is fine on an empty stream: `["work","run-status","03","--json"]` → `{ ref:"03", runs:[] }`, exit 0.
- Status codes on the error envelope (`feedback` uses 404/400) are read only by the board face (milestone 21);
  the CLI face reads `.code` and exits non-zero, so the CLI scenarios don't pin a specific HTTP status.
