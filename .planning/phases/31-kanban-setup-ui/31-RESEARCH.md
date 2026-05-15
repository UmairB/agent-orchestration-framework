# Phase 31 Research: Kanban Setup UI

## Existing UI

The setup UI is a Vite/React single page app in `ui/src/main.tsx`. It currently uses a left navigation shell for project/global asset editing, expanded DSL editing, and review diagnostics.

## Existing APIs

Phase 28-30 exposed most required backend operations. Phase 31 adds `PATCH /api/boards/:id/tasks/:taskId` so the UI can edit existing tasks without recreating them.

## UI Shape

The board view has a board list, diagnostics summary, selected board header, task creation form, five lifecycle columns, and compact editable task cards with status movement and agent assignment controls.
