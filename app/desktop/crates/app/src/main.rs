// Milestone 36 · Mesh Desktop App — the Tauri v2 shell (ADR-001).
//
// This bin crate is the glue between the cargo-tested pure core (`mesh_desktop_core`)
// and the real OS: it loads `ui/` (the WebView HTML/CSS/JS, ADR-001), builds the tray
// from the CORE's pure `tray_menu()`/`icon_state()` selectors, opens the frameless
// node/work window, and drives the LIVE supervisor engine (`supervisor.rs`) — the real
// `mesh status --json` poll, the role-driven `tokio::process` watchdog with
// restart/backoff, and the Windows Job-Object kill-on-close reap.
//
// It makes NO decisions of its own: icon state, menu shape, view-model rows, render
// state, the read-only affordance set, the supervised set, the backoff curve, and the
// crash-vs-clean-exit classification are ALL computed by the already-`cargo test`-covered
// core; this file (and `supervisor.rs`) only turn those decisions into Tauri plumbing +
// real process effects.
//
// READ-ONLY OVER THE FLEET (ADR-004 d3): the only `aof mesh` verbs this shell ever
// spawns are `status` (the poll), `serve` (local supervision), and `ui` (local
// supervision), via the core's `resolve`/`supervision` seams. No fleet-mutating verb is
// reachable from any surface (acd-desktop-read-only-fleet). "Open web UI" launches a
// browser at the running UI's local URL — not an `aof` spawn.

mod supervisor;

use mesh_desktop_core::icon::{icon_state, AppSupervisionState, FleetSummary, ServerProcessState};
use mesh_desktop_core::read_only_inventory::{window_affordance_inventory, ALLOWED_MESH_VERBS};
use mesh_desktop_core::tray_menu::{
    tray_menu, FleetHeaderSummary, MenuItemId, MenuItemKind, Role, ServerState, UiState,
    WindowVisibility,
};
use mesh_desktop_core::view_model::node_rows;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use supervisor::{SharedState, SupervisorCommand, SupervisorState};
use tauri::menu::{Menu, MenuItem as TauriMenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
use tokio::sync::mpsc::UnboundedSender;

/// The Tauri-managed app state: the shared supervisor state (read by the view/tray) and
/// the command channel into the running engine (driven by the tray/window controls).
struct AppState {
    shared: SharedState,
    tx: UnboundedSender<SupervisorCommand>,
}

/// One node row handed to the WebView over IPC — a thin serialization of the core's
/// already-computed `node_rows()`, never a re-derivation in JS.
#[derive(Serialize)]
struct IpcNodeRow {
    name: String,
    this_node: bool,
    role: &'static str,
    version: String,
    health_dot: &'static str,
    current_work: String,
    work_state: &'static str,
}

/// The full IPC view-model: the fleet rows + the four-state render selection (FLEET
/// ramp) AND the local-process signals for the control bar (LOCAL ramp) — the two
/// DESIGN ramps carried as distinct fields so the view never conflates them.
#[derive(Serialize)]
struct IpcViewModel {
    is_control_node: bool,
    nodes: Vec<IpcNodeRow>,
    render_state: &'static str,
    server_state: &'static str,
    ui_state: &'static str,
    ui_url: String,
    /// The last named clean-exit-1 reason surfaced to the operator (ui-build-missing /
    /// EADDRINUSE / launcher-already-running), or `None` — so the "surface the message"
    /// half of ADR-002 d2 is observable, not just captured. Cleared on a successful
    /// (re)start.
    notice: Option<String>,
}

/// IPC command: the WebView's ONLY way to obtain fleet data — reads the last-polled
/// `mesh status` result the engine holds (populated by the single poll cadence, never a
/// fresh spawn from the IPC handler; the single-data-path invariant).
#[tauri::command]
fn get_view_model(state: State<AppState>) -> IpcViewModel {
    let g = state.shared.lock().expect("supervisor state mutex poisoned");
    let nodes = match &g.last_good_status {
        Some(status) => node_rows(status)
            .into_iter()
            .map(|row| IpcNodeRow {
                name: row.name.clone(),
                this_node: row.this_node,
                role: row.role_badge.label(),
                version: row.version_cell(),
                health_dot: row.health_dot.label(),
                current_work: row.current_work.display(),
                work_state: row.current_work.state_str(),
            })
            .collect(),
        None => vec![],
    };
    IpcViewModel {
        is_control_node: g.is_control_node,
        nodes,
        render_state: g.render_state.as_str(),
        server_state: g.server_signal,
        ui_state: g.ui_signal,
        ui_url: g.ui_url.clone(),
        notice: g.last_clean_exit.clone(),
    }
}

/// IPC command: start the LOCAL Mesh server (`aof mesh serve --serve`) on THIS machine
/// — routed to the engine's real spawn. Local supervision only ({status, serve, ui}
/// allow-list, ADR-004 d3); never a fleet mutation.
#[tauri::command]
fn start_mesh_server(state: State<AppState>) {
    debug_assert!(ALLOWED_MESH_VERBS.contains(&"serve"));
    let _ = state.tx.send(SupervisorCommand::StartServer);
}

/// IPC command: stop the LOCAL Mesh server — local supervision only.
#[tauri::command]
fn stop_mesh_server(state: State<AppState>) {
    let _ = state.tx.send(SupervisorCommand::StopServer);
}

/// IPC command: start the LOCAL Mesh web UI (`aof mesh ui`) — local supervision only.
#[tauri::command]
fn start_mesh_ui(state: State<AppState>) {
    debug_assert!(ALLOWED_MESH_VERBS.contains(&"ui"));
    let _ = state.tx.send(SupervisorCommand::StartUi);
}

/// IPC command: stop the LOCAL Mesh web UI — local supervision only.
#[tauri::command]
fn stop_mesh_ui(state: State<AppState>) {
    let _ = state.tx.send(SupervisorCommand::StopUi);
}

/// IPC command: open the RUNNING `aof mesh ui` at its real local URL in the default
/// browser (DESIGN §Surface 2 region 3). Inert when the UI child is not running — there
/// is nothing to open. Launches a browser (`opener`), not an `aof` spawn — no fleet
/// state is mutated.
#[tauri::command]
fn open_web_ui(state: State<AppState>) {
    let (running, url) = {
        let g = state.shared.lock().expect("supervisor state mutex poisoned");
        (g.ui_signal == "running", g.ui_url.clone())
    };
    if running {
        let _ = opener::open_browser(&url);
    }
}

/// IPC command: toggle the main window's visibility (Show/Hide — DESIGN §Surface 2
/// region 4). Never a full exit — only Quit exits (DESIGN "UI BEHAVIOUR").
#[tauri::command]
fn toggle_window(app: AppHandle, state: State<AppState>) {
    do_toggle_window(&app, &state.shared);
}

/// IPC command: minimize the frameless main window (the custom titlebar's `–`
/// control — a frameless window has no native caption buttons, so the WebView chrome
/// drives them through this narrow IPC rather than exposing the whole Tauri API).
#[tauri::command]
fn minimize_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
}

