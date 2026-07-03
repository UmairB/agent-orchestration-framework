@ui @work @distribution @executable
Feature: the fleet face gains its FIRST write route — POST /api/mesh/issue reaches mesh:issue through the ONE registry door and returns the directive
  In order to issue work into the fleet from the same screen where the whole fleet is visible (KR3, PRD §7.1),
  the fleet serve-face gains one POST /api/mesh/issue route that reads a JSON body { ref, to? }, calls
  invoke("mesh:issue", { ref, to }, …) through command-core (the ONE door — never a direct mesh-issuance import),
  and answers with the directive record on success or a coded { ok:false, error, code } envelope on failure,
  so that the [assign ▸] affordance POSTs a directive an eligible node picks up, the read route still mutates
  nothing, a non-issue write is still refused (read-only-except-issue), and the command's own errors surface
  faithfully with the tree byte-unchanged.

  # ARCHITECTURE ADR-006.1 (the first write route on the m25 fleet face): src/mesh-ui-serve.mjs gains ONE
  # POST /api/mesh/issue handler that reads the body { ref, to? }, reaches the mutation ONLY via
  # invoke("mesh:issue", { ref, to }, { workspace }) through ./command-core.mjs — no second server, no
  # second port (the one 127.0.0.1 http.createServer), no direct mesh-issuance import. ADR-002 owns the
  # underlying command (resolve EXACTLY via resolveItemExact → assemble the frozen six-key directive →
  # own-partition write → one default-root sync); this route is the HTTP face in front of it.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #7 (acd-mesh-ui-write-isolation, SUPERSEDED in place at build — ARCHITECTURE §Fitness) is the
  #    STRUCTURAL assertion over src/mesh-ui-serve.mjs source: the ONLY mutation route is POST
  #    /api/mesh/issue, it reaches the mutation ONLY via invoke("mesh:issue") (no direct mesh-issuance /
  #    operation import, no bare writeFile/child_process in the face), and it serves NO other write route
  #    and NO /ws/terminal. acd-mesh-ui-single-server + acd-mesh-ui-no-core-import stay GREEN unchanged.
  #    ARCH-TESTS, never scenarios here. (Task 03 carries the BEHAVIOURAL half of #7 — the bounded-write
  #    posture observed over the wire.)
  #  - The same-origin / CSRF guard (SECURITY S-1 / T1) is TASK 01 — this task asserts the route REACHES
  #    the command and shapes the reply; task 01 asserts the guard that runs IN FRONT of it. A same-origin
  #    + application/json request is assumed here (the accepted request shape) so this task isolates the
  #    route mechanics; the refusal matrix is task 01's.
  #  - THIS feature asserts the OBSERVABLE route: a well-formed POST reaches mesh:issue and returns the
  #    directive (200); a malformed body is a coded error, never a crash; the read route is untouched; the
  #    command's errors (ref-not-found) surface faithfully with the tree byte-unchanged.
  #
  # QA FEASIBILITY FLAG (developer-amigo): how is the fleet face stood up + POSTed to IN-PROCESS for an
  #  @executable route test? The m25 story-02 harness is the lever: serveMeshUi({ projectDir, port: 0,
  #  repoRoot }) returns { server, url } and the tests fetch(new URL("/api/mesh/status", url)) against it
  #  (test/arch/acd-mesh-ui-write-isolation.test.mjs:136–163). A POST route test is the SAME harness with
  #  fetch(url, { method:"POST", headers:{ "content-type":"application/json", origin:url }, body:
  #  JSON.stringify({ ref, to }) }) — the board's POST /api/work/feedback + readJsonBody idiom
  #  (src/board-ui.mjs:126–137, :192) mirrored. THE OPEN QUESTION: mesh:issue WRITES a directive + PUSHES a
  #  sync (ADR-002.2/.4) — for an @executable route test that must NOT need a real bare remote or a live
  #  relay. Two candidate levers: (i) invoke mesh:issue against a fixture whose config has mesh.nodeId but
  #  syncMesh degrades HONESTLY with no remote (the push-failed envelope is the coded error — assertable as
  #  the { ok:false, code:"push-failed" } row, the directive already durable locally), OR (ii) an injected
  #  ctx that stubs the sync closure (the mesh:heartbeat ctx.relayClient injection precedent,
  #  src/commands/mesh-heartbeat.mjs:113 — does mesh:issue accept an injected sync via ctx?). WHICH lever the
  #  route test uses depends on how story 01 shapes mesh:issue's sync seam (does it read ctx for the sync
  #  closure, or only build from config?). RAISED — the developer wave RESOLVES which lever keeps every row
  #  @executable without a live remote; do NOT silently retag to @manual.
  #
  # RESOLVED (developer-amigo): the stand-up-and-POST harness lever is CONFIRMED, and lever (i) is the
  #  one story 01 shipped -- @executable stands unchanged, no retag.
  #  STAND-UP: serveMeshUi({ projectDir, port: 0, repoRoot }) returns { server, url }
  #  (src/mesh-ui-serve.mjs:45,152-157); the existing m25 behavioural test already drives this exact
  #  harness with fetch(new URL("/api/mesh/status", url)) (test/arch/acd-mesh-ui-write-isolation.test.mjs:
  #  144-151). A POST route test is the SAME harness: fetch(url, { method:"POST", headers:{
  #  "content-type":"application/json", origin: url }, body: JSON.stringify({ ref, to }) }) -- the board's
  #  POST /api/work/feedback + readJsonBody idiom (src/board-ui.mjs:126-139, :192-216) mirrored verbatim
  #  onto the new mesh-ui-serve.mjs handler.
  #  THE MUTATION-WITHOUT-A-REMOTE LEVER: story 01's task 00 (tasks/00_mesh-issue-command.feature:51-64,
  #  RESOLVED there) PINS lever (i) -- mesh:issue reads an INJECTED sync closure via ctx (mirroring
  #  ctx.relayClient at src/commands/mesh-heartbeat.mjs:113 / the runSync closure at
  #  src/commands/run-start.mjs:209-210), defaulting to () => syncMesh(ws) (default [meshDir] roots,
  #  ADR-002.4) when ctx carries none. The route test therefore reaches the SAME injection point through
  #  invoke("mesh:issue", { ref, to }, { workspace, syncRunner }) -- the route's ctx object passed to
  #  invoke threads a test-supplied syncRunner exactly as it threads workspace, so:
  #    - the "issues a directive and returns it" row (line 62) injects a syncRunner that resolves
  #      { committed:true, pushed:["..."], pulled:0, noop:false } (mesh-sync.mjs's real success envelope
  #      shape) -- no bare remote, no live relay, the directive write is asserted on disk directly;
  #    - a push-failure coded envelope is story 01's task-00 scenario, not this route's -- THIS route
  #      feature does not re-assert push-failure (that lives at fitness #1 / story 01); this route's job
  #      is only that a well-formed POST reaches invoke("mesh:issue") and returns whatever mesh:issue
  #      returns, honest failure included (the SAME faithful-passthrough shape the ref-not-found scenario
  #      below already exercises for a different mesh:issue error).
  #  No lever (ii) stub was needed at the route layer -- the route never touches sync at all; it hands ctx
  #  to invoke, and story 01's command owns the sync seam entirely (ADR-006.1's "the route is the HTTP
  #  face in front of it" -- the mutation-without-a-remote lever lives ONE layer down, already resolved).
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And mesh is configured with a stable mesh.nodeId for this node
    And the mesh:issue command is registered in the command core
    And node/presence/registry records planted so the fleet aggregate is non-empty
    And the fleet serve-face running on one 127.0.0.1 port
    And a same-origin, application/json request context (task 01 owns the guard; this task assumes it satisfied)

  # THE HEADLINE — a well-formed POST reaches mesh:issue and returns the directive (200). The route reads
  # the body { ref, to? }, calls invoke("mesh:issue", { ref, to }, { workspace }), and answers the directive
  # record. The frozen six-key directive (ADR-001.2: itemRef, issuer, target, state, issuedAt, aofVersion)
  # is the command's to shape — this route passes it through, it does not reshape it.
  Scenario: a same-origin POST /api/mesh/issue with a JSON body issues a directive and returns it
    Given a ready task item this node may issue
    When a same-origin POST /api/mesh/issue carries the JSON body { "ref": "<the item>", "to": "any" }
    Then the response is 200 carrying the directive record mesh:issue returned
    And the directive record carries itemRef "<the item>", issuer this node, and state "issued"
    And exactly one directive was written under this node's own issuance partition
    And the route reached the mutation through invoke("mesh:issue"), never a direct mesh-issuance import

  # The optional target rides through verbatim — the body's `to` becomes mesh:issue's target, disambiguated
  # DATA-DRIVEN against the roster (ADR-002.3): a known nodeId ⇒ { kind:"node" }, a capability string ⇒
  # { kind:"capability" }, absent ⇒ { kind:"any" }. This route does not disambiguate — it hands `to`
  # straight to the command (the command owns the union parse, ADR-003). The picker's node-vs-capability
  # resolution is that same disambiguation surfaced in the UI (task 02).
  Scenario Outline: the body's `to` rides through to mesh:issue's target union
    Given a ready task item this node may issue
    And a synced roster in which "<to>" resolves as a "<kind>" target
    When a same-origin POST /api/mesh/issue carries the JSON body { "ref": "<the item>", "to": "<to>" }
    Then the response is 200 carrying the directive record
    And the directive's target is the "<kind>" union arm mesh:issue parsed from "<to>"

    Examples:
      | to           | kind       |
      | any          | any        |
      |              | any        |
      | mac-studio   | node       |
      | codex        | capability |

  # A malformed / missing body is a CODED error envelope, never a crash — the { ok:false, error, code }
  # shape the whole face already speaks (mesh-ui-serve.mjs sendApiError; the board's readJsonBody
  # empty-json/malformed-json → 400 precedent, board-ui.mjs:140–148). The side-effect (a directive) is the
  # act, so a malformed request must NOT reach the mutation: no directive is written on any refused row.
  # Method-set note: only the well-formed-JSON body shapes vary here; the header/method refusals (wrong
  # method, cross-origin, non-json content-type) are task 01 + task 03.
  Scenario Outline: a malformed or missing body is a coded error and writes no directive
    Given a snapshot of the workspace's on-disk state
    When a same-origin application/json POST /api/mesh/issue carries the body "<body>"
    Then the response is a "<status>"-class { ok:false, error, code:"<code>" } envelope
    And no directive was written (the workspace's on-disk state is byte-unchanged)
    And no unhandled stack trace is printed

    Examples:
      | body                         | status | code            |
      | (empty request body)         | 400    | empty-json      |
      | not-json-at-all              | 400    | malformed-json  |
      | { "to": "any" }              | 404    | ref-not-found   |
      | { "ref": "" }                | 404    | ref-not-found   |
      | { "ref": 42 }                | 404    | ref-not-found   |

  # QA FEASIBILITY FLAG (developer-amigo): the coded `code` values above (empty-json / malformed-json from
  #  the body reader; missing-ref from the command/route) are the board's readJsonBody family + the
  #  write-isolation resolveItemExact family — but the EXACT code for a missing/blank/non-string `ref` is
  #  story 01's to pin (does mesh:issue reject a missing ref with code "missing-ref", or does the route
  #  pre-validate the body shape before invoke?). The LOAD-BEARING assertion is the PAIR (a coded envelope +
  #  no directive written), not the literal code string — if story 01 names the ref-validation code
  #  differently, this table's `code` column follows, the (envelope + no-write) assertion is unchanged.
  #  RAISED — the developer wave pins whether ref-shape validation lives in the route or the command.
  #
  # RESOLVED (developer-amigo): ref-shape validation lives in the COMMAND (mesh:issue), never the route --
  #  the route stays a pure pass-through of the parsed body to invoke("mesh:issue", { ref, to }, ctx). Two
  #  source-checked precedents pin this:
  #   - resolveItemExact(workDir, ref) (src/commands/resolve.mjs:26-30) already short-circuits on a falsy
  #     ref ("if (!ref) return null") -- an empty string, undefined, or (after JSON-number coercion) a
  #     non-string all resolve to null the SAME way a typo'd ref does, so "{ ref: "" }" and "{ ref: 42 }"
  #     both land on the exact ref-not-found path mesh:issue already owns (ADR-002.2, story 01's
  #     write-isolation precedent) -- NO separate route-side type check is structurally required to reach
  #     a coded refusal.
  #   - the codebase's own missing-ref precedent is command-level, not route-level: src/commands/
  #     feedback.mjs:43 -- "if (!ref) throw commandError("A target ref is required.", "missing-ref", 400);"
  #     -- lives INSIDE the feedback command, and board-ui.mjs's POST /api/work/feedback handler
  #     (src/board-ui.mjs:126-139) does zero ref validation of its own; it reads the body and calls invoke,
  #     letting the command's thrown commandError surface through the shared catch (:140-148) as the coded
  #     envelope. mesh-ui-serve.mjs's new /api/mesh/issue handler follows the IDENTICAL shape.
  #  THE PINNED CODE: mesh:issue is free to either (a) let resolveItemExact's null fall through to its
  #  EXISTING ref-not-found code (collapsing the "{ ref: "" }"/"{ ref: 42 }" rows onto the SAME code as a
  #  typo'd ref -- one validation path, not two), or (b) add an explicit upfront "if (!ref || typeof ref
  #  !== "string") throw commandError(..., "missing-ref", 400)" BEFORE calling resolveItemExact (the
  #  feedback.mjs shape, giving a distinct code for "no ref supplied" vs "ref supplied but not found").
  #  Story 01's task 00 feature (tasks/00_mesh-issue-command.feature) does not yet pin which of (a)/(b) it
  #  took for a blank/non-string ref (only the ref-not-found typo rows are scenario'd there) -- so THIS
  #  table's "<code>" column for the three ref-shape rows ("{}" empty body already covered by empty-json
  #  from the transport reader; "{ "to": "any" }", "{ "ref": "" }", "{ "ref": 42 }") follows WHICHEVER of
  #  missing-ref / ref-not-found story 01 actually ships -- confirm against the built mesh-issue.mjs at
  #  wiring time and update the Examples table's code cells to match (still 400-class either way). The
  #  LOAD-BEARING assertion -- the (coded envelope + no directive written) PAIR -- is unchanged regardless
  #  of which literal code lands. No retag; @executable stands.

  # The read route is UNTOUCHED by the write route landing beside it — GET /api/mesh/status still answers
  # the aggregate and still mutates nothing (the m25 read-only floor, task 05 of m25, preserved). The two
  # routes coexist on the one face; the read did not become a write.
  Scenario: GET /api/mesh/status still answers the aggregate and still mutates nothing
    Given a snapshot of the workspace's on-disk state
    When the fleet page requests "/api/mesh/status"
    Then the response is 200 carrying the nodes-and-boards aggregate
    And the workspace's on-disk state is byte-unchanged (the read route mutates nothing)

  # The read-only-EXCEPT-issue posture: a write METHOD/ROUTE that is not the issue route is still refused.
  # A write method on the read route is still a 405 (unchanged from m25); a write on an UNKNOWN /api/mesh
  # route is still a clean not-found. The write door opened for exactly ONE route, no wider. (The full
  # bounded-write matrix — every other write refused, no second write route, no /ws/terminal — is task 03.)
  Scenario Outline: a non-issue write method/route is still refused
    When the fleet server receives a "<method>" request to "<route>"
    Then the request is refused with a clean "<refusal>", not a crash
    And no state change occurs

    Examples:
      | method | route                | refusal            |
      | POST   | /api/mesh/status     | method-not-allowed |
      | PUT    | /api/mesh/issue      | method-not-allowed |
      | DELETE | /api/mesh/issue      | method-not-allowed |
      | POST   | /api/mesh/assign     | not-found          |
      | POST   | /api/mesh/revoke     | not-found          |

  # The route surfaces mesh:issue's OWN errors FAITHFULLY — a ref-not-found (the resolveItemExact
  # write-isolation miss, ADR-002.2: a typo'd ref returns ref-not-found, never issues the wrong item) is
  # passed through as the coded error, and the tree is byte-unchanged (no partial directive, no wrong item
  # issued). The face maps the command's error to its { ok:false, error, code }/status envelope exactly as
  # the read route maps mesh:status errors (mesh-ui-serve.mjs:93–95).
  Scenario: a ref-not-found from mesh:issue surfaces as a coded error and issues nothing
    Given a snapshot of the workspace's on-disk state
    And a ref that resolves to no item (a typo, not a real item)
    When a same-origin application/json POST /api/mesh/issue carries the JSON body { "ref": "<the typo>", "to": "any" }
    Then the response is a 404-class { ok:false, error, code:"ref-not-found" } envelope (mesh:issue's error, surfaced faithfully)
    And no directive was written for any item (the workspace's on-disk state is byte-unchanged)

  # A miss never takes the server down: a follow-up read proves the face survived the coded error (the m25
  # server-survives-a-miss discipline, mesh-ui-serve serves the next request clean).
  Scenario: a coded error does not crash the face — the next request still answers
    Given the previous POST returned a coded error envelope
    When the fleet page requests "/api/mesh/status" again
    Then the response is 200 (the coded error did not crash the server)
