---
doc: retrospective
milestone: 36
updated: 2026-07-10
---
<!--
  Milestone RETROSPECTIVE.md — carryable lessons distilled from this milestone's mistakes,
  blockers, and the verification findings. Written at aof:verify close.
-->
# 36 · Mesh Desktop App — Retrospective

## Why this milestone was accepted

Accepted `2026-07-10` after a **full live cross-machine UAT** — not a pure-seam green. The first
`aof:verify` (2026-07-09) correctly **refused** to accept: the Tauri shell was a scaffold with every
live behaviour stubbed behind `@manual`/`@uat` tags (blocker **F1**), so `cargo test` was 67/0 green
while the SPEC objective was undelivered. F1 was re-wired into a real supervisor runtime
(`supervisor.rs` + rewritten `main.rs`), and at this verify the runtime was **run end-to-end on real
hardware across two machines** (Windows control `umairs-msi` running the app + macOS worker
`umairs-mac-mini` over Tailscale) and operator-accepted: one `aof mesh desktop install`, a real tray
icon, the mesh server + `aof mesh ui` brought up and kept up across a crash (Job-Object-contained,
backoff-restarted), the window rendering the live two-node fleet — terminal closed. Seven UAT defects
surfaced during the live run were fixed inline and re-confirmed (F-UAT1–7); the shared `@executable`
gate is green (2321 ok / 0 not-ok) after de-flaking one gate test (F2); one design-gap set a standing
rule (GAP-1); one live finding (F-IDLE) was root-caused at the data source and deferred to milestone 38.
No blocker is open.

## Lessons (carry forward)

- **R1 — A `@manual`/`@uat` tag is a verification LANE, not a licence to defer the implementation it
  verifies.** The first build tested the pure decision seams (poll cadence, backoff, classify,
  render-state, resolve) to green — `cargo test` 67/0 — while the REAL runtime (the `tokio::process`
  spawn, the `mesh status --json` poll, the Job-Object reap, ambient residency, Start/Stop, browser-open)
  sat as `main.rs` placeholders behind the `@manual`/`@uat` tags. So the suite was green while the
  milestone's objective did not exist. This is the cross-milestone twin of **[02/R5]** ("offline
  simulation seams leave the real spawn/`--json` path uncovered") and **[34/R1]** ("fixtures over
  injected transports go green while the production wiring is inert") — the same failure mode, third
  milestone. **How to apply:** for a story whose value IS a live OS effect, the runtime wiring must exist
  at build — either a build-gate that exercises the real effect, or, when it is genuinely only observable
  on live hardware, the accept rule must forbid marking the story `done` until that live run happens. A
  green pure-seam suite is necessary, never sufficient; name the runtime the tag defers and run it inside
  the same milestone, not a hypothetical later one.

- **R2 — Confirm at the authoritative source; a proxy for "done" is not "done".** Three instances this
  milestone, all mine: (a) **workspace cleanup** — I deleted the `.aof/mesh/workspaces/*.json` files and
  reported it done, but the UI reads `projection.sqlite`; the count didn't move until I inspected and
  cleaned the DB directly. (b) **F-UAT6 double-tray** — I mis-diagnosed a "ghost icon" repeatedly and
  moved on, until the operator showed that a fresh launch STILL made two → the real config×code
  double-instantiation (`app.trayIcon` block AND `TrayIconBuilder`). (c) **this verify** —
  `node scripts/test.mjs | tail -40` reported exit 0 while node's real exit was **1** (a pipe returns the
  last command's exit, masking the failure); re-running unpiped surfaced the actual red. **How to apply:**
  verify at the source the system actually reads (the DB behind the UI, a fresh process, the *unpiped*
  exit code) — never a proxy (a deleted file, a prior assumption, a piped exit). When the operator says a
  fix didn't work, believe the observation and re-derive; do not re-assert the fix. (This is the
  operator's explicit standing instruction — recorded to memory.)

- **R3 — A gate test that only fails under aggregated load is a real gate defect, not "just a flake".**
  F2 (`mesh-ui-global-scope/00 --local … prints a Project: line`) passed 5/5 in isolation but failed the
  full suite: a `launchFleet` **arg-slot bug** — the test passed its custom `readyRe` into the helper's
  3rd (`env`) parameter instead of the 4th (options) slot, so the helper fell back to the DEFAULT
  URL-only readiness and resolved before the `Project:` line (logged immediately after in the child)
  reached the parent's stdout under load. This is the concrete resolution of **[34/R7]**'s flagged debt
  ("the spawn-heavy CLI tests want a stricter readiness barrier"). **How to apply:** gate a spawn test's
  readiness on the exact output its assertions read (all lines, not just the first); pass helper options
  in the correct positional slot; and make the launch helper **reject on a ready-timeout** so a partial
  read fails loud + retryable rather than silently returning truncated stdout. A recurring flake is debt
  to fix at its mechanism, not to re-run past.

