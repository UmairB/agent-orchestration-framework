# Phase 31 Context: Kanban Setup UI

## Decisions

- Add boards as a first-class section inside the existing setup UI shell.
- Keep `.aof/boards` as canonical state and use existing setup UI APIs for board operations.
- Use Phase 30 assignment APIs for agent assignment and execution progress display.
- Keep Phase 31 focused on project-local boards; global task hub remains future scope.
- Use refreshed/polled state for progress visibility in v1.6; live streaming can build on the same execution APIs later.

## Scope

- View boards and board columns.
- Create boards and tasks.
- Edit task metadata.
- Move tasks across lifecycle columns.
- Assign tasks to configured agents.
- Archive boards.
- Show execution state and board diagnostics.
