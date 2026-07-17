<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — WORK_ITEM_MIGRATIONS is an ordered, CONTIGUOUS chain of transform
# descriptors rooted at 0 (0→1→…, no gaps, no repeats); the chain's highest `to` value
# EQUALS the WORK_ITEM_SCHEMA_VERSION constant so the two can never drift (ADR-005
# anti-drift, fitness acd-work-item-schema-single-constant); the 0→1 stamp transform is
# the chain's first entry (ADR-003); and the engine computes an upgrade by SELECTION —
# planUpgrade returns the tail of the chain from the item's schema forward to current.
# LITMUS: every Then is confirmable from the registry's EXPORTED descriptors + the
# exported WORK_ITEM_SCHEMA_VERSION constant (both readable via the module API), and the
# selection scenarios from planUpgrade's returned descriptors against a fixture item's
# on-disk schema — never a source read.

@cli @work @work-stream
Feature: WORK_ITEM_MIGRATIONS is a contiguous 0→1→… chain whose highest target equals WORK_ITEM_SCHEMA_VERSION, and the engine selects the sub-chain from an item's schema to current
  In order that the set of migrations between "what this stream is" and "what aof is now" is COMPUTED from one registry, never researched
  the registry must be a contiguous chain rooted at 0 whose highest `to` equals the schema constant, and the engine must select exactly the ordered transforms from the item's schema forward to the current schema

  Background:
    Given the WORK_ITEM_MIGRATIONS descriptors and the WORK_ITEM_SCHEMA_VERSION constant exported by the upgrade module

  # The chain has no gaps and no repeats: ordered by `from`, each descriptor's `from`
  # equals the previous descriptor's `to`, and the very first `from` is 0 (the
  # pre-versioning baseline, ADR-003).
  @executable
  Scenario: the registry is a contiguous chain rooted at the schema-0 baseline
    Then the exported descriptors, ordered by `from`, begin at `from` 0
    And each descriptor's `from` equals the previous descriptor's `to` with no gap and no repeat
    And every `to` is exactly one greater than its own `from`

  # Anti-drift: the constant declares the target, the registry provides the path, and the
  # two are bound equal — the highest `to` in the chain IS WORK_ITEM_SCHEMA_VERSION.
  @executable
  Scenario: the chain's highest transform target equals WORK_ITEM_SCHEMA_VERSION
    Then the greatest `to` across all exported descriptors equals the exported WORK_ITEM_SCHEMA_VERSION constant

  # The stamp transform (ADR-003) is the registry's first entry: 0→1.
  @executable
  Scenario: the 0→1 stamp transform is the chain's first entry
    Then the descriptor with `from` 0 has `to` 1
    And it is the first descriptor in the chain order

  # Selection, not research: an item at the schema-0 baseline selects the whole chain
  # from 0 forward to current, in ascending order.
  @executable
  Scenario: an item at the schema-0 baseline selects the whole chain to current
    Given a fixture item whose frontmatter carries no `schema` key and therefore reads as 0
    When I plan the upgrade for that item
    Then the planned transforms equal every exported descriptor whose `from` is 0 or higher, in ascending chain order
    And the last planned transform's `to` equals WORK_ITEM_SCHEMA_VERSION

  # An item already at the current schema selects the EMPTY chain — the idempotency root
  # (ADR-005), confirmed here at the plan level and byte-checked in task 02.
  @executable
  Scenario: an item already at the current schema selects the empty chain
    Given a fixture item whose frontmatter reads `schema` equal to WORK_ITEM_SCHEMA_VERSION
    When I plan the upgrade for that item
    Then the planned chain is empty
