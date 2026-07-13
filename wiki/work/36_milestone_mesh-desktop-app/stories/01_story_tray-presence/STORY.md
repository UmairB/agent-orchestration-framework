---
type: story
number: 01
slug: tray-presence
title: "Tray presence — the ambient Windows taskbar tray icon + menu that keeps the app resident when the window is closed and drives local start/stop, read from the supervisor core"
parent: 36
status: done
owner: product-owner
created: 2026-07-09
updated: 2026-07-10
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH / SECURITY.
-->
# 01 · Tray presence — the ambient signal + one-click controls

## User story

As an **operator who has closed the window**, I want the app to **stay resident in the Windows tray** with an
icon whose shape tells me fleet health at a glance, and a right-click menu to **start/stop the mesh, open the
web UI, show the window, or quit** — so that the supervisor is **ambient** (surviving the window close) and
one-click reachable from the taskbar without ever opening a terminal.

<!-- Surface 2 (DESIGN.md). Sits ON the supervisor core (story 00): the icon reflects 00's health/role model,
     the Start/Stop items drive 00's supervision engine, Quit tears it down. Independent of story 02 (a tray
     with no window renders off the same core). The Start/Stop items are LOCAL supervision only (never a fleet
     mutation) — the read-only allow-list (ADR-004 d3). -->

## Tasks

<!-- Contract authored `2026-07-09` via `aof:refine 36 --autonomous` (Three Amigos: PO headline + aof-qa
     Examples + aof-developer feasibility). The pure menu/icon MODELS are `@executable`; ambient residency +
     the menu ACTIONS driving real processes are `@manual`; the icon's visual states are `@uat` against
     DESIGN §Surface 2 + `mocks/tray-menu.png`. -->

- [x] [`tasks/00_tray-icon-states.feature`](tasks/00_tray-icon-states.feature) — `@executable` — the pure
  **health-summary → icon-state** mapping (`healthy`/`degraded`/`stopped`, distinguished by **shape/badge not
  colour alone**, theme-invariant, keep-last-good on a silent poll) — a pure `icon_state(...)` selector (cargo
  unit test, no `TrayIconBuilder`).
- [x] [`tasks/01_tray-menu-model.feature`](tasks/01_tray-menu-model.feature) — `@executable` — the pure menu
  model `(role, process-state, fleet-summary) → items/labels`: a non-interactive **health header** roll-up
  (`N online · M stale`); **Start/Stop mesh** as ONE state-labelled item; **Open web UI** disabled when the UI
  child is stopped; **Show/Hide window** state-labelled; a separator then **Quit** last; a **worker node omits
  the server control** (not a dead item). (DESIGN §Surface 2.)
- [ ] [`tasks/02_ambient-residency-and-actions.feature`](tasks/02_ambient-residency-and-actions.feature) —
  `@manual` — closing the window **hides to tray** (survives, does not quit); **Quit is the only full exit**
  (tears down supervision); **Start/Stop drives the supervisor engine** (LOCAL supervision only — never a fleet
  mutation, `acd-desktop-read-only-fleet`); **Open web UI** launches the running `aof mesh ui` at its real
  local URL in the default browser; **Show/Hide** toggles the window.
- [ ] [`tasks/03_tray-icon-visual.feature`](tasks/03_tray-icon-visual.feature) — `@uat` — the rendered tray
  icon at 16px in **light + dark** taskbars, a design-conformance judgement against [DESIGN.md](../../DESIGN.md)
  §Surface 2 (`mocks/tray-menu.png` + the binding checklist). **Deferred design gate** — judged at `aof:verify`.

## Fitness units (proposed)

Inherited from [ARCHITECTURE.md](../../ARCHITECTURE.md):

- `acd-desktop-read-only-fleet` (ADR-004 d3) — the tray's Start/Stop items spawn ONLY local supervision
  (`serve`/`ui`); no mesh-mutating verb (`assign`/`issue`/`revoke`/`invite`/`join`) is ever reachable from the
  menu.

## Notes

Inherits **ADR-001** (the native tray via Tauri's `TrayIconBuilder` + the first-party single-instance plugin;
the ambient `prevent_close`+`hide` wiring is manual either way — [RESEARCH.md](../../RESEARCH.md) §1),
**ADR-002** (the menu controls drive the supervisor), **ADR-004** (read-only). [DESIGN.md](../../DESIGN.md)
§Surface 2 (binding checklist + `mocks/tray-menu.png`) is the conformance source for the `@uat` icon states.

**Depends:** Story 00 (the health/role model it renders + the supervision engine its Start/Stop drives) — NOT
story 02. It forks off 00 in parallel with the window.

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Verdict: tasks 00–01 stay `@executable` (`cargo test`, over story 00's lane), task 02 stays `@manual` —
no retag.**

- **Rides story 00's `cargo test` lane** (recorded in full in `stories/00_story_supervisor-core/STORY.md`
  §Build notes) — no second harness is introduced here; `app/desktop/` and the guard-if-present wiring into
  `scripts/test.mjs` are 00's job, not this story's.
- **Confirming the QA doubt: yes, `icon_state()`/`tray_menu()` are the intended pure seams, separate from
  `TrayIconBuilder`.** Both task 00 and task 01's features already name this precisely in their own
  `RESOLVED (developer-amigo)` comments — `icon_state(fleet_summary, server_state, app_state) -> IconState`
  (task 00) and `tray_menu(role, server_state, ui_state, window_visible, fleet_summary) -> Vec<MenuItem>`
  (task 01) — plain functions returning a typed descriptor (state + badge; item list with
  {label, kind, enabled, id}), callable with zero `TrayIconBuilder`, zero native flyout, zero WebView2. That
  is precisely the pure-core-over-fixtures shape story 00 establishes, so both hold as `@executable` cargo
  unit tests. No scenario in either feature — including the Scenario Outlines (the badge-per-state matrix,
  the light/dark theme-invariance check, the worker-omits-server-control case, the Quit-always-last matrix)
  — needs a rendered icon, a live menu, or a real process; each is a pure mapping over a supplied summary
  tuple.
- **The rendered 16px icon (light/dark) `@uat`** is the one genuinely un-fixture-able piece — judging pixel
  legibility needs an actual rendered glyph a person looks at, not a returned struct. It is now its own
  single-lane feature `03_tray-icon-visual.feature` (`@uat`), leaving `00_tray-icon-states.feature` a pure
  `@executable` mapping (validate requires exactly one verification tag per scenario — a mixed-lane feature
  would double-tag the visual scenario). No retag of the mapping scenarios needed.
- **Task 02 stays `@manual`** — ambient hide-to-tray, Quit tearing down real supervision, and Start/Stop
  driving a REAL local `aof mesh serve --serve`/`aof mesh ui` process are black-box behaviour over a running
  app and live OS processes; no fixture stands in for "the window actually hid" or "the process actually
  died and was reaped." The read-only-allow-list scenarios in this same feature (no mutating verb ever
  spawned from a tray action) are likewise asserted as OBSERVED spawn behaviour here — the structural,
  never-even-possible-to-spawn form of that same invariant is `acd-desktop-read-only-fleet`, the architect's
  arch-test, not this feature's job to re-derive as a grep.
