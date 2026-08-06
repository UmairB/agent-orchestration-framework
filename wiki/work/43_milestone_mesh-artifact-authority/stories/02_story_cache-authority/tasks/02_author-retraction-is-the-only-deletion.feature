<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — AC4: deletion is by AUTHOR RETRACTION, never by a sweep and never by time.
# A publishing node passes the full ref set it is authoritative for (ADR-004's indicative
# `authoritativeRefs`), and the seam deletes rows where `node_id = <this node> AND ref NOT IN
# <that set>`. A node may retract ONLY what it itself authored; it may never delete another
# node's row; and NO deletion may ever be predicated on a timestamp (ADR-006's settled
# never-evict rule).
# LITMUS: every Then is a fresh read of the workspace's cached rows through the store's public
# read surface (`readWorkspaceItems` — the rows `/api/mesh/status` renders as `items[]`) — the
# row is either still readable or it is not. This is deliberately the COLUMN-FREE channel:
# survival-vs-deletion proves authorship without reading `node_id`, which does not exist on
# `work_items` until schema v8 lands in 43/04. (The seam's WHERE clause does need that column —
# see the story's sequencing note; that is a build-order dependency, not an observability one.)
# The never-evict rule is ALSO ratcheted structurally by `acd-cache-staleness-single-predicate`
# ("no time-predicated DELETE against the three cache tables"). A scenario cannot prove an
# absence, so the scenarios below assert the OBSERVABLE outcome — the ancient row is still
# readable — never the absence of code.

