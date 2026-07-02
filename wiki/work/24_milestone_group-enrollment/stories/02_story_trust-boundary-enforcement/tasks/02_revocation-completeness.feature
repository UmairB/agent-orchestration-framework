@cli @work @distribution @manual
Feature: a revoked node loses BOTH relay access AND git-remote access — the T6 revocation-completeness pen-test on a real remote
  In order to prove revocation is COMPLETE, not half-applied — a revoked node keeps neither relay access nor push to the group's git-of-record (SECURITY T6)
  after aof mesh revoke against a REAL remote, a human confirms the revoked node's git-remote push access is actually gone (the fitness gate covers the relay half; the real-remote push half needs a real remote's auth to observe),
  so that a revocation that only HALF-applies — the auth-gate rejects but push still works, or push is gone but the relay still brokers — is caught: both halves are gone together.

  # ARCHITECTURE ADR-004 + SECURITY T6 (revocation completeness — a revoked node must lose
  # BOTH relay AND git-remote access). The RELAY half is covered @executable (task 00's
  # auth-gate rejects a revoked credential) + by the security-owned acd-relay-auth-gate-checked
  # fitness; the GIT-REMOTE half against a REAL remote — does the de-provision actually revoke
  # PUSH access on a live remote's auth — is the residual @manual pen-test SECURITY routes to
  # VERIFICATION.md as git-remote-deprovision. This feature is the OUTSIDER-VERIFIABLE
  # completeness check: revoke against a real remote, then confirm BOTH access paths are gone
  # together. It restates NO fitness invariant (the auth-gate CHECK is acd-relay-auth-gate-checked;
  # the argv form is acd-enroll-git-argv-no-shell) — it MEASURES the real-remote push outcome
  # a source-level test cannot reach. Agent-run; evidence in VERIFICATION.md (SECURITY's
  # @manual git-remote-deprovision routing).
  #
  # QA FEASIBILITY FLAG (developer-amigo): @manual — real-remote push-access verification can
  # NOT be asserted in-process. It needs a REAL remote's auth (a live git host that actually
  # enforces the revoked grant), a committable identity, and an out-of-band observation that a
  # push from the revoked node's credential is REFUSED by the remote (not merely that a local
  # `git remote remove` ran — that local half is task 01's @executable). This mirrors
  # SECURITY.md's routing (the @manual git-remote-deprovision pen-test in VERIFICATION.md, the
  # T6 git-remote half — the fitness gate covers the relay half; a human confirms the remote
  # de-provision actually revokes push). Agent-run; evidence in VERIFICATION.md. Tag UNCHANGED
  # at @manual (real-remote auth is not reachable by an in-process fixture — not a retag from
  # @executable, this half is @manual by nature).
  Background:
    Given a REAL group git remote I control (a live host that enforces push access), with the group registry + a board remote provisioned to a joined node
    And the joined node "node-x" holds a valid mesh credential (relay auth + the git-remote grant) and can currently push to the group remote
    And the control node can run aof mesh revoke against that real remote
    And evidence is captured to VERIFICATION.md (the T6 git-remote-deprovision pen-test)

  # The git-remote half (T6, the SECURITY @manual git-remote-deprovision pen-test): after
  # aof mesh revoke against a REAL remote, the revoked node's PUSH access is actually gone —
  # a human confirms the remote REFUSES a push presenting the revoked node's credential (the
  # fitness gate covers the relay half; this confirms the git-remote half on a real remote's
  # auth). R4: pin the UNAFFECTED side — a still-admitted node can still push (the revoke
  # de-provisioned only the revoked node's access, not the whole remote).
  Scenario: after aof mesh revoke against a real remote, the revoked node's push access is actually gone
    Given node "node-x" can push to the group remote before revocation
    When the control node runs aof mesh revoke "node-x" against the real remote
    And node "node-x" attempts a push to the group remote with its (now revoked) credential
    Then the real remote REFUSES the push (push access is actually gone, not merely a local remote-remove)
    And a still-admitted node "node-y" can still push (only "node-x"'s access was de-provisioned)
    And the outcome is recorded as evidence in VERIFICATION.md (the T6 git-remote-deprovision pen-test)

  # Completeness (T6): a revocation must not HALF-apply — the revoked node loses relay access
  # AND git-remote access TOGETHER. R4: pin BOTH halves are gone — the auth-gate rejects the
  # revoked credential's ws connect (the relay half, cross-checked against task 00) AND the
  # real remote refuses its push (the git-remote half) — a revocation where only one applied
  # is the exact T6 failure this pen-test catches.
  Scenario: the revoked node loses relay access AND git-remote access together (no half-applied revocation)
    Given node "node-x" is admitted and can both connect to the relay and push to the group remote
    When the control node runs aof mesh revoke "node-x" against the real remote
    Then node "node-x"'s ws connect to the relay is rejected (the relay half — the auth-gate, cross-checked against task 00)
    And node "node-x"'s push to the real remote is refused (the git-remote half)
    And BOTH halves are gone (a revocation that half-applies — relay OK but push refused, or the inverse — is the T6 failure this catches)
    And the completeness outcome is recorded as evidence in VERIFICATION.md
