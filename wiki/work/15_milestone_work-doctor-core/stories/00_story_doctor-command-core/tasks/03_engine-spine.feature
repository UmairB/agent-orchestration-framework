@cli @work @work-stream @validate @executable
Feature: doctorWork builds the item snapshot once and concatenates a registry of pure check-group functions
  In order to let stories 01/02 — and milestone 16 — append health checks without editing each other
  the doctorWork(workDir, config, scope, { now, staleWindow }) engine builds the item snapshot ONCE and concatenates the findings of a registry of pure (snapshot, ctx) => Finding[] check-GROUP functions,
  so that a group appended to the registry contributes its findings to the result (the extension seam), two groups both contribute, identical findings de-dupe, and a group receives now/staleWindow through ctx and acts on them.

  # This is the engine COMPOSITION (ADR-003) — the milestone-16 extension point.
  # doctorWork enumerates the item set via the shared work.mjs model (listItems +
  # readMeta), builds ONE read-only snapshot, then runs each pure group fn over
  # (snapshot, ctx) and concatenates + de-dupes their findings. This feature asserts
  # the OBSERVABLE composition behaviour by appending STUB groups to the registry it
  # exercises. It does NOT assert the DETERMINISM invariant (byte-identical findings
  # under a fixed now / no Date.now() in the engine source) — that is the
  # engine-determinism ARCH-TEST. It MAY assert that a group RECEIVES now/staleWindow
  # through ctx and acts on it, since that branch is observable behaviour, not the
  # no-wall-clock source guarantee.
  Background:
    Given a work-stream fixture with a known set of items
    And the doctorWork engine over that fixture

  # The snapshot is built ONCE from the shared model and is what every group reads:
  # running the engine over a fixture with N items yields a snapshot whose item set
  # equals what listItems enumerates — no group re-traverses the FS for identity.
  Scenario: the engine builds a single item snapshot from the shared model
    Given the fixture has 3 enumerable items
    And a stub group that reports one finding per item it is handed in the snapshot
    When I run doctorWork over the fixture
    Then the result has exactly 3 findings
    And the snapshot the group received lists exactly the 3 enumerated items

  # The EXTENSION SEAM (the milestone-16 contract): appending a pure group fn to the
  # registry makes ITS findings appear in the result — proven with a stub group that
  # emits a uniquely-coded finding, edited into NO existing group.
  Scenario: a group appended to the registry contributes its findings
    Given a stub group appended to the registry that emits a finding with code "stub-probe"
    When I run doctorWork over the fixture
    Then the result includes a finding with code "stub-probe"

  # Two independent groups BOTH contribute: the engine concatenates findings across
  # groups (order-independent, additive) — the property that lets 01 and 02 author in
  # parallel without editing each other.
  Scenario: two appended groups both contribute their findings
    Given a stub group "A" appended that emits a finding with code "group-a"
    And a stub group "B" appended that emits a finding with code "group-b"
    When I run doctorWork over the fixture
    Then the result includes a finding with code "group-a"
    And the result includes a finding with code "group-b"

  # De-dupe on identity: two groups emitting the SAME code+path+message collapse to a
  # SINGLE finding (as validateWork de-dupes path+problem) — so an overlapping fact
  # reported by two families is not double-counted.
  Scenario: identical code+path+message findings from different groups de-dupe to one
    Given a stub group "A" appended that emits a finding code "dup" at path "P" with message "M"
    And a stub group "B" appended that emits the identical finding code "dup" at path "P" with message "M"
    When I run doctorWork over the fixture
    Then the result has exactly one finding with code "dup" at path "P"

  # Findings differing in ANY of code/path/message are DISTINCT (de-dupe keys on all
  # three) — the same code at two different anchors is two findings.
  Scenario: findings differing in path are kept distinct
    Given a stub group that emits code "dup" at path "P1" with message "M"
    And another stub group that emits code "dup" at path "P2" with message "M"
    When I run doctorWork over the fixture
    Then the result has two findings with code "dup"

  # The injected clock is OBSERVABLE through ctx: a group reads now/staleWindow from
  # ctx and acts on them — the same fixture under two different injected `now` values
  # drives a now-sensitive stub group to two different results. (This asserts the
  # injection PATH is wired, not the no-wall-clock source rule — that is the arch-test.)
  Scenario Outline: a group receives now and staleWindow through ctx and acts on them
    Given a stub group that emits a finding only when an item's recorded date is older than "now" by more than "staleWindow"
    When I run doctorWork over the fixture with injected now "<now>" and staleWindow "<window>"
    Then the result "<emits>" the now-sensitive finding

    Examples:
      | now        | window | emits        |
      | 2026-06-25 | 7d     | includes     |
      | 2020-01-01 | 7d     | omits        |
      | 2026-06-25 | 9999d  | omits        |

  # Scope-as-filter at the engine boundary: passing a scope restricts the result to
  # that subtree; an unresolved scope filters to nothing WITHOUT throwing (the
  # semantics the command and faces inherit).
  Scenario Outline: scope filters the engine result; an unresolved scope is empty without throwing
    Given a stub group that emits one finding per item
    When I run doctorWork over the fixture with scope "<scope>"
    Then doctorWork does not throw
    And the result is "<finding-set>"

    Examples:
      | scope      | finding-set                          |
      | 07         | only that subtree's findings         |
      | 99/no-such | empty (unresolved scope, no throw)   |
