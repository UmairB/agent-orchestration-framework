@executable @cli @work @distribution
Feature: The clone source resolves from config.mesh.repo.cloneUrl, and a missing one fails loudly with a code
  In order that a worker knows WHERE to clone a repo it lacks — and an operator never gets a silent hang from a
  misconfigured fleet — the worker resolves the clone URL from the committed `config.mesh.repo.cloneUrl` key,
  and a workspace with no resolvable cloneUrl keeps the milestone-35 posture: a LOUD coded
  `assignment-repo-unavailable` failure, never a silent success and never a hang.

  # ARCHITECTURE 38/ADR-005. The clone SOURCE is a fleet-shared, committed key (`config.mesh.repo.*` already
  # exists — it holds the published/workspaceId marker, commands/mesh-repo.mjs:44), read via the raw
  # optional-chain idiom (NOT the config-editor whitelist — the m22 story-01 lesson). The clone SOURCE is not
  # per-install identity, so it belongs in committed config. A workspace whose config has no resolvable cloneUrl
  # does NOT clone — it stays the existing loud `assignment-repo-unavailable` coded `failed` (34/ADR-008
  # loud-miss discipline), so a misconfigured fleet fails honestly rather than hanging.
  #
  # @qa: complete the Examples — cloneUrl present → resolves to it; absent/blank/malformed → loud coded
  # assignment-repo-unavailable, nothing cloned; the resolution is raw optional-chain (an unknown sibling mesh
  # key is not dropped on rewrite).

  Background:
    Given a worker handling an accepted directive for a workspace it lacks the repo for

  Scenario: a resolvable cloneUrl is used as the clone source
    Given config.mesh.repo.cloneUrl is set for the workspace
    Then the worker resolves that URL as the clone source

  Scenario: a missing cloneUrl keeps the loud coded refusal, cloning nothing
    Given config.mesh.repo.cloneUrl is absent
    Then the worker streams a `failed` with code "assignment-repo-unavailable"
    And no clone is attempted

  # THE RESOLUTION TABLE (ADR-005): a well-formed cloneUrl resolves and is used as the clone source; an absent,
  # blank, whitespace-only, or malformed value is NOT a clone source — it stays the loud coded
  # `assignment-repo-unavailable` `failed`, with NOTHING cloned. A malformed value is refused BEFORE any git
  # spawn (a garbage URL is a config defect, not a git error to surface) — the miss is decided at resolution.
  Scenario Outline: the clone source resolves only from a well-formed cloneUrl, else a loud coded miss cloning nothing
    Given config.mesh.repo.cloneUrl is <cloneUrl>
    When the worker resolves the clone source for the assignment
    Then the resolution <outcome>

    Examples:
      # A well-formed URL — resolved and used as the clone source.
      | cloneUrl                                    | outcome                                                                          |
      | "https://git.example.com/acme/secret.git"   | resolves that URL as the clone source                                            |
      | "git@git.example.com:acme/secret.git"       | resolves that URL as the clone source                                            |
      | "ssh://git@host.tailnet/acme/secret.git"    | resolves that URL as the clone source                                            |
      # No value present at all — the key is missing from config.
      | absent (no config.mesh.repo.cloneUrl key)   | streams a "failed" coded "assignment-repo-unavailable", cloning nothing          |
      # Present but empty / whitespace-only — a set-but-empty key is not a source.
      | "" (empty string)                           | streams a "failed" coded "assignment-repo-unavailable", cloning nothing          |
      | "   " (whitespace only)                     | streams a "failed" coded "assignment-repo-unavailable", cloning nothing          |
      # Present but malformed — refused at resolution, BEFORE any git spawn (never a raw git error surfaced).
      | "not-a-url"                                 | streams a "failed" coded "assignment-repo-unavailable", cloning nothing, no git spawn |
      | "file:///" (no path)                        | streams a "failed" coded "assignment-repo-unavailable", cloning nothing, no git spawn |
      # Present but the wrong TYPE — a non-string value is not a URL, treated as absent.
      | 42 (a number, not a string)                 | streams a "failed" coded "assignment-repo-unavailable", cloning nothing          |

  # THE MISS IS LOUD AND ARGUMENT-CLEAN (34/ADR-008 + ADR-005): a no-cloneUrl workspace streams the SAME coded
  # `failed` frame the m35 `!hasRepo` refusal already streams — a specific stable code, never a silent success,
  # never a hang; and the refusal error carries NO fabricated URL (there was none to redact, but the code path
  # must not invent one).
  Scenario: a workspace with no resolvable cloneUrl streams the loud coded failed, never hanging
    Given config.mesh.repo.cloneUrl is absent for the workspace
    When the worker acts on the accepted directive
    Then the assignment streams a "failed" frame coded "assignment-repo-unavailable"
    And the failure is a structured coded miss, not an opaque throw and not a silent hang
    And no clone spawn is attempted

  # RAW OPTIONAL-CHAIN, NOT THE WHITELIST (ADR-005, the m22 story-01 lesson): cloneUrl is read straight off
  # `config.mesh.repo.cloneUrl` via optional-chaining — reading it must NOT round-trip the config through the
  # config-editor whitelist, which would DROP any sibling mesh key it does not know. An unknown sibling key
  # (e.g. a future `config.mesh.repo.someNewMarker`) survives cloneUrl resolution untouched.
  Scenario: resolving cloneUrl reads the raw config and never drops an unknown sibling mesh key
    Given config.mesh.repo carries cloneUrl AND an unknown sibling key "someNewMarker"
    When the worker resolves the clone source
    Then the cloneUrl resolves via raw optional-chain on config.mesh.repo.cloneUrl
    And the unknown sibling key "someNewMarker" is still present in config.mesh.repo afterwards
    And resolution did not route config.mesh.repo through the config-editor whitelist
