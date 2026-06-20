@cli @adapter @planning @executable
Feature: Discover the PRD the shatter seam will consume
  In order to carry a real PRD into milestone SPECs without a silent miss or a guess
  the discovery step must auto-find a PRD-*.md at the workspace root, honour an explicit path, and ask when neither resolves.

  # Discovery is the testable, harden-able part of the seam (ADR-005): the PRD-*.md filename is an
  # agent-honoured CONVENTION, not a tool-enforced path. So discovery must auto-find PRD-*.md OR accept
  # an explicit path OR ask — never silently miss, never guess among other *.md. The actual shattering
  # into SPECs is agent behaviour and lives in the @manual/@uat scenarios of the sibling features.

  Background:
    Given a workspace directory that discovery will search
    And the representative PRD fixtures in this story's "fixtures/" folder are available to seed it

  Scenario: a PRD-*.md at the workspace root is auto-discovered
    Given the workspace root holds one "PRD-acme-notify.md" and nothing else matching "PRD-*.md"
    When discovery runs with no explicit path argument
    Then it resolves "PRD-acme-notify.md" as the PRD to consume
    And it does not ask for a path

  Scenario: an explicit path is honoured even when it breaks the convention
    Given the workspace root holds no "PRD-*.md"
    And a well-formed but unprefixed "write-prd-output.md" exists outside the root
    When discovery runs with that file passed as the explicit path argument
    Then it resolves "write-prd-output.md" as the PRD to consume
    And it does not ask for a path

  # The discovery matrix — every shape of "what is at the root / what was passed" mapped to the one
  # observable outcome: which PRD is used, or that discovery ASKS. The ask outcome is the load-bearing
  # one (ADR-005: degrade to "pass the path", never a silent miss, never a guess).
  Scenario Outline: discovery resolves a PRD or asks, never guesses
    Given the workspace root contains <root contents>
    When discovery runs with <path argument>
    Then the outcome is <outcome>

    Examples:
      | root contents                                   | path argument                 | outcome                                                        |
      | one "PRD-acme-notify.md"                        | none                          | uses "PRD-acme-notify.md"                                      |
      | one "PRD-acme-notify.md" plus a "NOTES.md"      | none                          | uses "PRD-acme-notify.md" (the non-PRD markdown is ignored)   |
      | no "PRD-*.md", an explicit "write-prd-output.md"| that file's path              | uses "write-prd-output.md" (the explicit path wins)           |
      | no "PRD-*.md", only a "NOTES.md"                | none                          | asks for a path (no PRD-*.md and the *.md decoy is not picked) |
      | empty                                           | none                          | asks for a path (nothing to discover)                          |
      | "PRD-acme-notify.md" and "PRD-other.md"         | none                          | asks / lists (two PRD-*.md — discovery does not silently pick) |
      | "PRD-acme-notify.md" and "PRD-other.md"         | "PRD-other.md"'s path         | uses "PRD-other.md" (an explicit path disambiguates)          |

  Scenario: discovery never silently selects a non-PRD markdown file
    Given the workspace root holds only a "NOTES.md" and no "PRD-*.md"
    When discovery runs with no explicit path argument
    Then it asks for a path
    And "NOTES.md" is not selected as the PRD
