@cli @work @work-stream @executable
Feature: The run store persists each run as a derived per-run JSON file under the item's runs/ and reads them back
  In order to separate the durable work item from each run of it (the PRD "Issue ≠ Task" mechanic) with a clean audit trail
  the run store creates one runs/<run-id>.json file per run carrying the frozen run-record schema and reads an item's runs back from that directory,
  so that a run becomes a first-class, durably-recorded entity distinct from the item — the foundation story 01's commands and milestones 20/21 all couple through.

  # This is the SPINE of the milestone (ARCHITECTURE ADR-002/003): src/run-store.mjs
  # owns the per-run JSON store under runs/ and the frozen run-record schema. This
  # feature asserts the CREATE + READ + SCHEMA surface; the state machine is task 01,
  # the derived/prune lifecycle is task 02. The store reads the item.dir that work.mjs
  # listItems already resolves — runs/ sits inside the item's own folder. Path display
  # is not in play here (a run record carries refs, not absolute paths).
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the run store loaded in-process from src/run-store.mjs

  # Starting a run writes exactly ONE file, named by its runId, under the item's runs/
  # directory (ADR-002: one file per run, not a monolithic log). The directory is
  # created if absent (it is derived — nothing pre-creates it).
  Scenario: starting a run persists exactly one JSON file under the item's runs/ directory
    Given a milestone item "19" with no runs/ directory yet
    When I start a run for item "19"
    Then the item's runs/ directory contains exactly one file
    And that file is named "<runId>.json" for the new run's runId
    And the file parses as JSON carrying the run record

  # A newly-started run carries the COMPLETE frozen schema (ADR-003) in its initial
  # shape — every one of the nine frozen fields is present and correctly typed: state
  # running, outcome null (not yet terminal), attempt 1 (the foundation baseline; m20's
  # retry mechanic increments it), brief present as an object, and the createdAt/
  # updatedAt instants equal at start.
  # QA: this scenario pins EVERY frozen field of the schema — runId, itemRef, state,
  # attempt, outcome, sessionId, brief, createdAt, updatedAt — so no field can drift
  # out of the persisted shape unnoticed.
  Scenario: a new run record carries the complete frozen schema in its initial running shape
    When I start a run for item "19" with sessionId "sess-abc"
    Then the run record has a string "runId"
    And the run record "itemRef" is "19"
    And the run record "state" is "running"
    And the run record "attempt" is 1
    And the run record "outcome" is null
    And the run record "sessionId" is "sess-abc"
    And the run record has an object "brief"
    And the run record has an ISO-8601 "createdAt" instant
    And the run record has an ISO-8601 "updatedAt" instant
    And the run record "createdAt" and "updatedAt" are equal at start
    And the run record carries no field outside the frozen schema

  # The runId form is frozen (ADR-003): "<createdAt-compact>-<seq>" where the compact
  # createdAt is YYYYMMDDTHHMMSSsssZ (UTC, ms precision, punctuation stripped) and seq
  # is a zero-padded 4-digit per-item monotonic counter. The first run of an item gets
  # seq 0000; the compact stem is exactly the createdAt with colons/dots stripped.
  Scenario: the runId encodes the createdAt instant and a zero-padded per-item sequence
    Given a milestone item "19" with no runs/ directory yet
    When I start a run for item "19"
    Then the run record "runId" matches the form "<createdAt-compact>-<seq>"
    And the "<seq>" segment of the runId is "0000" for the item's first run
    And the "<createdAt-compact>" segment equals the run's "createdAt" with punctuation stripped

  # The runId is lexically sortable AND unique within an item (ADR-003: a
  # creation-timestamp + per-item sequence). Runs started in sequence sort
  # chronologically by runId and never collide — the property the history order and
  # the prune-safety both rest on.
  Scenario: runIds started in sequence are distinct and sort lexically into creation order
    When I start 3 runs in sequence for item "19"
    Then the 3 run records have 3 distinct runIds
    And sorting the runIds lexically yields them in creation order

  # Same-instant uniqueness (ADR-003): the <seq> segment disambiguates ids minted with
  # NO time gap. Two runs created at the identical createdAt instant share the same
  # compact-timestamp stem but get sequential <seq> segments (0000, 0001), so their
  # runIds are still distinct AND still sort into creation order — the seq segment, not
  # the clock, carries the tie-break.
  Scenario: two runs created at the same instant get distinct runIds via the sequence segment
    Given the run store mints two runs for item "19" at the identical createdAt instant
    Then the two runIds are distinct
    And the two runIds share an identical "<createdAt-compact>" segment
    And the two "<seq>" segments are "0000" and "0001"
    And sorting the two runIds lexically yields them in creation order

  # The brief is persisted OPAQUE (ADR-003): an arbitrary structured object passed at
  # start round-trips byte-equivalent and the store never interprets it — so m20/the
  # skills can grow its inner shape with zero schema churn here.
  Scenario: a flat structured brief is persisted opaque and round-trips unchanged
    Given a structured brief object with workspace, initiator and resources fields
    When I start a run for item "19" with that brief
    And I read the run back from runs/
    Then the run record "brief" equals the object I passed, byte-equivalent

  # The opaqueness must hold for a DEEPLY NESTED brief, not just a flat one: nested
  # objects, an array of objects, and mixed scalar types all survive the JSON
  # round-trip byte-equivalent and key-order-preserved — proving the store truly never
  # reshapes the brief (the forward-stability ADR-003 freezes opaque for).
  Scenario: a deeply nested brief round-trips byte-equivalent through persistence
    Given a structured brief whose "resources" holds a nested object and an array of objects
    And the brief mixes string, number, boolean and null leaf values at depth 3
    When I start a run for item "19" with that brief
    And I read the run back from runs/
    Then the run record "brief" equals the object I passed, byte-equivalent
    And the nested keys appear in the same order they were passed

  # sessionId is nullable (ADR-003): a run started without a session records null, not
  # a missing key or an empty string — the field is always present.
  Scenario Outline: sessionId is recorded when supplied and null when omitted
    When I start a run for item "19" <session-arg>
    Then the run record "sessionId" is <recorded>
    And the run record always has a "sessionId" key present

    Examples:
      | session-arg                | recorded   |
      | with sessionId "sess-xyz"  | "sess-xyz" |
      | with no sessionId          | null       |

  # Reading an item's runs returns every persisted run for THAT item. The read is the
  # observability primitive story 01's work:run-status wraps.
  Scenario: reading an item's runs returns every persisted run for that item
    Given item "19" has 2 persisted runs
    When I read the runs for item "19"
    Then I get 2 run records
    And every record's "itemRef" is "19"

  # A run persisted to disk is loadable AS-IS after a fresh store load — the schema
  # survives the JSON round-trip with every field intact (the durability the resume
  # log rests on). Note: the full start->complete-survives-restart end-to-end is a
  # story-01 .feature over the real command; here we assert only the store re-read.
  Scenario: a persisted run reloads from disk with its frozen schema intact
    Given item "19" has 1 persisted run started with sessionId "sess-load" and a nested brief
    When I load the run store fresh and read the runs for item "19"
    Then I get 1 run record
    And that record's "sessionId" is "sess-load"
    And that record's "brief" equals the persisted object, byte-equivalent
    And that record carries all nine frozen schema fields

  # A story's runs live under the STORY folder's own runs/ (ADR-002), never pooled at
  # the parent milestone — so the future <node> partition and per-item pruning are
  # scoped to the item that owns the run.
  Scenario: a story's runs live under the story folder's own runs/, not the milestone's
    Given a milestone "19" with a story "19/00"
    When I start a run for item "19/00"
    Then the run file is written under the story "19/00" folder's runs/ directory
    And the run record "itemRef" is "19/00"
    And the milestone "19" runs/ directory does not contain that run
