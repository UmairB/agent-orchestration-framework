@cli @work @distribution @executable
Feature: mesh:sync is a one-shot, payload-agnostic git transport that moves records and never re-authors them
  In order to make git the mesh's only transport while keeping git the single system of record
  the mesh:sync command stages + commits this node's records under the partition root, pulls peers', and pushes — moving files, never parsing their content,
  so that each node publishes its own records and reads back peers' purely over git, and git stays the authority — the engine is a mover, not a second source of truth.

  # ARCHITECTURE ADR-004: src/mesh-sync.mjs is the transport, registered AS the one-shot
  # mesh:sync command (the testable unit); the background loop (task 01) is a thin timer over
  # it. This feature asserts the TRANSPORT's observable behaviour over a LOCAL git fixture (no
  # network): staging/committing the right paths, the clean no-op, and the payload-agnostic
  # property. The full two-node-over-a-shared-remote render is task 02 (@manual). The
  # record-neutral source discipline is the acd-mesh-sync-record-neutral ARCH-TEST (fitness #4).
  # QA FEASIBILITY FLAG: every scenario here drives REAL git over a local bare-remote fixture
  # (init/commit/pull/push + a simulated concurrent peer commit). That requires a git binary on
  # PATH and a committable identity (user.name/user.email) in CI. If the build cannot guarantee
  # that, the add-only-merge scenario in particular is not reliably @executable in CI — RAISED
  # for the developer-amigo's feasibility call (do NOT silently retag); see VERIFICATION.
  Background:
    Given a local git work stream with a configured remote I control (a bare repo)
    And the mesh commands registered in the command core
    And this node has published its identity record under the partition root

  # A sync with staged mesh changes commits them under the partition root and pushes — the
  # publish half of the transport.
  Scenario: mesh:sync commits this node's published records and pushes
    When I invoke mesh:sync
    Then this node's record under the partition root is committed
    And the commit is pushed to the configured remote
    And the remote's branch tip now contains this node's record file
    And the --json result reports what was committed and pushed

  # A sync with NO staged mesh changes is a clean no-op — no empty commit (batching: one commit
  # per tick that HAS staged changes, not one per tick).
  # R4: pin the UNAFFECTED invariant explicitly — a no-op sync leaves the working tree and the
  # commit graph BYTE-UNCHANGED (no new commit object, HEAD unmoved, no working-tree edit).
  Scenario: mesh:sync with no staged mesh changes is a clean no-op that leaves the tree byte-unchanged
    Given there are no uncommitted mesh record changes
    And I record the current HEAD commit and the working-tree state
    When I invoke mesh:sync
    Then no commit is created
    And HEAD is the same commit as before the sync
    And the working tree is byte-unchanged (no file added, modified, or deleted)
    And the --json result reports a no-op (nothing to push)

  # The pull half: a peer's record present on the remote is pulled into this node's tree —
  # "reading back what other nodes are doing" = the synced peer files.
  # R4: pin the UNAFFECTED side — pulling a peer's record leaves THIS node's own record file
  # byte-unchanged (the pull adds the peer's file, it does not touch ours).
  Scenario: mesh:sync pulls a peer's record from the remote into this node's tree without touching this node's own
    Given the remote carries a peer node record for "umair-mbp" this node has not seen
    And I record the on-disk bytes of this node's own record
    When I invoke mesh:sync
    Then the peer record "umair-mbp.json" is present under this node's partition root
    And this node's own record file is byte-identical to before the pull
    And the --json result reports the peer record was pulled

  # Payload-agnostic: the engine moves whatever files exist under the partition root — a record
  # type it has never seen (a fixture record with an unknown shape) syncs unchanged, byte-for-byte.
  # This is the structural property that lets presence (m23) + runs (m26) sync with zero engine change.
  # QA: cover both an unknown JSON shape AND a non-JSON file, so "payload-agnostic" is proven to
  # mean "moves bytes" — not "moves JSON it can parse".
  Scenario Outline: mesh:sync moves an unrecognised record file unchanged (payload-agnostic)
    Given an unrecognised file "<file>" under the partition root with <content>
    When I invoke mesh:sync
    Then "<file>" is committed and pushed byte-for-byte unchanged
    And the engine never parsed or rewrote its content
    And the remote's branch tip contains "<file>" with identical bytes

    Examples:
      | file              | content                          |
      | future-shape.json | arbitrary JSON of an unknown shape |
      | opaque.bin        | non-JSON binary-ish bytes        |

  # Add-only merge: a concurrent peer publish (a different node's file landing on the remote)
  # merges add-only — git faces no three-way content merge, because the partition convention
  # (story 00 / ADR-002) guarantees the two nodes wrote different paths.
  # R4: pin BOTH that both records land AND that neither node's record content was altered by
  # the merge (add-only means each file arrives intact, not three-way-merged).
  # QA FEASIBILITY FLAG (see Background): this scenario simulates a concurrent peer commit on the
  # remote and a local push/pull — it is the scenario most dependent on a real, configured git.
  Scenario: a concurrent peer publish merges add-only with no conflict and no content rewrite
    Given this node and a peer each publish their own distinct node record concurrently
    When both push and this node pulls
    Then both records are present under the partition root
    And the merge completed add-only with no conflict
    And neither node's record file was content-merged (each arrived byte-for-byte as its owner wrote it)
