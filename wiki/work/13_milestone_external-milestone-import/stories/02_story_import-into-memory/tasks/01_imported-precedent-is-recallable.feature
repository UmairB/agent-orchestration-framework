@cli @adapter @memory @executable
Feature: imported precedent is recall-able through the unchanged aof work memory recall verb
  In order for a later refine/review to surface a real prior milestone rather than a parsed file
  sitting inert on disk, an imported milestone's precedent must be returned by aof work memory recall
  alongside the work-stream records — carrying its resolving source:line and the same RecallResult
  shape as any other recall, with scope filters applying to imported records too.

  # ADR-003: imported records are indexed into the ONE store and are recallable through the SAME
  # aof work memory recall verbs with no agent-prompt change (the load-bearing "import reaches memory ->
  # grounds a future run" outcome). The verb surface is UNCHANGED.
  # ADR-004 (05, inherited): recall returns RecallResult { query, scope, records[], text }; an imported
  # record carries the frozen MemoryRecord fields plus a numeric score, exactly as a work-stream record.
  # ADR-001/005: a recalled imported record carries its source:line into the IMPORT STORE (the
  # rebuildable .md), never the external source repo.
  #
  # The `item` an imported record carries (DECIDED + DOCUMENTED here for the developer): the imported
  # records flow through the EXISTING parsers, which stamp `item` from the milestone-folder meta
  # (buildRecords' { item: item.number, itemSlug: item.slug }). The import store is NOT under workDir and
  # its folder is NOT an NN_type_slug name (ADR-004), so the materialized milestone has no work-stream
  # milestone NUMBER. The expectation this story pins: an imported record's `item` is a stable identifier
  # for the imported milestone (e.g. the import-store milestone ref), DISTINCT from any work-stream
  # milestone number, so `--item <work-stream-number>` does NOT match imported records and an
  # `--area architecture` (a content filter, not an item filter) DOES include imported adr records.
  # FEASIBILITY for the developer: confirm what value the extended scan stamps as `item` for an imported
  # record (the import-store milestone ref, since there is no NN_milestone number outside workDir) and
  # that recall scopes by it cleanly without colliding with a work-stream item number — see the summary.
  #
  # These scenarios run OFFLINE against a FIXTURE import store (frozen .aof/ layout) reindexed into the
  # local backend, so the lane is @executable. The STRUCTURAL invariants are story-03 arch-tests, NOT
  # scenarios here: "imported records are indexed only via the extended scan into the existing store, no
  # bespoke store / no direct index write / no graphify import" is acd-import-indexer-extends-scan +
  # acd-import-no-graphify-spawn; "every source:line resolves in the import store" is
  # acd-import-derived-index. Comment-only — do not restate them as Thens.

  Background:
    Given a fixture import store in the frozen .aof/ layout holding a recoverable milestone's precedent
    And a fixture work stream carrying its own RETROSPECTIVE.md lessons and ARCHITECTURE.md ADRs
    And the index has been reindexed over both the import store and the work stream

  Scenario: recall returns the imported milestone's precedent among the results
    When I run "aof work memory recall <query matching the imported milestone>"
    Then the command exits 0
    And the recalled records include a record sourced from the import store

  # ADR-004 (05): the imported record carries the SAME RecallResult shape and a resolving source:line.
  Scenario: a recalled imported record carries its source:line and the same RecallResult shape
    When I run "aof work memory recall <query matching the imported milestone> --json"
    Then the result has the top-level keys "query, scope, records, text"
    And the recalled imported record carries the MemoryRecord fields "recordType, id, item, itemSlug, title, area, stage, kind, owner, status, summary, text, source"
    And the recalled imported record's "source" resolves to live text at its "path:line" within the import store

  # ADR-006 (05, inherited): scope filters apply to imported records too. --area is a CONTENT filter
  # (architecture), so it includes imported adr records (which always carry area "architecture").
  Scenario: an --area filter includes imported adr records
    When I run "aof work memory recall <query> --area architecture"
    Then the recalled records include the imported "adr" record
    And every recalled record carries area "architecture"

  # --item scopes by the milestone identifier a record carries. An imported record's `item` is the
  # import-store milestone ref (see the header note), DISTINCT from a work-stream number — so an --item
  # filter naming a WORK-STREAM milestone number excludes the imported records (they are not that item).
  Scenario: an --item filter naming a work-stream milestone excludes imported records
    Given the fixture work stream holds a milestone numbered "01"
    When I run "aof work memory recall <query> --item 01"
    Then no recalled record is sourced from the import store

  # The load-bearing outcome: at a decision point an agent recall surfaces the imported precedent
  # ALONGSIDE work-stream lessons — import reaching memory grounds a future run (SPEC's "a capability
  # nothing invokes grounds nothing" win), through the UNCHANGED recall verb.
  Scenario: an agent recall at a decision point surfaces imported precedent alongside work-stream lessons
    Given the import store and the work stream both hold precedent matching a decision-point query
    When I run "aof work memory recall <decision-point query>"
    Then the recalled records include a record sourced from the import store
    And the recalled records include a record sourced from the work stream

  # The query/scope -> recalled-or-not matrix. Asserts whether the imported record is among the recalled
  # records for a representative set of queries and scopes. "recalled" column: yes = the imported record
  # is in the results; no = it is excluded. A matching query with no item filter (or a content filter the
  # imported record satisfies) recalls it; an --item filter naming a work-stream milestone excludes it; a
  # query matching nothing in the import store does not recall it.
  Scenario Outline: a query and scope decide whether the imported record is recalled
    When I run "aof work memory recall <query> <scope>"
    Then the imported record is <recalled> among the results

    Examples: a matching query surfaces the imported record (unscoped / content-scoped)
      | query                           | scope             | recalled |
      | <imported milestone topic>      | (none)            | yes      |
      | <imported milestone topic>      | --area architecture | yes    |

    Examples: an item filter naming a work-stream milestone excludes the imported record
      | query                           | scope             | recalled |
      | <imported milestone topic>      | --item 01         | no       |

    Examples: a query matching nothing imported does not recall it
      | query                           | scope             | recalled |
      | <off-topic work-stream term>    | (none)            | no       |
