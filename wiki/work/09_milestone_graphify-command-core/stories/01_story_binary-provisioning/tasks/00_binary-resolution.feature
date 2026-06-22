@cli @adapter @scaffold
Feature: resolveGraphifyBinary reports graphify present or absent as structured data, never an opaque ENOENT
  In order that provisioning and the doctor check can reason about graphify without spawning a missing binary
  resolveGraphifyBinary locates the `graphify` executable (installed from the `graphifyy` spec) and returns a structured present/absent result with an install hint when absent,
  so that an absent binary is a first-class, guidance-bearing fact — not a crash deep inside a graph:* command.

  # ADR-002/ADR-004: src/graphify.mjs exposes resolveGraphifyBinary(). The name
  # asymmetry is load-bearing (RESEARCH §G): the PyPI/spec name is `graphifyy`
  # (double-y) but the invoked binary is `graphify` (single-y). When absent it returns
  # { found:false, hint } with the install one-liner — it NEVER spawns a build/query
  # for a missing binary. The absent path is CI-checkable by stubbing PATH empty
  # (@executable); a real present binary + its version probe is live-only (RESEARCH
  # §A4/A7) and confirmed @manual.
  Background:
    Given the graphify driver src/graphify.mjs loaded in-process

  # Absent binary → a structured miss with the install hint, not an exception.
  @executable
  Scenario: an absent graphify binary resolves to a structured miss with install guidance
    Given PATH does not contain a graphify executable
    When I call resolveGraphifyBinary()
    Then it returns found false
    And it returns an install hint naming "uv tool install graphifyy"
    And it does not throw and does not spawn graphify

  # The hint carries BOTH steps of the real install (RESEARCH §G).
  @executable
  Scenario: the install hint names both install steps
    Given PATH does not contain a graphify executable
    When I call resolveGraphifyBinary()
    Then the hint mentions "uv tool install graphifyy"
    And the hint mentions "graphify install"

  # The spec name and the binary name are distinct and both surfaced where a lock /
  # doctor entry would record them (the graphifyy ↔ graphify asymmetry).
  @executable
  Scenario: the resolver distinguishes the spec name from the binary name
    When I inspect the resolver's known names
    Then the install spec name is "graphifyy"
    And the invoked binary name is "graphify"

  # Present binary → a structured hit; the version degrades clearly when the probe is
  # unavailable (RESEARCH §A4 — `graphify --version` is unconfirmed). This needs the
  # LIVE binary on PATH, so it is @manual.
  # verifies → milestone UAT.md "graphify binary resolution (live install)" procedure (authored at verify).
  @manual
  Scenario Outline: a present graphify binary resolves to a structured hit
    Given graphify is installed on PATH
    When I call resolveGraphifyBinary()
    Then it returns found true with the binary path
    And the version is "<version>"

    Examples:
      | version                         |
      | the reported version            |
      | present, version unknown        |