@executable @cli @work @distribution
Feature: a node may retract only the rows it authored — never another node's, and never because a row is old
  In order that dropping the wholesale rebuild does not either strand deleted items in the cache forever or let one node delete another's live work
  a publishing node must pass the full ref set it is authoritative for, and the seam must remove exactly the rows that node authored and no longer claims

  Background:
    Given a fresh mesh cache with the workspaces "acme" and "beta" registered
    And the control node "control-1", and worker nodes "worker-a" and "worker-b"
    And the control has published "acme" from its own disk, so "43/01", "43/02" and "43/03" are cached rows it authored

  # Headline: the correct deletion. An item genuinely deleted on the control's disk leaves the
  # control's ref set, so the control retracts its own row and the cache stops reporting it.
  Scenario: a node retracts a row it authored once that ref leaves its authoritative set
    When the story "43/03" is deleted from the control's disk
    And the control publishes its workspace snapshot with the ref set it still carries
    Then a fresh read of "acme"'s cached rows reports no row for "43/03"
    And it still reports "43/01" and "43/02"

  # The counterpart, and the one that today's wholesale delete gets wrong: the control publishes
  # a ref set that does not name a row a WORKER authored. The row is not the control's to remove.
  Scenario: a node never deletes a row another node authored, even when its own ref set omits it
    Given "worker-a" has reported "43/02" with status "in-progress", so the row is worker-authored
    When the control publishes an authoritative ref set that omits "43/02" entirely
    Then a fresh read of "acme"'s cached rows still reports "43/02" with status "in-progress"

  # The retraction case-matrix. Each row: who authored the cached row, who is publishing "acme",
  # whether that publisher's authoritative ref set names the row — and whether the row is still
  # readable afterwards. The absent-vs-empty pair is the subtle one and is expanded below.
  # The last row is the schema-v8 migration residue: a row that predates the provenance columns
  # records no author, so no node can retract it (see the story's sequencing note).
  Scenario Outline: exactly which rows a publish removes
    Given the cached row for ref "43/02" in workspace "acme" was authored by <authored_by>
    When <publisher> publishes workspace "acme" with an authoritative ref set that <ref_set>
    Then the cached row for "43/02" is <outcome>

    Examples: authorship decides, and nothing else does
      | authored_by       | publisher | ref_set                      | outcome |
      | control-1         | control-1 | names it                     | kept    |
      | control-1         | control-1 | omits it                     | deleted |
      | worker-a          | control-1 | omits it                     | kept    |
      | worker-a          | worker-a  | omits it                     | deleted |
      | worker-a          | worker-b  | omits it                     | kept    |
      | worker-a          | worker-a  | names it                     | kept    |
      | control-1         | control-1 | is absent (a partial report) | kept    |
      | control-1         | control-1 | is present but empty         | deleted |
      | worker-a          | control-1 | is present but empty         | kept    |
      | no recorded author| control-1 | omits it                     | kept    |

  # Retraction is scoped to the workspace being published. Two workspaces can carry the same ref
  # string, and a publish of one must never reach into the other's rows — the same scoping the
  # sweep it replaces always had (`WHERE workspace_id = ?`).
  Scenario: publishing one workspace never retracts another workspace's rows
    Given the control has also published "beta", whose disk carries a ref "43/02" of its own
    When the control publishes "acme" with an authoritative ref set that omits "43/02"
    Then a fresh read of "acme"'s cached rows reports no row for "43/02"
    And a fresh read of "beta"'s cached rows still reports its own "43/02"

  # AC4's named case, stated as its own scenario because it is the one an implementer is most
  # likely to get wrong: a ref the CONTROL created and later a WORKER reported carries the
  # WORKER's node id from that moment, so a control-side retraction cannot touch it — correct,
  # because the worker's copy is the live one.
  Scenario: a ref first authored by the control and later reported by a worker survives a control-side retraction
    Given the control authored "43/02" from its own disk
    And "worker-a" then reported "43/02" with status "in-progress"
    When the control publishes an authoritative ref set that omits "43/02"
    Then a fresh read of "acme"'s cached rows still reports "43/02" with status "in-progress"
    And a later publish from "worker-a" whose ref set omits "43/02" removes the row

  # ABSENT vs EMPTY — the boundary that decides whether a partial report can wipe a node's own
  # work. A delta/partial report claims authority over nothing and must retract nothing; a node
  # that genuinely carries no items publishes an explicitly EMPTY set and retracts everything it
  # authored. The two cannot be conflated, or every streamed delta would retract the worker's
  # other rows.
  Scenario: a partial report retracts nothing, while an explicitly empty authoritative set retracts everything that node authored
    Given "worker-a" has reported "43/01" and "43/02", so both rows are worker-authored
    When "worker-a" streams a partial report naming only "43/02", with no authoritative ref set
    Then a fresh read of "acme"'s cached rows still reports both "43/01" and "43/02"
    When "worker-a" then publishes an explicitly empty authoritative ref set
    Then a fresh read of "acme"'s cached rows reports neither "43/01" nor "43/02"
    And it still reports every row the control authored

  # A read fault is not a retraction. `readWorkspaceProjectionItems` returns rows AND errors; an
  # item whose record doc will not parse yields an error, not a row — and must therefore NOT drop
  # out of the publishing node's authoritative ref set, or a momentarily-broken frontmatter would
  # silently delete the item from the mesh's only readable copy.
  Scenario: an item whose record doc fails to parse this tick is reported as an error, never retracted
    Given the control has published, so "43/03" is cached with status "not-started"
    When "43/03"'s record doc frontmatter becomes unparseable and the control publishes again
    Then the publish result counts the unreadable item among its skipped items
    And the cached projection errors for "acme" name that record doc
    And a fresh read of "acme"'s cached rows still reports "43/03" with status "not-started"

  # The never-evict rule (ADR-006), as an OBSERVABLE outcome rather than an absence: age alone
  # never removes anything. The rows below are older than any staleness window the milestone
  # configures, and every publish leaves them readable.
  Scenario: no publish ever deletes a row because of its age
    Given "worker-a" reported "43/02" long enough ago to be past any configured staleness window
    And the worker has stopped reporting entirely
    When the control publishes its workspace snapshot repeatedly over the window
    Then a fresh read of "acme"'s cached rows still reports "43/02" with the worker's last-reported status on every read
    And no cached row is ever removed by the passage of time alone
