<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — ADR-005 STAGE 2: the remaining control-side leaves migrate onto the
# seam, in any order, EACH INDEPENDENTLY REVERTIBLE. RESEARCH §5.2's per-module list
# is the coverage map: `commands/next:25`, `commands/find:27`, `commands/list:27`,
# `commands/run-start:119`, `commands/mesh-heartbeat:70`,
# `commands/promote-gap-to-chore:95`, `commands/notion-associate:120`,
# `notion/sync-work:121`, `memory/local-indexing:596`, `mesh-assignment:111,177`,
# `mesh-assignment-reclaim:134`, and `mesh-launcher:390`'s INJECTED `listItemsFn`
# (default wired at `:493` — it migrates by swapping a default, not by editing a
# call site).
#
# This task completes rule 3's headline: with `next`, `find` and `list` migrated,
# ALL SIX surfaces (`next`, `find`, `list`, `doc`, `tasks`, `run-status`) read a
# remote-authored item correctly after the worker's worktree is gone. `doc` / `tasks`
# / `run-status` arrived at stage 1 (task 01); the three here close it.
#
# WAVE 3 (ADR-009) — presupposes 43/02 and 43/04, exactly as tasks 00/01 do.
#
# LITMUS: every Then is confirmable from a command's `--json` document, or — for the
# two leaves with no verb of their own (`mesh-assignment-reclaim`, `mesh-launcher`'s
# injected default) — from an outcome a verb CAN see: an item becoming re-assignable,
# and the launcher aggregation's own returned union (its `listItemsFn` is already an
# injected seam, so the default swap is exercised through the API the m41 story-01
# precedent allows). No source read.
#
# RESIDUAL CONCERN to the ARCHITECT — `promote-gap-to-chore:95` may be MIS-CLASSIFIED
# by ADR-005. Its `listItems` call is `defaultAt(workDir)`: it COUNTS top-level items
# to choose the append position for a chore folder it is about to CREATE ON DISK, and
# then hands that position to the m41 reindex engine. That is a structural-placement
# read, and by SPEC's own out-of-scope bullet the disk is the SUBJECT of it. If the
# count comes from a cache that knows refs this disk does not, the insert lands past
# the end of the real stream and leaves a numbering GAP. The scenario below is written
# so it catches that whichever way the leaf is built — it asserts the outcome
# (`validate` green, no gap), not the source — and the classification question is
# routed to the architect rather than silently decided by QA.
#
# RESIDUAL CONCERN to the DEVELOPER — the REACH-THROUGH, again (task 01 concern 1) in
# its stage-2 forms: `run-start:119`'s fleet sweep reads run records out of each
# candidate's `dir`; `memory/local-indexing:596` reads each item's markdown out of its
# `dir`; `notion/sync-work:121` walks a milestone's docs. A cache-answered row's `dir`
# is not on this node. The obligation asserted below is uniform: never crash, never
# fabricate a path, and never emit a record whose `source` does not resolve to real text.

