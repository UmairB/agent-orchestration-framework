---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 21 · Board Run Observability — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the load-bearing deliverables: per-item **run
> history**, **current-run state**, and a **rerun affordance**, all reached **through the registered
> command-core commands**, with no side-channel that reads run records or triggers a run behind the
> registry; the read-mostly board's transport/path-display face rules and its frozen `/api/work` envelope
> stay intact; observability is **poll/refresh**, NOT a push stream) and `STATE.md` (the open-for-refine
> questions — which run projection the board reads and via which command, how the rerun affordance threads
> milestone 20's fresh-vs-resume choice, and confirming the additive board envelope stays within the frozen
> milestone-03 shapes + the milestone-08 bijection/no-core-import guards). Prior art:
> `PRD-work-run-orchestration.md` (the **observability** value axis — surface what actually *ran*).
>
> **The two dependencies this milestone CONSUMES and never re-litigates — both `done`:**
>
> - **Milestone 19 (work-run-lifecycle).** The foundation this milestone *renders*. Inherited wholesale:
>   `19/ADR-001` (the closed run state machine `queued → running → done | failed | cancelled`; `work:run-start`
>   creates-and-begins directly in `running`; `queued` reserved for m20); `19/ADR-002` (the run record is a
>   **derived** log under a per-item `runs/` dir — item frontmatter stays the single source of truth, and a
>   run command NEVER writes a record doc); `19/ADR-003` (the **frozen** run-record schema — `runId`,
>   `itemRef`, `state`, `attempt`, `outcome`, `sessionId`, `brief` (opaque), `createdAt`, `updatedAt` — and
>   the three registered commands `work:run-start` / `work:run-complete` / `work:run-status`, each a thin
>   `{ id, input, run, cli } → result` wrapper over `src/run-store.mjs`; `work:run-status` returns
>   `{ ref, runs: RunRecord[] }`).
> - **Milestone 03 (work-board-ui).** The board surface this milestone *extends*. Inherited wholesale:
>   `03/ADR-001` (one `http.createServer`; `/api/work*` is the frozen HTTP namespace; `/ws/terminal` the
>   disjoint WS namespace); `03/ADR-002` (the **frozen** flat 7-field `work list --json` contract); `03/ADR-004`
>   (the board is **read-mostly** — status is derived and never written; the feedback bullet append is the
>   board's ONE filesystem mutation; no `child_process`/shell-out of a command CLI); `03/ADR-006` (the board's
>   primary action is **state-aware** — launching types the matching `/aof:*` command as ordinary PTY input
>   into the spawned agent; the board server runs NO command itself).
>
> **The precedent this milestone APPLIES and never re-litigates: milestone 08 (cli-command-core).** Inherited
> wholesale: `08/ADR-001` (CLI-as-contract over ONE in-process registry — no per-request subprocess);
> `08/ADR-002` (the frozen `{ id, input, run, cli } → result` contract; `run` returns **basis-neutral** data
> with raw absolute paths; **path-display is a face adapter**, never command logic — the board's `displayPath`);
> `08/ADR-004` (the registry-derived command→CLI bijection + the no-core-import guard — generalised by
> `15/ADR-005` to the registry-derived `/api/work` ↔ `work:*` route bijection). ADRs below cite these as
> `08/ADR-00n` / `03/ADR-00n` / `19/ADR-00n` / `15/ADR-005` / `SPEC §…` / `STATE §…`.
>
> **The seam (confirmed against the codebase graph, `aof graph build src` → 1061 nodes / 2872 edges, 89 files
> cached/unchanged; `aof graph impact` re-run at author time, cited below as ACTUAL structure, not inferred):**
> - `aof graph impact src/board-ui.mjs` → imported only by `setup-ui.mjs`; its only operation-bearing import is
>   `command-core.mjs`. **The board couples ONLY through the registry door** — the `08`/`03/ADR-004` no-core-import
>   guard holds, and this milestone must NOT break it (no direct import of `run-store.mjs` / `commands/run-*.mjs`).
> - `aof graph impact src/command-core.mjs` → it **already imports** `src/commands/run-start.mjs`,
>   `src/commands/run-status.mjs`, `src/commands/run-complete.mjs`. **The three m19 commands are ALREADY
>   registered.** The board's read path needs **ZERO** new command-core wiring — `invoke("work:run-status",
>   {ref}, ctx)` works today.
> - `aof graph impact src/run-store.mjs` → coupled only by the three run commands; depends on nothing. The board
>   must reach it ONLY through `work:run-status`, never directly.
>
> **Prior-lesson recall** (`work memory recall … --area architecture --block`): surfaced `19/R1` (a near-miss:
> *an ADR that registers / surfaces a command-core command must enumerate EVERY registry-derived fitness
> function it trips, not just the obvious one*) — **honoured directly** by ADR-001 below, which spells out that
> surfacing `work:run-status` on `/api/work/run-status` trips the `15/ADR-005` route↔command bijection
> (`acd-work-command-route-coverage`, whose `BOARD_DEFERRED` set must drop `run-status`) AS WELL AS the
> `03/ADR-002` list contract and the `08` no-core-import guard — fitness table rows #2/#3/#4 enumerate all of
> them. Also surfaced `03/ADR-006` (the state-aware terminal launch — honoured as the verbatim spine of ADR-002's
> rerun), `03/ADR-004` (read-mostly board — honoured: this milestone adds NO new board write), and `19/ADR-003`
> (the frozen schema the board renders — honoured: the board renders those nine fields, writes none of them).
> No departure from a prior lesson.

## ADR-001: The run read path (history + current-run state) reaches the board through the already-registered `work:run-status` command via ONE new thin face route `GET /api/work/run-status?ref=` — purely additive, ZERO operation logic, no new command-core wiring

**Status:** Accepted
**Date:** 2026-06-30

**Context.** The SPEC's first two deliverables — per-item **run history** and **current-run state** — are
both *reads* of the m19 run log. The graph settles the wiring question (`STATE §Notes`, "which run projection
the board reads and via which command") before it is even asked: `aof graph impact src/command-core.mjs`
shows the registry **already imports** `src/commands/run-status.mjs` (m19 registered all three `work:run-*`
commands, wiring only the CLI face — `19/ADR-003`, `03`-deferred). So `invoke("work:run-status", {ref}, ctx)`
resolves **today**; the board's read path needs **no new command-core wiring at all**. What is missing is one
thing: a board **route** that exposes that command, exactly as the existing `/api/work/list|doc|tasks|validate|
next|doctor` routes expose theirs.

The existing routes are the precise template (`src/board-ui.mjs`): each is `HTTP → invoke(id, input,
{workspace}) → projection`, carrying **zero** operation logic (`08/ADR-002`'s thin-face precedent, re-anchored
by `03/ADR-004` inv.3 — the board's only operation-bearing import is `./command-core.mjs`). `work:run-status`
returns `{ ref, runs: RunRecord[] }` and its `cli.json` is a pass-through (`json: (result) => result`); the run
records carry **refs, not absolute paths** (`19/ADR-003`), so — unlike `validate`/`next`/`doctor` — there is
**no `displayPath` projection** to perform. The route is the thinnest of the family.

**Decision.** The run read path is **one new thin face route on `src/board-ui.mjs`**:

```
GET /api/work/run-status?ref=<ref>
  →  invoke("work:run-status", { ref }, { workspace })
  →  sendJson(200, result)              // result === { ref, runs: RunRecord[] } — no path projection
