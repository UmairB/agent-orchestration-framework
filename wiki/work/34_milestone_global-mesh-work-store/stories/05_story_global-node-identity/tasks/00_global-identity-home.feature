@executable @finding-F-3405 @cli @work @distribution
Feature: the node identity is a single machine-wide fact — minted once to the global AOF home, hydrated into every workspace
  In order for the machine-wide global work store (keyed on nodeId) to be coherent, this machine has ONE
  node identity (nodeId + salt), initialized once in the global AOF home and shared by every workspace —
  never a different id per project — while a git clone inherits no identity at all.

  # ARCHITECTURE 34/ADR-009 (identity is global; amends 33/ADR-004's persist location). The "identity
  # resolves from the global home, never a per-workspace aofDir" invariant is STRUCTURAL → fitness
  # acd-global-node-identity-home, not a step. Tested over an injected AOF_GLOBAL_HOME (the m34 global-store
  # test convention). The real two-machine confirmation (one id shown across both hosts) is the @manual soak.

  Scenario: one machine, two workspaces, one shared node id (init-once in the global home)
    Given a machine whose global AOF home is empty
    When identity is minted in one workspace
    Then the identity is written to the global AOF home, not to any project's .aof
    And a second workspace on the SAME machine hydrates the SAME node id

  Scenario: the project carries no identity file — a git clone inherits none
    Given identity has been minted on this machine
    Then no per-workspace identity sidecar exists in the project
    And the identity lives only in the global AOF home

  Scenario: a different machine keeps a separate identity
    Given the same repository opened under a DIFFERENT machine's global AOF home
    Then that machine does not inherit the first machine's node id
    And it mints its own identity into its own global home
