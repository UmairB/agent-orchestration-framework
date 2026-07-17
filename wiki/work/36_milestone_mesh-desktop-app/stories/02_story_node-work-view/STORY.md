---
type: story
number: 02
slug: node-work-view
title: "Node/work view — the native window that renders the fleet's nodes and each node's current work from mesh:status, strictly read-only, truthful across all four states"
parent: 36
status: done
owner: product-owner
created: 2026-07-09
updated: 2026-07-10
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH / SECURITY.
-->
# 02 · Node/work view — the fleet at a glance, read-only

## User story

As an **operator**, I want the app's window to show the **fleet** — every node, its role, its liveness, and
**what it's currently working on** — **read-only** and always truthful across **empty / loading / error /
populated**, so that I can see the mesh at a glance without tailing a log or opening the web UI, and I am
**never shown a stack trace or a torn view** on a silent re-poll.

<!-- Surface 1 (DESIGN.md), the milestone's marquee surface. Renders story 00's poll'd fleet model + role
     (the two DESIGN ramps — local-process health vs fleet presence — kept separate). Strictly READ-ONLY over
     the fleet (ADR-004 d3): the only controls are the local process toggles in the control bar. Independent
     of story 01 (a window with no tray renders off the same core). -->

## Tasks

<!-- Contract authored `2026-07-09` via `aof:refine 36 --autonomous` (Three Amigos: PO headline + aof-qa
     Examples + aof-developer feasibility). The pure view-model + state-selection are `@executable`; the
     rendered four states are the `@uat` design-conformance gate against DESIGN §Surface 1 + the committed
     mock. -->

- [x] [`tasks/00_status-render-model.feature`](tasks/00_status-render-model.feature) — `@executable` — the
  pure view-model mapping a `mesh status --json` payload (**corrected shape**) to rendered rows: per node
  {health dot from `node.stale`/`presence`, name, **`this node`** from `node.local`, role badge from
  `isControlNode`/caps, `aofVersion`, **current work** from `presence.activeRuns` → work ref + title, else
  `idle`}; **the two ramps stay separate** (local-process pills from the supervisor state vs fleet-presence
  dots). Exercises the corrected-shape deserialization + `acd-desktop-single-data-path`.
- [x] [`tasks/01_four-states.feature`](tasks/01_four-states.feature) — `@executable` — the state-selection
  logic: **empty** (no nodes → invite CTA, worker vs control copy), **loading** (skeleton reserving the same
  layout — no reflow), **error** (`mesh status` failed → a **calm inline banner**, one plain sentence + retry,
  **never a stack trace**; **keep-last-good** — a failed *silent* re-poll does NOT blank a populated body),
  **populated** (mixed control/worker · online/stale · running/idle · local tagged). (DESIGN §Surface 1 States.)
- [x] [`tasks/02_read-only-window.feature`](tasks/02_read-only-window.feature) — `@executable` — the window
  exposes **NO assign / route / dispatch affordance**; the ONLY controls are the local process toggles; no
  mesh-mutation path exists from this surface. Arms `acd-desktop-read-only-fleet` (ADR-004 d3).
- [ ] [`tasks/03_visual-conformance.feature`](tasks/03_visual-conformance.feature) — `@uat` — render the
  **populated** window plus the four states; a read-only **design-conformance judgement** against
  [DESIGN.md](../../DESIGN.md) §Surface 1 (`mocks/node-work-window.png` + the binding checklist — the standing
  baseline until the mock lands, the pixel source once it does). **Deferred design gate** — judged at
  `aof:verify`.

## Fitness units (proposed)

Inherited from [ARCHITECTURE.md](../../ARCHITECTURE.md):

- `acd-desktop-read-only-fleet` (ADR-004 d3) — the window offers no fleet-mutation affordance (no
  `assign`/`issue`/`revoke` spawn reachable from this surface).
- `acd-desktop-single-data-path` (ADR-004 d1–2) — the render reads the ONE `mesh status` poll; the
  corrected-shape deserialization is exercised here (a build-correctness `.feature`, not a grep — ARCHITECTURE
  §Fitness functions).

## Notes

Inherits **ADR-001** (the WebView-hosted native window — HTML/CSS authoring maps to the mock), **ADR-004**
(read-only + the corrected `mesh:status` shape). [DESIGN.md](../../DESIGN.md) §Surface 1 is the conformance
source; the `@uat` is the **designer's flag** — a render is needed or the design review returns INCONCLUSIVE.

**Depends:** Story 00 (the poll'd fleet model + role) — NOT story 01. Forks off 00 in parallel with the tray.

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Verdict: tasks 00–02 stay `@executable` (`cargo test`, over story 00's lane), task 03 stays `@uat` — no
retag.**

- **Rides story 00's `cargo test` lane** (see `stories/00_story_supervisor-core/STORY.md` §Build notes for
  the full decision) — the view-model (task 00), the four-state selector (task 01), and the read-only wire
  inventory (task 02) are all plain Rust functions/inventories over fixture `mesh status --json` payloads and
  a fixture control inventory — no DOM, no WebView2, no live spawn, no clock. Every scenario, including the
  Scenario Outlines (the presence-optional row mapping, the activeRuns→work-cell mapping, the four-state
  matrix, the forbidden-verb inventory), asserts a returned struct/list, not a rendered pixel — they hold as
  tagged.
- **Task 02's read-only wire posture is genuinely `@executable`, not `@uat`, despite judging "no affordance
  exists"** — it inventories the IPC command registry + control list at the source/registration level (a
  fixed list the harness enumerates), not a rendered screenshot; the corresponding VISUAL statement of the
  same rail (no control appears on the rendered screen) is correctly left to task 03's `@uat` instead of
  duplicated here.
- **Resolving the QA doubt on task 03's render harness: render the WebView HTML/CSS standalone in the cached
  ms-playwright Chromium against fixture payloads — NOT a screenshot of the built-and-launched Tauri window.**
  Because ADR-001 makes the surface an ordinary WebView-hosted HTML/CSS/JS document (Tauri IPC only wires
  Rust↔view data, it does not change the DOM), the same headless-Chromium harness already proven for the m34
  fleet UI and m35's assignment-lifecycle `@uat` (`--headless=new --screenshot=<ABSOLUTE forward-slash
  path>`, `npx playwright` policy-blocked) applies unchanged: load the view's HTML/CSS fed the corrected-shape
  fixture JSON directly (no Tauri IPC round-trip, no built `.exe`, no WebView2 runtime dependency, no
  Authenticode-signed artifact), and screenshot each of the four states. This is strictly cheaper and more
  reachable than screenshotting a real launched Tauri window (which would gate the design review on a signed
  build + a WebView2-capable machine) and is faithful to what is being judged — pixel/layout conformance of
  the HTML/CSS the view authors, not Tauri's own chrome (the native title bar is OS-drawn either way and out
  of the app's rendering control). Recorded as the harness choice task 03's Background already gestures at
  ("the developer amigo confirms the EXACT render harness") — locked here.
- **No retag.** Task 03 remains the sole `@uat` in this story; nothing in tasks 00–02 needs a render to be
  judged.
