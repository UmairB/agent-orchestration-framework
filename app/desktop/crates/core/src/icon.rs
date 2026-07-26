//! Story 01 · task 00 — the pure health-summary → tray-icon-state mapping
//! (ARCHITECTURE 36/DESIGN §Surface 2 "Tray ICON states", ADR-002 the health/role
//! model, ADR-001 the tray via `TrayIconBuilder`).
//!
//! `icon_state(fleet_summary, server_state, app_state) -> IconState` is a PURE
//! selector — no `TrayIconBuilder`, no WebView2, no taskbar, no I/O. It takes BOTH
//! the fleet-presence summary AND the local server/app supervision state as inputs
//! and combines them into ONE ambient glyph (the one place the two DESIGN ramps
//! legitimately combine) without letting one masquerade as the other:
//! - `healthy`  — ALL nodes online AND the local server running, no badge.
//! - `degraded` — something stale in the fleet OR the local server restarting —
//!   a calm caution badge (attention, never alarm; stale is NEVER escalated further).
//! - `stopped`  — the local server (or the whole app's supervision) is stopped — a
//!   dim/stop badge, clearly distinct from degraded.
//!
//! The state+badge is THEME-INVARIANT (DESIGN §Surface 2 "the shape/badge is
//! identical across themes, only the fill adapts") — selecting for a taskbar theme
//! never changes the returned state/badge, only the eventual render fill (owned by
//! the Tauri shell, out of this pure module's scope).
//!
//! Keep-last-good (DESIGN §Surface 2 Loading/Error): a caller that hits a SILENT
//! status poll failure re-selects using the LAST-GOOD summary it already holds — this
//! module has no polling/caching of its own, it simply never flips a `healthy`
//! last-good summary to `stopped` on its own initiative because it is only ever
//! handed the summary the caller chooses to pass.

/// The fleet-presence roll-up this selector reads (DESIGN §Surface 2 header ramp).
/// A coarse summary is sufficient for the icon (the exact N/M counts are the tray
/// HEADER's job — `tray_menu.rs`); the icon only needs to know "all online" vs "some
/// stale" vs "no nodes yet".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FleetSummary {
    AllOnline,
    OneStale,
    SomeStale,
    NoNodes,
}

impl FleetSummary {
    fn has_staleness(&self) -> bool {
        matches!(self, FleetSummary::OneStale | FleetSummary::SomeStale)
    }
}

/// The local Mesh-server supervisor state (the local-process ramp, DESIGN
/// §Non-negotiable framing — distinct from fleet presence).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerProcessState {
    Running,
    Restarting,
    Stopped,
}

/// The local app supervision state (whether the whole supervisor is up at all).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppSupervisionState {
    Running,
    Stopped,
}

/// The taskbar theme — accepted so callers can select "for a theme," but the
/// returned state/badge never varies with it (DESIGN §Surface 2 theme-invariance).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskbarTheme {
    Light,
    Dark,
}

/// The three tray icon states (DESIGN §Surface 2 "Tray ICON states").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IconStateKind {
    Healthy,
    Degraded,
    Stopped,
}

/// The monochrome-legible badge — the shape/overlay that distinguishes state
/// WITHOUT relying on colour (DESIGN §Surface 2 "readable … by shape/badge, not
/// colour alone").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Badge {
    None,
    Caution,
    Stop,
}

/// The returned descriptor: exactly one state, paired with its monochrome badge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IconState {
    pub state: IconStateKind,
    pub badge: Badge,
}

impl IconState {
    pub fn state_str(&self) -> &'static str {
        match self.state {
            IconStateKind::Healthy => "healthy",
            IconStateKind::Degraded => "degraded",
            IconStateKind::Stopped => "stopped",
        }
    }

    pub fn badge_str(&self) -> &'static str {
        match self.badge {
            Badge::None => "none",
            Badge::Caution => "caution",
            Badge::Stop => "stop",
        }
    }
}

/// The pure selector. `healthy` requires BOTH all-online AND the server running —
/// either an offline/stale fleet OR a non-running server pulls it off `healthy`.
/// `stopped` (the server or the whole app supervision down) takes priority over a
/// merely-stale fleet: a stopped server is a harder fact than fleet staleness, and
/// the badge must never be ambiguous between the two (exactly one state returned).
pub fn icon_state(
    fleet: FleetSummary,
    server: ServerProcessState,
    app: AppSupervisionState,
) -> IconState {
    let server_or_app_stopped =
        matches!(server, ServerProcessState::Stopped) || matches!(app, AppSupervisionState::Stopped);
    let server_restarting = matches!(server, ServerProcessState::Restarting);

    if server_or_app_stopped {
        return IconState { state: IconStateKind::Stopped, badge: Badge::Stop };
    }
    if fleet.has_staleness() || server_restarting {
        return IconState { state: IconStateKind::Degraded, badge: Badge::Caution };
    }
    IconState { state: IconStateKind::Healthy, badge: Badge::None }
}

