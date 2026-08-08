<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY 45/04, the SERVER half: the three launchers
# (`aof work ui`, `aof mesh ui`, `aof assets ui`) and the one HTTP route
# (`GET /api/mesh/board-url`) stop minting `?mode=` and mint the ADR-002 path
# instead — WITHOUT losing what they carried: the fleet's `scope`, the drill-in's
# `#ref`, and the board-url body's key shape.
#
# NOT ASSERTED HERE — three deliberate delegations, so the same fact is not
# claimed twice:
#  - "no `?mode=` literal survives in `src/`" is a PLACEMENT invariant and lives in
#    `test/arch/acd-no-surface-mode-url-literal.test.mjs` (already written,
#    currently RED — this story is what takes it green). A producer that emitted
#    the right path from a hand-rolled second copy would pass every scenario below
#    and still fail that gate. That is the correct division of labour, not a gap.
#  - WHAT each legacy URL is translated INTO is 45/01's `legacyRedirectFor` table,
#    and a fragment is never sent to a server at all, so no scenario below claims
#    a redirect. What IS claimed here is narrower and is this story's own: every
#    legacy address these producers USED to hand out still gets a 200 and the app
#    shell from the very server that used to hand it out.
#  - the extensionless-pathname fallback RULE is 45/02's. Here it is only
#    CONSUMED: STORY.md names "an advertised URL that 404s" as a worse regression
#    than the one the milestone fixes, so every advertised address below is
#    actually fetched.
#
# LITMUS: every Then is confirmable by an outsider with a shell and `curl`. The
# channels are the ones these producers already publish, and existing suites
# already read them:
#   `aof work ui --json`   → `boardUrl`  (the non-blocking probe, board-serve.mjs:41)
#   `aof mesh ui --json`   → `fleetUrl`  (mesh-ui-serve.mjs:143)
#   `aof assets ui --json` → `uiUrl`     (commands/assets-ui.mjs:117)
#   each launcher's own stdout line `Open this URL in your browser: <url>`
#     (work-ui.mjs:52, mesh-ui.mjs:106, assets-ui.mjs:48 — the SERVE-side literals,
#     which are separate strings from the probe's and can drift from it)
#   `GET /api/mesh/board-url?workspaceId=…&ref=…` — a real HTTP read
# No scenario below reads a source file or imports a production module.
#
# EXTEND, DO NOT DUPLICATE. These suites already assert these exact envelopes and
# announce lines with an `includes("mode=…")`, and they are the sites that change:
# `test/board-serve.test.mjs:186`, `test/mesh-ui-serve.test.mjs:126,303`,
# `test/mesh-ui-cli-face.test.mjs:205`, `test/work-ui-verb-rename.test.mjs:187`,
# `test/mesh-ui-global-scope.test.mjs:219`. The board-url refusals already live in
# `test/mesh-ui-assignment-read-only.test.mjs:164` and
# `test/mesh-ui-assign-route.test.mjs:89`. `test/work-ui-board-serves-unchanged.test.mjs`
# is the no-regression neighbour: the seven frozen `/api/work` routes must be
# byte-unchanged by a launcher that only renamed the URL it prints. The config
# editor's `uiUrl` has NO behavioural suite at HEAD — that one is net-new coverage,
# not an extension.
#
# TWO TRAPS, both measured at HEAD, both given a row of their own because a
# careful implementer still walks into them:
#  1. `mesh-ui.mjs:106` composes its announce line as `${fleetUrl}&scope=${scope}`.
#     The `&` is hard-coded because `fleetUrl` is assumed to already carry a query
#     string. Change `fleetUrl` to a path and that SAME untouched line yields
#     `http://127.0.0.1:4181/fleet&scope=global` — which parses as a pathname of
#     `/fleet&scope=global` with no `scope` parameter at all, and which
#     `includes("scope=")` happily accepts. Every scope assertion below therefore
#     reads `new URL(...).searchParams.get("scope")`, never a substring.
#  2. `mode` is ALSO a legitimate ENVELOPE key on all three probes
#     (`{ mode: "board" }`, `{ mode: "fleet" }`, `{ mode: "assets-ui" }`) — a probe
#     discriminator, not a URL selector, and outside the arch gate's
#     `[?&]mode=` pattern. Deleting it to "satisfy the gate" would break every
#     probe consumer. It is asserted PRESENT and unchanged.

