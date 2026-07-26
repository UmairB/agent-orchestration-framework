//! Task 02 pure seams — the role-driven supervision SET and the restart/backoff +
//! local-process state machine (ARCHITECTURE 36/ADR-002 d1-2). The task 02 `.feature`
//! itself is `@manual` (a real watchdog driving real/stub long-lived children is
//! observable OS behaviour no fixture-fed unit test substitutes for — STORY.md "Build
//! notes"), but the PURE decision functions it is built from — "which children for
//! this role" and "how does the backoff/state machine transition" — are ordinary
//! functions over plain inputs, so they live here and ARE `cargo test`-covered as
//! supporting unit coverage for the `@manual` scenario's engine.
//!
//! Nothing in this module spawns a process, sleeps, or reads a real clock — the
//! actual watchdog loop (real `tokio::process` + `win32job`) is the Tauri shell's
//! job, consuming these pure functions.

/// One supervised child specification — a program-relative argv tail (the resolved
/// `aof` path itself comes from `resolve.rs`; this module only decides WHICH argv
/// tails belong to this node's role).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupervisedChild {
    pub label: &'static str,
    pub argv: Vec<&'static str>,
}

impl SupervisedChild {
    pub fn mesh_serve() -> Self {
        SupervisedChild { label: "aof mesh serve --serve", argv: vec!["mesh", "serve", "--serve"] }
    }
    pub fn mesh_ui() -> Self {
        SupervisedChild { label: "aof mesh ui", argv: vec!["mesh", "ui"] }
    }
}

/// The role-driven supervision set (ADR-002 d1 / RESEARCH §3): a pure function of
/// `isControlNode`, read from the SAME `mesh status --json` poll (task 01) — no role
/// re-derivation in Rust. Control node ⇒ `serve --serve` + `ui`; worker node ⇒ `ui`
/// only, never the server.
pub fn supervision_set(is_control_node: bool) -> Vec<SupervisedChild> {
    if is_control_node {
        vec![SupervisedChild::mesh_serve(), SupervisedChild::mesh_ui()]
    } else {
        vec![SupervisedChild::mesh_ui()]
    }
}

/// The two children's named clean-exit-1 modes (RESEARCH §3 / ADR-002 d2) —
/// special-cased, never blindly restart-looped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanExitReason {
    UiBuildMissing,
    AddrInUse,
    LauncherAlreadyRunning,
}

impl CleanExitReason {
    pub fn message(&self) -> &'static str {
        match self {
            CleanExitReason::UiBuildMissing => "ui-build-missing",
            CleanExitReason::AddrInUse => "EADDRINUSE",
            CleanExitReason::LauncherAlreadyRunning => "launcher already running (pid N)",
        }
    }

    /// Classify a child's exit-1 by its emitted message — `None` means "not a named
    /// clean exit," i.e. a genuine crash worth the backoff-restart.
    pub fn classify(message: &str) -> Option<CleanExitReason> {
        if message.contains("ui-build-missing") {
            Some(CleanExitReason::UiBuildMissing)
        } else if message.contains("EADDRINUSE") {
            Some(CleanExitReason::AddrInUse)
        } else if message.contains("launcher is already running") || message.contains("launcher already running") {
            Some(CleanExitReason::LauncherAlreadyRunning)
        } else {
            None
        }
    }
}

/// The local-process state machine (ADR-002 Consequences → DESIGN's local-process
/// ramp): `Running | Restarting(backoff) | Stopped | CleanExit(reason)`.
#[derive(Debug, Clone, PartialEq)]
pub enum LocalProcessState {
    Running,
    Restarting { attempt: u32, backoff_ms: u64 },
    Stopped,
    CleanExit { reason: CleanExitReason },
}

impl LocalProcessState {
    /// The DESIGN local-process ramp signal this state maps to (`DESIGN §UI
    /// behaviour`): `restarting` for a crash-triggered restart, `stopped` for a
    /// named clean exit.
    pub fn design_ramp_signal(&self) -> &'static str {
        match self {
            LocalProcessState::Running => "running",
            LocalProcessState::Restarting { .. } => "restarting",
            LocalProcessState::Stopped => "stopped",
            LocalProcessState::CleanExit { .. } => "stopped",
        }
    }
}

