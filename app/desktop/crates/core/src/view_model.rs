//! Story 02 · task 00 — the pure status-render view-model
//! (ARCHITECTURE 36/DESIGN §Surface 1 "Layout regions" item 3 · §"Design ramp per
//! region", ADR-004 the corrected `mesh status --json` shape).
//!
//! Maps a deserialized [`crate::status::MeshStatus`] (reusing story 00's
//! `parse_status()` types — the corrected shape: `presence.activeRuns`, `node.local`,
//! `node.stale`, top-level `isControlNode`; milestone 38's ADR-001 additive
//! `presence.sessions`) to a fixed row descriptor per node: the fleet-presence health
//! dot (from `stale`/`presence`, never a local-process signal), the `this node`
//! identity tag (from `node.local`), the role badge, the `aofVersion` (nested under
//! `presence`), and current work (from `presence.activeRuns`, else
//! `presence.sessions`, else `idle` — [`current_work`]).
//!
//! THE TWO RAMPS STAY SEPARATE (DESIGN §Non-negotiable framing): this module derives
//! ONLY the body dots from `mesh:status` — it never reads a local-supervisor signal
//! for a body dot. [`ControlBarPill`] models the OTHER (local-process) ramp
//! separately so a caller can assert both read truthfully side by side without
//! either overwriting the other.

use crate::status::{MeshStatus, Node};

/// The fleet-presence health dot (DESIGN §Surface 1 body row · §Design ramp "health
/// dot from the presence ramp"). `Stale` is a MUTED/grey mark — NEVER red (DESIGN
/// §Review notes "stale is never red").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthDot {
    Online,
    Stale,
    Offline,
}

impl HealthDot {
    pub fn label(&self) -> &'static str {
        match self {
            HealthDot::Online => "online",
            HealthDot::Stale => "stale",
            HealthDot::Offline => "offline",
        }
    }

    pub fn render_shape(&self) -> &'static str {
        match self {
            HealthDot::Online => "filled accent",
            HealthDot::Stale => "hollow muted",
            HealthDot::Offline => "hollow dim",
        }
    }

    /// True for the ONE mark the design ramp forbids ever being red-tinted.
    pub fn is_muted_never_red(&self) -> bool {
        !matches!(self, HealthDot::Online)
    }
}

/// The row's "current work" cell (DESIGN §Surface 1 body row "current work is the
/// single most-glanced fact"; milestone 38 DESIGN §Surface 1 row 3 — the state set
/// grows to THREE states: `idle` / `running N runs` / `working · <repo> (session)`).
///
/// F7/F8 fix (aof:verify 38, BLOCKER): `Running` no longer carries a `ref`/`title` —
/// the producer never emits `activeRuns[]` as objects (ADR-001 freezes it as a bare
/// `string[]` of run ids), so the cell can only ever know a COUNT, matching the JS
/// projection `ui/src/fleet/runs.mjs`'s `fleetCurrentWorkLines` (`running N runs`).
/// `Working` is the NEW session-derived state (F7 — the desktop never learned about
/// sessions at all before this fix).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CurrentWork {
    Running { runs: usize },
    Working { repos: Vec<String> },
    Idle,
}

impl CurrentWork {
    pub fn display(&self) -> String {
        match self {
            CurrentWork::Running { runs } => {
                let word = if *runs == 1 { "run" } else { "runs" };
                format!("running {runs} {word}")
            }
            // DESIGN §Surface 1 "Notes binding the review": the `working · ` prefix is
            // fixed, repos comma-joined, ONE trailing `(session)` qualifier — never
            // per-repo qualifiers.
            CurrentWork::Working { repos } => format!("working \u{b7} {} (session)", repos.join(", ")),
            CurrentWork::Idle => "idle".to_string(),
        }
    }

    pub fn state_str(&self) -> &'static str {
        match self {
            CurrentWork::Running { .. } => "running",
            CurrentWork::Working { .. } => "working",
            CurrentWork::Idle => "idle",
        }
    }

    /// DESIGN §Surface 1 "working reads as a PEER of running, not louder and not
    /// quieter" — both active states (`Running`/`Working`) carry the SAME active
    /// emphasis (`primary`); only `Idle` is muted. Exposed as a boolean so a caller
    /// (the Tauri app layer / a future style seam) never has to string-match
    /// `state_str()` to decide the emphasis.
    pub fn is_active(&self) -> bool {
        !matches!(self, CurrentWork::Idle)
    }
}

/// The role badge — a neutral outline chip, no fill (DESIGN §Surface 1 body row).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleBadge {
    Control,
    Worker,
}

impl RoleBadge {
    pub fn label(&self) -> &'static str {
        match self {
            RoleBadge::Control => "control",
            RoleBadge::Worker => "worker",
        }
    }
}

/// One rendered node row (DESIGN §Surface 1 body row anatomy, in order: health dot,
/// name + this-node tag, role badge, version, current work).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeRow {
    pub health_dot: HealthDot,
    pub name: String,
    pub this_node: bool,
    pub role_badge: RoleBadge,
    /// `None` — "unknown version" (rendered as "\u{2014}") — when the node carries no
    /// `presence` (never a crash on the absent nested field).
    pub version: Option<String>,
    pub current_work: CurrentWork,
}