/// IPC command: toggle maximize/restore of the main window (the custom titlebar's
/// `▢` control).
#[tauri::command]
fn toggle_maximize_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

/// IPC command: the custom titlebar's `✕` control — HIDES the window to the tray
/// (ambient residency), mirroring the native `CloseRequested` handler. Never a full
/// exit; only Quit exits (DESIGN §Surface 1 region 1 "Closing the window hides to
/// tray", DESIGN "UI BEHAVIOUR").
#[tauri::command]
fn hide_to_tray(app: AppHandle, state: State<AppState>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        state
            .shared
            .lock()
            .expect("supervisor state mutex poisoned")
            .window_visible = false;
        supervisor::refresh_tray(&app, &state.shared);
    }
}

/// Show/Hide the main window and reflect the new visibility in the state + tray label.
fn do_toggle_window(app: &AppHandle, shared: &SharedState) {
    if let Some(window) = app.get_webview_window("main") {
        {
            let mut g = shared.lock().expect("supervisor state mutex poisoned");
            if g.window_visible {
                let _ = window.hide();
                g.window_visible = false;
            } else {
                let _ = window.show();
                let _ = window.set_focus();
                g.window_visible = true;
            }
        }
        supervisor::refresh_tray(app, shared);
    }
}

/// Build the native tray menu from the core's PURE `tray_menu()` model — this function
/// only translates the returned descriptor into `tauri::menu` items; it makes NO
/// menu-shape decisions of its own (those live in `mesh_desktop_core::tray_menu`).
fn build_tray_menu(app: &AppHandle, s: &SupervisorState) -> tauri::Result<Menu<tauri::Wry>> {
    let role = if s.is_control_node { Role::Control } else { Role::Worker };
    // A non-stopped local server ("running"/"restarting") shows the "Stop mesh" control.
    let server = if s.server_signal == "stopped" { ServerState::Stopped } else { ServerState::Running };
    let ui = if s.ui_signal == "running" { UiState::Running } else { UiState::Stopped };
    let window = if s.window_visible { WindowVisibility::Visible } else { WindowVisibility::Hidden };
    let fleet = match &s.last_good_status {
        Some(status) => {
            let online = status.nodes.iter().filter(|n| n.has_presence() && !n.stale).count() as u32;
            let stale = status.nodes.iter().filter(|n| n.stale).count() as u32;
            FleetHeaderSummary::Populated { online, stale }
        }
        None => FleetHeaderSummary::Loading,
    };

    let items = tray_menu(role, server, ui, window, fleet);
    let builder = Menu::new(app)?;
    for item in items {
        match item.kind {
            MenuItemKind::Header => {
                // A disabled emphasis first item (DESIGN §Surface 2 region 1 "quiet").
                let header = TauriMenuItem::with_id(app, "header", &item.label, false, None::<&str>)?;
                builder.append(&header)?;
            }
            MenuItemKind::Action => {
                let id = match item.id {
                    MenuItemId::ServerControl => "server-control",
                    MenuItemId::OpenWebUi => "open-web-ui",
                    MenuItemId::WindowToggle => "window-toggle",
                    MenuItemId::Quit => "quit",
                    _ => "action",
                };
                let action = TauriMenuItem::with_id(app, id, &item.label, item.enabled, None::<&str>)?;
                builder.append(&action)?;
            }
            MenuItemKind::Separator => {
                builder.append(&PredefinedMenuItem::separator(app)?)?;
            }
        }
    }
    Ok(builder)
}

