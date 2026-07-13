//! Story 01 · task 01 — the pure tray-menu model
//! (ARCHITECTURE 36/DESIGN §Surface 2 "Layout regions, in order (the right-click
//! menu)", ADR-002 the menu drives the supervisor, ADR-001 native menu via
//! `TrayIconBuilder`).
//!
//! `tray_menu(role, server_state, ui_state, window_visible, fleet_summary) ->
//! Vec<MenuItem>` is a PURE builder — no `TrayIconBuilder`, no native flyout, no
//! WebView2, no I/O. Each `MenuItem` carries `{label, kind, enabled, id}` so
//! "disabled", "state-labelled", "omitted", and "last, below a separator" are real
//! returned fields, not a native-render-only fact.
//!
//! TWO RAMPS, KEPT HONEST (DESIGN §Non-negotiable framing): the HEADER is FLEET
//! PRESENCE (`N online · M stale`, the mesh:status heartbeat roll-up); the
//! Start/Stop item reflects the LOCAL SERVER process state (running/stopped — the
//! supervisor watchdog signal). They are different signals in different regions of
//! the SAME menu and read truthfully side by side.

/// The node's role — a WORKER omits the server control entirely (DESIGN §Surface 2
/// region 2 + ADR-002 role-driven supervision set).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Control,
    Worker,
}

/// The local Mesh-server supervisor state (the Start/Stop label driver).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerState {
    Running,
    Stopped,
}

/// The local Mesh web UI child state (drives Open-web-UI's enabled flag).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiState {
    Running,
    Stopped,
}

/// The main window's current visibility (drives the Show/Hide label).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowVisibility {
    Visible,
    Hidden,
}

/// The fleet-presence summary the non-interactive header renders — one of the
/// menu-level states (DESIGN §Surface 2 "States") or a populated `N online · M
/// stale` roll-up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FleetHeaderSummary {
    Populated { online: u32, stale: u32 },
    Empty,
    Loading,
    Error,
}

impl FleetHeaderSummary {
    /// The calm header text (DESIGN §Surface 2 "States" — never an alarm, never an
    /// error code dump).
    pub fn header_text(&self) -> String {
        match self {
            FleetHeaderSummary::Populated { online, stale } => format!("{online} online \u{b7} {stale} stale"),
            FleetHeaderSummary::Empty => "no nodes yet".to_string(),
            FleetHeaderSummary::Loading => "checking\u{2026}".to_string(),
            FleetHeaderSummary::Error => "mesh unreachable".to_string(),
        }
    }
}

/// The kind of menu entry — distinguishes the non-interactive header/separator rows
/// from clickable action items.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuItemKind {
    Header,
    Action,
    Separator,
}

/// A stable identifier for an action item, so a caller (or a test) can find "the
/// server-control item" / "the window-toggle item" without string-matching a label.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuItemId {
    Header,
    ServerControl,
    OpenWebUi,
    WindowToggle,
    Separator,
    Quit,
}

/// One returned menu item — a real descriptor, not a native-render-only fact.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuItem {
    pub id: MenuItemId,
    pub kind: MenuItemKind,
    pub label: String,
    pub enabled: bool,
}

