---
doc: design
---
# 34 · Global Mesh Work Store — UI Design Contract

No mock was provided at refine time. This checklist is the binding review baseline for the mesh UI changes.

## Surface: `aof mesh ui` Global Mode

Purpose: machine-wide operator view for the control node.

Required regions:
- Scope control: shows `Global` as the active scope and exposes a clear local/current-workspace option.
- Workspaces summary: lists mesh-enabled workspaces known to the global store, with status/freshness.
- Work items table: aggregates milestones/stories/tasks/runs across workspaces with workspace identity visible.
- Node panel: shows control and worker nodes, last seen, roles/capabilities, and fabric address when known.
- Health/diagnostics: shows projection freshness, disabled/non-propagating workspaces, and store errors.

Required states:
- Empty: no mesh-enabled workspaces have published yet; explain the next action without implying failure.
- Loading: stable layout while global store data loads.
- Error: store unavailable or schema migration needed, with the path to the global mesh store.
- Populated: grouped, filterable machine-wide work and node details.

## Surface: `aof mesh ui --local`

Purpose: preserve current workspace diagnosis.

Required differences from global mode:
- Scope control shows `Local` as active.
- Work item and node data are filtered to the current workspace.
- The current workspace path/name is visible.
- Global store health may still be shown, but it must not obscure the local result.

## Review Notes

- The UI should not introduce a second board-style work editor. This is an operator visibility surface.
- The UI must make scope obvious enough that a user does not confuse global and local work lists.
- Node descriptors may contain operational data but not credentials.
