<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY AC4 (+ AC8's behavioural residue): the guard ADMITS the holder
# by IDENTITY, never by exemption — mirroring `guardAssignmentTransition`, where a
# frame writer passes the connection-authenticated `byNode` and a control-side writer
# passes none. A mint made UNDER an assignment carries that assignment's identity and
# is admitted; a mint that carries none is refused whenever a FOREIGN active
# assignment covers the scope. The worker's own two mint sites are admitted for that
# reason and no other — there is no "worker is exempt" branch, and this contract asks
# for no operator flag that could become one.
#
# LITMUS: admission is confirmed from the minted run itself — `aof work run-status
# <ref> --json` shows the run, and the run record carries the holding assignment's id
# in its `brief` (the identity vehicle the worker's dispatch passes at HEAD:
# `brief: { assignmentId, itemRef }`). Refusal is the coded envelope plus a run count
# that did not move. The "no exemption exists" property is confirmed NEGATIVELY but
# observably: `aof work run-start --help` lists no flag that accepts an assignment id
# or a force/override, and the refused rows below stay refused however the operator
# spells the command.
#
# FEASIBILITY — READ THIS BEFORE BUILDING. There is deliberately NO operator command
# that passes an assignment identity to a mint; the only carriers are the worker's own
# dispatch sites (`mesh-worker-execution.mjs`, the fresh-dispatch mint and the
# resume mint). So the identity matrix below is driven through the DISPATCH, not
# through a flag, and its full cross-machine proof is task 06's `@manual` soak.
# A second, load-bearing feasibility fact the developer amigo must settle at BUILD:
# `transitionRunStart` is called WITHOUT `opts.workspace` at three of its five call
# sites (`run-retry.mjs`, and both worker sites) — deliberately, so the publish
# reactor skips there — so the seam has no workspace identity to key the lock lookup
# on. Threading one in must NOT be done by deriving it from `item.dir` (cwd-derived
# identity is TECH_DEBT item 4, the defect that silently discarded 100% of the
# worker→control frames for days) and must NOT switch `run-retry` into publishing as
# a side effect. The last scenario here is the guard on that second hazard.
#
# NOT COVERED HERE, and consciously left open (routed to the PO/architect): what the
# guard does when the assignment store cannot be opened or read at all — fail-open
# (mint, report a degrade) or fail-closed (refuse). ADR-003 does not decide it, and QA
# will not invent it: a lock that fails open defeats its purpose, while a lock that
# fails closed can wedge every local mint on a torn store. It needs one line in the
# ADR, then one Scenario Outline here.

@executable @cli @work @distribution
Feature: the holder is admitted by identity, and nothing else is
  In order that the worker executing an item is never locked out of its own work — and that being a worker is not itself a licence to mint
  a mint carried out under the holding assignment must be admitted because it names that assignment, while every mint that names a different one, a stale one, or none at all is refused

  Background:
    Given an isolated global mesh store (a fresh AOF_GLOBAL_HOME) holding one published workspace
    And that workspace's work stream contains milestone "42" with stories "42/01", "42/02" and "42/03", and an unrelated milestone "43"
    And an ACTIVE assignment "asg-1" for "42" held by node "aof-wsl" in state "running"

  # Headline: the holder's own dispatch mints its run and is not stopped by the lock
  # it is itself holding.
  Scenario: the holding assignment's own dispatch mints its run and the lock does not stand in its way
    When node "aof-wsl" dispatches assignment "asg-1" and its run for "42" is minted
    Then a fresh `aof work run-status 42 --json` reports exactly one run in state "running"
    And that run record names "asg-1" in its brief (the identity that admitted it)
    And no refusal with code "item-locked-by-assignment" is reported anywhere in that dispatch

  # The matrix that makes "identity, never exemption" falsifiable: the same door, the
  # same held scope, varying ONLY the identity the mint carries.
  Scenario Outline: only the assignment that actually holds the scope opens the door
    Given a mint for "42" is attempted carrying <identity>
    Then the outcome is <outcome>
    And the refusal code is <code>
    And a fresh `aof work run-status 42 --json` reports <runs> run(s)

    Examples:
      | case                                        | identity                                            | outcome  | code                      | runs |
      | the holder itself                           | assignment "asg-1" (active, covers scope "42")      | admitted | (none)                    | 1    |
      | another item's active assignment            | assignment "asg-2" (active, covers scope "43")      | refused  | item-locked-by-assignment | 0    |
      | the holder's own id after it went terminal  | assignment "asg-1" once its state is "done"         | refused  | item-locked-by-assignment | 0    |
      | an assignment id that does not exist        | assignment "asg-bogus" (no such row)                | refused  | item-locked-by-assignment | 0    |
      | no identity at all — a plain local mint     | nothing (an operator's `aof work run-start 42`)     | refused  | item-locked-by-assignment | 0    |
    # row 3 is the "never by exemption" case in its sharpest form: a stale but genuine
    # id must not open the door, or the lock could be re-opened by replaying a settled
    # dispatch. Row 5 is the one an operator can drive by hand, and is the same refusal.

  # Being the holder is not the same as being at the keyboard on the holder's machine:
  # a hand-typed mint on the holding node carries no assignment identity, so it is
  # refused there exactly as it is anywhere else.
  Scenario: a hand-typed local mint on the HOLDING node is refused just like one on any other node
    Given the local node id is "aof-wsl" — the very node holding "asg-1"
    When I run `aof work run-start 42/03 --json`
    Then the refusal code is "item-locked-by-assignment" and its `holderNode` is "aof-wsl"
    And a fresh `aof work run-status 42/03 --json` reports zero runs
    And `aof work run-start --help` lists no flag that accepts an assignment id, and none that forces or overrides the refusal

  # The m42 resume path must not trip the lock: a needs-input session resuming under
  # the SAME assignment is the same run continuing, not a second mint.
  Scenario: resuming a parked session under the same assignment is admitted and mints nothing new
    Given node "aof-wsl" already has a run for "42" minted under "asg-1", parked with code "needs-input"
    When node "aof-wsl" resumes that session under the SAME assignment "asg-1"
    Then a fresh `aof work run-status 42 --json` still reports exactly ONE run, with the same runId
    And no refusal with code "item-locked-by-assignment" is reported

  # Admission must be free: an item nobody holds behaves as it always did, whether or
  # not this workspace is meshed at all (AC8's behavioural half — the store stays
  # mesh-blind, and an unmeshed workspace never notices the lock exists).
  Scenario Outline: an unheld item mints byte-identically, meshed or not
    Given <workspace>
    When I run `aof work run-start 43 --json`
    Then a run is minted and the envelope is identical in shape to the pre-lock envelope — runId, itemRef "43", state "running"
    And the envelope carries no lock-related key, no warning and no degrade

    Examples:
      | case                              | workspace                                                      |
      | a meshed workspace, no holders    | mesh configured, global_assignments empty for this workspace   |
      | a meshed workspace, holder elsewhere | mesh configured, the only active assignment covers scope "42" |
      | an unmeshed workspace             | no mesh config at all — the plain single-node CLI              |

  # The guard must not smuggle a behaviour change into the verbs it now sits in front
  # of. `run-retry` has never published on mutate, by an explicit decision recorded at
  # its call site; giving it a lock check must not change that.
  Scenario: gaining a lock check does not change run-retry's propagation posture
    Given "43" has a failed, retryable run and no assignment covers it
    When I run `aof work run-retry 43 --json`
    Then the retry is admitted and the envelope reports the resumed runId and its attempt number
    And the workspace's `lastPublishedAt`, read back through the global mesh status read, is unchanged by the retry
    And no propagation warning appears on the envelope
