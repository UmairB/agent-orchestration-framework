@executable @cli @work @distribution
Feature: A workspace's clone credential is minted with its OWN org's App key only — never a sibling org's; a workspace with no App fails LOUD, never borrows
  In order that the isolation boundary is the ORG not just the repo (SECURITY T12 — a leak of one org's App key can
  never mint another org's repos), the github-app provider mints workspace A's token using ONLY the App identity
  resolved from A's own committed config keyed by A's workspaceId; no code path carries a previously-resolved
  identity across workspaces, and a workspace whose own config resolves no usable App/key fails LOUD (the inherited
  `clone-credential-mint-failed` → `assignment-repo-unavailable` posture), never silently borrowing a sibling org's App.

  # ARCHITECTURE 38/ADR-011 structural invariant #2 (no cross-org borrow: A's token is minted from A's own
  # identity, keyed by A's workspaceId; a null-resolved identity THROWS the loud coded refusal, never falls back to
  # a sibling's identity or the launch workspace's App). SECURITY T12 (cross-org key confusion — the fleet-wide T8
  # blast radius must NOT leak across orgs; F6/T9 stays: whichever App resolves, the mint is still single-repo
  # `contents:read`). Mirrors ADR-010 Gap A per-workspace resolution. The upstream `clone-credential-mint-failed` →
  # `assignment-repo-unavailable` chain is ADR-009/010's, reused verbatim (mesh-worker-clone-credential-pull.test.mjs)
  # — this task owns only the PROVIDER-level fact (A's mint uses A's key alone; a null identity throws, no borrow).
  #
  # @executable over INJECTED seams — a recording signer (captures which appId/key each mint used, and that a
  # sibling's material is NEVER read), a fake HTTP client, FAKE per-workspace keys, hermetic committed configs on a
  # temp global mesh home. NO real GitHub, no network, no real key (that is task 03's @manual per-org soak).

  Background:
    Given workspace "ws-a" (org A) with its OWN committed App "app-a" + key-a
    And workspace "ws-b" (org B) with its OWN committed App "app-b" + key-b
    And an injected signer that records the `appId`/`privateKey` of every mint

  Scenario: a mint for ws-a uses ONLY app-a/key-a — org B's App is never touched
    When the github-app provider mints for "ws-a"
    Then the App JWT `iss` is "app-a", signed with key-a
    And app-b / key-b are NEVER read for this mint (the recording signer sees only org A's material)

  Scenario: sequential mints do not carry one workspace's identity into the next (no cross-workspace cache)
    Given the provider has just minted for "ws-a" (signing with app-a)
    When the github-app provider next mints for "ws-b"
    Then the App JWT `iss` is "app-b", signed with key-b — never "app-a"
    And identity is resolved FRESH per mint keyed by workspaceId; no previously-resolved identity is reused

  Scenario Outline: a workspace whose OWN config resolves no usable App/key fails LOUD — never borrows a sibling
    Given workspace <workspaceId> whose own committed config <defect>
    When the github-app provider mints for <workspaceId>
    Then `resolveWorkspaceAppIdentity(<workspaceId>)` resolves to a null identity (no usable appId + key)
    And the provider THROWS a coded mint failure — no App JWT is signed, no token exchange is attempted
    And neither app-a/key-a nor app-b/key-b is EVER read to mint for <workspaceId> (no borrow)
    And upstream this is the unchanged `clone-credential-mint-failed` → `assignment-repo-unavailable` refusal

    Examples:
      | workspaceId | defect                                          |
      | ws-noapp    | has no `githubApp.appId` at all                 |
      | ws-badkey   | names an `appId` but its key file is unreadable |
      | ws-empty    | has neither an `appId` nor a key                |
