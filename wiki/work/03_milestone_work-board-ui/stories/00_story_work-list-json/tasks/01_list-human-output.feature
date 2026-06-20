@cli @work @work-stream @executable
Feature: aof work list prints a readable hierarchical view of the work stream
  In order to read the state of the stream in a terminal without parsing JSON
  the command with no flag must print a depth-indented listing of ref, type, status, and title,
  so an operator sees the milestone → story → task shape at a glance, consistent with the other aof work commands.

  # The same fixture stream as the JSON contract — a milestone, its stories, and a
  # top-level uat session — but here read by a human in a terminal. The human form
  # and the JSON form are two renderings of the one underlying stream.
  Background:
    Given a work-stream fixture containing:
      | ref   | type      | status      | title              |
      | 03    | milestone | in-progress | Work Board UI      |
      | 03/00 | story     | done        | work list --json   |
      | 03/01 | story     | in-progress | The work board     |
      | 04    | uat       | not-started | Acceptance session |
    And I am positioned to run the aof CLI against that fixture

  # The headline human view: no flag, a readable listing. Each line carries the four
  # things an operator scans for — the ref, the kind, the derived status, the title —
  # in a form consistent with `aof work find` / `aof work next` (which already print
  # ref · type · status · slug rows). This is plain text, not JSON.
  Scenario: with no flag the command prints a readable listing of the stream
    When I run "aof work list"
    Then the command exits 0
    And the output is human-readable text, not JSON
    And every item in the stream appears as a line reporting its ref, type, status, and title

  # The tree is conveyed by indentation: a story sits visibly under its milestone,
  # so the reader sees the hierarchy without reassembling it. Depth-0 drivers sit
  # flush; nested items are indented beneath their parent.
  Scenario: the listing is indented by depth so the hierarchy reads at a glance
    When I run "aof work list"
    Then the milestone "03" appears at the top depth, un-indented
    And the stories "03/00" and "03/01" appear indented beneath it
    And the uat session "04" appears at the top depth, un-indented

  # A scope ref narrows the listing to one subtree. `aof work list 03` shows the
  # milestone and its stories only; items outside that subtree are omitted. This
  # mirrors how `aof work next 03` / `aof work validate 03` already take a scope ref.
  Scenario: a scope ref lists only that subtree
    When I run "aof work list 03"
    Then the command exits 0
    And the milestone "03" and its stories "03/00" and "03/01" appear
    And the uat session "04" does not appear

  # Scoping to a single depth-0 driver that owns no children lists just that item.
  Scenario: scoping to a leaf driver lists only that item
    When I run "aof work list 04"
    Then the command exits 0
    And the uat session "04" appears
    And the milestone "03" and its stories do not appear

  # Scoped vs unscoped, enumerated: the scope ref selects exactly which refs are in
  # the listing. The unscoped run is the whole stream; a scoped run is the named
  # subtree.
  Scenario Outline: the scope argument selects which items the listing includes
    When I run "aof work list <scope>"
    Then the listed refs are exactly "<included>"

    Examples:
      | scope | included              |
      |       | 03, 03/00, 03/01, 04  |
      | 03    | 03, 03/00, 03/01      |
      | 04    | 04                    |

  # The two renderings are mutually exclusive views of the same data: --json is
  # machine output, the bare command is the human view. The data is identical; only
  # the presentation differs. A run is one or the other, never a blend (no JSON
  # smuggled into the human view, no human chrome smuggled into the JSON).
  Scenario: --json and the bare command render the same data two ways
    When I run "aof work list"
    And I run "aof work list --json"
    Then the human run and the JSON run cover the same set of items
    And the human run prints indented text and the JSON run prints a parseable array
    And neither run mixes the other's presentation

  # A scope that matches nothing is an empty listing, not an error: exit 0 with a
  # plain "nothing in scope" line, consistent with how the other work commands
  # report an empty result rather than throwing.
  Scenario: a scope ref matching no item produces an empty listing, not an error
    When I run "aof work list 99"
    Then the command exits 0
    And the output reports that nothing falls in that scope
    And no item lines are printed
