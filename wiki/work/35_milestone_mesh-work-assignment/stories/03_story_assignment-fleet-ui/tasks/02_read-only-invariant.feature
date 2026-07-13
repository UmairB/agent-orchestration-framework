@executable @ui @work @distribution
Feature: The mesh UI serve face exposes NO assignment write route — the m34 read-only posture is re-armed over the new status shape
  In order to keep assign a deliberate CLI-only action and the fleet view a pure read-only dashboard
  the `mesh-ui-serve` face rejects every non-GET/HEAD method with a 405, destroys every upgrade, and matches no
  assign/issue mutating route — and the story-03 status extension adds no write branch
  so that extending the READ shape never opens a WRITE surface (ADR-007: assign is CLI-only; a guarded POST is deferred).

  # ADR-007 (this milestone) — `aof mesh assign <ref> --to <nodeId>` is the verb; the fleet UI stays READ-ONLY
  # and renders lifecycle only. This RE-ARMS the m34 read-only posture (34/ADR-007; the m34 read-only test) over
  # the story-03 shape, exactly as `acd-mesh-ui-read-only` (fitness #11) specifies. A guarded same-origin+json
  # `POST /api/mesh/assign` is DEFERRED, not designed — adding it would reverse the m34 decision and must be its
  # own ADR.
  #
  # FEASIBILITY-CONFIRMED (src/mesh-ui-serve.mjs): `sendMethodNotAllowed(response, "GET, HEAD")` fires on every
  # non-GET/HEAD (`/api/mesh/status` :155, `/api/mesh/board-url` :113) with a 405 + an `allow` header (:316-319);
  # `server.on("upgrade", (_req, socket) => socket.destroy())` (:223-229) refuses every upgrade; the only routes
  # are `GET /api/mesh/status`, `GET /api/mesh/board-url`, and the static bundle — NO `/api/mesh/assign` or
  # `/api/mesh/issue` handler exists, and the whole server does zero fs write and no shell-out. Story 00's shape
  # extension threads assignment rows through the READ path (`shapeGlobalStatus`) — it adds no new route and no
  # mutating branch. These are static/behavioural facts over the serve face → @executable, no browser.
  #
  # SEAM SPLIT — this is the read-only POSTURE (does the write surface stay closed). The read SHAPE is task 00;
  # the pure chip mapping is task 01; the @uat visual "no interactive control on screen" (no assign/accept/revoke
  # button, DESIGN Review Notes) is task 03. This task is the WIRE-level statement; task 03 is the VISUAL one.
  # The a11y lane is OFF for this story (no "a11y" in work.tags.domains — no axe-core run, no a11y finding).

  Background:
    Given a fixture ui/dist is present
    And a mesh UI serve face started with scope "global"
    And the mesh UI data dependencies are injected

  # Every mutating method on every /api/mesh/* route is a clean 405 with an Allow header naming the safe methods
  # — never a state change, never a crash. GET/HEAD are the safe methods; every write verb is rejected before any
  # handler runs. The extended status shape did not add a POST branch to /api/mesh/status.
  Scenario Outline: every non-GET/HEAD method on a mesh route is a 405 method-rejection with an Allow header
    When the browser requests `<method> <route>`
    Then the response status is 405
    And the Allow header is "GET, HEAD"
    And the response body has code "method-not-allowed"
    And no store write, fs write, or shell-out occurs

    Examples: the mutating verbs on the status read route
      | method | route            |
      | POST   | /api/mesh/status |
      | PUT    | /api/mesh/status |
      | PATCH  | /api/mesh/status |
      | DELETE | /api/mesh/status |

    Examples: the mutating verbs on the board-url read route
      | method | route              |
      | POST   | /api/mesh/board-url |
      | PUT    | /api/mesh/board-url |
      | DELETE | /api/mesh/board-url |

  # The safe methods still read (the 405 rail rejects only mutations, never GET/HEAD): a GET is served, a HEAD
  # falls through to the same read. This proves the 405 is a method rail, not a broken route.
  Scenario: GET and HEAD on the status route are still served
    When the browser requests `GET /api/mesh/status`
    Then the response status is 200
    When the browser requests `HEAD /api/mesh/status`
    Then the response status is 200

  # There is NO assignment write route to match at all — a `POST /api/mesh/assign` (or `/api/mesh/issue`, the
  # retired capability's write route) is a clean not-found on this DISJOINT fleet face, never a mutating handler.
  # The absence is structural: no route pattern matches these paths with a write handler.
  Scenario Outline: no assignment write route exists — assign/issue paths are not mutating handlers
    When the browser requests `<method> <route>`
    Then no mutating handler runs and no assignment is created, updated, or withdrawn
    And the response is a clean not-found or method-rejection, never a 2xx write acknowledgement
    And no directive is sent and no store row is written

    Examples: the deferred/retired write paths must not resolve to a handler
      | method | route             |
      | POST   | /api/mesh/assign  |
      | POST   | /api/mesh/issue   |
      | DELETE | /api/mesh/assign  |
      | PUT    | /api/mesh/assign  |

  # Every WebSocket upgrade is refused by destroying the socket — there is no UI WebSocket/SSE at all (ADR-007:
  # "live" is the 5s poll, not a UI push; the control<->worker WS is a BACKEND transport the browser never opens).
  # An operator's muscle-memory /ws/terminal attempt is a clean refusal, never a hang and never a session.
  Scenario Outline: every upgrade attempt is refused — the socket is destroyed, no session opens
    When the browser attempts a WebSocket upgrade on "<upgrade-path>"
    Then the serve face destroys the socket
    And no WebSocket session is established
    And no terminal or push channel is opened

    Examples: upgrade attempts on the fleet face
      | upgrade-path      |
      | /ws/terminal      |
      | /api/mesh/status  |
      | /                 |

  # The story-03 status extension added NO write branch: the ONLY code path the extended shape touches is the
  # READ path (queryGlobalMeshStatus -> shapeGlobalStatus, threading assignment rows through). The serve face's
  # route table is unchanged in shape — still exactly the two GET routes + the static bundle, still zero fs
  # write and no shell-out. (This is the `acd-mesh-ui-read-only` structural re-arm, seen behaviourally.)
  Scenario: the extended status shape added no write branch — the read-only route table is unchanged
    Given the story-03 assignment rows are threaded through the status read path
    When the serve face's routes are exercised end to end
    Then the only routes are GET /api/mesh/status, GET /api/mesh/board-url, and the static bundle
    And no route was added for assign, issue, or any assignment mutation
    And the extended read path performs zero fs write and no shell-out
    And the m34 read-only guarantee holds byte-for-byte over the new shape
