<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the DRAIN (STORY.md AC5, ADR-001): the worker daemon consumes the
# queue on its EXISTING stream tick (`pushActiveWorktreeState`, mesh-launcher.mjs:1448,
# fired every `streamSyncSeconds` at :1378-1392), de-duplicates by path, reads current
# content for the NAMED artifacts only, and sends ONE batched frame. The drain is
# idempotent and loss-averse: it consumes by rename-then-read (or a persisted offset),
# so a crash mid-drain RE-SENDS rather than loses. One loop does both jobs — the
# targeted push AND the reconciliation backstop STATE mandates keeping.
# LITMUS: every Then is confirmable from an observable outcome on one of four channels
# — (a) the batched frame on the wire (which artifacts it names, how many frames per
# tick), (b) the CONTROL node's answers, read through the existing verbs
# `aof work doc <ref> <NAME> --json` and `aof work tasks <ref> --json`, (c) the control
# row's own `updatedAt` / `reportedBy` stamps (a row NOT re-sent is observable as an
# `updatedAt` that did not move), and (d) the launcher's coded warning channel, read
# through `aof mesh logs --node <worker> --json`. No source read anywhere.
#
# WHY THE `updatedAt`-DID-NOT-MOVE ASSERTION IS SOUND: `upsertWorkItemContent`
# (global-work-store.mjs) already stamps `node_id` + `updated_at` per (ref, doc) row on
# every write, and `readWorkItemDoc` already returns both. So "this artifact was not
# re-sent" has a real, pre-existing black-box read behind it; nothing new is needed to
# make it confirmable.
#
# SCOPE BOUNDARY (flagged at refine): the READ-side hop this task asserts against —
# `work doc` / `work tasks` answering on the control from what a worker streamed — is
# the EXISTING streamed-doc fallback (`board-worker-stream.mjs`, schema v5), widened by
# this story's manifest (task 02). It is NOT the `commands/resolve.mjs` cache-first
# migration, which is story 43/06's subject. If the widened `tasks` read turns out to
# belong to 43/06 rather than here, these Thens move with it — the OUTCOME (a control
# node that can read a live remote item's features) stays this story's.
#
# Indicative names only: "the queue file", "the batched frame", "the consumed batch".

