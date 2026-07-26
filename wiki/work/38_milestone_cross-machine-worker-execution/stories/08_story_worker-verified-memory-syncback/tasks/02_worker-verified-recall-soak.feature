@manual @cli @work @memory @distribution
Feature: END-TO-END on a REAL mesh — a story verified on a worker becomes recallable on the control node after it pulls + re-ingests
  In order to prove milestone 38 is a mesh that does REAL verified work end-to-end — the milestone's earned
  lesson (ADR-008: a green suite is not a running mesh; only a real-producer outsider check counts) — a story
  VERIFIED on a REAL worker (its RETROSPECTIVE `R<n>` lesson / `ADR-NNN` authored, committed, pushed via
  story-07, and merged) must become RECALLABLE on the CONTROL node after the control node runs `git pull` +
  `aof work memory ingest` on its OWN checkout, having been NOT recallable there before the pull.

  # ARCHITECTURE 38/ADR-016 — the end-to-end this story exists to prove: the DOCUMENTED MANUAL trigger is
  # `git pull` + `aof work memory ingest` on the control node after the worker branch merges; the knowledge rides
  # git, the control rebuilds its OWN index, no index bytes cross the mesh. 38/ADR-008 — the milestone's earned
  # lesson: the real-producer outsider check (a REAL worker, a REAL verify, a REAL story-07 push + human merge, a
  # REAL control-node recall) is the ONLY proof a mesh actually does verified work; the earlier "successful" soak
  # existed only as untracked local output, gc'd on force-remove. RESEARCH §4.5 (operator: worker-completed ->
  # control memory updates). Depends on story-07 (durable push-back — the markdown must ACTUALLY reach the
  # control's checkout before memory can sync).
  #
  # @manual — the DEFERRED HUMAN GATE. This needs a real two-machine mesh (the control node + a REAL worker
  # subscribed to it), a real verify ON THE WORKER, a real story-07 push + a real human review/merge, and a real
  # `git pull` + `aof work memory ingest` ON THE CONTROL NODE. It CANNOT run in CI (no second machine, no real
  # remote). Tasks 00/01 prove the git-ride + own-checkout re-ingest HERMETICALLY; THIS is the only task that
  # exercises the real cross-machine worker-verified -> control-recall path. A human closes it at `aof:verify 38`.
  # A `@uat` item migrates down to `@manual`/`@executable` once it no longer needs a human — a real mesh still
  # does here.

  Background:
    Given a real mesh: a CONTROL node and a REAL WORKER node subscribed to it (story-04/05 assignment + execution)
    And the operator can run `aof work memory recall` on the CONTROL node and read its output from outside

  # The outsider-observable proof — a prose scenario, each step observable from OUTSIDE (no reading of internals):
  # recall is EMPTY on the control node before the pull, and HITS after the pull + ingest. That transition, driven
  # only by markdown arriving over git, is the whole story.
  Scenario: a lesson verified on the worker is recallable on the control node ONLY after the control pulls + re-ingests
    Given a milestone/story is dispatched to the worker and VERIFIED there, its RETROSPECTIVE `R<n>` lesson (or an `ADR-NNN`) authored, committed on the worker's `aof/mesh/<itemRef>-<assignmentId>` branch, and pushed via story-07's push-back
    And BEFORE any pull, `aof work memory recall "<the lesson's keywords>"` on the CONTROL node returns NO record carrying that lesson (it is stranded on the worker)
    When a human reviews and merges the worker's branch, then the operator runs `git pull` and `aof work memory ingest` on the control node's OWN checkout
    And the operator runs `aof work memory recall "<the lesson's keywords>"` on the CONTROL node
    Then the recalled records include the EXACT lesson/ADR that was authored on the worker
    And that record's "source" resolves to live markdown in the CONTROL node's own checkout (the knowledge rode git, not the mesh stream)
    And no `graphify-out/graph.json` was transmitted over the mesh to make this happen — each machine rebuilt its own index locally

  # The negative half of the outsider check: the recall transition is caused by the GIT pull, not by the mesh
  # stream. With the branch pushed but NOT yet pulled/merged, the control node's recall stays empty however long
  # the mesh runs — confirming nothing rode the wire.
  Scenario: with the branch pushed but not yet pulled, the control node cannot recall the worker's lesson
    Given the worker has pushed its verified branch but the control node has NOT pulled/merged it
    When the operator runs `aof work memory recall "<the lesson's keywords>"` on the CONTROL node
    Then no record carrying the worker's lesson is recalled (the mesh stream carried no knowledge — only git will)
