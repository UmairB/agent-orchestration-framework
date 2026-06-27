@cli @adapter @work-stream
Feature: the central boards registry resolves a routed item to its board connection, with a default and flat back-compat
  In order to address more than one Notion board by key while never breaking the milestone-17 config that just shipped
  the system must let the central config carry a "boards" registry (each board the m17 connection fields, keyed),
  designate one "default" board, resolve a descriptor's board (or fall back to the default) to that board's
  connection, treat an existing FLAT m17 block as the implicit default board, and resolve a notion parent key
  against the CHOSEN board's parents map — all PURELY from committed config, with no Notion call.

  # ADR-002: work.integrations.notion is promoted to { default: "<board-key>", boards: { "<k>": { dataSourceId,
  # tokenEnv?, statusProperty, statusMap, relationProperty, parents? } } }. "default" is a STRING key naming a
  # board (not a board literally keyed "default"). Back-compat: a flat block (top-level dataSourceId + … and no
  # "boards" key) is the implicit default board — the resolver synthesises boards = { default: <flat> },
  # default = "default". ADR-003: resolveNotionRouting(item, notionConfig) → { board: <resolved connection>,
  # parentPageId|null, reason? } combines the descriptor (task 00) with this registry. ADR-001: a parent KEY
  # resolves against the chosen board's parents; a raw page-id is used verbatim.
  #
  # These are OBSERVABLE behaviours of the resolver over fixtures, in-process — @executable. The SCHEMA-shape
  # invariant (the boards registry validates at the Ajv-2020 compile seam; a malformed board is rejected) is
  # FF-F (an arch-test authored in story 02), NOT a Then here. Comment-only.

  Background:
    Given a config whose work.integrations.notion carries a boards registry with boards "ops" and "growth"
    And the default board is "ops"

  @executable
  Scenario: a descriptor naming a board resolves to that board's connection
    Given an item whose descriptor names notion board "growth"
    When I resolve the item's routing
    Then the resolved board is "growth"
    And the resolved connection is the "growth" board's dataSourceId, statusMap, and relationProperty

  @executable
  Scenario: an item with no board falls back to the default board
    Given an item whose descriptor names a parent but no board
    When I resolve the item's routing
    Then the resolved board is the default "ops"

  @executable
  Scenario: an item with no descriptor at all routes to the default board, top-level
    Given an item with no ".integrations.json"
    When I resolve the item's routing
    Then the resolved board is the default "ops"
    And the resolved parent page id is null

  # Back-compat (the SPEC lean): a flat m17 config is the implicit default board, so an m17 project keeps
  # working unchanged when it adopts m18 with no boards key.
  @executable
  Scenario: a flat milestone-17 config is treated as the implicit default board
    Given a config whose work.integrations.notion is a FLAT m17 block with no "boards" key
    And an item with no ".integrations.json"
    When I resolve the item's routing
    Then the resolve succeeds
    And the resolved connection is the flat block's dataSourceId, statusMap, and relationProperty

  # ADR-001: a parent KEY resolves against the CHOSEN board's parents map; a raw page-id needs no config.
  @executable
  Scenario: a parent key resolves against the chosen board's parents map
    Given the "growth" board's parents map binds key "q3-roadmap" to page id "page-Q3"
    And an item whose descriptor names notion board "growth" and parent key "q3-roadmap"
    When I resolve the item's routing
    Then the resolved parent page id is "page-Q3"

  @executable
  Scenario: a raw page-id parent is used verbatim with no registry lookup
    Given an item whose descriptor names parent "11112222333344445555666677778888" and no board
    When I resolve the item's routing
    Then the resolved parent page id is "11112222333344445555666677778888"

  # An unknown "default" or an unknown board key is an honest config error at resolve time (the Ajv schema can
  # only require "default" to be a string; the cross-check that it names a real board is the resolver's, ADR-002).
  @executable
  Scenario Outline: an unresolvable board reference is an honest config error
    Given <config-defect>
    When I resolve an item that routes to that board
    Then the resolve fails with code "<code>"
    And the error names the available boards "ops" and "growth"

    Examples: the two failure origins are distinguished by code
      | config-defect                                                       | code                  |
      | the descriptor names a board "ghost" absent from the registry        | unknown-board-key     |
      | the config "default" names a board "ghost" absent from the registry  | unknown-default-board |
