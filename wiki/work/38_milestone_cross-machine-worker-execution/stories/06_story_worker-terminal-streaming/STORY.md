---
type: story
number: 06
slug: worker-terminal-streaming
title: "Stream a worker's live terminal into the control node's fleet view"
parent: 38
status: done
owner: product-owner
created: 2026-07-18
updated: 2026-07-26
schema: 1
aofVersion: 0.1.0
---

## User story

As the operator, I want a worker's live agent terminal streamed into the control node's fleet UI, so that I
can watch a dispatched run progress in real time from the control node — and so a human can see exactly what
the worker's session is doing (and, later, attach to answer a question) without logging into the worker
machine.

## Background

The operator's end-state (herdr-style — https://github.com/ogulcancelik/herdr): the worker's terminal is
visible from the control node. See `RESEARCH.md § 4.3/4.5`. **Both hard halves already exist:**
- Local PTY-over-WebSocket with a frozen bidirectional bytes envelope — `src/terminal-ws.mjs`
  (`/ws/terminal`).
- A persistent cross-machine mesh transport — `src/mesh-relay.mjs` (itself explicitly modeled on "the
  board-serve/terminal-ws precedent").

**The net-new work is the BRIDGE**: relay a worker's `/ws/terminal` PTY byte stream over the mesh to the
control node's fleet view, routed by (nodeId, sessionId).

**Two constraints this bumps:**
1. The fleet face (`src/mesh-ui-serve.mjs`) DELIBERATELY serves no `/ws/terminal` (read-only by ADR-006) —
   attaching a worker terminal is a security-reviewed carve-out.
2. Streaming a live agent/shell terminal cross-machine is a major new capability — start with a **read-only
   MIRROR** (view only) this story; read-WRITE control (sending keystrokes from the fleet view) is deferred
   (a Phase-2 concern, not this story).

## Tasks

<!-- Contract authored `2026-07-18` via `aof:refine 38 --autonomous` (Three Amigos). Refine DELIVERED the
     owed decisions: ARCHITECTURE ADR-014 (the cross-machine terminal BRIDGE — PTY bytes ride the FROZEN
     `mesh-relay.mjs` envelope as a NEW opaque `signal` kind, routed by (nodeId, sessionId), zero relay change;
     the fleet face gains a read-only terminal-VIEW route over an in-memory ephemeral mirror — carve-out #2;
     READ-ONLY invariant, no mesh→PTY input path; assignment discovery via the ADR-013 `session_id`) +
     SECURITY T14 (worker terminal exposed to control; read-only IN FACT; credential material never streams).
     READ-ONLY MIRROR only this story; read-WRITE is deferred (Phase 2). Tasks 00–02 `@executable` over fake
     relay/PTY/mirror seams; task 03 the real-second-machine `@manual` soak. -->

- [x] `tasks/00_pty-bytes-ride-relay-signal.feature` — `@executable` — the worker's `/ws/terminal` PTY byte
  stream rides the FROZEN `mesh-relay.mjs` envelope as a new opaque `signal` kind, routed by (nodeId, sessionId)
  (sessionId inside the signal payload); the relay envelope is byte-unchanged (opaque payload — the m26
  leasing / frozen-envelope property). Scenario Outline over the routing-key matrix incl. same-node multiplex.
- [x] `tasks/01_fleet-terminal-view-mirror.feature` — `@executable` — the fleet face gains a read-only
  terminal-VIEW route serving an IN-MEMORY EPHEMERAL mirror of the relayed bytes (never a system of record;
  rebuild starts empty); it MULTIPLEXES multiple (nodeId, sessionId) streams and discovers "which session
  belongs to which assignment" via the surfaced `session_id`; an unresolvable frame is dropped.
- [x] `tasks/02_mirror-read-only-in-fact.feature` — `@executable` — fitness `acd-fleet-terminal-mirror-read-only`:
  a STRUCTURAL absent-input-path (a planted forwarding path TRIPS the fitness), server→browser-only at runtime,
  and credential MATERIAL never in the stream (the signal is sourced only from `term.onData`). (T14 — the
  on-screen-print residual is T14's accepted residual, routed to the task-03 soak inspection.)
- [x] `tasks/04_bug-fleet-terminal-view-surface.feature` — `@bug @finding-F-38-06c` — `@executable` — **the fleet
  RENDERS the terminal-view.** Added `2026-07-23` at `aof:continue 38/06`, closing the BLOCKER `aof:verify 38`
  raised: the transport is wired (F-38.06) but the mirror has NO consumer, so the task-03 soak is structurally
  unrunnable. Confirmed at source, the break is a THREE-LINK chain — the ADR-013 `session_id` is **not actually
  surfaced anywhere a browser can read it**: the control node DROPS it off the assignment-status frame
  (`control-stream-server.mjs:231-232`; no column on `global_assignments`), so `projectAssignment` cannot carry
  it, so no card could resolve its stream even if a component existed. Persist → surface → render, judged against
  DESIGN §Surface 3's V1–V9.
- [ ] `tasks/03_worker-terminal-stream-soak.feature` — `@manual` — the real-producer outsider check (ADR-008;
  streaming a live PTY cross-machine is un-fakeable): a REAL worker's live terminal output appears in the REAL
  control-node fleet view within the heartbeat window, routed to the correct node/session; a keystroke typed
  into the fleet view does NOT reach the worker (read-only confirmed live); live multiplex across two workers;
  no on-screen secret. Deferred human gate — closed at `aof:verify 38`.

## Notes

Depends on story-05 (an interactive terminal to stream). Read-only mirror only; read-write terminal control
is explicitly out of scope for this story.
