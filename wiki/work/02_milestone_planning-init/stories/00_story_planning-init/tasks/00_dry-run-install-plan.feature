@cli @adapter @planning @executable
Feature: aof planning init --dry-run previews the install plan and touches nothing
  In order to inspect exactly what the bought planner install will do before any code runs
  the system must print the planned runtime commands while performing no network access, no process spawn, and no manifest write.

  Background:
    Given a target repo with no existing planning provenance manifest
    And the marketplace commit sha is resolved from a fixture so no network is touched

  # The headline guarantee of a dry-run: it is a pure preview. A black-box tester
  # confirms the side-effect-free promise by observing that nothing on disk
  # changed — the dry-run reports its plan and leaves no manifest behind. (That the
  # dry-run path makes no spawn/network call is the acd-planning-install-commands
  # fitness function, not asserted here — it is not observable from the public
  # surface without white-box process instrumentation.)
  Scenario: a dry-run previews the plan without acting on it
    When I run "aof planning init --dry-run"
    Then the command exits 0
    And the output reports the runtime commands it would run
    And the file ".aof/aof.planning.lock.json" does not exist

  # The plan for the default runtime + recommended set: a marketplace registration
  # followed by one install per core plugin. The reader cares that the right plugins
  # come from the pm-skills marketplace — the exact verb/token string is the
  # acd-planning-install-commands fitness function, not asserted here.
  Scenario: the default plan registers the marketplace then installs the three core plugins
    When I run "aof planning init --dry-run"
    Then the plan registers the "pm-skills" marketplace before any plugin install
    And the plan installs the "pm-execution" plugin from the "pm-skills" marketplace
    And the plan installs the "pm-product-discovery" plugin from the "pm-skills" marketplace
    And the plan installs the "pm-product-strategy" plugin from the "pm-skills" marketplace

  # The avoided plugin is never in the plan, regardless of flags. pm-ai-shipping is
  # deliberately excluded from the recommended set.
  Scenario: the avoided plugin never appears in the plan
    When I run "aof planning init --dry-run"
    Then the plan does not install the "pm-ai-shipping" plugin

  # The opt-in flag is the only lever that adds the optional plugin; its presence
  # is observable in the previewed plan.
  Scenario: --with-optional adds the optional plugin to the plan
    When I run "aof planning init --dry-run --with-optional"
    Then the plan installs the "pm-market-research" plugin from the "pm-skills" marketplace

  Scenario: without --with-optional the optional plugin is absent
    When I run "aof planning init --dry-run"
    Then the plan does not install the "pm-market-research" plugin

  # The recommended-set matrix: which plugins appear in the previewed plan is a
  # function of the opt-in flag. Each row is the full set the plan installs.
  Scenario Outline: the previewed plan installs the recommended set for the given flag
    When I run "aof planning init --dry-run<flag>"
    Then the plan installs exactly the plugins "<plugins>" from the "pm-skills" marketplace
    And the plan does not install the "pm-ai-shipping" plugin

    Examples:
      | flag            | plugins                                                                  |
      |                 | pm-execution, pm-product-discovery, pm-product-strategy                  |
      | --with-optional | pm-execution, pm-product-discovery, pm-product-strategy, pm-market-research |

  # Per-plugin presence under each flag, enumerated. "present" means the plan
  # contains an install of that plugin; "absent" means it does not.
  Scenario Outline: a given plugin is present or absent in the plan for the flag
    When I run "aof planning init --dry-run<flag>"
    Then the "<plugin>" plugin is "<presence>" in the plan

    Examples:
      | flag            | plugin               | presence |
      |                 | pm-execution         | present  |
      |                 | pm-product-discovery | present  |
      |                 | pm-product-strategy  | present  |
      |                 | pm-market-research   | absent   |
      |                 | pm-ai-shipping       | absent   |
      | --with-optional | pm-market-research   | present  |
      | --with-optional | pm-ai-shipping       | absent   |