- **R4 — Code the render against the RESEARCH-measured contract, not the framing brief's sketch.** The
  refine brief assumed a FLATTER `mesh:status` shape (`activeRuns`/`localId` flat on each node); RESEARCH
  §3 measured the REAL nested shape — `{ nodes, boards, isControlNode }` with `presence.activeRuns` /
  `aofVersion` nested, `node.local`, `node.stale`. ADR-004 codes against the measured shape and the build
  followed it. **How to apply:** when a milestone renders an existing contract, the developer codes
  against the measured wire (RESEARCH), never the PO's framing sketch — framing names intent, RESEARCH
  names the bytes. Measure it at refine so the gap is caught before code, not at verify.

- **R5 — Presence that claims "what a node is doing" must be fed by the actual activity signal, not just
  executed task-runs (F-IDLE → milestone 38).** The fleet rendered a node `idle` while it was being
  actively coded on two repos, because "current work" only counts `running` run records (an editor/
  assistant session creates none) and the presence publisher reads ONE workspace (the daemon's launch
  cwd). Root-caused at the data source (sqlite + run store inspected directly), and the render pipeline
  proven SOUND by injecting a real `running` run (it surfaced in `mesh status` and rendered). **How to
  apply:** a "live activity" signal needs a live-session feed (assistant hooks → `aof session
  start|ping|end`, TTL liveness) aggregated across ALL the node's workspaces — deferred to milestone 38,
  which this UAT originated. The desktop app's read-only render was never the gap; what fed it was.

- **GAP-1 — cadence/interval numbers are never literal copy.** The error banner read "Retrying every 5s"
  against a real 3s poll. Set as a standing DESIGN.md rule (bind any shown interval to the single
  poll-cadence constant, or omit it); the copy reconcile is deferred (operator chose record-rule + defer).
  **How to apply:** a copy string must never assert a cadence/interval the code does not run — bind it to
  the constant at author time.

## What went right

- **The re-wire applied [02/R5] preemptively, and the milestone did NOT accept on a pure-seam green.**
  The F1 near-miss was recalled unconditionally at the re-wire; the accept waited for a real
  cross-machine live run. The workstream is learning forward — the pure-seam-green trap was named and
  refused, not rediscovered later.
- **R2 was applied within this same session:** running the suite UNPIPED at verify caught the masked
  red (exit-0-via-`tail`) that would otherwise have accepted a milestone over a still-failing shared gate.
- **The build-review designer/QA gate caught real fixes before verify** (5 at the surface build, 2 at the
  F1 re-wire), and the mocks were rendered FROM the implemented UI (a 1:1 baseline), so design
  conformance is definitionally anchored rather than aspirational.
- **The five `acd-desktop-*` fitness functions held across the F1 runtime** — single `mesh status` data
  path, `{status,serve,ui}` allow-list, trusted co-located spawn, read-only fleet — proven non-vacuous
  against the real `.rs`, not just the pure core.

## Open house-convention question (carry to a deliberate decision)

- **Per-file `node --test` runnability.** Story 03's developer added `node:test` self-registration so
  `node --test <file>` runs a test module directly — new to the repo (all 200+ existing modules are
  array-only, run via `scripts/test.mjs`). Reverted to array-only for consistency this milestone; worth a
  deliberate decision on whether per-file runnability should become the house convention (it would have
  made this milestone's F2 flake diagnosis a one-liner instead of a scratch harness).

## Findings ledger (from VERIFICATION.md)

- **F-UAT1** (missing ACL capability) — window not draggable → `capabilities/default.json` +
  `data-tauri-drag-region`. FIXED, operator-confirmed.
- **F-UAT2** (CSS host-chrome) — window didn't fill the frameless shell; scrollbar outside →
  `data-host="tauri"` fill + `scrollbar-gutter:stable`. FIXED, operator-confirmed.
- **F-UAT3** (lifecycle) — no process singleton → `tauri-plugin-single-instance`. FIXED, operator-confirmed.
- **F-UAT4** (asset-path, packaged-run) — blue-square placeholder tray icons → `include_bytes!` +
  `Image::from_bytes` + regenerated brand marks. FIXED, operator-confirmed.
- **F-UAT5** (interaction) — left-click tray didn't open the window → `show_menu_on_left_click(false)` +
  `on_tray_icon_event` Left/Up → show+focus. FIXED, operator-confirmed.
- **F-UAT6** (double-instantiation) — one launch made two tray icons → removed the `app.trayIcon` config
  block (code owns the single tray). FIXED, operator-confirmed. See R2.
- **F-UAT7** (wrong URL) — "Open web UI" opened a blank page → `MESH_UI_URL` carries
  `?mode=fleet&scope=global`. FIXED, operator-confirmed.
- **GAP-1** (design-gap, non-blocker) — banner cadence copy vs real 3s poll → standing DESIGN rule set;
  copy fix deferred. See GAP-1 lesson.
- **F-IDLE** (presence-input capability gap, non-blocker for m36) — fleet `idle` while working →
  root-caused at the data source; deferred to **milestone 38** (session-presence + multi-workspace
  aggregation). See R5.
- **F1** (prior blocker) — live supervisor unimplemented → re-wired to real OS effects + live-run
  confirmed cross-machine. RESOLVED. See R1.
- **F2** (gate-blocker, prior verify) — shared suite red by 1 flaky test → `launchFleet` arg-slot fix;
  suite green. RESOLVED. See R3.
