@cli @adapter @memory @executable
Feature: reindex extends its scan to the import store, so imported adr/lesson records land in the one memory index
  In order for imported precedent to be recall-able through the unchanged aof work memory verbs
  reindex must scan the .aof/ import store IN ADDITION to the work stream, run the EXISTING
  parseArchitecture/parseRetrospective UNTOUCHED over the materialized .md, and emit the imported
  adr/lesson records as frozen MemoryRecords into the EXISTING index alongside the work-stream records.

  # ADR-003: imported knowledge feeds the EXISTING 05/10 memory backend by EXTENDING buildRecords'
  # scan to the import store (a SECOND scan root) — running the SAME parsers into the SAME derived store
  # (.aof/aof.memory.index.json), the localised additive change 05/ADR-007 prescribes. There is NO
  # bespoke import store and NO new index path.
  # ADR-001: the import is a PRODUCER of .md in the two shapes the existing parsers already read —
  # an "## ADR-NNN" block -> an adr record, a "## R<n>" entry -> a lesson record — so imported records
  # carry the frozen MemoryRecord shape with NO new parser. SPEC.md is the recovered intent: legible,
  # NOT an index record source (it has no ADR/lesson structure to parse).
  # ADR-005: the materialized .md is the derived, rebuildable source — every imported record's
  # source:line resolves to live text WITHIN the import store (the source repo is read-only/external and
  # is never the source:line target).
  #
  # These scenarios run OFFLINE against a FIXTURE import store in story 00's frozen .aof/ layout
  # (materialized .md, no recovery engine and no binary needed) plus a fixture work stream, so the lane
  # is @executable. The STRUCTURAL invariants are story-03 arch-tests, NOT scenarios here:
  # "imported knowledge is indexed ONLY by extending the existing scan into the existing index path — no
  # bespoke store, no direct write of aof.memory.index.json, no import of src/graphify.mjs / spawn of
  # graphify" is acd-import-indexer-extends-scan + acd-import-no-graphify-spawn; "every record is the
  # frozen MemoryRecord from the existing parsers and SPEC.md is never a record source" is
  # acd-import-artifact-shape; "every source:line resolves in the import store and a re-import reproduces
  # the identical set" is acd-import-derived-index. Comment-only — do not restate them as Thens.

  Background:
    Given a fixture import store in the frozen .aof/ layout holding a materialized milestone
    And its knowledge artifact carries an ARCHITECTURE.md with "## ADR-NNN" blocks and a RETROSPECTIVE.md with "## R<n>" entries
    And a fixture work stream whose milestone folders carry RETROSPECTIVE.md and/or ARCHITECTURE.md sources

  Scenario: reindex scans the import store in addition to the work stream
    When I run "aof work memory reindex"
    Then the command exits 0
    And the rebuilt index contains the imported milestone's "adr" records
    And the rebuilt index contains the imported milestone's "lesson" records

  # ADR-001/005: an imported record is the same frozen MemoryRecord as a work-stream record, and its
  # source:line resolves into the import store (not the external source repo).
  Scenario: each imported record is a frozen MemoryRecord whose source resolves within the import store
    When I run "aof work memory reindex"
    Then every imported record is a frozen MemoryRecord
    And every imported record's "source" resolves to live text at its "path:line" within the import store

  # ADR-003: one index, extended scan — the imported records sit ALONGSIDE the work-stream records.
  Scenario: imported records sit alongside work-stream records in the one index
    When I run "aof work memory reindex"
    Then the index contains at least one record sourced from the work stream
    And the index contains at least one record sourced from the import store

  # ADR-001: the SAME parsers produce the imported records — an imported "## ADR-NNN" yields recordType
  # "adr", an imported "## R<n>" yields recordType "lesson" (the same values the work stream produces).
  Scenario: the imported records are produced by the same parsers as the work stream
    When I run "aof work memory reindex"
    Then an imported "## ADR-NNN" block becomes a record of recordType "adr"
    And an imported "## R<n>" entry becomes a record of recordType "lesson"

  # The import-store-content -> resulting-records matrix. ADR-001: ARCHITECTURE-shaped .md yields adr
  # records; RETROSPECTIVE-shaped .md yields lesson records; SPEC.md present yields NO records (it is
  # legible recovered intent, not a record source — the absence of an ADR/lesson structure to parse).
  # "records" column = the recordType(s) the scan derives from that artifact; "(none)" = no record is
  # produced from that artifact.
  Scenario Outline: an import-store artifact yields the records its shape produces, or none
    Given the import store holds a "<artifact>" with <content>
    When I run "aof work memory reindex"
    Then the imported records derived from that artifact are <records>

    Examples: the two knowledge shapes yield records via the existing parsers
      | artifact         | content                  | records |
      | ARCHITECTURE.md  | "## ADR-NNN" blocks      | adr     |
      | RETROSPECTIVE.md | "## R<n>" entries        | lesson  |

    Examples: SPEC.md is legible intent, never a record source (ADR-001)
      | artifact | content              | records |
      | SPEC.md  | a recovered Objective | (none)  |
