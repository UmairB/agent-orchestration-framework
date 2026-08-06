<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — schema v8: `work_items` gains `node_id` + `updated_at` through the
# established GUARDED, IDEMPOTENT `ALTER TABLE … ADD COLUMN` pattern, never a table
# rebuild; and the two content tables need no migration at all.
# LITMUS: every Then is confirmable by OPENING THE STORE BACK UP and reading it — the
# `aof_schema` version row, `PRAGMA table_info(<table>)`'s column list, and the rows
# themselves read back through the store's own readers. No source read; the migration is
# judged by the shape and content of the database it leaves behind. Fixtures are built by
# writing a store at the OLD version and re-opening it with this build (the
# backcompat-migrate idiom, `test/backcompat-migrate-doctor.test.mjs`), never by
# hand-editing a schema the migration then agrees with.
#
# WHY A REBUILD IS FORBIDDEN AND MUST BE ASSERTED, NOT ASSUMED. `CREATE TABLE IF NOT
# EXISTS` never adds a column to an already-existing table (RESEARCH §4.1), so the only
# two ways to land the columns are the guarded `ALTER` (the `clone_url`/`session_id`/
# `code` precedent, `global-work-store.mjs:312-345`) or a drop-and-recreate. A rebuild
# would be invisible in a green "the column exists" assertion and would silently destroy
# every row a worker had streamed — which under ADR-004 is unrecoverable FACT, not a
# re-derivable projection. So the scenarios below assert the SURVIVAL of the data and the
# IDEMPOTENCE of the step, which is what actually distinguishes the two implementations.

@executable @cli @work @distribution
Feature: opening a pre-v8 global work store migrates it to schema 8 by adding `node_id` + `updated_at` to `work_items` in place, leaving every existing row intact and every existing value untouched
  In order that the cache can say who reported each row and when — without a migration that destroys the worker-authored
  rows the mesh has no other copy of, and without a second run of the same migration failing on a duplicate column
  the store opens a v7 database, adds exactly two nullable columns to `work_items` through a PRAGMA-guarded `ALTER TABLE … ADD COLUMN`,
  stamps the version to 8, and leaves the two content tables — which have carried these columns since v5 — completely alone

  Background:
    Given an isolated global mesh home (never the real `~/.aof`)
    And a global work store written at schema version 7, holding work items, docs and run records for two workspaces

  # HEADLINE (AC 1). The columns land, the version moves, and the pre-existing rows are
  # still there afterwards — the last clause is what separates an in-place ALTER from a
  # drop-and-recreate that happens to end with the right column list.
  Scenario: opening a v7 store lands both provenance columns on `work_items` in place and moves the version to 8
    When the store is opened with this build
    Then reading the store back reports schema version 8
    And `work_items` carries a `node_id` column and an `updated_at` column
    And `work_items` still carries every column it had at v7 — `workspace_id`, `ref`, `type`, `slug`, `status`, `title`, `parent`, `source_path` — with its original type and its primary key `(workspace_id, ref)` unchanged
    And every work item row that existed before the open still reads back with the same `ref`, `type`, `slug`, `status`, `title`, `parent` and `source_path` values
    And the row count in `work_items` is exactly what it was before the open, per workspace
    # a rebuild is what this last pair of clauses forbids: ADR-004 makes `work_items` a
    # FACT — a worker-authored row lost to a migration is not re-derivable from disk

  # AC 1, second half — the two content tables are a REGRESSION GUARD, not new work. They
  # have carried `node_id` + `updated_at` per row since v5 (RESEARCH §4.2), so a migration
  # that "helpfully" touches them is a bug, and an ALTER against them would throw on the
  # duplicate column.
  Scenario Outline: the content tables need NO migration — their provenance columns already exist and their rows are left byte-identical
    When the store is opened with this build
    Then <table> carries a `node_id` column and an `updated_at` column, exactly as it did at v7
    And <table>'s column list is unchanged by the open — no column is added, removed, renamed or retyped
    And every row in <table> reads back with the same `node_id` and `updated_at` values it held before the open
    And the open did not raise a duplicate-column error

    Examples:
      | table           |
      | work_item_docs  |
      | work_item_runs  |

  # AC 1 / ADR-006 — IDEMPOTENCE is the property the guard exists for. A second open must
  # be a no-op, not a duplicate-column throw, because a real machine opens this store on
  # every command.
  Scenario Outline: the migration is idempotent — from any starting state the store ends at v8 with one set of columns, and re-opening changes nothing
    Given a global work store whose starting state is <starting state>
    When the store is opened with this build, and then opened a second time
    Then both opens complete without error
    And reading the store back reports schema version 8
    And `work_items` carries exactly one `node_id` column and exactly one `updated_at` column
    And the second open changed no row in `work_items`, `work_item_docs` or `work_item_runs`
    And <expected columns added>

    Examples:
      | case                       | starting state                                  | expected columns added                                            |
      | fresh store                | no database file on disk at all                 | the columns arrive with the table's creation, not by a later ALTER |
      | the real upgrade           | schema version 7, populated                     | exactly two columns were added to `work_items`                     |
      | already migrated           | schema version 8, populated                     | no column was added and no ALTER was needed                        |
      | re-open of a migrated file | schema version 8 written by this build's own migration | no column was added and no ALTER was needed                  |

  # AC 2 — the DESIGNED NULL. The migration must not invent a timestamp for a row nobody
  # observed being reported. This is the scenario that forbids a well-meaning backfill.
  Scenario: existing rows read NULL after the migration — a fabricated `syncedAt` is never stamped
    When the store is opened with this build
    Then every `work_items` row that existed before the open reads `node_id` NULL and `updated_at` NULL
    And no pre-existing row was stamped with the migration's own clock, with the opening node's id, or with any other placeholder value
    And a row upserted AFTER the migration reads back with the writer's node id and its own `updated_at`, so the NULLs are the un-observed rows and only those
    # ADR-006: "Backfilling a fabricated timestamp is forbidden: it would assert a
    # freshness nobody observed." The read boundary renders these rows `unknown`
    # (task 02), which is a designed state, not a gap.

  # The migration marker and the forward guard — both are existing behaviour this bump
  # must not break, and both are cheap to read back.
  Scenario: the version bump records its migration once and still refuses a store from a newer build
    Given a global work store at schema version 7
    When the store is opened with this build and then opened again
    Then the store's migration metadata records the 7 → 8 upgrade exactly once — the second open adds no second marker
    And opening a store stamped at a schema version higher than this build supports is refused with the existing coded error, rather than being silently downgraded or re-migrated
