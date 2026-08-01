<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY AC3 + AC5: every door onto a held item refuses with the SAME
# code and the SAME payload, because it is ONE rule. The doors: a second assignment,
# a local `run-start`, a `run-retry`, and a control-side mutation of the held item.
# This task varies the DOOR and holds the ref pair constant; task 01 varies the ref
# pair and holds the door constant.
#
# NOT ASSERTED HERE: "the check sits INSIDE `transitionRunStart` rather than at its
# five call sites". That is a PLACEMENT invariant and lives in
# `test/arch/acd-item-lock-single-door.test.mjs` (ARCHITECTURE §"Invariants MOVED here
# out of the feature layer"). What IS behavioural — and is the whole of this task — is
# that every door actually refuses, with one code and one payload. A door that refused
# via its own hand-rolled copy would pass these scenarios and fail the arch-test; that
# is the correct division of labour, not a gap.
#
# LITMUS: every Then reads a command's `--json` envelope, its process exit status, or
# a named re-read. "Nothing was minted" is `aof work run-status <ref> --json` (run
# count unchanged) plus the store's `global_assignments` row count. "Nothing was
# mutated" for the insert door is the on-disk folder set plus a fresh
# `aof work validate --json` reporting zero findings — the same two channels m41's
# reindex features use. No source read.
#
# FEASIBILITY. Three doors exist today and need only the guard:
# `aof mesh assign`, `aof work run-start`, `aof work run-retry`. The CONTROL-SIDE
# MUTATION door does not have a single settled enforcement point yet: ADR-004 routes
# it into "the same guard" at the shared upsert seam, and that seam belongs to
# `02_story_cache-authority` (wave 1, disjoint modules — ADR-009). THIS story owns the
# predicate, the code and the payload; where the raise happens for a mutation verb is
# a BUILD decision. The row below is written against the verb the operator actually
# named as the destructive case (`aof work insert-story … --under <held ref>`, an
# insert that renumbers folders while a worker holds a worktree full of the old refs)
# because that is the outcome an outsider can confirm either way: whether the refusal
# is raised in the verb or in the seam beneath it, the observable is identical — a
# coded non-zero refusal naming the holder, and not one folder renamed.
#
# GATE ORDER MATTERS (last-but-one scenario). `assignWork`'s and `run-start`'s own
# earlier gates (`ref-not-found` first of all) must still short-circuit ahead of the
# lock, or a typo against a held milestone would report the wrong cause. Each refused
# row below therefore holds every OTHER gate valid and flips exactly one trigger —
# the m38/04/01 discipline, kept verbatim.

