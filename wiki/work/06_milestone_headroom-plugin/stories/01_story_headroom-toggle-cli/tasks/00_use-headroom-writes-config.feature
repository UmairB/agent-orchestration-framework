@cli @work @board @executable
Feature: aof work use-headroom writes the work.headroom block and preserves every other config key
  In order to turn the headroom plugin on with one reversible, config-only command
  the system must, on `aof work use-headroom`, set work.headroom to the enabled wrap block with the
  default providers, leave every sibling config key (work.dir, work.ui) untouched, and write the file
  back in the project's existing JSON style — all without touching the install lock.

  # ADR-004/001: use-headroom is a config-only read-merge-write of work.headroom. It sets
  # work.headroom = { enabled: true, mode: "wrap", providers: ["claude","codex"] } (default providers
  # when none exist), preserving every other key via a shallow merge, and writes 2-space + trailing-
  # newline JSON. The frozen block (ADR-001):
  #
  #   work.headroom = { enabled: true, mode: "wrap", providers: ["claude","codex"] }
  #
  # These scenarios assert the OBSERVABLE side of the write: work.headroom's resulting value, that the
  # named siblings survive, idempotency, and that the file still parses + round-trips. The structural
  # invariant "writes ONLY the work.headroom subtree and NEVER the lock" is owned by the arch-test
  # acd-headroom-config-isolation; the "lock is byte-identical" check below is its observable shadow.
  Background:
    Given a project whose aof.config.json sets work.dir and work.ui.baseUrl and has no work.headroom
    And the project's .aof/aof.lock.json exists with its current contents

  Scenario: use-headroom enables the plugin with the default wrap block
    When I run "aof work use-headroom"
    Then the command exits 0
    And work.headroom.enabled is true
    And work.headroom.mode is "wrap"
    And work.headroom.providers is ["claude","codex"]

  Scenario: use-headroom preserves the sibling config keys
    When I run "aof work use-headroom"
    Then the command exits 0
    And work.dir is unchanged from before the command
    And work.ui.baseUrl is unchanged from before the command

  # ADR-004: the lock is developer-derived provenance; the toggle is intent and never writes it.
  # Observable shadow of the acd-headroom-config-isolation structural invariant.
  Scenario: use-headroom leaves the install lock byte-identical
    When I run "aof work use-headroom"
    Then the command exits 0
    And .aof/aof.lock.json is byte-identical to before the command

  # ADR-004: re-running when already enabled is idempotent — still enabled, no duplicated block.
  Scenario: re-running use-headroom when already enabled is idempotent
    Given work.headroom is already { enabled: true, mode: "wrap", providers: ["claude","codex"] }
    When I run "aof work use-headroom"
    Then the command exits 0
    And work.headroom.enabled is true
    And work.headroom.providers is ["claude","codex"]
    And the config has exactly one work.headroom key

  # ADR-004: the write keeps the project's 2-space + trailing-newline JSON style. Observable: the
  # file parses, and a re-read round-trips to the same value.
  Scenario: the written config keeps the project's JSON style and round-trips
    When I run "aof work use-headroom"
    Then the command exits 0
    And aof.config.json parses as JSON
    And the file ends with a single trailing newline
    And re-reading and re-serializing the config yields identical bytes

  # Starting work.headroom state -> resulting enabled flag after use-headroom. In every case the
  # command exits 0 and the plugin ends up enabled (ADR-004).
  Scenario Outline: use-headroom ends with the plugin enabled regardless of starting state
    Given the project's work.headroom starts <start>
    When I run "aof work use-headroom"
    Then the command exits 0
    And work.headroom.enabled is <enabled>

    Examples: absent or disabled both become enabled; already-enabled stays enabled
      | start                                                        | enabled |
      | absent                                                       | true    |
      | { "enabled": false, "mode": "wrap", "providers": ["claude"] } | true    |
      | { "enabled": true, "mode": "wrap", "providers": ["claude"] }  | true    |
