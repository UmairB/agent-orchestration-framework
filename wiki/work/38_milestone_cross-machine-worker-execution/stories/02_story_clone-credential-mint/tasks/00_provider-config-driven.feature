@executable @cli @work @distribution
Feature: The clone-credential mint is a config-selected provider — env-token (default, unchanged) or github-app
  In order that the control node can mint credentials automatically without abandoning the simple bootstrap, the
  `mintCloneCredential` seam (ADR-009) is resolved from `config.mesh.repo.credential.provider` at the launcher and
  injected as a LITERAL key at the one production `startControlStreamServer` call site — so `env-token` stays
  byte-identical to today when unconfigured, `github-app` is selected when configured, and an unknown provider
  fails LOUD at startup rather than silently degrading.

  # ARCHITECTURE 38/ADR-010 (the provider abstraction) + ADR-009 (the F12 discipline: a credential-shaped
  # collaborator must be a LITERAL key at the production call site, never reachable only through the test spread).
  # The provider is resolved where `config` lives (the launcher), keeping control-stream-server.mjs transport-pure.

  Background:
    Given the launcher resolves the clone-credential provider from control-node config

  Scenario: no provider configured → the env-token default, byte-identical to today
    Given `config.mesh.repo.credential` is absent
    Then the resolved provider is `env-token`
    And it behaves exactly as `defaultMintCloneCredential` does today (reads `AOF_MESH_CLONE_TOKEN`)
    And nothing about the ADR-009 pull path changes

  Scenario: github-app configured → the github-app provider is selected and wired
    Given `config.mesh.repo.credential.provider` is `github-app` with its app credentials configured
    Then the resolved provider is the github-app mint
    And it is supplied to the control stream server as a LITERAL `mintCloneCredential` key at the production call site
    And it is NOT reachable only through the test-injection option spread (the F12 guard, re-armed)

  Scenario Outline: an unknown or malformed provider fails LOUD at startup — never a silent degrade
    Given `config.mesh.repo.credential.provider` is <value>
    Then the launcher throws a loud coded startup error naming the bad provider
    And no control stream server starts with an unresolved mint

    Examples:
      | value            |
      | "gitlab-app"     |
      | "" (blank)       |
      | 42 (wrong type)  |

  Scenario: the provider is invoked ONLY behind the unchanged authorization gates
    # Story 02 changes only the mint IMPLEMENTATION; the T6 holder / F15 workspace-match / F16 active-state gates
    # (ADR-009) still precede every mint, for BOTH providers.
    Given a clone-credential-request that fails the holder / workspace-match / active-state gate
    Then the selected provider's mint is NEVER called
    And the existing coded refusal fires unchanged
