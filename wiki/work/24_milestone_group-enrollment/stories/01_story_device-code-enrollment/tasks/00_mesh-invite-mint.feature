@cli @work @distribution @executable
Feature: aof mesh invite mints a short-lived single-use 6-digit code, records it HASHED as a pending invite, and returns the plaintext once
  In order to hand a fresh machine one 6-digit code that admits it to the fleet — without minting a durable plaintext secret into git
  the control-node-only mesh:invite command generates a 6-digit numeric code, appends a pending invite { codeHash, issuedAt, expiresAt, consumedAt:null } to the registry via story 00's writeRegistry, and returns the plaintext code to the operator ONCE in the result,
  so that the operator reads the code aloud / pastes it into join, the durable record carries only the hash (never the plaintext), the invite expires after resolveCodeTtlSeconds, and a non-control node cannot mint at all.

  # ARCHITECTURE ADR-002 (move 1) + ADR-005 (resolveCodeTtlSeconds): mesh:invite is a registered
  # command-core command, control-node-guarded by the relayMode predicate
  # (config.mesh.relay.controlNode === config.mesh.nodeId), that mints a 6-digit code, HASHES it,
  # and appends a pending invite { codeHash, issuedAt, expiresAt, consumedAt:null } to the registry
  # through story 00's single writeRegistry seam, returning the plaintext code ONCE in the --json
  # result. This feature asserts the OBSERVABLE mint behaviour: the returned plaintext code shape,
  # the durable pending record's SHAPE (codeHash present, no plaintext field), the TTL arithmetic
  # over an INJECTED issuedAt (never wall-clock — the 22/R2 discipline), the control-node refusal
  # with a byte-unchanged registry (R4), and the 6-digit length. The code-hash CRYPTO (the algorithm,
  # salting, the fact that codeHash is a hash and not the plaintext) is the SECURITY-owned
  # acd-enrollment-code-hashed-at-rest fitness — treat the hash as OPAQUE here: assert codeHash is
  # PRESENT and no plaintext code field is persisted, NOT the algorithm. The single-write-seam +
  # control-node write-scope is the STRUCTURAL acd-registry-write-scope fitness (story 00) — NOT a
  # scenario here (the write-scope invariant is a source-grep, not a behaviour). The --json bijection
  # (mesh:invite --json runs clean + parseable) rides the EXISTING acd-mesh-command-cli-bijection
  # gate — asserted below only as the observable "runs clean + parseable", not restated as a gate.
  #
  # QA FEASIBILITY FLAG (developer-amigo): white-box over mesh:invite in the command core, with an
  # INJECTED issuedAt and a config seeded WITH / WITHOUT the controlNode match (relayMode true/false),
  # the registry seeded + read via story 00's writeRegistry/readRegistry over a fixture workspace. The
  # 6-digit code + its hash are minted in-process (no spawn, no relay, no network — invite is a pure
  # registry write on the control node). Treat the hash as OPAQUE: assert codeHash present + no
  # plaintext field on the persisted record, NOT the hash algorithm (that is the security fitness).
  # The TTL is asserted over the INJECTED issuedAt, never Date.now(). Buildable @executable in-process
  # — do NOT retag to @manual.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And the group registry seeded + read via story 00's writeRegistry / readRegistry over that fixture
    And mesh:invite accepts an injected "issuedAt" and reads config as I seed it (white-box over the mint inputs)

  # The headline mint: on the control node, mesh:invite generates a 6-digit numeric code, appends a
  # pending invite through story 00's writeRegistry, and RETURNS the plaintext code once in the --json
  # result. R4: pin the UNAFFECTED side — the roster / boards / revocations sub-arrays are untouched;
  # only the pending list grows by exactly one entry.
  Scenario: mesh:invite on the control node mints a 6-digit code, appends a pending invite, and returns the plaintext once
    Given config makes this node the control node (config.mesh.relay.controlNode === config.mesh.nodeId)
    When I invoke mesh:invite with an injected issuedAt
    Then the --json result carries a 6-digit numeric plaintext code returned once
    And the registry's pending list has grown by exactly one entry
    And that pending entry is { codeHash, issuedAt, expiresAt, consumedAt:null } (consumedAt is null — unconsumed)
    And the roster, boards, and revocations lists are byte-unchanged (only the pending list grew)

  # Hashed-at-rest SHAPE (the structural half of T3; the crypto is security-owned). The DURABLE
  # pending record carries codeHash, and the plaintext code returned in the result is NEVER written to
  # the registry — no bare code / deviceCode / plaintext field survives on the persisted record. This
  # asserts the SHAPE (a codeHash field is present; no plaintext-code field is present), treating the
  # hash value itself as OPAQUE — the acd-enrollment-code-hashed-at-rest arch-test owns the crypto.
  Scenario: the durable pending record carries codeHash, not the plaintext code
    Given config makes this node the control node
    When I invoke mesh:invite with an injected issuedAt and read the persisted registry back
    Then the persisted pending entry carries a codeHash field
    And the persisted pending entry carries NO plaintext code field (no code / deviceCode / plaintext key)
    And the plaintext code exists ONLY in the returned result, never on the durable record

  # The TTL arithmetic over an INJECTED issuedAt (never wall-clock — the 22/R2 discipline). The
  # pending entry's expiresAt is exactly issuedAt + resolveCodeTtlSeconds(config); with no configured
  # override the documented default 300s is in force, and a configured override shifts expiresAt by
  # exactly that many seconds. Injected issuedAt, so the arithmetic is deterministic.
  Scenario Outline: expiresAt is issuedAt + resolveCodeTtlSeconds over the injected issuedAt
    Given config makes this node the control node
    And config.mesh.enrollment.codeTtlSeconds is <configured>
    When I invoke mesh:invite with an injected issuedAt
    Then the ttl in force is <ttlSeconds> seconds
    And the pending entry's expiresAt equals issuedAt plus <ttlSeconds> seconds
    And the pending entry's issuedAt equals the injected issuedAt

    Examples:
      | configured        | ttlSeconds |
      | absent (unset)    | 300        |
      | 600               | 600        |
      | 60                | 60         |

  # Control-node guard (relayMode): on a NON-control node mesh:invite REFUSES — a structured error,
  # NO code minted, NO registry write. R4: pin the UNAFFECTED side hard — the registry file is
  # BYTE-UNCHANGED across the refused invocation (no pending entry appended, nothing written), and the
  # result carries no plaintext code.
  Scenario: mesh:invite on a NON-control node refuses and writes nothing
    Given config does NOT make this node the control node (config.mesh.relay.controlNode !== config.mesh.nodeId)
    And I record the registry file's on-disk state
    When I invoke mesh:invite with an injected issuedAt
    Then the result is a structured error (a non-authority node cannot mint an invite)
    And no plaintext code is returned
    And the registry file is byte-unchanged from before the invocation (no pending entry appended, nothing written)

  # The code length is 6 digits — the 10^6 space (SECURITY.md T2; the length is the security call).
  # The minted code matches exactly six decimal digits and nothing else (no letters, no separators).
  Scenario: the minted code is exactly 6 numeric digits (the 10^6 space)
    Given config makes this node the control node
    When I invoke mesh:invite with an injected issuedAt
    Then the returned plaintext code is exactly 6 characters
    And every character of the returned code is a decimal digit (the 10^6 code space)

  # The bijection observable (22/R1): mesh:invite --json runs clean + parseable — the cli adapter +
  # the argsFor case are added in the SAME change (the acd-mesh-command-cli-bijection gate throws on
  # an unmapped sub, so the adapter + argsFor must land together). This asserts the OBSERVABLE, not
  # the gate itself (the gate is an arch-test).
  Scenario: mesh:invite --json runs clean and parseable (rides the existing bijection gate)
    Given config makes this node the control node
    When I run aof mesh invite --json
    Then the command exits cleanly
    And the emitted JSON parses to the invite result shape (carrying the plaintext code once)
