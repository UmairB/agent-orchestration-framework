<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — AC3: contention at the upsert seam is decided by the ADR-003 assignment lock,
# never by a timestamp race. While an assignment covers a ref's execution scope, an upsert for
# that ref is accepted ONLY from the holder; outside a lock, last-write-wins by `syncedAt`.
# SCOPE BOUNDARY — the LOCK PREDICATE is `01_story_item-lock`'s contract and is NOT re-specified
# here: which assignments are active, what "execution scope" covers, and the shape of the
# `item-locked-by-assignment` payload (`{ itemRef, scopeRef, assignmentId, holderNode, state }`)
# all belong to that story. THIS file specifies only what the UPSERT SEAM does when the predicate
# says a ref is held — the two renderings of the one rule ADR-003 already split:
#   AUTOMATIC (the control's periodic publish tick) -> skip the ref and COUNT the skip in the
#     tick's result; a coded refusal per held item per tick is log spam and the tick asked nothing.
#   OPERATOR-INITIATED (a human-driven control-side mutation of the item) -> refuse, coded and
#     loud, with `item-locked-by-assignment`; a human asked and gets an answer.
# LITMUS: every Then is confirmable from a fresh read of the workspace's cached rows (the rows
# `/api/mesh/status` renders as `items[]`), the publish/frame RESULT COUNTS, or the coded error a
# refused operator verb raises. No source read.
# 43/04 dependency: the last-write-wins scenario is asserted through the row's VALUES (which
# report won), not by reading `updated_at` — column-free. The seam still needs the schema-v8
# provenance columns to know who authored a row at all (see the story's sequencing note).

@executable @cli @work @distribution
Feature: while an assignment holds an item, only the holder's report is accepted — the tick skips and counts, the operator is refused and told
  In order that two writers on one item are resolved by who was given the work rather than by whose clock ticked last
  the upsert seam must accept a held ref only from its holder, count the refs a periodic tick therefore skipped, and refuse an operator's control-side mutation of a held item with a coded error

  Background:
    Given a fresh mesh cache with the workspace "acme" registered
    And the control node "control-1", and worker nodes "worker-a" and "worker-b"
    And an active assignment held by "worker-a" that covers "43/02"'s execution scope
    And "43/02" is cached with status "in-progress" as "worker-a" last reported it

  # Headline: the holder writes freely. The lock exists to protect the holder's work, not to
  # freeze the row.
  Scenario: the holder's report for a held ref is accepted
    When "worker-a" reports "43/02" with status "done" and its settled title
    Then a fresh read of the cached rows reports "43/02" with status "done" and that title

  # The AUTOMATIC rendering: the control's periodic tick asked nothing, so it says nothing — it
  # skips the held ref and COUNTS it, which is what makes the skip auditable rather than silent.
  Scenario: the control's periodic publish tick skips a held ref and counts the skip in its result
    When the control's publish tick runs while the assignment is active
    Then the tick's result counts "43/02" among the refs it skipped
    And the skip result names "43/02" and the node holding it
    And the tick raises no `item-locked-by-assignment` error
    And a fresh read of the cached rows still reports "43/02" with status "in-progress"

  # The OPERATOR rendering: a human-driven control-side mutation of a held item is refused, coded
  # and loud, and changes nothing. (The code is ONE code for every door — ADR-003 — so this
  # refusal reads identically to the mint-door refusal `01_story_item-lock` owns.)
  Scenario: an operator-initiated control-side mutation of a held item is refused with item-locked-by-assignment
    When an operator-initiated control-side mutation of "43/02" is attempted
    Then it is refused with the coded error "item-locked-by-assignment"
    And the refusal names the item, the holding node and the assignment
    And a fresh read of the cached rows still reports "43/02" exactly as "worker-a" last reported it

  # At a GATE the same operator verb is accepted — STATE's settled rule ("control-side writes are
  # refused mid-phase, allowed at a gate") is the same guard answering a different lock state,
  # not a second rule. The control becomes the row's author from that write onward.
  Scenario: at a gate, with no active assignment, the same operator-initiated mutation is accepted
    Given the assignment covering "43/02" has settled, so no assignment is active for its scope
    When an operator-initiated control-side mutation of "43/02" is attempted
    Then it is accepted and no `item-locked-by-assignment` error is raised
    And a fresh read of the cached rows reports "43/02" with the operator's value
    And a later publish from "worker-a" whose ref set omits "43/02" leaves the row in place

  # Last-write-wins is by `syncedAt`, NOT by arrival order — a redelivered or out-of-order frame
  # must not undo a newer report. (Frames are re-sent on reconnect by construction, so this is a
  # real ordering, not a hypothetical one.)
  Scenario: an older report does not overwrite a newer row, whatever order the two arrive in
    Given no assignment is active for "43/02"'s scope
    When "worker-a" reports "43/02" with status "done" stamped at the later instant
    And a redelivery of "worker-a"'s earlier report for "43/02" with status "in-progress" arrives afterwards
    Then a fresh read of the cached rows still reports "43/02" with status "done"

  # The who-may-write matrix: the writer, how the write was initiated, and the lock state — and
  # what the seam does. The last row is the reading QA took on the ADR's one ambiguity and is
  # flagged in task 03's header: an AUTOMATIC tick is authoritative only over rows it authored, or
  # a settled worker's row reverts to the control's stale disk the moment the lock releases.
  Scenario Outline: exactly who may write a ref, and what happens when they may not
    Given the lock state for "43/02"'s scope is <lock_state>
    And the cached row for "43/02" was last authored by <row_author>
    When <writer> writes "43/02" <initiation>
    Then the seam <outcome>

    Examples: one rule, two renderings
      | lock_state          | row_author | writer    | initiation                  | outcome                                                        |
      | held by worker-a    | worker-a   | worker-a  | as a streamed frame         | accepts the write                                              |
      | held by worker-a    | worker-a   | worker-b  | as a streamed frame         | does not accept it, and counts it as a skipped ref             |
      | held by worker-a    | worker-a   | control-1 | on the periodic publish tick| does not accept it, and counts it as a skipped ref             |
      | held by worker-a    | worker-a   | control-1 | as an operator verb         | refuses it with the coded error "item-locked-by-assignment"    |
      | no active assignment| worker-a   | control-1 | as an operator verb         | accepts the write                                              |
      | no active assignment| control-1  | control-1 | on the periodic publish tick| accepts the write                                              |
      | no active assignment| worker-a   | control-1 | on the periodic publish tick| does not accept it, and counts it as a skipped ref             |
      | no active assignment| worker-a   | worker-a  | as a streamed frame         | accepts the write                                              |
      | no active assignment| worker-a   | worker-b  | as a streamed frame         | accepts the write, and the ADR's `syncedAt` rule does NOT apply across nodes |

  # THE LAST ROW IS A RULING, NOT A GAP (added at 43/02's structural review; PO decision
  # on QA's G3). This feature's header says "outside a lock, last-write-wins by
  # `syncedAt`". Between two NODES that is FALSE as built and is meant to be: the
  # never-move-a-row-backwards guard is scoped to a single author, because comparing two
  # machines' clocks hands the outcome to skew — and would let a worker whose clock
  # trails the control's have its own holder frames rejected, which is ADR-011/A1's
  # regression by another route. ADR-010/D1 forbids `syncedAt` as authority between
  # nodes; ADR-012/B7 pins the scoping. So across nodes, outside a lock, ARRIVAL ORDER
  # wins, and this row records that rather than leaving it as folklore.
