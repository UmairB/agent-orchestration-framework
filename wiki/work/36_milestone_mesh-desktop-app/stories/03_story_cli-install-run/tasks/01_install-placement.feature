@executable @cli @distribution @assets
Feature: `aof mesh desktop install` places the app + WebView2 bootstrapper at $HOME/.aof/bin idempotently, refusing failures calmly
  In order that the desktop supervisor lands beside the aof binary the operator already has — no separate installer,
  no manual path wiring — `aof mesh desktop install` places the app executable(s) into $HOME/.aof/bin alongside the
  m28 `aof` binary, updates in place on a re-install (no duplicate), bundles the WebView2 Evergreen Bootstrapper,
  and turns any failure (unwritable dir, missing artifact) into a calm one-sentence refusal — never a stack trace.

  # ARCHITECTURE 36/ADR-003 §3 (packaged + discovered alongside the m28 SEA binary at $HOME/.aof/bin — the m28/ADR-006
  # per-user install join point, confirmed 28/ARCHITECTURE.md:403; no new install-location decision) and 36/ADR-001
  # (the install verb bundles Tauri's WebView2 Evergreen Bootstrapper ~1.8 MB so a missing runtime self-installs on
  # first run; reuses the m28 Authenticode signing precedent — no new signing story). The co-location is LOAD-BEARING
  # for 36/ADR-004 §4: 03's install placement is what makes 00's trusted co-located `aof` resolution TRUE — the app
  # resolves its sibling `aof` by an absolute path in its OWN install dir, no PATH search (the thin 00↔03 contract).
  # The friendly-refusal idiom mirrors the board / mesh-ui build-missing + EADDRINUSE refusals (mesh-ui-serve.mjs
  # :85-94 `ui-build-missing`, :240-242 EADDRINUSE): a caught { code } refusal with one actionable sentence, never a
  # stack trace.
  #
  # RESOLVED (developer-amigo): the placement + idempotence + bootstrapper-bundling + refusal logic is @executable
  # in the EXISTING `node scripts/test.mjs` harness over a FIXTURE install dir with an INJECTED $HOME (the m28
  # install-test convention — NOT the real machine, NOT a live Authenticode-signed artifact). A fixture "app
  # artifact" stands in for the built Tauri bundle; the test asserts WHERE files land and the refusal shape, not that
  # a real signed .exe runs. The real cross-machine install of the real signed bundle is @manual (below). NO cargo
  # lane needed for this story.

  Background:
    Given a fixture install root with an injected $HOME
    And the m28 `aof` binary already present at $HOME/.aof/bin
    And a fixture desktop-app artifact to place

  # THE PLACEMENT (ADR-003 §3): the app executable(s) land in $HOME/.aof/bin, co-located with the m28 aof binary.
  Scenario: install places the app executable(s) into $HOME/.aof/bin alongside the aof binary
    When the operator runs `aof mesh desktop install`
    Then the desktop app executable(s) are written under $HOME/.aof/bin
    And the m28 `aof` binary is left untouched beside them
    And the co-located pair satisfies the 00↔03 contract (00's trusted spawn resolves its sibling `aof` by absolute path there)

  # IDEMPOTENT RE-INSTALL (the m28 re-install precedent): a second install updates in place, never duplicating.
  Scenario: a re-install updates the app in place without duplicating or leaving a stale copy
    Given the desktop app is already installed at $HOME/.aof/bin from a prior run
    When the operator re-runs `aof mesh desktop install`
    Then the app executable(s) are replaced in place
    And no second copy accrues under $HOME/.aof/bin
    And no stale prior-version file remains beside the new app

  # THE WEBVIEW2 BOOTSTRAPPER BUNDLE (ADR-001): the install records/places the Evergreen Bootstrapper.
  Scenario: install bundles the WebView2 Evergreen Bootstrapper so a missing runtime can self-install on first run
    When the operator runs `aof mesh desktop install`
    Then the WebView2 Evergreen Bootstrapper is placed/recorded as part of the install
    And it is discoverable by the run verb so a missing WebView2 runtime self-installs on first launch (never a crash)

  # THE FRIENDLY REFUSAL (mirrors ui-build-missing / EADDRINUSE): every failure is one calm sentence, never a trace.
  Scenario Outline: an install failure is a calm friendly refusal — one sentence + what to do, never a stack trace
    Given the install will fail because <cause>
    When the operator runs `aof mesh desktop install`
    Then it refuses with a single friendly sentence naming <what-to-do>
    And no stack trace is printed
    And the process exits with a non-zero status
    And under `--json` the refusal is the single `{ ok:false, error, code }` envelope
    And no partial install is left behind

    Examples:
      | cause                                          | what-to-do                                                  |
      | $HOME/.aof/bin is not writable                 | a permissions hint (where to fix write access)              |
      | the packaged app artifact is missing           | that the artifact is missing (a re-download / re-build hint) |
      | the WebView2 bootstrapper artifact is missing  | that the bootstrapper is missing from the bundle            |

  # A FAILED INSTALL PLACES NOTHING (ordering — mirrors verify-before-PATH): never a place-then-fail partial.
  Scenario: a failed install leaves $HOME/.aof/bin holding only its prior contents (no partial placement)
    Given the app artifact is present but the bin dir becomes unwritable mid-install
    When the operator runs `aof mesh desktop install`
    Then it refuses calmly and rolls back any partial placement
    And $HOME/.aof/bin still holds exactly the m28 `aof` binary it started with

  # The real cross-machine install of the real signed bundle is verified by the whole-milestone @uat gate
  # (03_end-to-end-install-launch), not duplicated here — this feature is the single @executable fixture lane.