/// A pure jitter source seam — injected so backoff timing is deterministically
/// testable (STORY.md "Build notes": "inject the jitter/seed so it's deterministically
/// testable"). Returns a value in `[0.0, 1.0)`.
pub trait JitterSource {
    fn next_unit(&mut self) -> f64;
}

/// A fixed-sequence jitter source for tests — cycles through a provided list of
/// `[0.0, 1.0)` values.
pub struct FixedJitter {
    values: Vec<f64>,
    idx: usize,
}

impl FixedJitter {
    pub fn new(values: Vec<f64>) -> Self {
        assert!(!values.is_empty(), "FixedJitter needs at least one value");
        FixedJitter { values, idx: 0 }
    }
}

impl JitterSource for FixedJitter {
    fn next_unit(&mut self) -> f64 {
        let v = self.values[self.idx % self.values.len()];
        self.idx += 1;
        v
    }
}

const BASE_BACKOFF_MS: u64 = 500;
const MAX_BACKOFF_MS: u64 = 30_000;

/// Jittered exponential backoff as a pure function of the attempt count (1-indexed)
/// plus an injected jitter source — `base * 2^(attempt-1)`, capped at
/// `MAX_BACKOFF_MS`, with jitter applied as `delay * (0.5 + jitter/2)` so successive
/// delays are never a fixed value (RESEARCH §2 / ADR-002 d2 "restart is delayed by a
/// backoff … successive crashes grow the delay … jitter … not a fixed value").
pub fn jittered_backoff_ms(attempt: u32, jitter: &mut dyn JitterSource) -> u64 {
    assert!(attempt >= 1, "attempt is 1-indexed");
    let exp = attempt.saturating_sub(1).min(6); // cap growth before saturating u64 math
    let raw = BASE_BACKOFF_MS.saturating_mul(1u64 << exp).min(MAX_BACKOFF_MS);
    let factor = 0.5 + jitter.next_unit() / 2.0; // in [0.5, 1.0)
    ((raw as f64) * factor) as u64
}

/// The events the local-process state machine reacts to.
#[derive(Debug, Clone)]
pub enum ChildEvent {
    /// An unexpected exit — a genuine crash, not a named clean-exit-1 message.
    Crashed,
    /// The child's own clean-exit-1 message matched a named reason.
    ExitedCleanly(CleanExitReason),
    /// A restart attempt actually launched the child again successfully.
    RestartLaunched,
}

