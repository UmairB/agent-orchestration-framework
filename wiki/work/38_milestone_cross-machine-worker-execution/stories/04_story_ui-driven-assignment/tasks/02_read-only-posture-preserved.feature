@executable @ui @work @board
Feature: The mutation carve-out is EXACTLY one route — every other fleet-face path stays 405/404, the face stays loopback-bound, and a cross-origin write is refused (CSRF)
  In order that the read-only fleet-face posture gains PRECISELY one documented exception and no more (ADR-006 / m25-ADR-004),
  the write route is the single POST /api/mesh/assign: a write to any OTHER path stays a clean 405/404 exactly as today, the face
  still stands up its one loopback-bound http.createServer with no /ws/terminal, and a cross-site POST is refused — so a malicious
  page auto-POSTing to http://127.0.0.1 cannot mint work the operator never authorized (SECURITY T13's CSRF vector).

  # AMENDED 2026-07-24 (`aof:continue 38/04` review fix QA-d) — the WIRE SHAPE below is `{ ref, nodeId, workspaceId }`, all three
  # REQUIRED, per the ARCHITECTURE ADR-012 AMENDMENT (BLOCKER F21). The CSRF Outline previously posted `{ ref, nodeId }`, which
  # under the amendment is a `400 invalid-workspace` — making its `same-origin + json ⇒ ACCEPTED` row factually false as written
  # (it passed only because the fixture silently supplied the workspaceId). WHAT THIS TASK ASSERTS IS OTHERWISE UNCHANGED — the
  # per-row admission VERDICT, the 405/404 matrix, the single loopback listener, the destroyed upgrade and the no-ungated-mint
  # clause all stand verbatim. The ACCEPTED row now carries the item's own workspaceId, the value a real card carries.

  # ARCHITECTURE 38/ADR-006 (the read-only fleet face — GET-only, POST 405, every upgrade destroyed) + 38/ADR-012 invariant #4
  # (the face stays OTHERWISE read-only: one loopback http.createServer, no low-level writer import, no /ws/terminal this story,
  # only the write-isolation invariant flips to "exactly ONE bounded mutation route") + #1 (exactly one mutation route).
  # SECURITY T13 control (b) — "a cross-origin write MUST be refused (reject on Origin/Sec-Fetch-Site cross-site, OR require a
  # non-simple content-type + a custom header a form-POST cannot forge)" + control (c) — "the carve-out is EXACTLY ONE route;
  # every OTHER method on every OTHER path stays 405/404." The live PRODUCTION bind interface is the operator's R5 attestation
  # (T13 evidence — "no worker/CI test asserts the running bind, R5-style"): this @executable asserts the SERVE-FACE binds
  # loopback in-harness; the deployed interface is task 04's @manual soak.
  #
  # @executable over the REAL serveMeshUi + a real fetch (Node's fetch sets an arbitrary Origin / content-type a real browser
  # cannot — driving the whole CSRF matrix, the retired m27 mesh-issue-route-same-origin idiom). Every REFUSED row asserts NO
  # global_assignments row was minted (the store's assignment row-count is unchanged) — the guard runs BEFORE the mint.

  Background:
    Given the REAL fleet face (serveMeshUi) over an isolated global-store seam, with the POST /api/mesh/assign route live
    And a resolvable work item "38/04" and a known + eligible worker node "worker-a"

  Scenario Outline: a write to any path OTHER than the carve-out stays a clean 405/404 — the read-only posture, one exception
    When a <method> request to <path> is sent same-origin
    Then the response status is <status> and the body code is <code>
    And where <status> is 405 the Allow header is <allow>
    And NO global_assignments row was minted, no file changed, and a follow-up GET /api/mesh/status still answers 200

    Examples:
      | method | path                | status | code               | allow      |
      | POST   | /api/mesh/status    | 405    | method-not-allowed | GET, HEAD  |
      | POST   | /api/mesh/board-url | 405    | method-not-allowed | GET, HEAD  |
      | PUT    | /api/mesh/assign    | 405    | method-not-allowed | POST       |
      | DELETE | /api/mesh/assign    | 405    | method-not-allowed | POST       |
      | POST   | /api/mesh/revoke    | 404    | not-found          | n/a        |
      | POST   | /api/mesh/issue     | 404    | not-found          | n/a        |

  Scenario: the fleet face stands up exactly ONE loopback-bound server and still serves no terminal upgrade
    Then the running serve-face is bound to 127.0.0.1 only — server.address().address is "127.0.0.1" (never 0.0.0.0)
    And there is exactly one http listener (no second server stood up by the write carve-out)
    And a ws upgrade at /ws/terminal (or /) is still refused — the socket is destroyed, no session opens
    # the LIVE deployed bind interface is the operator's R5 attestation (task 04 soak), out of this executable's reach

  Scenario Outline: the CSRF posture — only a same-origin JSON write is admitted; a cross-origin / forgeable write is refused
    When a POST /api/mesh/assign with body { ref: "38/04", nodeId: "worker-a", workspaceId: <this workspace> } is sent with <origin> and content-type <contentType>
    Then the write is <verdict>
    And on a REFUSED row the response is a coded 4xx and NO global_assignments row was minted
    And on an ACCEPTED row the response is 200 and EXACTLY ONE assigned row was minted

    Examples:
      | case                    | origin           | contentType                        | verdict  |
      | same-origin + json      | SAME             | application/json                   | ACCEPTED |
      | cross-origin + json     | http://evil.test | application/json                   | REFUSED  |
      | no-origin + browser form| (none)           | application/x-www-form-urlencoded  | REFUSED  |
      | same-origin + non-json  | SAME             | text/plain                         | REFUSED  |
    # the exact admission MECHANISM (an Origin/Sec-Fetch-Site check vs a non-simple content-type + unforgeable header) is the
    # build's choice — SECURITY T13 control (b) permits EITHER; the falsifiable invariant is the per-row VERDICT. The
    # "no-origin + browser form" row is refused under EITHER mechanism (a cross-site form-POST is a simple request), so it is
    # satisfiable whichever admission the build picks.

  Scenario: the face exposes no ungated mint — the ONLY path to a global_assignments write is the gated verb
    # ADR-012 invariant #2 (no low-level global_assignments writer reachable from the face except through assignWork) is the
    # SOURCE-STRUCTURAL fitness acd-fleet-face-single-mutation-route, armed at BUILD (an import-graph check — arch-owned, not a
    # black-box behaviour). Its OBSERVABLE consequence is provable here:
    Given a POST /api/mesh/assign that a gate refuses (an unknown node "ghost")
    When the refusal returns
    Then NO global_assignments row exists for the item — there is no mint that skipped the gates
    And a subsequent same-origin assign for the eligible "worker-a" mints EXACTLY ONE gated row
    # every mint on the face carries the verb's gate outcomes — there is no second success path around them
