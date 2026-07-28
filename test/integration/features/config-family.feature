Feature: Config family — assets, packages, project through the spine
  Wave-1 completion of m42 wave (d) leg d1: the assets/packages/project families
  are registry Commands on the route table. These scenarios pin the surfaces the
  legacy features (lifecycle/packages/dsl/adapter-policy) do not: exit-code
  gates through the face's exit adapter, --json envelopes, the ref verbs'
  refusals, and the legacy-config migration. Byte-level render parity for the
  busy paths (add/apply/install) stays with the legacy features.

  Scenario: a scaffolded asset shows back with its body present
    Given a project with an empty aof config
    When I run `assets add skill review --description "Review skill" --claude`
    Then the command should succeed
    And stdout should contain `Created`
    When I run `assets show skill review`
    Then the command should succeed
    And stdout should contain `resource: skill:review`
    And stdout should contain `body: present`

  Scenario: removing an asset in dry-run changes nothing
    Given a project with an empty aof config
    When I run `assets add skill review --claude`
    Then the command should succeed
    When I run `assets remove skill review --dry-run`
    Then the command should succeed
    And stdout should contain `dry-run: no source assets or config files were changed`
    When I run `assets show skill review`
    Then the command should succeed

  Scenario: assets validate answers --json with the report envelope
    Given a project with an empty aof config
    When I run `assets validate --json`
    Then the command should succeed
    And the JSON result field "valid" should be true

  Scenario: a malformed package intent fails packages validate with exit 1
    Given a project whose config declares a malformed package
    When I run `packages validate`
    Then the command should fail
    And stdout should contain `invalid: 1 error(s)`

  Scenario: the package intent lifecycle roundtrips through the spine
    Given a project with an empty aof config
    When I run `packages add gsd --claude`
    Then the command should succeed
    When I run `packages show gsd --json`
    Then the command should succeed
    And the JSON result field "id" should be "gsd"
    When I run `packages remove gsd`
    Then the command should succeed
    And stdout should contain `Removed package intent gsd`

  Scenario: project validate and doctor report health with exit 0
    Given a project with an empty aof config
    When I run `project validate`
    Then the command should succeed
    And stdout should contain `valid: config passed validation`
    When I run `project doctor`
    Then the command should succeed
    And stdout should contain `doctor: healthy`

  Scenario: a legacy root config migrates into the workspace layout
    Given a legacy root-config project
    When I run `project migrate`
    Then the command should succeed
    And stdout should contain `is now authoritative`
    And project file `.aof/aof.config.json` should exist
    And project file `.aof/aof.lock.json` should exist
    When I run `project migrate`
    Then the command should fail
    And stderr should contain `already exists`

  Scenario: the global-ref verbs refuse a non-global invocation loudly
    Given a project with an empty aof config
    When I run `assets use skill review`
    Then the command should fail
    And stderr should contain `Usage: aof assets use --global <kind> <id>`