@executable @cli @work @distribution
Feature: every door onto a held item refuses with the one coded refusal `item-locked-by-assignment`, naming the holder and minting nothing
  In order that the lock cannot be true at one door and false at another — and so a face can say "42 is held by aof-wsl — refused" without parsing prose
  a second assignment, a local run mint, a retry and a control-side mutation of a held item must each be refused with the same code and the same structured payload, changing nothing

  Background:
    Given an isolated global mesh store (a fresh AOF_GLOBAL_HOME) holding one published workspace
    And that workspace's work stream contains milestone "42" with stories "42/01", "42/02" and "42/03", and an unrelated milestone "43"
    And an ACTIVE assignment "asg-1" for "42" held by node "aof-wsl" in state "running"
    And a second registered, eligible worker node "worker-b" that holds the workspace's published repo
    And no run record exists locally for "42", "42/01" or "42/03"

  # Headline: four doors, one answer. Every row holds every other gate valid so the
  # lock is the only thing that can fire.
  Scenario Outline: every door onto the held scope is refused with the same code, and changes nothing
    When I run <command>
    Then the command exits non-zero and its envelope reports code "item-locked-by-assignment"
    And the envelope's `holderNode` is "aof-wsl" and its `scopeRef` is "42"
    And the store still holds EXACTLY one assignment row, "asg-1", in state "running"
    And a fresh `aof work run-status 42 --json` and `aof work run-status 42/03 --json` each report zero local runs
    And the work stream's folder names are unchanged and a fresh `aof work validate --json` reports zero findings

    Examples:
      | door                             | command                                                       |
      | a second assignment, child ref   | `aof mesh assign 42/03 --to worker-b --json`                  |
      | a second assignment, scope ref   | `aof mesh assign 42 --to worker-b --json`                     |
      | a local mint, child ref          | `aof work run-start 42/03 --json`                             |
      | a local mint, scope ref          | `aof work run-start 42 --json`                                |
      | a retry, scope ref               | `aof work run-retry 42 --json`                                |
      | a retry, child ref               | `aof work run-retry 42/03 --json`                             |
      | a control-side mutation (insert) | `aof work insert-story lock-probe --at 1 --under 42 --yes --json` |
    # NOTE the second row: "a second assignment, scope ref" is the ONE row whose code
    # is contested — see task 01's header. If the architect keeps the exact-ref gate
    # first, this row reports `assignment-already-active` and moves to task 01's table.

  # The payload is a contract, not a message: five keys, each carrying the fact a face
  # needs to render the refusal without parsing English.
  Scenario: the refusal payload carries the five keys a face renders from
    When I run `aof work run-start 42/03 --json`
    Then the refusal envelope carries `itemRef` "42/03" — the ref the operator asked for, not the scope
    And it carries `scopeRef` "42" — the execution scope that is actually held
    And it carries `assignmentId` "asg-1"
    And it carries `holderNode` "aof-wsl"
    And it carries `state` "running"
    And the human (non-`--json`) render of the same command names both "42" and "aof-wsl" on stderr

  # Loud, not silent, and not a success-shaped nothing: the exit status is the first
  # thing a script sees.
  Scenario Outline: the refusal is loud at every door — a non-zero exit, never a success envelope
    When I run <command>
    Then the process exit status is non-zero
    And the envelope's `ok` is false (never a success envelope carrying a warning)
    And no partial work is left behind: no run record, no assignment row, no renamed folder

    Examples:
      | door        | command                                       |
      | mint        | `aof work run-start 42/03 --json`             |
      | retry       | `aof work run-retry 42 --json`                |
      | assignment  | `aof mesh assign 42/03 --to worker-b --json`  |

  # Refusing is idempotent and side-effect free — a refused door must not leave a
  # half-mint, a lineage bump, or a `run.started` in the item's history.
  Scenario: refusing three times in a row leaves the item exactly as it was
    When I run `aof work run-start 42/03 --json` three times
    Then all three commands report code "item-locked-by-assignment"
    And a fresh `aof work run-status 42/03 --json` reports zero runs and zero attempts
    And the assignment "asg-1" is still in state "running" with its `updatedAt` unchanged

  # Gate order: the lock is not the first gate, and must not steal another gate's
  # answer. Each row holds the lock ACTIVE and flips one EARLIER trigger.
  Scenario Outline: an earlier gate still reports its own cause even while the scope is held
    When I run <command>
    Then the refusal code is <code>, not "item-locked-by-assignment"

    Examples:
      | case                                     | command                                        | code                        |
      | a ref that resolves to nothing           | `aof work run-start 42/99 --json`              | ref-not-found               |
      | a non-canonically-padded ref             | `aof work run-start 042 --json`                | ref-not-found               |
      | an assign to an unregistered node        | `aof mesh assign 43 --to ghost --json`         | assignment-target-unknown   |
      | an assign to a node without the repo     | `aof mesh assign 43 --to worker-b --json`      | assignment-repo-unavailable |
    # rows 3 and 4 target the UNHELD milestone "43" on purpose: they prove the earlier
    # gates are intact, not that the lock yields to them.

  # The lock sits in FRONT of the fact, so it outranks the run store's OWN refusals —
  # a held item answers "held", never a store-level cause that is only incidentally
  # true. The store's refusals stay byte-unchanged for an unheld item.
  Scenario Outline: the lock outranks the store's own refusals for a held item, and changes none of them for an unheld one
    Given <setup>
    When I run <command>
    Then the refusal code is <code>

    Examples:
      | case                                        | setup                                                             | command                        | code                      |
      | retry, nothing retryable, scope HELD        | "42" has no run records and is held by "asg-1"                    | `aof work run-retry 42 --json` | item-locked-by-assignment |
      | retry, nothing retryable, scope UNHELD      | "43" has no run records and no assignment covers it               | `aof work run-retry 43 --json` | no-retryable-run          |
      | mint over a live local run, scope HELD      | "42" already has a local run in state "running" and is held by "asg-1" | `aof work run-start 42 --json` | item-locked-by-assignment |
      | mint over a live local run, scope UNHELD    | "43" already has a local run in state "running" and no assignment covers it | `aof work run-start 43 --json` | duplicate-run             |
    # the two UNHELD rows are the regression guard: gaining a lock door must not change
    # what an unheld item is told by the store it was always told by.

  # "…until the next gate" — the story title's closing clause, made observable. The
  # moment the phase ends (no active assignment), every door that was refused opens.
  Scenario: when the assignment settles, the same refused commands succeed — the gate is the release
    Given `aof work insert-story lock-probe --at 1 --under 42 --yes --json` was refused with "item-locked-by-assignment"
    When the assignment "asg-1" settles to state "done"
    And I run `aof work insert-story lock-probe --at 1 --under 42 --yes --json` again
    Then the insert succeeds, the new story occupies slot "42/01", and the story previously at "42/01" is now "42/02"
    And a fresh `aof work validate --json` reports zero findings
    And a subsequent `aof work run-start 42 --json` mints a run instead of refusing
