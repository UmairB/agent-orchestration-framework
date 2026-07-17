@executable @cli @work @distribution
Feature: The github-app provider mints an installation token scoped to EXACTLY the assigned repo, contents:read
  In order that a clone credential is single-repo + read-only + short-lived BY CONSTRUCTION (closing SECURITY T4),
  the github-app provider resolves the assigned workspace's repo from the CONTROL node's own
  `config.mesh.repo.cloneUrl`, signs an App JWT with `node:crypto` (RS256), resolves the installation, and
  exchanges it for a GitHub App installation access token requesting the ONE repo with `contents: read` — no
  static PAT, no broad scope.

  # ARCHITECTURE 38/ADR-010 (Gap A: repo resolved control-side from the committed cloneUrl, NEVER the worker's
  # frame — which is dropped, worker-stream-client.mjs:298; auto-resolve the installation id). RESEARCH §3
  # (measured: node:crypto signs the RS256 JWT, ≤10-min exp; POST /app/installations/{id}/access_tokens with
  # {repositories, permissions:{contents:read}} → ~1h token; GET /repos/{owner}/{repo}/installation → id).
  # SECURITY T9/F6 (the mint request names exactly one repo + contents:read).
  #
  # @executable over INJECTED seams — a fake JWT signer, a fake HTTP client that records the request bodies, and a
  # FAKE app key + FAKE token string. NO real GitHub call, no real key, no network (that is task 05's @manual soak).

  Background:
    Given the github-app provider with an injected signer + http client and a fake app private key
    And the assigned workspace's `config.mesh.repo.cloneUrl` resolves control-side

  Scenario: the mint requests a token for exactly the assigned repo, contents:read
    Given an authorized clone-credential-request for workspace "ws-secret" whose cloneUrl is the private repo
    When the github-app provider mints
    Then it signs an App JWT with `node:crypto` RS256 (no new dependency), `exp` within the ≤10-minute ceiling
    And the `POST …/access_tokens` request body names EXACTLY that one repo and `permissions: { contents: "read" }`
    And it never requests a broader `repositories` set nor any permission beyond `contents: read`
    And it returns the fake installation token to the (unchanged) ADR-009 pull reply

  Scenario: the repo is resolved from the CONTROL's committed cloneUrl, never the worker's frame
    Given the worker's request frame carries no cloneUrl (it is dropped on receipt)
    Then the owner/repo scoping is derived from the control node's own `config.mesh.repo.cloneUrl` for that workspaceId
    And a request that tried to smuggle a different repo could not influence the mint scope (F15 stays closed)

  Scenario Outline: owner/repo parses from every cloneUrl shape, incl. GHES API-base
    Given the committed cloneUrl is <cloneUrl>
    Then the parsed owner/repo is <owner_repo>
    And the resolved API base is <api_base>

    Examples:
      | cloneUrl                                        | owner_repo      | api_base                        |
      | https://github.com/acme/secret.git              | acme/secret     | https://api.github.com          |
      | git@github.com:acme/secret.git                  | acme/secret     | https://api.github.com          |
      | https://ghe.example.com/acme/secret.git         | acme/secret     | https://ghe.example.com/api/v3  |

  Scenario: the installation id is auto-resolved on demand (fits the worker's bounded wait)
    Given no installation id is configured
    Then the provider resolves it via `GET /repos/<owner>/<repo>/installation` before the token exchange
    And the mint makes AT MOST two sequential HTTP calls (resolve + exchange), with no artificial delay or retry between them
      # (fits the worker's 15s clone-credential wait by design, RESEARCH §3.3 — a call-COUNT invariant, not a wall-clock timing test)
    And a configured `installationId` override, when present, is used instead (skipping the resolve call)
