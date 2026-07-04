@manual @cli @work @distribution @bug @finding-F-3203
Feature: two real machines (Windows + macOS) cloned from one shared remote derive DISTINCT nodeIds from their own hostnames and publish to distinct nodes/<id>.json partition paths — neither clobbers the other (the exact F-3203 scenario, confirmed on real hosts)
  In order to confirm on real cross-OS hardware that the per-install identity split actually fixes F-3203 (the macOS node deriving umairs-msi off inherited committed config)
  two machines — one Windows, one macOS — each clone the SAME shared remote and each, from its OWN hostname, derives a DISTINCT nodeId persisted to its OWN git-ignored sidecar, publishing to DISTINCT nodes/<id>.json partition paths so neither clobbers the other,
  so that the m22 one-node-per-path partition invariant (acd-mesh-partition-write) is confirmed to hold on real hardware and the UAT 32 F-3203 finding can be re-run and closed.

  # ARCHITECTURE ADR-004 (the whole per-install identity split — this is its real-hardware
  # confirmation) + ADR-004.5 (self-heal, for the copied-.aof variant). This lane exists
  # BECAUSE the units (tasks 00-03) prove the mechanics over injected hostnames/salts, but
  # the ORIGINAL F-3203 bug was only observable on two real, differently-named OSes sharing
  # one remote — the injected-hostname units cannot reproduce a real os.hostname() split.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness acd-mesh-identity-not-committed (ADR-006) guards the COMMITTED config in CI —
  #    a structural read, run in the suite, NOT here. THIS lane is a VERIFICATION-time
  #    OBSERVATION on real hosts (feeds the UAT 32 re-run), never a CI assert. The units
  #    (tasks 00-03, @executable) carry the deterministic contract; THIS lane confirms the
  #    real-machine end-to-end that no injected-fixture test can (a genuine two-OS hostname
  #    split + a genuine shared git remote).
  #
  # WHY @manual (not @executable): this requires two real, differently-named machines on
  # two real OSes (Windows + macOS) reading os.hostname() and a real shared git remote — it
  # cannot be reduced to a local fixture without becoming task 00's injected-hostname unit
  # (which already exists). It is agent-or-human-run on real hardware, the @manual contract.
  # It does NOT migrate to @executable — the units already cover the deterministic core; this
  # lane's whole value is the irreducible real-hardware observation. (It is NOT @uat: no human
  # ACCEPTANCE JUDGEMENT is required — an agent on each host runs the commands and reads the
  # observable ids; it is a mechanical cross-OS observation, run manually because the hardware is real.)
  #
  # NO Examples table: this is a single narrative run over two specific real hosts, not a
  # data-driven matrix — the two hosts ARE the two "rows", enumerated inline in the steps.
  #
  # PRECONDITION for a valid run: the shared remote's committed .aof/aof.config.json carries
  # NO mesh.nodeId and NO mesh.salt (i.e. the task-02 migration has already landed on the
  # remote). If the committed config still pins "umairs-msi", BOTH clones would inherit it
  # and this lane would REPRODUCE F-3203 rather than confirm the fix — that is the exact
  # regression signal this lane exists to catch. Record the committed config's mesh block in
  # the run notes before cloning.
  Background:
    Given a shared bare git remote holding an aof workspace whose committed config carries NO mesh.nodeId and NO mesh.salt
    And a Windows machine whose os.hostname() is a distinct Windows host name
    And a macOS machine whose os.hostname() is a distinct macOS host name
    And .aof/.gitignore ignores mesh/ on both (the sidecar is never committed by either)

  # THE F-3203 CONFIRMATION: each host clones the SAME remote, runs `aof mesh identity` to
  # derive+publish, and the two derive DISTINCT ids from their own hostnames — the macOS
  # node NO LONGER derives the Windows node's "umairs-msi". This is the direct re-run of the
  # UAT 32 F-3203 observation.
  Scenario: the Windows node and the macOS node each derive their OWN distinct nodeId from their own hostname
    Given both machines have cloned the shared remote fresh
    When I run `aof mesh identity` on the Windows machine
    And I run `aof mesh identity` on the macOS machine
    Then the Windows node's derived nodeId equals sanitizeHostname(the Windows hostname)
    And the macOS node's derived nodeId equals sanitizeHostname(the macOS hostname)
    And the two nodeIds are DISTINCT (the macOS node did not inherit the Windows node's id)
    And neither node's derived nodeId is "umairs-msi" unless that host is genuinely named so

  # THE SIDECAR IS PER-INSTALL AND UNCOMMITTED ON BOTH: each machine's identity lands in its
  # OWN git-ignored .aof/mesh/identity.json, and the committed .aof/aof.config.json on each
  # clone stays free of nodeId/salt (git status shows the sidecar ignored, the config unchanged).
  Scenario: each node's identity persists to its own git-ignored sidecar, committed config unchanged on both
    Given both nodes have run `aof mesh identity`
    Then the Windows node's .aof/mesh/identity.json holds its own nodeId+salt and is git-ignored (untracked)
    And the macOS node's .aof/mesh/identity.json holds its own distinct nodeId+salt and is git-ignored
    And on both machines `git status` shows .aof/aof.config.json unmodified (no nodeId/salt written to committed config)

  # THE PARTITION INVARIANT HOLDS ON REAL HARDWARE (acd-mesh-partition-write restored): after
  # both nodes publish and sync, each owns a DISTINCT nodes/<id>.json partition path in the
  # synced mesh tree — neither overwrites the other. This is the invariant F-3203 broke,
  # confirmed restored on real hosts.
  Scenario: the two nodes publish to distinct nodes/<id>.json partition paths — neither clobbers the other
    Given both nodes have run `aof mesh identity` and synced to the shared remote
    When I inspect the synced .aof/mesh/nodes/ tree from either machine
    Then there are TWO distinct node records: nodes/<windows-id>.json and nodes/<macos-id>.json
    And each record's nodeId matches its own machine's hostname-derived id
    And neither record was overwritten by the other node's publish (both descriptors coexist)

  # THE COPIED-.aof SELF-HEAL VARIANT (ADR-004.5, the copy symptom on real hardware): if an
  # operator copies the WHOLE .aof tree (sidecar included) from Windows to macOS, the macOS
  # node's next identity resolve self-heals — re-derives from the macOS hostname — so even a
  # whole-tree copy does not leave the two machines sharing "umairs-msi".
  Scenario: copying the whole .aof tree (sidecar included) from Windows to macOS self-heals on the macOS host
    Given the Windows node has published and its .aof/mesh/identity.json holds the Windows id
    And I copy the ENTIRE .aof tree (including .aof/mesh/identity.json) from Windows to the macOS machine
    When I run `aof mesh identity` on the macOS machine
    Then the copied sidecar self-heals: the macOS node re-derives its nodeId from the macOS hostname
    And the macOS node's resulting nodeId is DISTINCT from the Windows id (no shared identity survived the copy)
