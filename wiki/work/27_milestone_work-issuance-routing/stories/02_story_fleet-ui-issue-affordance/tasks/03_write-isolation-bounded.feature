@ui @work @distribution @executable
Feature: the fleet face is bounded-write — POST /api/mesh/issue is its ONLY mutation route, every other write is refused, and the single 127.0.0.1 server is otherwise unchanged (the behavioural half of fitness #7)
  In order that opening the first write route relaxes the m25 read-only posture by EXACTLY one bounded edge and no wider (ADR-006.2 — a pinned flip, not a drive-by),
  the fleet face admits exactly ONE mutation route (POST /api/mesh/issue), refuses every other write method /
  route with a clean 405 / not-found, serves NO /ws/terminal and NO second write route, and stands up the
  same single 127.0.0.1 server,
  so that the write door opened for one route only, the read-only-except-issue posture holds observably over
  the wire, and the m25 single-server / no-terminal / disjoint-namespace guarantees survive the flip intact.

  # ARCHITECTURE ADR-006.2 — EXACTLY ONE guard flips: acd-mesh-ui-write-isolation moves from "the fleet face
  # writes NOTHING and serves no write route" (m25) to a BOUNDED-WRITE assertion: the ONLY mutation route is
  # POST /api/mesh/issue, reaching the mutation ONLY via invoke("mesh:issue") (no direct mesh-issuance /
  # operation import, no bare writeFile/child_process in the face), serving NO other write route and NO
  # /ws/terminal. acd-mesh-ui-single-server + acd-mesh-ui-no-core-import stay GREEN unchanged.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature (the m25 task-05 pattern):
  #  - fitness #7 (acd-mesh-ui-write-isolation.test.mjs, SUPERSEDED in place at build — ARCHITECTURE
  #    §Fitness) is the STRUCTURAL SOURCE assertion over src/mesh-ui-serve.mjs: the ONE write route reaches
  #    invoke("mesh:issue"), no direct operation import, no bare writeFile/child_process, no second write
  #    route, no /ws/terminal; XOR/consistency-phrased (GREEN on the m25 zero-write tree OR on the exactly-
  #    one-route tree; RED only in the broken half). acd-mesh-ui-single-server (one http.createServer on
  #    127.0.0.1, never /api/work*) + acd-mesh-ui-no-core-import (imports only ./command-core.mjs) stay
  #    GREEN unchanged. ARCH-TESTS, never scenarios here.
  #  - The SAME-ORIGIN guard on the write route is task 01 (S-1); the route MECHANICS + coded errors are
  #    task 00; the visual affordance is task 02.
  #  - THIS feature asserts the OBSERVABLE bounded-write posture: the ONE write route is the issue route,
  #    EVERY other write method/route is refused, no /ws/terminal, no second write route, the single server
  #    is otherwise unchanged, and serving the read view still mutates nothing.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the same serveMeshUi({ projectDir, port: 0, repoRoot }) harness
  #  task 00 uses stands this face up in-process; the refusal matrix is driven with fetch(url, { method,
  #  headers, … }) per row (the m25 acd-mesh-ui-write-isolation behavioural test already drives GETs against
  #  this harness — test/arch/acd-mesh-ui-write-isolation.test.mjs:136–163; the upgrade-refused rows are the
  #  server.on("upgrade", socket => socket.destroy()) path, mesh-ui-serve.mjs:134–140, drivable with a
  #  ws/http-upgrade client). NO open feasibility question specific to this task beyond task 00's
  #  stand-up-and-POST lever (RAISED there) — the refusals need no mutation to succeed (they refuse BEFORE
  #  any write), so they are @executable with no remote/relay at all. NOTE: the ONE accepted write row
  #  (POST /api/mesh/issue succeeds) inherits task 00's remote/sync lever; the refusal rows do not.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And mesh is configured with a stable mesh.nodeId for this node
    And the mesh:issue command is registered in the command core
    And the fleet serve-face running on one 127.0.0.1 port
    And a snapshot of the workspace's on-disk state

  # THE ONE WRITE ROUTE — POST /api/mesh/issue is the SOLE mutation route on the face (accepted with a
  # same-origin+json request — task 01's guard; task 00's mechanics). This scenario pins that it EXISTS as
  # the one write door; the next scenarios pin that every OTHER write is refused.
  Scenario: POST /api/mesh/issue is the one accepted mutation route on the fleet face
    Given a same-origin application/json request and a ready item this node may issue
    When a POST /api/mesh/issue carries a valid JSON body
    Then the request is accepted and reaches the mutation (a directive is issued)
    And this is the ONLY route on the face that reaches a mutation

  # EVERY OTHER WRITE METHOD/ROUTE IS REFUSED — the read-only-except-issue posture over the wire. A write
  # method on the read route is a clean 405 (unchanged from m25); a write on any OTHER /api/mesh path
  # (including the would-be sibling verbs assign/route/revoke, which must NOT exist as routes) is a clean
  # not-found. Method-set completeness: POST/PUT/PATCH/DELETE is the full mutating set; GET/HEAD/OPTIONS are
  # safe methods and deliberately not in the matrix. Every refused row changes no state.
  Scenario Outline: a write method/route that is not POST /api/mesh/issue is refused with no state change
    When the fleet server receives a "<method>" request to "<route>"
    Then the request is refused with a clean "<refusal>", not a crash
    And no state change occurs
    And a follow-up "/api/mesh/status" request still answers (the refusal did not crash the server)

    Examples:
      | method | route             | refusal            |
      | POST   | /api/mesh/status  | method-not-allowed |
      | PUT    | /api/mesh/status  | method-not-allowed |
      | PATCH  | /api/mesh/status  | method-not-allowed |
      | DELETE | /api/mesh/status  | method-not-allowed |
      | PUT    | /api/mesh/issue   | method-not-allowed |
      | PATCH  | /api/mesh/issue   | method-not-allowed |
      | DELETE | /api/mesh/issue   | method-not-allowed |
      | POST   | /api/mesh/assign  | not-found          |
      | POST   | /api/mesh/route   | not-found          |
      | POST   | /api/mesh/revoke  | not-found          |
      | POST   | /api/work/feedback| not-found          |

  # NO SECOND WRITE ROUTE — the disjoint /api/mesh namespace (25/ADR-003) is preserved: the face serves no
  # /api/work* route at all (a board write is a not-found, never a proxied board), so the write door is the
  # one /api/mesh/issue route and nothing on the board's frozen namespace.
  Scenario: the fleet face serves no /api/work write route (the disjoint namespace holds)
    When the fleet server receives a "POST" request to "/api/work/feedback"
    Then the response is a 404 not-found (no board write is proxied through the fleet face)
    And no board data is mutated or proxied

  # NO /ws/terminal — the face serves no terminal websocket and no upgrade at all (25/ADR-004; the
  # server.on("upgrade", … socket.destroy()) path). An operator's muscle-memory /ws/terminal attempt is a
  # clean refusal, never a terminal session — the write route did not bring a terminal with it.
  Scenario Outline: the fleet face serves no terminal websocket — every upgrade is refused
    When a websocket upgrade is attempted against the fleet server at "<path>"
    Then the upgrade is refused (the socket is destroyed)
    And no terminal session is opened

    Examples:
      | path         |
      | /ws/terminal |
      | /            |
      | /api/mesh    |

  # THE SINGLE SERVER IS UNCHANGED — the write route lands on the SAME one http.createServer bound to
  # 127.0.0.1 (no second server, no second port — acd-mesh-ui-single-server stays green). The face still
  # binds one loopback port and serves the bundle + the /api/mesh routes off it.
  Scenario: the write route is on the same single 127.0.0.1 server — no second server, no second port
    Then the fleet face binds exactly one 127.0.0.1 port
    And both GET /api/mesh/status and POST /api/mesh/issue are served off that one server
    And no second server or second port was stood up for the write route

  # SERVING THE READ VIEW STILL MUTATES NOTHING — the strongest observable form of the bounded-write floor:
  # loading the page + reading /api/mesh/status repeatedly (with NO issue POST) changes no file. The write
  # route's existence did not make the READ path mutate. (Distinct from m25's identical scenario only in that
  # the write route now exists beside the read — and STILL the read mutates nothing.)
  Scenario: serving and rendering the fleet view (no issue POST) changes no files
    Given a snapshot of the workspace's on-disk state
    When the fleet page is loaded and /api/mesh/status is read repeatedly, with no POST /api/mesh/issue sent
    Then the workspace's on-disk state is byte-unchanged (rendering writes nothing — only the issue route mutates)
