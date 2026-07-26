@executable @finding-F-3405 @cli @work @distribution
Feature: a legacy per-workspace identity sidecar is honored, then migrated up to the global home
  In order to move an existing per-workspace identity to the machine-wide home without losing it, a legacy
  .aof/mesh/identity.json is read as a fallback when the global identity is absent, and a migrate moves it
  up to the global home and removes the per-workspace copy.

  # ARCHITECTURE 34/ADR-009. Back-compat precedence: global > legacy per-workspace sidecar (read-only) >
  # committed config > derive. The migrate (migrateIdentityToGlobal) is idempotent; a hostname-derived
  # legacy id still self-heals to this machine (33/ADR-004.5) — the pinned/valid-derivation case is the one
  # honored verbatim.

  Scenario: a legacy per-workspace identity is honored when no global one exists
    Given a workspace with a legacy per-workspace identity sidecar and an empty global home
    When the workspace is loaded
    Then config.mesh.nodeId is hydrated from the legacy per-workspace sidecar

  Scenario: the legacy sidecar is migrated up to the global home and removed
    Given a workspace with a legacy per-workspace identity sidecar and an empty global home
    When the identity is migrated to the global home
    Then the identity now lives in the global home
    And the per-workspace sidecar is removed
    And a re-load resolves the same id from the global home

  Scenario: the migrate is idempotent
    Given no legacy per-workspace sidecar remains
    When the migrate runs again
    Then it is a clean no-op