@executable @cli @work @distribution
Feature: the remaining control-side readers migrate onto the seam one leaf at a time, each answering from the cache and each saying so
  In order that the operator's whole read surface — not just the commands that happen to sit on one resolver — tells the truth about work done on another machine
  every remaining control-side reader must answer from the cache with its provenance stamped, while a disk-known ref's answer stays byte-identical to what it was before the leaf moved

  Background:
    Given a control node whose cache holds milestone "07" (status "done") and its story "07/01" (status "done"), both last reported by the REMOTE node "aof-wsl"
    And the control node's own disk holds milestones "05" and "06" it authored itself, plus only the pre-run scaffold for "07" (status "not-started")
    And the control node's disk holds no folder at all for "07/01"
    And the worker's worktree has been deleted, so no further worker tick will ever correct the control's disk
    And no assignment is active over any of those refs (a gate)

  # THE HEADLINE, completed: with the leaves migrated, all six of the surfaces the
  # operator touches read the remote-authored item correctly, and each says whose view
  # it is. This is the milestone's whole point stated as one scenario.
  Scenario: all six read surfaces answer correctly for a remote-authored item whose worktree is gone
    When I run `aof work find 07/01 --json`
    Then the row for "07/01" is reported with status "done", `answeredFrom` "cache" and `reportedBy` "aof-wsl"
    And a fresh `aof work list --json` lists "07/01" under "07" with the worker's status, not the control scaffold's
    And a fresh `aof work next --json` does not offer "07" or "07/01" as actionable (the cache says they are done)
    And a fresh `aof work doc 07/01 STORY --json` returns the worker's STORY.md, reported from the cache
    And a fresh `aof work tasks 07/01 --json` returns the worker's task features
    And a fresh `aof work run-status 07/01 --json` returns the worker's run rows

  # `next` is the leaf SPEC.md names explicitly as pure disk today. Its migration is
  # worth its own scenario because it changes a DECISION, not just a display: a driver
  # that is done only in the cache must unblock its dependents, or the operator is told
  # to wait on work that is finished.
  Scenario: a driver milestone that is done only in the cache unblocks its dependent
    Given the control disk holds milestone "08" whose `depends` names "07"
    And the control's own disk still reads "07" as "not-started"
    When I run `aof work next --json`
    Then the result is not `blocked` on "07"
    And the offered item is "08"
    And the offered row reports `answeredFrom` for the driver status it acted on

  # QA case matrix — every stage-2 leaf by name, with the observable surface that
  # proves it answers from the cache. Rule 4: each row says WHICH SIDE answered it.
  # Rows are grouped by their observable, not by their file, because the file is the
  # developer's business and the surface is the operator's.
  Scenario Outline: each stage-2 leaf answers the remote-authored ref from the cache
    When I run <invocation>
    Then the command exits 0
    And <observable>
    And the answer reports the answering side as "cache" for the "07"/"07/01" rows

    Examples: the control-side leaves RESEARCH §5.2 enumerates
      | leaf                          | invocation                                                | observable                                                                 |
      | commands/next:25              | `aof work next --json`                                    | the candidacy decision uses the cache's "done" for "07", not the scaffold's |
      | commands/find:27              | `aof work find 07/01 --json`                              | the row for "07/01" is returned with status "done"                          |
      | commands/list:27              | `aof work list --json`                                    | "07/01" appears under "07" with the worker's status                         |
      | commands/run-start:119        | `aof work run-start 05 --json`                            | the fleet sweep considered "07" among the candidates and did not fault      |
      | commands/mesh-heartbeat:70    | `aof mesh heartbeat --json`                               | the reported `activeRuns` union includes the cache-known item's run         |
      | commands/notion-associate:120 | `aof work integrations notion associate 07 --json`        | "07" resolves rather than failing "ref-not-found"                           |
      | notion/sync-work:121          | `aof work integrations notion sync-work 07 --dry-run --json` | the projection plan covers "07" and its story "07/01"                    |
      | memory/local-indexing:596     | `aof work memory ingest --json`                           | "07" is among the items the rebuild considered                              |
      | mesh-assignment:111,177       | `aof mesh assign 07/01 --to aof-wsl --json`               | the assignment is minted against the resolved cache-known ref               |

  # The two leaves with no verb of their own, each proven through an outcome a verb
  # CAN see. `mesh-assignment-reclaim:134` is the control-side dual-staleness reclaim;
  # `mesh-launcher:390` is an already-injected seam whose default is swapped.
  Scenario: the reclaim path resolves a cache-known ref, so a stale holder's item becomes re-assignable
    Given "07/01" is held by an assignment whose holder node has gone presence-stale
    And "07/01" exists only in the cache, with no folder on the control node's disk
    When the control-side reclaim runs
    Then a fresh `aof mesh assign 07/01 --to <another node> --json` exits 0
    And the reclaim did not skip "07/01" as unresolvable

  Scenario: the launcher's injected item reader defaults to the seam, so the control's published union sees cache-known items
    Given the launcher's aggregation is called with its DEFAULT item reader (no injection)
    And the cache holds an in-flight run for "07/01", which has no folder on the control node's disk
    When the aggregation assembles its active-run union
    Then the union includes the run for "07/01"
    And the aggregation reports no per-workspace fault for the absent local folder

  # RESIDUAL CONCERN, decided as a scenario: `promote-gap-to-chore` computes an INSERT
  # POSITION. Whatever it reads, the stream it renames is the DISK's — so the outcome
  # must be a gapless, valid stream. This Then catches a cache-derived position that
  # overshoots the real folder set, without asserting where the number came from.
  Scenario: promoting a gap to a chore leaves the on-disk stream gapless and valid, however the position is derived
    Given the control disk holds top-level items "05" and "06", while the cache additionally knows "07"
    When I run `aof work promote-gap "warnings_delivered field" --discharge "a production path writes warnings_delivered" --json`
    Then the command exits 0 and reports the created chore's ref
    And the created chore's folder exists on the control node's disk at the ref it reported
    And the control node's top-level folder numbers form an unbroken run from "00" with no gap
    And a fresh `aof work validate --json` over the whole stream reports zero findings

  # THE REACH-THROUGH obligation, stated once for every leaf that reads THROUGH a row:
  # a row whose folder is not on this node must never crash a leaf, and must never
  # produce a record pointing at a path that does not exist.
  Scenario Outline: a leaf that reads through a cache-answered row never faults and never fabricates a path
    Given "07/01" is known only to the cache and has no folder on the control node's disk
    When I run <invocation>
    Then the command exits 0
    And no reported path, `source` or `dir` names a file that does not exist on this node
    And the absent local folder is reported, not swallowed

    Examples: the leaves that reach through a row into its folder
      | leaf                      | invocation                                                   |
      | commands/run-start:119    | `aof work run-start 05 --json`                               |
      | memory/local-indexing:596 | `aof work memory ingest --json`                              |
      | notion/sync-work:121      | `aof work integrations notion sync-work 07 --dry-run --json` |

  # INDEPENDENT REVERTIBILITY, in its single-build observable form: a migrated leaf
  # changes its answer ONLY for refs the cache knows better. Every disk-known ref's
  # answer is byte-identical to what it was before stage 2 — so reverting one leaf can
  # only ever un-answer cache-known refs, and can never disturb the rest of the stream.
  Scenario: a disk-known ref's answer is byte-identical before and after the leaves migrate
    When I run `aof work find 05 --json`
    Then the row for "05" carries exactly the status, type, slug, title and parent the disk holds
    And a fresh `aof work list 05 --json` renders the same rows, in the same order, as before stage 2
    And a fresh `aof work next 05 --json` offers the same item it offered before stage 2
    And each of those rows reports `answeredFrom` for itself, adding provenance without changing any other field

  # The fallback is inherited whole by every leaf, not re-implemented per leaf: with the
  # cache absent, every migrated command still answers — from disk, and says so.
  Scenario: with the cache absent, every migrated leaf still answers from disk
    Given the control node's cache is absent — a fresh workspace that has never published
    When I run `aof work list --json`
    Then the command exits 0 and lists the control disk's items
    And every listed row reports `answeredFrom` "disk"
    And a fresh `aof work find 05 --json` exits 0 with the disk's row
    And a fresh `aof work next --json` exits 0 and offers the disk's next actionable item
    And the durable degrade sink holds a coded entry naming the unavailable cache
