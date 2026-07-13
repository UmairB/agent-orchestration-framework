<!-- aof-generated: bundle -->

# Task feature — the refine bypass, the behavioural-verify bypass, and the board type badge.
# LITMUS: the refine/verify outcomes are observable by an agent running the skill and reading its report;
#   the board badge is observable in the rendered card DOM. Mixed verification tags — shared layer/domain
#   tags are per-scenario here because the layers differ (@cli for the skill lanes, @ui for the board).
# Per ADR-003: spike/chore never enter refine (Three-Amigos / story break-down) nor behavioural `.feature`
#   verification; the board renders them with a minimal type label/badge — no new lane.

@work
Feature: spike/chore bypass refine and behavioural verify, and carry a board type badge
  In order to keep lightweight items out of the shippable-behaviour ceremony
  the system must refuse/redirect refine for a spike/chore, never route them through `.feature`
  verification, and render each with a minimal type badge on the board.

  # aof:refine has nothing to do on a spike/chore — they group no stories and author no task contract.
  @cli @validate @manual
  Scenario: aof:refine refuses or redirects a spike or chore
    Given a well-formed spike or chore item (a top-level driver that groups no stories)
    When an agent runs `aof:refine <spike-or-chore-ref>`
    Then the skill declines to run the Three-Amigos / story break-down for that item
    And its report states there is nothing to break down or contract for this type
    And no `stories/` folder and no task `.feature` file is created under the item

  # No behavioural-verify step exists in the spike/chore verify path.
  @cli @validate @manual
  Scenario: a spike or chore is never routed through behavioural .feature verification
    Given a well-formed spike or chore item with no `.feature` in its folder
    When an agent runs `aof:verify <spike-or-chore-ref>`
    Then the skill's report contains no scenario-run / behavioural-verify step for the item
    And the item is closed on its per-type criterion alone (finding for a spike, checklist+validate for a chore)

  # The board surfaces the type — observable in the rendered card DOM (executable against src/board-ui.mjs
  # and the board render it feeds). A spike/chore card carries a type badge/label bearing its type text.
  @ui @board @executable
  Scenario Outline: the board renders a spike/chore card with a type badge bearing its type
    Given a work stream containing a top-level <type> driver item
    When the board renders that item's card
    Then the card carries a type badge/label whose text is "<type>"
    And no new per-type lane or column is introduced for it (it uses the existing driver placement)

    Examples:
      | type  |
      | spike |
      | chore |
