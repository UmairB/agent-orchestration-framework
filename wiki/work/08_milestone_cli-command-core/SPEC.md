---
type: milestone
number: 08
slug: cli-command-core
title: "CLI Command Core — the UI is a thin face over the CLI contract"
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-21
depends: [00, 03]
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 08 · CLI Command Core — the UI is a thin face over the CLI contract

## Objective

The aof CLI should be the **single source of truth for every operation** — the board and setup UIs are
thin faces that can only invoke operations the CLI exposes, with **zero bespoke server-side logic**.
Today they are not: the board API (`/api/work/*`), the terminal WebSocket (`/ws/terminal`), and the
setup UI API (`/api/config`, `/api/items`, …) each **import aof's core modules directly**
(`work.mjs`, `terminal-providers.mjs`, `headroom.mjs`). They *share* the core library with the CLI, but
nothing routes "through the CLI" and nothing **enforces** that every UI capability has a CLI equivalent —
so logic can (and does) live in a UI server with no CLI form, and the two faces can drift.

This milestone establishes the **CLI-as-contract** architecture and proves it on the simplest surface.
One **command core** becomes the source of truth: every operation is a first-class command with a stable,
machine-readable (`--json`) contract; the CLI is a 1:1 face over that core; the UI server is *another*
face that may **only** invoke registered commands and carries no operation logic of its own. The
"single source of truth" guarantee is made **structural** — a fitness function asserts that every UI
operation maps to a registered command, that every command has a CLI form, and that the UI imports no
core module behind any command's back. The boundary is **in-process** (CLI and UI both call the one
core), not per-request subprocess — so the contract is enforced without the subprocess tax, and a
stricter subprocess face remains a possible later *implementation* of the same contract.

An outsider can verify the objective is met when: the read-mostly `/api/work` API
(`list` / `doc` / `tasks` / `validate` / `next` / `feedback`) is served entirely by invoking the same
commands the CLI exposes — the board returns byte-for-byte what it does today — **and** the fitness
function fails if anyone adds a UI route that doesn't go through a registered command, or a command the
CLI cannot run. The architecture, not just this one surface, is the deliverable: this is the
**foundational milestone of a multi-milestone inversion** (the terminal/session seam and the setup-UI
CRUD follow on their own milestones).

## Scope

In scope:
- **The command-core + CLI-contract pattern** — a single command registry/core that is the source of
  truth for operations: each command has a stable input/result shape and a machine-readable (`--json`)
  contract. The CLI is a thin 1:1 face (argv → command → result); the UI server is a second thin face
  (HTTP → command → result). Both call the SAME core in-process. The exact registry shape + the
  command/result contract are pinned in the milestone ADR at refine.
- **The enforcing fitness function(s)** — the structural guarantee that makes "the CLI is the source of
  truth" real: every UI operation resolves to a registered command; every command has a CLI invocation;
  the UI face imports no core/operation module except through the registry (no UI-only logic, no UI-only
  core import). This is the load-bearing deliverable — the pattern is only durable if it is enforced.
- **First surface migrated: the read-mostly `/api/work` API** — `list`, `doc`, `tasks`, `validate`,
  `next`, `feedback` are re-homed onto the command core; the board UI consumes the same command contract
  the CLI exposes, and the board's existing API envelope (milestone 03) is preserved byte-for-byte. This
  proves the architecture end-to-end on a real surface.
- **The boundary-model decision recorded** — CLI-as-contract over ONE shared in-process core (not
  subprocess), with the rejected alternative captured, so the architecture is a deliberate, documented
  choice the follow-on milestones inherit.

Out of scope:
- **Migrating the `/ws/terminal` session-launch seam** — re-homing session launch (incl. headroom and a
  generalized launch-extension registry; this ties into milestones 06/07 and the deferred
  proxy-mode/observability work) is its **own follow-on milestone**. Streaming/PTY is a distinct transport
  problem from the read-mostly API and earns its own breakdown.
- **Migrating the setup-UI config/resource CRUD** (`/api/config`, `/api/config/sections`, `/api/items`,
  `/api/capabilities`) — a separate follow-on milestone once the read-API pattern is proven.
- **A strict per-request subprocess boundary** — deliberately rejected here in favour of the in-process
  shared core (it pays a spawn/serialize tax per request and is awkward for the streaming seam); it
  remains a possible stricter *implementation* of the very same command contract in a later milestone, not
  a thing this one builds.
- **Any UI/UX redesign** — the board's rendered surface and API envelope are unchanged; this is a
  backend-contract inversion, not a frontend change.
- **New product capabilities** — this re-homes existing operations behind the contract; it does not add
  features. (New ops added later simply must arrive as commands first.)

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 08.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down `2026-06-21` (`aof:refine 08`) into **four** stories — **00 is the spine; 01 / 02 / 03 fan
out from its frozen contract in parallel** (the critical path is 00 only). See
[ARCHITECTURE.md](ARCHITECTURE.md) for the ADRs each consumes. Contracts authored `2026-06-21`
(`aof:refine 08 --autonomous`): 00/01/02 task `.feature` files written (Three Amigos: PO scenarios +
QA examples/tagging + developer feasibility); 03's contract is ADR-004 itself (arch-tests, no `.feature`
pass). All four are `in-progress` (contracted, ready to build).

- [x] **00 · [command-core](stories/00_story_command-core/STORY.md)** — the in-process registry + the six
  registered commands (`list`/`doc`/`tasks`/`validate`/`next`/`feedback`), bespoke `board-ui.mjs` logic
  moved in. The spine; freezes the `{id,input,run,cli}→result` contract (ADR-002). 4 tasks. _done_
- [x] **01 · [cli-face](stories/01_story_cli-face/STORY.md)** — thin `argv→command→result`: new
  `work doc`/`work tasks`/`work feedback` + rewire `list`/`validate`/`next` through the registry
  (ADR-003). Consumes 00. 3 tasks. _done_
- [x] **02 · [board-face](stories/02_story_board-face/STORY.md)** — `/api/work*` reduced to
  `route→invoke→projection`, milestone-03 envelope byte-for-byte, zero operation logic left in the UI
  server (ADR-003). Consumes 00. 3 tasks. _done_
- [x] **03 · [command-fitness](stories/03_story_command-fitness/STORY.md)** — the enforcing fitness
  functions (the bijection + the no-UI-core-import / in-process guards) as arch-tests (ADR-004 — the
  load-bearing deliverable). Asserts against 00; RED until 01/02 land. 4 arch-tests. _done_

## Dependencies

- **00 · work-cli** — the CLI command surface that becomes the contract; the command core generalizes
  and is consumed by it.
- **03 · work-board-ui** — supplies the `/api/work` API + the board's frozen API envelope that this
  milestone re-homes behind the command core (and proves against byte-for-byte).
- **06 · headroom-plugin** *(precedent, not a hard dependency)* — its `resolveHeadroomLaunch` "one shared
  contract, two faces" move (ADR-003) is the seed this milestone generalizes from one extension into the
  whole operation surface.
