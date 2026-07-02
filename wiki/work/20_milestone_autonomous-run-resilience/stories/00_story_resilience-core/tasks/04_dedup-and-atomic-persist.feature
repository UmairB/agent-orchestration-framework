@cli @work @work-stream @executable
Feature: The mint path forbids a duplicate non-terminal run, mints collision-safe ids, and persists atomically
  In order that an item never has two in-flight runs, two interleaved mints never collide on a runId, and a process killed mid-write never leaves a torn record
  the store's mint path (startRun and retryRun) rejects a second non-terminal run for an item with duplicate-run, retries the seq on a runId collision so concurrent mints get distinct ids, and routes every persist through the atomic src/fs.mjs:writeText temp+rename seam,
  so that 19's reserved queued state finally has a guarded producer (ADR-006), the 19/R2b concurrent-mint race is closed, and the 19/R2a non-atomic-write gap under the whole durability promise is closed (ADR-007).

  # ARCHITECTURE ADR-006 (dedup + collision-safe mint) + ADR-007 (atomic persist,
  # closing the 19/R2a + 19/R2b carry-forwards). The STRUCTURAL guards are two arch-tests
  # — acd-run-dedup-no-duplicate (no duplicate non-terminal run; collision-safe) and
  # acd-run-persist-atomic (no raw writeFile of a run record; imports writeText). This
  # feature is the OBSERVABLE behaviour of both.
  # LITMUS: rejection codes, file counts under runs/, distinct ids, and a recoverable
  # store after a write — all observable in-process over a controlled runs/ → @executable.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the run store loaded in-process from src/run-store.mjs

  # Dedup (ADR-006): "no duplicate NON-TERMINAL run per item". With a queued OR a running
  # run already in flight, a second mint is rejected duplicate-run and writes NO second
  # file; the first record is byte-unchanged. The guard applies to BOTH mint verbs and
  # BOTH non-terminal states. The "retryRun while this item's own run is in flight" row
  # is the anti-loop BACKSTOP story 02 leans on (02_anti-loop): a self-retry the skill
  # failed to skip is still caught by the store.
  # NOTE (feasibility, 19/ADR-001): no verb MINTS a queued run yet — queued is the
  # reserved state ADR-006 gives a guard, not a producer. The "queued" precondition is a
  # directly-written fixture record (state: "queued"); the guard only READS state ∈
  # {queued, running}.
  Scenario Outline: a second non-terminal run for an item is rejected duplicate-run, minting nothing
    Given item "20" already has a "<existing>" run
    When I "<mint>" for item "20"
    Then the store raises a "duplicate-run" error
    And item "20" runs/ still contains exactly one run record
    And the existing run record is byte-unchanged

    Examples: a running run blocks a second mint by either verb
      | existing | mint                                          |
      | running  | startRun a second run                         |
      | running  | retryRun a separate prior failed run          |
      | running  | retryRun while this item's own run is in flight |

    Examples: a queued run (19's reserved state) also blocks a second mint
      | existing | mint                                          |
      | queued   | startRun a second run                         |
      | queued   | retryRun a separate prior failed run          |

  # The dedup guard is scoped to NON-terminal runs only (ADR-006): a terminal run
  # (done/failed/cancelled) does NOT block a new mint — otherwise an item could never be
  # run again. A fresh start succeeds when the only prior runs are terminal.
  Scenario Outline: a terminal run does not block a new mint
    Given item "20" has only a "<terminal>" run
    When I start a run for item "20"
    Then a new running run is minted
    And item "20" runs/ contains both the terminal run and the new running run

    Examples:
      | terminal  |
      | done      |
      | failed    |
      | cancelled |

  # Collision-safe mint (ADR-006, closing 19/R2b): two runs minted for the SAME item at
  # the IDENTICAL injected instant must still get distinct runIds — the seq segment
  # disambiguates (0000, 0001) and the write-if-absent mint retries rather than the second
  # silently overwriting the first. Same item (the first completed before the second is
  # minted, so dedup permits the second); both files persist. (Across DIFFERENT items the
  # ids may legitimately share a stamp+seq in distinct runs/ dirs — harmless and not what
  # this guards; the collision-safe retry fires within ONE item's dir, mirroring 19's
  # same-instant scenario.)
  Scenario: two same-item mints at the identical injected instant get distinct runIds via the seq segment
    Given item "20" has one completed run, then is minted a new run at the identical injected instant
    Then the two run records have distinct runIds
    And the two runIds share an identical "<createdAt-compact>" segment
    And the two "<seq>" segments are "0000" and "0001"
    And item "20" runs/ contains exactly two record files, neither overwritten

  # Atomic persist (ADR-007, closing 19/R2a): every run-record write goes through the
  # atomic writeText temp+rename seam, so a write either fully lands or leaves the PRIOR
  # file intact — never a torn half-written record. Observed: after a completed write the
  # record reloads fully-formed; a simulated mid-write failure leaves the last good record
  # readable (the read side's tolerance is never even reached for a committed write).
  Scenario: a persisted run record is always fully-formed on reload, never torn
    Given item "20" has a running run persisted through the store
    When I load the run store fresh and read the runs for item "20"
    Then the run record parses as complete JSON carrying all thirteen frozen keys
    And no partial or temp (.tmp-) artifact remains in the item's runs/ directory

  # Every NEW persist path routes through the same atomic seam (ADR-007): the heartbeat
  # bump, the reclaim force-fail, and the retry mint each leave a fully-formed record on
  # disk — proving the seam is uniform across all of milestone 20's writes, not just
  # startRun.
  Scenario Outline: every milestone-20 persist path leaves a fully-formed record
    Given item "20" with a run set up for "<persist-path>"
    When that persist path runs and I reload the run store fresh
    Then the resulting run record parses as complete JSON
    And no .tmp- artifact remains in the item's runs/ directory

    Examples:
      | persist-path           |
      | a heartbeat bump       |
      | a reclaim force-fail   |
      | a retry-lineage mint   |
