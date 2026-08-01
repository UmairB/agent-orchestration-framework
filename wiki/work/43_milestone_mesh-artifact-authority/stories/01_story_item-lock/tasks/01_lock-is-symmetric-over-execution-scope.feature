<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY AC2: the lock predicate is SYMMETRIC over the execution scope.
# An active assignment holding ANY ref in a scope holds the WHOLE scope: running "42"
# locks "42/03" (the hole STATE measured) AND running "42/03" locks "42" (the
# symmetry ADR-003 adds, consciously extending `resolveScopedExecution`, which only
# walks upward). Both directions, because both execute in ONE worktree on ONE branch.
# This task varies the REF PAIR and holds the door constant; task 02 varies the DOOR
# and holds the ref pair constant. Together they are the whole rule.
#
# LITMUS: the predicate is a pure read with no CLI surface of its own, so every Then
# is confirmed at the two doors that DO have one: `aof mesh assign <ref> --to <node>
# --json` and `aof work run-start <ref> --json`. Admitted ⇒ the envelope carries a
# minted id (an assignmentId / a runId) and the mint is visible on a fresh
# `aof work run-status <ref> --json`; refused ⇒ a coded non-zero envelope and the
# store's assignment/run row counts are UNCHANGED. No source read, no import graph.
#
# FEASIBILITY / INDICATIVE NAMES: the scope-aware read is NEW (ADR-003 names it
# indicatively `findActiveAssignmentForScope`, in an indicative `src/item-lock.mjs`).
# `findActiveAssignment` is NOT changed — the last two scenarios are the regression
# guard on that promise, and are authorable green against HEAD today.
#
# AMBIGUITY FLAGGED TO PO/ARCHITECT (row 1 of the first table). AC5 says "ONE code
# for every door", but the EXACT-ref duplicate-assign gate already refuses
# `assignment-already-active` (`mesh-assignment.mjs`, `assignWork`), and AC2 says the
# exact-ref primitive is untouched for its importers — of which that gate is the only
# one in `src/` (measured 2026-08-01: `findActiveAssignment` has ONE caller in `src/`,
# not six; six is `assignment-record.mjs`'s module-import count). This contract
# therefore pins: the exact-ref duplicate keeps its existing code (a regression guard
# on m35/m38's pinned refusals) and every refusal the NEW scope predicate produces
# carries `item-locked-by-assignment`. If the architect instead intends the assign
# verb to route its exact-ref case through the new predicate, that row's code changes
# HERE and `38/04/01_assign-gates-hold-on-ui-path.feature` must be amended in the same
# change. Decide at BUILD; do not let the two features drift.

