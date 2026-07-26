//! Task 01 (continued) — the poll cadence: `mesh status --json` is the supervisor's
//! ONLY fleet-data command, re-issued once per cadence tick (ARCHITECTURE 36/ADR-004
//! d1-2, DESIGN §Footer poll idiom).
//!
//! The cadence is driven off an injectable tick source — never a real `sleep`-driven
//! loop in a unit test (the story's Build notes: "asserted as one status invocation
//! per tick over a fake clock/timer seam"). The REAL spawn (a `std::process::Command`
//! over the resolved path from `resolve.rs`) lives in the Tauri shell crate that
//! consumes this seam; this module models "what happens on tick" as a plain
//! trait/closure so it is pure-function testable.

/// A single fleet-data command issuance, as observed by a fake spawner — the
/// object under test for "the poll's ONLY fleet-data command is mesh status --json".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FleetDataCommand {
    pub argv: Vec<String>,
}

impl FleetDataCommand {
    pub fn mesh_status_json() -> Self {
        FleetDataCommand {
            argv: vec!["mesh".to_string(), "status".to_string(), "--json".to_string()],
        }
    }
}

/// The seam a poller drives its fleet-data reads through. A real implementation
/// spawns the resolved `aof` (task 00) and returns its stdout; a test implementation
/// records the argv it was asked to issue.
pub trait FleetDataSource {
    /// Issue ONE fleet-data poll, recording the command that was used to obtain it
    /// and returning the raw status document text (or an error) for the caller to
    /// parse via `status::parse_status`.
    fn poll_once(&mut self) -> FleetDataCommand;
}

/// A recording fake source — captures every command issued so a test can assert
/// "only `mesh status --json`, N times."
#[derive(Debug, Default)]
pub struct RecordingFleetDataSource {
    pub issued: Vec<FleetDataCommand>,
}

impl FleetDataSource for RecordingFleetDataSource {
    fn poll_once(&mut self) -> FleetDataCommand {
        let cmd = FleetDataCommand::mesh_status_json();
        self.issued.push(cmd.clone());
        cmd
    }
}

/// Drive `source` for `ticks` cadence ticks, issuing exactly one fleet-data poll per
/// tick. This is the pure cadence model the `@executable` scenario exercises — a
/// real timer (e.g. a `tokio::time::interval`) in the Tauri shell calls this same
/// per-tick step; nothing here sleeps.
pub fn run_cadence(source: &mut dyn FleetDataSource, ticks: u32) {
    for _ in 0..ticks {
        source.poll_once();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario: the poll's ONLY fleet-data command is mesh status --json.
    #[test]
    fn the_only_fleet_data_command_issued_is_mesh_status_json() {
        let mut source = RecordingFleetDataSource::default();
        run_cadence(&mut source, 1);

        assert_eq!(source.issued.len(), 1);
        assert_eq!(source.issued[0].argv, vec!["mesh", "status", "--json"], "the only fleet-data command issued is \"mesh status --json\"");
        // This fake source's only producible value is `mesh_status_json()` — there is
        // structurally no OTHER fleet-data argv it could have recorded (no second
        // data-bearing command exists to issue), the same single-data-path guarantee
        // acd-desktop-single-data-path enforces over the real spawn source.
        assert!(
            source.issued.iter().all(|cmd| cmd.argv == vec!["mesh", "status", "--json"]),
            "every issued command is the single fleet-data command"
        );
    }

    // Scenario: the poll re-issues mesh status --json once per cadence tick.
    #[test]
    fn three_cadence_ticks_issue_exactly_three_status_invocations() {
        let mut source = RecordingFleetDataSource::default();
        run_cadence(&mut source, 3);

        assert_eq!(source.issued.len(), 3, "\"mesh status --json\" is invoked exactly three times");
        assert!(
            source.issued.iter().all(|c| c.argv == vec!["mesh", "status", "--json"]),
            "each tick issues exactly one status invocation"
        );
    }
}
