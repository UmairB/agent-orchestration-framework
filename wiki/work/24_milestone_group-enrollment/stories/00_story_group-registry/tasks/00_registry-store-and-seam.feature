@cli @work @distribution @executable
Feature: src/mesh-registry.mjs is the group's single-writer git-of-record — one control-node-guarded write seam, an absence-tolerant read, an opaque round-trip
  In order to give the group a durable place to record who is admitted and what is registered, on the same git bus the per-node partition already rides
  the registry store persists the group aggregate under meshDir/registry/ through the atomic writeText seam, guards the ONE write behind the control-node predicate, and reads back byte-equivalent — an absent registry reading as an empty one, never a throw,
  so that the control node is the sole writer of an add-only, merge-clean group artifact, a non-authority invocation is a structured no-op rather than a rogue write, and a peer (or the fleet view in m25) reads the roster back exactly as it was written.

  # ARCHITECTURE ADR-001: the group registry is the group-level, control-node-owned
  # SINGLE-WRITER second git-of-record — a NEW src/mesh-registry.mjs beside the
  # mesh-store spine (22/ADR-002), holding the aggregate under meshDir/registry/ so it
  # syncs over the 22/ADR-004 payload-agnostic engine UNCHANGED, persisted OPAQUE / AS-IS
  # through the atomic writeText temp+rename seam (19/R2) that publishNodeRecord uses.
  # This feature asserts the OBSERVABLE store contract — the opaque round-trip (an unknown
  # additive top-level key survives), the ENOENT→absent empty-registry read, the
  # control-node write-guard as a truth table (writes on the authority, structured no-op
  # off it), the under-.mesh/ write scope, and the atomic-write property. The SOURCE-LEVEL
  # invariant — that writeRegistry is the SINGLE registry write seam, control-node-guarded,
  # joining the registryPath/meshDir partition, referencing zero record-doc filename, with
  # NO OTHER src/** module writing registry/ — is the acd-registry-write-scope ARCH-TEST,
  # NOT a scenario here. The codeHash crypto (hashed-at-rest) is the security-owned
  # acd-enrollment-code-hashed-at-rest fitness; this feature treats codeHash as an OPAQUE
  # string (its durable SHAPE is task 02's, its hashing is SECURITY.md's).
  #
  # QA FEASIBILITY FLAG (developer-amigo): white-box over the store module — import
  # writeRegistry / readRegistry / registryDir / registryPath DIRECTLY over a workspace
  # fixture I control (a temp workDir), with a config carrying an INJECTED
  # config.mesh.relay.controlNode / config.mesh.nodeId pair (matching → control node;
  # mismatched → a non-authority node). No relay, no git, no credential — this is the
  # DEPENDENCY ROOT, buildable STANDALONE (the role src/mesh-store.mjs plays for the
  # per-node dimension). The control-node truth table is driven by the two injected config
  # values, never a live relay. Time/identity are INJECTED (admittedAt etc. are values, not
  # wall-clock — the 22/R2 discipline). Buildable @executable; no feasibility concern RAISED.
  Background:
    Given a workspace fixture whose workDir is a temp directory I control
    And the mesh-registry store module (writeRegistry / readRegistry / registryDir / registryPath)
    And a config carrying an injected config.mesh.nodeId and config.mesh.relay.controlNode (white-box over the control-node predicate)

  # The opaque round-trip: writeRegistry persists a registry through the atomic writeText
  # seam under meshDir/registry/, and readRegistry reads it back byte-equivalent — the
  # store never interprets a registry beyond the fields it reads, so an UNKNOWN additive
  # top-level key survives (the 22/ADR-003 additive-friendly, opaque-persist discipline
  # publishNodeRecord holds). R4: the round-trip is loss-free — nothing the writer put in
  # is dropped, reshaped, or key-reordered by the reader.
  Scenario: writeRegistry persists under meshDir/registry/ and readRegistry reads it back byte-equivalent, an unknown additive key surviving
    Given a registry with roster, boards, pending, and revocations plus an unknown additive top-level key "futureField"
    And the invocation is on the nominated control node (controlNode === nodeId)
    When I writeRegistry that registry and then readRegistry it back
    Then the read registry equals the written registry byte-equivalent (roster, boards, pending, revocations preserved)
    And the unknown additive top-level key "futureField" survives the round-trip unchanged
    And the persisted file lives under meshDir/registry/ (registryPath joins the partition root)

  # Absence-tolerant read: a workspace with NO registry file yet reads as an EMPTY registry
  # — the ENOENT→absent discipline readNodeRecord holds (a peer not yet synced is not an
  # error). R4: pin the SHAPE of "empty" exactly — the four lists are present and empty, so
  # a caller (an accessor, the endpoint) can read them without a null guard, and NO error is
  # raised.
  Scenario: readRegistry on a workspace with no registry file yet returns an empty registry, never a throw
    Given a workspace whose meshDir/registry/ has no registry file yet
    When I readRegistry that workspace
    Then the result is an empty registry with roster [], boards [], pending [], and revocations []
    And no error is raised (absence is benign, not a throw — the ENOENT→absent discipline)

  # The single-writer guard as a truth table: writeRegistry writes ONLY on the nominated
  # control node (controlNode === nodeId). On a NON-control node it is a STRUCTURED NO-OP —
  # it writes nothing (no rogue write, the m22 multi-writer hazard is not re-opened) and it
  # does NOT throw (a non-authority invocation is benign, not an error). This is the
  # observable half of the acd-registry-write-scope single-writer invariant.
  # R4: on the no-op row, pin the UNAFFECTED side hard — the registry file that already
  # existed is BYTE-UNCHANGED after the non-authority write attempt (the non-control node
  # neither creates nor mutates it).
  Scenario Outline: writeRegistry writes only on the control node and is a structured no-op off it
    Given a config whose control-node predicate resolves to <node role> (controlNode === nodeId is <predicate>)
    And a pre-existing registry file on disk whose bytes I record
    When I writeRegistry a changed registry on that node
    Then the registry file <writes> reflect the changed registry
    And the invocation raises no error (a non-authority write is a structured no-op, not a throw)
    And when the node is not the control node the pre-existing registry file is byte-unchanged

    Examples:
      | node role        | predicate | writes    |
      | control node     | true      | does      |
      | non-control node | false     | does not  |

  # The write scope lives UNDER .mesh/ — registryPath joins meshDir/registry/, so the
  # registry rides the m23-landed .gitignore wiki/work/.mesh/ (22/R4) + .gitattributes
  # **/.mesh/** eol=lf (22/R5) pins with NO new pin owed (ADR-001 decision 4). R4: pin the
  # UNAFFECTED side hard — a writeRegistry writes NO file OUTSIDE .mesh/ (nothing at the
  # workDir root, no .aof/ sidecar); the ONLY path touched is under meshDir/registry/.
  Scenario: the registry write touches only meshDir/registry/ and writes no file outside .mesh/
    Given the invocation is on the nominated control node
    And I record the on-disk state of the workspace OUTSIDE meshDir
    When I writeRegistry a registry
    Then the only file created or modified is under meshDir/registry/
    And no file was written outside .mesh/ (no workDir-root file, no .aof/ sidecar)
    And the workspace state outside meshDir is byte-unchanged (the registry rides the m22/R4 + m22/R5 pins, no new pin owed)

  # The write is ATOMIC (temp+rename via writeText, 19/R2): a failed or interrupted write
  # never leaves a truncated / partially-written registry on disk. R4: pin the UNAFFECTED
  # side — a reader that runs against a workspace where a write was interrupted reads EITHER
  # the prior complete registry OR the new complete one, never a half-written file (the
  # temp+rename seam is all-or-nothing).
  Scenario: writeRegistry is atomic — an interrupted write never leaves a truncated registry
    Given a workspace with a prior complete registry on disk on the control node
    When a writeRegistry is interrupted after the temp file is written but before the rename completes
    Then the on-disk registry is the prior complete registry (the rename never happened)
    And readRegistry returns a complete, parseable registry (never a truncated file)
    And the write went through the atomic writeText temp+rename seam (not a bare writeFile)
