---
type: story
number: 03
slug: mesh-ui-global-scope
title: "Mesh UI global scope — default global view with --local current-workspace filter"
parent: 34
status: in-progress
owner: product-owner
created: 2026-07-04
updated: 2026-07-04
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 03 · Mesh UI global scope — global by default, local on request

## User story

As a control-node operator opening `aof mesh ui`, I want the default view to show machine-wide mesh work and
nodes, while `aof mesh ui --local` shows only the current workspace, so I can switch between fleet operations
and focused workspace diagnosis deliberately.

## Tasks

- [ ] [00 · CLI scope selection](tasks/00_cli-scope-selection.feature)
- [ ] [01 · mesh UI API scope switch](tasks/01_mesh-ui-api-scope-switch.feature)
- [ ] [02 · fleet UI scope rendering](tasks/02_fleet-ui-scope-rendering.feature)
- [ ] [03 · empty, error, and health states](tasks/03_empty-error-and-health-states.feature)

## Fitness units

- `acd-mesh-ui-global-default` — `aof mesh ui` and `/api/mesh/status` default to the global projection
  query surface and do not invoke the workspace-local `mesh:status` command for global reads.
- `acd-mesh-ui-local-filter-preserves-status` — `aof mesh ui --local` uses the current workspace and keeps
  the existing `mesh:status` aggregate semantics.
- `acd-mesh-ui-scope-visible` — the rendered fleet UI makes Global vs Local scope visible in the top-level
  shell and keeps the selected scope across refresh/poll cycles.

## Notes

Owns CLI parsing for `--local`, the mesh UI query/API scope switch, global/default UI state, local filter
state, and the binding checklist in [DESIGN.md](../../DESIGN.md). Inherits
[ARCHITECTURE.md](../../ARCHITECTURE.md) ADR-006.

Graph grounding: `mesh-ui-serve.mjs` has a small import surface and one CLI dependent, so the UI mode switch
should stay in the serve face and query layer rather than cutting into the work engine.

Build guidance:
- Keep `mesh-ui-serve.mjs` a thin serve/API face. It may call a global mesh query surface, but must not
  import low-level work/run/mesh writers or scan workspace work streams directly.
- Default global mode consumes story 00/02 projection APIs. Local mode keeps the existing current-workspace
  `mesh:status` behavior behind an explicit `--local`/`scope=local` selection.
- The React fleet surface should render the design checklist regions from `DESIGN.md`: scope control,
  workspaces summary, work items, node panel, and health/diagnostics.
