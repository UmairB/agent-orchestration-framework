@cli @work @work-stream @executable
Feature: Resolve a work item by its structured ref
  In order to act on a specific item without hand-globbing the stream
  the system must resolve a folder-index ref to exactly that item and report its record.

  Background:
    Given a work stream with milestone "00" (slug "foundation") holding nested stories
      "00/00" (slug "alpha") and "00/01" (slug "beta"), milestone "01" (slug "next"),
      and a top-level uat session "02" (slug "acceptance")

  Scenario: a bare number resolves the top-level item at that slot
    When I run "aof work find 00"
    Then exactly one item is returned
    And its ref is "00", its type is "milestone", and its slug is "foundation"

  Scenario: a bare number resolves a top-level uat session
    When I run "aof work find 02"
    Then exactly one item is returned
    And its type is "uat" and its slug is "acceptance"

  Scenario: an NN/SS pair resolves the nested story under that milestone
    When I run "aof work find 00/01"
    Then exactly one item is returned
    And its type is "story", its ref is "00/01", and its parent is "00"

  Scenario: a resolved item reports its record fields
    When I run "aof work find 00 --json"
    Then the JSON row carries the keys "ref", "type", "slug", "status", "title", "parent", "dir"

  # Bare-number refs: every top-level slot, hit and miss. A bare number only ever
  # resolves a top-level item (parent is null) — never a nested story.
  Scenario Outline: a bare number resolves the top-level item at that slot
    When I run "aof work find <ref>"
    Then the matching refs are <refs>

    Examples: hits — milestone, milestone, uat session
      | ref | refs |
      | 00  | 00   |
      | 01  | 01   |
      | 02  | 02   |

    Examples: misses — a slot with no top-level item
      | ref | refs   |
      | 03  | (none) |
      | 99  | (none) |

  # Numeric equivalence: NN is parsed as an integer, so any zero-padding that names
  # the same slot resolves the same item ("0" == "00" == "000", "2" == "02").
  Scenario Outline: zero-padding does not change which slot a bare number names
    When I run "aof work find <ref>"
    Then the matching refs are <refs>

    Examples: variant paddings of slot 0
      | ref | refs |
      | 0   | 00   |
      | 00  | 00   |
      | 000 | 00   |

    Examples: variant paddings of slot 2
      | ref | refs |
      | 2   | 02   |
      | 02  | 02   |
      | 002 | 02   |

  # NN/SS pairs: the story at sub-slot SS under milestone NN. The pair branch only
  # ever returns a story; the milestone slot and missing sub-slots return nothing.
  Scenario Outline: an NN/SS pair resolves the nested story under that milestone
    When I run "aof work find <ref>"
    Then the matching refs are <refs>

    Examples: hits — sibling stories under milestone 00
      | ref   | refs  |
      | 00/00 | 00/00 |
      | 00/01 | 00/01 |

    Examples: misses — unknown milestone, unknown sub-slot
      | ref   | refs   |
      | 00/99 | (none) |
      | 99/00 | (none) |
      | 01/00 | (none) |

  # Numeric equivalence applies to both halves of a pair independently.
  Scenario Outline: zero-padding does not change which story a pair names
    When I run "aof work find <ref>"
    Then the matching refs are <refs>

    Examples: paddings that all name story 00 under milestone 00
      | ref     | refs  |
      | 0/0     | 00/00 |
      | 00/0    | 00/00 |
      | 0/00    | 00/00 |
      | 000/000 | 00/00 |
