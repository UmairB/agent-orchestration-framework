@cli @adapter @planning
Feature: aof planning init pins the marketplace to a resolved commit sha
  In order to make a produced PRD reproducible and traceable to how it was made
  the system must record an exact commit sha as the integrity anchor and refuse to record a floating ref.

  Background:
    Given a target repo with no existing planning provenance manifest

  # The happy path: a resolved commit sha is accepted and recorded as the pin. The
  # sha is injected from a fixture so CI stays offline (RESEARCH A3). What a tester
  # confirms is that the manifest pins the marketplace at exactly that commit.
  @executable
  Scenario: a resolved commit sha is recorded as the pin
    Given the resolved marketplace commit sha is "d384f0c9eb81fe74656a4f6da168587836939edb"
    When I run "aof planning init"
    Then the recorded provenance pins the marketplace at "d384f0c9eb81fe74656a4f6da168587836939edb"
    And the recorded sha is a 40-character lowercase-hex commit id

  # A floating ref is never recorded as the pin. A branch, a tag, HEAD, or a short
  # sha must be refused before anything is written — the command does not silently
  # accept an unpinnable input.
  @executable
  Scenario: a floating ref is refused and nothing is recorded
    Given the resolved marketplace ref is "main"
    When I run "aof planning init"
    Then the command exits non-zero
    And the output reports that the resolved ref is not a 40-character commit sha
    And the file ".aof/aof.planning.lock.json" does not exist

  # The accept/reject matrix for the candidate pin. A full 40-hex lowercase commit
  # is the only accepted shape; branches, tags, HEAD, short or uppercase or
  # over-length hex are all rejected as floating/invalid pins.
  @executable
  Scenario Outline: the candidate pin is accepted only when it is a full commit sha
    Given the resolved marketplace ref is "<ref>"
    When I run "aof planning init"
    Then the pin outcome is "<outcome>"

    Examples:
      | ref                                      | outcome   |
      | d384f0c9eb81fe74656a4f6da168587836939edb | accepted  |
      | 0123456789abcdef0123456789abcdef01234567 | accepted  |
      | main                                     | rejected  |
      | HEAD                                     | rejected  |
      | v2.0.0                                   | rejected  |
      | 2.0.0                                    | rejected  |
      | d384f0c                                  | rejected  |
      | D384F0C9EB81FE74656A4F6DA168587836939EDB | rejected  |
      | d384f0c9eb81fe74656a4f6da168587836939edbXX | rejected |

  # When the pin is accepted, the recorded sha is what later runs compare against to
  # detect drift; when rejected, no manifest is written at all.
  @executable
  Scenario Outline: the manifest records the sha only when the pin is accepted
    Given the resolved marketplace ref is "<ref>"
    When I run "aof planning init"
    Then the manifest "<manifest-state>"

    Examples:
      | ref                                      | manifest-state                       |
      | d384f0c9eb81fe74656a4f6da168587836939edb | records that sha as the pin          |
      | main                                     | is not written                       |
      | v2.0.0                                   | is not written                       |

  # The live resolution: against the real network this resolves the marketplace
  # repo's HEAD to a 40-hex commit and pins it (RESEARCH A6). Needs a live git +
  # network, so it is a human/dev-run procedure, not CI.
  @manual
  Scenario: a live sha resolution yields a 40-hex commit and pins it
    Given a working network and git on PATH
    When I resolve the marketplace HEAD against the live "phuryn/pm-skills" repo
    Then the resolution yields a 40-character lowercase-hex commit id
    And the plan pins the marketplace at that resolved commit
    And the recorded provenance sha equals that resolved commit
