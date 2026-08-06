<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY AC6: `work next` consults the SAME predicate the mint door
# does, and renders it the other way: it returns the next UNHELD item and REPORTS the
# ones it skipped, each with its holder. The two failure modes it must avoid are named
# in the criterion and are both asserted below — silently omitting a held item (the
# item becomes invisible, and an operator cannot tell "nothing left" from "everything
# is being worked"), and handing one out to be refused a step later (a bad seam).
#
# LITMUS: everything is read from `aof work next [scope] --json`. The seam property —
# "next never hands out something run-start would refuse" — is confirmed by an outsider
# running the two commands back to back and comparing the second's exit status; that
# is the strongest black-box check in this story and it needs no internals at all.
#
# FEASIBILITY / INDICATIVE SHAPE. `nextWork`'s envelope at HEAD has three states —
# `ready` (with ref/slug/type/status/path), `blocked` (with `waitingOn`), and `done` —
# and NO notion of a skipped item. This task therefore asks for an ADDITIVE envelope
# field, indicatively `skipped: [{ ref, scopeRef, holderNode, assignmentId, state }]`
# (the same five facts the refusal payload carries — AC5's payload, rendered as a list
# rather than as an error, which is what "one rule, two renderings" means), plus a
# fourth state for "there is work, but every candidate is held". The exact state token
# is a BUILD decision; what this contract pins is that it is NOT `done` — reporting
# `done` over held work would be the invisible-item failure with a friendly face.
# `commands/next.mjs`'s `--json` face relativises `path` and passes the rest of the
# result through, so an additive field reaches the envelope without a face change.

@executable @cli @work @distribution
Feature: `work next` returns the next UNHELD item and reports the ones it skipped, naming each holder
  In order that an operator asking "what should I pick up?" is never handed work another node is already doing, and is never quietly told there is nothing to do while a worker is mid-phase
  work next must skip every item whose execution scope an active assignment holds, return the next unheld candidate, and report each skipped item with the node holding it

  Background:
    Given an isolated global mesh store (a fresh AOF_GLOBAL_HOME) holding one published workspace
    And that workspace's work stream contains milestones "42", "43" and "44", each "not-started" and none blocked by `depends`
    And milestone "42" has stories "42/01", "42/02" and "42/03"

  # Headline: the held candidate is stepped over, the next unheld one is returned, and
  # the skip is REPORTED rather than swallowed.
  Scenario: the first candidate being held moves next on to the following item and names the holder
    Given an ACTIVE assignment for "42" held by node "aof-wsl" in state "running"
    When I run `aof work next --json`
    Then the envelope's state is "ready" and its ref is "43"
    And the envelope's skipped list contains exactly one entry, for "42"
    And that entry names `holderNode` "aof-wsl", `scopeRef` "42", the assignment id, and the assignment state "running"
    And "42" is NOT the returned ref

  # The skip is by SCOPE, in both directions — the same symmetry the mint door has, so
  # the two renderings cannot disagree about which items are held. Asserted on the
  # SKIPPED LIST rather than on which item comes back, so the row is about the
  # predicate and not about candidate ordering.
  Scenario Outline: next skips by execution scope, upward and downward
    Given an ACTIVE assignment for <holder> held by node "aof-wsl" in state "running"
    When I run `aof work next 42 --json`
    Then the envelope's skipped list <verdict> an entry for <candidate>
    And the returned ready ref, if any, is never <candidate> when the verdict is "contains"

    Examples:
      | case                              | holder | candidate | verdict           |
      | the scope itself is held          | 42     | 42        | contains          |
      | a child of the held scope         | 42     | 42/01     | contains          |
      | the scope is held by a child      | 42/03  | 42        | contains          |
      | a sibling of the holding child    | 42/03  | 42/01     | contains          |
      | an unrelated scope is held        | 43     | 42        | does not contain  |

  # The seam property, stated as an outsider can check it: whatever next hands out,
  # the mint door accepts. This is what "one rule, two renderings" buys.
  Scenario: whatever next returns, run-start accepts — the two renderings cannot disagree
    Given an ACTIVE assignment for "42" held by node "aof-wsl" in state "running"
    When I run `aof work next --json` and then `aof work run-start <the returned ref> --json`
    Then the run-start exits zero and mints a run
    And it is NOT refused with code "item-locked-by-assignment"

  # The invisible-item failure, closed explicitly: "everything is held" must never
  # render as "everything is done".
  Scenario: when every candidate is held, next says so and names every holder — it never reports done
    Given ACTIVE assignments held by node "aof-wsl" for "42", "43" and "44"
    When I run `aof work next --json`
    Then the envelope's state is NOT "done"
    And the envelope carries no ready ref
    And the envelope's skipped list contains an entry for each of "42", "43" and "44", each naming "aof-wsl" as its holder
    And the human (non-`--json`) render distinguishes "everything is being worked" from "everything is done"

  # Accounting: nothing falls off the list. Returned + skipped + blocked accounts for
  # every candidate the scope contains.
  Scenario: no candidate is silently dropped — returned, skipped and blocked account for all of them
    Given an ACTIVE assignment for "42" held by node "aof-wsl"
    And milestone "44" is blocked by an unmet `depends` on "43"
    When I run `aof work next --json`
    Then the envelope's ready ref is "43"
    And the skipped list names "42" and only "42"
    And "44" is accounted for as blocked, not as skipped (a held item and a blocked item are different answers)

  # No regression: the two pre-existing states are untouched when no assignment exists.
  Scenario Outline: with no active assignment, next answers exactly as it did before the lock existed
    Given no rows at all in global_assignments for this workspace
    And <stream>
    When I run `aof work next --json`
    Then the envelope's state is <state> and <assertion>
    And the envelope's skipped list is empty

    Examples:
      | case                       | stream                                            | state   | assertion                                       |
      | an ordinary ready item     | "42" is not-started and unblocked                 | ready   | its ref is "42" and its path is cwd-relative    |
      | a depends-blocked item     | the only candidate waits on an unfinished driver  | blocked | `waitingOn` names the unmet driver              |
      | a finished stream          | every item is done                                | done    | no ref is returned                              |

  # A terminal assignment is a gate: the item it names becomes handable again on the
  # very next call, with no intervening command.
  Scenario: an item stops being skipped the moment its assignment settles
    Given an ACTIVE assignment for "42" held by node "aof-wsl" and `aof work next --json` returns "43" with "42" skipped
    When that assignment settles to state "done"
    And I run `aof work next --json` again
    Then the envelope's ready ref is "42"
    And the skipped list is empty
