@cli @adapter @work-stream
Feature: notion:sync-work is an honest opt-in no-op when work.integrations.notion is absent
  In order to keep an unconfigured project HEALTHY — it changes nothing and says so, rather than erroring
  the system must, when "work.integrations.notion" is absent, return the no-op envelope
  { configured:false, items:[], hint }, spawn NO CLI, issue ZERO Notion calls, and print a setup hint that
  names the config block to add — the hard-guaranteed "unconfigured ⇒ changes nothing" baseline.

  # ADR-004 / STATE §Opt-in no-op: absent work.integrations.notion makes run an HONEST no-op — it returns
  # { configured:false, items:[], hint } and spawns NO CLI and issues ZERO Notion calls (the hard
  # requirement). The no-op is SUCCESS, not an error: an unconfigured project is healthy, and every other
  # aof work command behaves exactly as before (SPEC §Objective). The CLI-spawn seam is injected as a SPY so
  # the zero-spawn promise is observable in-process — so the whole lane is @executable.
  #
  # These are OBSERVABLE behaviours: the returned envelope's configured/items/hint; the spy never firing; the
  # human render printing a hint that names work.integrations.notion; an unconfigured sync exiting 0 and
  # writing nothing.
  #
  # STRUCTURAL — the zero-Notion-call guarantee on absent config is also story-03 arch-test
  # acd-notion-opt-in-noop (ADR-005 inv. 3): it asserts, over the SOURCE + the injected spy, that no Notion
  # call can be reached before the config check. Here it is the OBSERVABLE counterpart — the envelope + hint +
  # the spy-never-called assertion of a single run — NOT the structural guarantee. Comment-only.

  Background:
    Given a fixture workspace with milestone "17" and its stories on disk
    And the workspace config has NO "work.integrations.notion" block
    And the Notion-CLI spawn seam is injected as a spy

  # ADR-004: the no-op envelope is the spine's, because the command shape carries `configured`.
  @executable
  Scenario: an unconfigured project returns the opt-in no-op envelope
    When I invoke "notion:sync-work" with milestone "17"
    Then the result has "configured" false
    And the result has an empty "items" array
    And the result has a non-empty "hint"

  # The hard requirement (STATE §Opt-in no-op): the no-op touches Notion not at all.
  @executable
  Scenario: the no-op spawns no CLI and issues zero Notion calls
    When I invoke "notion:sync-work" with milestone "17"
    Then the injected spawn-seam spy is never called
    And no Notion call is issued

  # ADR-004: the hint must tell the operator what to add — it names the config block.
  @executable
  Scenario: the human render prints a setup hint naming the config block
    When I run "aof work integrations notion sync-work 17"
    Then the command exits 0
    And stdout prints a setup hint that names "work.integrations.notion"

  # The no-op is success, not an error (STATE §Opt-in no-op: an unconfigured project is healthy): a
  # well-formed call against an unconfigured project exits 0 and writes nothing to disk or Notion.
  @executable
  Scenario: an unconfigured sync exits 0 and writes nothing
    When I run "aof work integrations notion sync-work 17"
    Then the command exits 0
    And nothing is written to disk
    And nothing is pushed to Notion
