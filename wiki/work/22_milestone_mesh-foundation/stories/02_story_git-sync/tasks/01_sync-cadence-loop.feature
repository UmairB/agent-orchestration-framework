@cli @work @distribution @executable
Feature: The background sync loop is a thin face over mesh:sync on a tunable, batched cadence
  In order to keep records flowing between nodes without a daemon holding transport logic, and to keep commit volume sane (PRD A1)
  the background loop invokes mesh:sync on a tunable cadence read from config, batching one commit per tick that has staged changes,
  so that the transport logic stays a registered, testable command and the loop carries only the timer — the board-server-is-a-thin-face split (08/ADR-001).

  # ARCHITECTURE ADR-004: the loop is a thin face/runner — a timer that repeatedly invokes the
  # mesh:sync command. This feature asserts the loop is timer-only (no transport logic) and the
  # cadence is tunable + default-safe. The cadence assertion uses an INJECTED ticker/clock so it
  # does not wall-clock-wait. The transport itself is task 00; this is purely the loop face.
  Background:
    Given the mesh commands registered in the command core
    And the background sync loop loaded with an injected ticker (no real wall-clock wait)

  # The loop invokes mesh:sync once per tick — it is a timer over the command, holding no
  # transport logic of its own.
  Scenario: the loop invokes mesh:sync once per cadence tick
    Given the loop is started
    When the injected ticker fires 3 times
    Then mesh:sync was invoked exactly 3 times
    And the loop performed no git operation directly (it only invoked the command)

  # Cadence is tunable from config (mesh.sync.cadenceSeconds). A valid positive number is used
  # verbatim. This matrix pins the LEGAL class at its boundaries: the documented default band
  # edges (A1's 10–30s) and a value outside the band (the loop honours config, it does not clamp).
  Scenario Outline: a valid positive cadence is read from config verbatim
    Given config "mesh.sync.cadenceSeconds" is <value>
    When I start the loop
    Then the loop's tick interval is <interval> seconds

    Examples:
      | value | interval |
      | 30    | 30       |
      | 10    | 10       |
      | 1     | 1        |
      | 600   | 600      |

  # A missing or malformed cadence falls back to the documented default (15s) — the loop never
  # crashes on bad config. The matrix enumerates EVERY malformed equivalence class that can
  # appear in a JSON-backed config:
  #   - absent / null     : no value configured;
  #   - wrong type        : a non-number string "fast", the numeric-looking string "30" (the
  #                         loop must NOT silently coerce a string to a number, so "30" falls
  #                         back — the type boundary), and a boolean true (JSON-legal, wrong type);
  #   - non-positive      : 0 and -5 (a non-positive interval is meaningless);
  #   - non-integer       : 15.5 (cadence is whole seconds — a float falls back rather than being
  #                         silently floored).
  # QA: extends the PO's set (absent/"fast"/0/-5) with null, the numeric string, a boolean, and a
  # float — the type + non-positive + non-integer boundaries. (Non-finite values like Infinity are
  # not JSON-representable, so they cannot reach a JSON config and are deliberately not rows.)
  Scenario Outline: a missing or malformed cadence falls back to the 15s default
    Given config "mesh.sync.cadenceSeconds" is <value>
    When I start the loop
    Then the loop's tick interval is 15 seconds (the documented default)
    And the loop started without crashing on the bad config

    Examples:
      | value     |
      | absent    |
      | null      |
      | "fast"    |
      | "30"      |
      | true      |
      | 0         |
      | -5        |
      | 15.5      |

  # Batching: a tick with staged changes produces one commit; a tick with none produces no
  # commit — so the loop does not churn the history with empty commits (the A1 commit-volume concern).
  # R4: pin the UNAFFECTED invariant — on a no-change tick mesh:sync still RAN (the loop did its
  # job) yet the commit graph is byte-unchanged (no commit object, HEAD unmoved).
  Scenario: a tick with no staged changes produces no commit (batching)
    Given the loop is started and there are no staged mesh changes this tick
    And I record the current HEAD commit
    When the ticker fires
    Then mesh:sync ran for that tick (the loop invoked the command)
    And mesh:sync created no commit for that tick
    And HEAD is the same commit as before the tick (the no-change tick left history byte-unchanged)

  # The loop's interval is FIXED for the lifetime of a started loop — a mid-run config edit does
  # not retune a running loop (the cadence is read at start). This pins that the loop reads
  # config once at start, so a tick's behaviour is deterministic for the run.
  Scenario: the loop's interval is read at start and is stable for the run
    Given config "mesh.sync.cadenceSeconds" is 30
    When I start the loop
    And config "mesh.sync.cadenceSeconds" is later changed to 10
    Then the running loop's tick interval is still 30 seconds (cadence is read at start)
