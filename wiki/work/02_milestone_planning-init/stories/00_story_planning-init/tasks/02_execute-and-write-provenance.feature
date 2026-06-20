@cli @adapter @planning
Feature: aof planning init executes behind a network boundary and records provenance
  In order to run the bought planner install honestly and leave a traceable record
  the system must warn before each networked, code-executing step and write a provenance manifest only on success.

  Background:
    Given a target repo with no existing planning provenance manifest
    And the marketplace commit sha is resolved from a fixture so no network is touched
    And the runtime install is simulated so no real plugin code executes

  # The boundary is announced before the step runs, not after. A tester confirms a
  # boundary line plus a warning that the step accesses the network and executes
  # plugin/marketplace code precede each executing command.
  @executable
  Scenario: each executing step is preceded by a network-boundary warning
    When I run "aof planning init"
    Then before each executing command a network-boundary line is printed
    And the warning states the step accesses the network and executes plugin/marketplace code

  # On success the provenance manifest is written at the fixed path. Its presence
  # and location are the observable outcome.
  @executable
  Scenario: a successful run writes the provenance manifest at the fixed path
    When I run "aof planning init"
    Then the command exits 0
    And the file ".aof/aof.planning.lock.json" exists

  # The manifest carries the frozen provenance schema. A reader confirms every
  # required field is present with the expected value for a default Claude run.
  @executable
  Scenario: the manifest carries the frozen provenance schema for a default run
    When I run "aof planning init"
    Then the manifest field "source" equals "phuryn/pm-skills"
    And the manifest field "marketplaceName" equals "pm-skills"
    And the manifest field "runtime" equals "claude"
    And the manifest field "marketplaceVersion" is present
    And the manifest field "sha" is a 40-character lowercase-hex commit id
    And the manifest field "version" is present

  # The recorded plugins[] is exactly the recommended set — three core by default,
  # four with the opt-in flag. The avoided plugin is never recorded.
  @executable
  Scenario Outline: the recorded plugins list is exactly the recommended set for the flag
    When I run "aof planning init<flag>"
    Then the manifest "plugins" lists exactly "<plugins>"
    And the manifest "plugins" does not list "pm-ai-shipping"

    Examples:
      | flag            | plugins                                                                     |
      |                 | pm-execution, pm-product-discovery, pm-product-strategy                     |
      | --with-optional | pm-execution, pm-product-discovery, pm-product-strategy, pm-market-research |

  # Each recorded plugin entry names its plugin and its marketplace, matching the
  # plan that installed it.
  @executable
  Scenario: each recorded plugin entry names its plugin and marketplace
    When I run "aof planning init"
    Then every entry in the manifest "plugins" has a "name" and a "marketplace" of "pm-skills"

  # The live install: a real run against a live runtime + network actually registers
  # the marketplace and enables the plugins in the runtime (RESEARCH A7). Needs a
  # live claude + network, so it is a human/dev-run procedure.
  @manual
  Scenario: a live run registers the marketplace and enables the plugins
    Given a live claude runtime, a working network, and git on PATH
    When I run "aof planning init" for real
    Then the marketplace is registered in the runtime at the pinned commit
    And each recommended plugin is enabled in the runtime
    And the runtime cache holds the installed plugin content
    And the provenance manifest records the same pinned sha and plugin set
