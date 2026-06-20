@ui @work @board
Feature: The provider picker chooses one CLI to run, and a missing provider degrades honestly
  In order to run the right agent CLI against an item and never be lied to when one is not installed
  the operator picks exactly one of claude / codex / gemini, the picked one is what gets spawned, and
  a chosen provider whose binary is absent surfaces the dock ERROR state — the server stays up and
  never fakes a success.

  # The error-control-frame logic — selecting a providerId resolves the right CLI through the ported
  # CliProvider seam, and an absent binary yields the dock's error state instead of a crash — is
  # @executable: it is unit-testable headlessly against the provider/WS handler with a stubbed-missing
  # binary, no real PTY. A REAL missing binary end-to-end (a machine that genuinely lacks codex) is
  # @manual per RESEARCH A7 (environment-dependent). The honest-degrade rule is expressed below as
  # OBSERVABLE behaviour — "the dock shows the error state and the server is still serving" — not as
  # the {type:'error'} frame literal, which is ADR-003 structure. Exactly-one-selected and which CLI
  # spawns are behaviour here; the node-pty/ws server-only and MIT-attribution invariants are the
  # acd-terminal-server-only / acd-vibeyard-attribution fitness functions, not scenarios.

  Background:
    Given the work board is open with a board item selected
    And the terminal dock's provider picker offers claude, codex and gemini

  # @executable: exactly-one-selected is the picker's radio-semantics (DESIGN §4). The default and the
  # single-selection invariant are testable against the picker state headlessly.
  @executable
  Scenario: the provider picker starts with exactly one provider selected
    Then exactly one of claude, codex or gemini is selected
    And the other two providers are not selected

  # @executable: picking a provider moves the single selection — never two-on, never zero-on.
  @executable
  Scenario Outline: selecting a provider makes it the only selected one
    Given the provider "<from>" is currently selected
    When I select the provider "<to>"
    Then "<to>" is the selected provider
    And "<from>" is no longer selected
    And exactly one provider is selected

    Examples:
      | from   | to     |
      | claude | codex  |
      | claude | gemini |
      | codex  | claude |
      | codex  | gemini |
      | gemini | claude |
      | gemini | codex  |

  # @executable: the selection drives WHICH CLI is spawned — the selected providerId resolves through
  # the ported CliProvider seam to that provider's CLI invocation. Asserted as the observable "the CLI
  # that runs is the selected provider's", with a stubbed-present binary so no real PTY is needed.
  @executable
  Scenario Outline: the selected provider is the CLI that gets run
    Given the provider "<provider>" is selected and its binary is present
    When Run agent is invoked for the selected item
    Then the CLI that is run is the "<provider>" CLI
    And no other provider's CLI is run

    Examples:
      | provider |
      | claude   |
      | codex    |
      | gemini   |

  # @executable: the honest-degrade core (ADR-003). With the chosen provider's binary stubbed ABSENT,
  # invoking Run agent must drive the dock to its error state AND leave the server running — never a
  # crash, never a fabricated running/exited(0). This is the error-control-frame path observed as dock
  # state, headless, no real PTY.
  @executable
  Scenario Outline: a chosen provider with no binary shows the dock error state and the server stays up
    Given the provider "<provider>" is selected and its binary is absent
    When Run agent is invoked for the selected item
    Then the dock shows the error state naming the missing provider
    And no session is reported as running
    And the dock is not reported as exited with code 0
    And the server is still serving other connections afterwards

    Examples:
      | provider |
      | claude   |
      | codex    |
      | gemini   |

  # @executable: an absent provider must NOT masquerade as success — the m02 honest-degrade discipline.
  # The two failure modes a dishonest implementation might take (a faked clean exit, or an unguarded
  # crash) are both ruled out as observable outcomes.
  @executable
  Scenario Outline: a missing provider never fakes success and never crashes the server
    Given the provider "<provider>" is selected and its binary is absent
    When Run agent is invoked for the selected item
    Then the outcome is the error state, not a success
    And the server process does not crash

    Examples:
      | provider |
      | claude   |
      | codex    |
      | gemini   |

  # A7 (RESEARCH Assumptions): a REAL machine that genuinely lacks a provider on PATH. The developer/
  # operator confirms end-to-end that the absent binary surfaces the designed dock error state
  # (DESIGN §4) rather than a crash or a hang. Environment-dependent, so @manual not CI.
  @manual
  Scenario: on a machine without the chosen provider installed the dock shows the real error state
    Given the chosen provider's CLI is genuinely not installed on this machine
    When I press Run agent on the selected item
    Then the dock shows the error state explaining the provider is missing
    And the board and server remain usable afterwards

  # A7 live confirmation that a PRESENT provider is the happy path on this machine — the counterpart
  # to the missing-binary @manual: confirms at least one real provider spawns where it is installed.
  @manual
  Scenario: on a machine with the chosen provider installed Run agent reaches running
    Given the chosen provider's CLI is genuinely installed on this machine
    When I press Run agent on the selected item
    Then the dock reaches the running state with that provider's CLI
