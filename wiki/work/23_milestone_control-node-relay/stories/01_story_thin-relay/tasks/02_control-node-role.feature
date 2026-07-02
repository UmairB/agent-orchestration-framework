@cli @work @distribution @executable
Feature: The control node is a re-nominate-able config role, and losing it loses liveness — never data
  In order to host the relay on a nominated node without leader-election machinery, and to guarantee the relay is never a durability SPOF
  standing up relay mode reads config.mesh.relay.controlNode + config.mesh.relay.url, re-nomination is a config edit on a different node (no election protocol), and a node not nominated does not host the relay,
  so that nomination is a reversible config decision (not a negotiation), and when the control node goes down every durable record on disk is byte-unchanged — the fleet loses the live accelerator, not its data.

  # ARCHITECTURE ADR-001: the control node is a re-nominate-able ROLE recorded in CONFIG
  # (config.mesh.relay.controlNode = the nominated node id; config.mesh.relay.url = the endpoint
  # peers push to) — NOT special hardware and NOT a leader-elected role. Re-nomination is
  # standing relay mode up on a different node + re-pointing the config (there is NO election
  # protocol — deliberate, ADR-001 alternatives). The relay is STATELESS / never a system of
  # record, so losing the control node pauses liveness while git (and every durable record on
  # disk) is untouched — the milestone's HARD invariant (SPEC §Objective). This feature asserts
  # the OBSERVABLE config-role behaviour + the lose-liveness-not-data invariant. The source-level
  # statelessness (no record write, no record-schema import) is the acd-relay-stateless ARCH-TEST
  # (fitness #1) — NOT a scenario here.
  #
  # PRE-AUTH POSTURE (ADR-001, deliberate scope decision): the m23 relay carries NO auth — the
  # control-node role is config-only and unauthenticated; the relay binds loopback / a trusted
  # LAN by default. The group credential / relay auth + who-may-nominate is milestone 24
  # (SPEC §Out of scope). NO auth scenarios are authored here, by design.
  #
  # QA FEASIBILITY FLAG (developer-amigo): "stand up relay mode on a node" in @executable form is
  # the in-process serveRelay core gated on a config read (the testable unit), NOT a spawned
  # second OS process — confirm the relay-mode launcher exposes the config gate as an in-process
  # seam (e.g. relayMode(config) → serves only when config.mesh.relay.controlNode === this node's
  # id) so the nominated/not-nominated branch is unit-testable without spawning. The "control
  # node goes down, records byte-unchanged" invariant is asserted by recording on-disk record
  # bytes, stopping the relay (stop()), and re-reading — no spawn needed. Do NOT silently retag —
  # RAISED for the feasibility call; see VERIFICATION.
  Background:
    Given a workspace whose config carries a mesh.relay section
    And this node has a stable node id (config.mesh.nodeId)

  # Standing up relay mode READS the config: it serves on the configured url ONLY when this node
  # is the nominated control node — the role is config, full stop.
  Scenario: standing up relay mode reads config.mesh.relay.controlNode and config.mesh.relay.url
    Given config.mesh.relay.controlNode is this node's id and config.mesh.relay.url is set
    When this node stands up relay mode
    Then the relay serves on the configured url
    And the control node the relay reports is the one named in config.mesh.relay.controlNode

  # A node that is NOT nominated does not host the relay — the negative half of the config gate.
  # R4: pin the UNAFFECTED side — a non-nominated node standing up relay mode is a clean no-op
  # (no listener bound, no port taken), not a crash and not a silent second relay.
  Scenario: a node that is not the nominated control node does not host the relay
    Given config.mesh.relay.controlNode is a DIFFERENT node's id
    When this node attempts to stand up relay mode
    Then this node does not host the relay (no listener is bound)
    And it does not crash — it declines because the config did not nominate it
    And no second relay is silently started

  # Re-nomination is a CONFIG mechanism, not a negotiation: pointing the config at a different
  # node + standing relay mode up there makes THAT node the control node. There is NO election
  # protocol — the mechanism is the config edit. QA: pin BOTH that the new node now hosts AND
  # that the change came from config (not a handshake/vote), so an election can't slip in unseen.
  # R4: pin the UNAFFECTED side — re-nomination changes the role only via config; no election
  # message was exchanged between nodes to effect it.
  Scenario: re-nomination is standing relay mode up on a different node and re-pointing the config — no election
    Given the control node was previously this node, then config.mesh.relay.controlNode is re-pointed to node "B"
    When node "B" stands up relay mode with the re-pointed config
    Then node "B" now hosts the relay (it is the nominated control node)
    And the nomination changed solely because config.mesh.relay.controlNode changed (no election protocol ran)
    And no vote or leader-election message was exchanged between nodes to effect the re-nomination

  # THE HARD INVARIANT: the relay is never a system of record, so losing the control node (the
  # relay going down) loses LIVENESS, not DATA. R4 pinned HARD on the unaffected side — every
  # durable record on disk is BYTE-UNCHANGED across the relay's death (no record was issued by,
  # held in, or lost with the relay; the relay persisted nothing authoritative to begin with).
  Scenario: losing the control node loses liveness, not data — every durable record on disk is byte-unchanged
    Given durable records exist on disk (node records and any presence records under the partition root)
    And I record the on-disk bytes of every durable record
    When the control node goes down (the relay is stopped)
    Then every durable record on disk is byte-identical to before the relay went down
    And the relay issued and persisted nothing authoritative that was lost with it
    And the fleet has lost only liveness (the live accelerator), while git and its records are intact
