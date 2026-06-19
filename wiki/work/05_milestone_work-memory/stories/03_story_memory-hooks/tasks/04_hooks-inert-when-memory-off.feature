@cli @work @memory @executable
Feature: every hook is a silent no-op when memory is off
  In order for memory to stay opt-in and safe to ship to every project
  the read and write hooks must do nothing — no block, no write, no error — when memory.backend is
  "none" or absent, so ACD behaves identically to a project without memory.

  # The portability guarantee: the hooks ship in the bundle to ALL projects via `aof work init`, but a
  # project that never opts in must be byte-for-byte unaffected. Composes the none-backend no-op
  # (story 00, ADR-002 "absent memory ≡ none") into the hook context.

  Scenario Outline: a read hook surfaces nothing under the none backend
    Given memory.backend is "<backend>"
    When the <command> read hook fires
    Then recall returns an empty RecallResult
    And no prior-lessons block is injected into the agent context
    And the command exits 0

    Examples:
      | command  | backend |
      | refine   | none    |
      | refine   | absent  |
      | continue | none    |
      | continue | absent  |

  Scenario Outline: the write hook writes nothing under the none backend
    Given memory.backend is "<backend>"
    When aof:verify accepts a milestone and fires the ingest hook
    Then ingest is a no-op reporting recordCount 0
    And no index file is written
    And accept succeeds

    Examples:
      | backend |
      | none    |
      | absent  |

  Scenario: with memory off the loop is indistinguishable from ACD without memory
    Given memory.backend is absent
    When refine, continue, and verify run end to end
    Then no memory output appears and no memory file is created
