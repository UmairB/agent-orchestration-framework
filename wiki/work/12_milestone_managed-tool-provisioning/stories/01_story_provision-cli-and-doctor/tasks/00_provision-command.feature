@cli @scaffold
Feature: aof project provision is a registered command that installs or removes a tool in the managed store
  In order that aof's tool dependencies are provisioned through the command core, not assembled by hand
  project:provision registers into the command core and `aof project provision <tool>` drives the registry to install or uninstall in the store,
  so that provisioning has a single source of truth with a --json contract, and uninstall targets only the version dir.

  # ADR-003: project:provision is a NEW command-core command (added to COMMANDS),
  # carrying the frozen { id, input, run, cli } shape; `aof project provision <tool>
  # [--version V] [--force] [--uninstall] [--json]` dispatches in projectCommand through
  # invoke("project:provision", …) (the 08 bijection). run looks up the descriptor and
  # plans/installs into toolVersionDir via the provider registry (ADR-002); --uninstall
  # removes ONLY that version dir. The "uninstall is store-scoped" STRUCTURAL fact is a
  # fitness function (ADR-005 inv. 5); the live `uv venv`+install is @manual (live binary).
  # The @executable rows assert registration, the --json plan surface, and the dry-run
  # plan target — all provable in-process / with the lanes stubbed.
  Background:
    Given the command registry loaded in-process
    And a fixture project workspace

  # The command is registered and CLI-runnable like every other core command.
  @executable
  Scenario: project:provision is registered with the frozen command shape
    When I list the registered command ids
    Then the ids include "project:provision"
    And the "project:provision" command carries an "input" schema, an async "run", and a "cli" adapter with "argv" and "render"

  # --json over a dry-run/plan emits the ProvisionResult envelope (no spawn) — the
  # machine-readable contract a face binds to. Rows cover the install plan and the
  # uninstall plan: the status field and the carried plan differ, the envelope shape
  # and single-pass JSON parse hold for both.
  @executable
  Scenario Outline: aof project provision --json emits the ProvisionResult plan envelope
    When I run "aof project provision graphify <flags> --json" in plan/dry-run mode
    Then the entire stdout parses as JSON in a single pass
    And the JSON reports the tool "graphify", its provider, the pinned version, and the store path
    And the JSON status is "<status>"
    And the JSON carries the planned commands

    Examples:
      | flags       | status      |
      | (none)      | installed   |
      | --uninstall | uninstalled |

  # --uninstall targets only the tool's version dir under the store root. The "exactly
  # the version dir" target is the OBSERVABLE plan fact asserted here.
  # QA: "the removal target is not a global, PATH, or system path" was a structural
  # store-scoping guard → ADR-005 inv. 5 (uninstall store-scoped, injected fs-remove +
  # source-grep). The observable "targets exactly the version dir" is kept here.
  @executable
  Scenario: aof project provision --uninstall targets exactly the version dir
    Given a managed "graphify" "0.8.44" present in the store
    When I plan "aof project provision graphify --uninstall"
    Then the removal target is exactly the graphify 0.8.44 version dir under the store root

  # An upgrade provisions a NEW version dir and leaves the old one in place (the store is
  # version-keyed; a project pinning the old version is unaffected — ADR-003). Observable
  # over the dry-run plan: the plan targets the requested version's dir, not the old one.
  @executable
  Scenario: provisioning a new version plans into the new version dir, leaving the old pin
    Given a managed "graphify" "0.8.44" present in the store
    When I plan "aof project provision graphify --version 0.9.0"
    Then the plan targets the graphify 0.9.0 version dir under the store root
    And the plan does not target or remove the graphify 0.8.44 version dir

  # A real install of a tool into the store needs live uv — deferred to the live lane.
  # verifies → milestone UAT.md "aof project provision (live uv install)" procedure (authored at verify).
  @manual
  Scenario: aof project provision installs a real tool into the store
    When I run "aof project provision graphify"
    Then a uv venv is created under the graphify version dir in the store
    And the provisioned graphify binary runs from the store
