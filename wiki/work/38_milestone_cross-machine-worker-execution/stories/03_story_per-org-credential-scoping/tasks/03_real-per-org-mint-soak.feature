@manual @cli @work @distribution
Feature: Two real orgs, each minted by its OWN GitHub App — a worker clones each org's private repo with that org's own App token, and a cross-org mis-config fails loud, never borrows
  In order to prove per-org isolation on REAL producers (ADR-008: a green suite proves nothing — only a real
  producer does; this milestone's earned lesson), an operator configures TWO real GitHub Apps — one per org, each
  installed least-privilege on its own private repo, each key file-perm-protected in a non-sync path. A worker
  assigned a repo in each org clones EACH using that org's OWN App-minted token; a deliberately mis-configured
  cross-org attempt fails LOUD and never borrows a sibling org's App. This is the confirmation the @executable
  lanes cannot give (they inject fake signers/http + fake keys and never cross a real org boundary).

  # ARCHITECTURE 38/ADR-011 (per-org App identity; option 2 of ADR-010's "Known limitation" — one App per org, real
  # isolation, the operator's stated preference "keep this locked down and explicit"). Mirrors ADR-010 Gap A's
  # per-workspace `cloneUrl` resolution, extended to the App identity. SECURITY T12 (cross-org key confusion) +
  # T8/R7 attestation, now REPEATED PER ORG (no CI test can see each org's server-side install scope or its key's
  # on-disk perms — that residue is the human attestation). RESEARCH §3.6 (App least-privilege). The DEFERRED HUMAN
  # GATE, closed at `aof:verify 38`.
  #
  # @qa: run only after the story-03 @executable lanes 00–02 are green AND two real GitHub Apps (one per org) are
  # provisioned. The operator spot-checks below are concrete pass/fail, not a vibe.

  Scenario: each org's private repo clones with THAT org's own App-minted token — end to end
    Given a control node with a `github-app` provider
    And org A's workspace configures App-A (installed `contents:read`, selected-repos-only, on private "orgA/repo-a"), key file-perm-protected in a non-sync path
    And org B's workspace configures App-B (installed the same way on private "orgB/repo-b"), its OWN key in a non-sync path
    And a worker enrolled in the mesh that has NEITHER "orgA/repo-a" NOR "orgB/repo-b" checked out
    When the operator assigns a story targeting "orgA/repo-a" AND (separately) a story targeting "orgB/repo-b" to that worker
    Then "orgA/repo-a" is cloned with a token minted by App-A (its installation / iss belongs to org A's App)
    And "orgB/repo-b" is cloned with a token minted by App-B — neither clone used the other org's App
    And each worktree materializes and drives its ref to a terminal run, no manual pre-setup
    And a spot-check of each `<meshRoot>/checkouts/<workspaceId>/.git/config` shows no token at rest (no `url.<x>@`, no `[http] extraheader`, no `credential.helper store`)
    And a grep of the worker's run logs / streamed frames shows neither minted token nor EITHER App private key anywhere
    And NEITHER App private key ever left the control node (absent from every worker-side artifact and every relayed frame)

  Scenario: a deliberately mis-configured cross-org attempt fails LOUD — never borrows a sibling org's App
    Given org C's workspace "ws-c" has NO App/key configured of its own (or a wrong `appId`)
    When the operator assigns a story targeting "orgC/repo-c" to the worker
    Then the mint fails LOUD — `clone-credential-mint-failed` → `assignment-repo-unavailable`, surfaced on the fleet with the coded reason
    And the worker does NOT clone "orgC/repo-c"
    And NO other org's App (App-A / App-B) was borrowed to mint for "orgC/repo-c" — no silent success with the wrong credential

  Scenario: the operator attests EACH org's App is least-privilege (the T8/R7 attestation, repeated per org)
    Given App-A and App-B are configured
    Then the operator confirms EACH App is installed `contents:read` only, selected-repositories only, with no write and no org-wide scope
    And the operator confirms EACH App private key is stored file-perm-protected in a NON-SYNC path (never Dropbox / iCloud / OneDrive, never in git)
    And this per-org attestation is recorded (SECURITY T12 / T8 / R7 extended to every org the fleet spans)
