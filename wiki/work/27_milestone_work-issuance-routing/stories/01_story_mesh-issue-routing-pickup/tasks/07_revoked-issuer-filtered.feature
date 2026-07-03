@cli @work @distribution @executable
Feature: A directive from a revoked issuer is filtered out of routing — a revoked member cannot keep steering work via lingering git directives
  In order to close the revocation-completeness gap the new routing surface opens (SECURITY T4): a directive is a git-tracked record that outlives its issuer's membership, so a node revoked from the group must not keep routing/steering work through directives still sitting on peers' disks
  the mesh-aware next candidacy build consults the LIVE registry (isRevoked, re-read per next) and SKIPS every directive whose issuer is revoked, so a revoked issuer's directive has ZERO routing effect — it neither targets an item here nor steers it away — while a directive from a non-revoked (still-admitted) issuer routes exactly as ADR-004 specifies,
  so that revocation is complete across the issuance surface (the 24/T6 explicit-deny extended to routing), a de-provisioned member cannot resurrect its influence through a stale directive, and the filter fails SAFE (a revoked directive is ignored, never honoured).

  # ARCHITECTURE ADR-004 (the unified candidacy view built in src/commands/next.mjs under the
  # config.mesh.nodeId gate) + ADR-001 (the directive record — its `issuer` is the partition owner
  # and the identity the revocation list denies) + SECURITY.md T4 / R (the revoked-issuer routing
  # filter, adopted as a v1 control, NOT deferred) + 24/ADR-004 (isRevoked — the m24 revocation
  # list is the explicit deny the auth-gate already honours; here the SAME predicate gates routing).
  #   - the candidacy build reads the LIVE registry (readRegistry → isRevoked) each next, exactly as
  #     the relay auth-gate re-reads it per connect (24/ADR-004) — never a serve-start snapshot — so a
  #     node revoked AFTER it issued is filtered on the peer's NEXT next;
  #   - a directive whose `issuer` is revoked is dropped BEFORE nodeSatisfiesTarget ever sees it, so
  #     it contributes NO candidacy verdict (it cannot skip an item away from a node, and it cannot
  #     mark an item targeted-here) — the item behaves as if that directive does not exist;
  #   - the filter is fail-SAFE: an ambiguous/absent registry read leaves the NON-revoked directives
  #     routing normally (a missing registry ⇒ nobody is revoked ⇒ every directive is live), and a
  #     revoked directive is ignored, never honoured (a revoked member never GAINS routing power).
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - security fitness S-2 (acd-issuance-revoked-issuer-filtered, test/arch/, already on the tree) is
  #    the STRUCTURAL lock: it greps that the candidacy build in commands/next.mjs consults isRevoked
  #    (the registry) — a source assertion, NOT a scenario here. It goes RED on a planted
  #    revocation-blind filter.
  #  - THIS feature asserts the OBSERVABLE outcome that structure produces: a revoked issuer's
  #    directive changes NOTHING about which node next offers the item to, while a non-revoked
  #    issuer's directive routes normally.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the revoked-issuer filter is @executable ONLY if the
  # candidacy build reads the group registry as PLAIN DATA off the local tree (readRegistry, absence-
  # tolerant) alongside the directive read, so a fixture can plant a revocation record and drive the
  # skip deterministically over local git fixtures — no relay, no live control node. RAISED.
  #
  # RESOLVED (developer-amigo, folded from the story-01 feasibility pass): CONFIRMED @executable — the
  # candidacy build in commands/next.mjs already reads the local tree as data (readIssuanceDirectives
  # + readNodeRecords under the config gate); adding readRegistry(ws) → isRevoked(registry, issuer)
  # (src/mesh-registry.mjs, absence-tolerant ENOENT→emptyRegistry) as a pre-filter on the directive
  # list is the SAME plain-data-off-disk shape, driven by a fixture that writes a revocation record
  # via appendRevocation. The S-2 arch-test (already on the tree) locks the isRevoked consultation
  # structurally; this feature drives the behaviour over the m26 two-clone / single-workspace fixtures.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And mesh is configured with a stable config.mesh.nodeId for this node
    And a synced group registry and node descriptors I write directly

  # BASELINE — a non-revoked issuer routes normally (ADR-004): the control against which the revoked
  # case is judged. A directive from a still-admitted issuer targets/steers exactly as task 02 asserts.
  Scenario: a directive from a non-revoked (admitted) issuer routes normally
    Given "node-a" is an admitted, non-revoked group member
    And node-a issued "27/00" targeted at { kind:"node", nodeId:"build-server" }
    When "build-server" runs work next
    Then "27/00" is offered on build-server (the target is satisfied — routed normally)
    And when a non-target node runs work next, "27/00" is skipped (targeted elsewhere)

  # THE REVOKED ISSUER'S DIRECTIVE IS IGNORED (SECURITY T4 / S-2): once node-a is revoked, its
  # lingering directive contributes NO candidacy verdict — it can neither target "27/00" to
  # build-server nor steer it away from anyone. The item behaves as if the directive does not exist.
  Scenario: a directive whose issuer has been revoked contributes no routing verdict
    Given "node-a" issued "27/00" targeted at { kind:"node", nodeId:"build-server" }
    And "node-a" is then REVOKED in the group registry (appendRevocation)
    When "build-server" runs work next
    Then the revoked directive does NOT mark "27/00" targeted-here (it is filtered before the matcher)
    And when a non-target node runs work next, "27/00" is NOT skipped by the revoked directive (it is offered in its normal walk position — the revoked directive steers nothing)
    And the revoked issuer has gained no routing influence over "27/00"

  # LIVE re-read (24/ADR-004 discipline): the candidacy build reads the registry each next, so a node
  # revoked AFTER it issued is filtered on the very next next — never a stale serve-start snapshot.
  Scenario: a node revoked after it issued is filtered on the next work next
    Given "node-a" issued "27/01" targeted at { kind:"capability", value:"codex" } while still admitted
    And a codex-capable peer would be offered "27/01" before any revocation
    When "node-a" is revoked and the codex-capable peer runs work next again
    Then "27/01" is no longer routed by node-a's directive (the live registry read drops it)

  # FAIL-SAFE (the never-honour-a-revoked-directive direction): the filter only ever REMOVES a
  # revoked issuer's routing power — it never grants one, and a missing/absent registry (nobody
  # revoked) leaves every directive routing normally, so the filter degrades safe.
  Scenario Outline: the revoked-issuer filter fails safe — it removes power, never grants it
    Given a directive for "27/02" issued by "<issuer>" targeted at { kind:"any" }
    And the group registry's revocation state is "<registry>"
    When an eligible node runs work next
    Then "27/02" is "<offered>" by that directive

    Examples:
      | issuer | registry                       | offered      |
      | node-a | node-a revoked                 | not offered  |
      | node-a | no revocations                 | offered      |
      | node-a | registry absent (ENOENT→empty) | offered      |
      | node-b | node-a revoked (node-b admitted) | offered     |
