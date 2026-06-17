---
type: milestone
number: 03
slug: work-board-ui
title: "Work Board UI"
status: not-started
owner: product-owner
created: 2026-06-16
updated: 2026-06-17
depends: [00]
---
# 03 · Work Board UI

## Objective

Bring the work stream into the aof UI as an interactive board: see the milestone → story → task
stream and act on it — add feedback, validate, request the next item — without dropping to the
terminal. Take **vibeyard** ([`elirantutia/vibeyard`](https://github.com/elirantutia/vibeyard), MIT)
as the reference for what an agent-IDE surface can be, and **reuse its isolated building blocks**
rather than adopting the app. The headline addition over a read-only board is the **agent terminal**:
run Claude Code (or Codex / Gemini) in an in-app xterm pane against the selected work item, so the
board both *shows* the stream and *drives* the agent loop.

## Scope

In scope:
- `aof work list --json` — the board's data source (the whole stream + statuses, one pass).
- A board (milestones → stories → tasks, status chips) + an item detail panel
  (SPEC / VERIFICATION / RETROSPECTIVE, findings).
- Actions: **add feedback** (→ STATE `## Feedback (for retro)`), **validate**, **next**.
- An **agent terminal** — run the agent CLI (Claude Code / Codex / Gemini) in an xterm pane,
  streamed from the aof server (node-pty over WebSocket), launchable against the selected item.
  Modelled on vibeyard's xterm + node-pty + provider abstraction, re-homed onto aof's
  server + browser stack (not Electron/IPC).

Out of scope:
- Full code-review orchestration driven from the UI — agent-heavy; a later phase.
- **P2P WebRTC session-sharing** — reusable from vibeyard's `sharing/` module, but a later/optional
  milestone, not on this milestone's critical path.
- Forking or embedding the vibeyard Electron app or its vanilla-DOM UI — we harvest isolated
  modules as reference, not the shell.

## Approach — vibeyard as reference

vibeyard is **guidance for what's possible**, not a base to fork. The determination:

- **Not usable directly.** It is an Electron desktop app (vanilla-TS DOM, single-user JSON store) —
  wrong runtime and framework for aof's CLI + React-on-Node-server UI. Decisively, its task model is
  the *opposite* of ACD's: a free-form kanban (user columns, status = column) vs ACD's declarative
  Gherkin contracts with structural hierarchy and derived status. And its board has no API seam (it
  mutates a global state singleton), so it can't be swapped behind an interface — replacing it is a
  rewrite, not a port.
- **What we reuse** — the *isolated, MIT-clean* modules as port targets: the **terminal stack**
  (xterm + node-pty + the `CliProvider` provider abstraction — this delivers the terminal view) and,
  later, the **WebRTC terminal-sharing** module (`src/renderer/sharing/`, native `RTCPeerConnection`,
  zero board coupling). Both are re-homed onto aof's Node-server + WebSocket + React; **ACD stays the
  task brain** (the `aof work` CLI + this board), so we import capability, not task management.
- **What vibeyard shows is possible** (the menu, with disposition): in-app agent terminal *(pull in
  now)*; multi-provider session runner *(now, via the provider seam)*; multi-session swarm grid,
  dashboard widgets, cost/context tracking, session resume *(candidates for later milestones)*;
  P2P session sharing *(later/optional, above)*.
- **Attribution:** any adapted code carries vibeyard's MIT copyright notice.

## Stories

<!-- to be broken down — `aof:refine 03` -->

## Dependencies

- **00 · Work CLI** — `aof work list` / `find` back the board (the UI renders CLI `--json`).
