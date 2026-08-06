<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the DEFERRED HUMAN GATE. Tasks 00-04 prove every stage of the
# migration HERMETICALLY, over a fixture cache seeded by hand. This is the only task
# that exercises the milestone's promise on a REAL two-machine mesh: a REAL worker
# node authors a REAL item, its worktree is REALLY deleted, the control daemon's
# republish tick REALLY keeps running — and the operator reads the item back on the
# control node through all six surfaces.
#
# WHY IT CANNOT BE @executable: the failure this milestone exists to fix is a RACE
# BETWEEN TWO WRITERS ON TWO MACHINES, settled by which one stops ticking first. A
# hand-seeded fixture cannot reproduce "the worker stopped ticking and the control's
# tick then won permanently" — that is precisely the thing a fixture asserts away.
# 38/ADR-008's earned lesson applies verbatim: a green suite is not a running mesh;
# only a real-producer outsider check counts.
#
# @manual, not @uat: the check itself is OBJECTIVE (does `aof work doc <ref> STORY`
# return the worker's body, yes or no) — it needs a human only for the hardware. The
# repo's own WSL worker node (`aof-wsl`) or the Mac worker satisfies it. A human
# closes it at `aof:verify 43`. It migrates down to @executable the day a two-node
# mesh can be stood up in CI, and not before.
#
# WAVE 3 (ADR-009) — presupposes 43/02 and 43/04, and in practice also 43/03 (the
# widened artifact set) for the `tasks` surface: `tasks/*.feature` only rides the wire
# once ADR-007's manifest lands. If 43/03 has not shipped when this soak is run, the
# `tasks` step is the one that legitimately reads empty — record that, do not fail it.
#
# LITMUS: every step is observable from OUTSIDE, on the control node, through a
# command the operator can run and read: six `--json` documents, one `doctor --json`,
# and the passage of time. Nothing here reads source, opens a store, or inspects a row.

@manual @cli @work @distribution
Feature: END-TO-END on a REAL mesh — a milestone worked by a real worker reads correctly on the control node after the worktree is gone, and stays correct
  In order to prove the milestone's actual promise — that an item worked on another machine is readable here, permanently, rather than by accident and only for a while
  every control-side read surface on the control node must answer with the worker's own view of a REAL item whose worktree has been deleted, and must keep answering that way while the control's republish tick runs on

  Background:
    Given a real mesh: this control node and a REAL worker node subscribed to it (the WSL worker `aof-wsl` or the Mac worker)
    And the control node's daemons are running, so its periodic republish tick is genuinely ticking
    And the operator can run `aof work …` on the CONTROL node and read the output from outside

  # THE OUTSIDER-OBSERVABLE PROOF — the whole milestone in one scenario. Each step is
  # a command the operator runs and reads; the transition from "answers the stale
  # scaffold" to "answers the worker's view" is the entire subject.
  Scenario: a milestone worked on a real worker reads correctly on the control node after the worker's worktree is deleted
    Given a milestone is dispatched to the REAL worker and worked there — its stories broken down, its task features authored, its statuses advanced, all in the WORKER's own worktree
    And BEFORE anything settles, the control node's own disk still holds only the pre-run scaffold for that milestone
    When the run settles and the worker deletes its worktree, so it will never tick again
    And the operator waits long enough for several of the control node's republish ticks to pass
    Then `aof work find <ref> --json` on the CONTROL node reports the worker's status, naming the worker node as the reporting node
    And `aof work list --json` lists the worker-authored stories under that milestone, not an empty milestone
    And `aof work next --json` treats the worker's completed work as complete — it does not re-offer finished work, and it does not report a finished driver as blocking
    And `aof work doc <ref>/<story> STORY --json` returns the worker's STORY.md body
    And `aof work run-status <ref> --json` returns the worker's run rows
    And `aof work tasks <ref>/<story> --json` returns the worker's task features
    # AMENDED by the PO, 2026-08-05, at the live run — applying a ruling already made.
    # As written this said "every one of those answers", which `work list --json` cannot
    # satisfy: m03/ADR-002 freezes it at EXACTLY seven keys and `acd-work-list-contract`
    # arms that. ADR-016/G1 (raised as F-06.1 at this story's build review) already ruled
    # the provenance stamp a FACE PROJECTION — stripped in the CLI adapter, kept on the
    # command result and the board route — because a cache-answered row carries THREE
    # keys, so widening the contract would make its key set vary by deployment. The PO
    # amended task 02's two clauses then and missed this identical clause. Amended now,
    # same reason. Measured at the live run: 5 of 6 surfaces carry `answeredFrom`.
    And every one of those answers EXCEPT `work list` says which side answered it
    And `work list --json` stays exactly seven keys, its provenance riding the board route instead

  # THE PERMANENCE HALF — the measured disease was not staleness, it was staleness
  # actively republished over live truth on a timer. So the proof is not one read: it
  # is the same read, repeated, while the control's tick runs on with nothing to
  # oppose it. Today this is the step that fails.
  Scenario: the answer does not revert while the control node's republish tick keeps running
    Given the worker's worktree is deleted and the worker will never tick again
    And the control node's daemons keep running for at least ten republish ticks
    When the operator repeats `aof work find <ref> --json` and `aof work doc <ref> SPEC --json` after those ticks
    Then the answers are the same as they were immediately after settle
    And at no point does the milestone read back as its pre-run scaffold
    And the reporting node named on the row is still the WORKER, never the control node

  # DOCTOR ON A REAL MESH — the noise test. On a control node whose disk holds the
  # scaffold for every remotely-worked item, doctor must not turn into a wall of false
  # findings. This is the operator-visible version of task 04's decisive negative.
  Scenario: doctor reports no false findings against the real worker-authored milestone
    Given the worker-authored milestone reads correctly on the control node
    When the operator runs `aof work doctor --json` on the CONTROL node
    Then no error-severity finding is reported against the worker-authored milestone or its stories
    And any finding that IS reported against it names the control node's own disk as its subject and is true of that disk
    And the finding count against locally-authored milestones is unchanged from before this story

  # THE NEGATIVE OUTSIDER CHECK — the fallback is still there on a machine that has
  # never met a worker. A fresh workspace with no cache must still read, or this story
  # has traded one broken surface for another.
  Scenario: on a fresh workspace that has never published, every read surface still answers from disk
    Given a fresh workspace on the control node that has never published to the mesh
    When the operator runs `aof work list --json`, `aof work find <ref> --json`, `aof work next --json` and `aof work doc <ref> SPEC --json`
    Then each exits 0 and answers from that workspace's own disk
    And each answer says it was answered from disk
    And no command fails because the cache holds nothing for it

  # THE BOUNDARY, observed on the real mesh rather than in a fixture: the WORKER's own
  # reads still come from its own checkout. If this ever fails, the control's copy has
  # become the worker's input and the mesh has stopped observing anything.
  Scenario: on the worker node, the item reads from the worker's own checkout
    Given a run is live on the REAL worker and its worktree holds edits the control node has not yet received
    When the operator runs `aof work find <ref> --json` and `aof work list --json` INSIDE the worker's worktree
    Then the answers are the worker's own worktree state, including the edits the control has not yet received
    And the worker's next stream tick reports those same edits up to the control node