/// Build the ordered tray menu (DESIGN §Surface 2 "Layout regions, in order"):
/// header (non-interactive) → \[Start/Stop mesh, control role only\] → Open web UI →
/// Show/Hide window → separator → Quit (always last).
pub fn tray_menu(
    role: Role,
    server: ServerState,
    ui: UiState,
    window: WindowVisibility,
    fleet: FleetHeaderSummary,
) -> Vec<MenuItem> {
    let mut items = Vec::with_capacity(6);

    // 1. Header — non-interactive fleet-presence roll-up.
    items.push(MenuItem {
        id: MenuItemId::Header,
        kind: MenuItemKind::Header,
        label: fleet.header_text(),
        enabled: false,
    });

    // 2. Start/Stop mesh — ONE state-labelled item, OMITTED entirely on a worker.
    if matches!(role, Role::Control) {
        let label = match server {
            ServerState::Running => "Stop mesh",
            ServerState::Stopped => "Start mesh",
        };
        items.push(MenuItem {
            id: MenuItemId::ServerControl,
            kind: MenuItemKind::Action,
            label: label.to_string(),
            enabled: true,
        });
    }

    // 3. Open web UI — present-but-disabled when the UI child is stopped.
    items.push(MenuItem {
        id: MenuItemId::OpenWebUi,
        kind: MenuItemKind::Action,
        label: "Open web UI".to_string(),
        enabled: matches!(ui, UiState::Running),
    });

    // 4. Show/Hide window — visibility-labelled.
    let window_label = match window {
        WindowVisibility::Visible => "Hide window",
        WindowVisibility::Hidden => "Show window",
    };
    items.push(MenuItem {
        id: MenuItemId::WindowToggle,
        kind: MenuItemKind::Action,
        label: window_label.to_string(),
        enabled: true,
    });

    // 5. Separator, then Quit — deliberately last, below a separator (accidental-quit guard).
    items.push(MenuItem {
        id: MenuItemId::Separator,
        kind: MenuItemKind::Separator,
        label: String::new(),
        enabled: false,
    });
    items.push(MenuItem {
        id: MenuItemId::Quit,
        kind: MenuItemKind::Action,
        label: "Quit".to_string(),
        enabled: true,
    });

    items
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario: a control node with the server running renders the full menu in
    // order — Stop mesh, all items present.
    #[test]
    fn control_node_server_running_renders_full_menu_in_order() {
        let items = tray_menu(
            Role::Control,
            ServerState::Running,
            UiState::Running,
            WindowVisibility::Visible,
            FleetHeaderSummary::Populated { online: 3, stale: 1 },
        );

        let expected: Vec<(MenuItemKind, &str, bool)> = vec![
            (MenuItemKind::Header, "3 online \u{b7} 1 stale", false),
            (MenuItemKind::Action, "Stop mesh", true),
            (MenuItemKind::Action, "Open web UI", true),
            (MenuItemKind::Action, "Hide window", true),
            (MenuItemKind::Separator, "", false),
            (MenuItemKind::Action, "Quit", true),
        ];
        assert_eq!(items.len(), expected.len());
        for (item, (kind, label, enabled)) in items.iter().zip(expected.iter()) {
            assert_eq!(&item.kind, kind);
            assert_eq!(item.label, *label);
            assert_eq!(item.enabled, *enabled);
        }

        assert_eq!(items[0].kind, MenuItemKind::Header, "the header is non-interactive");
        assert!(!items[0].enabled);

        let server_items: Vec<_> = items.iter().filter(|i| i.id == MenuItemId::ServerControl).collect();
        assert_eq!(server_items.len(), 1, "exactly one Start/Stop item");
        assert_ne!(server_items[0].label, "Start mesh", "not accompanied by its opposite label");

        assert_eq!(items.last().unwrap().id, MenuItemId::Quit, "Quit is the last item");
        assert_eq!(items[items.len() - 2].kind, MenuItemKind::Separator, "Quit sits below a separator");
    }

    // Scenario Outline: the non-interactive header shows the fleet-presence roll-up,
    // calm in every menu-level state.
    #[test]
    fn header_shows_fleet_presence_roll_up_calm_in_every_state() {
        let cases = vec![
            (FleetHeaderSummary::Populated { online: 3, stale: 1 }, "3 online \u{b7} 1 stale"),
            (FleetHeaderSummary::Empty, "no nodes yet"),
            (FleetHeaderSummary::Loading, "checking\u{2026}"),
            (FleetHeaderSummary::Error, "mesh unreachable"),
        ];
        for (summary, expected_header) in cases {
            let items = tray_menu(
                Role::Control,
                ServerState::Running,
                UiState::Running,
                WindowVisibility::Visible,
                summary,
            );
            let header = &items[0];
            assert_eq!(header.kind, MenuItemKind::Header, "the first item is a non-interactive header");
            assert_eq!(header.label, expected_header);
            assert!(!header.enabled, "the header is a status readout, never an interactive control");
            assert!(!header.label.to_lowercase().contains("error"), "header text is calm words, never an error code dump");
        }
    }

    // Scenario Outline: Start/Stop mesh is a single item whose label reflects the
    // local server state — never both.
    #[test]
    fn start_stop_mesh_is_single_state_labelled_item() {
        for (server, label, not_label) in [
            (ServerState::Running, "Stop mesh", "Start mesh"),
            (ServerState::Stopped, "Start mesh", "Stop mesh"),
        ] {
            let items = tray_menu(
                Role::Control,
                server,
                UiState::Running,
                WindowVisibility::Visible,
                FleetHeaderSummary::Populated { online: 1, stale: 0 },
            );
            let server_items: Vec<_> = items.iter().filter(|i| i.id == MenuItemId::ServerControl).collect();
            assert_eq!(server_items.len(), 1, "exactly one server-control item");
            assert_eq!(server_items[0].label, label);
            assert!(items.iter().all(|i| i.label != not_label), "the opposite label is not present");
        }
    }

    // Scenario: a worker node omits the server control entirely — it is absent, not
    // a dimmed dead item.
    #[test]
    fn worker_node_omits_server_control_entirely() {
        let items = tray_menu(
            Role::Worker,
            // Worker has no server to supervise — ServerState is irrelevant but the
            // API still requires a value; Stopped models "no server running here."
            ServerState::Stopped,
            UiState::Running,
            WindowVisibility::Visible,
            FleetHeaderSummary::Populated { online: 2, stale: 0 },
        );
        assert!(
            items.iter().all(|i| i.id != MenuItemId::ServerControl),
            "no Start mesh or Stop mesh item at all"
        );
        assert!(
            !items.iter().any(|i| i.label == "Start mesh" || i.label == "Stop mesh"),
            "the omitted server control is absent, not present-and-disabled"
        );
        let ids: Vec<_> = items.iter().map(|i| i.id).collect();
        assert_eq!(
            ids,
            vec![
                MenuItemId::Header,
                MenuItemId::OpenWebUi,
                MenuItemId::WindowToggle,
                MenuItemId::Separator,
                MenuItemId::Quit,
            ],
            "the menu still contains, in order, header, Open web UI, Hide window, separator, Quit"
        );
        assert_eq!(items.last().unwrap().id, MenuItemId::Quit);
        assert_eq!(items[items.len() - 2].kind, MenuItemKind::Separator);
    }

    // Scenario Outline: Open web UI is present-but-disabled when the UI child is
    // stopped, enabled when it is running.
    #[test]
    fn open_web_ui_present_but_disabled_when_ui_stopped() {
        for (ui, enabled) in [(UiState::Running, true), (UiState::Stopped, false)] {
            let items = tray_menu(
                Role::Control,
                ServerState::Running,
                ui,
                WindowVisibility::Visible,
                FleetHeaderSummary::Populated { online: 1, stale: 0 },
            );
            let open_ui: Vec<_> = items.iter().filter(|i| i.id == MenuItemId::OpenWebUi).collect();
            assert_eq!(open_ui.len(), 1, "the Open web UI item is present in both cases");
            assert_eq!(open_ui[0].enabled, enabled);
        }
    }

    // Scenario Outline: Show/Hide window is one item whose label reflects the
    // current window visibility.
    #[test]
    fn show_hide_window_reflects_current_visibility() {
        for (visibility, label) in [
            (WindowVisibility::Visible, "Hide window"),
            (WindowVisibility::Hidden, "Show window"),
        ] {
            let items = tray_menu(
                Role::Control,
                ServerState::Running,
                UiState::Running,
                visibility,
                FleetHeaderSummary::Populated { online: 1, stale: 0 },
            );
            let toggles: Vec<_> = items.iter().filter(|i| i.id == MenuItemId::WindowToggle).collect();
            assert_eq!(toggles.len(), 1, "exactly one window-toggle item");
            assert_eq!(toggles[0].label, label);
        }
    }

    // Scenario Outline: Quit is always the last item, below a separator, regardless
    // of role or process state.
    #[test]
    fn quit_is_always_last_below_a_separator() {
        let cases = vec![
            (Role::Control, ServerState::Running, UiState::Running),
            (Role::Control, ServerState::Stopped, UiState::Stopped),
            (Role::Worker, ServerState::Stopped, UiState::Running),
        ];
        for (role, server, ui) in cases {
            let items = tray_menu(
                role,
                server,
                ui,
                WindowVisibility::Visible,
                FleetHeaderSummary::Populated { online: 1, stale: 0 },
            );
            assert_eq!(items.last().unwrap().id, MenuItemId::Quit, "the last menu item is Quit");
            assert_eq!(
                items[items.len() - 2].kind,
                MenuItemKind::Separator,
                "the item immediately before Quit is a separator"
            );
            let quit_positions: Vec<_> = items
                .iter()
                .enumerate()
                .filter(|(_, i)| i.id == MenuItemId::Quit)
                .map(|(idx, _)| idx)
                .collect();
            assert_eq!(quit_positions, vec![items.len() - 1], "Quit is never rendered above any other action item");
        }
    }
}
