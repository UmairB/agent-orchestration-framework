@executable @cli @work @distribution
Feature: The github-app App identity resolves PER-ASSIGNED-workspace, keyed by the mint's workspaceId — not once from the launch workspace
  In order that each org's repos are minted by that org's OWN App (ADR-011 closing ADR-010's "one App per control
  node" limitation), the github-app provider resolves `appId`/`privateKey`/`installationId` through a per-workspace
  `resolveWorkspaceAppIdentity(workspaceId)` seam — mirroring ADR-010 Gap A's `resolveWorkspaceCloneUrl` — reading
  the ASSIGNED workspace's OWN committed `mesh.repo.credential.githubApp.*`, and falling through to the control
  node's own launch-workspace (global-merged) default only when the assigned workspace configures no override of
  its own.

  # ARCHITECTURE 38/ADR-011 (App identity per-assigned-workspace via `resolveWorkspaceAppIdentity`, the same
  # treatment ADR-010 Gap A / `createResolveWorkspaceCloneUrl` already gives `cloneUrl`; mint-seam signature
  # `mintCloneCredential(workspaceId, assignmentId)` UNCHANGED — identity moves INTO the provider closure, keyed by
  # the F15-bound `workspaceId`, never the worker's frame — ADR-011 invariants #1 + #4). THE GAP CLOSED: today
  # `resolveCloneCredentialProvider` reads the App identity ONCE from the launch workspace's merged config
  # (`mesh-launcher.mjs:523-528`), so a per-workspace override only took effect when the overriding project WAS the
  # daemon's launch cwd. `loadWorkspace` already merges GLOBAL `~/.aof/aof.config.json` mesh config UNDER each
  # project's LOCAL mesh config (`work.mjs:176-180`, local wins) — so a single global App is already the fleet-wide
  # default and a local config already overrides; the ONLY gap is re-resolving per ASSIGNED workspace. SECURITY T12
  # (per-org key confusion). RESEARCH §3.6 (App least-privilege — one signing key at rest per org).
  #
  # @executable over INJECTED seams — a recording JWT signer (captures the {appId, privateKey} each mint signs
  # with), a fake HTTP client, and FAKE per-workspace app keys, over hermetic committed workspace configs on a temp
  # global mesh home. NO real GitHub, no network, no real key (that is task 03's @manual per-org soak).

  Background:
    Given the github-app provider resolves App identity through a per-workspace `resolveWorkspaceAppIdentity(workspaceId)` seam
    And each workspace's identity is read from its OWN committed `mesh.repo.credential.githubApp.*` (global-merged), with the launch workspace as the only fallback
    And an injected signer records which `appId`/`privateKey` each mint signs with

  Scenario: the provider resolves identity keyed by the mint's workspaceId, not a single static App
    Given a mint for workspace "ws-b"
    When the github-app provider mints
    Then `resolveWorkspaceAppIdentity` is consulted with EXACTLY "ws-b" (the F15-bound workspaceId, never the worker's frame)
    And the App JWT is signed with the `appId`/`privateKey` that seam returned for "ws-b"
    And the provider does NOT close over a single static `appId`/`privateKey` reused across every mint

  Scenario: a NON-launch assigned workspace's OWN committed override takes effect (the gap ADR-011 closes)
    Given the control node's launch workspace configures App "app-launch"
    And assigned workspace "ws-b" is NOT the launch cwd and carries its OWN committed `githubApp.appId` "app-b" (+ its own key)
    When the github-app provider mints for "ws-b"
    Then the App JWT `iss` is "app-b", signed with ws-b's OWN key — never "app-launch"
    And this holds even though "ws-b" is not the daemon's launch workspace (the pre-ADR-011 gap)

  Scenario: absent a per-workspace override, resolution falls through to the launch-workspace default
    Given the control node's launch workspace configures App "app-launch"
    And assigned workspace "ws-c" carries NO `mesh.repo.credential.githubApp.*` of its own
    When the github-app provider mints for "ws-c"
    Then the App JWT `iss` is "app-launch" (the control node's own global-merged default) — the SAME singular behaviour as today
    And that default is now reached for a NON-launch assigned workspace, not only the launch cwd

  Scenario Outline: the signing App identity is the assigned workspace's own config, else the launch default
    Given the control node's launch workspace configures App "app-launch"
    And assigned workspace <workspaceId> <ws_config>
    When the github-app provider mints for <workspaceId>
    Then `resolveWorkspaceAppIdentity` is consulted with exactly <workspaceId>
    And the App JWT is signed with appId <signing_app>

    Examples:
      | workspaceId | ws_config                                       | signing_app |
      | ws-launch   | IS the launch workspace, configuring "app-launch" | app-launch  |
      | ws-b        | has its OWN committed appId "app-b"             | app-b       |
      | ws-c        | has NO credential override of its own          | app-launch  |
