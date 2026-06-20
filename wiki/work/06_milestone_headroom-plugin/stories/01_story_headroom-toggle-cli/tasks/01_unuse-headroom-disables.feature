@cli @work @board @executable
Feature: aof work unuse-headroom disables the plugin but keeps the block so the providers choice survives
  In order to turn the plugin off reversibly without losing the providers I chose
  the system must, on `aof work unuse-headroom`, set work.headroom.enabled to false while KEEPING the
  block (preserving providers), behave gracefully when there was never a block, and let a later
  use-headroom re-enable with the kept providers intact.

  # ADR-004: unuse-headroom sets enabled:false; it does NOT delete the block (deletion would lose the
  # developer's providers choice). Per ADR-001 an absent block and enabled:false are both "off", so
  # disabling by flag is honest and reversible. unuse on a project that never had the block is a
  # graceful no-op-equivalent: the plugin ends up off (a disabled-or-absent block) with exit 0.
  #
  # These scenarios assert OBSERVABLE state: enabled flips to false, the block and providers survive,
  # re-enable restores them, and the lock is untouched. The "writes only work.headroom, never the
  # lock" structural invariant is owned by the arch-test acd-headroom-config-isolation.
  Background:
    Given the project's .aof/aof.lock.json exists with its current contents

  Scenario: unuse-headroom disables the plugin and keeps the block with its providers
    Given work.headroom is { enabled: true, mode: "wrap", providers: ["claude"] }
    When I run "aof work unuse-headroom"
    Then the command exits 0
    And work.headroom.enabled is false
    And the work.headroom block is still present
    And work.headroom.providers is ["claude"]

  # ADR-004: disabling is reversible — re-enabling restores enabled:true with the kept providers.
  Scenario: re-running use-headroom after unuse re-enables with the kept providers
    Given work.headroom is { enabled: false, mode: "wrap", providers: ["claude"] }
    When I run "aof work use-headroom"
    Then the command exits 0
    And work.headroom.enabled is true
    And work.headroom.providers is ["claude"]

  # ADR-004 + ADR-001: unuse on a project with no block is a graceful no-op-equivalent — exit 0 and
  # the plugin is off (a disabled or absent block; either satisfies absent ≡ off ≡ enabled:false).
  Scenario: unuse-headroom on a project that never had the block leaves the plugin off
    Given the project's aof.config.json has no work.headroom
    When I run "aof work unuse-headroom"
    Then the command exits 0
    And the plugin is off

  # Observable shadow of acd-headroom-config-isolation: the toggle never writes the lock.
  Scenario: unuse-headroom leaves the install lock byte-identical
    Given work.headroom is { enabled: true, mode: "wrap", providers: ["claude"] }
    When I run "aof work unuse-headroom"
    Then the command exits 0
    And .aof/aof.lock.json is byte-identical to before the command

  # Starting state -> outcome after unuse-headroom. Every case exits 0 and ends with the plugin off;
  # when a block exists its providers survive (the choice is kept, never deleted) (ADR-004).
  Scenario Outline: unuse-headroom always ends with the plugin off, preserving any chosen providers
    Given the project's work.headroom starts <start>
    When I run "aof work unuse-headroom"
    Then the command exits 0
    And the plugin is off
    And the surviving providers are <providers>

    Examples: an enabled block disables and keeps providers; absent stays off
      | start                                                          | providers           |
      | { "enabled": true, "mode": "wrap", "providers": ["claude"] }   | ["claude"]          |
      | { "enabled": true, "mode": "wrap", "providers": ["claude","codex"] } | ["claude","codex"]  |
      | { "enabled": false, "mode": "wrap", "providers": ["codex"] }   | ["codex"]           |
      | absent                                                         | (none)              |
