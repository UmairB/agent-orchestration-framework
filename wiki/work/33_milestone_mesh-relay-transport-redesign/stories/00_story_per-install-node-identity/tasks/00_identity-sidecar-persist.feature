@executable @cli @work @distribution @bug @finding-F-3203
Feature: deriveNodeId persists to the git-ignored sidecar .aof/mesh/identity.json, never to committed config — a fresh install derives from its OWN hostname and a clone on a different host derives its OWN distinct id
  In order to guarantee that node identity is per-install and is never inherited on clone (the F-3203 fix)
  deriveNodeId keeps its hostname-derivation + pinned-wins-verbatim precedence but re-points its PERSIST target from committed config.mesh.nodeId to the git-ignored sidecar .aof/mesh/identity.json (the SAME read-merge-write idiom persistNodeId already uses), so the committed .aof/aof.config.json is left byte-unchanged (no nodeId/salt written there) and a second clone of the same repo on a DIFFERENT host derives its OWN distinct id under its OWN hostname,
  so that two machines never share a nodeId, never clobber each other's nodes/<id>.json at one path, and the m22 one-node-per-path partition invariant (acd-mesh-partition-write) holds on real hardware.

  # ARCHITECTURE ADR-004.2 (derive from hostname by default; persist to the SIDECAR,
  # never committed config) + ADR-004.1 (the split: per-install nodeId/salt → the
  # git-ignored .aof/mesh/identity.json under the already-mesh/-ignored tree, no new
  # .gitignore entry — .aof/.gitignore:13 already ignores mesh/):
  #   1. deriveNodeId keeps its precedence VERBATIM (node-identity.mjs:73-103): a pinned
  #      config.mesh.nodeId wins (:74-78); else the sanitized hostname stem (:81-85);
  #      an empty stem → node-<installHash(salt)> (:83-84); a stem already in takenIds →
  #      <stem>-<installHash(salt)> (:90-93). Only the PERSIST DESTINATION moves;
  #   2. persistNodeId (:112-125) is re-pointed: it writes { nodeId, salt } to the sidecar
  #      .aof/mesh/identity.json via the SAME read-merge-write idiom (readJson → mutate →
  #      writeText 2-space + trailing \n), NEVER config.mesh.nodeId in the committed file;
  #   3. the committed .aof/aof.config.json is left BYTE-UNCHANGED across a fresh derive —
  #      no nodeId, no salt written into it by the persist;
  #   4. the sanitizeHostname matrix (:38-49) is exercised through the INJECTED hostname
  #      (deriveNodeId's white-box seam) so the sanitization + empty-stem + collision rows
  #      are testable with NO real machine hostname read.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness acd-mesh-identity-not-committed (ADR-006): "no per-install identity
  #    (nodeId/salt) appears in the COMMITTED config .aof/aof.config.json or the config
  #    schema" is a STRUCTURAL JSON/AST read over the committed artifact — asserted by
  #    that arch-test (STORY.md's buildable unit, DoD = un-skip + green), NEVER a
  #    behaviour scenario here. THIS feature asserts the OBSERVABLE persist outcome for a
  #    given derive call (the sidecar holds exactly {nodeId,salt}; the passed-in
  #    configPath's file is byte-unchanged) — the behavioural face of the same invariant.
  #  - the sanitization ALGORITHM's unit truth (sanitizeHostname over raw strings) is a
  #    pure-fn unit test; THIS feature drives sanitization only insofar as it decides the
  #    id deriveNodeId PERSISTS to the sidecar (the observable end-to-end persist).
  #
  # QA FEASIBILITY FLAG (developer-amigo): the persist rows stay @executable ONLY if
  #  (a) persistNodeId (or deriveNodeId's persist step) takes an INJECTED sidecar target
  #      — a sidecarPath arg OR deriving the sidecar path from an injected aofDir — so a
  #      test writes/asserts a fixture sidecar with NO dependence on the real .aof tree
  #      (mirrors persistNodeId's existing configPath arg at node-identity.mjs:112). If the
  #      sidecar path is hard-derived from process.cwd()/os with no injection seam, the
  #      byte-level sidecar assertions are not hermetic — keep it @executable via the arg;
  #  (b) the salt is threaded INTO the persisted sidecar object (the sidecar holds BOTH
  #      nodeId AND salt per ADR-004.1) — confirm deriveNodeId's persist writes {nodeId,
  #      salt}, not nodeId alone (today persistNodeId at :123 writes only nodeId into
  #      config.mesh; the re-point must carry salt too so self-heal (task 03) can compare).
  # RAISED — do NOT silently retag to @manual; the fresh-derive + clone-derives-own-id
  # rows must stay unit-testable over injected hostname/salt/sidecar-path fixtures. The
  # cross-OS REAL-hardware confirmation is task 04 (@manual), a DIFFERENT lane. See VERIFICATION.
  #
  # RESOLVED (developer-amigo): both sub-flags CONFIRMED — @executable stands unchanged.
  #  (a) INJECTABLE SIDECAR TARGET — YES, trivially. `deriveNodeId` already takes an
  #      injected `configPath` opt (`node-identity.mjs:73,99`: `if (configPath) { await
  #      persistNodeId(configPath, id); }`) and `persistNodeId(configPath, id)`
  #      (`node-identity.mjs:112`) takes that path as a plain arg — it never hard-derives
  #      from `process.cwd()`/`os`. The re-point is: thread an analogous `sidecarPath` arg
  #      (or a `sidecarPath` derived by the CALLER from its already-injected `aofDir` —
  #      `work.mjs:57` computes `aofDir` from the fixture project root, never a hard-coded
  #      machine path) through to a re-pointed persist call. A test plants a fixture
  #      project root, computes `sidecarPath = path.join(aofDir, "mesh", "identity.json")`
  #      itself, and passes it in — no dependence on the real `.aof` tree. Confirmed against
  #      the two real call sites that will thread it: `commands/mesh-identity.mjs:139-144`
  #      and `commands/mesh-heartbeat.mjs:78-83` both already pass `configPath: ws.configPath`
  #      — the same shape swaps in `sidecarPath` computed from `ws.aofDir`.
  #  (b) SALT MUST TRAVEL TO THE SIDECAR — CONFIRMED GAP, minimal fix stated. Today
  #      `persistNodeId` (`node-identity.mjs:112-125`) writes `config.mesh.nodeId = id`
  #      ONLY (line 123) — `salt` is a SEPARATE persist, done independently by
  #      `resolveInstallSalt(configPath, config)` (`commands/mesh-identity.mjs:98-114`),
  #      which read-merge-writes `config.mesh.salt` into the COMMITTED file today (line
  #      110-111). The re-point must carry BOTH: the sidecar-targeted persist writes
  #      `{ nodeId, salt }` in one read-merge-write (not `nodeId` alone), so `resolveInstallSalt`
  #      is ALSO re-pointed to read/write the sidecar's `salt` key, not the committed
  #      config's. Minimal change: `persistNodeId(sidecarPath, id, salt)` — read the
  #      sidecar (`readJson`, empty-object on ENOENT/parse-fail — the SAME catch idiom
  #      already at `node-identity.mjs:113-118`), set `sidecar.nodeId = id; sidecar.salt =
  #      salt;` (skip the write when both are already byte-equal — preserves the existing
  #      no-rewrite idempotence at line 122), `writeText` 2-space + trailing `\n` (the
  #      identical `fs.mjs` idiom, `readJson`/`writeText` at `fs.mjs:5,14`). This keeps the
  #      SAME read-merge-write idiom, just re-pointed at the sidecar path and widened to
  #      the two-key `{nodeId,salt}` object task 03's self-heal compares against. The
  #      committed-config codepath (`resolveInstallSalt`'s current write) is retired in the
  #      same change — it must not keep writing `mesh.salt` into the committed file, or the
  #      "committed config byte-unchanged" scenarios in this feature go RED.
  Background:
    Given a fixture aof project whose committed config path and git-ignored sidecar path .aof/mesh/identity.json I control
    And the committed config carries NO mesh.nodeId and NO mesh.salt (a fresh install)
    And a fixed install salt "fixed-salt-A" injected into the derive
    And no sidecar file exists yet at .aof/mesh/identity.json

  # FRESH DERIVE PERSISTS TO THE SIDECAR, LEAVES COMMITTED CONFIG BYTE-UNCHANGED
  # (ADR-004.2/.3): a first derive on a fresh install sanitizes THIS machine's hostname,
  # writes { nodeId, salt } to the sidecar, and does NOT touch the committed config —
  # the exact re-point (persist target: committed config.mesh.nodeId → the sidecar).
  Scenario: a fresh install derives from its own hostname and persists nodeId+salt to the sidecar, committed config byte-unchanged
    Given the committed config's exact bytes on disk are recorded
    And an injected hostname "umairs-msi"
    When I deriveNodeId with the injected hostname, salt, and the sidecar target
    Then the returned id is "umairs-msi"
    And the sidecar .aof/mesh/identity.json exists and holds exactly { nodeId:"umairs-msi", salt:"fixed-salt-A" }
    And the committed config file is byte-identical to the recorded bytes (no nodeId, no salt written there)

  # HOSTNAME SANITIZATION MATRIX (ADR-004.2; node-identity.mjs:38-49 driven through the
  # INJECTED hostname): the persisted sidecar nodeId is sanitizeHostname(hostname) —
  # lowercased, every run of non-[a-z0-9-] collapsed to one "-", leading/trailing "-"
  # trimmed. An all-illegal hostname sanitizes to "" and falls back to node-<installHash(salt)>.
  # installHash("fixed-salt-A") is a fixed 4-hex stem (node-identity.mjs:56-58) — the
  # empty-stem row asserts the node-<hash> shape deterministically off the fixed salt.
  Scenario Outline: the sidecar's persisted nodeId is the sanitized hostname (empty stem → node-<installHash(salt)>)
    Given an injected hostname "<hostname>"
    When I deriveNodeId with the injected hostname, salt "fixed-salt-A", and the sidecar target
    Then the sidecar .aof/mesh/identity.json holds nodeId "<nodeId>"
    And the sidecar's nodeId matches /^[a-z0-9-]+$/ (path-safe, no illegal chars)
    And the committed config is left byte-unchanged (no nodeId, no salt)

    Examples:
      | hostname            | nodeId                             |
      | umairs-msi          | umairs-msi                         |
      | MacBook-Pro.local   | macbook-pro-local                  |
      | Umair's MacBook     | umair-s-macbook                    |
      | umair--__--desktop  | umair-desktop                      |
      | ---trim-me---       | trim-me                            |
      | HOST_42             | host-42                            |
      | !!!@@@###           | node-<installHash("fixed-salt-A")> |
      | ""                  | node-<installHash("fixed-salt-A")> |

  # CLONE DERIVES ITS OWN DISTINCT ID — THE F-3203 FIX (ADR-004.2): two installs of the
  # SAME repo (same committed config, which carries NO pinned nodeId post-migration) on
  # two DIFFERENT hostnames each persist their OWN distinct sidecar id under their OWN
  # hostname. The origin's id never travels — the inherited-id bug is fixed. Each writes
  # to its OWN sidecar (a per-install path), so neither clobbers the other's identity.
  Scenario Outline: a clone on a different host derives its own distinct sidecar id (the inherited-id bug fixed)
    Given the committed config carries no pinned mesh.nodeId (a clone of a migrated repo)
    And an injected hostname "<hostname>" for this clone
    When I deriveNodeId with the injected hostname, salt "<salt>", and this clone's own sidecar target
    Then this clone's sidecar holds nodeId "<nodeId>"
    And the id is NOT the origin machine's id "umairs-msi" (identity was not inherited)

    Examples:
      | hostname        | salt          | nodeId          |
      | macbook-pro     | fixed-salt-B  | macbook-pro     |
      | build-server    | fixed-salt-C  | build-server    |
      | ci-runner-07    | fixed-salt-D  | ci-runner-07    |

  # COLLISION → STABLE PER-INSTALL SUFFIX (ADR-004.2; node-identity.mjs:90-93): if the
  # sanitized stem is already taken by a DIFFERENT install (supplied via takenIds — the
  # synced roster), the persisted id appends the stable installHash(salt) suffix, so two
  # same-host installs with DISTINCT salts get DISTINCT ids and each is stable across
  # re-derivation. The suffix is deterministic from the injected salt (byte-assertable).
  Scenario: two same-host installs with distinct salts persist distinct suffixed sidecar ids
    Given the sanitized stem "shared-host" is already taken by another install in the roster
    And an injected hostname "shared-host"
    When I deriveNodeId with salt "fixed-salt-A", the taken roster, and the sidecar target
    Then the sidecar holds nodeId "shared-host-<installHash("fixed-salt-A")>"
    And deriveNodeId with salt "fixed-salt-B" and the SAME taken roster yields "shared-host-<installHash("fixed-salt-B")>"
    And the two suffixed ids differ (distinct salts ⇒ distinct installs)

  # PINNED-ID PRECEDENCE PRESERVED BUT NOW PER-INSTALL (ADR-004.2; node-identity.mjs:74-78):
  # a pinned id STILL wins verbatim — but the pin now lives in the per-install sidecar, not
  # committed config, so it no longer travels on clone. A sidecar-pinned id is returned
  # verbatim (never re-derived from hostname), and the committed config stays untouched.
  Scenario: a sidecar-pinned nodeId wins verbatim and is not re-derived from the hostname
    Given the sidecar already holds a pinned nodeId "operator-choice" (per-install, not committed)
    And an injected hostname "some-other-host" that would sanitize differently
    When I deriveNodeId with the sidecar-pinned config, the injected hostname, and the sidecar target
    Then the returned id is "operator-choice" (the pin wins verbatim, never re-derived)
    And the committed config is left byte-unchanged (the pin never travels to committed config)
