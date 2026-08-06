<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — AC2: ONE row-level upsert seam, the structural twin of `upsertWorkItemContent`
# (`global-work-store.mjs:636-679`), used by BOTH writers — the control's publish
# (`publishWorkspaceSnapshot`) with its own node id, and the worker's delta
# (`applyDeltaFrame`, `control-stream-server.mjs:177-202`) with the CONNECTION-AUTHENTICATED
# node id, never a self-reported one (the rule `applyWorktreeContentFrame` already keeps).
# The seam's name/shape is INDICATIVE, exactly as ADR-004 states it:
#   `upsertWorkItems(store, workspaceId, rows, { nodeId, syncedAt, authoritativeRefs })`.
# `work_items` already carries `PRIMARY KEY (workspace_id, ref)` (`:173-183`), so the conflict
# target the twin needs already exists.
# LITMUS: every Then is confirmable from a fresh read of the workspace's cached rows through the
# store's public read surface (`readWorkspaceItems` — the rows `/api/mesh/status` renders as
# `items[]`), or from the seam's own returned result counts. No source read.
# LITMUS CAVEAT — the ONE channel that is NOT column-independent: reading a row's `reportedBy`
# back requires `work_items.node_id`, which lands in `04_story_staleness-and-resync` (schema v8,
# ADR-006). This story's seam STAMPS the columns; this file therefore proves authorship the
# COLUMN-FREE way wherever it can — by whose retraction the row obeys (task 02's rule: a node may
# retract only what it authored) — and marks the direct provenance readback as the 43/04-gated
# channel it is. If the columns are not present when this story lands, the retraction predicate
# itself is unimplementable, not merely unobservable (see the story's sequencing note).

@executable @cli @work @distribution
Feature: one row-level upsert seam serves both writers, and every row is stamped with the node that actually reported it
  In order that the control node and every worker can write the same cache without one of them clobbering the other
  the cache must be written through a single row-level upsert primitive that stamps the WRITING node — the control's own id on its publish, and the connection-authenticated id on a worker's frame

  Background:
    Given a fresh mesh cache with the workspace "acme" registered
    And the control node "control-1" whose disk carries milestone "43" with stories "43/01" and "43/02"
    And a worker node "worker-a" whose stream connection to the control is authenticated as "worker-a"

  # Headline: the control's publish is now a row upsert — a status change on its own disk
  # reaches the cached row, and a brand-new item appears, without any row being deleted first.
  Scenario: the control's publish updates a changed row in place and adds a newly-created one
    Given the control has published, so "43/01" is cached with status "not-started"
    When the control's disk changes "43/01" to status "in-progress" and gains a new story "43/03"
    And the control publishes its workspace snapshot again
    Then a fresh read of the cached rows reports "43/01" with status "in-progress"
    And it reports the new "43/03" with the type, slug, title, parent and source path from the control's disk
    And it still reports "43/02" unchanged

  # Publishing the same unchanged stream twice is idempotent — the (workspace_id, ref) key means
  # a re-publish can never duplicate a ref, and nothing else about the row moves.
  Scenario: re-publishing an unchanged stream leaves exactly one row per ref, with unchanged values
    Given the control has published its workspace snapshot
    When the control publishes the same unchanged workspace snapshot again
    Then a fresh read of the cached rows reports exactly one row per ref
    And every row's type, slug, status, title, parent and source path are unchanged

  # A worker's frame is stamped with the identity its CONNECTION authenticated as — a frame that
  # SELF-REPORTS someone else's node id does not get it. The column-free proof of the stamp is
  # whose retraction the row obeys: only the node that actually authored a row can retract it
  # (task 02), so the impostor's later retraction leaves the row alone and the true author's
  # retraction removes it.
  Scenario: a frame self-reporting another node's id is stored under the identity its connection authenticated as
    Given the control has published, so "43/02" is cached from the control's own disk
    When a frame arriving on "worker-a"'s authenticated connection reports "43/02" with status "in-progress" and self-reports the node id "worker-b"
    Then a fresh read of the cached rows reports "43/02" with status "in-progress"
    And a later authoritative publish from "worker-b" that omits "43/02" leaves the row in place
    And a later authoritative publish from "worker-a" that omits "43/02" removes it

  # The case-matrix for the stamp: every writer that can reach the seam, and the node id the row
  # ends up carrying. The first Then is the column-free consequence (who may retract it); the
  # second is the direct provenance readback, which is observable only once schema v8's
  # `node_id`/`updated_at` land in 43/04 — flagged, not assumed.
  Scenario Outline: every writer stamps the node that actually reported the row
    When <writer> writes ref "43/02" into the cache
    Then only <stamped> can later retract that row by publishing an authoritative ref set without it
    And once schema v8's provenance columns land (43/04) the row reads back with reportedBy <stamped>

    Examples: the writers that reach the shared seam
      | writer                                                              | stamped   |
      | the control's own publish tick                                      | control-1 |
      | a delta frame on worker-a's authenticated connection                | worker-a  |
      | a full snapshot frame on worker-a's authenticated connection        | worker-a  |
      | a frame on worker-a's connection self-reporting the id "worker-b"   | worker-a  |
      | a frame on worker-a's connection carrying no self-reported node id  | worker-a  |

  # The seam is the ONLY way a row reaches the table, so a caller that supplies no usable identity
  # cannot write an unattributable row that nobody could ever retract or lock. (Precedent for the
  # shape: `applyLogEntriesFrame` already answers a frame with no resolvable node id with the
  # coded skip `missing-node-id` rather than writing it, `control-stream-server.mjs:230-237`.)
  Scenario: an upsert with no resolvable node id is refused, and writes nothing
    When an upsert of ref "43/02" is attempted with no resolvable node id
    Then the write is refused with a coded error rather than storing an unattributed row
    And a fresh read of the cached rows reports no row for "43/02"
