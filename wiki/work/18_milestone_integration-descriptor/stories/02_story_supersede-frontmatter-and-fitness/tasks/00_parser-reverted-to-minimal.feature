@cli @work @validate
Feature: parseFrontmatter is reverted to its pre-m18 minimal shape — no inline-flow-map branch
  In order to de-risk the shared frontmatter parser for all 14 of its importers, now that routing lives in .integrations.json
  the system's parseFrontmatter must parse only scalars, quoted scalars, and inline lists — an inline FLOW MAP
  "{ a: b }" must NO LONGER be parsed into an object but round-trip as a stripped scalar string, while every
  pre-existing frontmatter read (depends lists, identity fields) keeps parsing exactly as before and the real
  work-stream traversals (validate / list / next) are unaffected.

  # ADR-007: revert parseScalarOrCollection (src/work.mjs:138-150) to the pre-m18 minimal reader — DROP the
  # inline-flow-map "{}" branch. work.mjs is the GOD-NODE (14 importers); this is the highest-blast-radius cut
  # and is safe ONLY because stories 00+01 made the descriptor the sole routing source (nothing reads
  # notion.parent from frontmatter anymore). The comment at :146-148 already documents the fallback: a
  # brace-wrapped value with no parsed object round-trips as the stripped string.
  #
  # OBSERVABLE behaviours of the parser + the live traversals over fixtures — @executable. STRUCTURAL — "the
  # "{}" flow-map branch is absent from parseScalarOrCollection" is FF-B (an arch-test authored in this story),
  # NOT a Then here. Comment-only — the Then asserts the observable parse RESULT, not the source.

  Background:
    Given the work-stream frontmatter reader parseFrontmatter

  @executable
  Scenario: a scalar and a quoted scalar still parse as before
    Given a frontmatter block with "status: in-progress" and 'title: "A — B"'
    When I parse the frontmatter
    Then "status" is "in-progress"
    And "title" is "A — B"

  @executable
  Scenario: an inline list still parses as a list
    Given a frontmatter block with "depends: [17]"
    When I parse the frontmatter
    Then "depends" is the list containing "17"

  # The revert: an inline flow map is no longer an object. The deterministic fallback (the value falls to the
  # final quote-strip return, which is a no-op on braces) is the VERBATIM string "{ parent: p1 }" — braces
  # retained, NOT brace-stripped, NOT empty, NOT the inner "p1". So it routes nothing.
  @executable
  Scenario: an inline flow map is no longer parsed into an object
    Given a frontmatter block with "notion: { parent: p1 }"
    When I parse the frontmatter
    Then "notion" is the verbatim string "{ parent: p1 }" (quote-stripped only — braces retained)
    And "notion" is not an object
    And reading "notion.parent" yields nothing

  # The real traversals over actual on-disk items keep working — the revert is invisible to validate/list/next.
  # No real work-stream item carries a `notion:` frontmatter key (it was only ever an authored association, now
  # in .integrations.json), so the revert touches no live item's parse; the load-bearing real value is an
  # inline list `depends: [17]` (e.g. milestone 18's own SPEC.md), which must parse identically.
  @executable
  Scenario: the work-stream traversals are unaffected by the revert
    Given a fixture work stream including a milestone whose frontmatter carries "depends: [17]"
    When I run "aof work list --json"
    Then the command exits 0
    And every item reports its identity and status exactly as before the revert
    And that milestone's "depends" still parses to the list containing "17"

  @executable
  Scenario Outline: each frontmatter value kind parses to its expected result after the revert
    Given a frontmatter block with "<line>"
    When I parse the frontmatter
    Then the value of "<key>" is <result>

    Examples: scalars and lists are unchanged
      | line                  | key     | result                       |
      | number: 18            | number  | the scalar "18"              |
      | depends: [13, 17]     | depends | the list "13", "17"          |

    Examples: an inline flow map is now the verbatim brace string (no comma-split, no brace-strip)
      | line                            | key     | result                                  |
      | notion: { parent: p1 }          | notion  | the verbatim string "{ parent: p1 }"    |
      | notion: { parent: p1, board: b1}| notion  | the verbatim string "{ parent: p1, board: b1}" |
      | notion: {}                      | notion  | the verbatim string "{}"                |
