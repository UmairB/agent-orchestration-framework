@cli @work @scaffold @executable
Feature: aof work init --with-headroom opts the fresh install into the plugin; without the flag it stays off
  In order to opt into the headroom plugin at install time without a second command
  the system must, on `aof work init --with-headroom`, write the enabled wrap work.headroom block into
  the fresh aof.config.json, leave work.headroom absent when the flag is omitted (plugin off by
  default), and compose the flag with the existing init flags without disturbing them.

  # ADR-004/001: --with-headroom threads through initWork to apply the same write as use-headroom on the
  # fresh config — work.headroom = { enabled: true, mode: "wrap", providers: ["claude","codex"] }.
  # Without the flag the block is absent (ADR-001: absent ≡ off is the default — the plugin is
  # invisible until opted in). The flag composes with init's existing flags (e.g. --runtime claude,codex)
  # without disturbing the runtimes they select.
  #
  # These scenarios assert the OBSERVABLE resulting config of a fresh init. "init writes only its own
  # surface and never references headroom as a dependency" is owned by the arch-tests
  # (acd-headroom-no-dependency); here we assert the developer-visible block.
  Background:
    Given a fresh repo with no aof.config.json

  Scenario: init --with-headroom writes the enabled wrap block on a fresh install
    When I run "aof work init --with-headroom"
    Then the command exits 0
    And the resulting aof.config.json has work.headroom.enabled true
    And work.headroom.mode is "wrap"
    And work.headroom.providers is ["claude","codex"]

  Scenario: init without the flag leaves work.headroom absent (plugin off by default)
    When I run "aof work init"
    Then the command exits 0
    And the resulting aof.config.json has no work.headroom

  # ADR-004: --with-headroom composes with the existing init flags. Both the selected runtimes and the
  # headroom block must be present and correct in the resulting config.
  Scenario: --with-headroom composes with --runtime without disturbing the runtimes
    When I run "aof work init --runtime claude,codex --with-headroom"
    Then the command exits 0
    And the resulting config selects the runtimes claude and codex
    And work.headroom.enabled is true
    And work.headroom.providers is ["claude","codex"]

  # init flag -> whether work.headroom appears in the fresh config and its enabled flag (ADR-004/001).
  # "(absent)" = the resulting config has no work.headroom key (the off default).
  Scenario Outline: the --with-headroom flag decides whether the plugin block is written on init
    When I run "aof work init <flag>"
    Then the command exits 0
    And the resulting work.headroom is <present>
    And work.headroom.enabled is <enabled>

    Examples: the flag writes the enabled block; its absence leaves the plugin off
      | flag             | present | enabled  |
      | --with-headroom  | present | true     |
      |                  | absent  | (absent) |