@executable @cli @work @distribution
Feature: every server-side door advertises the ADR-002 path it actually serves — and loses neither the fleet's scope, the drill-in's fragment, nor the board-url body's shape
  In order that an operator who copies a URL out of a CLI line, a `--json` envelope or the fleet's drill-in lands on a real address — and the bookmark they already have keeps working
  the board, fleet and config-editor launchers and the `/api/mesh/board-url` route must each emit a path URL, carry their existing payload through it, serve what they advertise, and still serve what they used to advertise

  Background:
    Given an isolated global mesh store (a fresh AOF_GLOBAL_HOME) holding one published workspace whose work stream contains milestone "34"
    And a repo root with a built `ui/dist` (the launchers refuse with `ui-build-missing` otherwise, unchanged by this story)
    And every port used below is an ephemeral free port the lane picked, never a fixed one

  # Headline: the machine-readable face of each launcher advertises a path. Each row
  # names the ADR-002 path and the query payload that must survive the move.
  Scenario Outline: each launcher's `--json` probe advertises its ADR-002 path, with its payload intact and its envelope otherwise unchanged
    When I run <command>
    Then the envelope's <key> parses with `new URL(...)` and its pathname is exactly <path>
    And that URL's search names no `mode` parameter at all
    And its `scope` parameter, read via `searchParams.get("scope")`, is <scope>
    And its pathname contains no "&" and no "?" — a query glued onto a path is caught here, not by a reader eyeballing the string
    And the envelope still carries its own `mode` key as <envelopeMode> — the probe discriminator, which is not a URL selector and is not removed
    And every other key the envelope carried at HEAD (`port`, `projectDir`, `uiDist`, `uiBuildPresent`, and the fleet's `scope`/`relayConfigured`) is present with an unchanged value

    Examples:
      | case                                 | command                              | key      | path    | scope  | envelopeMode |
      | the board probe                      | `aof work ui --json`                 | boardUrl | /board  | absent | "board"      |
      | the board probe on a chosen port     | `aof work ui --port <free> --json`   | boardUrl | /board  | absent | "board"      |
      | the fleet probe, default scope       | `aof mesh ui --json`                 | fleetUrl | /fleet  | global | "fleet"      |
      | the fleet probe, --local             | `aof mesh ui --local --json`         | fleetUrl | /fleet  | local  | "fleet"      |
      | the config-editor probe              | `aof assets ui --json`               | uiUrl    | /config | absent | "assets-ui"  |
      | the config-editor probe on a port    | `aof assets ui --port <free> --json` | uiUrl    | /config | absent | "assets-ui"  |
    # The last two rows are the ONE place ADR-002's deliberate divergence is
    # observable: the verb is `assets`, the command id is `assets:ui`, the legacy
    # mode value is `assets` — and the PATH is `/config`, because `/assets` is the
    # built bundle's own asset directory (`ui/dist/assets/index-*.js`). A row
    # asserting `/assets` here would be asserting a route that cannot exist.
    # The fleet rows are the ONLY ones carrying `scope`; a board or config URL that
    # grew one would be inventing a parameter no consumer reads.

  # The launched servers, not the probes — the human line an operator actually
  # copies out of a terminal. This is where trap 1 lives, and the serve-side literal
  # is a DIFFERENT string from the probe's (board-serve.mjs:62 vs :41,
  # mesh-ui-serve.mjs:736 vs :143, assets-ui.mjs:45 vs :117), so it can drift alone.
  Scenario Outline: each launched server announces its path on stdout, as a URL and not as a path with a stray "&" glued to it
    When I launch <command> and read its `Open this URL in your browser: <url>` line
    Then <url> parses with `new URL(...)` and its pathname is exactly <path>
    And its search names no `mode` parameter
    And its `scope` parameter, read via `searchParams.get("scope")`, is <scope>
    And its pathname contains no "&" and no "?"
    And its host is `127.0.0.1` and its port is the port the launcher was given

    Examples:
      | case                        | command                                         | path    | scope  |
      | the board launcher          | `aof work ui --port <free>`                     | /board  | absent |
      | the fleet launcher, global  | `aof mesh ui --port <free>`                     | /fleet  | global |
      | the fleet launcher, --local | `aof mesh ui --port <free> --local`             | /fleet  | local  |
      | the config-editor launcher  | `aof assets ui --port <free> --api-port <free>` | /config | absent |
    # FEASIBILITY for the last row: `aof assets ui` spawns a REAL vite child
    # (assets-ui.mjs:79-95). The announce line is printed at :48 immediately after
    # the API server binds and BEFORE vite is ready, so the lane reads the line and
    # kills the child without ever waiting on a bundle — the same launch-and-read
    # shape `test/mesh-ui-cli-face.test.mjs:109` and `test/work-ui-verb-rename.test.mjs:89`
    # already use. That is also why this row does NOT fetch its own URL: the config
    # origin is a vite dev server, not one of this repo's Node servers. Its serving
    # is covered by the real-browser census in task 02.

  # The composition STORY.md names as the worse regression — an advertised URL that
  # 404s — plus its other half. A row that asserted only the NEW address would be
  # half a test: what the producer stops emitting must not stop working.
  Scenario Outline: each Node server serves what it now advertises AND what it used to advertise
    Given <server> is running on a free port
    When I `GET <request>` against that same server's own origin
    Then the response is 200 with `Content-Type: text/html`
    And the body is byte-identical to what `GET /` returns from that server — the built app shell, never a 404 page and never a JSON error envelope

    Examples:
      | case                                    | server        | request                   |
      | the board's new address                 | `aof work ui` | /board                    |
      | the board's legacy address              | `aof work ui` | /?mode=board              |
      | the fleet's new address                 | `aof mesh ui` | /fleet                    |
      | the fleet's new address carrying scope  | `aof mesh ui` | /fleet?scope=global       |
      | the fleet's legacy address              | `aof mesh ui` | /?mode=fleet              |
      | the fleet's legacy address with scope   | `aof mesh ui` | /?mode=fleet&scope=global |
      | the fleet's legacy address, local scope | `aof mesh ui` | /?mode=fleet&scope=local  |
    # NO fragment row exists here ON PURPOSE. A fragment is never sent to a server
    # (ADR-003's own reason for making the translation client-side), so
    # `/?mode=board#34/01` and `/board#34/01` are indistinguishable over HTTP. The
    # fragment's survival is asserted at the board-url route below (where it is
    # MINTED, and therefore observable) and end-to-end by the browser census in
    # task 02.

  # `/api/mesh/board-url` is the fleet's drill-in door and the ONE producer whose
  # output carries a fragment. `#ref` is a live deep-link contract (`Board.tsx:585`
  # reads it back), so it is asserted per ref shape rather than once — a ref with
  # slashes is exactly the shape a careless `encodeURIComponent` mangles.
  Scenario Outline: the drill-in URL is a path on the workspace's OWN board origin, and it keeps its `#ref` verbatim
    Given the fleet server is running with that published workspace in its projection
    When I `GET /api/mesh/board-url?workspaceId=<the workspace>&ref=<ref>`
    Then the response is 200 and the body's `url` parses with `new URL(...)` and its pathname is exactly "/board"
    And that URL names no `mode` parameter
    And its hash is <hash>
    And its origin is a `127.0.0.1` origin on a port that is NOT the fleet's — the workspace's own board server
    And the body's `ref` is <bodyRef>

    Examples:
      | case                        | ref      | hash        | bodyRef  |
      | a milestone ref             | 34       | "#34"       | "34"     |
      | a story ref (one slash)     | 34/01    | "#34/01"    | "34/01"  |
      | a task ref (two slashes)    | 34/01/02 | "#34/01/02" | "34/01/02" |
      | the ref parameter omitted   | (absent) | empty — no fragment at all | null |
      | the ref parameter empty     | (empty)  | empty — no fragment at all | null |
    # The last two rows pin the falsy-ref branch (`if (ref) url.hash = ref` and
    # `ref: ref || null` at mesh-ui-serve.mjs:298): a bare `/board` with no trailing
    # `#`, and a body `ref` of null rather than "". Both are HEAD behaviour and both
    # are easy to lose when the URL is rebuilt.

  # Spike 44 (done) settled that milestone 46 adds an `origin` field to THIS body
  # over THIS lazy-launch seam. Changing the URL must not narrow, rename or reorder
  # the keys around it, or 46's additive change becomes a breaking one.
  Scenario: the board-url response body keeps its exact key shape, and leaves room for milestone 46's additive field
    Given the fleet server is running with that published workspace in its projection
    When I `GET /api/mesh/board-url?workspaceId=<the workspace>&ref=34`
    Then the body's own keys are exactly `url`, `workspaceId`, `ref` — nothing added, renamed or removed by this story
    And `workspaceId` is the id that was asked for, and `ref` is "34"
    And no key named `origin` is present — 46 adds it, and this story must neither pre-empt it nor make room for it by moving anything else
    And the body is a JSON object (not a bare string and not an array), so a sibling key added later is an addition rather than a shape change

  # The drill-in must still LAND somewhere real, and still reuse the workspace's
  # board server rather than relaunching one per click. Both assertions exist today
  # (`test/mesh-ui-serve.test.mjs:307,317`) and both are exactly what a rewrite that
  # builds the path against the wrong base would break — `new URL("/board", url)`
  # against a bare origin silently discards nothing, but against the wrong base it
  # discards the port, and only these Thens would notice.
  Scenario: the drill-in URL still points at the selected workspace's real board server, and a second drill-in reuses it
    Given the fleet server is running with that published workspace in its projection
    When I `GET /api/mesh/board-url?workspaceId=<the workspace>&ref=34` twice
    Then the first response's `url` origin answers `GET /api/work/list` with THAT workspace's own work stream (the item "34" is in it)
    And the second response's `url` is byte-identical to the first — the board server is reused, not relaunched per click
    And a `GET` of that `url` (fragment stripped, as a browser sends it) answers 200 with the app shell
    And the fleet origin itself still answers `GET /api/work/list` with a 404 — the drill-in is a navigation, never a proxy

  # Rewriting the URL a handler returns is the classic moment its refusals get
  # rewritten with it. Each row holds every other input valid and flips exactly one.
  Scenario Outline: the board-url route's refusals are byte-unchanged by the URL migration
    Given the fleet server is running with that published workspace in its projection
    When I issue <request>
    Then the response status is <status> and its envelope's `code` is <code>
    And no board server was launched for the refused request (no new listener appears, and a following valid drill-in still launches exactly one)

    Examples:
      | case                                | request                                            | status | code                |
      | no workspaceId at all               | `GET /api/mesh/board-url`                          | 400    | invalid-workspace   |
      | a whitespace-only workspaceId       | `GET /api/mesh/board-url?workspaceId=%20&ref=34`   | 400    | invalid-workspace   |
      | a workspaceId not in the projection | `GET /api/mesh/board-url?workspaceId=nope&ref=34`  | 404    | workspace-not-found |
      | a POST to the route                 | `POST /api/mesh/board-url?workspaceId=<ok>&ref=34` | 405    | method-not-allowed  |
    # The 405 row also carries `Allow: GET, HEAD`, unchanged — it is the assertion
    # `test/mesh-ui-assignment-read-only.test.mjs:164` already makes, and it is
    # named here so the read-only posture is re-checked in the same change that
    # rewrites the handler's happy path.
