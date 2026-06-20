---
type: story
number: 02
slug: agent-terminal
title: "The agent terminal — run the agent CLI against the selected item, in-app"
parent: 3
status: in-review
owner: product-owner
created: 2026-06-19
updated: 2026-06-19
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 02 · The agent terminal — run the agent CLI against the selected item, in-app

## User story

As the operator reading a work item on the board,
I want to launch the agent CLI (Claude Code / Codex / Gemini) against that item in an in-app terminal
and watch it work,
so that the board doesn't just *show* the stream but *drives the agent loop* — I read the item and run
the agent on it in one place, without switching to a separate terminal and re-establishing context.

<!-- The headline. Ports vibeyard's terminal recipe (RESEARCH §1) — node-pty@1.1.0 (root pkg) + the
     CliProvider seam — re-homed off Electron IPC onto `ws@8` at `/ws/terminal` (ADR-001/003), streamed
     to an xterm pane (`@xterm/xterm@^6` + addon-fit + addon-web-links in `ui/`). The wire envelope is
     frozen (ADR-003): raw frames for PTY bytes, JSON `{resize}` client→server, `{exit}`/`{error}`
     server→client. A missing provider binary surfaces the dock ERROR state via a `{type:'error'}`
     control-frame — never a crash (the m02 honest-degrade discipline). MIT attribution on every adapted
     file (ADR-003). Independent of stories 00/01: disjoint `/ws/terminal` namespace + own files; attaches
     via the thin "selected ref + providerId" launch contract (ADR-005). -->

## Tasks

- [x] `tasks/00_run-agent-terminal.feature` — Run agent on the selected item opens the terminal dock,
  spawns the chosen provider via node-pty bound to the item's `dir`, and streams over `/ws/terminal` to
  xterm; the dock walks idle → connecting → running → exited; keystrokes echo and resize reflows
  (the live spawn lanes are `@manual`/`@uat` — RESEARCH A4)
- [x] `tasks/01_provider-picker-and-missing.feature` — the provider picker offers claude / codex / gemini
  with exactly-one-selected; the selection drives which CLI is spawned; a chosen provider whose binary is
  absent surfaces the dock ERROR state via the `{type:'error'}` control-frame, and the server does NOT
  crash or fake a success (`@manual` for a real missing binary — RESEARCH A7)

## Notes

Inherits the milestone ADRs + DESIGN §4. The native `node-pty` dependency is the milestone's highest-risk
piece but is **feasible-as-is**: `node-pty@1.1.0` ships a win32-x64 N-API prebuilt (RESEARCH §2), so no
node-gyp/VS-build-tools — the one residual is a routine build-time `pty.spawn` smoke (A2), confirmed when
this story lands, not a blocker. Guarded by `acd-terminal-server-only` (node-pty/ws are root deps, never
`ui/`; no node-pty under `ui/src`) and `acd-vibeyard-attribution` (the MIT notice on every adapted file).
The end-to-end agent stream and a real missing-provider error are `@manual`/`@uat`, not CI arch-tests
(ARCHITECTURE NOT-fitness-functions note). Independent of stories 00/01 by the disjoint route namespace
and the two-field launch contract.
