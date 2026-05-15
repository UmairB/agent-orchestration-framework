# Phase 30: Agent Assignment And Execution - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 30 connects board tasks to GSD-controlled execution. It lets users assign an executable task to an AOF-defined agent, starts the appropriate GSD ceremony for the task's one-to-one phase reference, and records execution state, logs, failures, and resume/handoff context in `.aof/boards`.

This phase builds on Phase 28 board/task files and Phase 29 objective breakdown proposals. It does not build the full kanban UI; Phase 31 will surface the execution state visually.

</domain>

<decisions>
## Implementation Decisions

### Assignment Trigger
- **D-01:** Assigning a task to an agent should immediately start GSD execution.
- **D-02:** Assignment is not just metadata. Phase 30 should attempt to start the GSD lifecycle as part of the assignment flow.

### Available Agents
- **D-03:** Available agents come from `.aof/aof.config.json` agent resources.
- **D-04:** Assignment should reject unknown agents unless they are defined as AOF `agent` resources.
- **D-05:** Do not create a separate `.aof/agents` or board-local agent registry in this phase.

### GSD Execution Path
- **D-06:** Execution should rely on GSD ceremonies rather than an ad hoc task runner.
- **D-07:** For an assigned task, AOF should route through `discuss-phase`, `plan-phase`, and `execute-phase` as needed.
- **D-08:** If `discuss-phase` requires user input, that is acceptable. The execution record should surface that it is waiting for user input.
- **D-09:** The goal is to let GSD update `.planning/` artifacts correctly instead of bypassing GSD lifecycle state.
- **D-10:** Abstract the execution framework behind a provider/interface boundary. GSD is the v1.6 implementation, but task state management should not be tightly coupled to GSD-specific code.
- **D-11:** Keep board/task/execution state framework-neutral enough that a future execution framework could replace GSD while preserving `.aof/boards` state.

### Task-To-Phase Mapping
- **D-12:** Executable board tasks have a one-to-one correspondence with GSD phases for the GSD provider.
- **D-13:** A task must include a phase reference before it can be assigned/executed by the GSD provider.
- **D-14:** Tasks without a phase reference may exist, but assignment/execution should fail or block with a clear diagnostic until the task is linked to a phase.

### Execution State Model
- **D-15:** Keep board lifecycle status separate from execution state.
- **D-16:** Board status remains one of `backlog`, `ready`, `in_progress`, `blocked`, or `done`.
- **D-17:** Add a task execution sub-state with at least `queued`, `running`, `waiting_for_user`, `blocked`, `failed`, and `complete`.
- **D-18:** When GSD needs user input, set execution status to `waiting_for_user` and keep the board status `in_progress`.
- **D-19:** On failed or blocked execution, preserve context and set board status to `blocked`.

### Execution Records
- **D-20:** Detailed execution records live beside tasks under `.aof/boards/<board-id>/executions/<task-id>.json`.
- **D-21:** Task files should mirror a compact assignment/execution summary so lists and UI APIs do not need to read full execution logs for every task.
- **D-22:** Execution files should record detailed lifecycle state, logs, attempts, resume pointers, provider name, provider-specific refs, and handoff context.

### UI Console And User Input
- **D-23:** If execution requires user input, Phase 30 should record enough structured state for the setup UI to show a console/log view and prompt for input later.
- **D-24:** Streaming execution output to the UI is technically possible through the local setup server using SSE, WebSocket, or polling an append-only execution log. Phase 30 should avoid blocking this; Phase 31 should decide and implement the visible UI transport.
- **D-25:** Phase 30 should expose execution log/read APIs or file state that Phase 31 can consume without coupling the UI directly to GSD internals.

### the agent's Discretion
- Choose exact CLI subcommands and JSON field names consistent with the existing `aof boards ...` namespace.
- Choose exact failure diagnostic codes and execution attempt shape.
- Choose how to invoke or represent GSD ceremony execution in tests as long as no real network or destructive external process is required.
- Choose whether Phase 30 implements a dry-run/preview flag, but assignment must have a testable non-network path.
- Choose the provider abstraction shape, but do not over-generalize beyond a clean GSD provider boundary.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone And Phase Scope
- `.planning/PROJECT.md` — v1.6 Task Management milestone intent and product constraints.
- `.planning/REQUIREMENTS.md` — EXEC-01 through EXEC-05 requirements.
- `.planning/ROADMAP.md` — Phase 30 goal, success criteria, and planned wave structure.
- `.planning/STATE.md` — current milestone state and recent phase completion position.

