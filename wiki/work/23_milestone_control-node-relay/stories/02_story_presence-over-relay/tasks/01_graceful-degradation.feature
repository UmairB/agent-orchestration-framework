@cli @work @distribution @executable
Feature: Killing the relay degrades cleanly to git-only — liveness lost, data safe — driven by a cadence loop that is a thin timer over the one-shot publish
  In order to keep the fleet correct when the relay or control node dies (the liveness half of KR5; correctness never depends on the relay)
  with the relay down, presence still reaches peers over git (the m22 ≤30s sync engine) and the durable record stays intact, and with the relay restored the sub-5s push resumes with NO change to the durable record, all driven by a background cadence loop that holds no publish logic of its own,
  so that the system loses LIVENESS, not DATA — the record is the same whether liveness came fast (relay) or slow (git poll), and the loop is a thin tunable timer over the one-shot publish (the 22 task-01 runner shape).

  # ARCHITECTURE ADR-003 (story 02 / fitness #4): graceful degradation is the STRUCTURAL
  # consequence of the two-publish path (git unconditional, relay caught) — kill the relay and the
  # try-block's effect is removed, leaving the unconditional git write intact, so the fleet falls
  # back to git-only (poll) sync. The cadence loop is the 22/ADR-004 runner shape: a thin timer that
  # repeatedly invokes the one-shot publish, holding NO publish logic of its own.
  #
  # SEAM SPLIT: fitness #4 (acd-presence-relay-independent) asserts the SOURCE control flow; THIS
  # feature asserts the OBSERVABLE degradation — relay down ⇒ git path still delivers presence to a
  # peer with 0 records lost; relay restored ⇒ push resumes with the record unchanged; and the loop
  # is timer-only. The A1/A5 LATENCY MEASUREMENT (the actual ≤5s / ≤30s on a real fleet) is the
  # @manual spike in task 02 — NOT asserted here; this feature pins the DEGRADATION SHAPE and the
  # LOOP SHAPE, not the wall-clock bounds. The cadence assertions use an INJECTED TICKER (no
  # wall-clock wait), the 22 task-01 pattern.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the "presence reaches a peer over git" scenarios stay
  # @executable ONLY over a LOCAL git fixture (a bare-remote + the m22 sync engine), not a network —
  # exactly the 22 task-00 feasibility shape (a git binary + a committable identity on PATH in CI).
  # And the loop scenarios stay @executable ONLY if the loop takes an INJECTED TICKER and the
  # one-shot publish is a stubbable seam (so "one publish per tick" + "the loop holds no publish
  # logic" are observable without a wall-clock wait or a real relay). RAISED — do NOT silently
  # retag; the degradation + loop SHAPE must stay unit-testable (only the latency needs a fleet,
  # task 02). See VERIFICATION.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And this node has a stable mesh.nodeId (the same id its node record carries)
    And the presence publish path takes an injected relay client whose connect/push I can stub

  # LIVENESS LOST, DATA SAFE — the headline degradation, at the task level. With the relay down,
  # the heartbeat still writes git unconditionally, and the m22 sync engine still delivers the
  # presence record to a peer over git — 0 records lost. This is the ≤30s git-fallback path proven
  # structurally (the LATENCY is task 02's @manual spike).
  # R4: pin the UNAFFECTED side — the durable record this node wrote is byte-identical to what a
  # relay-up heartbeat would have written (the data did not degrade with the liveness).
  Scenario: with the relay down presence still reaches a peer over git and no record is lost
    Given the injected relay client is in relay state "down (connect-fails)"
    And a peer that syncs the work stream over git (the m22 payload-agnostic engine)
    When I invoke mesh:heartbeat to publish this node's presence
    And the peer syncs over git
    Then the heartbeat result is success
    And this node's presence record was delivered to the peer over git (the poll-for-durability path)
    And 0 presence records were lost (the durable write survived the relay failure)
    And this node's durable presence record is byte-identical to the relay-up baseline (data safe, liveness lost)

  # RELAY RESTORED — the sub-5s push resumes with NO change to the durable record: the record is
  # the same whether liveness arrived fast (relay) or slow (git poll). Pins that restoring the relay
  # changes the LIVENESS PATH, never the DATA. Two heartbeats — one relay-down, one relay-restored —
  # produce the SAME durable record content (modulo the bumped heartbeatAt instant, held fixed here
  # via injection so the bytes are directly comparable).
  # R4: pin BOTH the targeted change (the relay push resumes) AND the unaffected side (the durable
  # record is unchanged by the relay coming back).
  Scenario: when the relay is restored the push resumes and the durable record is unchanged
    Given I published presence once with the relay down (git-only) at a fixed injected instant
    And I record the on-disk bytes of this node's durable presence record
    When the relay is restored and I publish presence again at the same fixed injected instant
    Then a presence signal is once again pushed over the relay (sub-5s liveness resumes)
    And this node's durable presence record is byte-identical to the relay-down publish (the record is the same whether liveness came fast or slow)
    And the heartbeat result is success

  # THE CADENCE LOOP IS A THIN TIMER over the one-shot publish (the 22 task-01 pattern, injected
  # ticker — no wall-clock wait). One publish per tick; the loop invokes the one-shot path and
  # carries NO publish logic of its own.
  Scenario: the cadence loop invokes the one-shot publish once per tick and holds no publish logic
    Given the cadence loop is loaded with an injected ticker (no real wall-clock wait)
    And the loop is started
    When the injected ticker fires 3 times
    Then the one-shot presence publish was invoked exactly 3 times
    And the loop performed no git write directly (it only invoked the one-shot publish)
    And the loop performed no relay push directly (it only invoked the one-shot publish)

  # The cadence is tunable from config.mesh.presence.cadenceSeconds — a valid positive whole-second
  # value is used verbatim (the loop honours config, it does not clamp). The band edges bracket the
  # ≤5s-liveness intent (a tight cadence) up to a slack value.
  Scenario Outline: a valid positive cadence is read from config.mesh.presence.cadenceSeconds verbatim
    Given config "mesh.presence.cadenceSeconds" is <value>
    When I start the cadence loop
    Then the loop's tick interval is <interval> seconds

    Examples:
      | value | interval |
      | 5     | 5        |
      | 1     | 1        |
      | 30    | 30       |
      | 60    | 60       |

  # A malformed or absent cadence falls back to the DOCUMENTED DEFAULT — the loop never crashes on
  # bad config (the 22 task-01 default-safe discipline). The matrix enumerates EVERY malformed
  # equivalence class reachable in a JSON-backed config:
  #   - absent / null : no value configured;
  #   - wrong type    : the non-number string "fast", the numeric-looking string "5" (the loop must
  #                     NOT silently coerce a string to a number — the type boundary), a boolean true
  #                     (JSON-legal, wrong type);
  #   - non-positive  : 0 and -5 (a non-positive interval is meaningless);
  #   - non-integer   : 5.5 (cadence is whole seconds — a float falls back rather than being silently
  #                     floored).
  # QA: covers null + the numeric string + a boolean + a float beyond the PO's headline absent/0/-5 —
  # the type + non-positive + non-integer boundaries. (Non-finite values like Infinity are not
  # JSON-representable, so they cannot reach a JSON config and are deliberately not rows.) Every row
  # asserts the SAME documented default — the Examples literals agree with the single Then.
  Scenario Outline: a malformed or absent cadence falls back to the documented default and the loop does not crash
    Given config "mesh.presence.cadenceSeconds" is <value>
    When I start the cadence loop
    Then the loop's tick interval is the documented default cadence
    And the loop started without crashing on the bad config

    Examples:
      | value  |
      | absent |
      | null   |
      | "fast" |
      | "5"    |
      | true   |
      | 0      |
      | -5     |
      | 5.5    |

  # The loop's interval is read at start and FIXED for the run — a mid-run config edit does not
  # retune a running loop (the cadence is read once, at start; the 22 task-01 stability shape). This
  # pins that a started loop's tick behaviour is deterministic for its lifetime.
  Scenario: the cadence loop reads its interval at start and is stable for the run
    Given config "mesh.presence.cadenceSeconds" is 5
    When I start the cadence loop
    And config "mesh.presence.cadenceSeconds" is later changed to 30
    Then the running loop's tick interval is still 5 seconds (the cadence is read at start)
