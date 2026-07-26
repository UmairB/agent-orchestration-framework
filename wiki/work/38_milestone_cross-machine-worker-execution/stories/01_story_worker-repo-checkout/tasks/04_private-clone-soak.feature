@manual @cli @work @distribution
Feature: A worker assigned a private repo it lacks clones it (with auth) and runs it — no manual pre-setup
  In order to prove SPEC objective (b) end to end, an operator assigns a story from the control node to a worker
  that does NOT have a PRIVATE repo checked out; the worker resolves the clone URL, obtains the SECURITY-approved
  credential, clones into its scoped checkout, materializes a worktree, and drives the ref to a terminal run —
  with no manual pre-setup on that machine — while the fleet advances `assigned → running → done` live.

  # The milestone's DEFERRED HUMAN GATE for the worker dimension. The @executable 00–03 lanes cover config
  # resolution, path scoping, register-and-fallthrough, and the no-credential-at-rest invariants over a hermetic
  # fixture; the only parts NOT covered are the real cross-machine dispatch, a REAL private-repo clone with the
  # SECURITY-approved auth mechanism (RESEARCH.md §1: GIT_ASKPASS + a control-minted short-lived token), and the
  # live fleet advance. GATED on the SECURITY.md sign-off of the credential-transmission mechanism (the residual
  # RCE/trust posture inherited from m35 is accepted within the tailnet boundary). Closed at `aof:verify 38`.
  #
  # @qa (human-check refinement): the two @executable-uncoverable facts a human must confirm live are (1) a REAL
  # private clone succeeds with the approved credential and no manual pre-setup, and (2) NO credential is left at
  # rest on the worker after the run. The steps below name the exact spot-checks so the operator running the soak
  # has an unambiguous pass/fail — not a vibe. Run only after SECURITY.md signs off the mechanism.

  Scenario: a worker clones a private repo it lacks and runs the assignment, end to end
    # SETUP — a genuinely fresh worker: the private repo is NOT already on disk anywhere the worker could reuse.
    Given a worker node enrolled in the mesh that does NOT have private repo "acme/secret" checked out
    And there is no pre-existing checkout of "acme/secret" under <meshRoot>/checkouts/ on that worker before the run
    And config.mesh.repo.cloneUrl resolves to "acme/secret" and the SECURITY-approved credential path is configured
    # ASSIGN — one operator action from the control node, no touching the worker machine.
    When the operator assigns a story to that worker from the control node
    # CLONE — the worker self-provisions with the approved credential and no human intervention on its machine.
    Then the worker clones "acme/secret" into <meshRoot>/checkouts/<workspaceId>/ using the approved credential
    And the operator did NO manual pre-setup on the worker machine (no pre-clone, no manual `git clone`, no config edit)
    # NO CREDENTIAL AT REST — the human spot-check the hermetic lane cannot fully prove on a REAL credential:
    And a spot-check of <meshRoot>/checkouts/<workspaceId>/.git/config shows no credential value (no `url.<x>@`, no `[http] extraheader`, no durable `credential.helper store`)
    And a spot-check of the worker process environment (and the spawned agent child's env) shows the credential is absent after the clone
    And a grep of the worker's run logs / streamed frames for the run shows the credential value appears nowhere
    # RUN + FLEET — the assignment drives to terminal and the fleet reflects it live.
    And the worker materializes a worktree under the m35 mesh worktrees root and drives the ref to a terminal run
    And the fleet advances `assigned → running → done` live, observed from the control node during the run

  Scenario: an operator confirms the credential handling is acceptable (security sign-off)
    # The gate that unblocks running the soak above at all — a human accepts the residual risk on the record.
    Given the SECURITY-approved credential-transmission mechanism (GIT_ASKPASS + control-minted short-lived token) is in place
    Then the operator signs off the SECURITY.md residual/accepted risk for the credential-transmission mechanism
    And the sign-off records the accepted residual (the m35-inherited RCE/trust posture within the tailnet boundary)
