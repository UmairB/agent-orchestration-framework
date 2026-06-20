@cli @work @memory @executable
Feature: the seam parses scope flags into the scope object and renders text by default, records under --json
  In order for an agent to scope a recall and consume it programmatically
  the system must parse the scope and option flags into the scope/opts objects it hands the backend,
  print the RecallResult's rendered text view by default, and print the structured records array under --json.

  # The seam owns argv parsing and rendering (ADR-003); the backend owns the data. These scenarios
  # run against a STUB backend that echoes back the scope/opts it received and returns a fixed
  # RecallResult, so we assert WHAT THE SEAM PASSES and WHAT IT RENDERS — never real recall quality.
  # Scope flags --area/--stage/--kind/--owner/--item parse into scope.{area,stage,kind,owner,item};
  # --limit parses into opts.limit. ADR-004: JSON is the contract, the text view is a projection —
  # by default the CLI prints RecallResult.text; under --json it prints the structured records array,
  # never the rendered text blob.
  Background:
    Given a stub backend that echoes the scope and opts it was handed and returns a fixed RecallResult

  Scenario: a single scope flag parses into the scope object handed to the backend
    When I run "aof work memory recall \"q\" --area architecture"
    Then the backend received a scope with area "architecture"

  Scenario: multiple scope flags parse into one intersected scope object
    When I run "aof work memory recall \"q\" --area architecture --kind near-miss --owner developer"
    Then the backend received a scope with area "architecture", kind "near-miss", and owner "developer"

  Scenario: --item parses into the scope object
    When I run "aof work memory recall \"q\" --item 01"
    Then the backend received a scope with item "01"

  Scenario: --limit parses into the opts object, not the scope object
    When I run "aof work memory recall \"q\" --limit 3"
    Then the backend received opts with limit 3
    And the scope object carries no limit

  Scenario: with no scope flags the backend receives an empty scope
    When I run "aof work memory recall \"q\""
    Then the backend received an empty scope

  # ADR-004: by default the CLI prints the RecallResult's pre-rendered human text view.
  Scenario: recall prints the rendered text view by default
    When I run "aof work memory recall \"q\""
    Then the command exits 0
    And the output is the RecallResult's rendered text view

  # ADR-004: under --json the CLI prints the structured records array (the contract), not the text.
  Scenario: recall under --json prints the structured records array
    When I run "aof work memory recall \"q\" --json"
    Then the command exits 0
    And the output parses as JSON
    And the output is the RecallResult's records array
    And the output is not the rendered text blob

  # Each scope flag lands on its own scope field; --limit lands on opts.limit. The seam hands the
  # backend scope = { <field>: <value> } (other fields unset) for a single-flag recall.
  Scenario Outline: a scope flag parses into its scope field handed to the backend
    When I run "aof work memory recall \"q\" <flag> <value>"
    Then the backend received <target> with <field> "<value>"

    Examples: the first-class scope filters (ADR-006) land on the scope object
      | flag    | value        | target    | field |
      | --area  | architecture | the scope | area  |
      | --stage | build        | the scope | stage |
      | --kind  | near-miss    | the scope | kind  |
      | --owner | developer    | the scope | owner |
      | --item  | 01           | the scope | item  |

    Examples: --limit lands on the opts object, not the scope
      | flag    | value        | target   | field |
      | --limit | 3            | the opts | limit |

  # Output mode -> what the seam prints, given the same RecallResult (ADR-004: text is a projection
  # of the records; --json emits the contract).
  Scenario Outline: the output mode selects the projection of the RecallResult that is printed
    When I run "aof work memory recall \"q\" <mode>"
    Then the command exits 0
    And the output is <printed>

    Examples: default prints the text projection; --json prints the records contract
      | mode   | printed                            |
      |        | the RecallResult's rendered text   |
      | --json | the RecallResult's records array   |
