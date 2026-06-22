@cli @adapter @scaffold @executable
Feature: The provider registry plans a provision by lane, the uv lane via uv venv, the npx lane delegating to frameworks.mjs
  In order that a tool declares HOW it provisions and the npx installer is generalized without being rewritten
  the registry dispatches planProvision on descriptor.provider — the uv lane plans uv venv + uv pip install, the npx lane delegates to the existing planner,
  so that a Python tool installs into the version-keyed store, node frameworks install exactly as before, and an unknown lane is rejected rather than guessed.

  # ADR-002: a provider registry { npx, uv } keyed by id. planProvision(descriptor,
  # {dryRun}) dispatches on descriptor.provider and returns the command list (executed
  # only when not dryRun — mirrors planFrameworkInstall's dryRun). The uv lane plans
  # `uv venv <verDir>` + `uv pip install --python <verDir> "<spec>[extras]==<version>"`
  # (NOT `uv tool install` — not version-keyed, RESEARCH §"Store layout"). The npx lane
  # DELEGATES to the untouched frameworks.mjs planner (lock/attempt preserved). The
  # "uv never shells npx / npx never shells uv" STRUCTURAL fact is a fitness function
  # (ADR-005 inv. 3); here we assert the observable PLAN each lane emits under dryRun
  # (the argv it would run, no spawn).
  Background:
    Given the provider registry loaded in-process

  # The uv lane plans the two deterministic commands that build the version-keyed venv,
  # targeting the version dir the resolver later reads from.
  Scenario: the uv lane plans uv venv then uv pip install --python into the version dir
    Given a uv-lane descriptor for "graphify" packageSpec "graphifyy" version "0.8.44"
    When I planProvision with dryRun
    Then the plan's first command is "uv venv" targeting the graphify 0.8.44 version dir
    And the plan's second command is "uv pip install --python" into that version dir installing "graphifyy==0.8.44"
    And no graphify binary is spawned (dryRun emits commands only)

  # uv-lane extras are threaded into the install spec. Rows: no extras (bare spec), a
  # single extra (headroom-ai[all]), and multiple extras (the comma-joined form) — the
  # version pin is always appended with "==".
  Scenario Outline: the uv lane threads extras into the install spec
    Given a uv-lane descriptor for "headroom" packageSpec "headroom-ai" version "<v>" extras "<extras>"
    When I planProvision with dryRun
    Then the install spec is "<spec>"

    Examples:
      | extras    | v      | spec                            |
      | (none)    | 0.26.0 | headroom-ai==0.26.0             |
      | all       | 0.26.0 | headroom-ai[all]==0.26.0        |
      | mcp,proxy | 0.26.0 | headroom-ai[mcp,proxy]==0.26.0  |

  # The npx lane delegates to the existing frameworks.mjs planner — the npx argv shape
  # is unchanged (the re-home, not a rewrite). The argv[0] is the OBSERVABLE shape; the
  # "never shells uv" leak-guard is the structural fitness fact below.
  # QA: "no command in the plan invokes uv" was a structural cross-lane leak-guard →
  # ADR-005 inv. 3 (provider-neutral registry, source-grep). Observable npx argv kept here.
  Scenario: the npx lane delegates to frameworks.mjs with the npx argv shape intact
    Given an npx-lane descriptor for a node framework
    When I planProvision with dryRun
    Then the plan delegates to the frameworks.mjs planner
    And the planned command's argv[0] is "npx"

  # Dispatch is by descriptor.provider; an unknown provider is rejected (named), and a
  # descriptor missing its provider is likewise rejected — neither is guessed.
  Scenario Outline: planProvision dispatches on the provider and rejects an unresolvable one
    Given a descriptor whose provider is "<provider>"
    When I planProvision
    Then it reports an unknown-provider error naming "<named>"

    Examples:
      | provider | named   |
      | wat      | wat     |
      | (absent) | (none)  |
