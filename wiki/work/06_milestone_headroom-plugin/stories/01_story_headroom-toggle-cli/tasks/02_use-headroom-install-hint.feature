@cli @work @board @executable
Feature: use-headroom honours the config write even when headroom is missing, and prints an install hint
  In order to opt in now and be told (not silently) that the headroom binary is missing
  the system must, on `aof work use-headroom`, always write the enabling config (intent is honoured),
  print a one-line install hint naming the headroom repo when headroom is NOT on PATH, print no hint
  when it IS on PATH, and never run an installer.

  # ADR-004/005: use-headroom PATH-checks headroom via the injectable `which` (the ADR-003 idiom). When
  # headroom is absent it STILL writes the config (intent honoured) AND prints a one-line hint pointing
  # at github.com/chopratejas/headroom; when present, the config is written and no hint is printed. aof
  # NEVER installs headroom (ADR-005's no-install invariant).
  #
  # These scenarios drive the injected `which` to report headroom present/null, so the PATH check is
  # deterministic and black-box. The install-hint TEXT is a legitimate behavioural scenario here. The
  # no-install guarantee is asserted observably as "the command succeeds and the environment/binaries
  # are unchanged" — the structural "imports no headroom package / invokes no installer" claim is owned
  # by the arch-test acd-headroom-no-dependency.
  Background:
    Given a project whose aof.config.json has no work.headroom
    And the injected which reporting whether headroom is on PATH

  Scenario: with headroom missing, use-headroom still writes the config and prints the install hint
    Given the injected which reports headroom is not on PATH
    When I run "aof work use-headroom"
    Then the command exits 0
    And work.headroom.enabled is true
    And the output prints a one-line install hint
    And the hint names the headroom repo "github.com/chopratejas/headroom"
    And the environment binaries are unchanged from before the command

  Scenario: with headroom present, use-headroom writes the config and prints no install hint
    Given the injected which reports headroom is on PATH
    When I run "aof work use-headroom"
    Then the command exits 0
    And work.headroom.enabled is true
    And the output prints no install hint

  # ADR-005: the no-install obligation is a hint, never an installer — observable as the command
  # succeeding while leaving installed binaries untouched, regardless of PATH state.
  Scenario: use-headroom never runs an installer when headroom is missing
    Given the injected which reports headroom is not on PATH
    When I run "aof work use-headroom"
    Then the command exits 0
    And no installer command was run
    And the environment binaries are unchanged from before the command

  # PATH state -> the config is ALWAYS written; the hint is printed only when headroom is missing
  # (ADR-004/005). The config write is independent of PATH; the hint is the contrast.
  Scenario Outline: the config is always written; the install hint depends only on PATH presence
    Given the injected which reports headroom <headroomOnPath>
    When I run "aof work use-headroom"
    Then the command exits 0
    And the config was written is <configWritten>
    And the hint was printed is <hintPrinted>

    Examples: missing headroom prints the hint; present headroom does not — config written either way
      | headroomOnPath | configWritten | hintPrinted |
      | not on PATH     | true          | true        |
      | on PATH         | true          | false       |
