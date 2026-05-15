# Phase 30: Agent Assignment And Execution - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 30-Agent Assignment And Execution
**Areas discussed:** Execution path, available agents, task refs, execution state, logs and resume context, waiting/failure behavior, provider abstraction, UI console feasibility

---

## Execution Path

| Option | Description | Selected |
|--------|-------------|----------|
| Queue execution record, then provide/run command | Assignment creates a durable queued record with exact GSD command/resume context. | |
| Immediately spawn/run GSD execution | Assignment starts the GSD workflow right away and records live status. | ✓ |
| Hybrid | Create queued record first, then auto-run only when an explicit flag or UI action requests it. | |

**User's choice:** Immediately start GSD execution.
**Notes:** Assignment should be action-oriented rather than metadata-only.

---

## Available Agents

| Option | Description | Selected |
|--------|-------------|----------|
| Configured GSD agents only | Read available agents from installed GSD/Codex config. | |
| AOF agent registry | Add separate `.aof/agents` or board-level agent config. | |
| Free-form agent id with warning | Allow arbitrary IDs and warn if missing. | |
| AOF config agent resources | Use `agent` resources from `.aof/aof.config.json`. | ✓ |

**User's choice:** Use agents defined in `.aof/aof.config.json`.
**Notes:** Assignment should reject unknown agents unless defined as AOF agent resources.

---

## GSD Ceremony Routing

| Option | Description | Selected |
|--------|-------------|----------|
| Task-specific quick execution | Run a generated prompt for the board task directly. | |
| Phase/plan execution mapping | Use task refs to route through GSD phase ceremonies. | ✓ |
| Agent-specific command template | Let each agent resource define an execution command/template. | |

**User's choice:** Route through GSD ceremonies.
**Notes:** User specifically wants to rely on GSD and its `discuss-phase`, `plan-phase`, and `execute-phase` ceremonies so planning artifacts are updated correctly. `discuss-phase` may require user input, which is acceptable.

---

## Provider Abstraction

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-code GSD | Treat GSD-specific commands and state as the task execution model. | |
| Provider boundary | Use GSD as the first provider behind an execution framework abstraction. | ✓ |
| Fully generic plugin system | Build a broad execution provider plugin architecture now. | |

**User's choice:** Abstract the execution framework as much as possible while keeping GSD as the current provider.
**Notes:** Task state management should survive swapping GSD for another execution framework later.

---

## Task Refs

| Option | Description | Selected |
|--------|-------------|----------|
| Require phase ref | Task must reference a GSD phase before assignment/execution. | ✓ |
| Allow objective-only fallback | Route missing phase tasks back through objective breakdown first. | |
| Allow assignment but block execution | Record assigned agent but block execution until refs exist. | |

**User's choice:** Require phase ref.
**Notes:** Tasks should have a one-to-one correspondence with phases.

---

## Execution State

| Option | Description | Selected |
|--------|-------------|----------|
| Execution sub-state on task | Keep board status separate and add `execution.status`. | ✓ |
| Reuse board status only | Map execution directly to kanban columns. | |
| Separate execution files only | Keep all execution state outside task files. | |

**User's choice:** Add an execution sub-state on the task.
**Notes:** Board lifecycle and execution lifecycle should be separate.

---

## Logs And Resume Context

| Option | Description | Selected |
|--------|-------------|----------|
| Execution files beside tasks | Store detailed logs/handoffs under `.aof/boards/<board>/executions/<task-id>.json`, mirror summary on task. | ✓ |
| Everything inside task file | Keep one large task file with logs and resume details. | |
| Only refs to GSD artifacts | Store no AOF execution logs, only pointers. | |

**User's choice:** Execution files beside tasks, with summary mirrored on task.
**Notes:** Keeps task files readable while preserving detailed execution history.

---

## Waiting And Failure Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Waiting means board blocked | `waiting_for_user` execution state and board `blocked`. | |
| Waiting means in progress | `waiting_for_user` execution state and board `in_progress`. | ✓ |
| Only execution state changes | Keep board status unchanged. | |

**User's choice:** Waiting for user keeps board `in_progress`.
**Notes:** User accepted that `discuss-phase` may pause for input.

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve context and block board | Store error/handoff, execution `failed` or `blocked`, board `blocked`. | ✓ |
| Preserve context but keep in progress | Failure only affects execution state. | |
| Retry automatically once | Retry before marking failed/blocked. | |

**User's choice:** Preserve context and set board `blocked` on failure/blocked execution.
**Notes:** Failures need to be visible and resumable.

---

## UI Console Feasibility

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 30 only records logs | UI can poll/read persisted execution state later. | |
| Phase 30 enables streamable logs, Phase 31 renders UI | Persist logs and expose enough state/API for SSE/WebSocket/polling UI. | ✓ |
| Build full console UI in Phase 30 | Implement visible streaming console now. | |

**User's choice:** Investigate/enable console output in the UI when user input is required.
**Notes:** This is feasible with the local setup server, likely via SSE, WebSocket, or polling execution logs. Visible UI belongs to Phase 31; Phase 30 should not block it.

---

## the agent's Discretion

- Exact command names under `aof boards`.
- Exact execution JSON shape and diagnostic code names.
- Exact test harness strategy for simulating GSD ceremony execution.
- Provider interface shape.
- UI log transport details, as long as Phase 30 leaves a clean foundation.

## Deferred Ideas

- Separate agent registry beyond `.aof/aof.config.json`.
- Visual progress UI.
- Visible console streaming and user input controls.
- Executing tasks without one-to-one GSD phase refs.
