@executable @cli @work @distribution @bug @finding-F-3203
Feature: loadWorkspace hydrates config.mesh.nodeId/salt from the git-ignored sidecar — precedence sidecar > committed-fallback > hostname-derive — so every downstream config.mesh reader sees the per-install id with ZERO change
  In order that every downstream reader (mesh-presence, issuance, lease, mesh-relay's optional-chain) reads the per-install identity unchanged after the split
  loadWorkspace, after reading the committed config, reads the sidecar .aof/mesh/identity.json and overlays its nodeId/salt onto config.mesh in the RETURNED in-memory workspace (ADR-004.3), so the precedence is sidecar > committed-fallback > hostname-derive; a workspace with BOTH a sidecar and a legacy committed nodeId returns the SIDECAR value; hydration lands in loadWorkspace (work.mjs:42-58), never runtime-config.mjs,
  so that the identity split re-points only WHERE identity is persisted, and every reader of config.mesh.nodeId (mesh-relay.mjs, mesh-presence.mjs, issuance, lease, the mesh-gate) is untouched.

  # ARCHITECTURE ADR-004.3 (hydrate config.mesh.nodeId from the sidecar on load —
  # downstream readers unchanged) + ADR-004.4 (committed nodeId is a back-compat FALLBACK;
  # precedence sidecar > committed-fallback > hostname-derive):
  #   1. loadWorkspace (work.mjs:42-58) returns { configPath, config, projectRoot, workDir,
  #      aofDir }. The sidecar lives under aofDir (.aof/mesh/identity.json). After readJson
  #      of the committed config (:44-49), read the sidecar and OVERLAY its nodeId/salt onto
  #      the returned config.mesh — the returned in-memory config, never a disk rewrite;
  #   2. PRECEDENCE, resolved in loadWorkspace:
  #        sidecar present            → config.mesh.nodeId/salt = the sidecar's values;
  #        no sidecar, committed present → committed values survive (the back-compat fallback);
  #        no sidecar, no committed   → config.mesh.nodeId stays absent (a later deriveNodeId
  #                                     call mints it — hydration does NOT derive; it overlays);
  #        BOTH present               → the SIDECAR value wins (overlay overwrites committed);
  #   3. the overlay is on the RETURNED object only — loadWorkspace writes NO file (a pure
  #      read-and-merge), so a hydrate never mutates the committed config on disk;
  #   4. hydration is in loadWorkspace, NOT runtime-config.mjs (that is runtime-file
  #      generation — a different concern; ADR-004.3 is explicit).
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness acd-mesh-identity-not-committed (ADR-006) guards that no per-install identity
  #    sits in the COMMITTED config artifact — a structural read, NOT a scenario here.
  #  - THIS feature asserts the OBSERVABLE hydration precedence in the RETURNED workspace
  #    (the value of workspace.config.mesh.nodeId/salt for each sidecar/committed combination)
  #    and that loadWorkspace wrote no file — the behavioural face of "downstream readers
  #    see the per-install id". Whether a SPECIFIC downstream module reads it correctly is
  #    that module's own feature; here we assert the value loadWorkspace HANDS them.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the precedence rows stay @executable ONLY if
  #  (a) loadWorkspace resolves the sidecar path from the SAME aofDir it already computes
  #      (work.mjs:57) so a test plants a fixture .aof/mesh/identity.json under the fixture
  #      project root and loadWorkspace reads THAT — no separate injection needed (the aofDir
  #      is already a computed, fixture-relative path). Confirm the sidecar read is anchored
  #      on aofDir, not an absolute machine path;
  #  (b) hydration does NOT read os.hostname()/derive during load — the "neither present"
  #      row asserts config.mesh.nodeId stays ABSENT after load (derive is deferred to the
  #      command that needs an id, per ADR-004.3's "overlay, not derive"). If loadWorkspace
  #      eagerly derives, the neither-present row and the "no disk write" assertion both
  #      break — confirm loadWorkspace overlays only.
  # RAISED — do NOT retag to @manual; every precedence combination is a two-fixture-file
  # setup (a planted committed config + an optionally-planted sidecar) with a deterministic
  # returned value — fully unit-testable over local fixtures. See VERIFICATION.
  #
  # RESOLVED (developer-amigo): both sub-flags CONFIRMED — @executable stands unchanged.
  #  (a) SIDECAR PATH ANCHORED ON THE SAME aofDir loadWorkspace ALREADY COMPUTES — YES.
  #      `loadWorkspace` (`work.mjs:42-59`) computes `aofDir` at line 57 —
  #      `path.basename(configDir) === ".aof" ? configDir : path.join(projectRoot, ".aof")`
  #      — fixture-relative (derived from the fixture's own `configPath`/`projectRoot`,
  #      never a hard-coded machine path) and RETURNS it in the workspace object
  #      (line 58: `{ configPath, config, projectRoot, workDir, aofDir }`). The sidecar read
  #      is `path.join(aofDir, "mesh", "identity.json")` — a test plants a fixture
  #      `.aof/mesh/identity.json` under the fixture project root and `loadWorkspace`
  #      resolves the SAME path with no separate injection needed. No new injection seam
  #      is required beyond what already exists.
  #  (b) OVERLAY, NOT DERIVE, NO FILE WRITE — CONFIRMED as the correct shape; this is a
  #      pure in-memory step. `loadWorkspace` today (`work.mjs:44-49`) already does exactly
  #      `readJson(configPath)` wrapped in try/catch → `config = {}` on failure, then
  #      RETURNS the in-memory object at line 58 with no write call anywhere in the
  #      function. The hydration addition is symmetric: after the existing config read,
  #      `readJson(sidecarPath)` (SAME try/catch-to-`{}` idiom — a torn/absent sidecar
  #      degrades silently, matching the "malformed sidecar degrades to fallback" scenario
  #      below) and, when the sidecar object has a non-empty string `nodeId`, overlay
  #      `config.mesh = { ...config.mesh, nodeId: sidecar.nodeId, salt: sidecar.salt }`
  #      onto the in-memory `config` BEFORE the `return` statement. No `writeText`/`fs`
  #      write call is added to `loadWorkspace` — the "loadWorkspace writes no file"
  #      assertion holds because the overlay only ever mutates the object about to be
  #      returned, never touches disk. `os.hostname()`/`deriveNodeId` are NOT called from
  #      `loadWorkspace` — hydration is a read-and-merge, never a derive-and-persist (that
  #      stays at the `mesh:identity`/`mesh:heartbeat` command call sites,
  #      `commands/mesh-identity.mjs:139-144`), so the "neither present ⇒ absent" row holds.
  #      NOTE — this is where task 03's self-heal write is the ONE deliberate exception to
  #      "loadWorkspace writes no file"; see task 03's `# RESOLVED` for the reconciliation
  #      (the heal write is discriminated by the sidecar schema, not the common overlay path).
  Background:
    Given a fixture aof project rooted at a dir I control, with an .aof/ config home
    And loadWorkspace resolves the sidecar under the project's aofDir (.aof/mesh/identity.json)
    And I can plant or omit the committed config's mesh block and the sidecar independently

  # THE PRECEDENCE MATRIX (ADR-004.3/.4): the ONE table that pins sidecar >
  # committed-fallback > hostname-derive. Each row plants a committed-mesh state and a
  # sidecar state, calls loadWorkspace, and asserts the RETURNED config.mesh.nodeId. The
  # sidecar-wins row is the F-3203-relevant case: a legacy committed nodeId is present but
  # the SIDECAR value is what a reader sees. "absent" = config.mesh.nodeId is undefined
  # after load (hydration overlays; it does not derive).
  Scenario Outline: loadWorkspace returns nodeId per precedence — sidecar > committed-fallback > (neither → absent)
    Given the committed config's mesh.nodeId is <committed>
    And the sidecar .aof/mesh/identity.json is <sidecar>
    When I loadWorkspace over the fixture project
    Then the returned workspace.config.mesh.nodeId is <resolved>
    And loadWorkspace wrote NO file (neither the committed config nor the sidecar changed on disk)

    Examples:
      | committed        | sidecar                          | resolved         | note                          |
      | absent           | { nodeId:"sidecar-id" }          | "sidecar-id"     | sidecar-only ⇒ sidecar        |
      | "committed-id"   | absent                           | "committed-id"   | committed-only ⇒ fallback     |
      | "committed-id"   | { nodeId:"sidecar-id" }          | "sidecar-id"     | both ⇒ SIDECAR wins           |
      | absent           | absent                           | absent           | neither ⇒ absent (no derive)  |

  # SALT IS HYDRATED THE SAME WAY (ADR-004.1/.3): the sidecar carries BOTH nodeId AND salt;
  # loadWorkspace overlays both onto config.mesh, so a downstream deriveNodeId/installHash
  # reader reads the per-install salt from the sidecar, not committed config. Same
  # precedence as nodeId — sidecar salt wins over a legacy committed salt.
  Scenario Outline: loadWorkspace hydrates config.mesh.salt with the same precedence as nodeId
    Given the committed config's mesh.salt is <committed>
    And the sidecar .aof/mesh/identity.json is <sidecar>
    When I loadWorkspace over the fixture project
    Then the returned workspace.config.mesh.salt is <resolved>

    Examples:
      | committed        | sidecar                                     | resolved      |
      | absent           | { nodeId:"n", salt:"sidecar-salt" }         | "sidecar-salt"|
      | "committed-salt" | absent                                      | "committed-salt"|
      | "committed-salt" | { nodeId:"n", salt:"sidecar-salt" }         | "sidecar-salt"|

  # DOWNSTREAM READERS ARE UNCHANGED (ADR-004.3, the whole point): after hydration the
  # config.mesh.nodeId a downstream reader's optional-chain sees IS the per-install
  # sidecar id — verified through the mesh-gate predicate (mesh-gate.mjs), the ONE
  # config.mesh gate the run-lifecycle reads: a non-empty hydrated nodeId opens the gate,
  # so an issuance/lease reader reads the sidecar id with ZERO code change.
  Scenario: a downstream config.mesh.nodeId reader sees the hydrated sidecar id (zero reader change)
    Given the committed config carries a legacy mesh.nodeId "umairs-msi"
    And the sidecar holds nodeId "macbook-pro"
    When I loadWorkspace over the fixture project
    Then the returned workspace.config.mesh.nodeId is "macbook-pro"
    And the mesh-gate predicate over the returned config resolves the meshNodeId as "macbook-pro" (the per-install id)
    And no downstream reader observes the legacy committed "umairs-msi"

  # HYDRATION LANDS IN loadWorkspace, TOLERATES A MALFORMED SIDECAR (ADR-004.3; the
  # readJson-catch discipline work.mjs:44-49 already uses for the config): a corrupt /
  # non-JSON sidecar does not crash loadWorkspace — it degrades to the committed fallback
  # (a torn write must never brick the workspace), matching the config-read's try/catch.
  Scenario Outline: a malformed or empty sidecar degrades to the committed fallback, never a crash
    Given the committed config carries mesh.nodeId "committed-fallback-id"
    And the sidecar file contains <sidecar-bytes>
    When I loadWorkspace over the fixture project
    Then loadWorkspace does not throw
    And the returned workspace.config.mesh.nodeId is "committed-fallback-id" (degraded to the fallback)

    Examples:
      | sidecar-bytes                | note                       |
      | not-valid-json{{{            | corrupt JSON               |
      | ""                           | empty file                 |
      | { "nodeId": "" }             | present-but-empty nodeId   |
      | { "salt": "s-only" }         | nodeId key absent          |
