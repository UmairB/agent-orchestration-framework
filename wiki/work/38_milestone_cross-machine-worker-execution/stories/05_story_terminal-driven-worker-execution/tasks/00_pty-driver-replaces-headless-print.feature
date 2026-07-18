@executable @cli @work @distribution
Feature: The worker driver spawns INTERACTIVE `claude` through the `terminal-providers` seam — the `claude -p` headless-print form is GONE from the worker driver path
  In order that a worker runs real interactive work (able to ask a human mid-flight, on the worker's subscription)
  rather than ONE throwaway non-interactive turn, `buildDriverCommand`/`defaultSpawnRuntime` NO LONGER emit
  `claude -p <prompt> --output-format json`; the worker resolves the interactive `claude` launch through the EXISTING
  `terminal-providers` seam (`resolveProvider("claude").buildArgs()` — the empty-args interactive form) and spawns it
  in a node-pty PTY with cwd = the worktree.

  # ARCHITECTURE 38/ADR-013 (invariant 1: `buildDriverCommand`/`defaultSpawnRuntime` name no `-p` + `--output-format
  # json` one-shot for the `claude` driver; the interactive launch resolves through the `terminal-providers` seam —
  # `resolveProvider("claude")`, whose `buildArgs()` is the empty-args interactive form, terminal-providers.mjs:23).
  # RESEARCH §4.3 (MEASURED: `claude -p` runs ONE turn to completion and returns — no pause, no callback interface;
  # today's driver is `claude -p <prompt> --output-format json`, buildDriverCommand mesh-worker-execution.mjs:559).
  # Armed by `acd-worker-driver-no-headless-print`.
  #
  # @executable over INJECTED seams — a fake `which` (a stubbed-present `claude` binary) and a fake pty spawn that
  # RECORDS the spawned bin+argv. No real `claude`, no subscription, no PTY, no network. The point is the INTERACTIVE
  # form, NOT a `-p` assertion used as a proxy for "it runs" — the real interactive-claude-on-subscription behaviour
  # is exclusively task 04's @manual soak (§4.3 measured it un-fakeable).

  Background:
    Given the worker driver over an injected provider seam (a stubbed-present `claude` binary) and a fake pty that records the spawned argv

  Scenario: the worker resolves the interactive `claude` launch, never `claude -p`
    Given an assignment for the `claude` driver
    When the worker resolves and spawns its driver
    Then the spawned binary is the `claude` path resolved via `resolveProvider("claude")` (the interactive launch)
    And the spawned argv is the provider's interactive-launch args (`buildArgs()`) — no one-shot prompt argv
    And no `buildDriverCommand`-shaped `claude -p <prompt> --output-format json` is emitted for the `claude` driver

  Scenario Outline: no headless-print token survives in the spawned worker-driver argv
    Given the worker spawns its `claude` driver
    Then the spawned argv contains NO <forbidden_token>

    Examples:
      | forbidden_token   |
      | -p                |
      | --print           |
      | --output-format   |
