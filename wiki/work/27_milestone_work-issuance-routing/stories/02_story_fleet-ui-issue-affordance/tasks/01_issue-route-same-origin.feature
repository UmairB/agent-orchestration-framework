@ui @work @distribution @executable
Feature: the write route enforces a same-origin + non-simple-content-type guard BEFORE the mutation — a cross-origin or form POST is refused, the directive never written (SECURITY T1 / S-1)
  In order that a malicious page the operator visits cannot forge a cross-origin POST to the loopback write
  route and cause an eligible peer to run attacker-influenced work (loopback bind alone is NOT CSRF
  protection — the operator's browser IS on loopback),
  the POST /api/mesh/issue handler REJECTS a request whose Origin/Sec-Fetch-Site is present-and-foreign AND
  requires content-type: application/json, and it runs that guard BEFORE invoke("mesh:issue"),
  so that a same-origin JSON fleet-UI request is accepted, a cross-origin forgery is a clean 403, a bare
  HTML-form / simple-request POST (the classic CSRF vector that escapes the preflight) is refused, and a
  refused request mutates NOTHING (the side-effect is the attack, so refusal must precede the write).

  # SECURITY.md T1 / fitness S-1 (acd-mesh-issue-route-same-origin) — the milestone's sharpest NEW security
  # call, the first inbound mutation on the loopback face. The minimal sufficient control is BOTH halves
  # (neither alone suffices, SECURITY §"The CSRF / same-origin call"):
  #   (1) SAME-ORIGIN CHECK — reject a POST whose Origin is present and not the loopback origin
  #       (http://127.0.0.1:<port> / http://localhost:<port>), and/or whose Sec-Fetch-Site is present and
  #       not "same-origin". Both headers are browser-attached + un-forgeable by page JS.
  #   (2) NON-SIMPLE CONTENT-TYPE — require content-type: application/json. This forces a preflight for any
  #       cross-origin fetch (so the same-origin check on the preflight blocks it) AND refuses a bare
  #       HTML-<form> POST (which can send only text/plain/urlencoded/multipart — the one CSRF vector that
  #       escapes the preflight entirely). Making content-type a REQUIREMENT (not just an assumption the
  #       board's readJsonBody makes) is the closing half.
  # NOT a CSRF token (SECURITY: the face is cookie-less — no ambient credential for CSRF to ride; same-origin
  # + application/json fully closes the browser-CSRF vector for a loopback SPA; a token is belt-and-braces
  # over an already-closed vector, deferred as R-3).
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness S-1 (acd-mesh-issue-route-same-origin.test.mjs — SECURITY §Security fitness functions) is the
  #    STRUCTURAL assertion over src/mesh-ui-serve.mjs source: the /api/mesh/issue branch references an
  #    origin/sec-fetch header read AND a content-type/application/json check on the same path that reaches
  #    invoke("mesh:issue"); a planted route with a bare invoke and no guard fails the detector. Green-now in
  #    the existsSync-guarded / XOR form (either no /api/mesh/issue route — the m25 tree, vacuously satisfied
  #    — OR the route is present AND carries both guards). ARCH-TEST, never a scenario here.
  #  - THIS feature asserts the OBSERVABLE guard: same-origin+json ⇒ accepted; cross-origin ⇒ 403, no
  #    directive; no-origin+form ⇒ refused, no directive; same-origin+non-json ⇒ refused, no directive; and
  #    the refusal PRECEDES the mutation (a refused request writes nothing — the load-bearing ordering).
  #  - The route MECHANICS behind an accepted request (reaches mesh:issue, returns the directive, coded
  #    errors) are task 00 — this task owns only the guard in front of it.
  #
  # QA FEASIBILITY FLAG (developer-amigo): does the guard read Origin OR Sec-Fetch-Site, and how does the
  #  @executable test set request headers? SECURITY §"The minimal control" specifies "Origin ... and/or
  #  Sec-Fetch-Site" — BOTH are browser-attached + un-forgeable by page JS. FOR THE TEST: fetch/http.request
  #  in Node CAN set arbitrary headers (unlike a browser), so the harness sets them explicitly —
  #  fetch(url, { method:"POST", headers:{ origin: "http://evil.example", "content-type":"application/json" },
  #  body: … }) drives the cross-origin row; a matching origin drives the accepted row; omitting
  #  content-type / setting "text/plain" / "application/x-www-form-urlencoded" drives the form/simple rows.
  #  THE OPEN QUESTION: which header(s) the guard treats as AUTHORITATIVE (Origin present-and-foreign, or
  #  Sec-Fetch-Site present-and-not-same-origin, or EITHER-present-and-foreign ⇒ refuse), AND the
  #  present-vs-absent policy (a same-origin fetch DOES send Origin on a cross-origin-capable request but a
  #  same-site navigation may omit it — does an ABSENT Origin+Sec-Fetch on a json POST pass or fail?). The
  #  SECURITY doc says a same-origin fleet-UI request "carries the matching Origin and passes"; the
  #  absent-both edge is the developer's to pin (fail-closed vs the cookie-less-loopback fail-open reasoning).
  #  RAISED — the developer wave pins the header set + the absent-header policy; the Examples table's
  #  {origin, sec-fetch, content-type} columns follow that pin, the accept/refuse VERDICT column does not.
  #
  # RESOLVED (developer-amigo): the guard reads EITHER header (Origin OR Sec-Fetch-Site — whichever is
  #  present-and-foreign refuses), AND the absent-both edge on a same-origin-capable request is TREATED AS
  #  PASS (fail-open on absence, fail-closed on presence-and-foreign) — matching SECURITY.md's own wording
  #  and, load-bearingly, matching EXACTLY what the arch-test already on the tree greps for.
  #  SOURCE-CHECKED against test/arch/acd-mesh-issue-route-same-origin.test.mjs (already on the tree,
  #  S-1's structural detector — the resolution MUST match what it fires/stays-quiet on):
  #   - hasSameOriginGuard (:58-62) accepts ANY of three forms: a `headers.origin`/`headers["origin"]`
  #     read, OR a `sec-fetch-site`/`sec-fetch` reference, OR an `origin`-near-`127.0.0.1` proximity match
  #     — i.e. the detector is an OR across the header set, never demanding both. So the route may
  #     implement EITHER header (or both); a single Origin-only check (as the detector's own "guarded" self
  #     -check fixture at :125-139 demonstrates — it reads ONLY request.headers.origin, no Sec-Fetch at
  #     all, and the detector accepts it at :140) already satisfies S-1.
  #   - hasContentTypeRequirement (:66-68) requires BOTH "content-type" and "application/json" text present
  #     — the non-simple-content-type half is NOT optional, matching SECURITY's "both halves required."
  #  THE CONCRETE MINIMAL GUARD (recommended, matching SECURITY §"The minimal control" + the detector's
  #  accepted self-check fixture verbatim): read `request.headers.origin`. If present AND it does not equal
  #  the loopback origin the server itself is bound to (`http://127.0.0.1:<port>`, derived from
  #  `server.address().port` — the SAME address the route already binds, mesh-ui-serve.mjs:152-153),
  #  REFUSE (403, code "forbidden" or "cross-origin"). If content-type is absent or not
  #  "application/json" (a substring/regex check, mirroring the detector's `/application\/json/` test),
  #  REFUSE (403 or 415, coded). Reading Sec-Fetch-Site ADDITIONALLY (if present and not "same-origin" ⇒
  #  refuse) is a sound belt-and-braces addition the detector also accepts, but is NOT required to satisfy
  #  S-1 or SECURITY's minimal-control call — Origin-alone + content-type-required is sufficient and is the
  #  simplest form that matches BOTH the arch-test and board-ui.mjs's existing header-read idiom style.
  #  THE ABSENT-BOTH POLICY (fail-open on absence): a POST with NEITHER Origin NOR Sec-Fetch-Site present
  #  is NOT refused BY THE ORIGIN HALF of the guard — this matches a genuine same-site browser navigation
  #  that legitimately omits Origin on some request shapes (SECURITY §"a same-origin fleet-UI request
  #  carries the matching Origin and passes" implies Origin PRESENT-and-matching is the expected happy
  #  path, but the threat model never asserts an absent Origin must be refused — only a PRESENT-AND-FOREIGN
  #  one). Critically, the "no-origin + form" refused row in the Examples table (line 91) is STILL refused
  #  — not because Origin is absent, but because its content-type
  #  (application/x-www-form-urlencoded) fails the SEPARATE, ALWAYS-ENFORCED content-type-required half.
  #  So the two guard halves compose as: content-type:application/json is REQUIRED unconditionally (closes
  #  the form-POST vector even when Origin is silent); Origin/Sec-Fetch-Site is checked ONLY when present,
  #  and refuses ONLY when foreign. This is fail-closed on the vector that matters (the classic CSRF
  #  simple-request has no application/json content-type to offer) and does not spuriously refuse a
  #  legitimate same-origin fetch that happens to omit Origin. No header-set / policy change to the
  #  Examples table is needed — the table as authored already matches this resolution exactly (row 3's
  #  "REFUSED" is carried entirely by the content-type half, which the table's own comment at lines 77-80
  #  already documents). No retag; @executable stands.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And mesh is configured with a stable mesh.nodeId for this node
    And the mesh:issue command is registered in the command core
    And the fleet serve-face running on one 127.0.0.1 port (the loopback same-origin is http://127.0.0.1:<port>)
    And a ready task item this node may issue
    And a snapshot of the workspace's on-disk state before each request

  # THE HEADLINE — a genuine same-origin fleet-UI request (matching Origin + Sec-Fetch-Site: same-origin +
  # content-type: application/json) is ACCEPTED and reaches the mutation. This is the legitimate request the
  # [assign ▸] affordance sends; the guard passes it (task 00 owns the mutation that follows).
  Scenario: a same-origin application/json POST is accepted and issues the directive
    When a POST /api/mesh/issue carries Origin the loopback origin, Sec-Fetch-Site "same-origin", content-type "application/json", and a valid JSON body
    Then the request passes the same-origin guard
    And it reaches invoke("mesh:issue") and returns the directive record (200)
    And exactly one directive was written under this node's own issuance partition

  # THE REFUSAL MATRIX — the complete guard equivalence class. For every REFUSED row the response is a
  # 403-class coded envelope AND no directive is written (the guard ran BEFORE invoke — the mutation is the
  # attack, so it must never be reached). The four rows the brief pins:
  #   - same-origin + json      ⇒ ACCEPT (the legitimate fleet-UI request);
  #   - cross-origin + json     ⇒ REFUSE (a forged fetch from a malicious page — a foreign Origin);
  #   - no-origin + form        ⇒ REFUSE (a bare HTML-<form> simple-request POST — no preflight, form
  #                                content-type — the classic CSRF vector both halves must close);
  #   - same-origin + non-json  ⇒ REFUSE (a text/plain simple request — even same-origin, the non-simple
  #                                content-type requirement refuses it, closing the simple-request send).
  Scenario Outline: the same-origin + content-type guard accepts only a same-origin JSON request; every other shape is refused with no directive written
    When a POST /api/mesh/issue carries Origin "<origin>", Sec-Fetch-Site "<sec-fetch>", and content-type "<content-type>", with a body that would otherwise issue
    Then the request is "<verdict>"
    And the on-disk directive state is "<directive>"
    And when refused the response is a "<response>"

    Examples:
      | origin           | sec-fetch    | content-type                        | verdict  | directive       | response                         |
      | loopback         | same-origin  | application/json                    | ACCEPTED | one written     | 200 with the directive           |
      | http://evil.test | cross-site   | application/json                    | REFUSED  | none written    | 403 { ok:false, code:"forbidden" } |
      | (absent)         | (absent)     | application/x-www-form-urlencoded   | REFUSED  | none written    | 403 { ok:false, code:"forbidden" } |
      | loopback         | same-origin  | text/plain                          | REFUSED  | none written    | 415/403 { ok:false } coded envelope |

  # THE LOAD-BEARING ORDERING — the guard runs BEFORE invoke("mesh:issue"). A refused request mutates
  # NOTHING: the directive write is the side-effect the attacker wants, so refusal must SHORT-CIRCUIT before
  # the mutation is reached. This is the strongest observable form of "the guard closes the CSRF vector" —
  # not merely a 403 status, but a 403 with the disk provably untouched.
  Scenario: a refused cross-origin POST never reaches the mutation — the directive write is short-circuited
    Given a snapshot of the workspace's on-disk state
    When a cross-origin POST /api/mesh/issue carries a body that WOULD issue a valid directive if accepted
    Then the response is a clean 403 (the same-origin guard refused it)
    And invoke("mesh:issue") was never called (the guard short-circuited before the mutation)
    And the workspace's on-disk state is byte-unchanged (no directive, no partial write — the attack had no side-effect)

  # A form POST is the specific vector both halves close TOGETHER: a bare HTML-<form> can only send a
  # simple content-type (no preflight), and the same-origin header may be absent — so the content-type
  # requirement is the half that refuses it even when the origin check is inconclusive. Pinned as its own
  # scenario because SECURITY.md calls it "the one CSRF vector that escapes the preflight requirement
  # entirely".
  Scenario: a bare HTML-form simple-request POST is refused by the content-type requirement
    When a POST /api/mesh/issue carries a form content-type (application/x-www-form-urlencoded) and a form-encoded body
    Then the request is refused (the non-simple-content-type requirement rejects the form POST)
    And no directive was written
    And the refusal is a coded envelope, not a crash

  # The guard does not blind the READ route: GET /api/mesh/status has no side-effect (a safe method) and is
  # exempt from the same-origin guard (SECURITY: "a GET read route is exempt — no side effect; the first
  # write route is not"). The read still answers cross-origin-or-not exactly as m25 shipped it — the guard is
  # scoped to the write route.
  Scenario: the same-origin guard is scoped to the write route — the read route is unguarded and unchanged
    When a cross-origin GET /api/mesh/status is requested (a safe method, no side-effect)
    Then the read still answers 200 with the aggregate (the guard does not touch the read route)
