@cli @work @distribution @executable
Feature: The node-side presence publish does two publishes in a structurally-frozen order — git unconditionally first, the relay best-effort second
  In order to keep correctness independent of the relay (push-for-liveness, poll-for-durability — PRD A5)
  the heartbeat writes the durable git presence record UNCONDITIONALLY first, then pushes the relay BEST-EFFORT second (a relay-absent / connect-fail / push-fail caught, never thrown),
  so that the durable record is byte-identical whatever the relay does, the heartbeat result succeeds regardless of relay state, and the relay only ever accelerates — it never gates or undoes the git write.

  # ARCHITECTURE ADR-003 (story 02 / fitness #4): the two-publish path —
  #   await publishPresenceRecord(workspace, nodeId, record);   // git, UNCONDITIONAL, the floor
  #   try { await pushPresenceSignal(relayClient, envelope); }  // relay, BEST-EFFORT, the accelerator
  #   catch { /* liveness lost, data safe — never rethrown */ }
  # The git write is NOT inside any relay-success branch; the relay push is caught, never thrown.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #4 (acd-presence-relay-independent) is the SOURCE control-flow assertion: the
  #    writeText/publishPresenceRecord call is not nested in a relay-push conditional, and the
  #    relay push is wrapped in a try/catch that swallows the throw. That is an ARCH-TEST over the
  #    source of src/commands/mesh-heartbeat.mjs (+ the node-side relay client) — NOT a scenario here.
  #  - THIS feature asserts the OBSERVABLE behaviour the control flow produces: across every relay
  #    state the durable git record is written BYTE-IDENTICALLY and the heartbeat result SUCCEEDS,
  #    and on the happy path the relay IS pushed (best-effort ≠ skipped).
  # The A1/A5 latency split (≤5s relay / ≤30s git) is a VERIFY-TIME measurement spike (task 02,
  # @manual) — NOT asserted here; this feature pins STRUCTURE (unconditional git, caught relay),
  # not LATENCY.
  #
  # QA FEASIBILITY FLAG (developer-amigo): every scenario stays @executable ONLY if the node-side
  # relay client can be FAKED / INJECTED so the four relay states are reachable WITHOUT a real ws
  # server — i.e. publish takes an injected relay client whose connect/push can be stubbed to:
  # succeed, throw-on-connect, be absent (no relay configured), and throw-on-push. If the publish
  # path can only reach a relay over a real socket, the relay-down / push-throws rows are not
  # reliably @executable in CI. RAISED — do NOT silently retag to @manual; the structure (not the
  # latency) must stay unit-testable. See VERIFICATION.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And this node has a stable mesh.nodeId (the same id its node record carries)
    And the presence publish path takes an injected relay client whose connect/push I can stub

  # THE INVARIANT MATRIX — across every relay state the DURABLE git record is written
  # byte-identically and the heartbeat SUCCEEDS. The git write does not depend on relay state;
  # pin that hard. The four rows are the complete relay-state equivalence class:
  #   - up                 : the relay client connects and the push succeeds (the happy path);
  #   - down (connect-fail): the relay is configured but unreachable — connect throws;
  #   - unconfigured       : no config.mesh.relay.* — there is no relay to push to (skip);
  #   - push throws        : the relay connects but the push call itself throws (mid-send failure).
  # For EVERY row: (a) the git presence record is written byte-identically (the unaffected side,
  # R4 — a relay failure leaves the durable record EXACTLY as a relay success would write it), and
  # (b) the mesh:heartbeat result SUCCEEDS (a relay failure never reds the heartbeat).
  Scenario Outline: the git presence record is written byte-identically and the heartbeat succeeds for every relay state
    Given the injected relay client is in relay state "<relay-state>"
    When I invoke mesh:heartbeat to publish this node's presence with a fixed injected heartbeat instant
    Then the heartbeat result is "<result>"
    And a presence record for this node's id is persisted under the partition root's presence seam
    And the persisted git presence record is byte-identical to the relay-up baseline (the durable write does not depend on relay state)
    And no relay failure propagated to the heartbeat result

    Examples:
      | relay-state          | result  |
      | up                   | success |
      | down (connect-fails) | success |
      | unconfigured         | success |
      | push throws          | success |

  # The accelerator works on the happy path: when the relay is UP the presence signal IS pushed —
  # "best-effort" must not collapse into "skipped". This pins the TARGETED side of R4 (the relay
  # push DOES happen when it can), the complement of the matrix above (the git write is unaffected).
  # The pushed envelope is the relay's frozen { kind, nodeId, signal } (story 01) — kind "presence",
  # this node's id, the presence record as the opaque signal blob.
  Scenario: when the relay is up the presence signal is pushed over the relay (best-effort is not skipped)
    Given the injected relay client is in relay state "up"
    When I invoke mesh:heartbeat to publish this node's presence
    Then exactly one presence signal was pushed over the relay client
    And the pushed envelope carries kind "presence" and this node's nodeId
    And the pushed envelope's opaque signal carries this node's presence record
    And the heartbeat result is success

  # The unconfigured case is a clean SKIP, not an error: with no relay configured the relay push
  # is simply not attempted — and the git write still lands. This separates "skip" (unconfigured)
  # from "attempt then catch" (down / push-throws): both succeed, but only the configured-yet-failing
  # cases attempt a push.
  # R4: pin the UNAFFECTED side — the durable git record is written identically whether the relay
  # was skipped (unconfigured) or attempted-and-failed (down).
  Scenario: with no relay configured the relay push is skipped and the git write still lands
    Given the injected relay client is in relay state "unconfigured"
    When I invoke mesh:heartbeat to publish this node's presence with a fixed injected heartbeat instant
    Then no presence signal push was attempted over the relay
    And a presence record for this node's id is persisted under the partition root's presence seam
    And the persisted git presence record is byte-identical to the relay-up baseline
    And the heartbeat result is success

  # A relay failure is CAUGHT, not thrown: when the push throws (mid-send), the throw is swallowed
  # and the heartbeat completes successfully — the observable face of fitness #4's try/catch. The
  # failure is reported as a non-fatal best-effort outcome in the result, never as a failed command.
  # R4: pin the UNAFFECTED side — the durable git record is byte-identical to the relay-up baseline
  # even though the relay push threw (data safe, liveness lost).
  Scenario: a relay push that throws is caught and never fails the heartbeat, and the git write is intact
    Given the injected relay client is in relay state "push throws"
    When I invoke mesh:heartbeat to publish this node's presence with a fixed injected heartbeat instant
    Then the relay push error was caught (the throw did not propagate)
    And the heartbeat result is success
    And a presence record for this node's id is persisted under the partition root's presence seam
    And the persisted git presence record is byte-identical to the relay-up baseline (data safe, liveness lost)
    And the result reports the relay push as a non-fatal best-effort failure
