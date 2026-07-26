@executable @cli @work @distribution @bug @finding-F-3203
Feature: a legacy committed mesh.nodeId is a working fallback AND work doctor warns to migrate it — the migrate moves nodeId/salt to the sidecar, strips them from committed config, is idempotent, and absence-tolerant
  In order to migrate legacy installs off committed identity without breaking them, and to turn the acd-mesh-identity-not-committed fitness green
  a committed mesh.nodeId with NO sidecar stays a working fallback (ADR-004.4) AND work doctor emits a warn "per-install identity is in committed config — migrate it to .aof/mesh/identity.json (F-3203)"; the migrate moves nodeId/salt to the sidecar and STRIPS them from the committed config (turning acd-mesh-identity-not-committed green); the migrate is idempotent (a second run is a clean no-op) and absence-tolerant (no committed identity ⇒ nothing to migrate, no warn),
  so that the current committed .aof/aof.config.json (which still carries mesh.salt + mesh.nodeId "umairs-msi") migrates cleanly to the sidecar — the story's Definition-of-Done.

  # ARCHITECTURE ADR-004.4 (back-compat + migration): a committed mesh.nodeId (legacy
  # installs) stays a FALLBACK when no sidecar exists AND work doctor warns to migrate.
  # ADR-004 Consequences (the acd-mesh-identity-not-committed DoD: migrate the committed
  # config to the sidecar to turn the pending guard green):
  #   1. THE DOCTOR WARN: work doctor emits a NEW warn-severity finding, code
  #      "mesh-identity-committed", whenever the committed config carries mesh.nodeId or
  #      mesh.salt — the (snapshot, ctx) => Finding[] shape (work-doctor.mjs:11-13:
  #      { code, severity:"warn", path, message }), a NEW check-group APPENDED to
  #      CHECK_GROUPS (work-doctor.mjs:288-296), reading ctx.config (which loadWorkspace
  #      hydrates) + the RAW committed config on disk (the warn is about the COMMITTED
  #      artifact, so it reads the file, not the hydrated overlay);
  #   2. THE MIGRATE ACTION moves mesh.nodeId + mesh.salt from committed config to the
  #      sidecar .aof/mesh/identity.json (read-merge-write both, the persistNodeId idiom
  #      node-identity.mjs:112-125) and STRIPS both keys from the committed config, so the
  #      committed .aof/aof.config.json ends with no nodeId/salt (fitness green);
  #   3. IDEMPOTENT: a second migrate over an already-migrated repo (no committed identity,
  #      a sidecar present) is a clean no-op — the committed config is byte-unchanged and
  #      the sidecar is byte-unchanged, no re-write, no warn;
  #   4. ABSENCE-TOLERANT: no committed nodeId/salt AND no sidecar ⇒ nothing to migrate, a
  #      clean no-op, and doctor emits NO mesh-identity-committed warn.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness acd-mesh-identity-not-committed (ADR-006, STORY.md buildable unit): a
  #    STRUCTURAL JSON read asserting the committed .aof/aof.config.json + aof.schema.json
  #    carry no mesh.nodeId/mesh.salt — the arch-test, NOT a scenario here. It ships PENDING
  #    and is turned GREEN by the migrate landing (this feature's action). THIS feature
  #    asserts the OBSERVABLE migrate/doctor outcomes (the warn code+message fires/does-not;
  #    the committed config has the keys stripped; the sidecar gains them; idempotence).
  #  - the doctor's ENGINE (buildSnapshot/doctorWork determinism, work-doctor.mjs:382-399)
  #    is milestone-15 machinery under its own arch-tests — THIS feature adds one warn code
  #    and asserts it fires on the right fixture, not the engine's mechanics.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the migrate rows stay @executable ONLY if
  #  (a) the migrate is a testable UNIT (a function / a work-doctor --fix-like action)
  #      taking an injected committed-config path + sidecar path — NOT wired only behind an
  #      interactive prompt. A test calls migrate(configPath, sidecarPath) and asserts both
  #      files' resulting bytes (mirrors persistNodeId's injected configPath idiom). If the
  #      migrate can only be reached interactively, the idempotence + strip rows are not
  #      hermetic — keep it @executable via the injected-path unit;
  #  (b) the doctor warn-group reads the RAW committed config on disk (not the hydrated
  #      overlay) — because after loadWorkspace hydration config.mesh.nodeId is present from
  #      the SIDECAR too, so warning off the hydrated value would false-positive on a
  #      correctly-migrated repo. The warn must fire iff the COMMITTED FILE carries the keys.
  #      Confirm the group's data source is the on-disk committed config, not ctx.config's
  #      hydrated mesh block.
  # RAISED — do NOT retag to @manual; the warn firing, the key strip, the sidecar gain,
  # and idempotence are all deterministic over planted committed-config + sidecar fixtures.
  # See VERIFICATION.
  #
  # RESOLVED (developer-amigo): both sub-flags CONFIRMED — @executable stands unchanged.
  #  (a) MIGRATE AS A TESTABLE UNIT OVER INJECTED PATHS — CONFIRMED feasible, mirroring the
  #      exact precedent `persistNodeId(configPath, id)` already sets (`node-identity.mjs:112`):
  #      a plain exported async fn taking BOTH paths as args, e.g.
  #      `migrateIdentity(configPath, sidecarPath)`, doing the SAME read-merge-write TWICE
  #      (read committed config via `readJson`/catch-to-`{}`, `fs.mjs:5`; if
  #      `config.mesh?.nodeId` or `config.mesh?.salt` is present, merge them into the
  #      sidecar's object — read-merge-write the sidecar the same way `persistNodeId`
  #      would post-task-00's re-point — then delete `config.mesh.nodeId`/`config.mesh.salt`
  #      and `writeText` the committed config back, 2-space + trailing `\n`). No prompt
  #      dependency: a test calls `migrateIdentity(fixtureConfigPath, fixtureSidecarPath)`
  #      directly and asserts both files' resulting bytes — hermetic. The CLI/interactive
  #      face (if any, e.g. a `work doctor --fix`) is a thin wrapper calling this same unit
  #      with the real `ws.configPath`/sidecar path — the unit itself is what the tests
  #      drive, per the `mesh-issue.mjs`-style injected-unit precedent this house already
  #      uses (`wiki/work/27_.../tasks/00_mesh-issue-command.feature`'s resolved flag (a)).
  #  (b) DOCTOR WARN MUST READ RAW DISK CONFIG, NOT THE HYDRATED OVERLAY — CONFIRMED GAP,
  #      real and load-bearing; traced end-to-end. `commands/doctor.mjs:30` calls
  #      `doctorWork(ctx.workspace.workDir, ctx.workspace.config, scope, {...})` — and
  #      `ctx.workspace.config` IS `loadWorkspace`'s returned (post-task-01-hydration)
  #      config object. `work-doctor.mjs:382-390`'s `doctorWork` stores that SAME object
  #      verbatim as `ctx.config` (line 389: `config: config ?? {}`) and hands it to every
  #      check-group unchanged. Confirmed by reading every EXISTING check-group
  #      (`work-doctor-coherence.mjs`, `work-doctor-freshness.mjs`, `work-doctor-budget.mjs`)
  #      — none of them re-reads the committed config file independently; they all trust
  #      whatever `ctx.config` carries. So on a correctly-migrated repo (sidecar present,
  #      committed config stripped), `ctx.config.mesh.nodeId` is STILL populated — by
  #      task 01's hydration overlay, sourced from the sidecar, not the committed file.
  #      A new `mesh-identity-committed` warn-group that naively read `ctx.config.mesh` would
  #      false-positive forever on every correctly-migrated repo. THE FIX: the new
  #      check-group must NOT use `ctx.config` for this decision — it must independently
  #      `readJson` the RAW committed config off `snapshot`'s known config path (the
  #      committed `.aof/aof.config.json`, resolvable the same way `loadWorkspace` resolves
  #      it, or threaded in via a new `ctx.rawConfigPath`/`ctx.committedConfig` key the
  #      doctor command computes at the boundary — `commands/doctor.mjs:28-33` is the impure
  #      edge where `Date.now()` already lives per ADR-003, so adding one more raw disk read
  #      there, or passing `ctx.workspace.configPath` through so the group reads it itself,
  #      is the natural, precedent-following seam; either shape is fine as long as the
  #      group's data source is verifiably the ON-DISK committed bytes, never the hydrated
  #      `ctx.config.mesh`). This is the ONE concrete wiring change this story must make to
  #      `work-doctor.mjs`/`commands/doctor.mjs` beyond appending a new check-group function.
  Background:
    Given a fixture aof project whose committed config path and sidecar path .aof/mesh/identity.json I control
    And the migrate action takes the committed config path and the sidecar path as injected inputs
    And work doctor's mesh-identity warn-group reads the RAW committed config on disk

  # THE DOCTOR WARN MATRIX (ADR-004.4): work doctor emits the mesh-identity-committed
  # warn iff the COMMITTED config carries mesh.nodeId OR mesh.salt — regardless of whether
  # a sidecar also exists (the warn is about the committed artifact carrying identity, the
  # F-3203 smell). A fully-migrated committed config (neither key) yields NO warn.
  Scenario Outline: work doctor warns mesh-identity-committed iff the committed config carries nodeId or salt
    Given the committed config's mesh block is <committed-mesh>
    When I run work doctor over the fixture project
    Then a "mesh-identity-committed" warn finding is <emitted> pointing at the committed config path
    And when emitted its message names ".aof/mesh/identity.json" and the F-3203 migration

    Examples:
      | committed-mesh                              | emitted     |
      | { nodeId:"umairs-msi", salt:"s" }           | emitted     |
      | { nodeId:"umairs-msi" }                     | emitted     |
      | { salt:"s" }                                | emitted     |
      | { relay:{ controlNode:"n" }, fabric:"tailscale" } | NOT emitted |
      | {} (no mesh block)                          | NOT emitted |

  # THE MIGRATE MATRIX (ADR-004.4 + the acd-mesh-identity-not-committed DoD): the migrate
  # is committed-present → move+strip; already-migrated → no-op; absent → no-op. Each row
  # asserts the RESULTING committed-config state (keys stripped or byte-unchanged) and the
  # RESULTING sidecar state (gains the identity or byte-unchanged). This is the action that
  # turns the pending fitness green.
  Scenario Outline: migrate moves+strips committed identity to the sidecar, and is a clean no-op when already-migrated or absent
    Given the committed config's mesh block is <committed-before>
    And the sidecar is <sidecar-before>
    When I run the migrate action over the fixture project
    Then the committed config's mesh block is <committed-after> (nodeId/salt stripped when present)
    And the sidecar .aof/mesh/identity.json is <sidecar-after>
    And the committed config carries NO mesh.nodeId and NO mesh.salt after the migrate

    Examples:
      | committed-before                    | sidecar-before                | committed-after                | sidecar-after                        | case             |
      | { nodeId:"umairs-msi", salt:"sA" }  | absent                        | {} (identity stripped)         | { nodeId:"umairs-msi", salt:"sA" }   | migrate          |
      | {} (no identity)                    | { nodeId:"umairs-msi", salt:"sA" } | {} (byte-unchanged)       | { nodeId:"umairs-msi", salt:"sA" } (byte-unchanged) | already-migrated |
      | {} (no identity)                    | absent                        | {} (byte-unchanged)            | absent (nothing created)             | absent-no-op     |

  # THE MIGRATE PRESERVES SIBLING FLEET-SHARED KEYS (ADR-004.1; the read-merge-write
  # idiom node-identity.mjs:26-30 must preserve unknown mesh siblings): stripping nodeId/
  # salt from committed config MUST leave the fleet-shared committed keys (relay.controlNode,
  # fabric, enrollment) byte-equivalent — the split strips ONLY per-install identity, never
  # the fleet-shared config. This is the config-editor-whitelist hazard the story flags.
  Scenario: the migrate strips only nodeId/salt and leaves fleet-shared committed mesh keys intact
    Given the committed config's mesh block is { nodeId:"umairs-msi", salt:"sA", relay:{ controlNode:"umairs-msi" }, fabric:"tailscale" }
    When I run the migrate action over the fixture project
    Then the committed config's mesh block is { relay:{ controlNode:"umairs-msi" }, fabric:"tailscale" } (fleet-shared keys survive)
    And the committed config carries NO mesh.nodeId and NO mesh.salt
    And the sidecar holds exactly { nodeId:"umairs-msi", salt:"sA" }

  # IDEMPOTENCE — A SECOND MIGRATE IS A BYTE-LEVEL NO-OP (ADR-004.4): running migrate twice
  # over the SAME repo leaves the committed config AND the sidecar byte-identical to their
  # post-first-migrate state — the migrate detects "already migrated" and rewrites nothing.
  Scenario: a second migrate over an already-migrated repo rewrites nothing (byte-level no-op)
    Given a committed config { nodeId:"umairs-msi", salt:"sA" } and no sidecar
    And I run the migrate action once and record both files' exact bytes
    When I run the migrate action a SECOND time
    Then the committed config is byte-identical to its post-first-migrate bytes
    And the sidecar is byte-identical to its post-first-migrate bytes
    And no mesh-identity-committed warn is emitted by a subsequent work doctor run
