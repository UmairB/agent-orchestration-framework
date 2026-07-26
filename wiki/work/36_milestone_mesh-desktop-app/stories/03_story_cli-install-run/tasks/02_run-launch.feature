@executable @cli @distribution @adapter
Feature: `aof mesh desktop run` discovers the installed app and launches it detached, refusing calmly when it is not installed
  In order to bring up the supervisor with one command and get the terminal straight back,
  `aof mesh desktop run` discovers the installed app in $HOME/.aof/bin and starts it as a detached spawn that does
  not block the CLI — and when the app is not installed, it is a calm, actionable refusal ("run `aof mesh desktop
  install` first"), never a crash or stack trace.

  # ARCHITECTURE 36/ADR-003 §3 (the run/launch verb discovers the app in the SAME per-user install dir the install
  # verb placed it — $HOME/.aof/bin, the m28/ADR-006 join point) and 36/ADR-004 §4 (the app, once launched, resolves
  # its sibling `aof` by an absolute co-located path — the trusted spawn 03's placement makes true). The launch is a
  # DETACHED spawn: `aof mesh desktop run` returns immediately (the CLI does not block on the long-lived tray app),
  # mirroring how the supervisor itself hands back the terminal. The not-installed refusal mirrors the board / mesh-ui
  # friendly-refusal idiom (mesh-ui-serve.mjs:85-94): a caught { code } refusal with one actionable sentence pointing
  # at the install verb, never a stack trace. "Read-only over the fleet" (ADR-004 §3, acd-desktop-read-only-fleet) is
  # a Rust-subtree fitness, NOT a step here — THIS Node-side feature asserts discovery, the detached hand-back, and
  # the not-installed refusal.
  #
  # RESOLVED (developer-amigo): discovery + the not-installed refusal + the "does not block" hand-back are @executable
  # in the EXISTING `node scripts/test.mjs` harness over a FIXTURE install dir with an injected $HOME — a fixture
  # stand-in "app" (or its absence) drives the discover / refuse / detach decision with NO real Tauri app started and
  # NO window opened (the spawn is asserted as detached-and-returns, e.g. against a fixture executable, not a live
  # launch). The real launch of the real app (tray icon, window, supervised children) is @manual (below) and is the
  # @uat task 03's whole-milestone gate. NO cargo lane needed for this story.

  Background:
    Given a fixture install root with an injected $HOME

  # DISCOVERY + DETACHED LAUNCH (ADR-003 §3): the verb finds the installed app and starts it without blocking.
  Scenario: run discovers the installed app in $HOME/.aof/bin and launches it detached
    Given the desktop app is installed at $HOME/.aof/bin
    When the operator runs `aof mesh desktop run`
    Then it discovers the app executable in the install dir (by absolute co-located path, no PATH search)
    And it launches the app as a detached spawn
    And the CLI returns immediately without blocking on the long-lived app
    And under `--json` it emits the single `{ ok:true, … }` envelope reporting the launch

  # THE NOT-INSTALLED REFUSAL (mirrors ui-build-missing): calm, actionable, points at the install verb, never a crash.
  Scenario: run before install is a calm, actionable refusal that names the install verb, never a crash
    Given the desktop app is NOT installed at $HOME/.aof/bin
    When the operator runs `aof mesh desktop run`
    Then it refuses with a single friendly sentence telling the operator to run `aof mesh desktop install` first
    And no stack trace is printed
    And the process exits with a non-zero status
    And under `--json` the refusal is the single `{ ok:false, error, code }` envelope
    And nothing is launched

  # THE DISCOVERY FAILURE SURFACE: a present-but-unusable install refuses coded, never a crash.
  Scenario Outline: a present-but-unrunnable install is a coded refusal, never a stack trace
    Given the install dir is in state <state>
    When the operator runs `aof mesh desktop run`
    Then it <outcome>
    And no stack trace is printed

    Examples:
      | state                                                   | outcome                                                              |
      | holds a runnable app executable                         | discovers it and launches it detached                                |
      | is empty (app never installed)                          | refuses, telling the operator to run `aof mesh desktop install` first |
      | holds only the `aof` binary (no desktop app placed yet) | refuses, telling the operator to run `aof mesh desktop install` first |
      | holds an app file that is not executable / is corrupt   | refuses with a coded not-runnable error (a re-install hint)          |

  # The real launch (the app starts, sits in the tray, supervises) is verified by the whole-milestone @uat gate
  # (03_end-to-end-install-launch), not duplicated here — this feature is the single @executable fixture lane.
