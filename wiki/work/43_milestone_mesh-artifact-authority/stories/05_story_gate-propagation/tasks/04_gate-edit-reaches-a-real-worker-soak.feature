<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the REAL cross-machine soak. Everything the @executable lanes (files
# 00-03) prove happens inside a disposable local fixture repo against an injected exec
# seam: no real dispatch over the wire, no second machine, no real `origin`, no real agent.
# This file is the real-producer check those lanes cannot reach — an operator edits a work
# item on the CONTROL node at a gate, dispatches a continue for an item that already has a
# branch to a REAL worker node, and the edit is there when the agent starts.
#
# LITMUS: every Then is an outsider-observable fact — `git` reads inside the worker's real
# checkout and inside a SEPARATE clone of the real `origin`, the entries `aof mesh logs
# --node <worker>` returns on the control node, and the assignment row the fleet renders.
# Nothing is confirmed by reading source, and nothing by "it looked right" — each step
# names the exact command and the exact expected answer.
#
# ENVIRONMENT (this repo's operating rules, `.claude/rules/build-deploy-restart.md`):
# the worker is the Mac worker (`umairs-mac-mini`, deployed by `git pull` + an OPERATOR
# restart) or the WSL node `aof-wsl` (deployed by `node scripts/install-local.mjs --wsl`,
# then an operator restart). NEVER start or restart a worker daemon over SSH — an
# SSH-spawned daemon has no login session, `claude` is unauthenticated, and the run burns.
# Reading state over SSH is fine and is how most of the checks below are taken.
#
# FIXTURE (real, on real hardware):
#   - a work item that has ALREADY been worked once on the worker, so `aof/mesh/<ref>`
#     exists on `origin` and carries at least two real worker commits;
#   - the item at a GATE — no active assignment covers its execution scope (story 01's
#     lock is what makes this window quiescent);
#   - a control-side edit committed and pushed on the control node AFTER that branch was
#     last touched, so the pinned base and the item branch are genuinely DIVERGED. The
#     edit must be a file the agent will read (e.g. a new acceptance criterion in the
#     item's STORY.md), not a cosmetic change, so "the agent saw it" is checkable.
#
# @qa (human-check refinement): the outsider-observable facts a human must confirm live are
# (1) the gate edit is in the worker's worktree BEFORE the agent's first output, (2) the
# worker's earlier commits are all still reachable on the branch afterwards, (3) the
# advance line is readable on the control with `aof mesh logs --node`, carrying `merged`
# and both hashes, and (4) the pushed branch on the real origin contains BOTH lines. The
# refusal half is exercised deliberately, not waited for: the operator MAKES a conflict.

@manual @cli @work @distribution @round-trip
Feature: On real hardware, an operator's gate-time edit on the control node reaches a REAL worker's continuing phase, and nothing the previous phase produced is lost
  In order to prove the story's claim where it actually has to hold — across two machines, over the real wire, on a real branch with a real remote — rather than only inside a hermetic fixture with an injected git seam
  a real control-side edit made at a gate is carried by the dispatch's pinned base onto the item's existing branch on a real worker, before the agent starts, with every earlier worker commit still reachable and the whole line still reaching origin

  Background:
    Given the control node and a real worker node (`umairs-mac-mini` or `aof-wsl`) are both enrolled and connected
    And the item `<ref>` has already been worked once on that worker, so `origin/aof/mesh/<ref>` exists with at least two worker commits
    And the item is at a GATE — `aof mesh assignments` shows no active assignment covering its execution scope
    And the branch tip hash on the worker and on origin is recorded before anything is dispatched

  # The headline claim, on real hardware: the operator's edit is in the agent's tree.
  Scenario: a gate-time control-side edit reaches a real worker's continuing phase before the agent starts
    # SETUP — the edit the whole story exists for, made at the only moment the lock permits it.
    Given the operator edits the item on the CONTROL node at the gate, then commits and pushes that edit
    And `git rev-parse HEAD` on the control node is recorded as the pinned base the dispatch will carry
    # DISPATCH — a CONTINUE, so the worker takes the reuse door on the existing branch.
    When the operator dispatches a continue for `<ref>` to the worker node
    # THE PROPAGATION — read in the worker's real worktree, before the agent has produced anything.
    Then in the worker's materialized worktree the edited file contains the operator's edit verbatim
    And in the worker's checkout `git merge-base --is-ancestor <pinned-base> aof/mesh/<ref>` exits 0
    And each worker commit hash recorded in the Background is still reachable: `git merge-base --is-ancestor <hash> aof/mesh/<ref>` exits 0
    And `git rev-parse aof/mesh/<ref>^2` resolves to the pinned base — a real merge, not a rewrite
    And the agent's first output reflects the edited item, not the pre-edit text

  # The control-side read, which is the whole point of putting the advance on the log
  # channel: no SSH needed to answer "which base did it run on".
  Scenario: the advance is readable from the control node in one `aof mesh logs --node` read
    When the operator dispatches a continue for `<ref>` to the worker node
    Then `aof mesh logs --node <worker>` on the CONTROL node shows an advance entry for this assignment
    And that entry reports outcome `merged`
    And the pinned base hash it carries equals the control node's `git rev-parse HEAD` recorded at dispatch
    And the branch tip hash it carries equals `git rev-parse aof/mesh/<ref>` in the worker's checkout
    And the existing `worker-worktree-base` entry for the same dispatch is present alongside it

  # Durability, on the real remote — the advance must not cost the earlier phase's output.
  Scenario: from a separate clone of the REAL origin, both lines are present after the run settles
    When the worker drives the continue to `done` and pushes the branch to the real origin
    Then in a SEPARATE fresh clone `git fetch origin && git branch -r` lists `origin/aof/mesh/<ref>`
    And in that clone `git merge-base --is-ancestor <pinned-base> origin/aof/mesh/<ref>` exits 0
    And in that clone every worker commit hash recorded in the Background is still reachable
    And in that clone `git log --format=%H origin/aof/mesh/<ref>` contains those hashes UNCHANGED — nothing was rebased or rewritten
    And the item's work from BOTH phases is present in the tree at the branch tip

  # The refusal path, made to happen deliberately — an operator must be able to tell what
  # went wrong from the fleet alone, without opening a shell on the worker.
  Scenario: a deliberately conflicting gate edit refuses on real hardware and leaves the worker's branch untouched
    Given the operator edits, on the control node, the SAME line of the SAME file a worker commit already changed
    When the operator dispatches a continue for `<ref>` to the worker node
    Then the fleet shows the assignment `failed` with code `assignment-gate-propagation-conflict`
    And `aof mesh logs --node <worker>` shows the advance entry carrying that code and the unchanged branch tip
    And in the worker's checkout `git rev-parse aof/mesh/<ref>` equals the hash recorded in the Background
    And in the worker's checkout `git rev-parse -q --verify MERGE_HEAD` exits non-zero — the tree is not left MERGING
    And no agent session was started for that assignment
    And re-dispatching after the operator resolves the conflict on the control node succeeds normally