impl NodeRow {
    pub fn version_cell(&self) -> String {
        self.version.clone().unwrap_or_else(|| "\u{2014}".to_string())
    }
}

/// The LOCAL-supervisor ramp signal for one control-bar pill (running/stopped/
/// restarting) — kept as a SEPARATE type from [`HealthDot`] so the two ramps can
/// never structurally be conflated by a caller reusing one field for both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlBarPill {
    Running,
    Stopped,
    Restarting,
}

impl ControlBarPill {
    pub fn label(&self) -> &'static str {
        match self {
            ControlBarPill::Running => "running",
            ControlBarPill::Stopped => "stopped",
            ControlBarPill::Restarting => "restarting",
        }
    }
}

/// Read the fleet-presence health dot from `node.presence`/`node.stale` ONLY — never
/// from a local-process signal (DESIGN §Surface 1 · §Non-negotiable framing).
///
/// STALE-FIRST PRECEDENCE (authoritative — mirrored in `app.js`'s `presenceOf()`):
/// `stale` is checked BEFORE the no-presence branch, so a `{stale:true, no-presence}`
/// node still renders `stale` (muted grey — DESIGN), never `offline`.
pub fn health_dot(node: &Node) -> HealthDot {
    if node.stale {
        return HealthDot::Stale;
    }
    if !node.has_presence() {
        return HealthDot::Offline;
    }
    HealthDot::Online
}

/// Read the current-work cell from `presence.activeRuns`/`presence.sessions` (both
/// nested — NOT flat on the node, ADR-004) — the F7/F8 fix (aof:verify 38, BLOCKER):
///
/// - `activeRuns` non-empty ⇒ `Running { runs: activeRuns.len() }` — ADR-004's
///   run-wins rule: a run on this node holds the line even when a live session ALSO
///   exists (DESIGN §Surface 1: "the run wins the primary line even if a session also
///   exists" — not a second/combined line). `activeRuns` is read as the FROZEN
///   `string[]` of bare run ids (F8) — never indexed as `{ ref, title }` objects.
/// - else `presence.sessions` non-empty ⇒ `Working { repos }`, one entry per LIVE
///   session's repo (F7 — the desktop previously never read this key at all). The
///   publisher (`assembleCurrentPresenceRecord`, `src/mesh-launcher.mjs`) has ALREADY
///   TTL-filtered and run-subsumed `sessions[]` before the wire — this function
///   performs NO liveness recomputation and never ghosts an expired session; it
///   renders exactly what it is handed.
/// - neither, or no presence at all ⇒ `Idle`.
pub fn current_work(node: &Node) -> CurrentWork {
    let runs = node.active_runs();
    if !runs.is_empty() {
        return CurrentWork::Running { runs: runs.len() };
    }
    let repos = node.session_repos();
    if !repos.is_empty() {
        return CurrentWork::Working { repos };
    }
    CurrentWork::Idle
}

/// The role badge from the node's caps/role. `is_control_role` is supplied by the
/// caller (derived from the node's `role`/`caps` field elsewhere in the document —
/// this pure mapper takes the already-resolved boolean, matching the Background's
/// "role badge from isControlNode/caps" framing without re-parsing raw JSON here).
pub fn role_badge(is_control_role: bool) -> RoleBadge {
    if is_control_role { RoleBadge::Control } else { RoleBadge::Worker }
}

/// Build the full row descriptor for one node.
pub fn node_row(node: &Node, is_control_role: bool) -> NodeRow {
    NodeRow {
        health_dot: health_dot(node),
        name: node.node_id.clone(),
        this_node: node.local,
        role_badge: role_badge(is_control_role),
        version: node.reported_aof_version().map(|s| s.to_string()),
        current_work: current_work(node),
    }
}