```

- **It carries ZERO operation logic.** Like `/api/work/list`, it reads the query param, `invoke`s the
  already-registered command through the **one registry door**, and serialises the result. No filesystem read,
  no run-store import, no path projection (the records carry refs). The board still imports **only**
  `./command-core.mjs` for operations (the `08` / `03/ADR-004` inv.3 no-core-import guard — fitness #4).
- **Current-run state is NOT a second command.** The "current run" is simply the **latest / in-flight run in
  the same `runs[]` array** the route already returns — the UI selects it (e.g. the most recent `runId`, or the
  single `state: "running"` record). There is no `work:run-current` verb and no second route. One read serves
  both history and current-state (`SPEC §Scope`: history + current-run state are one read of the same log).
- **The route is purely ADDITIVE to the m03 envelope.** It does **not** change the frozen 7-field
  `work list --json` contract (`03/ADR-002`, `acd-work-list-contract` stays green — fitness #5) and does not
  alter any existing route. It is a new `/api/work/<op>` member, so it joins the `15/ADR-005` route↔command
  bijection: surfacing `work:run-status` means the `BOARD_DEFERRED` carve-out in
  `acd-work-command-route-coverage` (today `{run-start, run-complete, run-status}`) must **drop `run-status`**
  so the bijection re-tightens to cover the new route (fitness #2). `run-start` and `run-complete` STAY deferred
  — they are not board read routes (they reach the agent via ADR-002's terminal launch, not via `/api/work`).
- **The board renders the m19 frozen schema, writes none of it.** The fields the board renders are exactly
  `19/ADR-003`'s nine — `runId`, `itemRef`, `state`, `attempt`, `outcome`, `sessionId`, `brief` (opaque),
  `createdAt`, `updatedAt`. The board treats `brief` as opaque (it never reaches into it), and it **never
  writes** a run record or an item's frontmatter — the read is a read (`03/ADR-004` read-mostly,
  `19/ADR-002` derived-record both hold; fitness #1).
- **Poll/refresh, not push.** Observability is **poll** over the existing read-mostly board (`SPEC §Scope`,
  `SPEC §Out of scope` — no WebSocket event stream for the work API). The route is an ordinary GET the UI
  re-fetches on the board's existing refresh cadence; there is no new transport and no `/ws/*` member for runs.

**This ADR enumerates EVERY guard the new route trips** (honouring `19/R1` — surface a command and you trip
more than the obvious guard):
1. `15/ADR-005` route↔command **bijection** (`acd-work-command-route-coverage`) — the new `/api/work/run-status`
   route must map to the registered `work:run-status`, and `run-status` must leave `BOARD_DEFERRED` (fitness #2).
2. `08`/`03/ADR-004` inv.3 **no-core-import** (`acd-work-ui-no-core-import`) — the route adds **no** import of
   `run-store.mjs` / `commands/run-*.mjs`; `command-core.mjs` stays the only operation door (fitness #4).
3. `03/ADR-002` **list contract** (`acd-work-list-contract`) — untouched; the new route is additive (fitness #5).
4. `08/ADR-004` command→CLI **bijection** (`acd-work-command-cli-bijection`) — already green for `work:run-status`
   (m19 gave it a `cli` adapter + `argsFor` case); this milestone adds nothing the CLI bijection needs.

**Alternatives considered.**
- *Add a second command/route for current-run state (`work:run-current` / `/api/work/run-current`)* — rejected:
  the current run is just the latest/in-flight element of the `runs[]` the status read already returns; a second
  command duplicates the read, widens the registry, and trips the bijection twice for no new information. One
  read, UI-selected current run (`SPEC §Scope`).
- *Have the board read `runs/` directly (import `run-store.mjs` / `readRuns`)* — rejected: it breaks the
  `08` / `03/ADR-004` inv.3 no-core-import guard (the board would couple to a core module behind the registry),
  re-coupling the board to the store the graph shows is reached only through the commands. The board reads run
  state ONLY through `work:run-status` (`SPEC §Objective`: no side-channel that reads run records behind the
  registry).
- *Project the run records' paths on the board wire (like validate/next/doctor's `displayPath`)* — rejected as
  unnecessary: `19/ADR-003`'s records carry **refs, not absolute paths**, and `work:run-status`'s `cli.json` is
  already a pass-through; there is nothing to relativise. Adding a projection would invent face logic the records
  do not need.
- *Stream run state over a WebSocket (real-time push)* — rejected, OUT of scope (`SPEC §Out of scope`, PRD):
  observability is poll/refresh over the read-mostly board; a push stream is revisited only if the board becomes
  interactive. The run route is an ordinary `/api/work` GET.

**Consequences.** The read path ships as **one additive thin route** + the UI that renders its `{ ref, runs[] }`
(the detail-panel runs view + the current-run-state indicator) + the poll wiring — all in story 00 (the
read/render observability story). No new command-core wiring (the command is already registered), no new write,
no new transport. The `BOARD_DEFERRED` edit re-tightens the route bijection to cover `run-status` while leaving
`run-start`/`run-complete` deferred. The *behaviour* — the runs actually rendering, the current run being
highlighted, the poll refreshing the view in place — is a **story-00 task `.feature`**, NOT a fitness function
(the structural residue is the route's thinness + additivity, fitness #2/#4/#5).

**Invariant.** The board reads run history + current-run state through exactly ONE additive route
`GET /api/work/run-status?ref=` that `invoke`s the already-registered `work:run-status` and serialises its
`{ ref, runs: RunRecord[] }` with ZERO operation logic and no path projection; the board imports no run-core
module (`run-store.mjs` / `commands/run-*.mjs`) — `command-core.mjs` stays the only operation door; the new
route is additive to the frozen `work list --json` 7-field contract and joins the `15/ADR-005` route↔command
bijection (`run-status` leaves `BOARD_DEFERRED`). (Enforced by `acd-work-command-route-coverage` (extended),
`acd-work-ui-no-core-import`, and `acd-work-list-contract`; the runs rendering / current-run highlight / poll
refresh are story-00 `.feature`s.)

## ADR-002: The rerun affordance is the run-observability SURFACING of the existing `03/ADR-006` state-aware terminal launch — it spawns/reveals the agent and the registered `work:run-start` is invoked INSIDE that agent session; the board server adds NO new write and NO command-CLI shell-out, so milestone 21 ships ZERO new board mutation

**Status:** Accepted
**Date:** 2026-06-30

**Context.** The SPEC's third deliverable is a **rerun affordance**: trigger a rerun from the board, resolving
to the same registered `work:run-*` command the CLI would invoke (`SPEC §Scope`). The architectural question is
whether "the board can trigger a run" makes the board a **writer** or an **executor** — and the operator has
already settled it: it must **not** (`STATE §Notes` defers only *how the affordance threads m20's fresh-vs-resume
choice*, not whether the board stays read-mostly). The board's whole discipline is `03/ADR-004`: read-mostly,
one write (the feedback bullet), no `child_process`/shell-out of a command CLI. And `03/ADR-006` already solved
the analogous problem for the *primary* action: a derived `/aof:*` command reaches the agent by being **typed as
ordinary PTY input into the spawned provider**, never executed by the board server — the agent's REPL runs it,
the board only spawns/reveals the terminal. The rerun is the **exact same mechanism**, pointed at the run-lifecycle
verb instead of `/aof:refine|continue|verify`.

**Decision.** The rerun affordance **reuses `03/ADR-006` verbatim** — it is the run-observability surfacing of
the existing state-aware terminal launch, not a new capability:

- **The rerun spawns/reveals the agent terminal bound to the item** (the `03/ADR-001` `/ws/terminal` session,
  the `03/ADR-003` launch contract `ref` + `providerId`), and the registered rerun verb (`work:run-start`) is
  **invoked through the registry INSIDE that agent session** — exactly as a human typing the lifecycle command,
  delivered as ordinary raw PTY-input bytes on the established stream (`03/ADR-006`'s frozen mechanism; no new
  wire frame, no new launch field).
- **The board server performs NO new filesystem write and NO `child_process`/`exec`/`spawn` of a command CLI**
  to trigger the run. The board does not run `work:run-start` itself; the agent's session does. The board's sole
  filesystem mutation **remains** the `03/ADR-004` feedback bullet append. **Therefore milestone 21 adds NO new
  board write at all** — the run observability is reads (ADR-001) + a terminal launch (this ADR), neither of
  which writes.
- **The board OBSERVES the resulting run via `work:run-status` (poll).** After the agent's session mints the
  fresh `running` run (`work:run-start`, under the item's `runs/`), the board sees it on the next poll of the
  ADR-001 read route — the rerun and its observation are decoupled (the launch is fire-and-forget; the state
  shows up through the read path). The board never reads the run it triggered through any side-channel.
- **Milestone 21 ships the FRESH path; m20's resume is a pure additive delta.** The **fresh-vs-resume** choice
  is milestone 20's (`SPEC §Out of scope` — the resilience mechanics). m21 wires the **fresh** rerun:
  `work:run-start` mints a fresh `running` run (`19/ADR-001` initial state, `19/ADR-003` schema). The affordance
  is structured so that m20's resume verb slots in as a **pure additive delta** — the same forward-stability
  discipline by which `19/ADR-001` reserved `queued` for m20 and `19/ADR-003` froze `brief` opaque: the rerun
  resolves a *verb* (today always `work:run-start`); when m20 lands its resume verb, the affordance chooses
  between fresh and resume with **zero** change to this ADR's launch mechanism (still a typed-input terminal
  launch) and zero change to the board's no-write discipline.
- **Run-state vocabulary is NEVER folded into item frontmatter.** The run record's state ramp
  (`queued | running | done | failed | cancelled`, `19/ADR-001`) is a **different vocabulary** from the item's
  derived-status ramp (`not-started | in-progress | in-review | blocked | done`, `03/ADR-002`). The board renders
  the **derived run record** alongside the item's derived status; it never writes the run state into item
  frontmatter and never derives item status from run state (`03/ADR-004` derived-status invariant +
  `19/ADR-002` derived-record invariant both hold). They are two read-only ramps shown side by side.

**Alternatives considered.**
- *Add a `POST /api/work/run-start` board route that `invoke`s `work:run-start` server-side* — rejected: it would
  make the **board server** the thing that mints the run, turning the read-mostly board into a writer (the run
  store writes under `runs/`) and adding a second board mutation — directly breaking `03/ADR-004`. The rerun must
  be the agent's session running the verb, exactly as `03/ADR-006` keeps the primary action's command execution
  inside the agent, never on the server.
- *Have the board shell out `aof work run-start <ref>` as a child process* — rejected: that is the
  board-as-executor anti-pattern `03/ADR-004`/`03/ADR-006` both forbid (`acd-board-write-isolation` already
  asserts no `child_process`/`spawn`/`exec` of a command CLI). The verb reaches the agent as typed PTY input,
  never a server shell-out.
- *Surface a "rerun" that is a board-side re-POST of an old run's brief* — rejected: the brief is the agent's to
  populate (`19/ADR-003` opaque brief; m20 + skills own its contents), and a board-minted brief would put run
  authorship on the server. The rerun is a terminal launch; the agent's session authors the run.
- *Wait for milestone 20 to ship the rerun (couple fresh+resume together)* — rejected: m21 is parallel-eligible
  with m20 (`SPEC §Dependencies` — both consume the m19 foundation, neither consumes the other). Shipping the
  **fresh** path now with a forward-stable affordance (resume as additive delta) keeps m21 independent, exactly
  as `19/ADR-001` shipped `running` and reserved `queued` for m20.

**Consequences.** The rerun affordance ships as **pure UI layering on `03/ADR-006`**: the detail-panel surfaces
a rerun action that spawns/reveals the bound agent terminal and types the run-lifecycle verb (`work:run-start`)
as initial input — the agent runs it, the board observes the result via ADR-001's poll. The board gains **no**
new write and **no** command-CLI shell-out, so `03/ADR-004`'s "only write is the feedback bullet" and "no
`child_process` of a command CLI" both still hold — backstopped by `acd-board-write-isolation` (which this
milestone EXTENDS to assert the run/rerun surface adds no new write and no shell-out — fitness #1). The fresh-run
behaviour, the live-session "view"/duplicate-launch handling, and the m20 fresh-vs-resume wiring are **story-01
task `.feature`s**, NOT fitness functions (mirroring `03/ADR-006`, which deferred the status→command derivation
to story `.feature`s and leaned on the two existing structural guards).

**Invariant.** The rerun affordance reaches the run-lifecycle command (`work:run-start`) ONLY by spawning/revealing
the agent terminal and invoking it through the registry INSIDE that agent session (the `03/ADR-006` typed-PTY-input
launch — no new wire frame, no new launch field); the board server performs NO new filesystem write and NO
`child_process`/`exec`/`spawn` of a command CLI to trigger the run — the board's sole mutation remains the
`03/ADR-004` feedback bullet, so milestone 21 adds ZERO new board write. The run-state vocabulary is never folded
into item frontmatter (the board renders the derived run record, never writes item status). The fresh path ships
now; m20's resume is a pure additive delta. (The two structural halves are enforced by `acd-board-write-isolation`
(extended — no new write / no command-CLI shell-out for the run/rerun surface) and `acd-work-ui-no-core-import`
(the board reaches runs only through the registry); the fresh-run / resume-delta behaviour is story-01 `.feature`s.)

## ADR-003: Envelope + guard ADDITIVITY — the new read route is purely additive to the m03 board envelope, and the m08/m15 bijection + no-core-import + m03 list-contract guards all stay green; observability adds no new structural guard beyond extending the route-coverage carve-out and the write-isolation surface

**Status:** Accepted
**Date:** 2026-06-30

**Context.** ADR-001 adds a route and ADR-002 adds a UI affordance. The remaining architectural question
(`STATE §Notes` — "confirming the additive board envelope stays within the frozen milestone-03 shapes + the
milestone-08 bijection/no-core-import guards") is the *cross-cutting* one: does this milestone preserve every
frozen envelope and guard, or does it need a NEW structural guard of its own? `19/R1` warns that surfacing a
command-core command trips more guards than the obvious one — so this ADR enumerates the full guard surface and
fixes, deliberately, where each lands.

**Decision.** Milestone 21 is **purely additive** to the m03 board envelope and the m08/m15 guard set, and it
introduces **no brand-new structural guard** — it EXTENDS two existing ones and leaves three untouched:

- **`03/ADR-002` list contract — UNTOUCHED.** The new `/api/work/run-status` route does not alter the frozen
  7-field `work list --json` contract or any existing route shape. `acd-work-list-contract` stays green with no
  edit (fitness #5).
- **`15/ADR-005` route↔command bijection — EXTENDED (carve-out shrinks).** Adding the `/api/work/run-status`
  route means `work:run-status` is no longer board-deferred. The fix is precisely a **one-line edit** to
  `acd-work-command-route-coverage`'s `BOARD_DEFERRED` set: it drops `run-status` (keeping `run-start` +
  `run-complete`, which are NOT board routes — they reach the agent via ADR-002). The bijection then re-tightens
  to cover the new route, exactly as m19's RETROSPECTIVE foretold ("when milestone 21 wires the board routes,
  these entries come out and the bijection re-tightens with no further edit"). This is fitness #2.
- **`08`/`03/ADR-004` inv.3 no-core-import — UNTOUCHED (and re-asserted).** The board still imports only
  `command-core.mjs` for operations; the run route adds no `run-store.mjs` / `commands/run-*.mjs` import.
  `acd-work-ui-no-core-import` stays green and is the guard that catches any regression where a future hand
  reaches the store directly (fitness #4).
- **`03/ADR-004` write isolation — EXTENDED to the run/rerun surface.** The board adds no new write and no
  command-CLI shell-out (ADR-001 read + ADR-002 launch are both write-free). `acd-board-write-isolation` is the
  guard, EXTENDED to assert the new run route + the rerun path introduce no new `writeFile`/`appendFile` call
  site on the board and no `child_process`/`spawn`/`exec` of a command CLI (fitness #1). This is the deliberate
  decision the brief flagged: **EXTEND the existing `acd-board-write-isolation` guard** rather than add a sibling
  `acd-board-run-read-only` test — the invariant ("the board's only write is the feedback bullet; no command-CLI
  shell-out") is unchanged in *kind*; the run/rerun surface is just one more place it must hold, so it belongs in
  the one guard that already owns that lens, not a parallel near-duplicate.
- **`08/ADR-004` command→CLI bijection — UNTOUCHED.** Already green for the three `work:run-*` commands (m19 gave
  each a `cli` adapter + `argsFor` case); m21 adds nothing the CLI bijection needs.

**Alternatives considered.**
- *Add a new `acd-board-run-read-only` arch-test for the run route's no-write property* — rejected: it would
  duplicate `acd-board-write-isolation`'s lens (the board has exactly one write, no command-CLI shell-out). The
  run/rerun surface is the same invariant in a new place; extending the existing guard keeps one authority for
  "the board's filesystem footprint" rather than two tests that could drift. (Recorded explicitly per the brief's
  EXTEND-vs-sibling decision.)
- *Add a bespoke `acd-board-run-route-additive` test asserting the list contract is unchanged* — rejected:
  `acd-work-list-contract` already pins the 7-field contract on the emitted JSON; a route that does not touch
  `work:list` cannot change it, and the route-coverage bijection already proves the new route is a *registry*
  member, not an envelope mutation. No new test earns its keep.
- *Defer the `BOARD_DEFERRED` edit and leave `run-status` carved out* — rejected: that would make the bijection
  LIE — a served `/api/work/run-status` route with no covering bijection entry is precisely the "UI route without
  a command" failure `15/ADR-005` exists to catch. The carve-out must shrink the moment the route ships
  (`19/R1` — enumerate every guard the surfacing trips).

**Consequences.** Milestone 21's structural footprint is: ONE new route, ONE `BOARD_DEFERRED` carve-out edit, and
ONE extension to `acd-board-write-isolation` — no new arch-test file is created. Three guards
(`acd-work-list-contract`, `acd-work-ui-no-core-import`, `acd-work-command-cli-bijection`) stay green untouched;
two (`acd-work-command-route-coverage`, `acd-board-write-isolation`) are extended. The behavioural surface (runs
rendering, current-run highlight, poll refresh, rerun spawning a session) lives in the two stories' `.feature`s,
per the house split.

**Invariant.** Milestone 21 is purely additive: it adds ONE `/api/work` route and edits NO frozen envelope; the
`03/ADR-002` list contract, the `08`/`03/ADR-004` inv.3 no-core-import guard, and the `08/ADR-004` command→CLI
bijection all stay green untouched; the `15/ADR-005` route↔command bijection re-tightens by dropping `run-status`
from `BOARD_DEFERRED`; and the `03/ADR-004` write-isolation guard is EXTENDED (not duplicated) to cover the
run/rerun surface. No new structural guard is introduced. (Enforced by the existing
`acd-work-list-contract` + `acd-work-ui-no-core-import` + `acd-work-command-cli-bijection` (untouched) and the
extended `acd-work-command-route-coverage` + `acd-board-write-isolation`.)

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is the correct state now: the /api/work/run-status route does not exist yet and
     run-status is still board-deferred, so the route-coverage extension fails cleanly until the owning
     story lands. The "From" column names the story (per the two-story partition below) that BUILDS the
     test edit. Behaviour (the runs rendering, the poll refreshing, the rerun spawning a session) is
     OUT of this table — those are story task .feature files, per the house split. -->

| Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|
| **No new board write / no new command-CLI shell-out (run + rerun).** The run read route AND the rerun affordance add NO new filesystem-write call site (`writeFile`/`appendFile`) and NO `child_process`/`spawn`/`exec`/`execFile` of a command CLI to the board server; the board's only write remains the `03/ADR-004` feedback bullet (ADR-002/ADR-003). | `test/arch/acd-board-write-isolation.test.mjs` — **EXTENDED** (the brief's explicit EXTEND-not-sibling decision): keep the existing `board-ui.mjs` has-no-`writeFile`/`appendFile` + no-`child_process`/`spawn`/`exec` assertions; add that the new `/api/work/run-status` route and any rerun-launch wiring on the board face introduce no new write call site and no command-CLI shell-out string (comments discounted per the call-form discipline); the board's sole write stays the feedback helper. | RED until the run route + rerun affordance land (the extended assertion has no route to cover yet) | **00 · run-observability** (route no-write) + **01 · rerun-affordance** (rerun no-write) |
| **Run reads go through the registry (bijection re-tightens).** The board's run read route maps to the registered `work:run-status`, and `run-status` LEAVES the `BOARD_DEFERRED` carve-out so the `15/ADR-005` `/api/work` ↔ `work:*` bijection covers it; `run-start` + `run-complete` STAY deferred (not board routes) (ADR-001/ADR-003). | `test/arch/acd-work-command-route-coverage.test.mjs` — **EXTENDED**: drop `run-status` from `BOARD_DEFERRED = new Set([...])` so the registry-derived bijection re-tightens; the existing two-way assertions (every served `/api/work/<op>` maps to a registered `work:<op>`, every non-deferred `work:*` has a served route) then require the new `/api/work/run-status` route to exist and to invoke `work:run-status`. The behavioural loop hits `/api/work/run-status?ref=…` and asserts a JSON envelope via the registry (not an unrouted 404). | RED (the bijection fails — `run-status` is no longer deferred but the `/api/work/run-status` route does not exist yet) until story 00 adds the route | **00 · run-observability** |
| **No-core-import holds (run route).** `src/board-ui.mjs` reaches run state ONLY through `./command-core.mjs`; it adds NO direct import of `src/run-store.mjs` or `src/commands/run-*.mjs`, and makes no run-store filesystem call of its own — the registry stays the single operation door (ADR-001/ADR-003; `08`/`03/ADR-004` inv.3). | `test/arch/acd-work-ui-no-core-import.test.mjs` — UNCHANGED in mechanism, RE-ASSERTED by this milestone: its operation-bearing-import deny-list (`./work.mjs`, `./feature-parse.mjs`, `./commands/*`) already catches a `./run-store.mjs` / `./commands/run-*.mjs` import; the run route must keep `./command-core.mjs` as the only operation door. (If the deny-list is made explicit, add `./run-store.mjs` to it — but the existing `./commands/*` + non-door rules already cover it.) | GREEN today (no run-core import exists) and must STAY green when the route lands — RED only if story 00 wrongly imports the store | **00 · run-observability** |
| **Read-route additivity (list contract untouched).** The new `/api/work/run-status` route does not alter the frozen `work list --json` 7-field contract and returns the `work:run-status` `{ ref, runs: RunRecord[] }` shape (ADR-001/ADR-003; `03/ADR-002`). | `test/arch/acd-work-list-contract.test.mjs` — UNCHANGED, stays green: it pins `work list --json` to the flat 7-field array on the emitted JSON; a run-status route that does not touch `work:list` cannot change it. (Additivity of the run route is proved by the route-coverage bijection above, which shows it is a registry member, not an envelope mutation — no new test needed.) | GREEN and must stay green (the route is additive) | **00 · run-observability** |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors milestone 03/19's split):
     - The four rows above are STRUCTURAL invariants over the board's write surface, the registry door,
       the route↔command bijection, and the frozen list envelope → arch-tests (this table). They are
       milestone 21's load-bearing structural deliverable, and they are all EXTENSIONS/RE-ASSERTIONS of
       existing m03/m08/m15 guards — milestone 21 adds NO new arch-test file (ADR-003).
     - The OBSERVABLE behaviours — "the detail panel renders an item's prior runs (runId/state/attempt/
       outcome/when) from /api/work/run-status", "the current/in-flight run is highlighted", "the view
       refreshes in place on poll without tearing down a live terminal", and "the rerun action spawns/
       reveals the bound agent terminal and the run shows up via the next poll" — exercise the real route,
       the real registry, the real UI and the real terminal launch. They belong in the two stories' task
       .feature files, NOT here (mirroring 03's split of structural-arch-test vs behavioural-scenario, and
       06's "the degrade TABLE is an arch-test; the wrapped session ACTUALLY spawning is a .feature").
     - The m20 fresh-vs-resume wiring is a forward-stable additive delta (ADR-002) — when it lands, the
       rerun affordance chooses fresh|resume with no change to the no-write guard; that choice is m20's
       behaviour, not a m21 fitness function. -->

## Story break-down rationale

<!-- Informs the PO's break-down; does NOT itself create stories. Advisory — the PO draws the final
     partition. The proposed cut follows the real call/dependency coupling the codebase graph reports,
     not inferred coupling. -->

The PO will partition milestone 21, and the boundary follows the **real call/dependency coupling** the codebase
graph reports (`aof graph build src` → 1061 nodes / 2872 edges, 89 files cached/unchanged; `aof graph impact`
re-run at author time — cited as **actual** structure, not inferred). This milestone is a **FACE addition** — a
server read route + UI render + a rerun affordance — so the cut is along the two *shapes* of work the SPEC names,
which the graph confirms touch overlapping-but-containable modules:

- **00 · run-observability (read/render)** — the `GET /api/work/run-status` board route (the thin face,
  ADR-001) + the detail-panel **runs view** + the **current-run-state indicator** + the **poll/refresh** wiring.
  Touches `src/board-ui.mjs` (the new route), `ui/src/board/api.ts` (the `workApi.runStatus(ref)` client +
  the `RunRecord` wire type), `ui/src/board/DetailPanel.tsx` (the runs view + current-run indicator), and
  `ui/src/board/Board.tsx` (the poll wiring, reusing the existing `load({silent})` refresh idiom). Owns the
  read-path fitness functions: #2 (route bijection re-tightens), #3 (no-core-import on the route), #4 (list
  contract untouched), and the route half of #1 (the run route adds no write).
- **01 · rerun-affordance** — the UI affordance that reuses the `03/ADR-006` terminal-launch (resolves to
  `work:run-start`; m20 fresh-vs-resume is an additive delta, ADR-002). Touches `ui/src/board/DetailPanel.tsx`
  (the rerun action on the primary/secondary action surface), `ui/src/board/action.mjs` (the rerun verb
  resolution alongside the existing `primaryAction` status→command derivation), and `ui/src/board/Board.tsx`
  (reusing the existing `runAgent(ref, command)` → `TerminalDock` launch — the affordance is a new caller of an
  existing launch path, NOT a new launch mechanism). Owns the rerun half of fitness #1 (the rerun path adds no
  board write and no command-CLI shell-out).

**Why this boundary is grounded in the graph, not inferred:**

1. **The read story produces a read-model the rerun story consumes — a single forward dependency.** `aof graph
   impact src/board-ui.mjs` confirms the board's only operation door is `command-core.mjs`, and `aof graph impact
   src/command-core.mjs` confirms `work:run-status` is **already registered** — so story 00's route is a thin
   additive face over an existing command (zero new core wiring), and it produces the `{ ref, runs[] }`
   read-model. Story 01's rerun observes its result *through* that read-model (ADR-002: the board sees the
   reran run via the ADR-001 poll). The dependency is therefore **one-directional** (rerun depends on the read
   route for post-launch state; the read route depends on neither) — the topological order the SPEC's
   "history/current-state first, then rerun" framing already implies, and the graph confirms by showing
   `work:run-status` as the standalone read the launch does not touch.

2. **The rerun story's launch is the INDEPENDENT `03/ADR-006` mechanism — it adds no new wiring the read story
   owns.** `aof graph impact` shows the rerun reaches the agent through the existing `runAgent → TerminalDock →
   /ws/terminal` path (`Board.tsx`'s `runAgent(ref, command)` is already the caller of the launch; `action.mjs`
   already derives a typed command). The rerun affordance is a **new caller of an existing launch**, on the
   disjoint `/ws/terminal` namespace (`03/ADR-001`), NOT on `/api/work`. So its launch is independent of story
   00's read route — it needs no board HTTP route to spawn (exactly as `03/ADR-005` kept the terminal story
   independent of the board HTTP story). The graph shows the run/rerun launch couples to the terminal namespace,
   never to the run-status route.

3. **The residual coupling is the detail panel + the shared run-status read — and it is contained.** Both
   stories live in `ui/src/board/DetailPanel.tsx` (the read story adds the runs view; the rerun story adds the
   rerun action) and both relate to the run-status read (the read story produces it; the rerun story consumes it
   for post-launch state). This is real co-location, not a build-order dependency: the read story owns the
   **read-model + route + render**, and the rerun story consumes that read-model for the "did my rerun show up"
   state while its **launch is the independent ADR-006 terminal mechanism**. The panel co-touch is the same
   mechanical residual `03/ADR-005` named (two stories registering on one surface in their own regions) — the
   read story renders the runs region; the rerun story adds an action button — contained because neither edits
   the other's region and the only shared artifact is the read-model the route emits, which is a checked-in wire
   shape (the `RunRecord` type), fixturable on its own.

**If the graph argued for a finer cut, I would say so** — but it does not. A three-way split (route / runs-view /
rerun) would invent a cross-story dependency on the shared detail-panel + read-model with no parallelism gain
(the route and its render are one thin vertical the graph shows as a single additive face). A one-story merge
would couple the independent `03/ADR-006` launch mechanism to the read route for no reason. The **two-story**
cut — read/render observability, then the rerun affordance that consumes it — is the partition the real coupling
supports. The coupling is **advisory**: it informs why read-first is the right cut (the read-model is the
dependency root the rerun observes through), but the PO draws the final partition. The graph confirms — it does
not dictate.
