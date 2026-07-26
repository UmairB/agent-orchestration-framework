@manual @cli @work @distribution
Feature: A real GitHub App mints a real installation token that clones a real private repo — no PAT, no credential at rest
  In order to prove the automated mint end to end, an operator configures a real GitHub App (installed
  least-privilege on the target repo), and assigns a story from the control node to a worker that lacks that
  PRIVATE repo. The control mints a real installation access token — single-repo, `contents:read`, short-lived —
  the worker clones with it (prompt-aware askpass), drives the ref to a terminal run, and NO credential is left at
  rest. This is the confirmation the @executable lanes cannot give (they inject a fake signer/http + fake key).

  # The story-02 DEFERRED HUMAN GATE. Closed at `aof:verify 38`. Confirms the two facts no injected test can:
  # (1) a REAL GitHub App installation token authenticates a REAL clone (RESEARCH §3 flagged the `x-access-token`
  #     username behaviour as measurable-only-live — the prompt-aware shim, ADR-010, is the design; this proves it);
  # (2) the App is installed LEAST-PRIVILEGE and the private key is stored appropriately (SECURITY T8 — the ONE
  #     thing the operator now attests, replacing the per-repo-PAT scope/TTL attestation, which is now code-enforced).
  #
  # @qa: run only after story-02 @executable lanes 00–04 are green AND a real GitHub App is provisioned. The
  # operator spot-checks below are concrete pass/fail, not a vibe.

  Scenario: a real App-minted token clones a private repo the worker lacks, end to end
    Given a control node with a `github-app` provider configured (app id + private key at a file-perm-protected path)
    And the GitHub App installed on private repo "acme/secret" with EXACTLY `contents: read`, selected-repositories only
    And a worker enrolled in the mesh that does NOT have "acme/secret" checked out
    When the operator assigns a story to that worker from the control node
    Then the control mints a REAL installation access token scoped to "acme/secret", `contents:read`, ~1h TTL — no static PAT involved
    And the worker clones "acme/secret" using it via the prompt-aware askpass (Username `x-access-token`, Password the token)
    And the worker materializes a worktree and drives the ref to a terminal run, no manual pre-setup
    And the fleet advances `assigned → running → done` live from the control node
    # NO CREDENTIAL AT REST — the human spot-checks the hermetic lanes cannot fully prove on a REAL token:
    And a spot-check of <meshRoot>/checkouts/<workspaceId>/.git/config shows no token (no `url.<x>@`, no `[http] extraheader`, no durable `credential.helper store`)
    And a spot-check of the worker env (and the spawned agent child's env) shows the token absent after the clone
    And a grep of the worker's run logs / streamed frames shows neither the token nor the App private key appears anywhere
    And the App PRIVATE KEY never left the control node (absent from every worker-side artifact and every relayed frame)

  Scenario: the operator attests the App is least-privilege (the attestation that REPLACES per-repo PAT scope/TTL)
    # T4's per-clone scope/TTL is now code-enforced (F6); what remains human is the App's own install posture (T8).
    Given the `github-app` provider is configured
    Then the operator confirms the App is installed with `contents:read` only, on selected repositories only, with no write and no org-wide scope
    And the operator confirms the App private key is stored appropriately (file-perm path / keystore ref, never in git)
    And this attestation is recorded, replacing the story-01 per-repo-PAT scope/TTL sign-off (now enforced in code)
