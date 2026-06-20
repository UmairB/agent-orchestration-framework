@cli @work @round-trip @executable
Feature: the work verbs resolve over the freshly-installed, seeded repo
  In order to prove the install is genuinely usable, not merely present on disk
  aof work find/list must resolve the seeded refs from inside the fresh repo.

  # Black-box throughout: every Then inspects the stdout of an "aof work" verb (the human listing or,
  # preferably, the deterministic --json contract). The seeded refs come from the harness's
  # seedSampleMilestone return value { milestoneRef, storyRefs } (ADR-005) — the scenarios bind to
  # those refs symbolically, never a hard-coded milestone number, so they stay stable against
  # whatever index the fixture seeds at.

  Background:
    Given a fresh isolated repo with the bundle installed and the sample milestone seeded

  # --- list -----------------------------------------------------------------------------------

  # The deterministic contract surface: "list --json" emits a flat array; the seeded milestone and
  # each seeded story appear as elements with exactly the seven contract fields, and each story
  # element's "parent" equals the seeded milestone's ref number (the only tree edge).
  Scenario: list --json emits the seeded milestone and its stories as a flat array
    When "aof work list --json" is run in the repo
    Then the output parses to a JSON array
    And the array has an element whose "ref" equals the seeded milestoneRef and whose "type" equals "milestone"
    And for each seeded storyRef the array has an element with that "ref" whose "type" equals "story"
    And every seeded story element's "parent" equals the seeded milestoneRef's number
    And every element's key set is exactly "ref, type, slug, status, title, parent, dir"

  # The human listing: the seeded milestone prints, and its stories print indented beneath it
  # (depth-first preorder — a milestone immediately followed by its stories).
  Scenario: list shows the seeded milestone with its stories nested under it
    When "aof work list" is run in the repo
    Then the output contains a line for the seeded milestoneRef
    And each seeded storyRef appears on its own indented line after the milestone line

  # --- find -----------------------------------------------------------------------------------

  # find resolves a structured ref to its item. The matrix covers the two ref forms the install
  # must support: a bare milestone number, and a "NN/SS" story ref. Each resolves to exactly the
  # seeded item, with the type/slug/parent the seed declares. <expected-parent> is the milestone
  # ref number for a story, and empty (null) for the milestone itself.
  Scenario Outline: find --json resolves a seeded ref to the seeded item
    When "aof work find" is run on "<ref>" with --json in the repo
    Then the output parses to a JSON array with exactly one element
    And that element's "type" equals "<expected-type>"
    And that element's "slug" equals the seeded slug for "<ref>"
    And that element's "parent" equals "<expected-parent>"

    Examples:
      | ref            | expected-type | expected-parent          |
      | the milestoneRef | milestone   | (null)                   |
      | the first storyRef | story     | the milestoneRef number  |

  # A query that matches nothing resolves to an empty result and a non-zero exit — the install does
  # not invent items.
  Scenario: find on an unseeded ref resolves nothing and exits non-zero
    When "aof work find" is run on "9999" in the repo
    Then no work item is reported
    And the command exits non-zero
