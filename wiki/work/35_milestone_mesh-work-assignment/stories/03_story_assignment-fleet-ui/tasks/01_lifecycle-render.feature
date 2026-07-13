@executable @ui @work @distribution
Feature: The pure assignment-chip helper maps a lifecycle state to its chip — label + mark + token + motion travel together
  In order that an operator reads a dispatched item's state at a glance — colour AND label, never colour alone —
  a framework-free helper maps an assignment row's state to a fixed chip descriptor, mirroring the run-state ramp
  so that the fleet renders `assigned → accepted → running → done|failed` in the ONE chip vocabulary the board already speaks.

  # DESIGN §4 (the assignment ramp table) + ADR-001 (the lifecycle state set). The helper mirrors the existing
  # run-state `CHIP_RAMP` (ui/src/board/runs.mjs:90-96) and its `runStateChip(state)` pure mapping
  # (runs.mjs:102-104): one framework-free ESM module — no React, no DOM, no I/O, no clock — so these scenarios
  # run HEADLESSLY (@executable), exactly like the run-chip / relative-time / in-flight helpers. The token is a
  # THEME token (muted/secondary/primary/destructive — ui/src/index.css), resolved through the SAME
  # `runChipClasses(token)` map the board uses (Fleet.tsx:730-742), never a hex, never a fleet-local palette.
  #
  # FEASIBILITY-CONFIRMED: `animate-pulse` is applied on the chip dot ONLY when pulsing (Fleet.tsx:763), and the
  # run chip already emits `{ label, token, mark }` — this helper is the assignment-family sibling returning
  # `{ label, token, mark, motion }`, so the render surface stays a thin consumer of a pure descriptor.
  #
  # SEAM SPLIT — this task is the PURE mapping only. WHERE the chip renders (attention row / node row) and that it
  # LOOKS right is the @uat visual review (task 03). The read SHAPE that feeds this helper is task 00. The
  # no-write posture is task 02. That a `running` chip means the worker is executing in an isolated worktree is
  # the SPEC's execution outcome (Story 02) — cross-referenced, not restated here. The a11y lane is OFF for this
  # story (no "a11y" in work.tags.domains — no axe-core run, no a11y finding).

  Background:
    Given the pure assignment-chip helper is imported with no DOM and no clock

  # The ramp, one row per state (DESIGN §4). Label + mark + token + motion are fixed together; the progression
  # `assigned → accepted → running` climbs the run chip's brightness ramp (muted → secondary → teal) so an
  # operator reads "warming up → live"; `done` reuses teal + ✓ byte-for-byte; `failed` reuses destructive.
  # ONLY `running` carries motion. `failed` uses a `!` mark (not a bare dot) so it is distinguishable at a
  # glance while still travelling with its red token and `failed` label — colour + label + mark all agree.
  Scenario Outline: each lifecycle state maps to its fixed chip — label, mark, token, and motion together
    Given an assignment row in state "<state>"
    When the chip descriptor is selected for that row
    Then the chip label is "<label>"
    And the chip mark is "<mark>"
    And the chip token is "<token>"
    And the chip motion is "<motion>"
    And the descriptor never returns a token without its paired label and mark

    Examples: the ramp — colour AND label travel together; only running pulses (DESIGN §4)
      | state    | label    | mark          | token       | motion |
      | assigned | assigned | a hollow dot  | muted       | none   |
      | accepted | accepted | a filled dot  | secondary   | none   |
      | running  | running  | a pulsing dot | primary     | pulse  |
      | done     | done     | a ✓           | primary     | none   |
      | failed   | failed   | a !           | destructive | none   |

  # A reclaimed / stale assignment is NOT a sixth colour (DESIGN §4 note): it renders as `failed` (destructive
  # `!` + `failed` label) PLUS a trailing `· reclaimed` note, so a worker that dropped an assignment mid-flight
  # surfaces as a red, labelled, NOTED failure — never a silent reversion to `assigned` or a vanished chip.
  # "Degraded states must stay visible" (34/ADR-008), expressed in the chip.
  Scenario Outline: a reclaimed or stale assignment reads as failed plus a degraded `· reclaimed` note
    Given an assignment row in state "<state>" with reclaimedAt "<reclaimedAt>"
    When the chip descriptor is selected for that row
    Then the chip label is "failed"
    And the chip mark is "a !"
    And the chip token is "destructive"
    And the chip carries a trailing note "reclaimed"
    And the chip is NOT a sixth colour and does not revert to "assigned" or vanish

    Examples: reclaimed and stale both degrade-visibly to failed + reclaimed
      | state     | reclaimedAt              |
      | reclaimed | 2026-07-08T10:05:00.000Z |
      | stale     | 2026-07-08T10:05:00.000Z |

  # A withdrawn assignment is terminal and operator-created (ADR-001) — NOT a reclaim. It carries the failed
  # token/label (a stopped dispatch reads as not-succeeded) but NO `· reclaimed` note, since reclaimedAt is null
  # (the reclaim note is bound to reclaim provenance, not to every terminal-non-done state).
  Scenario: a withdrawn assignment reads as failed with no reclaim note
    Given an assignment row in state "withdrawn" with a null reclaimedAt
    When the chip descriptor is selected for that row
    Then the chip label is "failed"
    And the chip token is "destructive"
    And the chip carries no "reclaimed" note

  # An unknown or absent state falls back to the quiet muted form (never throws) — a forward-compatible read of a
  # future state, matching runStateChip's UNKNOWN_CHIP fallback (runs.mjs:98,102-104). The card never crashes on
  # a state the render layer has not learned yet.
  Scenario Outline: an unknown or absent state degrades to a quiet muted chip, never a throw
    Given an assignment row in state "<state>"
    When the chip descriptor is selected for that row
    Then the chip token is "muted"
    And the helper does not throw

    Examples: forward-compatible fallbacks
      | state         |
      | queued        |
      | (empty)       |
      | some-future   |

  # Keep-last-good (DESIGN §3 loading/error) — the chip helper is PURE over the row it is given; a SILENT poll
  # error hands the render the LAST-GOOD row, and the helper returns the same descriptor as before. It never
  # emits a "loading"/"error"/empty chip on a silent re-poll — the card never tears (Fleet.tsx:85-103 keep-last-
  # good idiom; a failed silent poll stalls the freshness label, never a torn chip).
  Scenario: on a silent poll error the helper still describes the last-good assignment — the card never tears
    Given the last-good assignment row was state "running"
    And a subsequent silent poll fails and the render is handed the last-good row
    When the chip descriptor is selected for the last-good row
    Then the chip is the "running" chip (label "running", token "primary", a pulsing dot)
    And the helper emits no loading, error, or empty chip for the silent-poll failure
    And the last-good state is not cleared to "assigned" or to empty
