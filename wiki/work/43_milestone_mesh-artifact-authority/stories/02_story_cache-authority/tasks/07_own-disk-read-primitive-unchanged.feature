<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the REGRESSION GUARDS this story owes, stated positively rather than left alone
# (ADR-005's discipline: a negative-only guard cannot catch a well-meaning "finish the
# migration"). The read primitive is NOT the disease — the wholesale delete-and-rebuild wrapped
# around it was — so `readWorkspaceProjectionItems` (`global-work-store.mjs:539`) must come out of
# this story doing exactly what it did going in: reading the CALLING node's own disk to report its
# own state, which is also how the WORKER builds the frame it streams. And no reader migrates
# here: moving readers onto the cache is `06_story_cache-read-surface`, wave 3, deliberately last.
# LITMUS: every Then is confirmable from an outsider channel — the rows the read returns compared
# against a fresh `aof work list --json` over the SAME work dir (both are disk reads of the same
# stream), the values that reach the control's cached rows after a worker reports, and the shape
# of the rows the board's mesh overlay / the fleet `/api/mesh/status` payload still renders. No
# source read; no assertion about which module imports what (that is
# `acd-cache-read-surface-boundary`'s job, not a scenario's).
# 43/04 dependency: none — every Then here is column-free.

@executable @cli @work @work-stream @distribution
Feature: a node still reads its own disk to report its own state, and no reader moves onto the cache in this story
  In order that the authority cut does not quietly turn a node's report of its own checkout into someone else's opinion of it
  the own-disk read primitive must keep its signature, its row shape and its disk source, and every reader that answered from disk before the cut must still answer from disk after it

  Background:
    Given a fresh mesh cache with the workspace "acme" registered
    And the control node "control-1", whose disk carries "43/01", "43/02" and "43/03"
    And a worker node "worker-a" whose own worktree carries "43/02" with status "in-progress"

  # Headline: the own-disk read is unchanged — one argument, the same row shape, rows AND the
  # per-doc read errors, sourced from the caller's disk.
  Scenario: the own-disk read returns this node's disk rows in the unchanged row shape
    When the control node reads its own workspace projection items
    Then every row carries a ref, type, slug, status, title, parent and source path
    And the returned refs and statuses match a fresh `aof work list --json` over the same work dir
    And an item whose record doc cannot be parsed is reported among the read's errors rather than as a row

  # The positive non-migration assertion: the own-disk read answers from DISK even when the cache
  # disagrees. This is what stops a later "tidy-up" turning a worker's self-report into a readback
  # of the control's opinion of the worker's checkout.
  Scenario: the own-disk read reports the caller's disk even when the cache says something different
    Given "worker-a" has reported "43/02" with status "in-progress", so the cached row disagrees with the control's disk
    When the control node reads its own workspace projection items
    Then it reports "43/02" with the status on the control's own disk, not the cached status

  # The worker half of the same primitive: the frame a worker streams is built from its OWN
  # worktree, so the values that reach the control's cache are the worker's disk values.
  Scenario: the worker's frame-building read still reads the worker's own worktree
    When "worker-a" builds and streams its frame for "43/02"
    Then a fresh read of the cached rows reports "43/02" with the status and title on the worker's own worktree
    And those values are unaffected by what the control's disk says about "43/02"

  # The cache read accessor keeps its row shape across the cut, so the surfaces that already read
  # the cache keep answering without change.
  Scenario: the cached-row read surface keeps its shape, so the board overlay and the fleet payload still answer
    Given the control has published and "worker-a" has reported "43/02"
    When the cached rows for "acme" are read through the store's public read surface
    Then every row carries a ref, type, slug, status, title, parent and source path
    And the fleet status payload renders those rows as its items
    And the board's mesh overlay resolves "43/02" from them

  # No reader migrates in this story — that is 43/06, wave 3, and only correct once the cache is
  # authoritative. A disk-based reader must still read disk after this cut.
  Scenario: the disk-based read commands are unchanged by this story
    Given "worker-a" has reported "43/02" with status "in-progress", so the cached row disagrees with the control's disk
    When I run `aof work list --json` on the control node
    Then it reports "43/02" with the status on the control's own disk
    And a fresh `aof work find 43/02 --json` resolves the item from the control's own disk
