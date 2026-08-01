<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the DEFERRED human gate for this story: the lock proved on TWO REAL
# machines, against a REAL worker holding a REAL worktree, with no fixture and no
# injected store seam. It exists because every `@executable` scenario in tasks 00-05
# runs inside one process against an isolated store, and this story's whole claim is
# a cross-machine one: that the destructive case the operator named — inserting a
# story on the control node, which RENUMBERS FOLDERS, while a worker holds a worktree
# full of the old refs — is impossible rather than merely unlikely. m38/ADR-008's
# earned lesson, verbatim: "a green suite is not evidence a feature works; only a
# REAL-producer, real-outsider path is."
#
# LITMUS: outsider-observable steps only — two real machines, the real CLI, the real
# global store, real folders on real disk. Every Then is a command's own output, the
# `aof mesh logs` stream, or `ls`/`git status` against the two checkouts. Nothing is
# read from source and nothing is injected.
#
# @manual — closed by the operator at `aof:verify 43`, recorded in the milestone's
# UAT/VERIFICATION record. It MIGRATES DOWN to `@executable` the moment a two-node
# harness can stand in for the human; until then the human at two keyboards is the
# only producer that can prove it. The WSL worker node (`aof-wsl`, a full mesh node
# with its own kernel, IP, filesystem and aof identity) is the cheapest second
# machine for this and is the intended target; the Mac worker is equivalent.

@manual @cli @work @distribution
Feature: (soak) the item lock holds across two real machines — a real worker's worktree cannot be renumbered, re-minted or re-assigned out from under it
  In order that the operator's own worst case — a control-side insert renumbering `03` to `04` while a worker is actively writing `03` — is structurally impossible rather than merely unlikely
  a real assignment on a real worker node must refuse every real control-side door for the whole of its phase, and release all of them at the gate

  Background:
    Given the real control node and a real enrolled worker node ("aof-wsl" or the Mac worker), both on the deployed build
    And a real workspace published from the control node, containing a real milestone with at least two stories
    And no active assignment for that milestone at the start

  # Headline: the destructive case. A real insert on the control node, while a real
  # worker holds a real worktree, must not rename a single folder.
  Scenario: a control-side insert is refused while a real worker holds the milestone, and renames nothing
    Given the operator assigns the milestone to the worker node from the real fleet UI or `aof mesh assign`
    And the worker has accepted it and its worktree exists on the worker machine with the milestone's stories checked out
    When the operator runs `aof work insert-story <slug> --at 1 --under <that milestone>` on the CONTROL node
    Then the command exits non-zero and names code "item-locked-by-assignment" and the holding node
    And `ls` over the control checkout's story folders shows the SAME folder names as before the command
    And `git status` in the control checkout reports no modification from that command
    And the worker's worktree on the other machine is byte-unchanged and its session continues uninterrupted

  # The other three doors, on the real deployment, against the real store.
  Scenario: the local mint, the retry and a second assignment are all refused on the real control node
    Given a real worker node holds the milestone with an active assignment
    When the operator runs `aof work run-start <the milestone>` on the control node
    Then it is refused with code "item-locked-by-assignment" naming the holding node
    When the operator runs `aof work run-start <a story of that milestone>` on the control node
    Then it is refused with the same code — the scope, not the exact ref, is what is held
    When the operator runs `aof work run-retry <the milestone>` on the control node
    Then it is refused with the same code
    When the operator tries to assign the same milestone to a SECOND real node
    Then it is refused, and the real `global_assignments` table still holds exactly one active row for it

  # The worker is not locked out of its own work — the half that a lock gets wrong
  # most often.
  Scenario: the holding worker keeps working throughout — the lock never blocks its own dispatch
    Given the refusals above have all been exercised against the control node
    When the worker continues its phase and reaches a natural pause or completion
    Then the worker's run advances normally with no `item-locked-by-assignment` line in `aof mesh logs --node <the worker>`
    And the assignment reaches a terminal state reported back to the control node

  # The automatic half, on the real deployment: the control daemon has been ticking
  # throughout, and must have said nothing about the held rows.
  Scenario: the control daemon logged no refusal for the held item across the whole phase
    When the operator reads `aof mesh logs --node <the control node>` over the window the assignment was active
    Then there is not one line carrying "item-locked-by-assignment" from the periodic publish
    And the worker's own streamed rows for the held item are the ones visible on the board throughout

  # The release, on the real deployment: the gate is what makes the maintenance
  # window, and the operator must be able to see it open.
  Scenario: at the gate, the previously refused insert succeeds and the stream stays valid
    Given the assignment has reached a terminal state and no assignment is active for the milestone
    When the operator re-runs the same `aof work insert-story <slug> --at 1 --under <that milestone>` on the control node
    Then it succeeds, the new story occupies the requested slot, and the shifted stories carry their new numbers
    And `aof work validate --json` on the control node reports zero findings
    And `aof work run-start <the milestone>` is no longer refused
