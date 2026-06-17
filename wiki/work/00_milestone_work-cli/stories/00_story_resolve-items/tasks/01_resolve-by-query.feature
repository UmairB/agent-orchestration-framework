@cli @work @work-stream @executable
Feature: Resolve work items by free-text query
  In order to find an item when I don't know its number
  the system must match a query against item slugs and folder names.

  Background:
    Given a work stream with milestone "00" (slug "foundation") holding nested stories
      "00/00" (slug "alpha") and "00/01" (slug "alpha-two"), and milestone "01" (slug "next")

  Scenario: a slug substring matches the item
    When I run "aof work find found"
    Then milestone "00" (slug "foundation") is among the results

  Scenario: a substring shared by several slugs matches every one of them
    When I run "aof work find alpha"
    Then the matching refs are 00/00, 00/01

  Scenario: a query that matches nothing returns no items
    When I run "aof work find zzz"
    Then no items are returned

  # Slug / folder-name substring matching, hits and misses. A query that is not a
  # bare number or NN/SS pair is matched case-insensitively as a substring against
  # each item's slug and its folder name.
  Scenario Outline: a query matches every item whose slug or folder name contains it
    When I run "aof work find <query>"
    Then the matching refs are <refs>

    Examples: exact slug, slug prefix, and a longer slug
      | query     | refs   |
      | foundation| 00     |
      | found     | 00     |
      | next      | 01     |
      | alpha-two | 00/01  |
      | zzz       | (none) |

    Examples: substring shared across siblings, and a fragment of one sibling
      | query | refs         |
      | alpha | 00/00, 00/01 |
      | two   | 00/01        |

  # The match folds case on both the query and the candidate.
  Scenario Outline: matching is case-insensitive
    When I run "aof work find <query>"
    Then the matching refs are <refs>

    Examples: upper- and mixed-case queries resolve as their lowercase form does
      | query      | refs         |
      | foundation | 00           |
      | FOUNDATION | 00           |
      | Found      | 00           |
      | ALPHA      | 00/00, 00/01 |
      | Alpha      | 00/00, 00/01 |

  # The folder name (NN_type_slug) is part of the candidate text, so the literal
  # type word in every folder is matchable — "milestone" hits both milestones,
  # "story" hits both stories — even though no slug contains those words.
  Scenario Outline: a query against the folder-name type word matches by structure
    When I run "aof work find <query>"
    Then the matching refs are <refs>

    Examples: the type word selects all items of that type
      | query     | refs         |
      | milestone | 00, 01       |
      | story     | 00/00, 00/01 |

  # An empty or whitespace-only query is a degenerate substring: it is contained in
  # every candidate, so the matcher returns the whole stream. (The CLI separately
  # rejects find with no argument at all — that is a usage error, not a query.)
  Scenario Outline: an empty or whitespace query matches the whole stream
    When I run "aof work find <query>"
    Then the matching refs are 00, 00/00, 00/01, 01

    Examples: empty string and blanks
      | query        |
      | ""           |
      | "   "        |
