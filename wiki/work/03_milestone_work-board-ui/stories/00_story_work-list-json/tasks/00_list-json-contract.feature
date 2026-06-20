@cli @work @work-stream @executable
Feature: aof work list --json emits the whole work stream as one machine-readable array
  In order to give the work board (and any other consumer) a single stable data source
  the command must serialise the entire milestone → story → task stream as pure JSON in one pass,
  so a consumer can JSON.parse stdout directly without scraping the filesystem or per-item docs.

  # The fixture is a small but complete work-stream covering every item type the
  # board renders: a milestone, its stories, and a top-level uat session. Status
  # and title come from each item's record-doc frontmatter; the stream is otherwise
  # enumerated by folder name. This Background is the "real stream" the black-box
  # tester runs the command against.
  Background:
    Given a work-stream fixture containing:
      | ref   | type      | status      | title                  |
      | 03    | milestone | in-progress | Work Board UI          |
      | 03/00 | story     | done        | work list --json       |
      | 03/01 | story     | in-progress | The work board         |
      | 04    | uat       | not-started | Acceptance session     |
    And I am positioned to run the aof CLI against that fixture

  # The headline: stdout is JSON the consumer parses with no preamble. The contract's
  # field set / flat-array / parent-resolves invariant is owned by the
  # acd-work-list-contract fitness function (ARCHITECTURE ADR-002) — NOT re-asserted
  # here. This scenario asserts only the observable behaviour: parseable JSON, the
  # whole stream present, one element per fixture item.
  Scenario: the command emits the whole stream as a JSON array
    When I run "aof work list --json"
    Then the command exits 0
    And the output is valid JSON that parses to an array
    And the array contains one element for every item in the stream
    And the elements include the milestone, both its stories, and the uat session

  # The m02 --json lesson: no human chrome on stdout. A boundary line, a warning,
  # a "found N items" header, or a trailing tip would break JSON.parse. stdout must
  # be the JSON and nothing else.
  Scenario: stdout is pure JSON with no human chrome interleaved
    When I run "aof work list --json"
    Then the entire stdout parses as JSON in a single pass
    And stdout contains no human boundary, header, warning, or tip lines
    And any human-facing or diagnostic text is kept off stdout

  # Each emitted item carries the data the board renders a row from. The presence
  # and meaning of the fields is the behaviour here; the EXACT seven-field key set
  # (no more, no fewer) is the acd-work-list-contract fitness function, not a
  # scenario. A reader cares that each item self-describes its identity, kind,
  # derived status, title, place in the tree, and on-disk home.
  Scenario: each item carries its identity, derived status, and place in the tree
    When I run "aof work list --json"
    Then each element reports its "ref" identity
    And each element reports its "type"
    And each element reports its derived "status"
    And each element reports its "title"
    And each element reports a "dir" locating the item's folder
    And each element reports a "parent" link to its place in the tree

  # parent is the one tree edge (ADR-002): depth-0 drivers carry no parent; nested
  # items name the ref of the item above them. The board reassembles the hierarchy
  # from these links, so the observable fact is that the links are honest — a
  # nested item's parent names a driver that is itself in the stream.
  Scenario Outline: parent links place each item at its depth in the stream
    When I run "aof work list --json"
    Then the element for "<ref>" reports parent "<parent>"

    Examples:
      | ref   | parent |
      | 03    | none   |
      | 04    | none   |
      | 03/00 | 03     |
      | 03/01 | 03     |

  # Every item type the board knows about appears in the emitted stream, each
  # tagged with its own type so the board can render the right row affordance.
  # This is the "the whole stream, every kind" guarantee, enumerated by type.
  Scenario Outline: every item type in the stream is emitted with its type
    When I run "aof work list --json"
    Then an element exists for "<ref>" with type "<type>"

    Examples:
      | ref   | type      |
      | 03    | milestone |
      | 03/00 | story     |
      | 03/01 | story     |
      | 04    | uat       |

  # Determinism: two consecutive runs over an unchanged stream produce byte-identical
  # JSON. The board (and snapshot tests) depend on a stable order — items do not
  # reshuffle between reads.
  Scenario: the emitted order is stable across runs
    When I run "aof work list --json"
    And I run "aof work list --json" again
    Then both runs produce byte-identical JSON output

  # The empty stream is a valid stream, not an error: an empty array, exit 0.
  # A consumer pointed at a fresh repo gets "[]" to parse, never a crash or a
  # diagnostic on stdout.
  Scenario: an empty work-stream yields an empty JSON array
    Given a work-stream fixture containing no items
    When I run "aof work list --json"
    Then the command exits 0
    And the output is valid JSON that parses to an empty array
