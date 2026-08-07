---
type: milestone
number: 46
slug: terminal-control-unification
title: "One terminal control — the duplicate is deleted, not kept in parallel"
status: not-started
owner: product-owner
created: 2026-08-02
updated: 2026-08-02
depends: [44, 45]
origin: ../../planning/PRD-web-ui-restructure.md
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 46 · One terminal control — the duplicate is deleted, not kept in parallel

## Objective

A terminal appears in two places in this UI, and each place implements it. The board dock
([TerminalDock.tsx](../../../ui/src/board/TerminalDock.tsx)) and the fleet card's peek
([FleetTerminalView.tsx](../../../ui/src/fleet/terminal-view/FleetTerminalView.tsx)) each carry their
own xterm lifecycle, their own connection-state ramp, their own socket-URL builder and their own
geometry rule. A fix to either lands in one of them.

This milestone extracts **one** terminal control — a component plus framework-free `.mjs` state
helpers — parameterised by **session source**, and re-homes both call sites onto it. The duplicate is
deleted in the same milestone that replaces it; two implementations behind one name is the failure
mode this exists to end.

Origin: [PRD — Web UI Restructure](../../planning/PRD-web-ui-restructure.md), milestone
`terminal-control-unification`.

**The PRD's "two-and-a-half implementations" count is out of date, measured 2026-08-02** — in this
milestone's favour. m42 item 6 (commit `54f6bbf`, "ONE terminal surface") already collapsed the
bolt-on widget: the dock is now a single component carrying **both** a local-PTY lane and a `remote`
mirror lane ([TerminalDock.tsx:71](../../../ui/src/board/TerminalDock.tsx#L71)), including the
fit-vs-scale split ([:167](../../../ui/src/board/TerminalDock.tsx#L167)) and the input path on both
lanes ([:261-263](../../../ui/src/board/TerminalDock.tsx#L261-L263)). So the work is **two**
implementations, not two-and-a-half, and the dock is already most of the target design. What remains is
to lift it out of `ui/src/board/`, delete `FleetTerminalView`, and retire the hard-coded
`FLEET_PORT = 4181` ([:78](../../../ui/src/board/TerminalDock.tsx#L78)) per spike 44's finding.

## Scope

In scope:

- **The control itself** — one component owning xterm lifecycle, the connection-state ramp (one
  vocabulary, colour never the only signal), viewport-responsive sizing, drag-resize and
  expand-to-fullscreen. Extracted to a shared location, not left in `ui/src/board/`.
- **Session-source parameterisation.** The control takes a source kind and derives its behaviour from
  it. The kind list is **fixed by spike 44's finding** — at minimum `local-pty` and `mirror`, plus a
  relayed-local kind if 44 lands that way.
- **Fit-vs-scale as a declared property of the source, not a branch in the component.** The board's
  local PTY is fitted (`FitAddon.fit()` plus a resize frame up the socket); the worker mirror is pinned
  to 80×24 and CSS-transform-scaled, because the worker's `claude` TUI paints with absolute cursor
  addressing ([mesh-worker-execution.mjs](../../../src/mesh-worker-execution.mjs)) and fitting garbles
  it. **Both are correct for their source** — the rule keys off whether the far end can be told to
  resize.
- **Framework-free state helpers.** The connection ramp, geometry and socket-URL construction move into
  `.mjs` beside the component so `node:test` drives them headlessly. Today's helpers
  ([board/terminal/dock-state.mjs](../../../ui/src/board/terminal/dock-state.mjs),
  [board/terminal/resize.mjs](../../../ui/src/board/terminal/resize.mjs),
  [fleet/terminal-view/geometry.mjs](../../../ui/src/fleet/terminal-view/geometry.mjs),
  [fleet/terminal-view/stream.mjs](../../../ui/src/fleet/terminal-view/stream.mjs),
  [fleet/terminal-view/view-state.mjs](../../../ui/src/fleet/terminal-view/view-state.mjs)) are
  reconciled into one set — the house has no React test harness and this pattern is not optional.
- **Both call sites re-homed, and the duplicate deleted.** The board dock and the fleet card peek
  ([Fleet.tsx:675](../../../ui/src/fleet/Fleet.tsx#L675)) both render the one control;
  `ui/src/fleet/terminal-view/` is removed.
- **`FLEET_PORT` retired or made configuration** per spike 44. The control does not hard-code an origin.
- **The existing fitness locks stay green.**
  [acd-fleet-terminal-input-constrained.test.mjs](../../../test/arch/acd-fleet-terminal-input-constrained.test.mjs)
  does source-analysis over named files and named surfaces; moving code across files will move what it
  inspects. Its **invariants** are the contract, not its file list — invariant 4 (the fleet page wires
  no input source) must still hold at the end of this milestone. Reversing invariant 4 is milestone 49's
  job, not this one's.
  [acd-terminal-server-only.test.mjs](../../../test/arch/acd-terminal-server-only.test.mjs) — node-pty
  never reaches `ui/src/` — must survive untouched.

Out of scope:

- **Making the fleet page's panes typeable.** Milestone 49. This milestone preserves invariant 4 exactly
  as it stands.
- **The terminals home grid.** Milestone 49 consumes this control; it is not built here.
- **Changing the mirror or relay wire protocol.** This is a client-side extraction. The terminal-view
  socket and its tuple-bound input seam are used as-is.
- **Scrollback persistence or session replay.** The mirror is ephemeral by design (ADR-014); a durable
  transcript store is a separate arc.

## Stories

<!-- Populated at the Break-down stage (refine). -->

To be broken down — `aof:refine 46`.

## Dependencies

- **44 · spike: terminal-origin-boundary** — the gate. This milestone cannot fix its
  session-source list or its socket-URL construction until the spike records whether a local board PTY
  is reached through the relay or by direct-dial, and whether `FLEET_PORT` is retired or becomes
  configuration. Building the control against a guess is the rewrite this spike exists to prevent.
- **45 · ui-app-shell-routing** — the control's resize, fullscreen and viewport-responsive behaviour sit
  inside the shell's layout primitives; extracting it before the shell exists means fitting it to a
  layout that is about to change.
