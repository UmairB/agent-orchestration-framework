@cli @work @memory @manual
Feature: verify ingests the accepted milestone's lessons at Accept
  In order for this milestone's lessons to be recallable in the next one
  aof:verify must ingest the new lessons at Accept — AFTER RETROSPECTIVE.md is written — so the index
  reflects what was just learned.

  # Agent-run observation of the write hook firing, plus a deterministic count assertion on its effect.
  # `ingest` is the Accept-time alias of `reindex` (ADR-003); since the local index is a full rebuild,
  # the assertion is on the resulting recordCount. Recorded in VERIFICATION.md, `verifies →` this scenario.

  Scenario: accepting a milestone folds its lessons into the index
    Given memory.backend is "local"
    And a milestone whose RETROSPECTIVE.md has just been written at Accept
    When aof:verify accepts the milestone
    Then "aof work memory ingest" runs after the RETROSPECTIVE.md is written
    And the index recordCount then includes that milestone's R<n> + ADR-NNN
    And a recall over those new lessons surfaces them

  Scenario: the just-written lessons are recallable immediately after Accept
    Given a milestone accepted with the write hook above
    When the next decision-point recall runs a query matching one of its new lessons
    Then that lesson appears in the recalled block
