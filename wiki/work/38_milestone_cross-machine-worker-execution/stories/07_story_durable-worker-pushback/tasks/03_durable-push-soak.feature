@manual @cli @work @distribution @round-trip
Feature: A real worker's diff SURVIVES — pushed to a real branch on the real GitHub remote, visible AFTER the worktree is removed
  In order to prove the milestone's earned lesson (ADR-008: a green suite is NOT evidence — only a real-producer
  path is) and to directly CONTRADICT RESEARCH §4.1's LIVE finding (a green run whose entire output was
  garbage-collected and never reached origin), a REAL worker runs REAL feature work, commits to a REAL branch, and
  PUSHES to the REAL GitHub remote — and the branch + its diff are visible on `origin` AFTER the worktree is
  force-removed.

  # The milestone's DEFERRED HUMAN GATE for durable push-back — the real-producer outsider check the @executable
  # 00-02 lanes CANNOT reach (00-02 cover branch naming, push-before-remove ordering, and the two-token scope over a
  # hermetic LOCAL bare repo; none touches a real GitHub, a real write credential, or a real cross-machine push).
  # ADR-015 + ADR-008. RESEARCH §4.1 MEASURED the FAILURE live on `let-shield-portal`: `git show
  # origin/main:<file>` → "exists on disk, but not in origin/main"; `git branch -r` showed only `origin/main`; the
  # output was untracked and GC'd the instant the worktree was force-removed. THIS soak is that exact check,
  # INVERTED: the branch + diff MUST be on `origin` AFTER the run. GATED on SECURITY T15's write-token review (the
  # target repo's App now installed contents:write — operator-attested, T8/R7 extended). Closed at `aof:verify 38`.
  #
  # @qa (human-check refinement): the OUTSIDER-observable facts a human must confirm live are (1) the branch + diff
  # reach origin, (2) they SURVIVE the worktree force-remove, (3) the write token used was single-repo + minted ONLY
  # at the push seam and left nothing at rest. The steps name the exact spot-checks — an unambiguous pass/fail, not
  # a vibe. Run only after SECURITY.md T15 signs off the widened write-scope mechanism.

  Scenario: a real worker pushes real feature work to origin and it survives the worktree removal
    # SETUP — a genuinely fresh worker driving REAL feature work on a REAL private repo whose App is write-installed.
    Given a worker node enrolled in the mesh, assigned real feature work for a repo whose GitHub App is installed contents:write
    And the worker checks out a REAL branch `aof/mesh/<itemRef>-<assignmentId>` (not a detached HEAD)
    # RUN — the worker drives the ref, commits, and pushes BEFORE cleanup (the task-01 ordering, now against origin).
    When the worker drives the assignment to `done`, commits its diff, and pushes the branch to the REAL GitHub origin
    # DURABILITY — the outsider check, the direct inversion of RESEARCH §4.1's finding.
    Then from a SEPARATE clone (an outsider) `git branch -r` lists `origin/aof/mesh/<itemRef>-<assignmentId>`
    And `git show origin/aof/mesh/<itemRef>-<assignmentId>:<a-changed-file>` shows the worker's committed diff
    And the branch + diff are STILL on origin AFTER the worker's worktree was force-removed (contradicting §4.1)
    # CREDENTIAL — the write grant was scoped + push-seam-only (T15), spot-checked on the record.
    And the write token used to push was single-repo scoped and minted ONLY at the push seam (never a run-long standing token)
    And no write token is left at rest on the worker (not in `.git/config`, not on process.env, not in a run log)

  Scenario: an operator confirms the widened write-scope handling is acceptable (security sign-off)
    # The gate that unblocks running the soak above — a human accepts the T15 write-grant widening on the record.
    Given SECURITY T15's two-token shape is in place (the clone stays contents:read; a SEPARATE write token minted only at push)
    And the target repo's GitHub App is installed contents:write (+ pull_requests:write ONLY if auto-PR is enabled)
    Then the operator signs off the SECURITY.md T15 residual for the widened write-scoped mint (T8/R7 extended to the write grant)
    And the sign-off records that the write grant is single-repo, push-seam-only, and short-lived
