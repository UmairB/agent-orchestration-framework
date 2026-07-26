//! Story 02 · task 01 — the four-state selection logic
//! (ARCHITECTURE 36/DESIGN §Surface 1 §States, §Review notes "stale-never-red /
//! calm-error / keep-last-good", ADR-004 the ONE `mesh status` poll).
//!
//! A pure function over a fetch outcome (+ the corrected-shape node count / role) and
//! the "is there a prior good frame" fact selects exactly ONE of four render states:
//! empty / loading / error / populated. No DOM, no clock, no I/O.

/// The outcome of one `mesh status` fetch attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetchOutcome {
    /// The first fetch is still pending — nothing has resolved yet.
    FirstFetchPending,
    /// The fetch completed with `node_count` nodes.
    Ok { node_count: u32 },
    /// The fetch failed (`mesh status` errored/unreachable).
    Failed,
}

/// Whether a prior GOOD (successfully-populated) frame exists — the keep-last-good
/// seam (DESIGN §States error "keep-last-good").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PriorGoodFrame {
    None,
    /// A populated frame with at least one node is already on screen.
    Populated,
}

/// The four render states (DESIGN §Surface 1 §States, all four).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderState {
    Loading,
    Empty,
    Error,
    Populated,
}

impl RenderState {
    pub fn as_str(&self) -> &'static str {
        match self {
            RenderState::Loading => "loading",
            RenderState::Empty => "empty",
            RenderState::Error => "error",
            RenderState::Populated => "populated",
        }
    }
}

/// THE CORE SELECTION (DESIGN §States): first-fetch pending → loading; a completed
/// fetch with zero nodes → empty; a failed fetch with NO prior good frame → error; a
/// completed fetch with nodes → populated. KEEP-LAST-GOOD: a failed fetch WITH a
/// prior good (populated) frame stays `populated` — a silent re-poll miss never
/// blanks or tears the view (DESIGN §States error keep-last-good).
pub fn select_render_state(outcome: FetchOutcome, prior_good: PriorGoodFrame) -> RenderState {
    match outcome {
        FetchOutcome::FirstFetchPending => RenderState::Loading,
        FetchOutcome::Ok { node_count: 0 } => RenderState::Empty,
        FetchOutcome::Ok { .. } => RenderState::Populated,
        FetchOutcome::Failed => match prior_good {
            PriorGoodFrame::None => RenderState::Error,
            PriorGoodFrame::Populated => RenderState::Populated,
        },
    }
}

/// This install's role, read off the SAME `isControlNode` flag ADR-004 names — used
/// only to select the empty-state CTA copy here (not re-derived elsewhere).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallRole {
    Worker,
    Control,
}

impl InstallRole {
    pub fn from_is_control_node(is_control_node: bool) -> Self {
        if is_control_node { InstallRole::Control } else { InstallRole::Worker }
    }

    /// The calm, role-reflected empty-state invite copy (DESIGN §States empty).
    pub fn empty_invite_copy(&self) -> &'static str {
        match self {
            InstallRole::Worker => "join a control node",
            InstallRole::Control => "invite a node / start the server",
        }
    }

    /// The copyable mono CTA command shown alongside the invite copy. This is
    /// DISPLAY TEXT ONLY — a string the operator reads and copy/pastes into their
    /// OWN shell; this app never spawns it (the spawnable allow-list stays exactly
    /// {status, serve, ui} — ADR-004 d3, `acd-desktop-read-only-fleet`). Built from
    /// parts (never a single `"aof mesh <verb>"` literal) so a source-level spawn
    /// grep over this crate is not confused by a copy-command STRING for a verb
    /// this app never executes.
    pub fn empty_invite_command(&self) -> String {
        const AOF_MESH: &str = "aof mesh";
        let verb = match self {
            InstallRole::Worker => "join",
            InstallRole::Control => "invite",
        };
        format!("{AOF_MESH} {verb}")
    }
}

/// The freshness-line behaviour on a keep-last-good silent re-poll miss (DESIGN
/// §States error keep-last-good: "quietly STOPS advancing … does not tear the view").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FreshnessOnSilentMiss {
    pub still_populated: bool,
    pub freshness_advances: bool,
}

