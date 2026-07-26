@executable @cli @work @distribution
Feature: The github-app private key resolves from a CODE-ENFORCED default directory under the mesh home — never a sync-scoped folder — when no explicit path is set
  In order that the fleet-wide signing secret (SECURITY T8 — the largest blast radius in the model) is never left
  in a Dropbox/iCloud/OneDrive-synced tree by default, `resolveGithubAppPrivateKey` falls back — when NEITHER
  `AOF_MESH_GITHUB_APP_PRIVATE_KEY_PATH` (env) NOR `config.mesh.repo.credential.githubApp.privateKeyPath` (config)
  is set — to a CODE-ENFORCED `<meshRoot>/credentials/` (i.e. `~/.aof/mesh/credentials/`, honoring AOF_GLOBAL_HOME),
  composed via the `globalMeshPaths` seam; an explicit env or config path still overrides it.

  # ARCHITECTURE 38/ADR-011 decision 5 + structural invariant #3 (the default key dir is `<meshRoot>/credentials/`,
  # code-composed via `globalMeshPaths` — never a config-supplied default that could point at a synced tree, never
  # a `homedir()`+sync-folder path). Today `resolveGithubAppPrivateKey` (`mesh-launcher.mjs:131`) returns `null`
  # when neither env nor config path is set — there is NO default dir yet, so a key must be pointed at explicitly.
  # SECURITY T12(b) + T8 (the default key dir must be a file-permission-protected, NON-SYNC path — the MEASURED
  # footgun the story exists for: the operator had to relocate the story-02 key OUT of a Dropbox-synced folder).
  # The key still flows ONLY into the JWT signer (ADR-010/011 F5), never a log/frame/`process.env`.
  #
  # @executable over INJECTED seams — a recording file-reader (captures the PATH it is asked to read; no real key,
  # no real fs read of a secret) and a temp `AOF_GLOBAL_HOME` as the mesh root. NO real GitHub, no network.

  Background:
    Given `resolveGithubAppPrivateKey` over an injected reader that records the path it is asked to read
    And a temp `AOF_GLOBAL_HOME` whose mesh root is the scoped, non-sync default location

  Scenario: neither env nor config set → the code-enforced `<meshRoot>/credentials/` default
    Given `AOF_MESH_GITHUB_APP_PRIVATE_KEY_PATH` is unset
    And `config.mesh.repo.credential.githubApp.privateKeyPath` is absent
    When the App private key is resolved
    Then the key path resolved is UNDER `<meshRoot>/credentials/` (`~/.aof/mesh/credentials/`, honoring AOF_GLOBAL_HOME)
    And that path is composed via the `globalMeshPaths` seam, never from `homedir()` + a sync-folder name
    And the resolved path contains no sync-scoped segment (no `Dropbox`, `OneDrive`, `iCloud`, `Library/Mobile Documents`)

  Scenario: an explicit env path overrides the default entirely
    Given `AOF_MESH_GITHUB_APP_PRIVATE_KEY_PATH` is set to "/keys/app.pem"
    When the App private key is resolved
    Then the key is read from EXACTLY "/keys/app.pem"
    And the `<meshRoot>/credentials/` default is never consulted

  Scenario Outline: env > config > code-enforced default (the resolution precedence)
    Given the env path is <env_path> and the config path is <config_path>
    When the App private key is resolved
    Then the key path resolved is <resolved_source>

    Examples:
      | env_path      | config_path      | resolved_source                         |
      | /keys/env.pem | /keys/config.pem | /keys/env.pem                           |
      | (unset)       | /keys/config.pem | /keys/config.pem                        |
      | (unset)       | (absent)         | <meshRoot>/credentials/ (code default)  |
