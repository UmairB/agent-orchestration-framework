---
type: story
number: 05
slug: terminal-driven-worker-execution
title: "A worker runs assigned work as an interactive terminal agent, driven by whole commands"
parent: 38
status: done
owner: product-owner
created: 2026-07-18
updated: 2026-07-19
schema: 1
aofVersion: 0.1.0
---

## User story

As the operator, I want a worker to run its assigned work as an **interactive `claude` session in a real
terminal** — driven by whole commands the control node sends it (`/aof:refine <ref> --autonomous`,
`/aof:continue`, `/aof:verify <ref>`) — so that the session runs on the worker's subscription, can ask a
human a question mid-flight, and can drive a full milestone/story lifecycle rather than a single throwaway
turn.

## Background

The current worker driver is `claude -p` (`defaultSpawnRuntime`/`buildDriverCommand`,
`src/mesh-worker-execution.mjs`) — ONE bounded non-interactive turn. Measured this session (`RESEARCH.md
§ 4.3`): `claude -p` cannot pause to ask a human (it ends the turn with the question as text and reports
`terminal_reason: "completed"` — indistinguishable from real completion), and the Agent SDK path that
COULD ask forces per-token API billing off-subscription. **The operator's resolution: drop `claude -p`
entirely and use the terminal infrastructure this repo already ships.**

aof already has the whole local half (`RESEARCH.md § 4.3`): `src/terminal-ws.mjs`
(`attachTerminalWebSocket`, a node-pty PTY over a WebSocket with a frozen bidirectional envelope),
`src/terminal-providers.mjs` (spawns interactive `claude`/`codex`/`gemini`, NOT `-p`), and
`src/terminal-sessions.mjs` (the live-session registry). Interactive `claude` runs on the worker-user's
**subscription** (measured, § 4.3), asks mid-session natively, and lets a human attach.

This story replaces the worker's execution seam with a PTY session and makes the control node's assignment
carry a whole command string written into that PTY's stdin. It does NOT (yet) stream the terminal to the
control node — that's story-06.

## Tasks

<!-- Contract authored `2026-07-18` via `aof:refine 38 --autonomous` (Three Amigos). Refine DELIVERED the
     owed ADR: ARCHITECTURE ADR-013 — replace `buildDriverCommand`/`defaultSpawnRuntime`'s `claude -p` with
     interactive `claude` in a PTY via the existing `terminal-providers` seam (on the worker's SUBSCRIPTION,
     no Agent SDK); the directive carries a whole command string typed into PTY stdin; ONE long-lived
     interactive session PER ASSIGNMENT (documented default); a `NEEDS_INPUT` sentinel → a THIRD outcome
     `needs-input`; capture + surface `session_id` (discarded today); needs-input RETAINS its worktree.
     Tasks 00–03 `@executable` over an injected pty/provider/worktree-remove seam; task 04 the real
     interactive-`claude`-on-subscription `@manual` soak (measured un-fakeable, RESEARCH §4.3). -->

- [x] `tasks/00_pty-driver-replaces-headless-print.feature` — `@executable` — the worker resolves interactive
  `claude` via the `terminal-providers` seam (empty-args launch), NOT `claude -p`; a Scenario Outline pins the
  forbidden headless-print argv tokens (`-p`, `--print`, `--output-format`) absent from the spawned form —
  fitness `acd-worker-driver-no-headless-print`.
- [x] `tasks/01_directive-command-typed-into-pty.feature` — `@executable` — the assignment directive's whole
  command string (`/aof:refine <ref> --autonomous`, `/aof:continue`, `/aof:verify <ref>` — Scenario Outline)
  is written into the PTY stdin as one whole newline-terminated line; ONE long-lived interactive session per
  assignment (not a fresh spawn per command).
- [x] `tasks/02_needs-input-outcome-and-worktree-retention.feature` — `@executable` — a `NEEDS_INPUT` sentinel
  yields a THIRD outcome `needs-input`, DISTINCT from `done`/`failed` and explicitly NOT re-mapped to `done`
  (the §4.3 gap where `claude -p` reported `completed` for a question-ended turn); a `needs-input` session
  RETAINS its worktree (never the `done` force-remove), like the `failed`-retention path.
- [x] `tasks/03_session-id-captured-and-surfaced.feature` — `@executable` — the `session_id` the session emits
  (DISCARDED today at `mesh-worker-execution.mjs:580-581`) is captured and surfaced on the assignment/presence
  record for a human's `claude --resume <session_id>`; a run with no session_id degrades to absent, not a crash.
- [ ] `tasks/04_terminal-run-subscription-soak.feature` — `@manual` — the real-producer outsider check (ADR-008;
  §4.3 measured only-live): a REAL worker runs a REAL assigned command as interactive `claude` in a PTY on the
  worker's SUBSCRIPTION (no `ANTHROPIC_API_KEY`, no `-p`); a mid-run judgment call ends `needs-input` with the
  worktree RETAINED + `session_id` surfaced; a human `claude --resume <session_id>` on the worker answers and
  the same session continues with full context. Deferred human gate — closed at `aof:verify 38`.

## Notes

Depends on story-04 (an assignment to consume). Precedes story-06 (which streams this terminal to control).
Subscription-billing and human-can-ask both fall out of using the interactive terminal — do NOT reintroduce
`claude -p`.
