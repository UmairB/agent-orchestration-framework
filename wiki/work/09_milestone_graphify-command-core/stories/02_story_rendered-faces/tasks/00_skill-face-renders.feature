@docs @assets @distribution @executable
Feature: The graphify skill face renders into each runtime and tells the agent to call aof graph, not graphify
  In order that an agent reaches the graph through aof's command core, never graphify's binary or slash-form
  aof renders its own graphify skill resource through the existing asset/lock/drift machinery into claude and codex,
  so that the skill is a thin face over `aof graph <verb>`, drift-tracked like any asset, and graphify's binary-divergent slash-form never leaks to the agent.

  # ADR-005: the graphify skill is authored as aof's OWN .aof resource and rendered by
  # renderConfigOutputs (renderedResource, adapters.mjs) into the configured runtimes
  # (claude, codex) — no new render path. Its body instructs `aof graph build/query/
  # triage`, NOT graphify's shipped `/graphify` slash-form (binary-divergent, RESEARCH
  # §A) and NOT the `graphify` binary directly. It flows through the same hash/lock so
  # `aof project doctor`'s generated-output-drift check covers it. This is rendering
  # behaviour over the real machinery — fully @executable.
  Background:
    Given an aof project configured with the runtimes claude and codex
    And the graphify skill declared as an aof resource

  # The skill renders into BOTH configured runtimes through the existing machinery.
  Scenario Outline: the graphify skill renders into each configured runtime
    When I render the project's config outputs
    Then a graphify skill asset is written for runtime "<runtime>"

    Examples:
      | runtime |
      | claude  |
      | codex   |

  # The rendered skill drives the aof CLI, never graphify directly or its slash-form.
  Scenario: the rendered skill instructs aof graph, not graphify
    When I render the project's config outputs
    Then the rendered skill body references "aof graph build", "aof graph query", and "aof graph triage"
    And the rendered skill body does not reference the "/graphify" slash-form
    And the rendered skill body does not instruct calling the graphify binary directly

  # The skill is hash/lock tracked, so an out-of-band edit is reported as drift (free
  # coverage from the existing doctor check).
  Scenario: an edit to the rendered skill is reported as drift
    Given the project's config outputs are rendered and locked
    When the rendered graphify skill file is edited out of band
    And I run "aof project doctor"
    Then the generated-output-drift check reports the graphify skill as drifted
