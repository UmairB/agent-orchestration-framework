//! Task 01 — `mesh status --json` deserialization, the CORRECTED shape (ARCHITECTURE
//! 36/ADR-004 decisions 1-2, RESEARCH §3), extended by milestone 38's ADR-001 fifth
//! key.
//!
//! `{ nodes: [...], boards: [...], isControlNode }` — TWO arrays plus a scalar flag.
//! `activeRuns`/`sessions`/`aofVersion` live NESTED under each node's OPTIONAL
//! `presence` object (a node with no heartbeat omits `presence` entirely and reads
//! unknown/idle, WITHOUT panicking on the missing key). The "this is me" marker is
//! `node.local: true` (boolean, present ONLY on this node's own entry, omitted
//! everywhere else — never a top-level `localId` string). `node.stale` is an
//! independent boolean.
//!
//! **F8 fix (finding, aof:verify 38):** `activeRuns` is the FROZEN m23 `string[]` of
//! bare run ids (23/ADR-002) — NEVER an array of `{ ref, title }` objects. It is typed
//! here as `Vec<String>` so an object-shaped element is a genuine deserialize error,
//! not a silently-mis-indexed `serde_json::Value`.
//!
//! **F7 fix:** `sessions` (38/ADR-001, the additive fifth presence key) is a
//! `Vec<Session>`, each `{ workspaceId, repo, assistant, lastPingAt }` — already
//! TTL-filtered and run-subsumed by the publisher (ADR-002/ADR-004) before it ever
//! reaches this deserializer; this module performs NO liveness recomputation.
//!
//! This is the app's ONLY fleet-data source (ADR-004 d1-2) — no git/store/socket
//! crate anywhere; the poll spawns `aof mesh status --json` and deserializes its
//! stdout with this module.

use serde::Deserialize;

/// One live coding-assistant session (38/ADR-001) — a projection, never an authority:
/// `workspaceId` (the join key), `repo` (the human label the fleet line renders),
/// `assistant` (which tool), `lastPingAt` (the liveness stamp, read-only here — the
/// publisher already TTL-filtered before the wire).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(default)]
    pub workspace_id: String,
    #[serde(default)]
    pub repo: String,
    #[serde(default)]
    pub assistant: String,
    #[serde(default)]
    pub last_ping_at: String,
}

/// Presence, nested under a node — OMITTED entirely when the node has no heartbeat
/// (RESEARCH §3). `activeRuns`/`sessions`/`aofVersion` live HERE, never flattened
/// onto the node.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub heartbeat_at: Option<String>,
    /// The FROZEN m23 shape (23/ADR-002): a bare `string[]` of run ids — NEVER
    /// `{ ref, title }` objects (F8). `#[serde(default)]` so a node whose presence
    /// predates 38/ADR-001 (no `sessions` key) still parses.
    #[serde(default)]
    pub active_runs: Vec<String>,
    /// 38/ADR-001's additive fifth key. `#[serde(default)]` because an older/peer
    /// presence record (pre-milestone-38) omits the key entirely — absence reads as
    /// "no live sessions", never a parse failure.
    #[serde(default)]
    pub sessions: Vec<Session>,
    #[serde(default)]
    pub aof_version: Option<String>,
}

/// One node's entry in `mesh status --json`'s `nodes[]` array. Only the fields this
/// app's role/view logic reads are modeled explicitly; anything else in the document
/// is ignored by serde's default "unknown fields are skipped" behaviour — the app
/// stays forward-compatible with fields RESEARCH §3 notes the live schema also
/// carries (`role`, `fabric`, `workspaces`, …) without needing to model them.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub node_id: String,
    /// `true` on EXACTLY this node's own entry, omitted (defaults false) elsewhere —
    /// a per-node boolean, never a top-level id string (RESEARCH §3).
    #[serde(default)]
    pub local: bool,
    /// A liveness flag, independent of whether `presence` is present.
    pub stale: bool,
    /// OPTIONAL — omitted entirely when the node has no heartbeat. Deserialization
    /// must not panic on the missing key.
    #[serde(default)]
    pub presence: Option<Presence>,
}

