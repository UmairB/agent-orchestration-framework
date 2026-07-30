Feature: Command spine — one route table, one face, one envelope
  The registry is the single source of truth for every verb (m42 wave (d) leg d1):
  a command carrying cli.route dispatches through the registry-derived route table
  into the ONE generic face, with its flag vocabulary declared on itself, one
  structured error envelope under --json, and one exit-code policy. These
  scenarios are the CONTRACT every migrated verb inherits — a new migration gets
  covered by adding a scenario here, not by hand-rolling a face.

  Scenario: a registry-routed work verb dispatches through the generic face
    Given a work stream with milestone "03" titled "Board"
    When I run `work doc 03 SPEC --json`
    Then the command should succeed
    And the JSON result field "present" should be true
    And the JSON result field "doc" should be "SPEC"

  Scenario: a migrated group verb keeps its human rendering byte-for-byte
    Given a work stream with milestone "03" titled "Board"
    When I run `assets list`
    Then the command should succeed
    And stdout should contain `resources: 0`

  Scenario: a migrated verb answers --json with the command result verbatim
    Given a work stream with milestone "03" titled "Board"
    When I run `project show --json`
    Then the command should succeed
    And the JSON result field "name" should be "fixture"

  Scenario: an undeclared flag is refused loudly, never silently absorbed
    Given a work stream with milestone "03" titled "Board"
    When I run `assets list --bogus`
    Then the command should fail
    And stderr should contain `Unknown flag "--bogus"`

  Scenario: a command failure under --json is one structured envelope on stdout
    Given a work stream with milestone "03" titled "Board"
    When I run `work run-complete 99 --outcome done --json`
    Then the command should fail
    And the JSON error envelope should carry code "ref-not-found"

  Scenario: input-contract failures are coded and precede any write
    Given a work stream with milestone "03" titled "Board"
    And story "03/01" titled "Board UI"
    When I run `work run-complete 03/01 --outcome bogus --json`
    Then the command should fail
    And the JSON error envelope should carry code "invalid-outcome"

  Scenario: a non-json failure propagates to stderr with a non-zero exit
    Given a work stream with milestone "03" titled "Board"
    When I run `work doc 03 NONSENSE`
    Then the command should fail
    And stderr should contain `Unknown document "NONSENSE"`

  Scenario: a routed nested mesh verb refuses bad input with the one envelope
    Given a work stream with milestone "03" titled "Board"
    When I run `mesh assign --json`
    Then the command should fail
    And the JSON error envelope should carry code "invalid-input"

  Scenario: a three-word route dispatches through the same face
    Given a work stream with milestone "03" titled "Board"
    When I run `mesh repo publish --json`
    Then the command should succeed
    And the JSON result field "ok" should be true

  Scenario: work doctor's advisory gate — warns pass bare, fail under --strict, same findings
    Given a work stream with milestone "03" titled "Board"
    When I run `work doctor --json`
    Then the command should succeed
    And the JSON result field "healthy" should be true
    And the JSON result field "errors" should be 0
    And stdout should contain `milestone-no-stories`
    When I run `work doctor --strict --json`
    Then the command should fail
    And the JSON result field "healthy" should be false
    And the JSON result field "strict" should be true
    And the JSON result field "errors" should be 0
    And stdout should contain `milestone-no-stories`