/// Pick WHICH icon asset the tray shows from the core's PURE `icon_state()` selector.
/// The local-process input is the role-relevant child: the Mesh server on a control
/// node, the Mesh web UI on a worker (which has no server) — so a healthy worker isn't
/// perpetually "stopped" for lack of a server it never runs.
// The three tray-state glyphs are EMBEDDED in the binary (not loaded from a relative
// `icons/…` path) — a packaged app runs from `$HOME/.aof/bin`, where a relative path
// would miss and the tray would silently fall back to the default window icon. Embedding
// makes the ambient health glyph travel inside the exe, resolvable from any cwd.
const TRAY_HEALTHY: &[u8] = include_bytes!("../icons/tray-healthy.png");
const TRAY_DEGRADED: &[u8] = include_bytes!("../icons/tray-degraded.png");
const TRAY_STOPPED: &[u8] = include_bytes!("../icons/tray-stopped.png");

fn tray_icon_bytes(s: &SupervisorState) -> &'static [u8] {
    let fleet = match &s.last_good_status {
        Some(status) => {
            if status.nodes.iter().any(|n| n.stale) {
                FleetSummary::SomeStale
            } else if status.nodes.is_empty() {
                FleetSummary::NoNodes
            } else {
                FleetSummary::AllOnline
            }
        }
        None => FleetSummary::NoNodes,
    };
    let local_signal = if s.is_control_node { s.server_signal } else { s.ui_signal };
    let server = match local_signal {
        "running" => ServerProcessState::Running,
        "restarting" => ServerProcessState::Restarting,
        _ => ServerProcessState::Stopped,
    };
    let icon = icon_state(fleet, server, AppSupervisionState::Running);
    match icon.state_str() {
        "healthy" => TRAY_HEALTHY,
        "degraded" => TRAY_DEGRADED,
        _ => TRAY_STOPPED,
    }
}

/// Rebuild the tray menu + icon from the current supervisor state. MUST run on the main
/// thread (the only thread that may touch the native tray on Windows) — `supervisor::
/// refresh_tray` marshals here via `run_on_main_thread`.
pub fn rebuild_tray(app: &AppHandle, shared: &SharedState) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let (menu, icon_bytes) = {
            let g = shared.lock().expect("supervisor state mutex poisoned");
            (build_tray_menu(app, &g).ok(), tray_icon_bytes(&g))
        };
        if let Some(menu) = menu {
            let _ = tray.set_menu(Some(menu));
        }
        if let Ok(img) = tauri::image::Image::from_bytes(icon_bytes) {
            let _ = tray.set_icon(Some(img));
        }
    }
}

