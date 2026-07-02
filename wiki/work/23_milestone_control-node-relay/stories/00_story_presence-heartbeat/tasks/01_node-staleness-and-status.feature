@cli @work @distribution @executable
Feature: mesh:status renders each node's presence with a stale flag, reusing milestone 20's isStale shape over injected time
  In order to see at a glance which fleet nodes are live and which have gone quiet, purely over git
  the mesh:status command is extended to render every node's presence record alongside a stale flag computed by milestone 20's isStale shape (now − heartbeatAt > threshold, strict >, UTC-Z),
  so that a fresh heartbeat reads live, an aged one reads stale, a node AT the threshold is still live, a node with no presence reads as no-presence (not an error), and the whole read mutates nothing — one staleness definition shared with the run layer, not a parallel heartbeat.

  # ARCHITECTURE ADR-002: the node-staleness predicate is milestone 20's isStale shape
  # (src/run-store.mjs ~378-386 — strict `>`, UTC-Z Date.parse) applied to the presence
  # record's heartbeatAt, so the run layer (m20) and node layer (m23) share ONE staleness
  # definition. mesh:status lives in src/commands/mesh-identity.mjs; this task EXTENDS its
  # render to carry presence + the stale flag. This feature asserts the OBSERVABLE
  # staleness boundary + the extended --json shape, driving `now` and `heartbeatAt` as
  # INJECTED values (white-box over the staleness inputs — never wall-clock, the 22/R2
  # discipline). The reuse-not-duplicate of isStale is itself an inherited seam (asserted
  # by sharing the shape); status is a PURE READ (R4). The over-git peer render is task 02
  # (@manual). No relay (story 01 is parallel).
  #
  # QA FEASIBILITY FLAG — RESOLVED (developer-amigo seat, Contract). ADR-002 fixes the stale
  # rule for a node that HAS a presence record (strict `>` on heartbeatAt) and says a node with
  # NO presence record reads as "no-presence (not an error)" — but it did NOT fix the stale
  # flag's value for a never-beat node. LOCKED post-rule value: `isStale` applies ONLY to a node
  # that HAS a heartbeatAt; a never-beat node has nothing to compare, so it is NOT asserted stale
  # — it is "no-presence / unknown liveness", a state DISTINCT from a node that beat and then
  # aged out. The flag is resolved to reading (b): presence is absent AND `stale` is false (you
  # can only be stale once you have beat; "stale" is reserved for a heartbeat that exists and has
  # aged past the threshold, never an absence). The no-presence scenario below now asserts that
  # locked value (the 22/R2 "get the boundary literal right" discipline); see STORY.md ## Notes.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And mesh:status accepts an injected "now" and reads injected presence records (white-box over the staleness inputs)

  # The load-bearing staleness boundary — the milestone-20 isStale strict `>` shape applied
  # to heartbeatAt. With the threshold at 60s and now fixed: a heartbeat YOUNGER than the
  # threshold is live; OLDER is stale; EXACTLY AT the threshold is STILL LIVE (strict `>`,
  # so age == threshold is NOT stale). The AT-threshold row is load-bearing — the Examples
  # literal MUST agree with the post-rule value here (the 22/R2 lesson): age 60 at threshold
  # 60 is "live" (stale false), because 60 > 60 is false.
  # Each "age" is now − heartbeatAt in seconds, with the threshold (stalenessSeconds) fixed
  # at 60.
  Scenario Outline: mesh:status flags a node stale only when now − heartbeatAt strictly exceeds the threshold
    Given the staleness threshold is 60 seconds
    And a node "node-x" whose presence heartbeatAt is <age> seconds before the injected now
    When I invoke mesh:status with that injected now
    Then "node-x" is rendered with presence
    And "node-x" stale is <stale>

    Examples:
      | age | stale |
      | 0   | false |
      | 30  | false |
      | 59  | false |
      | 60  | false |
      | 61  | true  |
      | 600 | true  |

  # The threshold comes from config.mesh.presence.stalenessSeconds, a DOCUMENTED default.
  # An absent or malformed value falls back to the default (it does not error and does not
  # flag everything stale): with the default in force, a heartbeat younger than the default
  # reads live.
  Scenario Outline: an absent or malformed stalenessSeconds falls back to the documented default
    Given config.mesh.presence.stalenessSeconds is <configured>
    And a node "node-x" whose presence heartbeatAt is 1 second before the injected now
    When I invoke mesh:status with that injected now
    Then no error is raised
    And the staleness threshold in force is the documented default
    And "node-x" stale is false

    Examples:
      | configured        |
      | absent (unset)    |
      | "not-a-number"    |
      | a negative number |
      | null              |

  # A node that HAS a node record but NO presence record reads as no-presence — not an
  # error, and not an implicit error-state. The node still appears in the roster with an
  # absent presence. The never-beat node's stale literal is LOCKED here (the QA FEASIBILITY
  # FLAG above, resolved): a never-beat node is "no-presence / unknown liveness", NOT stale —
  # `isStale` applies only once a heartbeatAt exists, so the locked value is stale false.
  Scenario: a node with a node record but no presence record reads as no-presence and not stale, not an error
    Given a node "node-x" with a node record but no presence record
    When I invoke mesh:status with an injected now
    Then "node-x" appears in the roster
    And "node-x" has no presence (presence is absent, not an error)
    And "node-x" stale is false (a never-beat node is unknown liveness, not stale)
    And no error is raised

  # An empty roster reads as empty, not an error — a freshly initialised node that has
  # synced no peers and published no presence still answers cleanly.
  Scenario: mesh:status on an empty roster returns an empty list, not an error
    Given the partition root has no node records and no presence records yet
    When I invoke mesh:status with an injected now
    Then the result is an empty node list
    And the --json result is the stable { nodes: [] } shape
    And no error is raised

  # The extended --json shape: each node carries its id, its presence (when present), and
  # the stale flag — a stable, pinned shape a peer / a board can read.
  # R4: pin the UNAFFECTED side — status is a PURE read; the partition root is byte-unchanged
  # after the call (rendering presence + staleness writes nothing).
  Scenario: mesh:status renders a stable --json shape carrying each node's presence and stale flag, and writes nothing
    Given a node "node-live" with a fresh presence heartbeat (well within the threshold)
    And a node "node-stale" whose presence heartbeatAt is well past the threshold
    And a node "node-bare" with a node record but no presence record
    And I record the partition root's on-disk state
    When I invoke mesh:status with an injected now
    Then the --json result is the stable { nodes: [ { nodeId, presence?, stale } ] } shape
    And "node-live" carries its presence and stale false
    And "node-stale" carries its presence and stale true
    And "node-bare" carries no presence and stale false (no-presence / unknown liveness, not stale)
    And the result lists exactly those three node ids (no extras, none dropped)
    And the partition root's on-disk state is byte-unchanged (status is a pure read)
