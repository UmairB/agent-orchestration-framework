@cli @work @distribution @executable
Feature: aof mesh status renders the fleet as terminal text — nodes with liveness, boards with run state
  In order to see the whole fleet without opening a browser,
  the aof mesh status human render carries one line per node (its id + the liveness token) and a
  boards section (each board, its owner, its running count),
  so that the CLI mirror shows the same facts the fleet web view renders — two faces of the one
  mesh:status command — and an empty roster reads as an explicit friendly line, never an error.

  # DESIGN surface 2 pins the textual baseline: one line per node — nodeId, then live / stale /
  # no presence (derived from heartbeatAt age vs stalenessSeconds, m23's contract). This task
  # EXTENDS that render with the boards section (a fleet-view enrichment DESIGN left as a
  # task-feature outcome — decided here: the boards render as their own lines under the node
  # roster). The --json face is the machine shape the web surface consumes (task 00 owns its
  # aggregate contract); this task owns the HUMAN text. The liveness boundary itself is m23's
  # (23/00 task 01) — the render consumes the stale flag, it does not recompute it.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And mesh:status accepts an injected "now" and reads the records I plant

  # The headline: the node roster renders one line per node with its liveness token,
  # exactly the DESIGN §2 textual shape.
  # QA: the line literal is m23's LOCKED render (src/commands/mesh-identity.mjs) —
  # `<nodeId> — <token>` with the spaced em-dash separator, tokens exactly
  # live | stale | no presence ("no presence" with the space, never no-presence). The
  # no-presence row also inherits the m23 locked rule: a never-beat node is stale:false
  # (unknown liveness, not stale) — asserted in 23/00 task 01, consumed here unchanged.
  Scenario Outline: each node renders as one line with its liveness token
    Given a node "<node>" whose presence reads as <liveness>
    When I run "aof mesh status"
    Then the render carries the line "<node> — <token>"

    Examples:
      | node       | liveness                        | token       |
      | mac-studio | a fresh heartbeat               | live        |
      | old-laptop | a heartbeat aged past threshold | stale       |
      | new-peer   | no presence record              | no presence |

  # The boards section: each registered board renders with its owner and its running count,
  # after the node roster. The count boundary matters: a quiet board (zero running) is
  # LISTED with its zero, never dropped — and two of the owner's running runs read as two,
  # not a boolean (the task-00 list, mirrored in text). The count is the OWNER's synced
  # presence.activeRuns length (ADR-005 / finding F1) — the fleet-durable run signal.
  Scenario Outline: each registered board renders one line with its owner and its running count
    Given a group registry whose roster admits "node-a" with board "let-shield"
    And "node-a" has a presence record whose activeRuns carries <running> running run ids
    When I run "aof mesh status"
    Then the render carries a boards section after the node roster
    And the boards section carries a "let-shield" line with its owner "node-a"
    And that line carries the running count <running> (a zero-count board is listed, not dropped)

    Examples:
      | running |
      | 0       |
      | 1       |
      | 2       |

  # An empty roster is the explicit friendly line, not an error (the DESIGN §2 baseline,
  # carried forward).
  # QA: the literal is the m23 LOCKED line — "No nodes in the mesh roster." — verified
  # byte-exact against src/commands/mesh-identity.mjs.
  Scenario: an empty roster renders the explicit no-nodes line
    Given the workspace has no node records and no registry
    When I run "aof mesh status"
    Then the render is the line "No nodes in the mesh roster."
    And the exit is clean (an empty fleet is not an error)

  # DEV FEASIBILITY VERDICT (was QA FLAG — empty-roster/boards render interplay): LOCKED.
  # Today cli.render (src/commands/mesh-identity.mjs) early-returns "No nodes in the mesh
  # roster." as the WHOLE render when result.nodes.length === 0. The build RESTRUCTURES the
  # render additively: the render is composed of a NODES half + a BOARDS section. The
  # no-nodes line becomes the NODES-half text (rendered verbatim, byte-identical to m23 —
  # "No nodes in the mesh roster.") and the BOARDS section STILL renders below it whenever
  # boards[] is non-empty (the never-blank discipline, task 02). So with an empty node roster
  # + a populated registry, the render is the no-nodes line THEN the boards section. When
  # BOTH halves are empty (no nodes AND no boards — the pure-empty-fleet scenario above),
  # the render is the no-nodes line alone, byte-identical to m23 (no empty "BOARDS" heading
  # dangling under it). The no-nodes line survives verbatim as the nodes-half text; the
  # scenario below stands as written. Buildable: render(result) branches on nodes.length for
  # the nodes-half text, then appends the boards section iff result.boards?.length.
  Scenario: an empty node roster with a registered board still renders the boards section
    Given the workspace has no node records
    And a group registry whose roster admits "node-b" with board "let-shield"
    When I run "aof mesh status"
    Then the render carries the "No nodes in the mesh roster." line for the nodes half
    And the boards section still lists "let-shield" (an empty node roster never blanks the boards)
    And the exit is clean

  # The --json face passes the extended aggregate through untouched — the machine shape
  # and the human render are two faces of one read.
  Scenario: aof mesh status --json emits the { nodes, boards } aggregate as clean JSON
    Given a populated roster and one registered board
    When I run "aof mesh status --json"
    Then stdout is exactly one parseable JSON document — the { nodes, boards } aggregate
    And no human-render line is mixed into the JSON stream
    And the exit is clean

  # --json purity holds at the empty boundary too: the friendly line is the HUMAN face
  # only — the machine face stays the stable empty aggregate, never prose.
  Scenario: aof mesh status --json on an empty fleet emits the empty aggregate, not the friendly line
    Given the workspace has no node records and no registry
    When I run "aof mesh status --json"
    Then stdout is exactly the parseable { "nodes": [], "boards": [] } aggregate
    And the line "No nodes in the mesh roster." does not appear on stdout
    And the exit is clean
