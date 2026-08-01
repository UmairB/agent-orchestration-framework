<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — AC7: a workspace's rows can still be removed ON PURPOSE (unregistering a
# workspace), but only through an explicitly NAMED path — never through the publish tick. This is
# a real coverage obligation rather than a footnote, because the sweep that used to carry it
# (`wholesaleDelete(db, "work_items", workspaceId)` at `global-work-store.mjs:459`) is gone with
# AC1, and author retraction (AC4) deliberately cannot do it: no node may remove another node's
# rows, so nothing else in the system can ever clear a worker-authored row for a workspace that
# is being forgotten.
# The path's NAME is this story's to choose and is INDICATIVE below, in ADR-004's own style:
# `removeWorkspaceFromCache(store, workspaceId)` — one explicit, operator-initiated call, not a
# flag on the publish.
# LITMUS: every Then is a fresh read of the workspace's cached rows and cached artifact bodies
# through the store's public read surfaces (`readWorkspaceItems` / `readWorkItemDoc` /
# `readWorkItemRuns` — the rows and bodies `/api/mesh/status` and the board's doc view render),
# plus the removal call's own reported counts. No source read.
# 43/04 dependency: none — every Then here is column-free.
# QA-PROPOSED BOUND, flagged to the PO at refine: the scenarios below hold the named path to
# clearing the workspace's WHOLE cache footprint (rows AND cached artifact bodies/run records).
# A path that clears only `work_items` leaves the artifact rows orphaned under a workspace id
# nothing will ever publish again, which is the same "removable only by a sweep that no longer
# exists" corner one level down.

@executable @cli @work @distribution
Feature: a workspace's cached rows are removable only through one explicitly named path, and never by a publish
  In order that unregistering a workspace really does forget it, without giving any node a way to delete work another node authored
  removal must be a distinct, operator-initiated call that clears exactly that workspace's cache footprint — while no publish tick, in any state, can remove a workspace's rows

  Background:
    Given a fresh mesh cache with the workspaces "acme" and "beta" registered
    And the control node "control-1", and a worker node "worker-a"
    And "acme" carries cached rows authored by the control and a row for "43/02" authored by "worker-a"
    And "acme" carries cached record-doc bodies and run records streamed by "worker-a"

  # Headline: the named path removes the whole workspace footprint, whoever authored it — which
  # is exactly the authority no publishing node has, and is why it is a separate door.
  Scenario: the named removal path clears the workspace's cached rows regardless of which node authored them
    When the named removal path is invoked for workspace "acme"
    Then it reports how many cached rows it removed
    And a fresh read of "acme"'s cached rows reports no rows at all, including the row "worker-a" authored
    And a fresh read of "acme"'s cached record-doc bodies and run records returns nothing
    And a fresh read of "beta"'s cached rows is unchanged

  # Removal leaves no tombstone: a workspace that is registered again and published again is
  # simply cached again.
  Scenario: a removed workspace can be registered and published again, and comes back
    Given the named removal path has been invoked for workspace "acme"
    When "acme" is registered again and the control publishes its workspace snapshot
    Then a fresh read of "acme"'s cached rows reports every ref the control's disk carries

  # The publish tick can never do this job, in any state — including the two states that look
  # most like "the workspace is gone" from the publishing node's point of view.
  Scenario Outline: no publish tick removes a workspace's rows, whatever the publishing node's disk looks like
    Given the control node's own work stream is <disk_state>
    When the control's publish tick runs for workspace "acme"
    Then a fresh read of "acme"'s cached rows still reports the row "worker-a" authored
    And <control_rows>

    Examples: the states a publishing node's disk can be in
      | disk_state                                  | control_rows                                                  |
      | unchanged                                   | its own rows still report their disk values                   |
      | missing entirely, so the read fails         | its own rows are still readable, and the failure is reported  |
      | unreadable, so every item read errors       | its own rows are still readable, and the failures are reported|
      | genuinely empty, with every item deleted    | its own rows are retracted, as their author                   |

  # The dangerous case in the table above, stated as its own scenario because conflating it with
  # "the stream is empty" is how a transient read fault would silently wipe the mesh's only
  # readable copy: a FAILED read is not an authoritative empty ref set.
  Scenario: a publish whose own disk read fails retracts nothing and reports the failure
    Given the control has published, so "acme" carries its rows
    When the control's work stream cannot be read and the control's publish tick runs
    Then the publish reports the read failure rather than an empty item set
    And a fresh read of "acme"'s cached rows still reports every row it reported before the tick
