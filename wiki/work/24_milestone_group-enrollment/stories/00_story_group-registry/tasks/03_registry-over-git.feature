@cli @work @distribution @manual
Feature: the group registry reaches a peer purely over git — the control node writes it, a peer reads the roster back, carried by the payload-agnostic sync engine unchanged
  In order to prove the group's second git-of-record is a real durable stream a peer reads over git alone, with the relay killed
  the control node writes the registry and syncs over a shared git remote while a peer clone syncs and reads the roster / boards back — carried by the milestone-22 payload-agnostic sync engine with zero engine change, landing byte-identical under the peer's partition,
  so that the registry moves to a peer through git ALONE (PRD §7.3 "two levels of git-of-record"), the single-writer property means the peer never three-way-merges it, and correctness never depends on a relay.

  # ARCHITECTURE ADR-001 (decision 2 — the registry lives under meshDir/registry/ so it
  # syncs over the 22/ADR-004 payload-agnostic engine UNCHANGED) + PRD §7.3 ("two levels of
  # git-of-record"; "the group gets its own small durable registry … naturally another
  # lightweight git stream of record"). This is the OUTSIDER-VERIFIABLE over-git acceptance:
  # the control node writes the registry + syncs; a peer clone over a shared bare remote
  # syncs and reads the roster / boards back — purely over git, NO relay. The registry is
  # SINGLE-WRITER (only the control node writes it, ADR-001 decision 1), so a peer never
  # three-way-merges it — the property that resolves 22/ADR-002's no-aggregate-roster
  # tension. The relay auth-gate (story 02) and the device-flow endpoint (story 01) are out
  # of scope here; this is the GIT-ONLY registry floor. Agent-run; evidence in
  # VERIFICATION.md. Mirrors the m23 presence-over-git @manual precedent.
  #
  # QA FEASIBILITY FLAG — RESOLVED (developer-amigo seat, Contract): STAYS @manual. Every
  # scenario drives REAL git over a bare-remote fixture (init / commit / pull / push + a real
  # second clone) and needs a committable identity (user.name / user.email) in CI. It ALSO
  # crosses the CRLF hazard (22/R5): the peer's checked-out registry may arrive CRLF under
  # autocrlf=true on a mixed-OS fleet, which would break the "byte-identical under the peer's
  # partition" assertion. RESOLUTION: the .gitattributes **/.mesh/** eol=lf pin (22/R5,
  # landed m23) is the STRUCTURAL fix that makes the byte-identity assertions SOUND (it forces
  # LF on the checked-out registry regardless of autocrlf), but the pin does NOT make the
  # genuine two-clone fleet render reliably @executable — it STAYS @manual, mirroring the
  # milestone-23 presence-over-git precedent (the real over-remote end-to-end read stayed
  # @manual there) and honouring the 22/R3 Windows-spawn-flake caution. Agent-run; evidence
  # in VERIFICATION.md. Tag UNCHANGED at @manual.
  Background:
    Given a control node and a peer — two clones of one work stream over a shared bare git remote I control
    And the mesh commands registered in the command core on both clones
    And the control node is the nominated single writer (controlNode === its nodeId) and the peer is not
    And no relay is configured or running (the git-only floor)

  # The over-git acceptance: the control node writes the registry + syncs; the peer clone
  # syncs and reads the roster / boards back — purely over git, no relay. R4: pin that the
  # read was git-only (no relay was used — the registry is a durable git stream, not a live
  # broadcast).
  Scenario: the peer reads the roster and boards back purely over git after the control node writes and syncs
    Given the control node has admitted node "node-a" to the roster and registered board "board-x"
    When the control node writes the registry and runs mesh:sync
    And the peer runs mesh:sync
    And the peer reads the registry back
    Then the peer's roster lists "node-a" with its admittedAt and boards
    And the peer's boards list contains "board-x"
    And no relay was used (the read was purely over git)

  # The m22 sync engine carries the NEW registry record type with ZERO engine change — the
  # payload-agnostic property (22/ADR-004) re-confirmed: the engine stages meshDir + moves
  # the file as bytes without parsing it, so the registry (a record type the engine has never
  # seen) syncs unchanged. R4: pin that the engine was NEITHER changed NOR needed a
  # registry-specific path (the registry is just another meshDir file).
  Scenario: the milestone-22 sync engine carries the registry record with zero engine change
    When the control node writes the registry and runs mesh:sync
    And the peer runs mesh:sync
    Then the registry file is present under the peer's meshDir/registry/ partition
    And the sync engine was not modified to carry the registry (it moved the new record type unchanged)
    And the engine needed no registry-specific code path (it staged meshDir and moved the file as bytes)

  # The registry lands BYTE-IDENTICAL under the peer's partition — subject to the
  # .gitattributes **/.mesh/** eol=lf pin (22/R5, landed m23) that forces LF regardless of
  # autocrlf. R4: pin BOTH that the file arrives AND that its bytes match what the control
  # node wrote (the pin makes byte-identity sound across the mixed-OS fleet).
  Scenario: the registry lands byte-identical under the peer's partition, subject to the EOL pin
    When the control node writes the registry and runs mesh:sync
    And the peer runs mesh:sync
    Then the registry under the peer's meshDir/registry/ is byte-identical to what the control node wrote (subject to the .gitattributes .mesh/** eol=lf pin, 22/R5)
    And the roster, boards, pending, and revocations the peer reads equal what the control node wrote

  # Single-writer ⇒ add-only merge: ONLY the control node writes the registry, so a peer
  # never three-way-merges it — the property that resolves 22/ADR-002's no-aggregate-roster
  # tension (a multi-writer roster would force a content merge git cannot do add-only).
  # R4: pin BOTH sides — a peer that concurrently changes its OWN per-node records and then
  # pulls the registry lands the registry add-only (the peer never wrote registry/, so there
  # is nothing to conflict), and the peer's own records are byte-unchanged by the registry
  # pull.
  Scenario: the peer pulls the single-writer registry add-only, never a three-way merge
    Given the control node has written a registry and the peer has changed only its own per-node records
    And I record the on-disk bytes of the peer's own per-node records
    When the control node runs mesh:sync and the peer runs mesh:sync and pulls
    Then the registry lands under the peer's partition with no three-way merge and no conflict (the peer never wrote registry/)
    And the peer's own per-node records are byte-unchanged by the registry pull
    And only the control node ever wrote the registry (the single-writer add-only property, 22/ADR-002 tension resolved)
