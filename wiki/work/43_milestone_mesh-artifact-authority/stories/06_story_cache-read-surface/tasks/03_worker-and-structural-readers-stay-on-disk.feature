<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — ADR-005 STAGE 3: the boundary is locked in BOTH directions. The
# NON-migration is a first-class coverage obligation, not an omission. RESEARCH §5.3
# (b) — the worker-side reads (`mesh-worker-execution` ×5, `global-work-store:601`) —
# and §5.4 (c) — the structural reads (`work-reindex` ×3, `insert-shared` ×4,
# `work-upgrade:106`, `effects/table:258`, `effects/reconcile:75`) — MUST keep reading
# their own disk.
#
# WHY IT NEEDS SCENARIOS AND NOT JUST A GUARD: a later well-meaning "finish the
# migration" that moved a worker onto the control's cache would make a WORKER READ
# SOMEONE ELSE'S OPINION OF ITS OWN CHECKOUT — a closed loop in which the control's
# copy of the worker's state becomes the worker's own input, and the value becomes
# self-reinforcing rather than observed. And a structural operation moved onto the
# cache would rename, renumber or rewrite against a set that is not the set on disk.
# Both are behavioural failures with behavioural symptoms; both are written below.
#
# THE SOURCE-LEVEL POSITIVE ASSERTION IS NOT HERE. "These modules still import
# work.mjs's disk readers" is a source fact and lives in the arch-test
# `acd-cache-read-surface-boundary` (green today, pinning them positively, arming on
# the seam landing). ARCHITECTURE's own "invariants MOVED out of the feature layer"
# list forbids restating it as Gherkin. What is here is the BEHAVIOUR that assertion
# protects — the symptom a future over-migration would produce.
#
# WAVE 3 (ADR-009) — presupposes 43/02 and 43/04. The echo-chamber scenario in
# particular needs 43/02: it depends on the control's cache holding a row for a ref
# the worker is authoring WITHOUT the control's publish tick having clobbered it.
#
# LITMUS: every Then is confirmable from a command's `--json` output run ON THE NODE
# IN QUESTION, from the frame a worker actually streams (its content as the control
# reads it back), or from the on-disk folder set after a structural command. No source
# read. Rule 8's regression guards ride here too: `validate` stays folder↔frontmatter,
# and `readWorkspaceProjectionItems` still serves a node reading its own disk.

