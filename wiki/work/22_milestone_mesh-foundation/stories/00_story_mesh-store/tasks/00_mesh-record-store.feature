@cli @work @distribution @executable
Feature: The mesh-store persists each node record as a git-tracked per-node JSON file under the partition root and reads it back
  In order to make the git-tracked work stream the mesh's bus without two nodes ever fighting over a file
  the mesh-store writes one nodes/<node-id>.json file per node atomically under the partition root and reads an item back from that path,
  so that a node's record is a durable, git-tracked, derived artifact the sync engine can move and a peer can read — the spine stories 01 (identity) and 02 (sync) and milestones 23/24/26 all couple through.

  # This is the SPINE of the milestone (ARCHITECTURE ADR-002/003): src/mesh-store.mjs owns
  # the per-node JSON persist/read under the partition root and routes every write through
  # the atomic writeText seam (19/R2). This feature asserts the PERSIST + READ + ATOMIC +
  # PARTITION-by-node surface; the single-seam discipline + write-scope are the
  # acd-mesh-partition-write / acd-mesh-write-scope ARCH-TESTS (fitness #1/#2), not scenarios.
  # The store persists a node-record OBJECT given to it — node-id derivation + descriptor
  # ASSEMBLY are story 01. Records carry no absolute paths (a record is node-keyed data).
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh-store loaded in-process from src/mesh-store.mjs
    And a node-record object for node id "umair-desktop" in the frozen schema shape

  # Publishing a node record writes exactly ONE file, named by the node id, under the
  # partition root's nodes/ directory (ADR-002: one file per node, never an aggregate).
  # The directory is created if absent (the partition root is derived — nothing pre-creates it).
  Scenario: publishing a node record persists exactly one JSON file named by the node id
    Given the partition root has no nodes/ directory yet
    When I publish the node record for "umair-desktop"
    Then the partition root's nodes/ directory contains exactly one file
    And that file is named "umair-desktop.json"
    And the file parses as JSON equal to the published node record

  # Read-back round-trips byte-equivalent — the store persists the record as-is and never
  # mutates it (it is derived data, not a thing the store interprets).
  Scenario: reading a published node record round-trips byte-equivalent
    Given I have published the node record for "umair-desktop"
    When I read the node record for "umair-desktop"
    Then the read record is byte-equivalent to the published record

  # Opaqueness must hold for a record carrying a forward-stable additive field the store has
  # never seen (ADR-003 is additive-friendly: capability routing grows the schema with zero
  # churn). The store persists the record AS-IS — an unknown top-level key (a future
  # "load"/"tags") plus a nested array of objects survive the JSON round-trip byte-equivalent
  # and key-order-preserved, proving the store never reshapes a record it is handed.
  Scenario: a record with unknown additive keys round-trips byte-equivalent and key-order-preserved
    Given a node-record object for "umair-desktop" carrying an unknown top-level "tags" array of objects
    And the record mixes string, number, boolean and null leaf values at depth 3
    When I publish that record and read it back from the partition root
    Then the read record equals the published object, byte-equivalent
    And the read record's keys appear in the same order they were published
    And the store added, dropped, and reordered no key

  # Absence-tolerant read (the run-store ENOENT -> absent discipline): a node id with no
  # record on disk reads as absent, NEVER a thrown error — a peer not yet synced is not an error.
  Scenario: reading a node id with no record reads as absent, not an error
    Given the partition root's nodes/ directory has no record for "umair-mbp"
    When I read the node record for "umair-mbp"
    Then the read result is absent
    And no error is raised

  # Two distinct node ids write two distinct files — the partition property (ADR-002) the
  # whole add-only-merge thesis rests on: two nodes never write the same path.
  # R4: pin the UNAFFECTED side too — publishing the second node leaves the FIRST node's file
  # byte-unchanged, and reading one peer back never touches the other's record on disk.
  Scenario: two distinct node ids persist as two distinct files, never the same path
    Given a node-record object for node id "umair-mbp" in the frozen schema shape
    When I publish the node record for "umair-desktop"
    And I record the on-disk bytes of "umair-desktop.json"
    And I publish the node record for "umair-mbp"
    Then the partition root's nodes/ directory contains exactly two files
    And the two files are "umair-desktop.json" and "umair-mbp.json"
    And "umair-desktop.json" is byte-identical to before "umair-mbp" was published
    When I read the node record for "umair-mbp"
    Then the read record is the "umair-mbp" record
    And "umair-desktop.json" on disk is still byte-identical (the read mutated no file)

  # Republishing the same node id overwrites that node's own file in place — a node owns its
  # own record; it never accumulates a history of files (identity is current-state, not a log).
  # R4: pin the UNAFFECTED side — republishing "umair-desktop" leaves a SIBLING node's file
  # ("umair-mbp.json") byte-unchanged, so a node's own update never disturbs a peer's record.
  Scenario: republishing the same node id overwrites that node's own single file and leaves siblings untouched
    Given I have published the node record for "umair-desktop"
    And I have published a node record for "umair-mbp"
    And I record the on-disk bytes of "umair-mbp.json"
    When I publish an updated node record for "umair-desktop"
    Then the partition root's nodes/ directory still contains exactly two files
    And there is still exactly one file named "umair-desktop.json"
    And "umair-desktop.json" parses as JSON equal to the updated record
    And "umair-mbp.json" is byte-identical to before the republish (the sibling was untouched)
