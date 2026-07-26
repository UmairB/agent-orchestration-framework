@executable @cli @work @distribution
Feature: `aof mesh assign <ref> --to <nodeId>` mints an assigned record and enforces one active assignment per item
  In order to hand a specific work item to a specific worker with one auditable command,
  the operator runs `aof mesh assign <ref> --to <nodeId>`: it resolves the ref exactly, mints an `assigned`
  record targeting the node, and refuses a second active assignment on the same item so exactly one node runs it.

  # ARCHITECTURE 35/ADR-003 (single-runner arbitration is a STORE UNIQUENESS INVARIANT, not a git-observed
  # lease: at most one ACTIVE assignment per `(workspaceId, itemRef)`, where ACTIVE = {assigned, accepted,
  # running} and TERMINAL = {done, failed, withdrawn, reclaimed}; a second active one is refused
  # `assignment-already-active` naming the holder, minting nothing — the run-store `duplicate-run` fail-closed
  # posture). 35/ADR-001 (the minted `assigned` record; issuer = this control node; runId null until running)
  # and 35/ADR-007 (assign is a CLI-only nested verb, a sibling of `aof mesh repo publish`; no UI write route).
  # "Arbitration reads the store's own rows, never a lease/issuance/sync module or git state" is STRUCTURAL →
  # the fitnesses acd-assignment-arbitration-store-not-git / acd-no-git-bus-return, not steps; THIS feature
  # asserts the observable mint, the uniqueness refusal (naming the holder, minting nothing), exact resolution,
  # and the single `--json` envelope.
  #
  # RESOLVED (developer-amigo): tested over a hermetic AOF_GLOBAL_HOME opening a v3 store + an injected clock
  # for assignedAt/updatedAt + a fixture control nodeId as issuer. Pure store + CLI, no network. The
  # repo-availability gate that also fires at assign time is covered by task 03; here every target is available.

  Background:
    Given AOF_GLOBAL_HOME points at a fixture global home
    And the global work projection store is opened at schema version 3
    And this control node's id is "control-a"
    And node "worker-a" is a valid, repo-holding target

  # THE MINT (ADR-001): a clean assign stamps an `assigned` record targeting the node, issued by this control node.
  Scenario: assigning a resolvable ref mints an assigned record targeting the node
    Given a resolvable work item ref "35/00"
    When the operator runs `aof mesh assign 35/00 --to worker-a`
    Then one assignment is minted for that item on its workspace
    And its state is "assigned"
    And its targetNodeId is "worker-a"
    And its issuer is "control-a"
    And its assignedAt and updatedAt are stamped equal
    And its runId is null
    And its reclaimedAt is null

  # THE UNIQUENESS INVARIANT (ADR-003): a second active assignment is refused; a terminal prior clears the way.
  Scenario Outline: a second assign is refused while a prior is ACTIVE and succeeds once the prior is TERMINAL
    Given a prior assignment on item "35/00" for workspace "ws-1" in state "<prior>"
    When the operator runs `aof mesh assign 35/00 --to worker-b`
    Then the assign <result>

    Examples:
      # ACTIVE priors — refused, nothing minted, the refusal names the holder of the active assignment.
      | prior     | result                                                                                        |
      | assigned  | is refused with code "assignment-already-active" naming the holder, minting nothing            |
      | accepted  | is refused with code "assignment-already-active" naming the holder, minting nothing            |
      | running   | is refused with code "assignment-already-active" naming the holder, minting nothing            |
      # TERMINAL priors — the item is re-assignable, so a fresh assigned record is minted for worker-b.
      | done      | succeeds, minting a fresh assigned record targeting "worker-b"                                 |
      | failed    | succeeds, minting a fresh assigned record targeting "worker-b"                                 |
      | withdrawn | succeeds, minting a fresh assigned record targeting "worker-b"                                 |
      | reclaimed | succeeds, minting a fresh assigned record targeting "worker-b"                                 |

  # THE REFUSAL NAMES THE HOLDER: an operator sees which node already holds the item, and nothing new is written.
  Scenario: refusing a second active assign names the holding node and mints nothing
    Given an active "running" assignment on item "35/00" held by node "worker-a"
    When the operator runs `aof mesh assign 35/00 --to worker-b`
    Then the refusal code is "assignment-already-active"
    And the error names the holder "worker-a"
    And the global_assignments row count for that item is unchanged
    And no assignment targeting "worker-b" was minted

  # EXACT RESOLUTION (writes use exact resolution): an unresolvable/typo'd ref mints nothing, refused loudly.
  Scenario: an unresolvable ref is refused with a coded miss and mints nothing
    Given no work item resolves for ref "35/99"
    When the operator runs `aof mesh assign 35/99 --to worker-a`
    Then the operation fails with code "ref-not-found"
    And no assignment is minted

  # THE SINGLE --json ENVELOPE (ADR-007): one shape for success, one for failure — ok + record, or the coded error.
  Scenario Outline: the --json envelope is a single ok-or-error shape
    Given the assign case "<case>"
    When the operator runs the assign with `--json`
    Then the JSON is a single envelope
    And it reports <envelope>

    Examples:
      | case                                              | envelope                                                       |
      | a clean mint on a resolvable ref                  | ok:true with the minted record                                 |
      | a second active assign on the same item           | ok:false with error and code "assignment-already-active"       |
      | an unresolvable ref                               | ok:false with error and code "ref-not-found"                   |
