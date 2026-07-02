@cli @work @board @executable
Feature: the renamed verb serves the SAME board — the frozen /api/work envelope answers unchanged through aof work ui
  In order to trust that the rename is an operator-facing verb change and nothing else,
  a board server launched by aof work ui serves milestone 03's board exactly as before — the eight
  frozen /api/work routes (seven GET reads plus the one POST feedback write), the same-origin
  static bundle, and the terminal websocket, all on the one server,
  so that every existing board consumer (the browser bundle, the m21 RUNS tab, a curl of
  /api/work/list) sees byte-for-byte the envelope it saw under the old verb, proving the rename
  carried milestone 03 + 21 forward rather than forking them.

  # ARCHITECTURE ADR-001 decision 2: the frozen /api/work envelope is UNTOUCHED — the rename
  # edits neither board-ui.mjs nor setup-ui.mjs. That the envelope FILES are untouched and the
  # m03 guards stay green (acd-board-single-server / acd-board-write-isolation /
  # acd-work-ui-no-core-import / acd-work-command-route-coverage) are STRUCTURAL invariants
  # owned by the carried-forward fitness functions (ARCHITECTURE §Fitness A), NOT re-asserted
  # here. This feature asserts the OBSERVABLE serve: launched under the new verb, the board
  # answers identically. The m03/m21 board visuals are likewise unchanged (DESIGN surface 3 —
  # no new baseline); no visual scenario belongs here.
  #
  # QA route-table note (source-grounded, 22/R2): board-ui.mjs serves EIGHT /api/work routes —
  # GET list / doc / tasks / run-status / validate / doctor / next, plus POST feedback
  # (board-ui.mjs:44-139). The "six routes" named in ADR-001/STORY undercount the frozen
  # namespace (they omit GET next and POST feedback, both m03 routes under the same frozen
  # prefix); the parity table below is source-complete — a rename regression on ANY of the
  # eight would fork the envelope. "Exactly as under the old verb" is judged against the
  # m03/m08/m21 FROZEN contract shapes (the recorded envelopes), not a side-by-side run of the
  # retired verb — which no longer dispatches once the rename lands (task 00).
  #
  # DEV (feasibility read 2026-07-02, source-checked against board-ui.mjs): CONFIRMED the route
  # set is EIGHT and the table is source-complete. Exact handler map: GET /api/work/list (:44 →
  # invoke work:list), GET /api/work/doc (:52 → work:doc, ref+doc params), GET /api/work/tasks
  # (:62 → work:tasks, ref param), GET /api/work/run-status (:68 → work:run-status, ref param),
  # GET /api/work/validate (:82 → work:validate, scope param + displayPath projection), GET
  # /api/work/doctor (:95 → work:doctor, scope param + displayPath), GET /api/work/next (:114 →
  # work:next, scope param + displayPath), POST /api/work/feedback (:126 → work:feedback). All
  # error literals below are VERBATIM from source: not-found 404 (board-ui.mjs:154), ref-not-found
  # 404 (a work:doc GET for an unresolved ref — commands/doc.mjs:41, mapped by the catch at
  # board-ui.mjs:147 via error.status), empty-json 400 / malformed-json 400 / payload-too-large
  # 413 (readJsonBody, board-ui.mjs:203/207/213 — the 413 fires when Buffer.byteLength(body,"utf8")
  # is STRICTLY > 1_000_000, board-ui.mjs:199, so "over 1,000,000 bytes" is the correct boundary).
  # NO literal changed. RECONCILIATION OWED to the ORCHESTRATOR/PO/architect (NOT a contract
  # blocker — the FEATURE is already source-true): ADR-001 decision 2 + the STORY prose say "six
  # /api/work routes (list/doc/tasks/validate/doctor/run-status)" — that count is a PROSE undercount
  # of the frozen namespace (it omits GET next and POST feedback, both m03 routes). The immutable
  # ADR cannot be edited here; the PO/architect must correct the "six" prose in ADR-001/STORY/SPEC
  # to "eight" (or note the two omitted routes) so the record matches board-ui.mjs.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And a board server launched by "aof work ui" against that fixture

  # The headline: the seven frozen GET routes all answer through the renamed verb, each with
  # its unchanged envelope shape (routes that take a ref/doc/scope param are requested as the
  # board always has). The eighth route — POST feedback — follows as its own scenario.
  Scenario Outline: the frozen /api/work GET routes answer unchanged through aof work ui
    When the board requests "/api/work/<route>" as it always has
    Then the response is the route's frozen envelope, exactly as under the old verb

    Examples:
      | route      |
      | list       |
      | doc        |
      | tasks      |
      | validate   |
      | doctor     |
      | next       |
      | run-status |

  # The eighth route — the board's ONE write (03/ADR-004, the attributed feedback bullet) —
  # carries through the rename too.
  Scenario: the feedback POST answers unchanged and still lands the one attributed bullet
    When the board posts a feedback note for a fixture item to "/api/work/feedback"
    Then the response is the route's frozen envelope, exactly as under the old verb
    And the note lands as the one attributed feedback bullet on that item

  # Same-origin discipline carries: the bundle, the API, and the terminal websocket share
  # the one server (03/ADR-001) — observable as one port answering all three.
  Scenario: the static bundle, the API, and the terminal websocket share the one origin
    When I fetch the board page, an /api/work route, and open the /ws/terminal endpoint
    Then all three answer on the same 127.0.0.1 port
    And the board is listening on exactly that one port (no second server or port)

  # An unknown /api/work route still answers the frozen not-found envelope — pinned to the
  # exact literals the face owns today (board-ui.mjs:154).
  Scenario: an unknown /api/work route answers the frozen not-found envelope
    When the board requests an /api/work route that does not exist
    Then the response status is 404
    And the body is the frozen envelope { "ok": false, "error": "Work API route not found.", "code": "not-found" }

  # The rest of the frozen error surface — the { ok:false, error, code } envelope + status
  # mapping preserved byte-for-byte through the rename (board-ui.mjs:140-148: ref-not-found →
  # 404; the transport-body errors from readJsonBody, board-ui.mjs:192-218: empty-json /
  # malformed-json → 400, payload-too-large → 413 once the body exceeds 1,000,000 bytes —
  # strictly greater-than, the source's cap).
  Scenario Outline: the frozen error envelope and status mapping carry through the renamed verb
    When the board makes <bad request>
    Then the response status is <status>
    And the body is the frozen { ok:false, error, code } envelope with code "<code>"

    Examples:
      | bad request                                                   | status | code              |
      | a GET of /api/work/doc for a ref that resolves to no item     | 404    | ref-not-found     |
      | a POST to /api/work/feedback with an empty body               | 400    | empty-json        |
      | a POST to /api/work/feedback with a malformed JSON body       | 400    | malformed-json    |
      | a POST to /api/work/feedback with a body over 1,000,000 bytes | 413    | payload-too-large |
