@executable @cli @work @distribution
Feature: A github-app mint fault fails LOUD — never a null, never an env-token fallback, never an unauthenticated clone
  In order that a misconfigured or unreachable mint can never silently downgrade the fleet's security posture, any
  github-app provider fault THROWS → the existing coded `clone-credential-mint-failed` → the worker's loud
  `assignment-repo-unavailable` refusal, with no partial checkout — and NEVER a fall-through to the env-token
  default nor a retry without credentials.

  # SECURITY T10 (no silent fallback to a broad token or an unauthenticated clone — a private repo with a broken
  # mint must FAIL, not succeed by another means). ARCHITECTURE 38/ADR-010 (decision 5: the provider is invoked
  # inside the existing try/catch; a throw is the loud refusal; the selector never falls through providers).
  #
  # @executable over the injected signer/http seam scripted to fail; assert the coded refusal + zero clone/exec.

  Background:
    Given the github-app provider is the selected mint
    And an authorized clone-credential-request (holder / workspace-match / active-state all pass)

  Scenario Outline: every mint fault is a loud coded refusal, never a silent success
    Given the mint <fault>
    Then the provider THROWS (never returns null, never returns a fallback credential)
    And control replies with the coded `clone-credential-mint-failed`
    And the worker surfaces the loud coded `assignment-repo-unavailable`
    And NO clone is attempted and no partial checkout is left behind
    And the env-token provider is NOT consulted as a fallback

    Examples:
      | fault                                                      |
      | the App is not installed on the repo (GET installation 404)|
      | the app private key is invalid (JWT signing/exchange 401)  |
      | the GitHub API is unreachable (network error)              |
      | the token exchange is permission-denied (403)              |
      | the exchange returns a blank/absent token                  |

  Scenario: a private repo with a broken mint FAILS — it is never rescued into an unauthenticated clone
    Given the repo is private and the mint cannot produce a token
    Then the clone is refused, not attempted without a credential
    And the outcome is the loud coded failure, never a success by any other credential path
