@executable @cli @adapter @distribution
Feature: a directive is honored ONLY over an admitted tailnet-peer connection, and never from a revoked issuer
  In order that dispatch — which makes a worker fetch and run a ref (remote code execution) — cannot be
  driven by an unadmitted party or by a credential that has since been revoked, a directive is acted on only
  when it rides an admitted, live tailnet-peer connection, and a directive whose issuer sits in the live
  registry revocations never routes, no matter that it arrived on an admitted stream.

  # ARCHITECTURE ADR-002 (admission IS the trust boundary; only a LIVE connected peer receives/acts on a
  # directive — isTailnetPeer, 33/ADR-002, the same predicate that admitted the worker's stream; the worker
  # never re-authenticates the directive, being on the admitted stream IS the authorization) + ADR-006
  # (auto-accept is bounded to exactly that boundary).
  # SECURITY T5 (acd-directive-only-from-admitted-peer): a non-peer's directive is refused at the upgrade gate
  # — the socket is destroyed before any frame is read, so no directive is honored off a non-peer; identity is
  # the connection's remoteAddress→nodeId join, never a self-declared header.
  # SECURITY T2 (acd-revoked-issuer-directive-never-executes): the dispatch path reads the LIVE registry
  # revocation list (isRevoked) per decision — never a serve-start snapshot — and a directive whose issuer is
  # revoked NEVER routes; the filter fails safe (only ever removes routing power, never grants it — an
  # absent/empty registry leaves directives routing normally). This carries the retired
  # acd-issuance-revoked-issuer-filtered / mesh-routing-revoked-issuer invariant onto the WS transport, off git.
  # "The directive branch sits INSIDE wss.on('connection') (post-admission)" and "the dispatch consumer couples
  # an isRevoked read to the directive issuer" are STRUCTURAL → the security fitnesses, not steps; THIS feature
  # asserts the observable accept/refuse and the observable routes/never-routes.
  #
  # RESOLVED (developer-amigo): tested over the INJECTED transport + an INJECTED peer-identity signal (the
  # fabric "is this a tailnet peer" fact, mirroring 34/story-04's injected admission) + an injected clock. No
  # live tailnet; the real non-peer dial being refused is the milestone's @manual soak (story 02).

  # THE TRUST BOUNDARY: a directive frame is acted on only when its connection is an admitted tailnet peer;
  # a directive arriving on a non-peer connection is refused and nothing is acted on (SECURITY T5 / T1).
  Scenario Outline: a directive is honored only over an admitted tailnet-peer connection
    Given a directive frame arriving on a connection whose origin is <origin>
    When the control server evaluates the directive
    Then the directive is <outcome>
    And a refused directive causes no dispatch to be acted on

    Examples:
      | origin           | outcome  |
      | a tailnet peer   | accepted |
      | a non-peer host  | refused  |

  # REVOCATION COMPLETENESS (SECURITY T2): a directive whose issuer is in the LIVE registry revocations never
  # routes — even on an admitted stream — while an admitted, non-revoked issuer's directive routes normally.
  Scenario Outline: a revoked issuer's directive never routes; a non-revoked issuer's does
    Given a directive on an admitted peer connection whose issuer is <issuer>
    And the live registry revocations <revocation-state>
    When the control server evaluates the directive for routing
    Then the directive <routing>

    Examples:
      | issuer   | revocation-state       | routing            |
      | node-a   | list node-a as revoked | never routes       |
      | node-a   | are empty              | routes normally    |
      | node-b   | list node-a as revoked | routes normally    |

  # LIVE RE-READ (SECURITY T2): revocation is read per decision, never a serve-start snapshot — a node revoked
  # AFTER it issued is filtered on the very next directive, not honored from a stale roster.
  Scenario: a node revoked after issuing is filtered on the next directive it sends
    Given an admitted issuer "node-a" whose earlier directive routed normally
    When "node-a" is added to the live registry revocations and sends a new directive
    Then that new directive never routes

  # FAIL-SAFE DIRECTION (SECURITY T2): the revocation filter only ever removes routing power, never grants it —
  # an absent registry leaves a directive routing exactly as if no revocations existed.
  Scenario: an absent registry leaves an admitted issuer's directive routing normally
    Given a directive on an admitted peer connection whose issuer is "node-a"
    And no registry is present
    When the control server evaluates the directive for routing
    Then the directive routes normally