### Prior Phase Decisions
- `.planning/phases/28-board-and-task-state-foundation/28-CONTEXT.md` — canonical `.aof/boards` state, fixed board statuses, index/cache contract, and GSD integration direction.
- `.planning/phases/29-gsd-objective-breakdown/29-CONTEXT.md` — proposal-first objective breakdown, task refs, and explicit exclusion of agent assignment from Phase 29.

### Existing Implementation
- `src/boards.mjs` — board/task canonical file operations, status validation, index generation, and task history.
- `src/board-breakdown.mjs` — objective proposal task creation and refs shape.
- `src/cli.mjs` — `aof boards ...` namespace and output style.
- `src/setup-ui.mjs` — setup UI board API routes and JSON error patterns.
- `src/dsl.mjs` — AOF config loading and resolved resource shape, including agent resources.
- `src/config-inspect.mjs` — validation diagnostics and config checking patterns.

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — CLI orchestration, setup UI API, and module boundary patterns.
- `.planning/codebase/INTEGRATIONS.md` — local filesystem and GSD/package integration constraints.
- `.planning/codebase/STACK.md` — Node ESM CLI stack and test command expectations.

### GSD Runtime Context
- `.codex/config.toml` — installed GSD agent config entries and hook configuration.
- `.codex/hooks/gsd-workflow-guard.js` — GSD workflow guard behavior.
- `.codex/hooks/gsd-context-monitor.js` — GSD context and resume breadcrumb behavior.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/boards.mjs` can be extended with assignment/execution update helpers or used by a new execution module.
- `src/board-breakdown.mjs` already stores task refs that can link generated tasks to phase/objective artifacts.
- `src/cli.mjs` has the `aof boards` command namespace where assignment and execution inspection commands should live.
- `src/setup-ui.mjs` already exposes board APIs; Phase 30 can add backend execution APIs without building the Phase 31 visual UI.
- `src/dsl.mjs` and `src/config-inspect.mjs` can provide the AOF config/agent-resource lookup contract.

### Established Patterns
- Canonical project-local state belongs under `.aof/`.
- `.planning/` is GSD-owned; AOF may reference it but should let GSD ceremonies update it.
- New CLI behavior requires Node BDD and PowerShell parity.
- Generated/cache state must remain distinguishable from canonical task/execution state.
- Setup UI APIs should mirror CLI semantics rather than inventing separate behavior.

### Integration Points
- Add assignment/execution operations in a focused module rather than embedding all logic in `src/cli.mjs`.
- Add commands under `aof boards task assign` or similar.
- Add inspection commands/API routes for execution state and handoff context.
- Add tests that simulate GSD ceremony progression without requiring real interactive GSD agent execution.

</code_context>

<specifics>
## Specific Ideas

### Assignment Contract

Assignment should look up agents from `.aof/aof.config.json` resources where `kind === "agent"`. Unknown agents should be rejected.

### GSD Ceremony Contract

Executable task refs must include a GSD phase reference. Assignment/execution routes that phase through:

```text
discuss-phase
plan-phase
execute-phase
```

The implementation should preserve the fact that `discuss-phase` may require user input.

### Provider Abstraction

GSD should be treated as the first execution provider, not baked into the board/task state model. Provider-specific fields should be nested or clearly labeled so a future provider can reuse the same task/execution records.

### UI Console Feasibility

Streaming user-visible console output is feasible for the local setup UI. The likely implementation options are:

```text
SSE from setup server
WebSocket from setup server
polling .aof/boards/<board>/executions/<task>.json or an append-only log
```

Phase 30 should create the durable execution/log state and APIs. Phase 31 should turn that into visible console output and user input controls.

### Execution State Split

Task file:

```text
.aof/boards/<board-id>/tasks/<task-id>.json
```

Detailed execution record:

```text
.aof/boards/<board-id>/executions/<task-id>.json
```

Task should store a compact summary; execution file should store attempts, logs, status transitions, command/phase refs, and resume/handoff pointers.

</specifics>

<deferred>
## Deferred Ideas

- Visual kanban display of assignment and progress belongs to Phase 31.
- Visible console streaming and user input controls belong to Phase 31, though Phase 30 should provide the state/API foundation.
- Full live UAT across breakdown, assignment, execution, and UI belongs to Phase 32.
- A separate global or board-local agent registry is deferred unless a future phase scopes it.
- Automatically executing tasks without GSD phase refs is deferred; Phase 30 requires one task per GSD phase.

</deferred>

---

*Phase: 30-Agent Assignment And Execution*
*Context gathered: 2026-05-15*