@cli @work @distribution
Feature: the worker daemon drains the queue on its existing tick and sends one batched frame that names only what changed
  In order that a hot per-write hook costs one wire frame per tick rather than one per keystroke, and that no artifact is ever lost between the write that named it and the frame that carries it
  the daemon must de-duplicate the queue by path, read content for the named artifacts only, send one batched frame, and consume the queue in a way that re-sends rather than loses when it is interrupted

  Background:
    Given a worker daemon streaming an active worktree for item "43/03" on its existing stream tick
    And a control node that already holds this item's previously streamed artifact rows
    And the artifact-sync queue file for that worktree

  # HEADLINE (AC5) — one tick, one frame, only the named artifacts. This is the O(changed)
  # property that makes widening the artifact set (task 02) affordable at all.
  @executable
  Scenario: one tick drains the queue and sends a single batched frame carrying exactly the named artifacts
    Given the queue holds one line each for STORY.md, `tasks/00_a.feature` and `tasks/01_b.feature`
    When the stream tick runs once
    Then exactly one artifact frame is sent for "43/03" in that tick
    And the frame carries bodies for exactly those three artifacts
    And the frame carries no body for any artifact the queue did not name
    And after the tick the control node answers `aof work doc 43/03 STORY --json` with the worktree's current STORY.md body
    And after the tick the control node's `aof work tasks 43/03 --json` lists both feature files
    And the queue file no longer offers those three lines to a subsequent tick

  # DE-DUPLICATION BY PATH (AC5). A refine writes the same file many times inside one
  # tick window — the frame must carry ONE body per path, and it must be the file's
  # CURRENT content, never a replay of the intermediate states. The separator row is
  # not academic: the Windows control node and the WSL worker spell the same path
  # differently, and a de-duplication keyed on raw bytes would send the same file twice.
  # (The hook itself carries the payload's path verbatim — canonicalisation is the
  # drain's job, deliberately, because normalising in the hook would require a cwd
  # derivation. See task 00.)
  @executable
  Scenario Outline: the batch carries one body per distinct artifact, whatever the queue held
    Given the queue holds <queued>
    When the stream tick runs once
    Then the frame carries exactly <bodies> artifact body/bodies
    And every body carried is the file's current content on disk at the moment of the drain
    And <note>

    Examples:
      | queued                                                        | bodies | note                                                       |
      | one line for STORY.md                                         | 1      | the single named artifact is sent                          |
      | five lines for STORY.md (edited five times in one tick window) | 1     | no intermediate body is sent                               |
      | three lines for STORY.md and two for STATE.md                 | 2      | each distinct artifact appears exactly once                |
      | two lines for the same file spelled with `/` and with `\`     | 1      | the same file is not sent twice because of path separators |
      | two lines for STORY.md, the file deleted before the tick ran   | 0      | the deletion is reported, never sent as an empty body      |
      | one line naming a file outside the item's artifact manifest   | 0      | an unmanifested path is not streamed (task 02 bounds the set) |

  # ONLY THE NAMED ARTIFACTS ARE READ (AC5). Stated as an outcome rather than as a
  # claim about the code: the artifacts the queue did NOT name keep the `updatedAt`
  # they already had on the control. A tick that re-read and re-sent everything would
  # move every stamp.
  @executable
  Scenario: an artifact the queue did not name is not read and its control-side row does not move
    Given the worktree holds eight record docs and six `tasks/*.feature` files, all previously streamed
    And the queue holds one line, for DESIGN.md only
    When the stream tick runs once
    Then the frame carries exactly one artifact body
    And the control node's DESIGN row carries a new `updatedAt` and this worker as `reportedBy`
    And every one of the other thirteen artifacts' rows carries the `updatedAt` it had before the tick
    And every one of those thirteen bodies is byte-identical to before the tick

  # LOSS-AVERSION IS BEHAVIOURAL AND MUST BE PROVEN (AC5). Rename-then-read (or a
  # persisted offset) is the mechanism; the CONTRACT is that an interruption at any
  # point re-sends rather than loses. A duplicate send is harmless — the content tables
  # are upserted per (ref, doc) — so "re-send" is always the safe side to fail to.
  @executable
  Scenario Outline: a drain interrupted at any point re-sends on the next tick and loses nothing
    Given the queue holds lines for STORY.md, ARCHITECTURE.md and `tasks/00_a.feature`
    And the control node holds none of those three bodies yet
    When the daemon is killed <when>
    And the daemon restarts and its next stream tick runs
    Then the control node holds the current body of all three artifacts
    And no artifact named in the queue is missing from the control node
    And <effect>

    Examples:
      | when                                              | effect                                                        |
      | after the batch is consumed, before any file read | all three are re-sent in the next tick's frame                 |
      | after the files are read, before the frame is sent | all three are re-sent in the next tick's frame                 |
      | after the frame is sent, before the batch is discarded | all three are sent again and the control-side rows are unchanged by the repeat |
      | while the hook is appending, leaving a torn final line | every whole line drains; the torn line is reported as a coded degrade, never silently dropped |

  # IDEMPOTENCE. Draining the same consumed batch a second time must leave the control
  # node in the same state — no duplicate rows, no duplicate bodies, no growth.
  @executable
  Scenario: re-draining an already-sent batch leaves the control node's state unchanged
    Given a batch for STORY.md and STATE.md that has already been drained and sent
    When the same batch is drained and sent a second time
    Then the control node holds exactly one row per artifact for "43/03"
    And each body is byte-identical to what the first send delivered
    And `aof work doc 43/03 STORY --json` returns exactly one body, not a concatenation

  # THE CODED DEGRADE (AC3's other half). An `unresolved-path` line reaches the drain,
  # and the drain REPORTS it. Silence here would restore the exact failure mode the
  # trigger exists to remove — and the well-formed artifacts in the same batch must
  # still arrive, so one degraded line can never cost a whole tick.
  @executable
  Scenario: an unresolved-path line is reported as a coded degrade and does not cost the rest of the batch
    Given the queue holds one `unresolved-path` line and one line naming STORY.md
    When the stream tick runs once
    Then the control node holds the current STORY.md body
    And `aof mesh logs --node <the worker's node name> --json` shows a coded warning naming `unresolved-path`
    And the tick completed and the next tick ran on schedule

  # ONE LOOP DOES BOTH JOBS (AC5 / STATE): the reconciliation backstop is retained, so
  # a file the hook does not cover — anything written by `Bash`, deliberately outside
  # the matcher — still converges. This is the scenario that proves the backstop was
  # kept rather than replaced.
  @executable
  Scenario: an artifact written outside the hook's matcher still converges on the reconciliation backstop
    Given the queue is empty
    When the agent writes RESEARCH.md into the worktree through a `Bash` command, so no hook fires
    And the stream tick runs once
    Then the control node answers `aof work doc 43/03 RESEARCH --json` with the new body
    And no additional connection, port or listening surface was opened on the worker to deliver it

  # THE DRAIN RIDES THE EXISTING TICK — no new timer, no new transport. Observable as:
  # the artifacts arrive inside one `streamSyncSeconds` window, on the same connection
  # that already carries the item rows, and a worker with no live transport enqueues
  # without ever draining (and loses nothing when the transport returns).
  @executable
  Scenario: the batch rides the existing stream connection and survives a disconnected window
    Given the worker's stream transport is down
    When the agent writes STORY.md and STATE.md
    And two stream ticks pass with no transport
    Then nothing is sent and nothing is discarded from the queue
    When the transport returns and the next tick runs
    Then both artifacts arrive in one batched frame on the same connection that carries the item rows
    And both arrive within one `streamSyncSeconds` window of the transport returning

  # THE HUMAN ACCEPTANCE (the story's whole point). Everything above can be driven from
  # a fixture; this cannot — it needs a real remote node running a real Claude Code
  # agent whose own writes fire the hook, and an operator reading the control node
  # WHILE the run is still live. It is the outsider check on
  # `commands/tasks.mjs:15` — "the features live in the worker's worktree and are not
  # streamed yet".
  @uat
  Scenario: the operator reads a remote agent's freshly written features on the control node, mid-run
    Given a real assignment for "43/03" executing on the Mac worker with a live Claude Code session
    And the control node's own checkout has no `tasks/` directory for that item
    When the agent authors two `tasks/*.feature` files and edits STATE.md during the run
    And the operator runs `aof work tasks 43/03 --json` on the control node while the run is still executing
    Then both feature files are listed with their scenarios and lane counts
    And `aof work doc 43/03 STATE --json` returns the body the agent just wrote
    And each answer is stamped with the worker that reported it
    And the operator waited for neither the run to settle nor the worktree to be deleted