impl Node {
    /// `activeRuns`, read through the optional nested `presence` — an absent
    /// `presence` reads as "unknown/idle" (empty), never a panic. A `string[]` of run
    /// ids (F8) — never indexed as `{ ref, title }` objects.
    pub fn active_runs(&self) -> &[String] {
        match &self.presence {
            Some(p) => &p.active_runs,
            None => &[],
        }
    }

    /// `sessions`, read through the optional nested `presence` — an absent
    /// `presence` reads as "no live sessions" (empty), never a panic (F7).
    pub fn sessions(&self) -> &[Session] {
        match &self.presence {
            Some(p) => &p.sessions,
            None => &[],
        }
    }

    /// The repos named by this node's LIVE sessions, non-empty only, sorted
    /// deterministically ascending by repo short name (DESIGN.md §Surface 1 S6,
    /// DG-2) — a plain codepoint/byte-wise `sort()`, NOT a locale-sensitive
    /// collation, so this agrees byte-for-byte with `ui/src/fleet/runs.mjs`'s
    /// `fleetCurrentWorkLines` (`sessions.map(s => s.repo).filter(...).sort(...)`).
    /// Sorted AFTER filtering, so both projections agree on the exact same list.
    /// Performs NO liveness recomputation — the publisher already
    /// TTL-filtered/subsumed `sessions[]` before the wire (F7).
    pub fn session_repos(&self) -> Vec<String> {
        let mut repos: Vec<String> = self
            .sessions()
            .iter()
            .map(|s| s.repo.clone())
            .filter(|repo| !repo.is_empty())
            .collect();
        repos.sort();
        repos
    }

    /// Whether `activeRuns` is knowable at all (a node WITH presence carries it,
    /// even if empty; a node with NO presence has no runs data — "unknown", not
    /// "known-empty"). Kept distinct from `active_runs().is_empty()` for callers
    /// that need to render "idle" vs "unknown" differently.
    pub fn has_presence(&self) -> bool {
        self.presence.is_some()
    }

    /// The reported `aofVersion`, nested under presence — `None` ("unknown") when
    /// presence is absent, matching the Background's "unknown / idle" expectation.
    pub fn reported_aof_version(&self) -> Option<&str> {
        self.presence.as_ref().and_then(|p| p.aof_version.as_deref())
    }
}

/// The document root: `{ nodes, boards, isControlNode }` — TWO arrays plus a scalar
/// flag, never a flatter single-array shape.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshStatus {
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub boards: Vec<serde_json::Value>,
    pub is_control_node: bool,
}

impl MeshStatus {
    /// The node marked `local: true`, if exactly one exists (the normal case —
    /// `local` is present on exactly one node's own entry).
    pub fn local_node(&self) -> Option<&Node> {
        self.nodes.iter().find(|n| n.local)
    }

    /// `isControlNode`, exposed as the role signal the supervision set (task 02) is
    /// driven off — ONE data command feeds both the fleet view and the role
    /// decision (ADR-004 d1-2 / ADR-002 d1).
    pub fn is_control_node(&self) -> bool {
        self.is_control_node
    }
}

