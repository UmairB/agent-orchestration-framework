<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY task 01 (m45/ADR-004): a client-side path that is deep-linked or
# refreshed renders the app shell instead of 404ing, on EVERY origin, behind ONE
# predicate — `shouldServeAppShell(pathname)`, whose discriminator is "the last path
# segment contains no `.`".
#
# WHY THAT DISCRIMINATOR, so the tables below read as a spec and not as trivia
# (ADR-004 records both rejections): `Accept: text/html` was REJECTED because it makes
# one URL answer differently for curl, for this repo's headless harnesses and for a
# browser; a route-derived allowlist was REJECTED because the server would have to
# learn the client's route table — either `src/` imports `ui/src/` (a new and wrong
# coupling direction) or the list gets a second home and drifts the first time
# milestone 47 or 49 adds a route.
#
# NOT RESTATED HERE: that the predicate lives in `src/static-serve.mjs` and that both
# servers import it. Those are PLACEMENT invariants and live in
# `test/arch/acd-spa-fallback-never-masks.test.mjs`. What IS behavioural — and is this
# task — is that both origins actually answer the same way. Note only the delegation:
# `board-serve.mjs:20` hands the board origin to the SAME handler the config editor
# runs, so one fix reaches both; scenario 2 proves that by observation rather than
# taking it on trust.
#
# THE MISSING-ASSET HALF OF THE PREDICATE IS TASK 02. This task owns "which paths GET
# the shell" (including the negative rows in scenario 6, where the discriminator says
# no); task 02 owns "a missing bundle asset stays a loud 404 on both origins".
#
# LITMUS: every Then is a real HTTP request against a started server, asserting the
# status, the `content-type` header, and the body — `<div id="root">` present for the
# shell, the coded `{ ok:false, error, code }` envelope for an API not-found. Never
# "the predicate returns true".
#
# MEASURED 2026-08-06 at `eacbd57` (real HTTP against real `serveBoard` /
# `serveSetupUi` / `serveMeshUi`, macOS host). This task is RED on the board and
# config-editor origins for every row of scenario 1 except `/` — `/fleet`, `/board`,
# `/config`, `/board/`, `/some/future/deep/path` all answer `404 text/plain "Not
# found"` today, which is exactly the operator-facing gap the story exists to close.
# On the fleet origin every row of scenarios 1 and 3 is GREEN today, but for the wrong
# reason (an UNCONDITIONAL fallback, `mesh-ui-serve.mjs:563-567`) — see task 02, which
# narrows it.
#
# TWO ROWS CARRY A DECISION RATHER THAN A MEASUREMENT, flagged here in the house's
# style so a later reader meets a decision instead of an omission:
#   - `/api` (the bare prefix, no trailing slash). Both servers' API guards test
#     `startsWith("/api/")`, so bare `/api` is NOT caught by them and reaches the static
#     handler: today the board origin 404s it and the fleet origin already answers it
#     with the shell (measured). Written below as the SHELL, because ADR-002 wants ONE
#     not-found experience and `/api` is an unknown path like any other. If the
#     architect prefers the coded API envelope for the whole `/api` prefix, this row's
#     expected value flips and it moves into scenario 4's table — the row exists either
#     way, so the answer is chosen rather than defaulted.
#   - `/.well-known/acme-challenge/tok` pins that the discriminator reads the LAST
#     segment, not "does the pathname contain a dot". Written as the shell. It is also
#     the row that distinguishes the two natural implementations of the rule — see
#     scenario 6's note on `path.extname`.
#
# FEASIBILITY: nothing new. `test/setup-ui.test.mjs`, `test/board-serve.test.mjs` and
# `test/mesh-ui-serve.test.mjs` already start these servers against a fixture bundle
# (`writeDist`) of exactly this shape; this task extends that channel. Run focused and
# isolated: `AOF_GLOBAL_HOME=$(mktemp -d) node --test test/<file>`.

