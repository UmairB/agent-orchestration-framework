@executable @cli @work @distribution
Feature: TWO tokens — the clone stays contents:read, a SEPARATE write token is minted ONLY at the push seam (T15/T9)
  In order that durable push-back (which needs contents:write) does NOT relax the least-privilege posture story 02
  established, the CLONE credential body stays EXACTLY `{ repositories:[repo], permissions:{ contents:"read" } }`,
  and a SEPARATE write-scoped token is minted single-repo — `permissions` no broader than `{ contents:"write" }`
  (+ `{ pull_requests:"write" }` ONLY when auto-PR is on) — ONLY in the push-mint function, never on the clone path.

  # SECURITY 38/T15 (RE-OPENS T9) + ARCHITECTURE ADR-015 (decision 3, the §4.2 preferred two-token shape). The
  # rewritten acd-minted-token-scoped-single-repo becomes a TWO-SEAM detector: (clone) the body deep-equals
  # single-repo `{ contents:"read" }` — VERBATIM the T9 invariant, PLUS a new plant that a clone body carrying ANY
  # write MUST trip ("never silently widened"); (push/write) single-repo, `permissions` ⊆ `{ contents:"write",
  # pull_requests:"write" }` (auto-PR OFF ⇒ EXACTLY `{ contents:"write" }`); and the write body lives ONLY in the
  # push-mint function — the clone provider's exported mintCloneCredential contains NO write body. CONTRAST TODAY:
  # the ONE mint at mesh-clone-credential-provider.mjs:181 is `{ repositories:[repo], permissions:{ contents:"read"
  # } }`. The DETECTOR REWRITE itself is SECURITY-owned + ARMED AT BUILD against the real push-mint module (T15) —
  # this task is the BEHAVIOURAL scope contract that ARMS it.
  #
  # @executable over INJECTED seams — the real clone-mint + push-mint functions driven by a FAKE http client that
  # RECORDS the two access_tokens request bodies (the story-02 task-01 recording pattern), a FAKE app private key +
  # FAKE token strings. NO real GitHub, NO network (the REAL push is task 03's @manual soak).
  #
  # @qa: scenarios 1-4 assert the RECORDED bodies' scopes on the real mint seams; the Scenario Outline enumerates
  # the plants that MUST trip (or stay clean under) the rewritten two-seam detector in CI — the detector's required
  # self-check, expressed as a behavioural contract.

  Background:
    Given the clone-mint and push-mint seams driven by a fake http client that records each access_tokens body
    And a fake app private key + fake token strings (no real GitHub call, no network)

  Scenario: the CLONE mint body stays EXACTLY single-repo contents:read (T9, verbatim)
    When the worker mints the clone credential for its assigned repo
    Then the recorded clone access_tokens body deep-equals `{ repositories:[<repo>], permissions:{ contents:"read" } }`
    And the clone body names EXACTLY one repo and requests NO permission beyond contents:read
    And the clone mint is byte-unchanged from the story-02 posture (never widened to write)

  Scenario: the WRITE mint body is single-repo and no broader than contents:write (auto-PR off — the default)
    Given auto-PR is OFF (the DOCUMENTED DEFAULT — "done" is a pushed branch; a PR is optional/manual)
    When the worker mints the write token at the push seam for its assigned repo
    Then the recorded write access_tokens body names EXACTLY one repo (the assigned repo)
    And `permissions` is EXACTLY `{ contents:"write" }` — no pull_requests, no administration, no org-wide key
    And the write token is minted ONLY at push time — never a run-long standing write credential

  Scenario: auto-PR ON widens ONLY to pull_requests:write, still single-repo
    Given auto-PR is ON (the opt-in the operator may enable)
    When the worker mints the write token at the push seam
    Then `permissions` is a subset of `{ contents:"write", pull_requests:"write" }` — nothing broader
    And the token still names EXACTLY the one assigned repo

  Scenario: the write body lives ONLY in the push-mint function — the clone path never mints write
    When the clone credential is minted
    Then the clone provider's exported mintCloneCredential produces NO contents:write body on any path
    And a write access_tokens body appears ONLY at the push-mint seam, never on the clone path

  Scenario Outline: the plants that MUST trip (or stay clean under) the rewritten two-seam detector in CI
    Given a mint access_tokens body of shape "<plant_body>" on the "<seam>" seam
    Then the rewritten acd-minted-token-scoped-single-repo detector <verdict>

    Examples:
      | seam  | plant_body                                                                      | verdict | note                                        |
      | clone | { repositories:[repo], permissions:{ contents:"write" } }                       | TRIPS   | clone silently widened to write — attack (c) |
      | clone | { repositories:[repoA, repoB], permissions:{ contents:"read" } }                 | TRIPS   | multi-repo clone                             |
      | clone | { permissions:{ contents:"read" } }                                             | TRIPS   | repositories OMITTED — all installation repos |
      | clone | { repositories:[repo], permissions:{ contents:"read", administration:"read" } } | TRIPS   | org-wide/administration key on clone         |
      | write | { permissions:{ contents:"write" } }                                            | TRIPS   | repositories OMITTED — all-repo WRITE (worst) |
      | write | { repositories:[repoA, repoB], permissions:{ contents:"write" } }               | TRIPS   | multi-repo write                             |
      | write | { repositories:[repo], permissions:{ contents:"write", administration:"write" } } | TRIPS | org-wide/administration key on write         |
      | write | { repositories:[repo] }                                                         | TRIPS   | permissions OMITTED — full installation scope |
      | clone | { repositories:[repo], permissions:{ contents:"read" } }                        | CLEAN   | correct clone seam — T9 verbatim             |
      | write | { repositories:[repo], permissions:{ contents:"write" } }                       | CLEAN   | correct write seam — auto-PR OFF             |
      | write | { repositories:[repo], permissions:{ contents:"write", pull_requests:"write" } } | CLEAN  | correct write seam — auto-PR ON              |
