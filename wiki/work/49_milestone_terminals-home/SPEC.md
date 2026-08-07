---
type: milestone
number: 49
slug: terminals-home
title: "The terminals home — every live session in the fleet, typeable, at /"
status: not-started
owner: product-owner
created: 2026-08-02
updated: 2026-08-02
depends: [44, 46, 48]
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
# 49 · The terminals home — every live session in the fleet, typeable, at `/`

## Objective

This is the milestone the arc exists for: invert the web UI's centre of gravity so the **live terminals
of the fleet** are the home screen. Today the one thing an operator actually watches — an agent working
— is buried two levels down as a per-card peek, and the home screen is a fleet-management page.

The model is [herdr](https://github.com/ogulcancelik/herdr)'s, and precisely that much: sessions are
**named, persistent and viewer-independent** (detach and reattach is normal); the surface is a **grid of
panes** you focus and rearrange; each pane advertises **agent state** so a fleet is scannable at a
glance; interaction is **both** keyboard and mouse. What is not adopted is herdr's Rust TUI, its socket
API, tmux prefix-key parity, or its plugin marketplace.

The screen answers, in one view: *what is every machine in my fleet doing right now, and let me get into
it.*

Origin: [PRD — Web UI Restructure](../../planning/PRD-web-ui-restructure.md), milestones
`terminals-home` **and** `interactive-terminals`, merged at shatter (operator decision, 2026-08-02).

**Why the merge, and what it changes.** The PRD frames interactivity as a separate milestone gated by a
spike, on the premise that typing into a terminal *reverses a load-bearing, test-enforced security
invariant*. Measured 2026-08-02, that reversal **already shipped**: m42 item 6 (2026-07-27,
operator-forced) built the browser→control→worker input path, and
[acd-fleet-terminal-mirror-read-only.test.mjs](../../../test/arch/) was deliberately rewritten as
[acd-fleet-terminal-input-constrained.test.mjs](../../../test/arch/acd-fleet-terminal-input-constrained.test.mjs),
which now pins the input path's **constrained shape** rather than its absence: one tuple-bound entry
seam that wraps bytes with the socket's own `(nodeId, sessionId)`, content-blind, bounded by
`MAX_TERMINAL_INPUT_BYTES`, session-exact delivery through the `liveSessionInputs` registry, and clean
degradation to output-only when no push route is configured. The board dock types on both lanes today.

So there is no invariant to reverse and no security question to spike — there is a **proven pattern to
extend to a second surface**. That makes read-only-then-interactive a needless two-step, and panes are
typeable from the start.

## Scope

In scope:

- **The grid at `/`** — a responsive grid of every live session across the fleet, each pane showing
  node, repo, work item (when there is one), agent state, and a live terminal.
- **Focus, expand, close** — keyboard and mouse both, with layout persisted per operator.
- **Agent state per pane** — blocked / working / done, so the fleet is scannable without reading output.
- **Typeable panes**, by extending m42's tuple-bound seam to this surface. The security properties are
  the existing ones and are not renegotiated: entry stays content-blind and byte-bounded, delivery stays
  session-exact, and a pane can only ever type into the session its own socket names.
- **Invariant 4 of `acd-fleet-terminal-input-constrained` amended, deliberately and in one place.** That
  invariant currently reads "THE FLEET PAGE STAYS A MONITOR — the interactive surface is the BOARD DOCK",
  and it is true today ([FleetTerminalView.tsx:170](../../../ui/src/fleet/terminal-view/FleetTerminalView.tsx#L170)
  constructs xterm with `disableStdin: true` and registers no `onData`). This milestone makes the fleet
  origin an interactive surface, so that invariant must be rewritten — not deleted, and not quietly
  broken. The other three invariants survive unchanged; the amendment is the narrow one.
- **An explicit read-only fallback.** A session that cannot accept input renders as **labelled**
  read-only, never as a pane that silently swallows keystrokes.
- **A bounded live-socket count.** How many panes hold live sockets at once is an explicit, configured
  number, not an emergent one — herdr's grid assumes a handful of panes and a real fleet may not be.
- **Honest empty and degraded states.** No live sessions, a node unreachable, a session that ended
  mid-view, and (per spike 44) a pane whose origin cannot be reached — each says what is true.

Out of scope:

- **Spawning sessions.** The "new session" verb is milestone 50; this screen renders what already exists.
- **Absorbing the board.** Boards stay per-workspace on their own origin with their own route. The
  terminals home links to them; it does not swallow them.
- **Multi-user auth, accounts or RBAC.** The posture stays single-operator over the existing mesh
  credential. The interactive path is gated by that credential, not by a new user system.
- **Scrollback persistence and session replay.** A browser that subscribes late sees an empty pane, and
  that is ADR-014's design. A durable transcript store is a separate observability arc.
- **Stall detection and recovery.** A per-pane idle watchdog with a nudge/restart control is the natural
  next feature here and is deliberately a separate run-resilience arc — it has to decide what "stalled"
  means and what recovery is safe.
- **Widening the fleet face's write surface.** No new API mutation is added here; input rides the
  existing terminal-view socket upgrade. `/api/mesh/assign` remains the one route, and
  [mesh-ui-write-isolation-bounded.test.mjs](../../../test/mesh-ui-write-isolation-bounded.test.mjs)
  stays green.

## Stories

<!-- Populated at the Break-down stage (refine). -->

To be broken down — `aof:refine 49`. Expect the grid, the pane, the input extension + arch-test
amendment, and the state/persistence layer to fall out as separate stories; the arch-test amendment in
particular wants its own reviewable boundary.

## Dependencies

- **44 · spike: terminal-origin-boundary** — this screen must know where it is served and what a pane
  renders when its origin is unreachable. The spike's finding on the local-PTY path decides whether a
  board session can appear in this grid at all.
- **46 · terminal-control-unification** — each pane is an instance of the one control. Building the grid
  against two implementations would re-create the duplication 46 removes.
- **48 · fleet-session-identity** — the hard gate. Without a routable `(nodeId, sessionId)` for sessions
  that have no assignment, this screen can *render* `working · <repo>` and cannot open a terminal on it.
  There is no version of this milestone that ships before 48.
