@cli @work @work-stream @executable
Feature: The runs/ log is a derived, prunable, absence-tolerant history of many runs per item
  In order that the run log stays an observability/resume artifact and never an authoritative second copy of item state
  the runs/ directory holds many independent run records that can be pruned file-by-file and read even when absent, with the directory regenerated on demand,
  so that history can be trimmed or wiped with no loss of authoritative state — the rebuildable/prunable derived-record property the PRD and milestones 05/09 require.

  # ARCHITECTURE ADR-002: runs/ is a DERIVED log. This feature asserts the observable
  # derived behaviours — many-runs-per-item (Issue != Task), absence tolerance, ordered
  # reads, and file-by-file prune + directory regeneration. The byte-level invariant
  # "pruning or rebuilding the log leaves the item record-doc frontmatter byte-identical"
  # is the acd-run-record-derived ARCH-TEST (fitness #1), NOT asserted here.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the run store loaded in-process from src/run-store.mjs

  # Every trigger produces a new run (PRD "Issue != Task"): N starts for one item yield
  # N discrete records, each its own file, distinguishable by runId — clean audit + retry.
  Scenario: many triggers produce many discrete runs for one item
    Given a milestone item "19"
    When I start 4 runs for item "19"
    Then the item's runs/ directory contains 4 files
    And reading the item's runs returns 4 records with 4 distinct runIds

  # History reads are ORDERED by runId (ADR-003: the runId is lexically sortable, so the
  # history reads back in creation order). The order is the observability contract
  # story 01's work:run-status surfaces — newest discoverable by position, not by a
  # re-sort the caller must do.
  Scenario: reading an item's runs returns them ordered by runId (creation order)
    Given item "19" has 3 persisted runs started in sequence
    When I read the runs for item "19"
    Then the 3 records are returned in ascending runId order
    And that order is the order they were created in

  # Absence-tolerant read: an item that has never run has no runs/ directory, and
  # reading its runs returns an empty history — not an error, not a thrown ENOENT.
  Scenario: reading the runs of an item with no runs/ directory returns an empty history
    Given a milestone item "19" with no runs/ directory
    When I read the runs for item "19"
    Then I get an empty run history
    And no error is raised

  # An item with an EMPTY runs/ directory (it exists but holds no records — e.g. after
  # every run was pruned) also reads as an empty history, not an error. Absence and
  # emptiness are the same benign signal.
  Scenario: reading the runs of an item with an empty runs/ directory returns an empty history
    Given a milestone item "19" with an existing but empty runs/ directory
    When I read the runs for item "19"
    Then I get an empty run history
    And no error is raised

  # Prune file-by-file: deleting one run record removes exactly that run from the
  # history; the other runs are untouched (a single-file delete, not a rewrite of an
  # aggregate — the partition-ready payoff, ADR-002). N runs minus one prune leaves
  # exactly N-1, and it is the RIGHT one that is gone.
  Scenario: pruning one run file removes exactly that run and leaves the others intact
    Given item "19" has 3 persisted runs
    When I prune the run record for the second run's runId
    Then the item's runs/ directory contains exactly 2 files
    And reading the item's runs returns 2 records
    And neither remaining record is the pruned run
    And both other runs are still present unchanged

  # Prune-then-read ordering: after pruning the middle run of three, the surviving two
  # still read back in ascending runId order with no gap or reshuffle — proving the
  # order is computed from the files present, not from a stale index.
  Scenario: pruning the middle run leaves the survivors readable in runId order
    Given item "19" has 3 persisted runs started in sequence
    When I prune the run record for the second run's runId
    And I read the runs for item "19"
    Then the 2 surviving records are returned in ascending runId order
    And the first and third created runs are the survivors

  # Boundary: pruning the ONLY run of an item empties the history to zero records, and
  # the subsequent read is the benign empty history (not an error) — the single-run
  # case of file-by-file prune.
  Scenario: pruning the only run of an item leaves an empty history
    Given item "19" has exactly 1 persisted run
    When I prune the run record for that run's runId
    Then reading the item's runs returns an empty run history
    And no error is raised

  # Boundary: pruning a runId that does not exist is a clean no-op — it removes nothing,
  # raises no error, and leaves the existing runs untouched (absence is benign, the same
  # discipline as the absent-runs/ read; ADR-002's derived log tolerates a missing
  # target rather than throwing).
  Scenario: pruning a non-existent runId is a clean no-op that changes nothing
    Given item "19" has 2 persisted runs
    When I prune the run record for a runId that does not exist
    Then no error is raised
    And reading the item's runs still returns the same 2 records
    And both original runs are present unchanged

  # Wipe + regenerate: deleting the whole runs/ directory leaves the item readable
  # (empty history) and the next run start regenerates the directory and writes into it
  # — the log is fully derived, so wiping it loses only derived data.
  Scenario: wiping runs/ leaves the item readable and the next start regenerates it
    Given item "19" has persisted runs
    When I delete the item's runs/ directory
    Then reading the item's runs returns an empty history
    When I start a new run for item "19"
    Then the item's runs/ directory exists again and contains exactly the new run

  # After a full wipe, the next run's runId sequence restarts from the count of files
  # PRESENT (ADR-003: <seq> is the count of pre-existing runs/ files). A wiped dir has
  # zero files, so the regenerated run gets seq 0000 again — the seq is positional over
  # the live directory, never a persisted high-water mark.
  Scenario: a run started after a wipe gets sequence 0000 again
    Given item "19" has 3 persisted runs
    When I delete the item's runs/ directory
    And I start a new run for item "19"
    Then the new run's runId "<seq>" segment is "0000"
    And the item's runs/ directory contains exactly that one new run
