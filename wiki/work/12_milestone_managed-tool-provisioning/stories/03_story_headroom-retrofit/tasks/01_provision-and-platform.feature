@cli @adapter @scaffold
Feature: The headroom descriptor drives the uv lane with extras and warns where the platform has no wheel
  In order that headroom provisions through the same uv lane as graphify and an unsupported platform is told honestly
  the headroom descriptor (headroom-ai[all], the win32 platform matrix) drives the uv lane plan and the tool-platform doctor warning,
  so that headroom installs via uv on a supported platform, and on Windows — where there is no wheel — the operator is warned it needs Rust rather than failing mid-build.

  # ADR-004 + RESEARCH §"Headroom"/§A3: headroom is PyPI headroom-ai → binary headroom,
  # the SAME uv lane (no third provider), with extras [all] and a platform matrix
  # (win32 supported:false, prereq Rust — no Windows wheel). The descriptor + the
  # platform-matrix warning are @executable (the plan + the tool-platform check are pure
  # over the descriptor); the live headroom-ai[all] uv install + the live `headroom
  # --version` from the store are @manual (heavy ML stack; win32 needs Rust, live-only).
  # MIXED verification → no feature-level verification tag; each scenario tags its own.
  Background:
    Given the provider registry and doctor checks loaded in-process

  # The descriptor threads [all] extras into the uv-lane install spec and targets the
  # headroom version dir. The plan is pure over the descriptor (no spawn).
  @executable
  Scenario: the headroom descriptor plans headroom-ai[all] via the uv lane
    Given the headroom descriptor (packageSpec "headroom-ai", extras "all")
    When I planProvision headroom with dryRun
    Then the uv-lane install spec is "headroom-ai[all]==0.26.0"
    And the plan targets the headroom version dir in the store

  # The platform matrix drives the tool-platform doctor warning. Rows: the two POSIX
  # platforms with prebuilt wheels (ok, no warning) and win32 with no wheel (warning
  # naming the Rust prerequisite). Pure over the descriptor matrix — never an error.
  @executable
  Scenario Outline: the tool-platform check reflects headroom's platform matrix
    When the tool-platform check runs for headroom on "<platform>"
    Then its severity is "<severity>"
    And it "<mentions>"

    Examples:
      | platform | severity | mentions                    |
      | linux    | ok       | does not warn               |
      | darwin   | ok       | does not warn               |
      | win32    | warning  | names the Rust prerequisite |

  # End-to-end over the live uv lane: headroom installs into the store and runs from it.
  # verifies → milestone UAT.md "headroom store install (live uv)" procedure (authored at verify).
  @manual
  Scenario: aof project provision headroom installs headroom-ai[all] into the store
    Given uv is installed on a platform with a headroom wheel
    When I run "aof project provision headroom"
    Then a uv venv with headroom-ai[all] exists at the headroom version dir in the store
    And the store headroom binary runs from the store