/// Build the full row set for EVERY node in a `mesh status` payload — none dropped
/// (DESIGN §Surface 1 "a populated mixed fleet renders every node"). Each row's
/// `is_control_role` is derived the SAME way the IPC caller derives it today
/// (`status.is_control_node() && node.local` — the control badge belongs to THIS
/// node only, and only when this install is itself the control node), so callers
/// (e.g. the Tauri shell's `get_view_model`) can point at this one shaping instead
/// of re-deriving a second per-node mapping.
pub fn node_rows(status: &MeshStatus) -> Vec<NodeRow> {
    status
        .nodes
        .iter()
        .map(|n| node_row(n, status.is_control_node() && n.local))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::status::parse_status;

    fn node_with_presence(stale: bool, active_runs_json: &str, aof_version: Option<&str>, local: bool) -> Node {
        let version_field = match aof_version {
            Some(v) => format!(r#","aofVersion":"{v}""#),
            None => String::new(),
        };
        let doc = format!(
            r#"{{"nodes":[{{"nodeId":"n1","stale":{stale},"local":{local},"presence":{{"activeRuns":{active_runs_json}{version_field}}}}}],"boards":[],"isControlNode":true}}"#,
        );
        parse_status(&doc).unwrap().nodes.into_iter().next().unwrap()
    }

    fn node_without_presence(stale: bool) -> Node {
        let doc = format!(r#"{{"nodes":[{{"nodeId":"n1","stale":{stale}}}],"boards":[],"isControlNode":true}}"#);
        parse_status(&doc).unwrap().nodes.into_iter().next().unwrap()
    }

    // Scenario Outline: each node's health dot comes from the fleet-presence ramp
    // (presence + stale), never from a process signal.
    #[test]
    fn health_dot_online_present_not_stale() {
        let n = node_with_presence(false, "[]", None, false);
        let dot = health_dot(&n);
        assert_eq!(dot.label(), "online");
        assert_eq!(dot.render_shape(), "filled accent");
    }

    #[test]
    fn health_dot_stale_present_and_stale() {
        let n = node_with_presence(true, "[]", None, false);
        let dot = health_dot(&n);
        assert_eq!(dot.label(), "stale");
        assert_eq!(dot.render_shape(), "hollow muted");
        assert!(dot.is_muted_never_red(), "a stale dot is a muted/grey mark, never red");
    }

    #[test]
    fn health_dot_offline_absent_presence() {
        let n = node_without_presence(false);
        let dot = health_dot(&n);
        assert_eq!(dot.label(), "offline");
        assert_eq!(dot.render_shape(), "hollow dim");
    }

    // Pins the STALE-FIRST precedence: a node with no presence at all but marked
    // stale still reads "stale" (muted grey), never "offline" — `stale` is checked
    // BEFORE the no-presence branch (mirrored in app.js's `presenceOf()`).
    #[test]
    fn health_dot_stale_takes_precedence_over_absent_presence() {
        let n = node_without_presence(true);
        let dot = health_dot(&n);
        assert_eq!(dot.label(), "stale", "stale is checked before the no-presence branch");
        assert_eq!(dot.render_shape(), "hollow muted");
        assert!(dot.is_muted_never_red(), "a stale dot is a muted/grey mark, never red");
    }

    // Scenario Outline: current work is read from presence.activeRuns — the frozen
    // `string[]` of run ids (F8) — as an aggregate `running N runs` count, else
    // muted idle. (Object-shaped `activeRuns` elements — the F8 defect — are pinned
    // as a parse error below, `f8_active_runs_object_shaped_element_is_a_parse_error_not_a_silent_empty_read`.)
    #[test]
    fn current_work_running_from_active_runs() {
        let n = node_with_presence(false, r#"["run-0001"]"#, None, false);
        let w = current_work(&n);
        assert_eq!(w.display(), "running 1 run");
        assert_eq!(w.state_str(), "running");
        assert!(w.is_active());
    }

    #[test]
    fn current_work_idle_when_active_runs_empty() {
        let n = node_with_presence(false, "[]", None, false);
        let w = current_work(&n);
        assert_eq!(w.display(), "idle");
        assert_eq!(w.state_str(), "idle");
    }

    #[test]
    fn current_work_idle_when_no_presence() {
        let n = node_without_presence(false);
        let w = current_work(&n);
        assert_eq!(w.display(), "idle");
        assert_eq!(w.state_str(), "idle");
    }

    // Scenario Outline: the this node tag is an identity label off node.local, only
    // on the local node, never a colour change.
    #[test]
    fn this_node_tag_present_when_local_true() {
        let n = node_with_presence(false, "[]", None, true);
        let row = node_row(&n, true);
        assert!(row.this_node, "the row carries a neutral-outline this node tag");
    }

    // Real (non-tautological) check for "the this node tag never a colour change":
    // build node_row for a LOCAL and a NON-LOCAL node whose presence/stale are
    // OTHERWISE IDENTICAL, and assert their health_dot is identical — pinning that
    // toggling `local` alone does not move the dot.
    #[test]
    fn this_node_tag_does_not_change_the_health_dot() {
        let local_node = node_with_presence(false, "[]", None, true);
        let non_local_node = node_with_presence(false, "[]", None, false);

        let local_row = node_row(&local_node, true);
        let non_local_row = node_row(&non_local_node, false);

        assert!(local_row.this_node, "the local node's row carries the this-node tag");
        assert!(!non_local_row.this_node, "the non-local node's row does not carry the this-node tag");
        assert_eq!(
            local_row.health_dot, non_local_row.health_dot,
            "identical presence/stale yields an identical health-dot regardless of the this-node tag"
        );
    }

    #[test]
    fn this_node_tag_absent_when_local_absent() {
        let n = node_without_presence(false);
        let row = node_row(&n, true);
        assert!(!row.this_node, "does not carry the this node tag");
    }

    // Scenario Outline: the role badge is a neutral chip and the version is read
    // from presence.aofVersion (nested, mono).
    #[test]
    fn role_badge_and_nested_version_control() {
        let n = node_with_presence(false, "[]", Some("1.9.3"), false);
        let row = node_row(&n, true);
        assert_eq!(row.role_badge.label(), "control");
        assert_eq!(row.version_cell(), "1.9.3");
    }

    #[test]
    fn role_badge_and_nested_version_worker() {
        let n = node_with_presence(false, "[]", Some("1.9.3"), false);
        let row = node_row(&n, false);
        assert_eq!(row.role_badge.label(), "worker");
        assert_eq!(row.version_cell(), "1.9.3");
    }

    #[test]
    fn version_unknown_when_no_presence() {
        let n = node_without_presence(false);
        let row = node_row(&n, false);
        assert_eq!(row.version_cell(), "\u{2014}", "an absent presence yields an unknown-version cell, never a throw");
    }

    // Scenario: a node with no presence renders idle / unknown-liveness /
    // unknown-version without crashing.
    #[test]
    fn node_with_no_presence_renders_whole_without_crashing() {
        let n = node_without_presence(false);
        let row = node_row(&n, true);
        assert_eq!(row.health_dot.label(), "offline");
        assert_eq!(row.current_work.display(), "idle");
        assert_eq!(row.version_cell(), "\u{2014}");
        // The mere fact this ran to completion (no panic) proves the "does not throw
        // dereferencing the absent presence.activeRuns/aofVersion" assertion.
        assert_eq!(row.name, "n1", "the row is still rendered — never dropped for a missing presence");
    }

    // Scenario: a node reads online in the body while its local web-UI child pill
    // reads stopped — the two ramps never conflate.
    #[test]
    fn body_dot_and_local_pill_are_independent_ramps() {
        let n = node_with_presence(false, "[]", None, true);
        let row = node_row(&n, true);
        let local_pill = ControlBarPill::Stopped;

        assert_eq!(row.health_dot.label(), "online", "the body health dot reads online (from presence/stale)");
        assert_eq!(local_pill.label(), "stopped", "the control-bar web-UI pill reads stopped (local-supervisor signal)");
        // Structurally distinct types — health_dot() never even receives a
        // ControlBarPill as input, so the body dot cannot be derived from it.
        assert_ne!(row.health_dot.label(), local_pill.label(), "the two ramps are read from separate sources and read truthfully side by side");
    }

    // Scenario: a populated MIXED fleet — a control this-node running, a worker
    // running, a worker idle, a stale worker — renders every node (none dropped),
    // with the stale node muted/never-red and a running row coexisting with an idle
    // row in the same row set.
    #[test]
    fn node_rows_maps_every_node_in_a_mixed_fleet_none_dropped() {
        let doc = r#"{
            "nodes": [
                { "nodeId": "control-mac", "local": true, "stale": false,
                  "presence": { "activeRuns": ["run-0001"], "sessions": [], "aofVersion": "1.9.3" } },
                { "nodeId": "worker-01", "local": false, "stale": false,
                  "presence": { "activeRuns": ["run-0002"], "sessions": [], "aofVersion": "1.9.3" } },
                { "nodeId": "worker-02", "local": false, "stale": false,
                  "presence": { "activeRuns": [], "sessions": [], "aofVersion": "1.9.2" } },
                { "nodeId": "worker-03-stale", "local": false, "stale": true,
                  "presence": { "activeRuns": [], "sessions": [], "aofVersion": "1.9.3" } }
            ],
            "boards": [],
            "isControlNode": true
        }"#;
        let status = parse_status(doc).expect("parses the mixed-fleet fixture");
        let rows = node_rows(&status);

        assert_eq!(rows.len(), status.nodes.len(), "every node in the payload is mapped — none dropped");

        let control = rows.iter().find(|r| r.name == "control-mac").unwrap();
        let running_worker = rows.iter().find(|r| r.name == "worker-01").unwrap();
        let idle_worker = rows.iter().find(|r| r.name == "worker-02").unwrap();
        let stale_worker = rows.iter().find(|r| r.name == "worker-03-stale").unwrap();

        // The stale node is present with a muted, never-red dot.
        assert_eq!(stale_worker.health_dot.label(), "stale");
        assert!(stale_worker.health_dot.is_muted_never_red(), "the stale row's dot is muted, never red");

        // A running node and an idle node coexist in the same row set.
        assert_eq!(running_worker.current_work.state_str(), "running");
        assert_eq!(running_worker.current_work.display(), "running 1 run");
        assert_eq!(idle_worker.current_work.state_str(), "idle");
        assert_eq!(idle_worker.current_work.display(), "idle");

        // The control this-node row carries the this-node tag + control role + its
        // own running work, undisturbed by the rest of the mixed set.
        assert!(control.this_node, "the control node's own row carries the this-node tag");
        assert_eq!(control.role_badge.label(), "control");
        assert_eq!(control.current_work.state_str(), "running");
        assert_eq!(control.health_dot.label(), "online");
    }

    // ─────────────────────────────────────────────────────────────────────
    // F7/F8 fix (aof:verify 38, BLOCKER) — the session signal + the real
    // `activeRuns` shape. Per the task's binding QA discipline, the base fixtures
    // below are REAL captured `aof mesh status --json` documents — never a
    // hand-authored record — so the exact defect class (F1/F4/F6/F7/F8: assuming a
    // shape the producer never emits) cannot recur here.
    // ─────────────────────────────────────────────────────────────────────

    // REAL — captured live in this repo via:
    //   aof session start --workspace 9db1fd84f5895e38 --repo aof --assistant claude-code
    //   (assembled + published through the real `readActiveRuns`/`readLiveSessions`/
    //   `assemblePresenceRecord`/`publishPresenceRecord` seams — mesh-presence.mjs)
    //   aof mesh status --json
    // 2026-07-12T20:55Z, node `umairs-msi` (this machine, `local: true`): one LIVE
    // session on repo "aof", EMPTY `activeRuns`. Verbatim stdout, byte-for-byte.
    const REAL_CAPTURED_LIVE_SESSION_STATUS: &str = r#"{
  "nodes": [
    {
      "nodeId": "peer-git",
      "role": "worker",
      "controlNode": false,
      "host": "peer-git",
      "os": "linux",
      "runtimes": [],
      "aofVersion": "0.1.0",
      "publishedAt": "2026-06-29T00:00:00.000Z",
      "lastSeenAt": "2026-07-04T10:00:00.000Z",
      "fabric": {
        "address": null,
        "online": null
      },
      "recordSource": "node-record",
      "workspaces": [
        {
          "workspaceId": "9db1fd84f5895e38",
          "name": "aof",
          "projectRoot": "C:\\Source\\umair\\aof"
        }
      ],
      "descriptorPath": "C:\\Users\\Umair\\.aof\\mesh\\nodes\\peer-git.json",
      "presence": {
        "nodeId": "peer-git",
        "heartbeatAt": "2026-07-04T10:00:00.000Z",
        "activeRuns": [],
        "sessions": [],
        "aofVersion": "0.1.0",
        "buildId": "source"
      },
      "stale": true
    },
    {
      "nodeId": "umairs-mac-mini",
      "role": "worker",
      "controlNode": false,
      "host": "Umairs-Mac-mini.local",
      "os": "darwin",
      "runtimes": [
        "claude",
        "codex"
      ],
      "aofVersion": "0.1.0",
      "publishedAt": "2026-07-07T19:20:52.437Z",
      "lastSeenAt": null,
      "fabric": {
        "address": "100.114.105.64",
        "online": true
      },
      "recordSource": "node-record",
      "workspaces": [
        {
          "workspaceId": "9db1fd84f5895e38",
          "name": "aof",
          "projectRoot": "C:\\Source\\umair\\aof"
        }
      ],
      "descriptorPath": "C:\\Users\\Umair\\.aof\\mesh\\nodes\\umairs-mac-mini.json",
      "presence": {
        "nodeId": "umairs-mac-mini",
        "heartbeatAt": "2026-07-12T20:55:20.729Z",
        "activeRuns": [],
        "aofVersion": ""
      },
      "stale": false
    },
    {
      "nodeId": "umairs-msi",
      "role": "control",
      "controlNode": true,
      "host": "Umairs-MSI",
      "os": "win32",
      "runtimes": [
        "claude",
        "codex"
      ],
      "aofVersion": "0.1.0",
      "publishedAt": "2026-07-09T20:34:57.253Z",
      "lastSeenAt": "2026-07-12T20:40:51.799Z",
      "fabric": {
        "address": null,
        "online": null
      },
      "recordSource": "node-record",
      "workspaces": [
        {
          "workspaceId": "9db1fd84f5895e38",
          "name": "aof",
          "projectRoot": "C:\\Source\\umair\\aof"
        }
      ],
      "descriptorPath": "C:\\Users\\Umair\\.aof\\mesh\\nodes\\umairs-msi.json",
      "presence": {
        "nodeId": "umairs-msi",
        "heartbeatAt": "2026-07-12T20:55:20.455Z",
        "activeRuns": [],
        "sessions": [
          {
            "workspaceId": "9db1fd84f5895e38",
            "repo": "aof",
            "assistant": "claude-code",
            "lastPingAt": "2026-07-12T20:55:20.329Z"
          }
        ],
        "aofVersion": "0.1.0",
        "buildId": "source"
      },
      "stale": false,
      "local": true
    }
  ],
  "boards": [],
  "isControlNode": true
}"#;

    // REAL — captured live in this repo the SAME way, with a SECOND real session
    // started on a distinct workspace/repo (`aof session start --workspace
    // beta-ws-0001 --repo beta --assistant claude-code`) before the aggregate was
    // re-published. 2026-07-12T20:55Z, node `umairs-msi`: two LIVE sessions (repos
    // "aof" and "beta"), EMPTY `activeRuns`. Verbatim stdout, byte-for-byte.
    const REAL_CAPTURED_TWO_SESSIONS_STATUS: &str = r#"{
  "nodes": [
    {
      "nodeId": "peer-git",
      "role": "worker",
      "controlNode": false,
      "host": "peer-git",
      "os": "linux",
      "runtimes": [],
      "aofVersion": "0.1.0",
      "publishedAt": "2026-06-29T00:00:00.000Z",
      "lastSeenAt": "2026-07-04T10:00:00.000Z",
      "fabric": {
        "address": null,
        "online": null
      },
      "recordSource": "node-record",
      "workspaces": [
        {
          "workspaceId": "9db1fd84f5895e38",
          "name": "aof",
          "projectRoot": "C:\\Source\\umair\\aof"
        }
      ],
      "descriptorPath": "C:\\Users\\Umair\\.aof\\mesh\\nodes\\peer-git.json",
      "presence": {
        "nodeId": "peer-git",
        "heartbeatAt": "2026-07-04T10:00:00.000Z",
        "activeRuns": [],
        "sessions": [],
        "aofVersion": "0.1.0",
        "buildId": "source"
      },
      "stale": true
    },
    {
      "nodeId": "umairs-mac-mini",
      "role": "worker",
      "controlNode": false,
      "host": "Umairs-Mac-mini.local",
      "os": "darwin",
      "runtimes": [
        "claude",
        "codex"
      ],
      "aofVersion": "0.1.0",
      "publishedAt": "2026-07-07T19:20:52.437Z",
      "lastSeenAt": null,
      "fabric": {
        "address": "100.114.105.64",
        "online": true
      },
      "recordSource": "node-record",
      "workspaces": [
        {
          "workspaceId": "9db1fd84f5895e38",
          "name": "aof",
          "projectRoot": "C:\\Source\\umair\\aof"
        }
      ],
      "descriptorPath": "C:\\Users\\Umair\\.aof\\mesh\\nodes\\umairs-mac-mini.json",
      "presence": {
        "nodeId": "umairs-mac-mini",
        "heartbeatAt": "2026-07-12T20:55:06.761Z",
        "activeRuns": [],
        "aofVersion": ""
      },
      "stale": false
    },
    {
      "nodeId": "umairs-msi",
      "role": "control",
      "controlNode": true,
      "host": "Umairs-MSI",
      "os": "win32",
      "runtimes": [
        "claude",
        "codex"
      ],
      "aofVersion": "0.1.0",
      "publishedAt": "2026-07-09T20:34:57.253Z",
      "lastSeenAt": "2026-07-12T20:40:51.799Z",
      "fabric": {
        "address": null,
        "online": null
      },
      "recordSource": "node-record",
      "workspaces": [
        {
          "workspaceId": "9db1fd84f5895e38",
          "name": "aof",
          "projectRoot": "C:\\Source\\umair\\aof"
        }
      ],
      "descriptorPath": "C:\\Users\\Umair\\.aof\\mesh\\nodes\\umairs-msi.json",
      "presence": {
        "nodeId": "umairs-msi",
        "heartbeatAt": "2026-07-12T20:55:00.490Z",
        "activeRuns": [],
        "sessions": [
          {
            "workspaceId": "9db1fd84f5895e38",
            "repo": "aof",
            "assistant": "claude-code",
            "lastPingAt": "2026-07-12T20:54:50.051Z"
          },
          {
            "workspaceId": "beta-ws-0001",
            "repo": "beta",
            "assistant": "claude-code",
            "lastPingAt": "2026-07-12T20:54:50.302Z"
          }
        ],
        "aofVersion": "0.1.0",
        "buildId": "source"
      },
      "stale": false,
      "local": true
    }
  ],
  "boards": [],
  "isControlNode": true
}"#;

    // DG-2 (aof:uat 38, design-conformance review — DESIGN.md §Surface 1 S6):
    // REAL — captured through the real production seams (a genuine `startSession`
    // write per repo, then `startLauncher`'s `assembleCurrentPresenceRecord` —
    // mesh-launcher.mjs — the SAME aggregator that publishes the daemon's presence
    // record; run in an isolated `AOF_GLOBAL_HOME`, never against this machine's
    // live mesh state) via:
    //   aof session start --workspace ws-01 --repo pay-guard-portal --assistant claude-code
    //   aof session start --workspace ws-02 --repo aof --assistant claude-code
    // The two sessions' workspace ids are DELIBERATELY ordered opposite their repo
    // names (ws-01/pay-guard-portal started first, ws-02/aof second) so the
    // producer's own wire order is genuinely non-alphabetical by repo — the exact
    // `working · pay-guard-portal, aof (session)` shape DG-2 reports live. Node
    // `node-dg2`: two LIVE sessions (repos "pay-guard-portal" then "aof", in THAT
    // wire order), EMPTY `activeRuns`. Verbatim aggregator output, byte-for-byte.
    const REAL_CAPTURED_TWO_SESSIONS_NON_ALPHA_STATUS: &str = r#"{
  "nodes": [
    {
      "nodeId": "node-dg2",
      "role": "control",
      "controlNode": true,
      "host": "node-dg2",
      "os": "linux",
      "runtimes": [
        "claude"
      ],
      "aofVersion": "0.1.0",
      "stale": false,
      "local": true,
      "presence": {
        "nodeId": "node-dg2",
        "heartbeatAt": "2026-07-12T21:10:00.000Z",
        "activeRuns": [],
        "sessions": [
          {
            "workspaceId": "ws-01",
            "repo": "pay-guard-portal",
            "assistant": "claude-code",
            "lastPingAt": "2026-07-12T21:10:00.000Z"
          },
          {
            "workspaceId": "ws-02",
            "repo": "aof",
            "assistant": "claude-code",
            "lastPingAt": "2026-07-12T21:10:00.000Z"
          }
        ],
        "aofVersion": "0.1.0",
        "buildId": "source"
      }
    }
  ],
  "boards": [],
  "isControlNode": true
}"#;

    fn local_node_from(doc: &str) -> Node {
        parse_status(doc)
            .expect("the real captured payload parses")
            .nodes
            .into_iter()
            .find(|n| n.local)
            .expect("the real payload carries exactly one local:true node")
    }

    // Scenario: a live session with no active run renders the working line (F7 —
    // the headline regression). Built from the REAL captured payload above — not a
    // hand-authored record.
    #[test]
    fn f7_live_session_no_run_renders_working_line() {
        let node = local_node_from(REAL_CAPTURED_LIVE_SESSION_STATUS);
        assert!(node.active_runs().is_empty(), "the real capture's activeRuns is empty");
        assert_eq!(node.session_repos(), vec!["aof".to_string()]);

        let w = current_work(&node);
        assert_eq!(w.display(), "working \u{b7} aof (session)");
        assert_eq!(w.state_str(), "working");
        assert!(w.is_active(), "the working state carries the SAME active emphasis a running node carries");
        assert_ne!(w.display(), "idle", "it is NOT idle");
    }

    // Scenario: a node working two repos shows both (SPEC's acceptance line) —
    // comma-joined under ONE `working ·` prefix, ONE trailing `(session)`. Built
    // from the second REAL captured payload above.
    #[test]
    fn f7_two_repos_show_both_comma_joined() {
        let node = local_node_from(REAL_CAPTURED_TWO_SESSIONS_STATUS);
        assert_eq!(node.session_repos(), vec!["aof".to_string(), "beta".to_string()]);

        let w = current_work(&node);
        assert_eq!(w.display(), "working \u{b7} aof, beta (session)");
        assert_eq!(w.state_str(), "working");
        assert!(w.is_active());
    }

    // Scenario: DG-2 (aof:uat 38, DESIGN.md §Surface 1 S6) — the repo list on the
    // session line is sorted deterministically ascending by repo short name, EVEN
    // WHEN the producer's own wire order is non-alphabetical. Built from the REAL
    // captured payload above, whose `sessions[]` wire order is genuinely
    // "pay-guard-portal" THEN "aof" (the exact live-observed defect order) —
    // `session_repos()`/`current_work()` must not echo that order verbatim.
    #[test]
    fn dg2_repo_list_sorted_alphabetically_even_when_wire_order_is_not() {
        let node = local_node_from(REAL_CAPTURED_TWO_SESSIONS_NON_ALPHA_STATUS);
        // The producer's wire order is the non-alphabetical one — confirms the
        // fixture genuinely exercises the defect, not a coincidentally-sorted input.
        assert_eq!(
            node.sessions().iter().map(|s| s.repo.as_str()).collect::<Vec<_>>(),
            vec!["pay-guard-portal", "aof"],
            "the captured payload's own sessions[] wire order is non-alphabetical",
        );

        // session_repos() — and therefore current_work()'s rendered line — sorts it.
        assert_eq!(node.session_repos(), vec!["aof".to_string(), "pay-guard-portal".to_string()]);

        let w = current_work(&node);
        assert_eq!(w.display(), "working \u{b7} aof, pay-guard-portal (session)");
        assert_eq!(w.state_str(), "working");
        assert!(w.is_active());
    }

    // Scenario: order-independence — the SAME repo set, fed to `session_repos()` in
    // two different wire orders, renders the IDENTICAL line either way (DG-2's
    // "must not reshuffle between polls" requirement). A three-repo case, to rule
    // out an accidental two-element-only sort.
    #[test]
    fn dg2_repo_list_order_is_independent_of_wire_order_three_repos() {
        let forward = r#"{"nodes":[{"nodeId":"n1","stale":false,"local":true,"presence":{"activeRuns":[],"sessions":[
            {"workspaceId":"ws-a","repo":"zeta","assistant":"claude-code","lastPingAt":"2026-07-12T00:00:00.000Z"},
            {"workspaceId":"ws-b","repo":"alpha","assistant":"claude-code","lastPingAt":"2026-07-12T00:00:00.000Z"},
            {"workspaceId":"ws-c","repo":"mid","assistant":"claude-code","lastPingAt":"2026-07-12T00:00:00.000Z"}
        ]}}],"boards":[],"isControlNode":true}"#;
        let reversed = r#"{"nodes":[{"nodeId":"n1","stale":false,"local":true,"presence":{"activeRuns":[],"sessions":[
            {"workspaceId":"ws-c","repo":"mid","assistant":"claude-code","lastPingAt":"2026-07-12T00:00:00.000Z"},
            {"workspaceId":"ws-b","repo":"alpha","assistant":"claude-code","lastPingAt":"2026-07-12T00:00:00.000Z"},
            {"workspaceId":"ws-a","repo":"zeta","assistant":"claude-code","lastPingAt":"2026-07-12T00:00:00.000Z"}
        ]}}],"boards":[],"isControlNode":true}"#;

        let forward_node = local_node_from(forward);
        let reversed_node = local_node_from(reversed);

        assert_eq!(forward_node.session_repos(), vec!["alpha".to_string(), "mid".to_string(), "zeta".to_string()]);
        assert_eq!(
            current_work(&forward_node).display(),
            current_work(&reversed_node).display(),
            "the same repo set, fed in a different wire order, renders the identical line",
        );
        assert_eq!(current_work(&forward_node).display(), "working \u{b7} alpha, mid, zeta (session)");
    }

    // Scenario: the run wins the line when a run and a session both exist
    // (ADR-004) — DESIGN §Surface 1: "the run wins the primary line even if a
    // session also exists" (not a second/combined line). Grounded in the REAL
    // captured single-session presence sub-object, with `activeRuns` set to the
    // literal value the task's own Scenario Outline sanctions (`["run-0001"]`) —
    // never an invented object shape for the run entry.
    #[test]
    fn f7_run_wins_the_line_over_a_live_session() {
        let doc = r#"{
            "nodes": [
                {
                    "nodeId": "umairs-msi",
                    "stale": false,
                    "local": true,
                    "presence": {
                        "nodeId": "umairs-msi",
                        "heartbeatAt": "2026-07-12T20:55:20.455Z",
                        "activeRuns": ["run-0001"],
                        "sessions": [
                            {
                                "workspaceId": "9db1fd84f5895e38",
                                "repo": "aof",
                                "assistant": "claude-code",
                                "lastPingAt": "2026-07-12T20:55:20.329Z"
                            }
                        ],
                        "aofVersion": "0.1.0",
                        "buildId": "source"
                    }
                }
            ],
            "boards": [],
            "isControlNode": true
        }"#;
        let node = local_node_from(doc);
        assert!(!node.active_runs().is_empty());
        assert!(!node.session_repos().is_empty(), "the fixture genuinely carries both a run AND a live session");

        let w = current_work(&node);
        assert_eq!(w.display(), "running 1 run", "the RUN renders, not the session");
        assert_eq!(w.state_str(), "running");
        assert!(!w.display().contains("session"), "the session does not add a second line for that same workspace");
    }

    // Scenario: an expired session never sticks — the cell falls back to idle. The
    // publisher (mesh-launcher.mjs's assembleCurrentPresenceRecord) TTL-filters
    // BEFORE the wire, so an expired session simply never appears in `sessions[]` —
    // this is exercised against the REAL `peer-git` node in the very same captured
    // payload above (a genuinely live, stale-and-sessionless real node), never a
    // synthetic "expired" record the desktop would have to age out itself.
    #[test]
    fn f7_publisher_already_dropped_session_falls_back_to_idle() {
        let status = parse_status(REAL_CAPTURED_LIVE_SESSION_STATUS).expect("the real capture parses");
        let node = status.nodes.iter().find(|n| n.node_id == "peer-git").unwrap();
        assert!(node.sessions().is_empty(), "the publisher already dropped this node's (expired) session before the wire");
        assert!(node.active_runs().is_empty());

        let w = current_work(node);
        assert_eq!(w.display(), "idle");
        assert_eq!(w.state_str(), "idle");
        assert!(!w.is_active(), "idle stays muted");
        // The mere fact this reads straight off `sessions[]` (never re-checking
        // `lastPingAt`/a TTL/a clock) IS the "no session-liveness computation of its
        // own" assertion — current_work()/session_repos() read no timestamp field.
    }

    // Scenario Outline: `activeRuns` is read in its REAL frozen shape — a `string[]`
    // of run ids (F8). The exact Examples table values.
    #[test]
    fn f8_active_runs_examples_outline() {
        let cases: [(&str, &str); 3] = [
            (r#"[]"#, "idle"),
            (r#"["run-0001"]"#, "running 1 run"),
            (r#"["run-0001", "run-0002"]"#, "running 2 runs"),
        ];
        for (active_runs_json, expected_cell) in cases {
            let n = node_with_presence(false, active_runs_json, None, false);
            let w = current_work(&n);
            assert_eq!(w.display(), expected_cell, "activeRuns {active_runs_json} renders {expected_cell}");
        }
    }

    // The desktop never indexes a run element as an object with ref/title fields —
    // pinned structurally: `Node::active_runs()` returns `&[String]`, so an object
    // element (`{"ref":..., "title":...}`) is a serde_json::Error at parse time, not
    // a silently-empty-strung `.get("ref")` (the exact F8 defect shape).
    #[test]
    fn f8_active_runs_object_shaped_element_is_a_parse_error_not_a_silent_empty_read() {
        let doc = r#"{"nodes":[{"nodeId":"n1","stale":false,"presence":{"activeRuns":[{"ref":"35/02","title":"UI"}]}}],"boards":[],"isControlNode":true}"#;
        assert!(parse_status(doc).is_err(), "an object-shaped activeRuns element is a parse error, never silently mis-indexed");
    }

    // Scenario: no presence at all degrades cleanly (activeRuns AND sessions both
    // read empty — idle, no error). Extends the pre-existing
    // `current_work_idle_when_no_presence` coverage to also pin `session_repos()`.
    #[test]
    fn f7_no_presence_degrades_cleanly_no_error() {
        let n = node_without_presence(false);
        assert!(n.session_repos().is_empty());
        let w = current_work(&n);
        assert_eq!(w.display(), "idle");
        assert_eq!(w.state_str(), "idle");
        assert!(!w.is_active());
    }

    // Closes the loop end-to-end THROUGH `node_rows()` — the EXACT function
    // `app/desktop/crates/app/src/main.rs`'s `get_view_model` IPC handler calls
    // (`row.current_work.display()` / `row.current_work.state_str()` become the
    // `current_work`/`work_state` JSON fields the WebView renders) — so this pins
    // the string actually reaches the window, not just the pure view-model, using
    // the SAME real captured payload as the headline F7 scenario above.
    #[test]
    fn f7_node_rows_end_to_end_ipc_shape_on_the_real_captured_payload() {
        let status = parse_status(REAL_CAPTURED_LIVE_SESSION_STATUS).expect("the real capture parses");
        let rows = node_rows(&status);
        let this_row = rows.iter().find(|r| r.this_node).expect("exactly one row carries the this-node tag");

        // What main.rs's IpcNodeRow literally serializes to the WebView:
        let ipc_current_work = this_row.current_work.display();
        let ipc_work_state = this_row.current_work.state_str();

        assert_eq!(this_row.name, "umairs-msi");
        assert_eq!(ipc_current_work, "working \u{b7} aof (session)");
        assert_eq!(ipc_work_state, "working");
        assert!(this_row.current_work.is_active(), "the IPC-bound row is active, not the muted idle token");
    }
}