/// Select the icon state "for" a taskbar theme — the theme parameter is accepted so
/// callers modelling a render pipeline can pass it, but it structurally cannot alter
/// the returned state/badge (DESIGN §Surface 2 theme-invariance): the pure selection
/// ignores it entirely.
pub fn icon_state_for_theme(
    fleet: FleetSummary,
    server: ServerProcessState,
    app: AppSupervisionState,
    _theme: TaskbarTheme,
) -> IconState {
    icon_state(fleet, server, app)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario Outline: a health summary maps to exactly one icon state, distinguished
    // by badge shape in monochrome.
    #[test]
    fn healthy_all_online_and_server_running_no_badge() {
        let s = icon_state(FleetSummary::AllOnline, ServerProcessState::Running, AppSupervisionState::Running);
        assert_eq!(s.state_str(), "healthy");
        assert_eq!(s.badge_str(), "none");
    }

    #[test]
    fn degraded_one_stale_server_running() {
        let s = icon_state(FleetSummary::OneStale, ServerProcessState::Running, AppSupervisionState::Running);
        assert_eq!(s.state_str(), "degraded");
        assert_eq!(s.badge_str(), "caution");
    }

    #[test]
    fn degraded_all_online_server_restarting() {
        let s = icon_state(FleetSummary::AllOnline, ServerProcessState::Restarting, AppSupervisionState::Running);
        assert_eq!(s.state_str(), "degraded");
        assert_eq!(s.badge_str(), "caution");
    }

    #[test]
    fn degraded_some_stale_server_running() {
        let s = icon_state(FleetSummary::SomeStale, ServerProcessState::Running, AppSupervisionState::Running);
        assert_eq!(s.state_str(), "degraded");
        assert_eq!(s.badge_str(), "caution");
    }

    #[test]
    fn stopped_all_online_server_stopped() {
        let s = icon_state(FleetSummary::AllOnline, ServerProcessState::Stopped, AppSupervisionState::Running);
        assert_eq!(s.state_str(), "stopped");
        assert_eq!(s.badge_str(), "stop");
    }

    #[test]
    fn stopped_all_online_app_stopped() {
        let s = icon_state(FleetSummary::AllOnline, ServerProcessState::Running, AppSupervisionState::Stopped);
        assert_eq!(s.state_str(), "stopped");
        assert_eq!(s.badge_str(), "stop");
    }

    #[test]
    fn stopped_no_nodes_server_stopped() {
        let s = icon_state(FleetSummary::NoNodes, ServerProcessState::Stopped, AppSupervisionState::Running);
        assert_eq!(s.state_str(), "stopped");
        assert_eq!(s.badge_str(), "stop");
    }

    #[test]
    fn exactly_one_state_never_both_healthy_and_degraded_badges() {
        // Every state carries exactly one badge — the type system alone guarantees
        // this (an enum, not a bitset), but assert it explicitly per the scenario.
        for (fleet, server, app) in [
            (FleetSummary::AllOnline, ServerProcessState::Running, AppSupervisionState::Running),
            (FleetSummary::OneStale, ServerProcessState::Running, AppSupervisionState::Running),
            (FleetSummary::AllOnline, ServerProcessState::Stopped, AppSupervisionState::Running),
        ] {
            let s = icon_state(fleet, server, app);
            // Exactly one of the three (state, badge) combinations is returned.
            match s.state {
                IconStateKind::Healthy => assert_eq!(s.badge, Badge::None),
                IconStateKind::Degraded => assert_eq!(s.badge, Badge::Caution),
                IconStateKind::Stopped => assert_eq!(s.badge, Badge::Stop),
            }
        }
    }

    // Scenario: a stale-only fleet degrades to the calm caution badge, never to an
    // alarm or the stopped state.
    #[test]
    fn stale_only_fleet_never_escalates_to_stopped_or_alarm() {
        let s = icon_state(FleetSummary::OneStale, ServerProcessState::Running, AppSupervisionState::Running);
        assert_eq!(s.state_str(), "degraded");
        assert_eq!(s.badge_str(), "caution");
        assert_ne!(s.state_str(), "stopped");
        assert_ne!(s.badge, Badge::Stop, "a stale-only fleet is not an alarm/stopped treatment");
    }

    // Scenario Outline: the state and badge are identical across light and dark
    // taskbars — only the render fill adapts.
    #[test]
    fn state_and_badge_are_theme_invariant() {
        for theme in [TaskbarTheme::Light, TaskbarTheme::Dark] {
            let s = icon_state_for_theme(
                FleetSummary::OneStale,
                ServerProcessState::Running,
                AppSupervisionState::Running,
                theme,
            );
            assert_eq!(s.state_str(), "degraded");
            assert_eq!(s.badge_str(), "caution");
        }
        let light = icon_state_for_theme(
            FleetSummary::OneStale, ServerProcessState::Running, AppSupervisionState::Running, TaskbarTheme::Light,
        );
        let dark = icon_state_for_theme(
            FleetSummary::OneStale, ServerProcessState::Running, AppSupervisionState::Running, TaskbarTheme::Dark,
        );
        assert_eq!(light, dark, "the selected state and badge do not vary with the taskbar theme");
    }

    // Scenario: on a silent status re-poll failure the icon holds the last-good
    // state — it does not flicker to stopped.
    #[test]
    fn silent_repoll_failure_holds_last_good_state_not_stopped() {
        let last_good = IconState { state: IconStateKind::Healthy, badge: Badge::None };
        // A caller handed the last-good summary on a silent poll miss re-selects
        // from THAT summary, not a "poll failed" signal — the selector has no path
        // that flips healthy to stopped from a summary alone.
        let reselected = icon_state(FleetSummary::AllOnline, ServerProcessState::Running, AppSupervisionState::Running);
        assert_eq!(reselected, last_good);
        assert_eq!(reselected.state_str(), "healthy");
        assert_ne!(reselected.state_str(), "stopped", "the helper does not flip to stopped on the silent-poll miss");
    }
}
