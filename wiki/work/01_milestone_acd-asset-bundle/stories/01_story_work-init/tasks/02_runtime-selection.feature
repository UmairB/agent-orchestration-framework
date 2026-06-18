@cli @assets @distribution @executable
Feature: --runtime selects runtimes and unsupported members are reported honestly
  In order to install ACD on the runtime I use without silent gaps
  the system must render every member the chosen runtime supports and report the ones it does not.

  Background:
    Given an empty repo with no existing ACD install

  Scenario: with no --runtime, init renders for claude
    When I run "aof work init"
    Then the command exits 0
    And the files appear under the ".claude" runtime root
    And ".aof/aof.work.lock.json" lists "claude" under "runtimes"

  Scenario: --runtime codex renders the supported members and reports the unsupported ones
    When I run "aof work init --runtime codex"
    Then agent members appear under the ".codex" runtime root
    And the output reports the command members as not installable on codex
    And no command file is written under the ".codex" runtime root
    And no command file is force-written under any runtime root

  Scenario: --runtime claude,codex renders for both runtimes
    When I run "aof work init --runtime claude,codex"
    Then files appear under both the ".claude" and ".codex" runtime roots
    And ".aof/aof.work.lock.json" lists both "claude" and "codex" under "runtimes"

  # The capability matrix decides per (runtime, member-kind) whether the member
  # is rendered or reported as unsupported. Only "command" on "codex" is
  # unsupported; everything else renders.
  Scenario Outline: a member kind on a runtime is rendered or reported unsupported
    When I run "aof work init --runtime <runtime>"
    Then a "<kind>" member is "<outcome>"

    Examples:
      | runtime | kind    | outcome              |
      | claude  | agent   | rendered             |
      | claude  | command | rendered             |
      | codex   | agent   | rendered             |
      | codex   | command | reported-unsupported |
