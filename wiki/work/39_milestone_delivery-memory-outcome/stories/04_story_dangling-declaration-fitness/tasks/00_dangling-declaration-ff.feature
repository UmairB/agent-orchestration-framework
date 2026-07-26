@cli @work @memory @executable
Feature: A declared record-format field with no producer fails the dangling-declaration fitness function
  In order that the delivery record does not depend on the honesty of its author
  the fitness function must, from a single-source field list and a bounded set of producer modules alone,
  compute the declared fields with zero producer write-site and fail red on any non-empty result —
  catching a field declared with no writer (exactly the "warnings_delivered" shape) even the one nobody wrote down.

  # This is the black-box spec of the check's BEHAVIOUR, not its implementation (ADR-005 pins the
  # contract; this story is its deliverable). The check's surface is exactly two inputs — (i) a declared
  # field set from a single source of truth (the frozen MEMORY_RECORD_FIELDS list) and (ii) a bounded set
  # of producer modules (the record parsers that write those fields) — and one output: the set of declared
  # fields with no producer write-site, on which it is red iff non-empty. It reads NO OUTCOME.md.
  #
  # Prevention, not recall (ADR-006): this check is the only genuine prevention of a dangling field in the
  # authoring milestone. It GENERALISES the acd-assignment-state-has-producer idiom (35/ADR-001, "no state
  # exists without a writer") from a state enum to a record-format field set.

  Background:
    Given a declared field set drawn from a single source of truth
    And a bounded set of producer modules that write those fields
    And a detector that reports every declared field having zero producer write-site among those modules

  # The clean case: the real field set × the real producers. Today every declared field is written at a
  # producer site, so the dangling set is empty and the check is green.
  Scenario: a field set whose every declared field has a producer passes
    Given every field in the single-source field list is written at a producer write-site
    When the detector computes the declared fields with no producer write-site
    Then the set of dangling fields is empty
    And the fitness function passes

  # Non-vacuity is MANDATORY (05/R2): a check that only proves it is green proves the wrong property. The
  # SAME detector that greens the clean set must go red when fed a declared field with no writer — exactly
  # the warnings_delivered shape (a field a retro-lesson added to the format that no code path populates).
  Scenario: a declared field with no producer trips the same detector and fails red
    Given a field list carrying a declared field that no producer module writes, in the "warnings_delivered" shape
    When the detector computes the declared fields with no producer write-site
    Then that field is reported as a dangling declaration
    And the fitness function fails red
    And it is the same detector that passes the clean field set

  # The harder half of the SPEC: surface declared with no producer that NOBODY wrote down is caught anyway,
  # otherwise the milestone ships an honesty box for a liar. The verdict is a pure function of the field
  # list and the producer modules — no OUTCOME.md is consulted — so an undeclared dangling field is caught.
  Scenario: a dangling field is caught even though no OUTCOME.md declared it
    Given a declared field with no producer write-site
    And no OUTCOME.md anywhere owns up to that field as a gap
    When the detector runs over the field list and the producer modules alone
    Then the dangling field is reported
    And the verdict is unchanged whether or not any OUTCOME.md is present

  # The honest scope boundary (ADR-005), asserted here. Record-format fields are the tractable case: a
  # single-source ENUMERABLE list, and producers that are grep-able SAME-LANGUAGE assignment sites in a
  # bounded module set. Flags, endpoints, config keys, and dynamic / computed / reflective / cross-language
  # producers are not statically enumerable in general and are OUT of scope — the check catches the
  # motivating class and claims nothing over the rest.
  Scenario Outline: the check claims record-format fields and disclaims the other declaration classes
    Given a declared surface of class "<class>" with a member that has no producer
    When the fitness function is asked about that member
    Then it <behaviour>

    Examples: in scope — the tractable, statically-reachable case
      | class               | behaviour                                                              |
      | record-format field | is in the declared surface — the producerless member fails red         |

    Examples: out of scope — the check reads no such declaration and renders no verdict
      | class                                | behaviour                                                       |
      | CLI flag                             | is outside the declared surface — no verdict, no claim of safety |
      | HTTP endpoint                        | is outside the declared surface — no verdict, no claim of safety |
      | config key                           | is outside the declared surface — no verdict, no claim of safety |
      | dynamically or reflectively written field | is outside the declared surface — no verdict, no claim of safety |
      | cross-language producer              | is outside the declared surface — no verdict, no claim of safety |

  # Wired in (ADR-005 presence invariant): the fitness function runs as part of the assembled arch suite —
  # observable from the assembled runner's registered test set and the test/arch/ listing, never by reading
  # the runner's import block. Its presence becomes non-optional once the delivery-memory machinery lands;
  # the milestone-level presence guard is the architect's acd-outcome-dangling-declaration-present, not a
  # scenario here.
  Scenario: the dangling-declaration fitness function is registered in the assembled test runner
    Given the milestone-39 declared-field-has-a-producer fitness function under "test/arch/"
    When the arch-test suite is assembled
    Then the arch-tests it exports are part of the runner's registered suite
    And each of them reports a passing result
