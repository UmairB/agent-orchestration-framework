# `app/desktop/ui` — the Mesh Desktop App WebView UI

The HTML/CSS/JS view for **milestone 36 · Mesh Desktop App** (ADR-001 → Tauri v2, WebView2-hosted).
This is the rendered surface only — the **node/work window** (DESIGN.md §Surface 1) and the **tray menu**
(§Surface 2). It realizes the approved claude.ai design (`../../wiki/work/36_milestone_mesh-desktop-app/mocks/AOF Mesh - standalone.html`)
as clean, ship-quality vanilla code — the exact tokens/structure, no design-tool runtime.

## Files
- `index.html` — the frameless window shell (title bar + control bar + body + footer).
- `styles.css` — the design system: light/dark token sets (lifted verbatim from the design), the
  presence-dot ramp, the four body states, animations.
- `app.js` — the renderer. **`mapStatusToView()` is story 02's `status-render-model`** — a pure view-model
  over the **corrected `mesh status --json` shape** (`{ nodes, boards, isControlNode }`;
  `presence.activeRuns` / `presence.aofVersion` nested; `node.local`; `node.stale`). The two ramps read from
  **separate** inputs: `FLEET_STATUS` (mesh:status → body dots) vs `LOCAL_STATE` (supervisor → control-bar
  pills). Read-only over the fleet — no assign/route affordance exists.
- `tray.html` — the taskbar tray menu (self-contained; header roll-up + Start/Stop mesh + Open web UI +
  Show/Hide + Quit; a **worker node omits the server control** via `?role=worker`).

## Run / screenshot
Open `index.html` in any browser. Demo params drive the states without a live mesh:
- `index.html?state=populated|empty|loading|error` · `&theme=light|dark`
- `tray.html?theme=light|dark&role=control|worker&server=running|stopped`

The `@uat` design gate (story 02 `03_visual-conformance`, story 01 `03_tray-icon-visual`) renders these via
the cached ms-playwright Chromium (`--headless --screenshot=<ABSOLUTE forward-slash path>`), exactly as the
committed mock PNGs (`mocks/node-work-window.png`, `mocks/tray-menu.png`) were produced from this UI.

## IPC wiring (stories 01/02)

`app.js` now detects the Tauri host (`window.__TAURI_INTERNALS__.invoke`, present regardless of the
`withGlobalTauri` config flag) and branches:
- **Under Tauri** (`../crates/app`, the shell scaffold): fetches the already-shaped view-model from the
  `get_view_model` IPC command — the Rust core (`mesh-desktop-core::view_model`/`render_state`) is
  AUTHORITATIVE, this file only normalizes field names and renders, never re-derives the mapping.
- **Standalone in a browser** (no Tauri host — the screenshot/`@uat` harness, the committed mocks): falls
  back to the `FLEET_STATUS`/`LOCAL_STATE` fixtures and `mapStatusToView()`, unchanged — the `?state=`/
  `?theme=` demo params still work exactly as before.

The tray (`tray.html`) is analogously replaced, under Tauri, by a REAL native `TrayIconBuilder` menu built
from the core's `tray_menu()`/`icon_state()` (see `../crates/app/src/main.rs`) — `tray.html` itself stays the
screenshot/mock-authoring surface for `@uat`, not a runtime asset the packaged app loads.

## Not yet wired (the rest of milestone 36 — via `aof:continue 36`)
- **The real watchdog loop** (story 00 task 02, `@manual`) — the REAL `tokio::process` spawn + restart/backoff
  + Job-Object containment behind story 00's pure `supervision.rs` seams; `crates/app/src/main.rs`'s IPC
  handlers currently flip in-memory state as placeholders for this real engine.
- **Ambient residency** (story 01 task 02, `@manual`) — the real `prevent_close`+`hide` window-event wiring
  (hide-to-tray on close) and the real default-browser launch for "Open web UI".
- **CLI verbs** (story 03) — `aof mesh desktop install` / `aof mesh desktop run`.
- **`crates/app`'s real tray/window run** is scaffolded and builds (`cargo build --manifest-path
  crates/app/Cargo.toml`), deliberately EXCLUDED from the `app/desktop/` Cargo workspace so `cargo test` at
  the workspace root stays core-only/fast — see `../Cargo.toml`.
