@cli @adapter @scaffold
Feature: the Notion CLI spawn carries the token from the named env var, never from a literal in the argv
  In order that a sync reaches Notion with the operator's secret without ever committing or printing it, and fails honestly when the secret is absent
  the spawn reads process.env[<tokenEnv>] at run time and passes it (plus NOTION_KEYRING=0) into the spawned CLI's environment, never into its argv,
  so that with the env var set the spawn env carries the token and the keychain-opt-out, an absent/empty token is an honest configured-but-unreachable failure (never a half-write, never a silent success), and no token literal ever appears in the constructed argv.

  # ADR-004: auth is an env-var REFERENCE. The config holds tokenEnv (the env-var NAME, default
  # "NOTION_API_TOKEN", RESEARCH §A2), never the secret. At run time the spawn reads the secret from
  # process.env[<tokenEnv>] and passes it through the spawned ntn's ENVIRONMENT, plus NOTION_KEYRING=0
  # to keep ntn off the OS keychain head-less (RESEARCH §A2). A configured-but-unreachable Notion
  # (token absent/empty) is an HONEST failure — never a half-written page, never a silent success
  # (ADR-004 / STATE §Opt-in no-op). The @executable rows assert this via the INJECTED spawn seam
  # capturing the constructed env + argv; the live authenticated ntn call is @manual (no token on
  # the dev host, RESEARCH §A2).
  #
  # NOTE: the STRUCTURAL guarantee "auth is an env-var ref / no committed secret appears in source"
  # is the story-03 arch-test acd-notion-auth-env-ref (ADR-005 inv. 4) — a source-grep that the sync
  # reads process.env[<tokenEnv>] and no token literal / token: config read appears. This feature
  # asserts only the OBSERVABLE: the spawn ENV carries the token, the argv does NOT, an absent token
  # is an honest fail.
  Background:
    Given a configured work.integrations.notion with tokenEnv "NOTION_API_TOKEN"
    And the Notion CLI spawn seam injected to capture the constructed env and argv

  # The token reaches the CLI through the spawn ENVIRONMENT — read from the named env var at run
  # time — alongside NOTION_KEYRING=0 (the head-less keychain opt-out, RESEARCH §A2). The spawn env
  # is the channel for the secret, not the config and not the argv.
  @executable
  Scenario: the spawn env carries the token from the named env var plus the keychain opt-out
    Given process.env "NOTION_API_TOKEN" is set to a fixture token value
    When the Notion CLI is spawned
    Then the captured spawn env's "NOTION_API_TOKEN" equals the fixture token value
    And the captured spawn env sets "NOTION_KEYRING" to "0"

  # The config NAMES the env var, so renaming tokenEnv redirects which env var the secret is read
  # from — the secret still travels only by environment. (Confirms the indirection is the env-var
  # NAME, not a hardcoded "NOTION_API_TOKEN".)
  @executable
  Scenario: a custom tokenEnv name is the env var the spawn reads the token from
    Given the configured tokenEnv is "MY_NOTION_TOKEN"
    And process.env "MY_NOTION_TOKEN" is set to a fixture token value
    When the Notion CLI is spawned
    Then the captured spawn env's "MY_NOTION_TOKEN" equals the fixture token value

  # No token literal is ever placed in the constructed argv — the secret comes ONLY from the
  # environment. (The OBSERVABLE half of the no-committed-secret design; the source-grep half is the
  # story-03 arch-test in the header note.)
  @executable
  Scenario: no token literal appears in the constructed spawn argv
    Given process.env "NOTION_API_TOKEN" is set to a fixture token value
    When the Notion CLI is spawned
    Then the constructed argv contains no occurrence of the fixture token value
    And the secret is present only in the captured spawn env, not in the argv

  # An absent or empty token is an HONEST failure — a configured-but-unreachable result, never a
  # half-write and never a silent success (ADR-004 / STATE §Opt-in no-op). The matrix: a set token
  # spawns; an unset or empty named env var fails honestly before any page write.
  @executable
  Scenario Outline: an absent or empty token fails honestly, never half-writes or silently succeeds
    Given process.env "NOTION_API_TOKEN" is "<env-state>"
    When auth is resolved for the spawn
    Then the auth outcome is "<outcome>"
    And the result "<honesty>"

    Examples:
      | env-state          | outcome      | honesty                                                         |
      | a fixture token    | reachable    | proceeds to the spawn with the token in the env                 |
      | unset              | unreachable  | is a structured honest failure, no page written, no silent pass |
      | set to empty       | unreachable  | is a structured honest failure, no page written, no silent pass |

  # The live round-trip: against a real ntn install and a real token, an ntn api call authenticates
  # and returns the API JSON. Needs a live binary + token (none on the dev host, RESEARCH §A2), so
  # it is a human/dev-run procedure, not CI.
  # verifies → milestone UAT.md "Notion auth round-trip (live ntn api call)" procedure (authored at verify).
  @manual
  Scenario: a live ntn api call authenticates with the env-var token
    Given a real ntn on PATH and a real NOTION_API_TOKEN exported in the environment
    When I run an authenticated "ntn api" call against a Notion workspace
    Then the call authenticates using the token from the environment
    And it returns the Notion API JSON on stdout