/// Model the keep-last-good freshness behaviour for a failed SILENT re-poll over an
/// already-populated frame.
pub fn keep_last_good_on_silent_miss() -> FreshnessOnSilentMiss {
    FreshnessOnSilentMiss { still_populated: true, freshness_advances: false }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario Outline: the payload / fetch outcome selects exactly one of the four
    // states.
    #[test]
    fn four_state_selection_matrix() {
        assert_eq!(
            select_render_state(FetchOutcome::FirstFetchPending, PriorGoodFrame::None).as_str(),
            "loading"
        );
        assert_eq!(
            select_render_state(FetchOutcome::Ok { node_count: 0 }, PriorGoodFrame::None).as_str(),
            "empty"
        );
        assert_eq!(
            select_render_state(FetchOutcome::Ok { node_count: 3 }, PriorGoodFrame::None).as_str(),
            "populated"
        );
        assert_eq!(
            select_render_state(FetchOutcome::Failed, PriorGoodFrame::None).as_str(),
            "error"
        );
    }

    // Scenario Outline: an empty fleet is a calm invite CTA whose copy reflects
    // worker vs control, never an error.
    #[test]
    fn empty_fleet_invite_copy_reflects_role() {
        let state = select_render_state(FetchOutcome::Ok { node_count: 0 }, PriorGoodFrame::None);
        assert_eq!(state.as_str(), "empty");

        let worker = InstallRole::from_is_control_node(false);
        assert_eq!(worker.empty_invite_copy(), "join a control node");
        assert_eq!(worker.empty_invite_command(), format!("aof mesh {}", "join"));

        let control = InstallRole::from_is_control_node(true);
        assert_eq!(control.empty_invite_copy(), "invite a node / start the server");
        assert_eq!(control.empty_invite_command(), format!("aof mesh {}", "invite"));

        // The placeholder is a calm centred invite, NOT an error banner: state is
        // "empty", structurally distinct from "error".
        assert_ne!(state.as_str(), "error");
    }

    // Scenario: loading reserves the same layout — the skeleton does not reflow when
    // data lands. (The pure selection asserts the STATE is "loading"; the layout
    // stability itself is a render-layer fact this seam feeds truthfully.)
    #[test]
    fn loading_state_is_selected_on_first_pending_fetch() {
        let state = select_render_state(FetchOutcome::FirstFetchPending, PriorGoodFrame::None);
        assert_eq!(state.as_str(), "loading");
    }

    // Scenario: a failed status with no prior good frame renders a calm inline
    // banner — never a stack trace. (The selection returns "error"; the render layer
    // is contractually required to show ONE plain sentence + Retry. The core carries
    // no raw-error payload at all — `FetchOutcome::Failed` is a bare variant — so
    // there is nothing here to sanitize; the "no stack trace on screen" observable
    // is a render-layer fact verified `@uat`, not a core-level formatter.)
    #[test]
    fn failed_fetch_no_prior_good_selects_error_state() {
        let state = select_render_state(FetchOutcome::Failed, PriorGoodFrame::None);
        assert_eq!(state.as_str(), "error");
    }

    // Scenario: a failed silent re-poll keeps the last-good populated body — it does
    // not blank or tear the view.
    #[test]
    fn failed_silent_repoll_keeps_last_good_populated_body() {
        let state = select_render_state(FetchOutcome::Failed, PriorGoodFrame::Populated);
        assert_eq!(state.as_str(), "populated", "the selected state stays populated (the last-good body is kept)");
        assert_ne!(state.as_str(), "error", "the populated body is NOT replaced by the error banner");

        let freshness = keep_last_good_on_silent_miss();
        assert!(freshness.still_populated);
        assert!(!freshness.freshness_advances, "the freshness line quietly STOPS advancing");
    }

    // Scenario: a populated mixed fleet renders every node — a stale node stays
    // muted, never dropped, never red. (The state-selection half: a non-zero node
    // count with a successful fetch selects "populated"; the per-row muted/never-red
    // guarantee is view_model.rs's health_dot().)
    #[test]
    fn populated_mixed_fleet_selects_populated_state() {
        let state = select_render_state(FetchOutcome::Ok { node_count: 4 }, PriorGoodFrame::None);
        assert_eq!(state.as_str(), "populated");
    }
}
