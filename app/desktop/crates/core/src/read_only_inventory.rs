//! Story 02 · task 02 — the read-only window WIRE inventory
//! (ARCHITECTURE 36/DESIGN §Non-negotiable framing · §Review notes "read-only over
//! the fleet", ADR-004 decision 3: the spawnable `aof mesh` allow-list is EXACTLY
//! {status, serve, ui}).
//!
//! This module is the SOURCE-LEVEL control/IPC inventory the window's affordances
//! and render path are drawn from — a fixed list a harness enumerates, not a
//! rendered screenshot (that's task 03's `@uat`). Arms `acd-desktop-read-only-fleet`
//! and exercises `acd-desktop-single-data-path`.

/// The full spawnable-verb allow-list (ADR-004 d3) — EXACTLY these three, never a
/// mutating verb.
pub const ALLOWED_MESH_VERBS: [&str; 3] = ["status", "serve", "ui"];

/// The mesh-mutating verbs that must NEVER be reachable from any window affordance
/// (DESIGN §Review notes read-only rail).
pub const FORBIDDEN_MUTATION_VERBS: [&str; 5] = ["assign", "issue", "revoke", "invite", "join"];

/// How a control writes — a fleet-mutating spawn is forbidden everywhere on this
/// surface; the only allowed writes are LOCAL process lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteKind {
    /// Spawns `aof mesh serve`/`aof mesh ui` on THIS machine — process lifecycle,
    /// never a fleet mutation.
    LocalProcessLifecycle,
    /// Issues the ONE read poll (`aof mesh status --json`) — a fleet-data READ, not
    /// a write at all, but tracked here so the inventory can assert it is the ONLY
    /// data-bearing verb on the render path.
    FleetDataRead,
}

/// One entry in the window's full affordance inventory (buttons, menu items, IPC
/// command handlers) — the SOURCE-LEVEL registry this task's scenarios enumerate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowAffordance {
    pub name: &'static str,
    pub spawns_verb: Option<&'static str>,
    pub write_kind: Option<WriteKind>,
}

/// The window's full affordance inventory (DESIGN §Surface 1 control bar — "the only
/// controls are the local process toggles"). This is the FIXED list the harness
/// enumerates: two local process toggles (Mesh server, Mesh web UI), the Open-web-UI
/// launch (not a mesh spawn — it opens a browser URL), and the render/poll path
/// itself (`mesh status`, a read, not a control). NO assign/route/dispatch entry
/// exists in this list — that is the structural proof of read-only.
pub fn window_affordance_inventory() -> Vec<WindowAffordance> {
    vec![
        WindowAffordance {
            name: "Mesh server toggle",
            spawns_verb: Some("serve"),
            write_kind: Some(WriteKind::LocalProcessLifecycle),
        },
        WindowAffordance {
            name: "Mesh web UI toggle",
            spawns_verb: Some("ui"),
            write_kind: Some(WriteKind::LocalProcessLifecycle),
        },
        WindowAffordance {
            name: "Open web UI button",
            // Opens the running `aof mesh ui`'s URL in the default browser — no
            // second `aof mesh` spawn of its own.
            spawns_verb: None,
            write_kind: None,
        },
        WindowAffordance {
            name: "Render/refresh poll",
            spawns_verb: Some("status"),
            write_kind: Some(WriteKind::FleetDataRead),
        },
    ]
}

/// Search the inventory for a control that spawns `aof mesh <verb>` for the given
/// verb — used to assert a forbidden verb is absent from every affordance channel.
pub fn find_affordance_spawning<'a>(inventory: &'a [WindowAffordance], verb: &str) -> Option<&'a WindowAffordance> {
    inventory.iter().find(|a| a.spawns_verb == Some(verb))
}

/// The render path's data-bearing verb set — exactly one entry, `status` (ADR-004
/// d1-2, `acd-desktop-single-data-path`).
pub fn render_path_data_verbs(inventory: &[WindowAffordance]) -> Vec<&'static str> {
    inventory
        .iter()
        .filter(|a| a.write_kind == Some(WriteKind::FleetDataRead))
        .filter_map(|a| a.spawns_verb)
        .collect()
}

