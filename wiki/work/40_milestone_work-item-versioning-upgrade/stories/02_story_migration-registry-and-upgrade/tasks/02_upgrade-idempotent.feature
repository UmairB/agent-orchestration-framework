<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — `aof upgrade` is idempotent BY CONSTRUCTION (ADR-005, fitness
# acd-upgrade-idempotent, mirroring openGlobalWorkProjectionStore re-opening a current
# store without re-migrating): an item already at WORK_ITEM_SCHEMA_VERSION selects an
# empty transform chain and is left byte-untouched, and a second `aof upgrade` run is a
# no-op.
# LITMUS: every Then is confirmed by a BYTE-DIFF of the fixture's record docs across runs
# — the docs are byte-identical before and after an apply over an already-current stream,
# and byte-identical between a first and second apply — plus a fresh `aof work validate
# --json` reading zero findings. No source read.

@cli @work @work-stream
Feature: `aof upgrade` is idempotent — a current item is byte-untouched and a second run is a no-op
  In order that running the upgrade again can never corrupt a stream that is already current
  an item already at WORK_ITEM_SCHEMA_VERSION must select an empty chain and be left byte-identical, and a repeated apply must change nothing

  Background:
    Given a fixture work stream whose every item is already stamped at `schema: 1`, the current WORK_ITEM_SCHEMA_VERSION

  # A current item selects the empty chain and is byte-untouched by an apply.
  @executable
  Scenario: an item already at the current schema is left byte-untouched by an apply
    When I run `aof upgrade` and apply over the fixture stream
    Then every record doc is byte-identical to before the run
    And a fresh `aof work validate --json` over the fixture reports zero findings

  # Dry-run over an already-current stream reports nothing pending.
  @executable
  Scenario: `aof upgrade --dry-run` over an already-current stream reports nothing pending
    When I run `aof upgrade --dry-run` over the fixture stream
    Then the report names no item as pending any transform
    And every record doc's on-disk frontmatter is unchanged

  # A second apply is a no-op — byte-identical across the two runs.
  @executable
  Scenario: a second `aof upgrade` apply is a no-op
    Given I have already run `aof upgrade` to apply over the fixture stream once
    When I run `aof upgrade` to apply a second time
    Then every record doc is byte-identical between the first apply and the second

  # Idempotency holds immediately after a REAL transform too: upgrading an unstamped
  # stream once, then re-running, changes nothing on the second pass.
  @executable
  Scenario: re-running upgrade immediately after a real apply changes nothing
    Given a fixture stream of unstamped items that I upgrade and apply once
    When I run `aof upgrade` to apply again immediately
    Then no record doc changes on the second apply
    And the twice-upgraded frontmatter is byte-identical to the once-upgraded frontmatter
