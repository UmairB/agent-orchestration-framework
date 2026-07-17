---
type: story
number: 00
slug: command-core
title: "The command core — one in-process registry of the six work operations, the bespoke board-ui logic moved in"
parent: 08
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-21
schema: 1
aofVersion: 0.1.0
---
# 00 · The command core — the in-process registry (the spine)

## User story

As the command core both faces couple through (and as the three sibling stories that build the CLI face, the board face, and the enforcement),
I want one in-process registry where the six `/api/work` operations (`list`, `doc`, `tasks`, `validate`, `next`, `feedback`) are registered with a frozen `{ id, input, run, cli } → result` contract — with the bespoke `doc`/`tasks`/`feedback` logic moved *out of* `board-ui.mjs` and *into* commands,
so that every operation has exactly one home (the source of truth) and both faces invoke the same core instead of the board carrying UI-only operation logic.

<!-- This is the SPINE the milestone exists to make safe: it freezes the ONE contract (the registry,
     the command/result shape, the basis-neutral result) that the other three stories couple through.
     It owns no CLI dispatch and no board route wiring — only the registry and the six command bodies. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 08/00`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] **00 · [registry-contract](tasks/00_registry-contract.feature)** — the registry surface (`getCommand`/`listCommands`/`invoke`), the frozen `{id,input,run,cli}` shape, exactly the six commands registered, each CLI-runnable-shaped.
- [x] **01 · [read-commands](tasks/01_read-commands.feature)** — `work:doc` + `work:tasks`: `resolveItem` slug-fallback, present:false / `[]` on absent content, `ref-not-found` on unresolved, `invalid-doc` on a bad doc name.
- [x] **02 · [basis-neutral-paths](tasks/02_basis-neutral-paths.feature)** — `work:validate` + `work:next` + `work:list` return basis-neutral data; `run` emits raw absolutes (list.dir as listStream emits), no projection (the ADR-002 keystone).
- [x] **03 · [feedback-write-command](tasks/03_feedback-write-command.feature)** — `work:feedback`: `resolveItemExact` (exact-only), one attributed bullet under the verbatim heading, milestone/story-only, the sole write.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md). This story **owns**:
`src/command-core.mjs` — the registry (`getCommand` / `listCommands` / `invoke` + the frozen
`{ id, input, run, cli } → result` contract, **ADR-002**) — and `src/commands/{list,doc,tasks,validate,next,feedback}.mjs`
(the six command bodies). It moves the bespoke `handleDoc` / `handleTasks` / `handleFeedback` /
`appendFeedbackBullet` logic and the `resolveItem` / `resolveItemExact` resolvers **out of
[board-ui.mjs](../../../../../src/board-ui.mjs)** and into the commands. It *calls* the existing
[work.mjs](../../../../../src/work.mjs) exports (`listStream` / `validateWork` / `nextWork` / `findWork`) —
it does **not** rewrite them. It does **not** touch `cli.mjs` dispatch or `board-ui.mjs` routes (those are
stories 01 / 02).

**Independent because** it consumes nothing new — only the already-shipped `work.mjs` / `feature-parse.mjs`
cores — and produces the ONE frozen contract (ADR-002) that 01 / 02 / 03 consume; it is the spine they
fan out from, and it consumes none of their surfaces. The keystone is ADR-002's **basis-neutral result**:
`run` returns raw absolute paths (or, for `list`, `dir` exactly as `listStream` emits), and path display is
a *face* adapter — which is what lets the same command serve both faces byte-for-byte.

**Feasibility (developer amigo seat — confirmed at Contract):** a **re-home, not new logic** — every piece
the six commands need already lives in `board-ui.mjs` / `work.mjs`. The one hard call (basis-neutral raw
paths so neither face has to *un*-project, lossy on Windows separators) is resolved in ADR-002. `work.mjs`'s
mechanics stay; the commands wrap them behind the registry.