/// The window's interactive WRITE controls only (excludes the read-only render
/// path) — used to assert "the only write controls are the local process toggles."
pub fn write_controls(inventory: &[WindowAffordance]) -> Vec<&WindowAffordance> {
    inventory
        .iter()
        .filter(|a| matches!(a.write_kind, Some(WriteKind::LocalProcessLifecycle)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario Outline: no affordance spawns a fleet-mutating aof mesh verb from the
    // window.
    #[test]
    fn no_affordance_spawns_a_fleet_mutating_verb() {
        let inventory = window_affordance_inventory();
        for verb in FORBIDDEN_MUTATION_VERBS {
            assert!(
                find_affordance_spawning(&inventory, verb).is_none(),
                "no button, menu item, or handler spawns aof mesh {verb}"
            );
            assert!(
                !ALLOWED_MESH_VERBS.contains(&verb),
                "the verb {verb} is absent from the spawnable fleet-data/mutation allow-list"
            );
        }
    }

    // Scenario: the only write controls are the local process toggles — local
    // supervision, not a fleet mutation.
    #[test]
    fn only_write_controls_are_local_process_toggles() {
        let inventory = window_affordance_inventory();
        let writes = write_controls(&inventory);
        assert_eq!(writes.len(), 2, "exactly the two local process toggles are write controls");
        for w in &writes {
            assert_eq!(w.write_kind, Some(WriteKind::LocalProcessLifecycle), "starting/stopping a local process is local supervision, never a fleet mutation");
            assert!(
                matches!(w.spawns_verb, Some("serve") | Some("ui")),
                "each write control spawns only serve/ui (start/stop the supervised process on THIS machine)"
            );
        }
        assert!(
            writes.iter().all(|w| !FORBIDDEN_MUTATION_VERBS.contains(&w.spawns_verb.unwrap_or(""))),
            "no control on the window writes to the fleet's assignment/routing state"
        );
    }

    // Scenario: the render path reads the fleet through exactly one verb — the mesh
    // status poll — never a second data command.
    #[test]
    fn render_path_issues_exactly_one_data_verb() {
        let inventory = window_affordance_inventory();
        let data_verbs = render_path_data_verbs(&inventory);
        assert_eq!(data_verbs, vec!["status"], "exactly one data-bearing verb is spawned — aof mesh status --json");
        // No second data-bearing verb (the identity/sync read commands ADR-004
        // forbids as a second fleet-data path) is present in the render path's verb set.
        assert!(!data_verbs.contains(&"identity"), "no second data-bearing read command is spawned by the render path");
        assert!(!data_verbs.contains(&"sync"), "no second data-bearing read command is spawned by the render path");
        // The isControlNode role decision comes from this SAME status poll (ADR-002),
        // never a second command — modeled by there being only one FleetDataRead
        // entry in the inventory at all.
        let reads: Vec<_> = inventory.iter().filter(|a| a.write_kind == Some(WriteKind::FleetDataRead)).collect();
        assert_eq!(reads.len(), 1, "the isControlNode role decision is taken from this same one poll, not a second command");
    }

    // Scenario Outline: a local process toggle spawns a lifecycle verb, which is
    // allowed and is not a fleet mutation.
    #[test]
    fn local_process_toggle_spawns_are_lifecycle_not_mutation_or_data_read() {
        let inventory = window_affordance_inventory();
        for (name, verb) in [("Mesh server toggle", "serve"), ("Mesh web UI toggle", "ui")] {
            let affordance = inventory.iter().find(|a| a.name == name).expect("toggle present");
            assert_eq!(affordance.spawns_verb, Some(verb));
            assert!(ALLOWED_MESH_VERBS.contains(&verb), "the verb is a LOCAL process-lifecycle spawn allowed by the {{status,serve,ui}} allow-list");
            assert_eq!(affordance.write_kind, Some(WriteKind::LocalProcessLifecycle), "neither a fleet-data read nor a fleet mutation");
            assert_ne!(
                affordance.write_kind,
                Some(WriteKind::FleetDataRead),
                "it does not appear on the render/poll data path (which spawns only mesh status)"
            );
        }
    }
}
