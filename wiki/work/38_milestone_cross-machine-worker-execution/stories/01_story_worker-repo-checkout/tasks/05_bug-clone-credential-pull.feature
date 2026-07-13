@bug @finding-F12 @executable @cli @work @distribution
Feature: A worker PULLS a clone credential from control at the moment it hits a clone miss, so a PRIVATE repo can actually be cloned
  In order that SPEC objective (b) holds — a worker assigned work it lacks the repo for clones it **with auth** —
  the worker must be able to OBTAIN a credential in production. Today it cannot: the credential is a static option
  supplied only by a TEST-injection seam, so production always resolves `null` and the shipped worker can clone only
  a PUBLIC repo. The worker requests a token from control on the clone-miss path, over the already-open stream, and
  consumes it through the existing `GIT_ASKPASS` shim.

  # FINDING F12 (aof:verify 38, BLOCKER — the SEVENTH instance of this milestone's defect class, and the first at a
  # dependency-injection seam rather than a data payload).
  #
  # MEASURED AT THE SOURCE:
  #   src/mesh-worker-execution.mjs:356   `const credential = options.cloneCredential ?? null;`
  #   …and its own doc comment: "cloneCredential — a fake token string (TESTS ONLY) … absent for a public-repo clone."
  #   src/mesh-launcher.mjs:484 (the ONLY production constructor) builds the handler with
  #     { loadWs, nodeId, sendAssignmentStatus, now, ...(options?.workerExecutionOptions ?? {}) }
  #   and `workerExecutionOptions` is documented as a TEST-injection seam. `aof mesh serve --serve` passes none.
  #   ⇒ in production `cloneCredential` is ALWAYS null. Nothing ever hands the GIT_ASKPASS shim a token.
  #
  # WHY IT SHIPPED GREEN: story-01's `@executable` tests all INJECT a fake token and assert what the code does WITH
  # one. Nobody asked where the credential comes FROM. ADR-008's rule ("fed by its real producer") was written about
  # payloads; this is the same defect at the WIRING — a collaborator whose only supplier is a test.
  #
  # THE DECISION — ARCHITECTURE **ADR-009: PULL, never push.** Control CANNOT know whether a directive will clone:
  # the deciding predicate (`localMeshRepoPublished`) is readable ONLY on the worker (mesh-worker-execution.mjs:149-152
  # — "the control-side gate has no filesystem access to a remote worker's config"). So any PUSH design must mint
  # SPECULATIVELY on every directive — per-DIRECTIVE, not per-CLONE — which violates SECURITY T4 head-on and puts a
  # secret on the ~all of directives that never clone. PULL makes "per-clone / short-lived / single-repo" true BY
  # CONSTRUCTION. The frozen five-key directive frame (35/ADR-002) is NOT broken: both channels already dispatch on
  # `frame.kind` and ignore unknown kinds, so the new request/response pair is purely ADDITIVE.
  #
  # @qa: the assertion whose absence let this ship is "the PRODUCTION wiring supplies the credential". A test that
  # injects the collaborator it is meant to be verifying proves nothing.

  Background:
    Given a worker assigned work for a workspace whose repo it does NOT have
    And a control node holding the credential source (the worker holds no standing credential)

  Scenario: the worker requests a credential ONLY when it actually hits a clone miss
    # The heart of ADR-009: the mint is CAUSED by the clone, so it is per-clone by construction.
    Given the worker already HAS the repo for the assigned workspace
    When it receives the directive
    Then it makes NO clone-credential request
    And no secret crosses the wire for that directive

  Scenario: on a clone miss the worker pulls a credential and clones with it
    Given the worker LACKS the repo and `config.mesh.repo.cloneUrl` resolves
    When it receives the directive
    Then it sends ONE `clone-credential-request` up the already-open stream, naming the assignmentId and workspaceId
    And control replies with a `clone-credential` frame carrying the credential
    And the worker clones using it through the `GIT_ASKPASS` shim (never `--config`, never a token in the URL)
    And the credential rides a per-invocation env on the CLONE exec ONLY — never `process.env`

  Scenario: the PRODUCTION wiring supplies the resolver — the F12 guard
    # The omission that IS F12. The resolver must be reachable WITHOUT a test injecting it.
    Given the launcher constructs the worker-execution handler as production does (`aof mesh serve --serve`)
    Then the credential resolver is supplied as a LITERAL key at that call site
    And it is NOT reachable only through the test-injection option spread
    And the static `cloneCredential` option no longer exists (a static string is per-HANDLER and CANNOT be per-clone)

  Scenario: control authorizes the request before minting — only the assignment's holder may ask
    # PULL is the only shape with a requester to authorize. Reuse the existing holder check (SECURITY T6).
    Given a `clone-credential-request` arrives for an assignment
    When the requesting node is NOT the assignment's holder
    Then control refuses it, mints nothing, and returns no credential
    And the refusal is loud and coded, never a silent empty reply

  Scenario: the frozen directive frame is untouched
    Then `buildDirectiveFrame` still returns EXACTLY its frozen keys — `kind`, `to`, `assignmentId`, `itemRef`, `workspaceId`, `at`
    And no credential appears on any directive frame, ever
    And a credential handed to the directive builder reaches no frame

  Scenario Outline: a credential that cannot be obtained fails LOUDLY — never a hang, never a silent public clone
    Given the worker hits a clone miss and requests a credential
    When the request <outcome>
    Then the assignment fails with the loud coded `assignment-repo-unavailable`
    And no partial checkout is left behind

    Examples:
      | outcome                          |
      | is refused by control            |
      | times out with no reply          |
      | returns a blank/absent credential |

  Scenario: a PUBLIC repo still clones with no credential and no request (byte-identical to today)
    Given the workspace's repo is public and needs no auth
    Then the resolver returns no credential, no request is sent, and no `GIT_ASKPASS` is set
    And the clone proceeds exactly as it does today

  Scenario: no credential is left at rest anywhere (SECURITY T1/T2/T3 — re-armed on the new path)
    Given a clone completed using a pulled credential
    Then nothing is written into the checkout's `.git/config` (no `url.<cred>@`, no `http.extraheader`, no durable `credential.helper store`)
    And the credential is absent from the worker's ambient `process.env` and from the spawned agent child's env
    And the credential value appears in NO log, error message, or streamed frame
