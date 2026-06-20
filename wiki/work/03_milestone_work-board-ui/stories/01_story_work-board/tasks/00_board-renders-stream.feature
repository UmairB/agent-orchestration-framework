@ui @work @board
Feature: The board renders the work stream as a milestone grid that drills into status lanes
  In order to see where the whole project stands and evaluate a work item as a whole — not as a wall of text
  the board fetches the locked work-list contract and renders it as a grid of milestone cards (the overview), each of which opens a five-lane, derived-status board for its stories.

  # Reworked 2026-06-20 (visual rework — DESIGN §1, two-level model). The board's
  # read model is unchanged: the flat `work list --json` array (ADR-002),
  # consumed as a fixture. Verification split per scenario: the server-side data
  # contract is @executable (node tests against the request handlers); the
  # rendered overview/lanes behaviour is @manual (a developer runs the dev server
  # — `aof work board` — and observes; there is no UI component harness here).
  Background:
    Given a fixtured work stream served by "/api/work/list" containing:
      | ref   | type      | slug        | status      | title                 | parent |
      | 00    | milestone | work-cli    | done        | The work CLI          |        |
      | 03    | milestone | work-board  | in-progress | The work board UI     |        |
      | 03/00 | story     | board-tree  | in-review   | Board tree render     | 03     |
      | 03/01 | story     | work-board  | in-review   | The work board        | 03     |
      | 04    | milestone | work-memory | not-started | Work memory           |        |

  # --- the data contract the board consumes (server-side, unchanged) ---------

  # The list endpoint still serves the frozen contract verbatim — a FLAT array,
  # each element exactly the seven contract fields. The board derives the grid and
  # the per-milestone lanes client-side from these (milestone = parent-null; its
  # stories = parent == milestone ref).
  @executable
  Scenario: the list endpoint serves the flat work-list contract
    When the board requests "/api/work/list"
    Then the response is a flat JSON array, not a nested tree
    And every element carries exactly the fields "ref, type, slug, status, title, parent, dir"
    And the depth-0 items "00", "03", "04" have a null or absent parent
    And the item "03/01" carries a parent "03" that resolves to another element's ref

  # --- VIEW 1: the milestone-grid overview (browser) ------------------------

  # The default view is the overview: one card per milestone, derived entirely
  # from the contract. Each card shows the status glyph-ring, mono ref, title, a
  # done/total progress bar, one dot per story, and an attention footer.
  @manual
  Scenario: the overview renders milestones as a grid of cards
    Given the board has loaded the fixtured stream
    Then milestones "00", "03", "04" each render as a card in the overview grid
    And each card shows its status glyph-ring, mono ref, title, and a "done / total" ratio
    And milestone "03" shows one dot per story (for "03/00" and "03/01")

  # The progress bar must agree with the done/total label — done stories read as a
  # SOLID teal segment, active (in-progress/in-review) as an ANIMATED stripe — so a
  # 0-done / 2-in-review milestone is a fully-striped moving bar, never a part-full
  # bar that looks two-thirds finished.
  @manual
  Scenario: a milestone's progress bar reflects done vs active honestly
    Given the board has loaded the fixtured stream
    Then milestone "03" shows "0 / 2" with a fully-striped animated bar (no solid done segment)
    And milestone "00" shows a fully-solid bar (all stories done)
    And milestone "04" shows an empty track labelled "not started"

  # The summary chips tally the stream.
  @manual
  Scenario: the overview summary chips tally the stream
    Given the board has loaded the fixtured stream
    Then the overview shows a "done" chip counting the done milestones
    And it shows an "active" chip counting the in-progress milestones

  # The overview is its own full-width screen — no detail column, no terminal dock
  # (regression guard for the rework: those belong to the board view only).
  @manual
  Scenario: the overview shows neither the detail panel nor the terminal dock
    Given the board has loaded the fixtured stream and is on the overview
    Then no item-detail column is shown
    And no terminal dock is shown
    And the content does not overflow horizontally

  # --- VIEW 2: drill into a milestone's status lanes ------------------------

  # Opening a milestone card drills into its five-lane status board.
  @manual
  Scenario: opening a milestone card drills into its status lanes
    Given the board has loaded the fixtured stream
    When the operator opens milestone "03"
    Then a five-lane board is shown: not-started, in-progress, in-review, blocked, done
    And the breadcrumb shows "Work items" and a milestone switcher reading "03"

  # The lanes bucket the focused milestone's stories by their DERIVED status — the
  # lanes are read-only buckets, never draggable columns.
  @manual
  Scenario: the lanes bucket the milestone's stories by derived status
    Given the operator has opened milestone "03"
    Then stories "03/00" and "03/01" appear in the in-review lane
    And the in-review lane header shows a count of 2
    And no lane card can be dragged to change its status

  # Selection drives the detail panel (one selected card at a time).
  @manual
  Scenario: selecting a lane card drives the detail panel
    Given the operator has opened milestone "03"
    When the operator selects story "03/01"
    Then story "03/01" is the one selected card
    And the detail panel reflects story "03/01"

  # The switcher changes focus; the breadcrumb returns to the overview.
  @manual
  Scenario: the switcher changes focus and the breadcrumb returns to the overview
    Given the operator has opened milestone "03"
    When the operator picks "00" from the milestone switcher
    Then the lanes show milestone "00"'s stories
    When the operator clicks "‹ Work items"
    Then the overview grid is shown again

  # A focused milestone with no stories shows a placeholder, not an error.
  @manual
  Scenario: an empty milestone shows a placeholder, not an error
    Given the board has loaded the fixtured stream
    When the operator opens milestone "04"
    Then the board shows a "No stories in this milestone yet" placeholder
    And the error state is not shown

  # --- lifecycle states (DESIGN §1 States) ----------------------------------

  @manual
  Scenario: the board shows a loading state while the stream is being fetched
    Given the "/api/work/list" response has not yet resolved
    Then the board shows a "Loading work stream…" indicator
    And neither the empty placeholder nor the error state is shown

  @manual
  Scenario: an empty stream shows the empty placeholder, not an error
    Given the "/api/work/list" response is an empty array
    Then the board shows an empty placeholder prompting to run work init
    And the error state is not shown

  @manual
  Scenario: a failed stream load shows an error with retry
    Given the "/api/work/list" request fails
    Then the board shows an error state with a retry affordance
    When the operator retries and the stream loads
    Then the board renders the populated overview grid
