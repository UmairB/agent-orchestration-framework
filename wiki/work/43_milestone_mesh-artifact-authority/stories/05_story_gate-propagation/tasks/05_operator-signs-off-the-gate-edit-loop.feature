<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the HUMAN acceptance gate. Files 00-03 prove the git mechanics and file 04
# proves they hold on real hardware; neither answers the question this story was actually
# raised for, which is an operator's: "when I fix something at a gate, does the next phase
# behave as though my fix had always been there — and when it can't, do I know what to do?"
# That is a judgement about the WORKFLOW, not about a hash, so it is the one thing that
# stays `@uat` until it no longer needs a human.
#
# LITMUS: each Then is an operator-confirmable observation with a stated pass/fail, taken
# from the surfaces an operator actually uses — the item's own artifacts as the phase
# produced them, the fleet's rendering of the assignment, and one `aof mesh logs --node`
# read. Where a judgement is asked for, the scenario names WHAT would make it a fail (the
# agent working from the pre-edit text; work from the previous phase missing; a refusal an
# operator cannot act on) rather than asking for a vibe. No source read, and no assertion
# here duplicates a mechanical check from file 04 — this file starts where that one ends.
#
# MIGRATION (the shrinking-@uat rule): scenario 1 migrates DOWN to `@manual` the moment
# "the phase reflected the edit" can be stated as a mechanical diff check on the phase's
# own output; scenario 3 migrates down once the refusal's remediation is a documented,
# checkable sequence rather than something an operator has to work out. Neither has been
# observed once yet, which is why both are still here.
#
# @qa: run this ONLY after file 04's soak passes — a human judging a loop whose mechanics
# are unproven is judging the wrong thing, and a burned real run costs a worker session.

@uat @cli @work @distribution
Feature: The operator accepts that a gate-time edit changes what the next phase does, and that a refusal tells them what to do next
  In order that the operator who edits a work item at a gate can trust the edit to take effect — the trust this story exists to restore, after a control-side change was silently ignored by exactly the case it mattered most for
  the operator confirms, on a real item they actually care about, that the continuing phase worked from the edited item, that nothing the previous phase produced was lost, and that a refusal is legible enough to act on without opening a shell on the worker

  Background:
    Given file 04's cross-machine soak has passed, so the mechanics are already proven
    And a REAL work item the operator has a stake in, already worked once on a real worker node
    And the item is at a gate — no active assignment covers its execution scope

  # The acceptance: not "the bytes arrived" (file 04 proved that) but "the phase did
  # something different because of my edit".
  Scenario: the operator confirms the continuing phase worked from the EDITED item
    Given the operator makes a real, substantive edit to the item at the gate — one that should visibly change what the next phase produces
    When the operator dispatches the continuing phase to the real worker and lets it run to settle
    Then the operator reads the phase's output and confirms it addressed the edited content
    And the operator confirms the phase did NOT work from the pre-edit text — which would be a FAIL, and is the exact defect this story closes
    And the operator confirms the work the PREVIOUS phase produced is still present in the item's artifacts — anything missing is a FAIL
    And the operator signs off that a gate edit is a reliable way to steer a continuing item

  # The operator's own reading of the record — the "which base did it run on" question,
  # answered from the control node, with no shell on the worker.
  Scenario: the operator can answer "which base did it run on" without leaving the control node
    When the operator wants to confirm which base the settled phase actually ran on
    Then one `aof mesh logs --node <worker>` read shows the advance entry with its outcome and both commits
    And the operator confirms that answer is sufficient — needing an SSH session or a worker-side `git log` to be sure is a FAIL
    And the operator confirms the entry sits beside the existing worktree-base line, so both halves of the question are one read

  # The refusal, judged as an operator experience rather than as a return code.
  Scenario: the operator confirms a refusal is legible and actionable
    Given a gate edit that conflicts with a commit the worker already made
    When the operator dispatches the continuing phase and it is refused
    Then the fleet shows the assignment failed with a code that names the cause
    And the operator confirms they can tell, from the fleet alone, that NOTHING was lost and nothing needs recovering
    And the operator confirms they know what to do next — a refusal that leaves them guessing is a FAIL
    And the operator confirms the item's branch on the worker is exactly where they left it, so retrying costs nothing
