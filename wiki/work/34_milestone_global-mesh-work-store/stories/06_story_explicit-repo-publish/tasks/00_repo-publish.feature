@executable @cli @work @distribution
Feature: `aof mesh repo publish` adds this repo to the machine-wide mesh store and records it as a mesh repo
  In order to make a project visible in the fleet view without first running a work-lifecycle command in it,
  an operator runs `aof mesh repo publish`: it writes a per-repo published marker into the repo's local config
  AND publishes the repo's work snapshot into the machine-wide global store now.

  # ARCHITECTURE 34/ADR-010 (explicit repo publish + the mesh.repo.published marker; extends ADR-002's
  # propagation predicate and ADR-004's single publisher seam). The verb is CLI-only nested (a sibling of
  # `aof mesh ui`), so it is outside the flat acd-mesh-command-cli-bijection. Tested over an injected
  # AOF_GLOBAL_HOME (the m34 global-store test convention).

  Scenario: publishing opts a not-yet-enabled repo in — the marker is written and a snapshot lands
    Given a repo that is not mesh-enabled and has never published
    When the operator runs `aof mesh repo publish`
    Then the local .aof/aof.config.json gains mesh.repo.published = true with a publishedAt and workspaceId
    And every other config key is preserved unchanged
    And the repo's workspace and its work items appear in the machine-wide global store

  Scenario: the marker also enables future auto-propagation
    Given a repo that has been published with `aof mesh repo publish`
    Then the shared propagation predicate treats mesh.repo.published = true as enabled
    And a later work mutation in that repo propagates to the global store with no further publish command

  Scenario: re-publishing is idempotent and preserves committed mesh keys
    Given a repo whose config carries a committed mesh.nodeId and mesh.relay
    When the operator runs `aof mesh repo publish` twice
    Then publishedAt is refreshed on the second run
    And the committed mesh.nodeId and mesh.relay subtree survive the marker write

  Scenario: face errors are single, clean envelopes
    When the operator runs `aof mesh repo` with no verb, an unknown verb, or an unknown flag
    Then each is rejected with one { ok: false, error, code } envelope and a non-zero exit