/// Parse a `mesh status --json` document. Returns a `serde_json::Error` on a
/// genuinely malformed document (e.g. missing `nodes`/`isControlNode`) — but never
/// panics on a node that simply omits `presence`.
pub fn parse_status(json: &str) -> Result<MeshStatus, serde_json::Error> {
    serde_json::from_str(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Scenario Outline: a node deserializes activeRuns and aofVersion from its
    // optional nested presence, or reads idle when presence is absent.
    //
    // F8 fix: `activeRuns` is the FROZEN m23 `string[]` of bare run ids — NEVER
    // `{ ref, title }` objects (the exact shape the producer never emits, and the
    // one the pre-fix `current_work()` wrongly assumed).
    #[test]
    fn node_with_presence_reads_nested_active_runs_and_aof_version() {
        let doc = r#"{
            "nodes": [
                {
                    "nodeId": "umairs-mac-mini",
                    "stale": false,
                    "presence": {
                        "nodeId": "umairs-mac-mini",
                        "heartbeatAt": "2026-07-09T10:42:38.557Z",
                        "activeRuns": ["run-0001"],
                        "sessions": [],
                        "aofVersion": "0.1.0"
                    }
                }
            ],
            "boards": [],
            "isControlNode": true
        }"#;
        let status = parse_status(doc).expect("parses the corrected shape");
        let node = &status.nodes[0];
        assert!(node.has_presence(), "the node carries a presence object");
        assert_eq!(node.active_runs().len(), 1, "activeRuns reads the nested runs");
        assert_eq!(node.active_runs()[0], "run-0001", "activeRuns holds bare run-id strings, never objects");
        assert_eq!(node.reported_aof_version(), Some("0.1.0"), "reported aofVersion reads the nested value");
    }

    // F7 fix: `sessions` (38/ADR-001's additive fifth key) deserializes to the frozen
    // `{ workspaceId, repo, assistant, lastPingAt }` shape, and `session_repos()`
    // projects the live repos in wire order.
    #[test]
    fn node_with_presence_reads_nested_sessions() {
        let doc = r#"{
            "nodes": [
                {
                    "nodeId": "umairs-msi",
                    "stale": false,
                    "local": true,
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
                        "aofVersion": "0.1.0"
                    }
                }
            ],
            "boards": [],
            "isControlNode": true
        }"#;
        let status = parse_status(doc).expect("parses the five-key shape");
        let node = &status.nodes[0];
        assert_eq!(node.sessions().len(), 1, "sessions reads the nested live-session array");
        assert_eq!(node.session_repos(), vec!["aof".to_string()], "session_repos projects the repo label");
    }

    // A node whose presence predates 38/ADR-001 (no `sessions` key at all — a real
    // condition this repo's own live mesh exhibits on an older peer) still parses,
    // reading zero sessions rather than failing the whole document.
    #[test]
    fn node_with_presence_but_no_sessions_key_reads_empty_sessions() {
        let doc = r#"{
            "nodes": [
                {
                    "nodeId": "umairs-mac-mini",
                    "stale": false,
                    "presence": {
                        "nodeId": "umairs-mac-mini",
                        "heartbeatAt": "2026-07-12T20:55:20.729Z",
                        "activeRuns": [],
                        "aofVersion": ""
                    }
                }
            ],
            "boards": [],
            "isControlNode": true
        }"#;
        let status = parse_status(doc).expect("parses a pre-ADR-001 presence record");
        let node = &status.nodes[0];
        assert!(node.sessions().is_empty(), "an omitted sessions key reads as no live sessions, never a parse failure");
        assert!(node.session_repos().is_empty());
    }

    #[test]
    fn node_without_presence_reads_idle_unknown_without_crashing() {
        let doc = r#"{
            "nodes": [
                { "nodeId": "umairs-msi", "stale": true }
            ],
            "boards": [],
            "isControlNode": false
        }"#;
        // The point of the assertion: parsing does not panic/error on the missing key.
        let status = parse_status(doc).expect("parses even when presence is omitted");
        let node = &status.nodes[0];
        assert!(!node.has_presence(), "presence is absent");
        assert!(node.active_runs().is_empty(), "activeRuns reads as unknown/idle (empty), not a crash");
        assert_eq!(node.reported_aof_version(), None, "aofVersion reads as unknown (None)");
    }

    // Scenario: exactly one node is marked local and every other node is not.
    #[test]
    fn exactly_one_node_reads_local_true_the_rest_read_false() {
        let doc = r#"{
            "nodes": [
                { "nodeId": "umairs-mac-mini", "stale": false },
                { "nodeId": "umairs-msi", "stale": true, "local": true }
            ],
            "boards": [],
            "isControlNode": true
        }"#;
        let status = parse_status(doc).unwrap();
        assert!(!status.nodes[0].local, "the first node reads local false (the key is omitted)");
        assert!(status.nodes[1].local, "the second node reads local true");
        let locals: Vec<&Node> = status.nodes.iter().filter(|n| n.local).collect();
        assert_eq!(locals.len(), 1, "exactly one node reads local true");
        assert_eq!(status.local_node().unwrap().node_id, "umairs-msi");
    }

    // Scenario Outline: node.stale deserializes as a boolean on each node.
    #[test]
    fn stale_deserializes_as_boolean_true() {
        let doc = r#"{"nodes":[{"nodeId":"a","stale":true}],"boards":[],"isControlNode":false}"#;
        let status = parse_status(doc).unwrap();
        assert_eq!(status.nodes[0].stale, true);
    }

    #[test]
    fn stale_deserializes_as_boolean_false() {
        let doc = r#"{"nodes":[{"nodeId":"a","stale":false}],"boards":[],"isControlNode":false}"#;
        let status = parse_status(doc).unwrap();
        assert_eq!(status.nodes[0].stale, false);
    }

    // Scenario: the top-level boards array and the isControlNode role flag are
    // parsed at the document root.
    #[test]
    fn top_level_boards_array_and_is_control_node_flag_parse_at_document_root() {
        let doc = r#"{"nodes":[],"boards":[],"isControlNode":true}"#;
        let status = parse_status(doc).unwrap();
        assert_eq!(status.boards.len(), 0, "boards is read as an array at the top level");
        assert_eq!(status.is_control_node(), true, "isControlNode reads true");
        // isControlNode is exposed as the role signal (ADR-002's supervision_set
        // consumes it directly — see supervision.rs task 02 seam).
        assert!(status.is_control_node, "isControlNode is exposed as the role signal");
    }

    #[test]
    fn full_measured_document_shape_parses_end_to_end() {
        // The full corrected shape as measured live against `node ./src/cli.mjs mesh
        // status --json` (RESEARCH §3 / this task's confirmation run) — extra fields
        // the live schema carries (role, fabric, workspaces, descriptorPath, …) are
        // present and must be silently ignored, not rejected.
        let doc = r#"{
          "nodes": [
            {
              "nodeId": "umairs-mac-mini",
              "role": "worker",
              "controlNode": false,
              "host": "Umairs-Mac-mini.local",
              "os": "darwin",
              "runtimes": ["claude", "codex"],
              "aofVersion": "0.1.0",
              "publishedAt": "2026-07-07T19:20:52.437Z",
              "lastSeenAt": null,
              "fabric": { "address": "100.114.105.64", "online": true },
              "recordSource": "node-record",
              "workspaces": [{"workspaceId": "9db1fd84f5895e38", "name": "aof", "projectRoot": "C:\\Source\\umair\\aof"}],
              "descriptorPath": "C:\\Users\\Umair\\.aof\\mesh\\nodes\\umairs-mac-mini.json",
              "presence": { "nodeId": "umairs-mac-mini", "heartbeatAt": "2026-07-09T10:42:38.557Z", "activeRuns": [], "aofVersion": "" },
              "stale": false
            },
            {
              "nodeId": "umairs-msi",
              "role": "control",
              "controlNode": true,
              "stale": true,
              "local": true
            }
          ],
          "boards": [],
          "isControlNode": true
        }"#;
        let status = parse_status(doc).expect("the full measured live shape parses");
        assert_eq!(status.nodes.len(), 2);
        assert_eq!(status.local_node().unwrap().node_id, "umairs-msi");
        assert!(status.nodes[0].has_presence());
        assert!(!status.nodes[1].has_presence());
        assert!(status.is_control_node());
    }
}
