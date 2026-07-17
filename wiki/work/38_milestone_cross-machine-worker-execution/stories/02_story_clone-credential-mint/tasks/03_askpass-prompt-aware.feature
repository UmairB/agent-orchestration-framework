@executable @cli @work @distribution
Feature: The askpass shim is prompt-aware — Username → `x-access-token`, Password → the token
  In order that a GitHub App installation token authenticates the clone (GitHub's guaranteed HTTPS form is
  `x-access-token:<token>`, unlike a PAT which tolerates any username), the GIT_ASKPASS shim answers git's
  Username prompt with the constant `x-access-token` and the Password prompt with the token — so the token is
  emitted ONLY on the password prompt, never as the username.

  # ARCHITECTURE 38/ADR-010 (decision 4: make the shim prompt-aware NOW, building on GitHub's guaranteed App-doc
  # form rather than the undocumented same-value leniency RESEARCH §3 could not confirm). RESEARCH §3 measured git
  # passes distinguishing prompt text (`"Username for..."` vs `"Password for..."`) to askpass as argv — so this is
  # mechanical, not a new mechanism. Additive to story-01 `buildAskpassShim`; story-01 F2
  # (`acd-worker-clone-no-credential-persisted`) must stay green (the token still lives only in the scoped one-shot).
  #
  # @executable by invoking the generated shim with each prompt string and asserting stdout — no real git, no real
  # forge. The scenario is a pure process/string assertion over the shim's output.

  Background:
    Given a generated askpass shim built for a minted token

  Scenario Outline: the shim answers by prompt kind
    Given git invokes the shim with the prompt <prompt>
    Then the shim writes <answer> to stdout

    Examples:
      | prompt                                  | answer            |
      | Username for 'https://github.com'       | x-access-token    |
      | Password for 'https://github.com'       | the token         |

  Scenario: the token is never emitted as the username
    When the shim is invoked for the Username prompt
    Then its stdout is exactly `x-access-token`
    And the token value does NOT appear in the username answer

  Scenario: the token still lives only in the scoped one-shot (F2 stays green)
    Then the token is embedded only in the one-shot, scoped `.askpass/<uuid>/` file — never process.env, never argv
    And the whole shim directory is removed in the caller's `finally`, even on a throw

  Scenario: the env-token (PAT) path also authenticates under the prompt-aware shim
    # The prompt-aware shim must not BREAK the retained env-token PAT default: `x-access-token` as the username is
    # accepted by GitHub for a PAT too (PATs ignore the username), so both credential kinds keep working.
    Given the env-token provider supplies a PAT
    Then the prompt-aware shim answers Username → `x-access-token`, Password → the PAT
    And the PAT clone still authenticates (username is not used to authenticate a PAT)
