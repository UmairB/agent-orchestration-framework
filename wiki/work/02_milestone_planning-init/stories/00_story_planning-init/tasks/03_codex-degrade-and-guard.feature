@cli @adapter @planning @executable
Feature: aof planning init degrades honestly on Codex and guards re-runs
  In order to never claim an install that did not happen and never clobber an existing pin
  the system must record an honest Codex degrade and refuse a re-run unless --force is given.

  Background:
    Given a target repo with no existing planning provenance manifest
    And the marketplace commit sha is resolved from a fixture so no network is touched
    And the runtime install is simulated so no real plugin code executes

  # On Codex the plan registers the marketplace but emits no per-plugin install line,
  # because that verb does not exist on Codex (RESEARCH A8). A reader confirms the
  # plan has the marketplace step and zero plugin-install steps.
  Scenario: the codex plan registers the marketplace but installs no plugins
    When I run "aof planning init --runtime codex --dry-run"
    Then the plan registers the "pm-skills" marketplace
    And the plan contains no per-plugin install step

  # The Codex manifest tells the truth: the marketplace was registered, no plugins
  # were installed, and the plugin set is left uninstalled.
  Scenario: the codex run records an honest degrade in the manifest
    When I run "aof planning init --runtime codex"
    Then the command exits 0
    And the manifest field "codex.marketplaceRegistered" equals true
    And the manifest field "codex.pluginsInstalled" equals false
    And the manifest "plugins" lists no installed plugin

  # The command never reports an unconditional success for Codex plugin installs; it
  # emits the documented manual fallback the user must run instead.
  Scenario: the codex run emits a manual fallback and claims no plugin install success
    When I run "aof planning init --runtime codex"
    Then the output does not claim the plugins were installed
    And the output emits the manual fallback commands the user must run to enable the plugins

  # Claude vs Codex differ only in the per-plugin install: both register the
  # marketplace; only Claude scripts the installs.
  Scenario Outline: the plan's install behaviour differs by runtime
    When I run "aof planning init --runtime <runtime> --dry-run"
    Then the plan registers the "pm-skills" marketplace
    And the plan's per-plugin install is "<installs>"

    Examples:
      | runtime | installs            |
      | claude  | scripts the plugins |
      | codex   | not attempted       |

  # The re-run guard mirrors work init: with the manifest already present and no
  # --force, the command refuses, does nothing, and points the user to --force.
  # (The "no spawn / no network on refusal" promise is the
  # acd-planning-install-commands fitness function; here a black-box tester
  # confirms the refusal via the non-zero exit, the --force hint, and the manifest
  # being left untouched.)
  Scenario: re-running without --force refuses and writes nothing
    Given a planning provenance manifest already exists
    When I run "aof planning init"
    Then the command exits non-zero
    And the output points the user to "--force"
    And the existing manifest is unchanged from before the run

  # --force on an already-pinned repo re-resolves the sha and rewrites the manifest.
  Scenario: --force re-pins and rewrites the manifest
    Given a planning provenance manifest already exists
    When I run "aof planning init --force"
    Then the command exits 0
    And the provenance manifest is rewritten

  # A dry-run always previews, even when the guard would otherwise refuse.
  Scenario: --dry-run previews regardless of the guard
    Given a planning provenance manifest already exists
    When I run "aof planning init --dry-run"
    Then the command exits 0
    And the output reports the runtime commands it would run
    And the existing manifest is unchanged from before the run

  # The guard's decision table: the manifest's presence and the --force flag
  # determine the outcome.
  Scenario Outline: the re-run guard maps the precondition to an outcome
    Given the precondition "<precondition>"
    When I run "aof planning init<flag>"
    Then the outcome is "<outcome>"

    Examples:
      | precondition         | flag      | outcome                              |
      | no planning manifest |           | install + write manifest             |
      | planning manifest    |           | refuse, exit non-zero, no writes     |
      | planning manifest    | --force   | re-pin + rewrite manifest            |
      | planning manifest    | --dry-run | preview only, manifest unchanged     |
