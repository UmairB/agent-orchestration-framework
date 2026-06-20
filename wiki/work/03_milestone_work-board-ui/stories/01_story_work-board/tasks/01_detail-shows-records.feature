@ui @work @board
Feature: Selecting an item opens its type-aware detail panel
  In order to read a selected item's records without opening markdown files by hand — and at the LEVEL that actually owns them
  the detail panel reflects the board selection and offers a doc switcher whose tabs depend on the item's type: a milestone owns SPEC / VERIFICATION / RETROSPECTIVE / Findings, while a story owns only its STORY (the user story + its tasks); a document the item does not have yet is an empty placeholder, never an error.

  # Reworked 2026-06-20 (visual rework). The ACD doc model is LEVEL-SPECIFIC:
  # VERIFICATION.md and RETROSPECTIVE.md (and Findings) live at the MILESTONE; a
  # story carries only STORY.md (user story + tasks checklist). So the panel's tab
  # set is type-dependent — offering a story milestone-level tabs (which read
  # "none") was a bug. The detail panel reads each doc at path.join(dir,'<DOC>.md')
  # off the `dir` in the contract (ADR-002/ADR-004); a missing doc is
  # empty-not-error. The doc-read endpoint is @executable; the rendered, type-aware
  # switching is @manual.
  Background:
    Given a milestone "03" whose directory contains "SPEC.md" and "VERIFICATION.md" but no "RETROSPECTIVE.md"
    And a story "03/01" whose directory contains "STORY.md" (the user story + a tasks checklist) and no VERIFICATION or RETROSPECTIVE of its own

  # --- the doc-read endpoint (server-side, unchanged) -----------------------

  # The doc endpoint returns the requested document's body, resolved at
  # path.join(dir,'<DOC>.md') off the item dir from the contract.
  @executable
  Scenario: the doc endpoint returns the requested document body
    When the board requests "/api/work/doc" for "03/01" document "STORY"
    Then the response carries the body of "STORY.md" from the item directory

  # A document the item lacks is NOT a server error — the endpoint reports
  # absent/empty so the panel renders its placeholder. A milestone that has not
  # been accepted yet legitimately has no RETROSPECTIVE.
  @executable
  Scenario: a document the item lacks is reported as absent, not an error
    When the board requests "/api/work/doc" for "03" document "RETROSPECTIVE"
    Then the response indicates the document is absent
    And the response is not an error

  # --- the rendered, type-aware detail panel (browser) ----------------------

  # With no selection the panel shows a centred prompt, not a blank pane.
  @manual
  Scenario: with no selection the panel prompts to select an item
    Given no board item is selected
    Then the detail panel shows a "Select an item to see its details" prompt

  # Selecting an item populates the panel header with the item's identity and
  # status; the body strips frontmatter (never dumps it as an "objective").
  @manual
  Scenario: selecting an item populates the detail header
    When the operator selects story "03/01"
    Then the detail header shows the glyph-ring, the monospace ref "03/01", the type "story", the slug, and the title
    And the detail header shows the item's status chip
    And the rendered body does not show the document's YAML frontmatter

  # The tab SET depends on type: a milestone owns four record tabs; a story owns
  # only STORY (its user story + tasks) — milestone-level tabs are NOT offered on
  # a story.
  @manual
  Scenario Outline: the doc tabs offered depend on the selected item type
    Given a selected "<type>" item
    Then the doc switcher offers exactly the tabs "<tabs>"

    Examples:
      | type      | tabs                                          |
      | milestone | SPEC, VERIFICATION, RETROSPECTIVE, Findings   |
      | story     | STORY, TASKS                                  |

  # A story's panel shows its user story (STORY tab, rendered markdown) AND its
  # tasks (TASKS tab) — not a milestone verification/retrospective.
  @manual
  Scenario: a story's panel shows its user story and its tasks
    When the operator selects story "03/01"
    Then the STORY tab shows the story's user story rendered as markdown
    And the TASKS tab lists the story's tasks/*.feature with their scenarios and lane chips
    And no VERIFICATION, RETROSPECTIVE, or Findings tab is offered for the story

  # The TASKS tab is fed by the read-only /api/work/tasks endpoint, which parses
  # each .feature server-side (the browser can't read disk).
  @executable
  Scenario: the tasks endpoint parses a story's feature files with lanes
    When the board requests "/api/work/tasks" for story "03/01"
    Then the response lists one entry per tasks/*.feature, sorted by filename
    And each entry carries its Feature title, its scenarios, and per-lane counts (executable / manual / uat)

  # Doc bodies render as HTML, not raw text.
  @manual
  Scenario: document bodies render as markdown
    When the operator opens milestone "03" and views its VERIFICATION tab
    Then the document renders as formatted markdown (headings, lists, and tables), not raw text
    And the YAML frontmatter is not shown

  # Flipping a milestone's tab swaps ONLY the body to the chosen record, leaving
  # the header and selection unchanged.
  @manual
  Scenario Outline: switching a milestone tab renders that record in the body
    Given milestone "03" is selected with its SPEC tab active
    When the operator switches to the "<tab>" tab
    Then the body renders the "<doc-file>" content for "03"
    And the detail header and board selection are unchanged

    Examples:
      | tab           | doc-file         |
      | SPEC          | SPEC.md          |
      | VERIFICATION  | VERIFICATION.md  |

  # A milestone tab for a document it does not have yet shows a dashed-border
  # placeholder in the body — NOT an error (empty-not-error).
  @manual
  Scenario: a milestone tab for an absent record shows a placeholder, not an error
    Given milestone "03" is selected
    When the operator switches to the "RETROSPECTIVE" tab
    Then the body shows a "No retrospective yet" placeholder
    And no error state is shown

  # The Findings tab (a milestone's) shows a count and a positive line when empty.
  @manual
  Scenario: the milestone Findings tab shows a count and a positive line when empty
    Given milestone "03" is selected and has no open findings
    When the operator switches to the "Findings" tab
    Then the Findings tab shows a count of "0"
    And the body shows a positive "No findings." line

  # Opening a milestone's board selects the MILESTONE by default; selecting a
  # story then swaps the whole panel to that story's view.
  @manual
  Scenario: milestone-default selection, then a story swaps the panel
    When the operator opens milestone "03"'s board
    Then the detail panel reflects milestone "03" and its first tab is "SPEC"
    When the operator selects story "03/01"
    Then the detail panel reflects story "03/01" and offers the "STORY" and "TASKS" tabs (no milestone-level tabs)