@executable @cli @board @distribution
Feature: a deep-linked or refreshed client path renders the app shell on every origin, and never swallows an API route
  In order that a URL is something an operator can share, bookmark and come back to — rather than something that only works if the address bar is never touched
  every origin must answer an extension-less path with the app shell at 200, must answer an unknown `/api/...` path with its coded not-found envelope and never with HTML, and must leave a path whose last segment carries an extension exactly as loud as it is today

  Background:
    Given a built bundle on disk holding "index.html" (the app shell — its body carries `<div id="root">` and a `<script type="module" src="/assets/index-abc123.js">`), "assets/index-abc123.js" and "assets/index-abc123.css"
    And the board origin serving that bundle on 127.0.0.1 (the board server, which reaches the shared static handler by delegation)
    And the config-editor origin serving the same bundle on 127.0.0.1 (that same static handler, started directly against the built bundle)
    And the fleet origin serving the same bundle on 127.0.0.1

  # Headline: the gap the story exists to close. Every row here answers `404 text/plain`
  # on this origin today except `/`.
  Scenario Outline: an extension-less path deep-linked on the board origin serves the app shell instead of 404ing
    When I request <path> on the board origin
    Then the response status is 200
    And the response carries `content-type: text/html`
    And the response body contains `<div id="root">`

    Examples:
      | case                                          | path                              |
      | the fleet route                               | `/fleet`                          |
      | the board route                               | `/board`                          |
      | the config route                              | `/config`                         |
      | bare root                                     | `/`                               |
      | a route with a trailing slash                 | `/board/`                         |
      | a deep path no route table has yet            | `/some/future/deep/path`          |
      | a typo — the shell renders its own not-found  | `/typo-not-a-route`               |
      | a dot in an EARLIER segment, not the last     | `/.well-known/acme-challenge/tok` |
      | the asset DIRECTORY itself, not a file in it  | `/assets`                         |
      | the asset directory with a trailing slash     | `/assets/`                        |
      | the bare `/api` prefix, no trailing slash     | `/api`                            |
    # `/` is the one row that is green today and it reaches the shell by a different
    # road — the guard maps `/` to `index.html` directly, it never needs the fallback.
    # It is in the table because an outsider cannot tell the two roads apart, and must
    # not have to.
    # The `/assets` rows matter because ADR-002 forbids a ROUTE named `/assets` (it
    # would collide with the build output). These rows show the discriminator needs no
    # exception carved around that prefix: the bare directory renders the shell, while
    # `/assets/<hashed>.js` stays a hard 404 (task 02).

  # The delegation, observed: the board origin and the config-editor origin are ONE
  # handler reached twice, so one fix lands on both. A difference here means the
  # delegation has been broken, whatever the arch test says about imports.
  Scenario: the config-editor origin answers every one of those paths identically to the board origin
    When I request each path from the previous scenario on the config-editor origin and on the board origin
    Then each pair of responses has the same status, the same `content-type` and the same body bytes
    And every one of them is 200, `text/html`, and contains `<div id="root">`

  # SPEC asks for the fleet origin to be PINNED BY A TEST rather than assumed. It is
  # green today (for the wrong reason — see task 02) and must stay green once the
  # unconditional fallback is replaced by the shared predicate.
  Scenario Outline: the fleet origin serves the app shell for an extension-less path — pinned, not assumed
    When I request <path> on the fleet origin
    Then the response status is 200
    And the response carries `content-type: text/html`
    And the response body contains `<div id="root">`

    Examples:
      | case                            | path                     |
      | the fleet route itself          | `/fleet`                 |
      | the board route on this origin  | `/board`                 |
      | the config route on this origin | `/config`                |
      | bare root                       | `/`                      |
      | a route with a trailing slash   | `/fleet/`                |
      | a deep path no route table has  | `/some/future/deep/path` |
    # `/board` and `/config` on the FLEET origin render the shell even though this
    # origin serves no `/api/work` and no `/api/config`. That is ADR-002's origin-blind
    # table, and it is byte-identical to what `?mode=board` on this origin does today —
    # the surface degrades through its own existing error state. Recorded so it is met
    # as a decision, not filed as a bug.

  # An `/api` path is answered by the API, never by the shell. Both servers already
  # return before the static handler; the predicate refusing `/api/` on its own is belt
  # AND braces, so a later reorder of the handler cannot turn an API 404 into an
  # HTML 200.
  Scenario Outline: an unknown `/api/...` path returns the coded API not-found envelope and is never answered with the HTML shell
    When I request <path> on the board origin, on the config-editor origin and on the fleet origin
    Then every response status is 404
    And no response carries `content-type: text/html`, and no response body contains `<div id="root">`
    And every response body is JSON whose `ok` is false and whose `code` is "not-found"

    Examples:
      | case                                     | path                        |
      | an unknown api leaf                      | `/api/nope`                 |
      | an unknown api path, several segments    | `/api/unknown/deep/path`    |
      | the bare api prefix with a trailing slash| `/api/`                     |
      | an extension-less api path               | `/api/work/does-not-exist`  |
      | an api path whose last segment has a dot | `/api/mesh/not.a.route`     |
      | a stray DOUBLE slash before the prefix   | `//api/nope`                |
      | a triple slash before the prefix         | `///api/nope`               |
    # Row 4 is the one that would break if the fallback were ever allowed to run first:
    # it is extension-less, so only the ordering (API guard before static handler, plus
    # the predicate's own `/api/` refusal) keeps it JSON.
    #
    # THE DOUBLE-SLASH ROWS were added at review (QA F-2, PO ruling 2026-08-07). A "//x"
    # request target parses as PROTOCOL-RELATIVE under WHATWG URL ("x" becomes the host),
    # so before the fix the /api/* guard never fired and //api/mesh/status was answered
    # with the HTML shell — the exact masking class this story removes, one layer up.
    # Both servers now collapse LEADING slashes before parsing; trailing and interior
    # slashes are untouched, and the client-side table's own "//" ruling (45/01: never
    # normalised into the landing) is a different layer and unaffected.

  # The regression guard for the row above: refusing unknown `/api` paths must not cost
  # the real ones. Each origin keeps its own live route.
  Scenario: a real API route on each origin still answers JSON, unchanged
    When I request `/api/work/list` on the board origin and on the config-editor origin
    Then both responses are 200 with `content-type: application/json` and a body carrying an `items` array
    When I request `/api/mesh/status` on the fleet origin
    Then the response is 200 with `content-type: application/json` and a body carrying a `nodes` array
    And a request for `/api/work/list` on the FLEET origin is still 404 with `code` "not-found" (the disjoint fleet face proxies no board)

  # The negative half of the discriminator: a last segment carrying a dot is treated as
  # a file request and stays exactly as loud as it is today. This is the accepted cost
  # of the chosen rule and it is written down rather than discovered.
  Scenario Outline: a path whose LAST segment contains a dot is never claimed by the fallback
    When I request <path> on the board origin, on the config-editor origin and on the fleet origin
    Then every response status is 404
    And no response carries `content-type: text/html`, and no response body contains `<div id="root">`

    Examples:
      | case                                        | path             |
      | a route-shaped path with a version dot      | `/board.v2`      |
      | a route-shaped path with a decimal          | `/release-1.2`   |
      | a dotfile at the root                       | `/.env`          |
      | a dotfile in a subdirectory                 | `/x/.gitignore`  |
      | a mistyped html extension                   | `/index.htm`     |
    # ROWS 1-2 ARE THE RULE'S PRICE: a client route whose last segment contains a dot is
    # not reachable by deep link. No route in ADR-002's table has one, and the cost is
    # accepted there in exchange for a server that needs no knowledge of the client's
    # routes.
    # ROWS 3-4 ARE THE ROWS THAT DISCRIMINATE THE TWO NATURAL IMPLEMENTATIONS. ADR-004's
    # rule is "the last segment contains no `.`", so a dotfile is EXTENSIONED and 404s.
    # An implementation reaching for `path.extname` instead would answer `.env` with the
    # SHELL, because `path.extname(".env")` is the empty string. The rule as written is
    # also the safer of the two — a dotfile probe gets a flat 404, not a 200.

  # The fallback must serve the REAL index.html — the bytes the build produced, script
  # tags and all — not a synthesised page that merely looks like one.
  Scenario: the shell served for a deep link is byte-identical to the shell served at `/`
    When I request `/` and `/some/future/deep/path` on the board origin
    Then both responses are 200 `text/html` and their bodies are byte-identical
    And that body contains the built bundle's own `<script type="module" src="/assets/index-abc123.js">`
    And the same holds on the config-editor origin and on the fleet origin

  # A query string never changes the decision, and every URL this system has ever
  # advertised still lands on the shell — the server-side half of the back-compat
  # promise stories 03 and 04 finish in the client.
  Scenario Outline: a query string does not change the decision, and every legacy advertised URL still serves the shell
    When I request <url> on the board origin, on the config-editor origin and on the fleet origin
    Then every response status is 200 with `content-type: text/html` and a body containing `<div id="root">`

    Examples:
      | case                                       | url                     |
      | the fleet's own advertised URL             | `/?mode=fleet`          |
      | the desktop app's compiled constant        | `/?mode=fleet&scope=global` |
      | what `/api/mesh/board-url` returns         | `/?mode=board`          |
      | the config editor's advertised URL         | `/?mode=assets`         |
      | a canonical path carrying a live parameter | `/fleet?scope=global`   |
    # A fragment (`#42/03`) is never sent to a server, so `?mode=board#42/03` arrives
    # here as `/?mode=board` — row 3. That the fragment survives is ADR-003's
    # client-side `replaceState` claim and belongs to story 03, not to this task.

  # A deploy with no built bundle is LOUD. The fallback must never turn a missing build
  # into a blank 200, which is the same masking failure as a missing asset, one level up.
  Scenario: a bundle with no index.html is a friendly 404 on every origin, never a blank 200
    Given a served bundle directory that holds "assets/index-abc123.js" but NO "index.html"
    When I request `/`, `/board` and `/some/future/deep/path` on the board origin, on the config-editor origin and on the fleet origin
    Then every response status is 404
    And no response is a 200 with an empty body
    And the board and config-editor origins answer `text/plain` "Not found", and the fleet origin answers its JSON envelope with `code` "not-found"
    And `/assets/index-abc123.js` is still served with 200 and `content-type: text/javascript` on all three (the missing shell did not take the assets with it)