/// Transition the local-process state machine on one event (ADR-002 Consequences).
/// A crash transitions `Running -> Restarting(backoff)`; a subsequent successful
/// relaunch transitions `Restarting -> Running`; a named clean exit transitions
/// `Running -> CleanExit(reason)` and STAYS there (never tight-loop-restarted).
pub fn transition(
    state: &LocalProcessState,
    event: &ChildEvent,
    attempt: u32,
    jitter: &mut dyn JitterSource,
) -> LocalProcessState {
    match (state, event) {
        (LocalProcessState::Running, ChildEvent::Crashed) => LocalProcessState::Restarting {
            attempt,
            backoff_ms: jittered_backoff_ms(attempt, jitter),
        },
        (LocalProcessState::Restarting { .. }, ChildEvent::RestartLaunched) => LocalProcessState::Running,
        (_, ChildEvent::ExitedCleanly(reason)) => LocalProcessState::CleanExit { reason: *reason },
        // A clean exit is never tight-loop-restarted (no transition to Restarting
        // for ExitedCleanly, matched above) — otherwise stay in place; callers that
        // want to model `Stop` explicitly do so via `LocalProcessState::Stopped`
        // directly rather than through this event set.
        (other, _) => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario Outline: the supervised set is driven off isControlNode.
    #[test]
    fn control_node_supervises_both_serve_and_ui() {
        let set = supervision_set(true);
        assert!(set.contains(&SupervisedChild::mesh_serve()), "supervises aof mesh serve --serve");
        assert!(set.contains(&SupervisedChild::mesh_ui()), "supervises aof mesh ui");
        assert_eq!(set.len(), 2, "omits nothing");
    }

    #[test]
    fn worker_node_supervises_ui_only_never_the_server() {
        let set = supervision_set(false);
        assert!(set.contains(&SupervisedChild::mesh_ui()), "supervises aof mesh ui only");
        assert!(!set.contains(&SupervisedChild::mesh_serve()), "omits aof mesh serve --serve");
        assert_eq!(set.len(), 1);
    }

    // Scenario: a child that crashes is restarted under jittered exponential backoff.
    #[test]
    fn crash_transitions_running_to_restarting_with_a_nonzero_delayed_backoff() {
        let mut jitter = FixedJitter::new(vec![0.4]);
        let next = transition(&LocalProcessState::Running, &ChildEvent::Crashed, 1, &mut jitter);
        match next {
            LocalProcessState::Restarting { backoff_ms, .. } => {
                assert!(backoff_ms > 0, "the restart is delayed by a backoff, not immediate");
            }
            other => panic!("expected Restarting, got {other:?}"),
        }
    }

    #[test]
    fn successive_crashes_grow_the_backoff_delay_and_carry_jitter() {
        let mut jitter = FixedJitter::new(vec![0.5, 0.5, 0.5]);
        let d1 = jittered_backoff_ms(1, &mut jitter);
        let d2 = jittered_backoff_ms(2, &mut jitter);
        let d3 = jittered_backoff_ms(3, &mut jitter);
        assert!(d2 > d1, "successive crashes grow the backoff delay (attempt 2 > attempt 1)");
        assert!(d3 > d2, "successive crashes grow the backoff delay (attempt 3 > attempt 2)");

        // Jitter: same attempt number, different jitter samples ⇒ different delays.
        let mut jitter_a = FixedJitter::new(vec![0.1]);
        let mut jitter_b = FixedJitter::new(vec![0.9]);
        let a = jittered_backoff_ms(2, &mut jitter_a);
        let b = jittered_backoff_ms(2, &mut jitter_b);
        assert_ne!(a, b, "the backoff carries jitter — successive delays are not a fixed value");
    }

    // Scenario Outline: a named clean-exit-1 mode is surfaced and not tight-loop-
    // restarted.
    #[test]
    fn named_clean_exit_reasons_classify_from_their_message() {
        assert_eq!(CleanExitReason::classify("ui-build-missing"), Some(CleanExitReason::UiBuildMissing));
        assert_eq!(CleanExitReason::classify("EADDRINUSE"), Some(CleanExitReason::AddrInUse));
        assert_eq!(
            CleanExitReason::classify("AOF mesh launcher is already running (pid 4242)."),
            Some(CleanExitReason::LauncherAlreadyRunning)
        );
        assert_eq!(CleanExitReason::classify("segmentation fault"), None, "an unrecognized exit message is NOT a named clean exit (a genuine crash)");
    }

    #[test]
    fn named_clean_exit_transitions_to_clean_exit_state_and_is_not_restarting() {
        let mut jitter = FixedJitter::new(vec![0.5]);
        let next = transition(
            &LocalProcessState::Running,
            &ChildEvent::ExitedCleanly(CleanExitReason::UiBuildMissing),
            1,
            &mut jitter,
        );
        assert_eq!(next, LocalProcessState::CleanExit { reason: CleanExitReason::UiBuildMissing });
        assert_ne!(
            std::mem::discriminant(&next),
            std::mem::discriminant(&LocalProcessState::Restarting { attempt: 1, backoff_ms: 0 }),
            "it does not tight-loop-restart the child"
        );
        assert_eq!(next.design_ramp_signal(), "stopped");
    }

    // Scenario Outline: the local-process state machine transitions on crash vs
    // named clean exit.
    #[test]
    fn crash_then_restart_maps_to_the_restarting_design_ramp_signal() {
        let mut jitter = FixedJitter::new(vec![0.5]);
        let restarting = transition(&LocalProcessState::Running, &ChildEvent::Crashed, 1, &mut jitter);
        assert_eq!(restarting.design_ramp_signal(), "restarting", "Running -> Restarting(backoff) maps to DESIGN's restarting local-process signal");
        let running_again = transition(&restarting, &ChildEvent::RestartLaunched, 1, &mut jitter);
        assert_eq!(running_again, LocalProcessState::Running, "Restarting(backoff) -> Running once relaunched");
    }

    #[test]
    fn clean_exit_with_named_reason_maps_to_the_stopped_design_ramp_signal() {
        let mut jitter = FixedJitter::new(vec![0.5]);
        let stopped = transition(
            &LocalProcessState::Running,
            &ChildEvent::ExitedCleanly(CleanExitReason::AddrInUse),
            1,
            &mut jitter,
        );
        assert_eq!(stopped.design_ramp_signal(), "stopped", "Running -> CleanExit(reason) maps to DESIGN's stopped local-process signal");
    }
}
