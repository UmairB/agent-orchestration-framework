@cli @work @distribution @executable
Feature: the registry aggregates ADD-ONLY — admitting a node appends to the roster, registering a board appends with set semantics, revoking appends to revocations, and no mutation rewrites a peer's entry
  In order to keep the group registry an add-only, merge-clean git artifact the single writer never rewrites in place
  the roster / boards / revocation accessors each APPEND — a new node lands after the existing roster, a repeat board is a set no-op, a revocation is an explicit deny record distinct from roster removal — over injected timestamps,
  so that the control node grows the aggregate by appending decisions (never rewriting a peer's byte), the fleet view (m25) reads the full roster / boards / revocations back, and git merges of the single-writer registry stay add-only.

  # ARCHITECTURE ADR-001 (decision 1 + the schema): the registry is the SINGLE-WRITER
  # aggregate the control node owns — admission appends { nodeId, admittedAt, boards } to
  # roster, board registration appends to boards with SET semantics (no dup), revocation
  # appends { nodeId, revokedAt, reason } to revocations (the ADR-004 explicit-deny record,
  # distinct from roster removal). This feature asserts the OBSERVABLE aggregation behaviour
  # — append-order preservation, set-dedup on boards, the coexistence of roster + a
  # revocation, and the add-only R4 property (a mutation leaves every OTHER entry
  # byte-unchanged). The SINGLE-WRITE-SEAM invariant (writeRegistry only, control-node-
  # guarded) is the acd-registry-write-scope ARCH-TEST asserted in task 00, NOT restated
  # here. This feature is a PURE-accessor contract over the aggregate shape; the roster
  # write itself rides task 00's guarded seam.
  #
  # QA FEASIBILITY FLAG (developer-amigo): white-box over the pure roster / boards /
  # revocation accessor functions — a registry value in, a registry value out (no fs, no
  # relay, no git). Every admittedAt / revokedAt is an INJECTED value, NEVER wall-clock (the
  # 22/R2 discipline), so the order-preservation and byte-unchanged assertions are
  # deterministic. Buildable STANDALONE alongside task 00 (the accessors are pure over the
  # aggregate the store persists). Buildable @executable; no feasibility concern RAISED.
  Background:
    Given the mesh-registry roster / boards / revocation accessors (pure functions over a registry value)
    And an empty registry with roster [], boards [], pending [], and revocations []
    And injected admittedAt / revokedAt timestamps I control (never wall-clock)

  # Admitting a node APPENDS { nodeId, admittedAt, boards } to the roster, order-preserving;
  # a second admit of a DIFFERENT node lands AFTER the first, and does not rewrite the first.
  # R4: pin the UNAFFECTED side — after the second admit the first roster entry is
  # byte-unchanged (append, never an in-place rewrite of a peer's entry).
  Scenario: admitting a node appends to the roster order-preserving, a second admit landing after the first unchanged
    Given I admit node "node-a" with admittedAt "2026-07-01T10:00:00Z" and boards ["board-x"]
    When I admit node "node-b" with admittedAt "2026-07-01T10:05:00Z" and boards ["board-y"]
    Then the roster is exactly ["node-a", "node-b"] in that order
    And "node-a" carries admittedAt "2026-07-01T10:00:00Z" and boards ["board-x"] byte-unchanged
    And "node-b" carries admittedAt "2026-07-01T10:05:00Z" and boards ["board-y"]
    And the first roster entry was not rewritten by the second admit (append, never in-place)

  # Registering a board appends with SET semantics — a board already in boards is a no-op,
  # so register A, B, A yields exactly [A, B] (no duplicate). The Examples drive a SEQUENCE
  # of registrations to the resulting set. R4: order of first-appearance is preserved (a set
  # that keeps insertion order — the repeat A does not move A to the end).
  Scenario Outline: registering a board appends with set semantics — a repeat is a no-op, first-appearance order preserved
    Given an empty boards list
    When I register the boards in the sequence <sequence>
    Then the boards list is exactly <boards>
    And no board appears twice (set semantics — a repeat register is a no-op)

    Examples:
      | sequence        | boards       |
      | A               | [A]          |
      | A, B            | [A, B]       |
      | A, B, A         | [A, B]       |
      | A, A, A         | [A]          |
      | A, B, C, B, A   | [A, B, C]    |

  # Appending a revocation adds { nodeId, revokedAt, reason } to revocations. A revocation
  # is an EXPLICIT DENY record — distinct from roster removal — so a node can be present in
  # BOTH the roster (a lingering entry) AND revocations (the deny the auth-gate honours
  # regardless of sync lag, ADR-004). R4: the append to revocations leaves the roster
  # byte-unchanged (revoking appends a deny; roster removal is a separate mutation, task 02's
  # command).
  Scenario: appending a revocation adds to revocations and coexists with the roster, an explicit deny distinct from removal
    Given node "node-a" is on the roster with admittedAt "2026-07-01T10:00:00Z"
    When I append a revocation for "node-a" with revokedAt "2026-07-01T11:00:00Z" and reason "left the fleet"
    Then revocations contains { nodeId "node-a", revokedAt "2026-07-01T11:00:00Z", reason "left the fleet" }
    And "node-a" still appears on the roster (a revocation is an explicit deny record, distinct from roster removal)
    And the roster entry for "node-a" is byte-unchanged by the revocation append

  # The add-only R4 property, stated directly: ANY single mutation (admit / register / revoke)
  # leaves every OTHER entry in the aggregate byte-unchanged — the single-writer append-never-
  # rewrite property that keeps git merges of the registry clean. R4: pin BOTH sides — the
  # NEW entry lands AND every pre-existing entry is byte-identical to before.
  Scenario: an add-only mutation leaves every other entry byte-unchanged
    Given a registry with roster ["node-a", "node-b"], boards ["board-x"], and a revocation for "node-c"
    And I record the on-value bytes of every existing roster, boards, and revocation entry
    When I admit node "node-d" with admittedAt "2026-07-01T12:00:00Z" and boards ["board-x"]
    Then "node-d" is appended to the roster after "node-a" and "node-b"
    And every pre-existing roster, boards, and revocation entry is byte-unchanged
    And nothing was rewritten in place (the single-writer add-only property, git-merge-clean)

  # Reading the aggregate back returns the FULL roster / boards / revocations the fleet view
  # (m25) will render — the accessors read what the writer wrote, in full. R4: the read
  # mutates nothing (a pure read over the aggregate value).
  Scenario: reading the aggregate returns the full roster, boards, and revocations the fleet view will read
    Given a registry with roster ["node-a", "node-b"], boards ["board-x", "board-y"], and a revocation for "node-b"
    When I read the roster, boards, and revocations back
    Then the roster is exactly ["node-a", "node-b"] in order
    And the boards are exactly ["board-x", "board-y"]
    And the revocations contain the deny record for "node-b"
    And the read mutated nothing (a pure read over the aggregate)
