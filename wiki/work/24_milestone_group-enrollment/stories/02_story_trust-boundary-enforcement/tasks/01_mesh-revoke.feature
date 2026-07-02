@cli @work @distribution @executable
Feature: aof mesh revoke <node> removes the node from the roster, records a revocation, and de-provisions its git-remote — after it, the relay auth-gate rejects that node's credential
  In order to remove a compromised or retired node as a single durable authority act — the credential-revocation flow PRD §7.4 A3 flags as "needing care"
  a registered mesh:revoke command (control-node-guarded) removes the node from the registry roster + appends a revocation { nodeId, revokedAt, reason } via story 00's writeRegistry, and de-provisions its git-remote via spawnSync("git", ["remote","remove",name]) — the shell-less argv idiom,
  so that after a revoke the auth-gate (task 00) rejects that node's credential on its next connect (the loop story 01 opened closes), a non-authority invocation refuses, and other peers' roster/revocation entries are untouched.

  # ARCHITECTURE ADR-004: mesh:revoke removes from roster + appends a revocation + de-provisions
  # git-remote, control-node-guarded (the relayMode predicate — revocation is an authority
  # decision); the auth-gate (ADR-003, task 00) rejects a revoked credential reading the LIVE
  # revocation list. SECURITY T6 (revocation completeness — a revoked node loses BOTH relay
  # AND git-remote). The de-provision re-uses the 13/ADR-002 shell-less git-argv idiom
  # (spawnSync("git", […]) — the mesh-sync.mjs git(cwd, args) precedent, NEVER a shell string).
  # This feature asserts the OBSERVABLE revoke behaviour — the roster removal + revocation
  # append in one authority act, the git remote remove via the argv form, the auth-gate now
  # rejecting the revoked node (reusing task 00's in-process serveRelay), the control-node
  # refusal on a non-authority node, and the targeted (add-only, peers-untouched) write. The
  # SOURCE-LEVEL invariants — that every enrollment git spawn (incl. this de-provision) is the
  # shell-less spawnSync("git", […]) argv form (acd-enroll-git-argv-no-shell) and that
  # writeRegistry is the SINGLE control-node-guarded registry write seam
  # (acd-registry-write-scope) — are ARCH-TESTS, NOT scenarios here; the auth-gate enforcement
  # (the gate CHECKS the live revocation) is the security-owned acd-relay-auth-gate-checked
  # fitness. The bijection (a mesh:* verb rides the existing gate) is the
  # acd-mesh-command-cli-bijection ARCH-TEST — this feature only exercises the --json face.
  #
  # QA FEASIBILITY FLAG (developer-amigo): white-box over mesh:revoke + the registry seam —
  # invoke the registered command with an INJECTED config.mesh.relay.controlNode /
  # config.mesh.nodeId pair (matching → the control node admits the revoke; mismatched → the
  # non-authority refusal) over a workspace fixture I control, with an INJECTED revokedAt
  # (a value, never wall-clock — the 22/R2 discipline). The git de-provision runs
  # spawnSync("git", ["remote","remove",name]) against a LOCAL fixture clone that has the
  # remote configured (a real `git remote remove` on a local repo, no network). The "auth-gate
  # now rejects" observable REUSES task 00's in-process serveRelay: seed the roster, admit,
  # revoke via mesh:revoke, reconnect → denied. The real-remote push-access-revoked half (does
  # the remote actually revoke PUSH on a real remote) can NOT be asserted in-process — it is
  # task 02's @manual. Buildable @executable; no feasibility concern RAISED.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core, with an injected config.mesh.nodeId and config.mesh.relay.controlNode
    And a registry seeded via story 00's writeRegistry (roster + revocation)
    And an injected revokedAt (white-box over the revocation time, never wall-clock)

  # The core authority act: mesh:revoke <node> (on the control node) removes the node from the
  # roster AND appends a revocation { nodeId, revokedAt, reason } — both in ONE writeRegistry
  # call (story 00's single write seam). R4: pin BOTH halves — the roster loses exactly that
  # nodeId AND the revocation list gains exactly one record for it (removal + explicit deny
  # together, not one or the other).
  Scenario: mesh:revoke removes the node from the roster and appends a revocation in one authority act
    Given the roster admits nodes "node-x" and "node-y" and the revocation list is empty
    When I invoke mesh:revoke "node-x" with a reason on the control node
    Then the roster no longer contains "node-x"
    And the revocation list contains exactly one record { nodeId "node-x", revokedAt, reason }
    And the roster still contains "node-y" (the removal targets only "node-x")

  # It DE-PROVISIONS git-remote: the inverse of provision (ADR-003 move 3) — git remote remove
  # <name> via spawnSync("git", ["remote","remove",name]), the shell-less argv form
  # (acd-enroll-git-argv-no-shell, the de-provision half), NEVER a shell string (a shell would
  # word-split a name/url on Windows). R4: pin the UNAFFECTED side — the local clone's OTHER
  # git remotes are untouched (only the revoked node's named remote is removed).
  Scenario: mesh:revoke de-provisions the git-remote via the shell-less git remote remove argv form
    Given a local fixture clone with the revoked node's git-remote "node-x-remote" configured plus an unrelated remote "origin"
    When I invoke mesh:revoke "node-x" on the control node
    Then git remote remove was invoked via spawnSync("git", ["remote","remove","node-x-remote"]) (the shell-less argv form, not a shell string)
    And the "node-x-remote" remote is no longer configured on the clone
    And the unrelated "origin" remote is still configured (the de-provision targets only the revoked node's remote)

  # After revoke, the auth-gate (task 00) REJECTS that node's credential on its NEXT connect —
  # the gate reads the LIVE revocation list (T6 revocation completeness), so the revocation
  # ENFORCES at the same gate issuance is checked at. The loop story 01 opened (issue → check)
  # closes here. R4: pin BOTH halves — the SAME token that was admitted before revoke is
  # rejected after it, and a still-admitted peer is still admitted.
  Scenario: after mesh:revoke the auth-gate rejects the revoked node's credential on its next connect
    Given node "node-x" is admitted and connects to the in-process relay (task 00) with a valid token (admitted)
    When I invoke mesh:revoke "node-x" on the control node
    And node "node-x" reconnects with the SAME token
    Then the reconnect is rejected at the auth-gate (it reads the live revocation list — T6 revocation completeness)
    And a still-admitted peer "node-y" connecting with its valid token is still admitted

  # mesh:revoke is control-node-guarded (the relayMode predicate — revocation is an authority
  # decision): on a NON-control node it REFUSES. R4: pin the UNAFFECTED side hard — on a
  # refused invocation the registry is BYTE-UNCHANGED (no roster removal, no revocation append
  # — a non-authority revoke is a structured refusal, not a partial rogue write).
  Scenario: mesh:revoke on a non-control node refuses and leaves the registry byte-unchanged
    Given a config whose control-node predicate resolves to a non-control node (controlNode !== nodeId)
    And a registry on disk whose bytes I record
    When I invoke mesh:revoke "node-x" on that non-control node
    Then the invocation refuses (revocation is an authority decision — the relayMode guard)
    And the registry file on disk is byte-unchanged (no roster removal, no revocation append)

  # mesh:revoke rides the existing acd-mesh-command-cli-bijection gate (22/R1, inverse-CLEAN):
  # its --json face is clean + parseable, and the cli adapter + argsFor case ship in the same
  # change (the arch-test proves the bijection; this scenario exercises the observable face).
  Scenario: mesh:revoke --json emits a clean, parseable result
    Given the roster admits node "node-x" on the control node
    When I invoke mesh:revoke "node-x" --json
    Then the result is clean, parseable JSON (no interleaved log noise on the json stream)
    And it reports the revoked nodeId "node-x" and the recorded revokedAt

  # R4 pin: revoking node X leaves OTHER roster entries and OTHER revocations untouched — the
  # revocation is an add-only record + a targeted roster removal, NOT a rewrite of peers. R4:
  # pin the UNAFFECTED side hard — a pre-existing revocation for a different node, and every
  # other roster entry, are byte-identical after revoking X.
  Scenario: revoking one node leaves other roster entries and other revocations untouched (add-only revocation, targeted removal)
    Given the roster admits nodes "node-x", "node-y", "node-z" and the revocation list already holds a revocation for "node-w"
    And I record the bytes of the "node-w" revocation and the "node-y" / "node-z" roster entries
    When I invoke mesh:revoke "node-x" on the control node
    Then the "node-w" revocation is byte-identical (the append did not rewrite it)
    And the "node-y" and "node-z" roster entries are byte-identical (the removal targeted only "node-x")
    And the revocation list now holds the "node-w" and "node-x" revocations (add-only, not a rewrite)
