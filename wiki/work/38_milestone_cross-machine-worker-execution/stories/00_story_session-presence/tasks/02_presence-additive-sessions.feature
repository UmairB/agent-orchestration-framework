@executable @cli @work @distribution
Feature: The presence record gains an additive `sessions` key without breaking the frozen m23 byte-equivalence
  In order that a node can report a live session WITHOUT regressing any of the nine consumers that read the
  FROZEN m23 presence record, the record grows to exactly FIVE keys — `sessions` inserted before `aofVersion` —
  and a node with no live session emits `sessions: []`, keeping its first four keys byte-identical to before.

  # ARCHITECTURE 38/ADR-001. The m23 record is FROZEN: { nodeId, heartbeatAt, activeRuns, aofVersion }, key
  # order load-bearing, byte-equivalence asserted (mesh-presence.mjs:75). This ADR re-freezes at FIVE:
  # { nodeId, heartbeatAt, activeRuns, sessions, aofVersion } — the four m23 keys keep their relative order,
  # `sessions` groups with the run/session liveness pair before the trailing provenance string. Absent-is-
  # benign: no live session → `sessions: []` (present, empty), NOT omitted, so the shape is stable and a no-
  # session record's FIRST FOUR keys are byte-identical to an m23 record. Each sessions[i] is the DERIVED
  # projection { workspaceId, repo, assistant, lastPingAt } over the live (non-expired, ADR-002) session
  # records — presence reads-but-never-mutates session state (the activeRuns discipline). The write seam is
  # unchanged (presenceRecordPath + atomic writeText — acd-presence-write-scope). STRUCTURAL: the five-key
  # order + no-session byte-equivalence → acd-session-presence-additive.
  #
  # @qa: complete the Examples — no-session (sessions:[], first four keys byte-identical to m23), one session,
  # multiple sessions across workspaces, an expired session is ABSENT from the array (ties to ADR-002/task 01),
  # key-order is exactly the frozen five, the record is rebuildable (same inputs → content-equivalent).

  Background:
    Given a node assembling its presence record with an injected clock

  Scenario: a node with no live session emits sessions:[] and its first four keys are byte-identical to m23
    Given the node has no live sessions
    Then the presence record's keys are exactly nodeId, heartbeatAt, activeRuns, sessions, aofVersion in order
    And `sessions` is the empty array
    And the record's nodeId, heartbeatAt, activeRuns, aofVersion are byte-identical to the m23 four-key record

  Scenario: a live session projects into the sessions array as { workspaceId, repo, assistant, lastPingAt }
    # @qa: one live session → one entry with exactly those keys, derived from the live session record.
    Given one live session record { workspaceId: ws-1, repo: my-repo, assistant: claude-code, lastPingAt: T }
    When the node assembles its presence record
    Then sessions has exactly one entry
    And that entry's keys are exactly workspaceId, repo, assistant, lastPingAt in that order
    And that entry is { workspaceId: ws-1, repo: my-repo, assistant: claude-code, lastPingAt: T }
    And the source session record was read but not mutated (presence is not a second authority)

  Scenario Outline: the sessions array is the projection of the LIVE session records only, key-order held
    # every row asserts: (a) sessions holds exactly the live records projected, (b) an expired record is absent
    # (TTL-filtered by isStale, ADR-002/task 01), (c) the five-key order is unchanged, (d) the first four keys
    # stay byte-identical to m23 when — and only when — sessions is []. `now` is injected so liveness is exact.
    Given the node's session records are <records>
    And the injected clock places <live-count> of them within the TTL and the rest past it
    When the node assembles its presence record
    Then sessions has exactly <live-count> entries
    And sessions contains exactly the live workspaces <live-workspaces>
    And no expired session appears in the array
    And the presence record's keys are exactly nodeId, heartbeatAt, activeRuns, sessions, aofVersion in order
    And the first-four-keys byte-equivalence to m23 holds iff sessions is <byte-equivalent>

    Examples:
      | records                                              | live-count | live-workspaces | byte-equivalent |
      | (none)                                               | 0          | (none)          | []              |
      | ws-1 live                                            | 1          | ws-1            | not []          |
      | ws-1 live, ws-2 live                                 | 2          | ws-1, ws-2      | not []          |
      | ws-1 live, ws-2 live (two assistants)                | 2          | ws-1, ws-2      | not []          |
      | ws-1 live, ws-2 EXPIRED                              | 1          | ws-1            | not []          |
      | ws-1 EXPIRED                                         | 0          | (none)          | []              |
      | ws-1 EXPIRED, ws-2 EXPIRED                           | 0          | (none)          | []              |

  Scenario: the record is rebuildable — same clock + run records + session records yield a content-equivalent record
    # ADR-001 rebuildability: presence is a PURE projection, not authored state. Dropping and re-assembling
    # from the identical inputs must produce a content-equivalent record (the derived discipline).
    Given a fixed injected clock, a fixed set of run records, and a fixed set of live session records
    When the node assembles its presence record twice from those identical inputs
    Then the two records are content-equivalent (same five keys, same order, same values)
