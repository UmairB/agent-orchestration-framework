# Mixed verification: the four operator-driven steps are @manual, the design visual-review is @uat — so the
# verification tag lives PER SCENARIO (the feature line carries only layer/refinement/domain, no verification).
@ui @work @distribution @design
Feature: Opening a real coding assistant makes the node read `working · <repo>`, and closing it returns to idle
  In order to prove SPEC objective (a) end to end — the fleet reflects LIVE activity, self-expiring and never
  stuck — an operator opens a real coding assistant on a repo and watches the node's fleet card advance to
  `working · <repo>` within the heartbeat window, works a second repo and sees BOTH, then closes (and separately
  hard-kills) the assistant and watches the node return to `idle` on its own.

  # The milestone's DEFERRED HUMAN GATE — the only parts not covered by the @executable 00–05 lanes are the real
  # assistant firing real hooks, the live fleet advance within the heartbeat window, and TTL self-expiry after an
  # ungraceful kill (RESEARCH.md §2: SessionEnd has no crash guarantee — this is the check that TTL, not `end`,
  # is what heals a crash). Includes the DESIGN visual-review of the new NodeCard state: aof-designer judges a
  # HANDED screenshot of the `working · <repo> (session)` card against the DESIGN.md binding checklist
  # (CONFORMS / GAPS / INCONCLUSIVE — INCONCLUSIVE, naming the missing render, if no screenshot is handed; never
  # guessed from code). Closed at `aof:verify 38`.
  #
  # @qa: this feature is @uat/@manual — no Examples table is owed. The human-check steps below are refined to
  # concrete, judgeable acceptance thresholds (heartbeat window, elapsed TTL, exact line text) so a person has an
  # unambiguous pass/fail. A @uat item migrates down to @manual/@executable once it no longer needs a human —
  # the visual-review scenario stays @uat only while a designer's eyes are the check; the live-advance and
  # self-expiry scenarios are @manual (a person drives a real assistant, but the assertion is mechanical).

  @manual
  Scenario: a live assistant marks the node working within the heartbeat window
    Given a node enrolled in the mesh with the assistant hooks wired (task 05)
    And the node's fleet card currently reads `idle`
    When the operator opens a coding assistant on repo "alpha" and submits one prompt
    Then within ONE presence heartbeat window the node's fleet card reads exactly `working · alpha (session)`
    And the line carries the `primary` (active) emphasis, not the `muted` `idle` token

  @manual
  Scenario: a node working two repos shows both
    Given the node already reads `working · alpha (session)`
    When the operator also opens an assistant on repo "beta" and submits one prompt
    Then within one heartbeat window the node's fleet card shows both "alpha" and "beta" under one `working ·` prefix
    And the line reads `working · alpha, beta (session)` (comma-joined, one trailing `(session)`)

  @manual
  Scenario: closing the assistant returns the node to idle (graceful end)
    Given the node reads `working · alpha, beta (session)`
    When the operator closes the assistant on repo "alpha" (SessionEnd fires `aof session end`)
    Then within one heartbeat window the "alpha" session line is dropped
    And the card reads `working · beta (session)` (beta unaffected)

  @manual
  Scenario: hard-killing the assistant still returns the node to idle via TTL self-expiry (no `end` fires)
    Given the node reads `working · beta (session)`
    When the operator SIGKILLs the assistant on repo "beta" (no SessionEnd fires, so no `aof session end` runs)
    Then before the TTL elapses the card still reads `working · beta (session)` (the record has not yet aged out)
    And after the TTL elapses (task 01) the node's fleet card drops the "beta" session line on its own
    And the card returns to `idle`
    And the node is never left stuck `working` (TTL, not `end`, healed the crash)

  @uat
  Scenario: the new NodeCard session state conforms to the DESIGN binding checklist
    Given a screenshot of the `working · <repo> (session)` NodeCard is handed to the review
    Then aof-designer judges it CONFORMS / GAPS against DESIGN.md §Surface 1 (INCONCLUSIVE naming the missing render if none is handed)
    And the review confirms row 3 is the only changed region (rows 1, 2, 4 carried forward verbatim)
    And the `working` state reads in the run-state ramp's `primary` token (no session-specific colour, dot, chip, or badge)
