@executable @cli @work @distribution
Feature: The App private key never leaves the control node — never relayed, never logged; only the minted token crosses the wire
  In order that the fleet-wide signing secret (SECURITY T8, the model's largest single blast radius) is contained,
  the App private key flows ONLY into the JWT signer on the control node — never onto a frame, never into a log /
  error / warning sink, never handed to a worker. Only the short-lived minted token reaches the worker, over the
  unchanged ADR-009 pull reply.

  # SECURITY T8 (App key at rest) + F5 (`acd-clone-app-key-not-relayed`, extends story-01's F4 from the minted
  # token to the KEY). T11 (the token, not the key, is the only secret on the wire). Re-arms story-01 T1/T3 on the
  # github-app path: the minted token is still not persisted to .git/config, not on ambient process.env, not logged.

  Background:
    Given the github-app provider mints with a fake app private key + a fake minted token

  Scenario: the App private key reaches only the signer
    When the provider mints a token
    Then the app private key value appears in NO frame the control stream server sends (no clone-credential frame, no directive)
    And it appears in NO log, warning, or error message on the mint path
    And it is passed ONLY to the JWT signer — never assigned onto ambient `process.env`

  Scenario: a mint FAILURE redacts both the key and the token from the surfaced error
    Given the token exchange fails and the provider throws
    Then the surfaced/coded error carries neither the app private key nor any token value (redaction discipline)
    And the worker receives the loud coded refusal, not a raw error carrying a secret

  Scenario: the minted token is not left at rest on the worker (story-01 T1/T3 re-armed on this path)
    Given a clone completed with a github-app-minted token
    Then nothing is written into the checkout's `.git/config` (no `url.<cred>@`, no `http.extraheader`, no durable `credential.helper store`)
    And the token is absent from the worker's ambient `process.env` and from the spawned agent child's env
    And the token value appears in no log or streamed frame
