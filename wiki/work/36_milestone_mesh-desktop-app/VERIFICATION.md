---
doc: verification
ref: "36"
verified: 2026-07-10
verdict: accepted
---
# 36 · Mesh Desktop App — Verification

Verification lanes in scope: **`@executable`** (cargo core + the Node `mesh-desktop` verb suite +
five `acd-desktop-*` fitness functions), **`@manual`** (agent/developer-run — story 00 t02/t03,
story 01 t02), and **`@uat`** (human — story 01 t03 tray visual, story 02 t03 window visual, story 03
t03 the milestone's outsider install→launch acceptance). **Outcome: ACCEPTED (2026-07-10).**

The `2026-07-09` verify recorded **NOT ACCEPTED** behind blocker **F1** — the Tauri shell was a
structural scaffold with every live behaviour stubbed. F1 was then **re-wired** (`aof:continue 36`,
`supervisor.rs` + a rewritten `main.rs`) and, at this verify, the live runtime was **run end-to-end on
real hardware across two machines** and human-accepted. Seven UAT defects surfaced during that live run
were fixed inline and re-confirmed (F-UAT1–7); one design-gap (GAP-1) set a standing rule; one live
finding (F-IDLE — "idle while working") was root-caused **at the data source** and deferred to a new
milestone (38), as it is a presence-input capability gap, not an m36 render defect. F1 and the external
suite red F2 are both **resolved**. No blocker finding is open.

## @executable evidence

Green via the central runner (`node scripts/test.mjs`, node-exit 0) and the guard-if-present cargo
lanes, all milestone-36 lanes passing:

- **cargo test (`app/desktop/crates/core`) — 67 ok / 0 failed** (`cargo 1.93.1`; folded into
  `scripts/test.mjs` as `ok - cargo test (app/desktop)`, with `ok - cargo check (app/desktop shell)`
  keeping the excluded Tauri bin compiling — clean, 0 warnings). Covers the pure seams: `resolve`
  (trusted co-located, shell-less argv, PATH-hijack-proof), `poll` (single-data-path cadence over a
  fake spawner), `status`/`view_model` (nested `{nodes,boards,isControlNode}` shape;
  `presence.activeRuns` / `node.local` / `node.stale` mapping; multi-node none-dropped),
  `supervision` (role set off `isControlNode`; jittered-exponential backoff grows + carries jitter;
  crash→Restarting vs named clean-exit→CleanExit state machine), `icon`/`tray_menu`/`render_state`/
  `read_only_inventory`.
  verifies → story 00 tasks 00/01, story 01 tasks 00/01, story 02 tasks 00/01/02 (`@executable`).
- **Node `mesh-desktop` verb suite — all ok** (`-dispatch` / `-install` / `-run`): the
  `aof mesh desktop install|run` CLI-only nested verbs dispatch outside the bijection, single `--json`
  envelope, unknown-flag/unknown-verb refusals; install places into `$HOME/.aof/bin` idempotently
  beside the m28 binary + the WebView2 bootstrapper, friendly-refusal matrix + partial-install
  rollback; run discovers by absolute co-located path and detaches.
  verifies → story 03 tasks 00/01/02 (`@executable`).
- **Five `acd-desktop-*` fitness functions — armed + green, non-vacuous** against the real `.rs`
  subtree (each self-check confirms a planted violation trips the detector): `no-mesh-logic`,
  `single-data-path`, `read-only-fleet`, `trusted-spawn` (ADR-004 d1-4), `verbs-outside-bijection`
  (ADR-003) — all still honoured by the F1 runtime, not just the pure core.
  verifies → ARCHITECTURE.md `## Fitness functions`.

**Suite total: 2321 ok / 0 not-ok (node-exit 0); both cargo lanes ok.** The one red the prior verify
recorded (F2 — `mesh-ui-global-scope/00 --local … prints a Project: line`) was diagnosed at this
verify as a **flaky test** (not a code regression) and de-flaked — see **F2** below.

## @manual evidence — the live supervisor runtime, empirically verified (not inspected)

The F1 re-wire moved every live behaviour from a `main.rs` placeholder into a real engine
(`app/desktop/crates/app/src/supervisor.rs`: own multi-thread tokio runtime, `poll_loop`,
`supervise_child`, a `win32job` Job Object). At this verify each `@manual` scenario was **run on the
live Windows app** and observed — not read from source:

- **Live status poll (story 00 t01 runtime / story 02 render).** The `mesh status --json` poll on the
  3s cadence populates `last_good_status`; the window renders the real fleet (keep-last-good on a miss),
  not the loading skeleton. Observed rendering the live 2-node cross-machine fleet.
  verifies → story 00 `01`, story 02 `00`/`01`/`02` (runtime).
- **Real supervision + crash→restart (story 00 t02).** `supervise_child` spawns the real
  `tokio::process` children (`aof mesh serve --serve`, `aof mesh ui`); a genuine crash restarts under
  the jittered backoff, while a named clean-exit-1 (`ui-build-missing` / `EADDRINUSE` /
  launcher-already-running) is **surfaced, not restart-stormed**. Observed a killed child re-spawn under
  backoff and a named clean-exit held. verifies → story 00 `02_supervision-restart-and-role` (`@manual`).
- **Job-Object reap — no orphans (story 00 t03).** Every child is assigned to the
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` job; quitting/killing the supervisor reaps the whole child tree
  (no orphaned `aof`/node processes survive). Observed the tree gone after Quit.
  verifies → story 00 `03_job-object-reap` (`@manual`).
- **Ambient residency (story 01 t02).** `WindowEvent::CloseRequested → prevent_close + hide` and
  `RunEvent::ExitRequested (code.is_none()) → prevent_exit` — closing the window sends it to the tray
  and the supervisor keeps running; Quit is the only true exit. Single-instance guard confirmed (a 2nd
  launch focuses the existing window). Observed. verifies → story 01 `02_ambient-residency-and-actions`.
- **Start/Stop drive the real local children (story 01 t02).** Tray-menu and window control-bar
  Start/Stop spawn/stop the real local supervisor children (LOCAL supervision only). Observed the
  processes appear/disappear. verifies → story 01 `02`.
- **Open web UI (story 01 t02).** The tray `open-web-ui` arm launches the running UI via
  `opener::open_browser` at the fleet URL. (Blank-page defect found + fixed — see F-UAT7.) Observed the
  browser opening the populated fleet page. verifies → story 01 `02`.

## @uat sign-off — full cross-machine end-to-end (human-accepted)

The milestone's outsider acceptance (story 03 `03_end-to-end-install-launch`) was brokered live with
the operator, run **across two real machines**:

- **Nodes:** `umairs-msi` (Windows 11, **control node**, running the desktop app) + `umairs-mac-mini`
  (macOS, **worker node**, running the mesh via CLI) — joined over the Tailscale fabric.
- **Procedure + result (operator-confirmed):**
  1. A single `aof mesh desktop install` placed the app into `$HOME/.aof/bin` beside the m28 binary. ✓
  2. Launch put a **tray icon on the Windows taskbar** (the real 4-dot brand mark — see F-UAT4). ✓
  3. The app brought the **mesh server AND `aof mesh ui` up and kept them up across a crash** (the
     Job-Object-contained, backoff-restarted supervision above). ✓
  4. The window rendered the mesh's **nodes and their current work** — both machines visible, live —
     read from the same `aof mesh status` contract (no second data path). ✓
  5. All **with the terminal closed** — ambient in the tray, single-instance. ✓
- **Sign-off:** operator confirmed the app works end-to-end after the seven inline fixes below
  ("Yes working now" / "Yep works"). The milestone objective — "install once, it's always there in the
  tray … brings the mesh up and keeps it up … window shows nodes + current work, terminal closed" — is
  **met and accepted**.

**Design conformance (story 01 t03 tray visual, story 02 t03 window visual) — CONFORMS (with one
residual).** The delivered surfaces are the design baseline (the committed `mocks/` were rendered
**from** the implemented UI, 1:1) and the build-review designer pass returned **CONFORMS** for both
surfaces / all four window states / both themes; the live UAT visually confirmed the rendered window,
tray, menu, and real icons. *Residual (non-blocking):* the **worker-node desktop-window** variant
(server-control omitted) and the full `restarting`/`stopped`/`loading`/`error` pill matrix were not each
re-rendered for a fresh designer judgement in this live pass — the app ships Windows-only and the
control-node primary path was fully exercised (a crash→restart *was* observed live). Carried as a
low-priority follow-up, not an acceptance gap.

## Findings

Seven UAT defects (F-UAT1–7), one design-gap (GAP-1), one deferred live finding (F-IDLE); the prior
blocker (F1) and the external suite red (F2) are both resolved. **No blocker is open.**

- **F-UAT1 — the window was not draggable.** *observed:* dragging the custom (frameless) titlebar did
  nothing. *root cause:* the Tauri capabilities file was empty (`{}`); `core:window:start_dragging` is a
  core-plugin command needing the `core:window:allow-start-dragging` capability. *fix:* created
  `app/desktop/crates/app/capabilities/default.json` (start-dragging + minimize/maximize/unmaximize for
  window "main"); titlebar got `data-tauri-drag-region`. *type:* missing ACL capability · *severity:*
  UAT-blocker (fixed inline). *status:* **FIXED — operator-confirmed** ("Draggable now").
- **F-UAT2 — the window did not fill the frameless shell; the vertical scrollbar sat outside.**
  *fix:* `styles.css` — `:root[data-host="tauri"] .window { width:100vw;height:100vh;border-radius:0;
  border:none;box-shadow:none }` + `body { display:block;background:transparent }`; `.body {
  scrollbar-gutter:stable }` + webkit scrollbar styling so the scrollbar sits inside. *type:* CSS
  (host-chrome) · *severity:* minor (fixed inline). *status:* **FIXED — operator-confirmed.**
- **F-UAT3 — no process singleton (memory-leak concern).** *observed:* a second launch left two
  resident processes. *fix:* added `tauri-plugin-single-instance` — a 2nd launch focuses+unminimizes the
  existing window instead of spawning a 2nd process. *type:* lifecycle · *severity:* major (fixed
  inline). *status:* **FIXED — operator-confirmed.**
- **F-UAT4 — tray icons were blue-square placeholders.** *root cause:* icons loaded via a relative
  `Image::from_path("icons/…")` that fails from the install dir → fell back to the default window-icon
  placeholder. *fix:* embed at compile time (`include_bytes!` → `TRAY_HEALTHY/DEGRADED/STOPPED` +
  `Image::from_bytes`); regenerated the real 4-dot brand marks (healthy / degraded-amber / stopped-grey).
  *type:* asset-path (packaged-run) · *severity:* major (fixed inline). *status:* **FIXED —
  operator-confirmed.**
- **F-UAT5 — left-clicking the tray icon did not open the window.** *observed:* only the right-click
  menu worked. *fix:* `.show_menu_on_left_click(false)` + `.on_tray_icon_event` handling
  `TrayIconEvent::Click { button: Left, button_state: Up }` → show + unminimize + focus. *type:*
  interaction · *severity:* minor (fixed inline). *status:* **FIXED — operator-confirmed** ("clicking
  re-opens app").
- **F-UAT6 — a single fresh launch created TWO tray icons.** *observed:* one launch produced two tray
  icons (one live/right-clickable, one dead duplicate). *root cause:* BOTH the config `app.trayIcon`
  block AND the code's `TrayIconBuilder` created a tray. *fix:* removed the `app.trayIcon` block from
  `tauri.conf.json` — the code owns the single tray. *type:* double-instantiation (config × code) ·
  *severity:* major (fixed inline). *status:* **FIXED — operator-confirmed** ("Yes working now").
  *(Process note: I mis-assumed "ghost icon" several times before the operator showed a fresh launch
  still making two → the real root cause. Recorded as the retro lesson — confirm at the source.)*
- **F-UAT7 — "Open web UI" opened a blank page.** *root cause:* `MESH_UI_URL` was bare
  `http://127.0.0.1:4181/`, but `aof mesh ui` at `/` renders blank — it needs `?mode=fleet&scope=global`
  (the exact URL the CLI itself advertises). *fix:* `MESH_UI_URL =
  "http://127.0.0.1:4181/?mode=fleet&scope=global"` (`supervisor.rs`). *type:* wrong URL · *severity:*
  major (fixed inline). *status:* **FIXED — operator-confirmed.**

- **GAP-1 (design-gap) — the error banner read "Retrying every 5s" against a real 3s poll cadence.**
  *type:* design-gap (copy-vs-behaviour) · *severity:* non-blocker. *triage (designer):* set a **standing
  DESIGN.md rule** (§Review notes) — cadence/interval numbers are never literal copy; bind them to the
  single poll-cadence constant (3s) or omit them. The copy reconcile is **deferred** (operator chose
  "record rule + defer fix" at UAT start). *routed-to:* DESIGN.md rule (set) → backlog for the copy edit.
  *status:* **RULE SET; copy fix deferred.**

- **F-IDLE — the fleet rendered a node `idle` while it was actively being worked on (two repos).**
  *observed:* the desktop window showed the control node `idle` during active coding on two repos.
  *root cause (traced at the data source — sqlite + run store inspected directly, not assumed):* (a)
  **zero `running` run records** exist — "current work" only counts executed aof task-runs (via
  `startRun`); an editor/assistant **session** creates none; (b) the presence publisher
  (`src/mesh-launcher.mjs` `assembleCurrentPresenceRecord`) reads `listItems` for **one** workspace (the
  daemon's launch cwd), so a tray app launched from the install dir reflects an empty workspace. The
  render pipeline was proven **sound** by injecting a real `running` run → it surfaced in `mesh status`
  (`activeRuns`) and rendered in the window; then cleaned up. *type:* presence-**input** capability gap
  (what feeds presence), **not** an m36 render defect · *severity:* **non-blocker for m36** (m36's
  read-only render of the `mesh:status`/`activeRuns` contract is correct + proven; live-session presence
  is explicitly out of m36 scope). *triage (PO):* defer → new milestone. **Framed milestone 38**
  (session-presence via assistant hooks + multi-workspace aggregation + worker repo checkout +
  worktrees), which cites this UAT as its origin. *routed-to:* **milestone 38.** *status:* **DEFERRED →
  m38.**

- **F1 (prior blocker) — RESOLVED.** The whole live supervisor runtime is implemented in
  `supervisor.rs` + the rewritten `main.rs` (six items: live poll, real `tokio::process` supervision +
  restart/backoff, Job-Object `KILL_ON_JOB_CLOSE` reap, `prevent_close`/`prevent_exit` ambient residency,
  Start/Stop real spawn, `opener::open_browser` web UI). Build-review PASS (architect CONFORMS, QA PASS,
  2 fixes) and — at this verify — **live-run confirmed cross-machine** (see `@manual` + `@uat` above).
  *status:* **CLOSED.**

- **F2 (external suite red, prior verify) — RESOLVED.** *observed:* `mesh-ui-global-scope/00 --local …
  prints a Project: line` intermittently failed the shared suite. *root cause (at this verify):* **a
  flaky test, not a code regression** — the test passed its custom `readyRe` into `launchFleet`'s **3rd
  (`env`) argument** instead of the 4th (options) slot, so `launchFleet` fell back to the **default**
  URL-only readiness and resolved before the `Project:` line (logged immediately after in the child)
  reached the parent's stdout under aggregated load. Passed 5/5 in isolation; failed only under load.
  *fix:* pass the options object in the correct 4th slot so readiness gates on **both** the URL and
  `Project:` lines (`test/mesh-ui-global-scope.test.mjs`, test-only). *type:* test-harness arg-slot bug ·
  *severity:* gate-blocker (the shared `@executable` gate must be green to accept any milestone).
  *status:* **FIXED — suite green (0 not-ok).**

## Accept decision

**Milestone 36 — ACCEPTED (2026-07-10, `aof:verify 36`).** The `@executable` layer is green (cargo core
67/0; both cargo lanes ok; the `mesh-desktop` verb suite; all five `acd-desktop-*` fitness functions
armed + non-vacuous against the real `.rs`; **full `node scripts/test.mjs` = 2321 ok / 0 not-ok,
node-exit 0** after the F2 de-flake). The `@manual` live-supervision lanes were **run and observed** on
the real Windows app (poll render, real supervision + crash→restart, Job-Object reap with no orphans,
ambient hide-to-tray, Start/Stop real spawn, Open-web-UI). The `@uat` outsider acceptance was **brokered
live across two machines** (Windows control + macOS worker over Tailscale) and **operator-confirmed**.
Seven UAT defects (F-UAT1–7) were fixed inline and re-confirmed; the prior blocker F1 and the external
F2 are resolved; the one design-gap (GAP-1) set a standing rule; the one deferred live finding (F-IDLE)
is a presence-input capability gap routed to **milestone 38**, not an m36 render defect. Per the
acceptance rule (accept only when validate passes **and** no blocker finding is open), **all four stories
→ `done` and the milestone → `done`.**

**Retrospective:** run at the close — see [`RETROSPECTIVE.md`](RETROSPECTIVE.md). Carries the STATE
`## Feedback (for retro)` notes, the standing data-contract flag (the refine brief's flatter
`mesh:status` assumption vs the measured nested shape), the **F1 lesson** (a `@manual`/`@uat` tag is a
verification *lane*, not a licence to defer the implementation it verifies — the runtime wiring must
exist at build, or the task is not built), and the **UAT process lesson** (F-UAT6 / the workspace-cleanup
mis-step: do not assume a fix landed — confirm at the source, including inspecting the sqlite DB
directly).