@executable @cli @work @work-stream @distribution
Feature: the worker reads its own checkout and the structural operations read their own disk — the migration stops at the boundary
  In order that the cache never becomes an echo chamber, and that a rename operates on the folders it is renaming rather than on a copy of them
  a worker's self-read and every structural operation must keep answering from the disk in front of them, whatever the control node's cache believes

  Background:
    Given a mesh in which the control node's cache holds rows for milestone "07" and its story "07/01"
    And a WORKER node with its own materialised worktree containing "07" and "07/01"
    And the two sides can be made to disagree deliberately, because that disagreement is the whole subject of this task

  # THE ECHO-CHAMBER TEST — the decisive worker-side scenario, and the one that fails
  # if `mesh-worker-execution`'s reads are ever "tidied up" onto the cache. The cache
  # holds a status the worker did not author; the worker's own worktree holds a newer
  # one it did. Whatever the worker reports next must come from ITS OWN TREE. If it
  # ever reports the cache's value, the control's copy has become its own source and
  # nothing in the mesh observes reality any more.
  Scenario: a worker reports its own worktree's state, never the control's copy of it
    Given the control node's cache holds "07/01" at status "in-progress", last reported by a DIFFERENT node
    And the worker's own worktree holds "07/01" at status "done", which the worker itself just authored
    When the worker's next stream tick reports its active worktree state
    Then the state the control reads back for "07/01" is "done", the worker's own
    And running `aof work find 07/01 --json` INSIDE the worker's worktree reports "done"
    And running `aof work list --json` INSIDE the worker's worktree reports the worktree's own rows, not the control's

  # The same rule for the worker's CONTENT read (`global-work-store:601`,
  # `readWorkspaceContentRecords` — "the WORKER-side content read"): the bodies a
  # worker streams are the bytes in its own tree. A worker that streamed the cache's
  # copy back would make every artifact permanently un-updatable — the control would
  # only ever receive what it already had.
  Scenario: the artifact bodies a worker streams are its own worktree's bytes
    Given the control node's cache holds an OLD STORY.md body for "07/01"
    And the worker's worktree holds a NEWER STORY.md body for "07/01" that it just wrote
    When the worker's next stream tick reports its active worktree content
    Then a fresh `aof work doc 07/01 STORY --json` on the CONTROL node returns the worker's newer body
    And repeating the tick with no further edit leaves that body unchanged rather than reverting it

  # A worker resolving a ref for its own execution resolves against its own checkout.
  # This is the read that decides which directory an agent is pointed at; answering it
  # from the control's cache would point a run at a path derived from another node's view.
  Scenario: a worker resolves the ref it is executing against its own materialised worktree
    Given the control node's cache holds a `dir` for "07/01" that reflects the CONTROL node's paths
    When the worker resolves "07/01" to execute it
    Then the resolved directory is inside the WORKER's own worktree
    And the agent is started against that directory

  # QA case matrix — the STRUCTURAL operations (RESEARCH §5.4). The disk is the SUBJECT
  # of each of these, so each is probed with a cache that KNOWS REFS THE DISK DOES NOT.
  # The observable in every row is the same shape: the operation acts on exactly the
  # folders that are there, the stream stays valid, and no folder is invented for a
  # cache-only ref.
  Scenario Outline: a structural operation acts on the folders on disk, never on a cache-only ref
    Given the control node's disk holds top-level items "00" through "05"
    And the cache additionally holds a row for "07" that has no folder on this disk
    When I run <invocation>
    Then the command exits 0
    And <observable>
    And no folder is created, renamed or removed for the cache-only ref "07"
    And a fresh `aof work validate --json` over the whole stream reports zero findings

    Examples: the structural operations SPEC's out-of-scope bullet keeps on disk
      | operation                 | invocation                                            | observable                                                                    |
      | work-reindex (via insert) | `aof work insert-milestone "widget-support" --at 3 --json` | it reports shifting exactly the 3 on-disk items numbered 3 and above     |
      | insert-shared (nested)    | `aof work insert-story "auth-guard" --at 1 --under 5 --json` | it reports shifting exactly the on-disk sibling stories numbered 1 and above |
      | work-upgrade:106          | `aof work upgrade --dry-run --json`                   | the planned rewrites name exactly the on-disk items' record docs               |

  # `effects/table:258` (`remapRunRecordRefs`, the `stream.reindexed` reactor) and
  # `effects/reconcile:75` (the startup self-heal over this node's own journal) are both
  # reactors over THIS node's local checkout. Their observable is the same: after a real
  # structural renumber, the LOCAL run records follow the LOCAL folders.
  Scenario: after a renumber, this node's run records are remapped against this node's own folders
    Given the control disk holds "05" with a run record, and the cache holds a row for "07" with no folder here
    When I run `aof work insert-milestone "widget-support" --at 5 --json`
    Then a fresh `aof work run-status 06 --json` reports the run that was recorded against "05"
    And no run record is created or remapped for the cache-only ref "07"
    And a fresh `aof work validate --json` reports zero findings

  # REGRESSION GUARD (rule 8): `validate` is a folder↔frontmatter CONSISTENCY check and
  # stays structural. Its subject is the disk, so a cache that disagrees must neither
  # add a finding nor silence one.
  Scenario: validate stays a folder-versus-frontmatter check, unmoved by anything the cache believes
    Given the cache holds a status for "05" that differs from the control disk's frontmatter
    And the cache holds a row for "07" that has no folder on this disk
    And the control disk holds an item whose folder number and frontmatter `number` genuinely disagree
    When I run `aof work validate --json`
    Then the genuine folder-versus-frontmatter mismatch is reported
    And no finding is reported for the cache-only ref "07"
    And no finding is reported merely because the cache's status for "05" differs from disk

  # REGRESSION GUARD (rule 8): `readWorkspaceProjectionItems` is DUAL-USE and is not a
  # reader that must migrate — it is how a node reads its OWN disk to report its OWN
  # state. Its behavioural obligation, and the one ADR-004's author-retraction rests
  # on: a publishing node publishes what it authored, and never re-authors another
  # node's row under its own name.
  Scenario: a node publishing its own state publishes its own disk, and never re-stamps another node's row
    Given the cache holds "07/01" last reported by the REMOTE node "aof-wsl"
    And the control node's own disk holds "05" and "06", which it authored
    When the control node publishes its own workspace state
    Then the cache's rows for "05" and "06" are reported by the control node and match its disk
    And the cache's row for "07/01" is still reported by "aof-wsl", with its `syncedAt` unchanged
    And a fresh `aof work find 07/01 --json` still reports status "done" and `reportedBy` "aof-wsl"

  # REGRESSION GUARD (rule 8), in the only form it is observable: `work.mjs` gains
  # nothing. Its four disk readers keep their exact return shape, so none of the 37
  # importers that were never migrated can have changed behaviour. The IMPORT/EXPORT
  # count itself is structural and belongs to the arch-test, not here.
  Scenario: work.mjs's disk readers keep their exact return shape, so the unmigrated importers are untouched
    Given the cache holds rows the disk does not, and a status for "05" that differs from disk
    When work.mjs's `listItems`, `findWork`, `nextWork` and `listStream` are each called directly
    Then each returns exactly the disk's items, in the shape it returned before this story
    And no returned row carries an `answeredFrom`, `reportedBy` or `syncedAt` field
    And `findWork` for "05" reports the DISK's status
