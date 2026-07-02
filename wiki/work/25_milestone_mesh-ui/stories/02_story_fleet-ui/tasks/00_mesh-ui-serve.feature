@cli @work @distribution @executable
Feature: aof mesh ui stands up the fleet serve-face — one 127.0.0.1 server answering /api/mesh/status through the registry
  In order to open the fleet mission-control view from any node with one command,
  aof mesh ui starts the fleet's own thin serve-face — one server on 127.0.0.1 serving the fleet
  bundle and the GET /api/mesh/status route, which answers with exactly the mesh:status aggregate,
  so that the web view reads the same { nodes, boards } facts as the CLI mirror (one command, two
  faces), the fleet routes live in their own /api/mesh namespace disjoint from the board's frozen
  /api/work, and an unknown route is a clean not-found, never a crash.

  # ARCHITECTURE ADR-003: a NEW src/mesh-ui-serve.mjs (the board-serve.mjs sibling) behind a
  # CLI-only meshCommand "ui" branch (a serve verb, NOT a registered mesh:* command — it stays
  # out of the mesh bijection). The face's ONLY fleet-data reach is invoke("mesh:status") via
  # command-core — that it imports no operation module, stands up exactly one server, and
  # writes nothing are the acd-mesh-ui-no-core-import / acd-mesh-ui-single-server /
  # acd-mesh-ui-write-isolation / acd-mesh-ui-single-data-command arch-tests (ARCHITECTURE
  # §Fitness C), NOT re-asserted here. This feature asserts the OBSERVABLE serve: the verb
  # starts it, the route answers the aggregate, the namespace is disjoint. Read-only-ness is
  # task 05; the rendered regions are tasks 01–03.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And node, presence, and registry records planted so the fleet aggregate is non-empty

  # The headline: the serve verb stands the face up, same-origin on one local port.
  #
  # DEV (missing-bundle failure mode — flag resolved): the fleet face REUSES ui/dist with a
  # ?mode=fleet selector (the proven bundle mechanism: main.tsx:1260 reads
  # `new URLSearchParams(location.search).get("mode")` → ?mode=board renders <Board/>, story 03
  # adds a <Fleet/> branch for ?mode=fleet — the same single bundle, one more mode). The
  # missing-bundle guard is the SAME as the board's: serveBoard refuses with error.code
  # "ui-build-missing" + the message "The board UI build is missing at <dist>. Build it first:
  # npm --prefix ui run build" (board-serve.mjs:27-33), caught in the CLI verb (cli.mjs:870-873)
  # to print + exit 1, never a stack trace. Because the guard behaviour MATCHES the board's, the
  # missing-bundle scenario is added below with the board's literal.
  # NOTE (structural, not a Contract literal): the fleet face must stand up its OWN
  # http.createServer bound to 127.0.0.1 (ADR-003 decision 2's "a server of its own"), NOT reuse
  # serveSetupUi — that server unconditionally wires handleWorkApi (setup-ui.mjs:120) AND
  # attachTerminalWebSocket (setup-ui.mjs:142), which would give the fleet face a /api/work route
  # and a /ws/terminal, violating acd-mesh-ui-single-server + acd-mesh-ui-write-isolation. The
  # ?mode=fleet selector lives in the BUNDLE (ui/src), not in the reused board server.
  Scenario: aof mesh ui starts the fleet server on 127.0.0.1
    When I run "aof mesh ui" against the fixture
    Then the fleet server starts and binds 127.0.0.1 on its documented default port
    And the human line announces the mesh ui is running locally
    And the fleet page and its API answer on that one same-origin port

  # DEV (missing-bundle refusal — added at Contract because the guard MATCHES the board's,
  # per the flag resolution above): a missing ui/dist build is a friendly refusal, not a
  # stack trace — the board's ui-build-missing posture (board-serve.mjs:27-33 +
  # cli.mjs:870-873), mirrored onto the fleet verb.
  Scenario: a missing UI build is refused with the friendly build-missing line
    Given the ui/dist bundle has not been built
    When I run "aof mesh ui" against the fixture
    Then the command exits non-zero with a line telling the operator to build the UI first
    And no unhandled stack trace is printed

  # The default port must not collide with the board's: the fleet view sits ON TOP of the
  # work UIs, so an operator legitimately runs both at once on one machine.
  # QA: the board's documented default is 4180 (cli.mjs workBoardCommand — options.port ??
  # "4180", itself chosen to clear aof assets ui's 4177 frontend / 4178 API). The fleet
  # default must therefore be distinct from ALL of 4177 / 4178 / 4180.
  #
  # DEV (fleet default-port literal — flag resolved): PINNED to 4181. The collision set on the
  # tree today: 4177 = assets-ui frontend (setup-ui.mjs:16, serveSetupUi port ?? "4177"),
  # 4178 = assets-ui API (cli.mjs:2017 startSetupUiFrontend apiUrl default), 4180 = board
  # (cli.mjs:863 options.port ?? "4180"). The mesh relay serve verb takes NO fixed port
  # (mesh-relay.mjs:107 serveRelay({ port = 0 }) — ephemeral), so it is not in the collision
  # set. 4181 is the next free port directly above the board — the fleet server "sits above the
  # board" — and is distinct from all of 4177/4178/4180. This is a genuine build-time choice
  # (the module does not exist yet); 4181 is the pinned sensible default, overridable by --port.
  Scenario: the fleet server's default port is distinct from the board's, and --port overrides it
    Given a board server already running on the board's documented default port
    When I run "aof mesh ui" against the fixture
    Then the fleet server starts cleanly on its own documented default port 4181
    When I instead run "aof mesh ui --port" with a free port I chose
    Then the fleet server binds 127.0.0.1 on that chosen port

  # An occupied port is a friendly refusal, not a stack trace — the board serve verb's
  # EADDRINUSE posture ("Port N is already in use. Pass --port <n> to pick another."),
  # mirrored onto the sibling face.
  Scenario: a port already in use is refused with the friendly port-in-use line
    Given another process already listening on a port I chose
    When I run "aof mesh ui --port" with that occupied port
    Then the command exits non-zero with a line naming the port and suggesting --port
    And no unhandled stack trace is printed

  # The one fleet route: GET /api/mesh/status answers the mesh:status aggregate through the
  # registry door — the same facts, the same envelope, as the CLI mirror's --json face.
  # Parity is the load-bearing assertion (one command, two faces): deep-equality against the
  # CLI's --json output for the SAME fixture, not a hand-waved "matches".
  #
  # DEV (cross-story coupling — story 01 owns the aggregate KEY names): the EXACT top-level
  # keys of the mesh:status aggregate ({ nodes, boards } as ADR-002 names them) are story 01's
  # to pin — this scenario does NOT re-own them. The load-bearing assertion is PARITY (the
  # deep-equals line): whatever shape story 01 pins, the web /api/mesh/status payload equals
  # the CLI --json byte-for-byte on the same fixture. The "nodes + boards aggregate" wording
  # below is a descriptive echo of ADR-002, not an independent pin — if story 01 renames a top-
  # level key, the parity assertion still holds and this scenario needs no edit.
  Scenario: GET /api/mesh/status answers the mesh:status aggregate
    Given the fleet server is running
    When the fleet page requests "/api/mesh/status"
    Then the response carries the nodes-and-boards aggregate mesh:status returns
    And the payload deep-equals what "aof mesh status --json" prints for the same fixture

  # The namespace is disjoint: the fleet face owns /api/mesh and serves NO /api/work route —
  # a board request against the fleet server is a not-found, not a proxied board.
  Scenario: the fleet face serves no /api/work route
    Given the fleet server is running
    When the fleet server is asked for "/api/work/list"
    Then the response is a 404 not-found
    And no board data is proxied through the fleet face

  # An unknown /api/mesh route is a clean not-found envelope — the board face's frozen
  # { ok:false, error, code } shape with code "not-found" (the board-ui.mjs unknown-route
  # precedent, mirrored) — never an unrouted crash. And a miss never takes the server down:
  # the follow-up read proves the server survived it.
  Scenario Outline: an unknown /api/mesh route answers a clean not-found and the server survives
    Given the fleet server is running
    When the fleet server is asked for "<route>"
    Then the response is a 404 carrying an { ok:false, error, code: "not-found" } envelope
    And a follow-up "/api/mesh/status" request still answers (the miss did not crash the server)

    Examples:
      | route                    |
      | /api/mesh/does-not-exist |
      | /api/mesh/status/extra   |
      | /api/mesh/               |
