<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — AC5: `applyDeltaFrame` (`control-stream-server.mjs:177-202`) collapses to a call
# on the shared seam — its read-merge-republish dance existed only to feed the wholesale writer —
# and that RETIRES its P0.3 hazard, recorded in its own source comment: *"one partial delta …
# rolls back the ENTIRE `BEGIN IMMEDIATE` txn and silently drops every OTHER item in the same
# frame"*. With a row upsert there is no whole-workspace transaction for one bad row to abort.
# The same collapse applies to `applySnapshotFrame`, which today feeds the frame's items to the
# wholesale writer and therefore REPLACES the whole workspace's rows with whatever subtree the
# worker happened to send.
# LITMUS: every Then is confirmable from a fresh read of the workspace's cached rows through the
# store's public read surface (the rows `/api/mesh/status` renders as `items[]`) plus the frame
# apply's own RESULT — the counted skips and the coded refusals it returns. No source read: "there
# is no longer a whole-workspace transaction" is proven by what SURVIVES a bad row, never by
# reading the transaction's absence.
# 43/04 dependency: none — every Then here is column-free.

@executable @cli @work @distribution
Feature: a worker frame lands row by row — one bad row is skipped and counted, and never takes the good rows with it
  In order that a single malformed row in a streamed frame can no longer silently drop every other item in that frame, nor the workspace's already-cached rows
  applying a frame must upsert each row independently, skip and count the ones it cannot store, and leave every row it did not name exactly as it was

  Background:
    Given a fresh mesh cache with the workspace "acme" registered
    And the control has published, so "43/01", "43/02" and "43/03" are cached rows it authored
    And a worker node "worker-a" whose stream connection to the control is authenticated as "worker-a"

  # THE P0.3 REGRESSION, stated as the outcome: one bad row among several good ones, in ONE frame.
  # Today every good row in that frame is silently discarded along with it, and the workspace's
  # already-published rows are rolled back too.
  Scenario: a frame carrying one unstorable row and several good ones lands every good row
    When "worker-a" streams a frame carrying good rows for "43/01" and "43/02", one unstorable row for a ref it has never reported, and a good row for a new ref "43/04"
    Then a fresh read of the cached rows reports "43/01" and "43/02" with the values the frame carried
    And it reports the new "43/04"
    And it still reports "43/03", which the frame never named
    And the frame's result counts exactly one skipped row

  # The unstorable-row case matrix. Each shape must be SKIPPED and COUNTED — never fatal to the
  # frame, never stored as a half-row, and never able to blank an already-cached row for that ref.
  Scenario Outline: every unstorable row shape is skipped and counted, and the frame's other rows still land
    Given the cached row for "43/02" reports status "in-progress"
    When "worker-a" streams a frame carrying <bad_row> alongside a good row for "43/01"
    Then the frame's result counts that row among its skipped rows
    And a fresh read of the cached rows reports "43/01" with the values the frame carried
    And the cached row for "43/02" still reports status "in-progress"

    Examples: the shapes a frame can carry that a row cannot be built from
      | bad_row                                            |
      | a row with no `ref`                                |
      | a row whose `ref` is an empty string               |
      | a row with no `type`                               |
      | a row with no `slug`                               |
      | a row with no `sourcePath`                         |
      | a row for "43/02" carrying only a `status`         |
      | an entry that is null                              |
      | an entry that is not an object                     |
      | a row whose `title` is a list                      |
      | a row whose `status` is a list                     |
      | a row whose `parent` is a map                      |
      | a row whose `status` is a boolean                  |

  # ADDED at 43/02's structural review (ADR-012/B5), because the eight rows above are
  # ALL missing-or-empty REQUIRED strings and so cannot reach the defect AC5 claims to
  # retire. The four rows added to them carry a value that is PRESENT and WELL-FORMED for
  # a reader but cannot be bound as a SQLite parameter — the shape both reviewers
  # reproduced, which aborted the whole frame and left ZERO rows. The scenario below is
  # the DISK half of the same defect, which no frame Examples row can reach: it arrives
  # from ordinary operator input, because `parseFrontmatter` deliberately turns an inline
  # `title: [alpha, beta]` into an array, and it froze every other item in the workspace
  # on every tick until a human edited that one doc.

  # Two rows for the SAME ref inside one frame is a shape the wholesale INSERT could not survive
  # at all (a primary-key collision aborting the transaction). An upsert must simply settle on the
  # last one and land the rest of the frame.
  Scenario: a frame carrying two rows for the same ref stores the last one and never aborts the frame
    When "worker-a" streams a frame carrying two rows for "43/02" with different statuses, and a good row for "43/01"
    Then a fresh read of the cached rows reports exactly one row for "43/02", with the status of the frame's LAST row for that ref
    And it reports "43/01" with the values the frame carried

  Scenario: one record doc whose frontmatter carries a list-valued title never stops the workspace publishing
    Given the control has published, so "43/01" and "43/03" are cached
    When "43/03"'s record doc frontmatter sets `title: [alpha, beta]` and the control's disk moves "43/01" to status "done"
    Then a fresh read of the cached rows reports "43/01" with status "done"
    And the publish result counts "43/03" among its skipped rows, naming that ref
    And the cached row for "43/03" still reports its last good title

  # A worker's FULL snapshot frame is scoped to the subtree it is working — so it may add and
  # update, but it claims authority over nothing else and must remove nothing. (Today it feeds the
  # wholesale writer and replaces the entire workspace's rows with its own subtree.)
  Scenario: a worker's full snapshot frame adds and updates only the refs it carries
    When "worker-a" streams a full snapshot frame carrying only "43/02" and a new "43/05"
    Then a fresh read of the cached rows reports "43/02" and "43/05" with the values the frame carried
    And it still reports "43/01" and "43/03", which the frame never named

  # Regression guards on the frame gate that must survive the collapse: an unregistered workspace
  # is still refused rather than published under a fabricated path, and a malformed frame
  # timestamp still falls back to the server clock rather than being stamped verbatim.
  Scenario: a frame for an unregistered workspace is still refused, and writes nothing
    When "worker-a" streams a frame for a workspace id that has no registered descriptor
    Then the apply returns the coded skip "unknown-workspace"
    And a fresh read of "acme"'s cached rows is unchanged

  Scenario: a frame carrying a malformed timestamp still lands, stamped from the server clock
    When "worker-a" streams a frame for "43/02" whose frame timestamp is not a valid instant
    Then a fresh read of the cached rows reports "43/02" with the values the frame carried
    And the apply's result reports a valid ISO instant, never the malformed value verbatim