fn main() {
    tauri::Builder::default()
        // Single-instance guard (registered FIRST, per the plugin's ordering rule): a
        // second `aof mesh desktop run` fires this callback IN THE FIRST instance
        // (then exits) instead of standing up a duplicate tray + a duplicate
        // supervisor tree. The first instance responds by un-hiding + focusing its
        // window — the ambient-tray "there is only ever one of me" contract.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                if let Some(state) = app.try_state::<AppState>() {
                    state
                        .shared
                        .lock()
                        .expect("supervisor state mutex poisoned")
                        .window_visible = true;
                    supervisor::refresh_tray(app, &state.shared);
                }
            }
        }))
        .invoke_handler(tauri::generate_handler![
            get_view_model,
            start_mesh_server,
            stop_mesh_server,
            start_mesh_ui,
            stop_mesh_ui,
            open_web_ui,
            toggle_window,
            minimize_window,
            toggle_maximize_window,
            hide_to_tray,
        ])
        .on_window_event(|window, event| {
            // Ambient residency (ADR-001 / RESEARCH §1 / story 01 task 02): closing the
            // window HIDES it to the tray instead of quitting — the supervisor outlives
            // the window. `prevent_close` stops the destroy; `hide` sends it to the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                let app = window.app_handle();
                if let Some(state) = app.try_state::<AppState>() {
                    state
                        .shared
                        .lock()
                        .expect("supervisor state mutex poisoned")
                        .window_visible = false;
                    supervisor::refresh_tray(app, &state.shared);
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // The trusted co-located install dir the poll/supervision spawns resolve
            // their sibling `aof` from ($HOME/.aof/bin, ADR-003/004 d4) — never bare-PATH.
            let install_dir = app
                .path()
                .home_dir()
                .map(|h| h.join(".aof").join("bin"))
                .unwrap_or_else(|_| PathBuf::from("."));

            let shared: SharedState = Arc::new(Mutex::new(SupervisorState::default()));
            if let Some(window) = app.get_webview_window("main") {
                shared
                    .lock()
                    .expect("supervisor state mutex poisoned")
                    .window_visible = window.is_visible().unwrap_or(true);
            }

            // Start the LIVE supervisor engine: the `mesh status --json` poll, the
            // role-driven `tokio::process` watchdog with restart/backoff, and the
            // Windows Job-Object kill-on-close reap (supervisor.rs).
            let tx = supervisor::spawn_engine(handle.clone(), install_dir, shared.clone());
            app.manage(AppState { shared: shared.clone(), tx });

            let (menu, icon_bytes) = {
                let g = shared.lock().expect("supervisor state mutex poisoned");
                (build_tray_menu(&handle, &g)?, tray_icon_bytes(&g))
            };

            let _tray = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .icon(tauri::image::Image::from_bytes(icon_bytes).unwrap_or_else(|_| {
                    // A decode failure degrades to the app's default icon rather than
                    // panicking the setup hook (the embedded PNGs make this unreachable).
                    app.default_window_icon().cloned().expect("a default window icon exists")
                }))
                .tooltip("aof mesh")
                .on_menu_event(move |app, event| {
                    let state = app.state::<AppState>();
                    match event.id().as_ref() {
                        "server-control" => {
                            // A single state-labelled control (DESIGN §Surface 2 region 2):
                            // Stop when running/restarting, Start when stopped.
                            let running = {
                                state
                                    .shared
                                    .lock()
                                    .expect("supervisor state mutex poisoned")
                                    .server_signal
                                    != "stopped"
                            };
                            let cmd = if running {
                                SupervisorCommand::StopServer
                            } else {
                                SupervisorCommand::StartServer
                            };
                            let _ = state.tx.send(cmd);
                        }
                        "open-web-ui" => {
                            let (running, url) = {
                                let g = state.shared.lock().expect("supervisor state mutex poisoned");
                                (g.ui_signal == "running", g.ui_url.clone())
                            };
                            if running {
                                let _ = opener::open_browser(&url);
                            }
                        }
                        "window-toggle" => {
                            do_toggle_window(app, &state.shared);
                        }
                        "quit" => {
                            // Quit is the ONLY full exit (DESIGN §Surface 2 region 5). It
                            // ends the process, closing the Job Object handle so the OS
                            // reaps the whole supervised child tree (ADR-002 d3).
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                // The menu opens on RIGHT-click only, freeing left-click for the Windows
                // convention below (left toggles the window, right opens the menu).
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    // Left-click the tray icon → show + focus the window (restore from the
                    // ambient hidden-to-tray state). DESIGN §Surface 2: the icon is the
                    // ambient presence; clicking it brings the fleet view back.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                            if let Some(state) = app.try_state::<AppState>() {
                                state
                                    .shared
                                    .lock()
                                    .expect("supervisor state mutex poisoned")
                                    .window_visible = true;
                                supervisor::refresh_tray(app, &state.shared);
                            }
                        }
                    }
                })
                .build(app)?;

            // Belt-and-braces runtime echo of `acd-desktop-read-only-fleet` (debug
            // builds): the shell's OWN affordance inventory carries no mutating verb —
            // never a substitute for the arch-test, a startup self-check.
            debug_assert!(window_affordance_inventory()
                .iter()
                .all(|a| a.spawns_verb.map(|v| ALLOWED_MESH_VERBS.contains(&v)).unwrap_or(true)));

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the aof mesh desktop app")
        .run(|_app, event| {
            // Ambient residency, the exit half (RESEARCH §1): an IMPLICIT exit (all
            // windows gone) is prevented so the app stays resident in the tray. An
            // EXPLICIT exit (Quit → `app.exit(code)`, `code` is Some) is honoured — the
            // one path that truly quits.
            if let RunEvent::ExitRequested { code, api, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
