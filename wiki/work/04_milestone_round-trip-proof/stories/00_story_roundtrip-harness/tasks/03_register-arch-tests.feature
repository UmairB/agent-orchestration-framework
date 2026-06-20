@cli @work @round-trip @executable
Feature: the round-trip fitness functions are registered in CI and pass
  In order to keep the harness invariants enforced forever (not just at refine time)
  the three acd-roundtrip-* arch-tests must be part of the runner's registered suite and pass.

  # These three arch-tests were written RED at Decide (ARCHITECTURE.md) and deliberately NOT yet
  # wired into the test runner (that would red the whole suite before the harness existed). This
  # task is the wiring — and it goes green only once the harness (this story) satisfies them.
  #
  # Feasibility (developer amigo): the runner names each test by its ADR prose, not by file slug,
  # so "registered" is keyed by the test FILE — an acd-roundtrip-* file is registered when the
  # arch-tests it exports are all part of the runner's assembled suite. The black-box surface is
  # the assembled suite (the registered set of tests) plus each file's exported arch-test names and
  # the test/arch/ directory listing — never the runner's import block. The mechanism that makes
  # this checkable (a meta arch-test over the assembled suite) is a story-00 build decision; see
  # STORY.md Notes.

  Background:
    Given the project test runner and the "acd-roundtrip-*.test.mjs" files under "test/arch/"

  Scenario Outline: each round-trip arch-test file is part of the registered suite and passes
    When the arch-test suite runs against the built harness
    Then the arch-tests exported by "<file>" are part of the registered suite
    And each of them reports a passing result

    Examples:
      | file                                       |
      | acd-roundtrip-isolation.test.mjs           |
      | acd-roundtrip-reuses-shipped-code.test.mjs |
      | acd-roundtrip-harness-contract.test.mjs    |

  # The no-drift guard the task headline calls for: a new acd-roundtrip-*.test.mjs added under
  # test/arch/ but never wired into the runner must be CAUGHT, so the registration can't silently
  # rot. Observable from the directory listing vs the assembled suite — no reading of the import block.
  Scenario: no round-trip arch-test file is left out of the registered suite
    Given the set of "acd-roundtrip-*.test.mjs" files present under "test/arch/"
    When the arch-test suite is assembled
    Then every such file's exported arch-tests are part of the registered suite
    And no "acd-roundtrip-*" file is present on disk yet absent from the suite