@executable @cli @work @distribution
Feature: an active assignment holds the WHOLE execution scope, in both directions
  In order that two nodes can never author the same worktree — a milestone and its stories being one branch, one checkout, one line of work
  an active assignment on any ref must hold every other ref sharing its execution scope, whether that ref is above it, below it, or beside it

  Background:
    Given an isolated global mesh store (a fresh AOF_GLOBAL_HOME) holding one published workspace
    And that workspace's work stream contains milestones "42", "43" and "420" — with stories "42/01", "42/02" and "42/03" under "42", "43/01" through "43/03" under "43", and "420/00" under "420"
    And a second registered, eligible worker node "worker-b" that holds the workspace's published repo
    And no run record exists locally for any of those refs

  # Headline: the symmetry matrix. One active holder, one requested ref, one answer —
  # asserted at the assign door, where both refusal vocabularies are visible side by
  # side. Every "refused" row must ALSO mint nothing, which is what makes the refusal
  # a lock rather than a message.
  Scenario Outline: a held scope refuses a second assignment for any ref in that scope, upward, downward or sideways
    Given an ACTIVE assignment for <holder> held by node "aof-wsl" in state "running"
    When I run `aof mesh assign <requested> --to worker-b --json`
    Then the outcome is <outcome>
    And the refusal code is <code>
    And the store holds EXACTLY the assignments it held before the command (no second row was minted)

    Examples:
      | direction                      | holder | requested | outcome  | code                       |
      | the same ref (pre-existing)    | 42     | 42        | refused  | assignment-already-active  |
      | downward — scope holds a child | 42     | 42/03     | refused  | item-locked-by-assignment  |
      | upward — a child holds a scope | 42/03  | 42        | refused  | item-locked-by-assignment  |
      | sideways — sibling stories     | 42/03  | 42/01     | refused  | item-locked-by-assignment  |
      | a different scope entirely     | 42     | 43        | admitted | (none)                     |
      | a child of a different scope   | 42     | 43/03     | admitted | (none)                     |
      | a string-prefix near-miss      | 42     | 420       | admitted | (none)                     |
      | a child of the near-miss       | 42     | 420/00    | admitted | (none)                     |

  # The same symmetry, at the LOCAL mint door — because the rule cannot be true where
  # the mesh verb enforces it and false where a local operator mints straight past it
  # (STATE's second measured hole: "nothing local honours the lock").
  Scenario Outline: a held scope refuses a local run mint for any ref in that scope
    Given an ACTIVE assignment for <holder> held by node "aof-wsl" in state "running"
    When I run `aof work run-start <requested> --json`
    Then the outcome is <outcome>
    And the refusal code is <code>
    And a fresh `aof work run-status <requested> --json` shows <runs> run record(s) for the requested ref

    Examples:
      | direction                      | holder | requested | outcome  | code                      | runs |
      | downward — scope holds a child | 42     | 42/03     | refused  | item-locked-by-assignment | 0    |
      | the held ref itself            | 42     | 42        | refused  | item-locked-by-assignment | 0    |
      | upward — a child holds a scope | 42/03  | 42        | refused  | item-locked-by-assignment | 0    |
      | sideways — sibling stories     | 42/03  | 42/01     | refused  | item-locked-by-assignment | 0    |
      | a different scope entirely     | 42     | 43        | admitted | (none)                    | 1    |
      | a string-prefix near-miss      | 42     | 420       | admitted | (none)                    | 1    |

  # ACTIVE is the whole trigger, and its boundary is the existing three-state
  # partition — not a new one. A terminal row is a finished phase: the item is at a
  # gate and everything is allowed again.
  Scenario Outline: only an ACTIVE assignment holds the scope — every terminal state releases it
    Given the only assignment for "42" is a row in state <state> targeting node "aof-wsl"
    When I run `aof work run-start 42/03 --json`
    Then the outcome is <outcome>
    And the refusal code is <code>

    Examples:
      | state      | classification | outcome  | code                      |
      | assigned   | active         | refused  | item-locked-by-assignment |
      | accepted   | active         | refused  | item-locked-by-assignment |
      | running    | active         | refused  | item-locked-by-assignment |
      | done       | terminal       | admitted | (none)                    |
      | failed     | terminal       | admitted | (none)                    |
      | withdrawn  | terminal       | admitted | (none)                    |
      | reclaimed  | terminal       | admitted | (none)                    |

  # The lock is the WORKSPACE's item, never the ref string globally — `global_assignments`
  # is one table for every workspace on the machine, so a same-numbered item elsewhere
  # must be untouched.
  Scenario: an active assignment in another workspace does not hold this workspace's identically-numbered item
    Given a SECOND published workspace whose stream also contains milestone "42"
    And an ACTIVE assignment for "42" in that second workspace, held by node "aof-wsl"
    When I run `aof work run-start 42 --json` in the FIRST workspace
    Then a run is minted and a fresh `aof work run-status 42 --json` shows exactly one running run
    And no refusal is reported

  # No regression, stated positively: the ordinary case — an item nobody holds — mints
  # exactly as it does at HEAD, envelope and all.
  Scenario: an item with no assignment at all mints exactly as it did before the lock existed
    Given no rows at all in global_assignments for this workspace
    When I run `aof work run-start 42/03 --json`
    Then a run is minted and the envelope carries its runId, its itemRef "42/03" and state "running"
    And a fresh `aof work run-status 42/03 --json` reports that run as the only one
    And the envelope carries no lock-related key of any kind

  # The exact-ref primitive is a promise this story explicitly does NOT touch. Its
  # observable contract: the duplicate-assign refusal keeps its own code AND its
  # holder field, and a terminal row still makes the SAME exact ref re-assignable
  # (m35/ADR-003's re-assignability rule).
  Scenario: the exact-ref uniqueness gate is byte-unchanged — same code, same holder field, same re-assignability
    Given an ACTIVE assignment for "42" held by node "aof-wsl"
    When I run `aof mesh assign 42 --to worker-b --json`
    Then the refusal code is "assignment-already-active" and its holder field is "aof-wsl"
    And exactly one active assignment row exists for "42"
    When that assignment is withdrawn and I run `aof mesh assign 42 --to worker-b --json` again
    Then a new assignment is minted for "42" targeting "worker-b"
