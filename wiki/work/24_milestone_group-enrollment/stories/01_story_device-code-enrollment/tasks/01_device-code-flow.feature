@cli @work @distribution @executable
Feature: the relay device-flow HTTP endpoint matches a presented code, consumes it single-use, admits the node + issues the credential, and bounds the 10^6 space with a TTL check + an attempt-cap
  In order to admit a fresh machine on a correct code while making the 6-digit (10^6) space infeasible to walk within the TTL — the load-bearing security contract
  serveRelay's existing http.createServer gains ONE device-flow route (POST /enroll, ABOVE the 426 fallback, NOT a ws kind) that reads the pending invites, matches + single-use-consumes a live code, admits the node to the roster + issues the credential { relayAuth, nodeId, gitRemote }, and rejects expired / already-consumed / malformed / unknown / cap-exceeded presentations with a STRUCTURED HTTP response (never a throw),
  so that a good live code admits + issues + consumes, every rejection is a structured HTTP status that admits + writes nothing, an expired or re-presented code is refused, and after resolveMaxAttempts failed presentations the endpoint refuses further attempts so 10^6 cannot be enumerated before the code expires.

  # ARCHITECTURE ADR-002 (move 2) + ADR-005 (attempt-cap + resolvers) + SECURITY.md T2/T4/T7: this
  # is THE match/reject matrix — the device-flow POST /enroll route on serveRelay's http.createServer,
  # ABOVE the 426 fallback (03/ADR-001 one-server discipline; NOT a ws kind). On a presented code it
  # reads pending invites (story 00), matches a codeHash, single-use-consumes (consumedAt), TTL-checks
  # (now > expiresAt → reject), attempt-caps (refuse after resolveMaxAttempts within the TTL); on a
  # match it admits (roster append via story 00's writeRegistry) + issues { relayAuth, nodeId,
  # gitRemote }. This feature asserts the OBSERVABLE admit/reject BEHAVIOUR over the real endpoint:
  # good code admits + issues + consumes; the reject matrix (expired / consumed / malformed / unknown
  # / cap-exceeded) each a STRUCTURED HTTP response that admits + writes NOTHING (R4); the attempt-cap
  # N-boundary; the resolver malformed-value→default tolerance. The constant-time compare + the hash
  # algorithm are the SECURITY-owned acd-enrollment-code-single-use-constant-time /
  # acd-enrollment-code-hashed-at-rest fitness — NOT asserted here (treat codeHash + relayAuth as
  # OPAQUE; assert the durable SHAPE + the observable admit/reject, never the crypto). The
  # ws-envelope-neutrality (enrollment is HTTP, not a ws kind) is the STRUCTURAL
  # acd-enroll-endpoint-http-not-ws fitness — here just assert the enroll exchange is answered over
  # HTTP and the ws envelope is untouched.
  #
  # QA FEASIBILITY FLAG (developer-amigo): drive the endpoint IN-PROCESS — serveRelay on an ephemeral
  # port (port: 0), a real HTTP POST to /enroll via node http/fetch (the m23 in-process relay
  # pattern), with the group registry seeded via story 00's writeRegistry. Inject issuedAt / expiresAt
  # and the "now" the endpoint reads to exercise the TTL boundary — NEVER wall-clock (22/R2). The
  # attempt-cap counter is EPHEMERAL in-memory on the endpoint (ADR-005) — assert refuse-after-N
  # within ONE process (no spawn, no restart). Treat codeHash + relayAuth as OPAQUE — the
  # constant-time compare + the hash algorithm are the SECURITY fitness, NOT asserted here. Buildable
  # @executable in-process (the m23 serveRelay-on-port-0 precedent proves the in-process HTTP round-
  # trip) — do NOT retag to @manual.
  Background:
    Given a relay stood up in-process via serveRelay on an ephemeral port (port 0) as the control node
    And the group registry seeded via story 00's writeRegistry over a fixture workspace
    And the device-flow endpoint accepts an injected "now" and reads the seeded pending invites (white-box over the TTL input)
    And an in-process HTTP client can POST a presented code to /enroll on the relay url

  # The headline: a GOOD code (live, unconsumed, within budget) matches → the node is ADMITTED
  # (appended to the roster via story 00) + a credential is ISSUED { relayAuth, nodeId, gitRemote } +
  # the pending invite is CONSUMED (single-use — consumedAt stamped). R4: pin the UNAFFECTED side —
  # the OTHER pending invites are untouched; only the matched one is consumed and exactly one roster
  # entry is appended.
  Scenario: a good live code matches — the node is admitted, a credential is issued, and the invite is consumed
    Given a pending invite for a live, unconsumed code within the TTL and the attempt budget
    When the joining node POSTs that code to /enroll with an injected now before expiresAt
    Then the response is a structured HTTP success carrying a credential { relayAuth, nodeId, gitRemote }
    And the joining node is appended to the registry roster exactly once ({ nodeId, admittedAt, boards })
    And the matched pending invite is consumed (consumedAt is stamped — single-use)
    And every OTHER pending invite is byte-unchanged (only the matched invite was consumed)

  # The reject matrix — every rejection is a STRUCTURED HTTP response (never a throw — the 03/ADR-003
  # never-crash discipline over HTTP), and each admits + writes NOTHING (R4: the roster is unchanged,
  # no credential is issued). Expired (now > expiresAt) → rejected; already-consumed (re-presented) →
  # rejected (single-use, T4 replay); malformed body / unknown code → a structured rejection, never a
  # throw. The "outcome" is the observable class of the structured rejection.
  Scenario Outline: the reject matrix — expired / consumed / malformed / unknown are structured rejections that admit nothing
    Given the registry state and presented body described by <presented code>
    When that presentation is POSTed to /enroll with an injected now
    Then the response is a structured HTTP rejection, not a thrown error (the process does not crash)
    And the rejection class is <outcome>
    And no node was admitted to the roster (the roster is byte-unchanged)
    And no credential was issued
    And no pending invite was consumed by the rejected presentation

    Examples:
      | presented code                                    | outcome             |
      | a code whose invite has expired (now > expiresAt) | rejected: expired   |
      | a code whose invite was already consumed          | rejected: consumed  |
      | an unknown code matching no pending invite        | rejected: no-match  |
      | a malformed request body (not a valid code)       | rejected: malformed |
      | an empty request body                             | rejected: malformed |

  # The attempt-cap (ADR-005; SECURITY T2/T7) — the load-bearing control that turns 10^6 from walkable
  # into safe. After resolveMaxAttempts(config) (default 5) FAILED presentations for a code/source
  # within the TTL, the endpoint REFUSES further attempts (a structured 429-class rejection). The
  # N-boundary is load-bearing (the 22/R2 "get the boundary literal right"): with the cap at 5, the
  # 1st..5th failed presentation is STILL ANSWERED (a normal reject), and the 6th (N+1) is REFUSED by
  # the cap. Injected now keeps every presentation inside the one TTL window. The Examples literal MUST
  # agree with the post-rule value: attempt 5 is allowed-through (a normal reject), attempt 6 is
  # cap-refused.
  Scenario Outline: the attempt-cap refuses further presentations after resolveMaxAttempts failures within the TTL
    Given resolveMaxAttempts(config) is 5 (the documented default)
    And a live pending invite whose code is NOT known to the attacker
    When the <attemptNumber>th failed presentation for that code/source is POSTed within the TTL
    Then the presentation is <disposition>

    Examples:
      | attemptNumber | disposition                                                   |
      | 1             | answered as a normal reject (within the attempt budget)       |
      | 4             | answered as a normal reject (within the attempt budget)       |
      | 5             | answered as a normal reject (the Nth is still allowed)         |
      | 6             | refused by the attempt-cap (a structured 429-class rejection) |
      | 7             | refused by the attempt-cap (a structured 429-class rejection) |

  # A successful match retires the bucket: even after failed attempts within budget, a subsequent
  # GOOD presentation still admits (and consumes the code, closing the window). R4: pin BOTH halves —
  # the failed attempts did NOT admit, AND the good presentation still admits + consumes (the bucket
  # is not left poisoning the correct code within its budget).
  Scenario: a successful match after some failed-but-in-budget attempts still admits and retires the bucket
    Given resolveMaxAttempts(config) is 5 and 4 failed presentations have been made for a live code/source within the TTL
    When the correct code for that source is POSTed within the TTL (the 5th presentation, in budget)
    Then the node is admitted and a credential is issued
    And the matched pending invite is consumed (the code is burned — the successful path closes the window)

  # The resolver tolerance (the resolveMaxFrameBytes shape): resolveCodeTtlSeconds /
  # resolveMaxAttempts fall back to the documented default on ANY malformed config.mesh.enrollment.*
  # value (absent / non-number / non-finite / non-integer / <= 0) WITHOUT crashing — mirroring m23's
  # staleness malformed table. With the default in force the endpoint still functions (a live code
  # within the default TTL and default budget admits).
  Scenario Outline: a malformed enrollment knob falls back to the documented default without crashing
    Given config.mesh.enrollment.codeTtlSeconds is <ttlConfigured> and config.mesh.enrollment.maxAttempts is <capConfigured>
    When a live code within the default TTL and default attempt budget is POSTed to /enroll
    Then no error is raised (a malformed knob never crashes the endpoint)
    And the ttl in force is the documented default 300 seconds
    And the attempt-cap in force is the documented default 5
    And the live code still admits (the endpoint functions on the defaults)

    Examples:
      | ttlConfigured  | capConfigured  |
      | absent (unset) | absent (unset) |
      | "not-a-number" | "not-a-number" |
      | 0              | 0              |
      | -1             | -1             |
      | 300.5          | 5.5            |
      | null           | null           |

  # Admission needs the control node ONLINE — there is no offline verification path. The endpoint is
  # on serveRelay, which serves in relay mode ONLY on the nominated control node (relayMode). With the
  # control node's relay down, there is no /enroll to POST to — the presentation cannot be answered by
  # any other party (no offline / peer-side admission).
  Scenario: admission requires the control node's relay online — there is no offline verification path
    Given the control node's relay is not running (serveRelay is down)
    When a joining node attempts to POST a code to the enrollment endpoint
    Then the presentation cannot be answered (the endpoint is unreachable — no offline admission path)
    And no node is admitted (admission requires the live control node)

  # The endpoint is an HTTP route ABOVE the 426 fallback, NOT a ws kind (the observable half of the
  # acd-enroll-endpoint-http-not-ws structural fitness). A device-flow POST is answered over HTTP, and
  # the ws { kind, nodeId, signal } envelope is UNTOUCHED. R4: pin the UNAFFECTED side — a ws signal
  # frame still fans out exactly as m23 pins it (the enrollment route did not perturb the ws path).
  Scenario: a device-flow POST is answered over HTTP and the ws envelope is untouched
    When a joining node POSTs a code to /enroll
    Then the enrollment exchange is answered over HTTP (a structured HTTP response, not a ws frame)
    And the ws { kind, nodeId, signal } envelope carries no enrollment kind
    And a ws signal frame still fans out to peers unchanged (the enrollment route left the ws path neutral)
