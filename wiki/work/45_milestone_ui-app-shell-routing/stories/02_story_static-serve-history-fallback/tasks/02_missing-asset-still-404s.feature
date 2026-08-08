<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY task 02 (m45/ADR-004): a bundle file that does not exist stays a
# 404 on EVERY origin. This is the half of the story that TIGHTENS live behaviour
# rather than adding it, and it is the half an operator feels at 2am.
#
# THE DEFECT BEING REMOVED, measured 2026-08-06 at `eacbd57` (real HTTP against a real
# `serveMeshUi`): `mesh-ui-serve.mjs:563-567` falls back to `index.html`
# UNCONDITIONALLY, so on the fleet origin TODAY every single row of scenario 2 answers
# `200 text/html` with the app shell — a missing `/assets/index-abc123.js`, a missing
# `/favicon.ico`, a missing `/robots.txt`, all of them. A deploy that shipped without
# its JavaScript therefore arrives in the browser as `Uncaught SyntaxError: Unexpected
# token '<'` in the console, arbitrarily far from its cause, and a `curl` of the asset
# says 200. ADR-004 gates that fallback behind the shared predicate, which is a
# DELIBERATE NARROWING of live fleet behaviour, not a regression.
#
# ANY EXISTING TEST THAT ASSERTS THE OLD UNCONDITIONAL FALLBACK IS A TEST TO UPDATE
# WITH A STATED REASON, NEVER ONE TO ROUTE AROUND (the story says so). Searched at
# `eacbd57`: `test/mesh-ui-serve.test.mjs`, `test/mesh-ui-global-scope.test.mjs`,
# `test/mesh-ui-read-only-contract.test.mjs`, `test/mesh-ui-assignment-read-only.test.mjs`
# and `test/fleet-terminal-view-surface.test.mjs` request only `/` (which maps straight
# to `index.html` and is unaffected) and `/api/...` paths (unaffected). No existing test
# asserts a MISSING static path returning 200 — the defect is unpinned, which is
# precisely why it survived. The narrowing should therefore break nothing; if a suite
# does go red on it, that suite is asserting the defect and its update is a red-to-green
# with the reason recorded, not a threshold to loosen.
#
# LITMUS: every Then is a real HTTP request against a started server, asserting status,
# `content-type` and body shape. The load-bearing assertion is a NEGATIVE one — the
# body is not the app shell and the content type is not `text/html` — because "200 with
# the wrong body" is exactly the failure this task exists to make impossible.
#
# SCOPE SPLIT: task 01 owns "which paths GET the shell" (including the negative rows
# where the discriminator says no). This task owns "a file request that misses stays
# loud", the existing-asset regression guard, and the end-to-end broken-deploy walk
# (scenario 4) which is the operator's actual experience of the bug.
#
# A SECOND DUPLICATED HELPER, FOUND WHILE MEASURING, AND DELIBERATELY NOT ASSERTED
# HERE: `contentType` is ALSO defined twice (`setup-ui.mjs:262-267`,
# `mesh-ui-serve.mjs:861-868`) and — unlike `safeStaticPath` — the two copies have
# ALREADY DRIFTED: the fleet copy knows `.json` and `.svg`, the board/config copy does
# not and answers `application/octet-stream` for both. It is the same duplication class
# on the same lines, it is empirical proof of ADR-004's thesis, and it is OUT OF SCOPE
# for this story as written. Scenario 3's table is therefore restricted to `.js`,
# `.css` and `.html`, where the two copies still agree, and the divergence is routed to
# the PO as a finding rather than silently blessed by a row. The shipped bundle is
# `index.html` + hashed `.js`/`.css` only (verified on disk), so the drift is latent
# today — the first `.svg` or `.json` the build emits makes it live.
#
# FEASIBILITY: nothing new. The fixture bundle in `test/board-serve.test.mjs::writeDist`
# and `test/mesh-ui-serve.test.mjs::writeDist` is already exactly this shape (an
# `index.html` referencing `/assets/index-abc123.js`, plus that asset) — scenario 4 is
# that fixture minus one file. Run focused and isolated:
# `AOF_GLOBAL_HOME=$(mktemp -d) node --test test/<file>`.

@executable @cli @board @distribution
Feature: a bundle file that does not exist stays a 404 on every origin, so a broken deploy fails at its cause
  In order that a deploy missing a JavaScript file SAYS SO — instead of arriving as a blank screen and a console error a hundred lines from its cause
  a request for an asset that is not on disk must return 404 on the board, config-editor AND fleet origins, and an asset that IS on disk must still be served as itself with its own content type

  Background:
    Given a built bundle on disk holding "index.html" (the app shell — its body carries `<div id="root">` and a `<script type="module" src="/assets/index-abc123.js">`), "assets/index-abc123.js" and "assets/index-abc123.css"
    And an unreferenced file "assets/decoy-9f9f.js" in that same bundle, named by nothing the shell links to
    And the board origin serving that bundle on 127.0.0.1 (the board server, which reaches the shared static handler by delegation)
    And the config-editor origin serving the same bundle on 127.0.0.1 (that same static handler, started directly against the built bundle)
    And the fleet origin serving the same bundle on 127.0.0.1

  # Headline: the board/config side. Every row here is already 404 today; this scenario
  # is the BASELINE the new fallback must not move — a Then that changes value is the
  # regression, and it is the regression the whole story risks introducing.
  Scenario Outline: a request for a bundle file that does not exist returns 404 on the board and config-editor origins
    When I request <path> on the board origin and on the config-editor origin
    Then both responses have status 404
    And neither response carries `content-type: text/html`, and neither body contains `<div id="root">`

    Examples:
      | case                                  | path                          |
      | a missing hashed JavaScript bundle    | `/assets/index-missing.js`    |
      | a missing hashed stylesheet           | `/assets/index-missing.css`   |
      | a sourcemap the build never emitted   | `/assets/index-abc123.js.map` |
      | a near-miss on a real asset's name    | `/assets/index-abc124.js`     |
      | a near-miss on a real extension       | `/assets/index-abc123.jsx`    |
      | a favicon that is not in the bundle   | `/favicon.ico`                |
      | a crawler probe                       | `/robots.txt`                 |
      | a web manifest that is not shipped    | `/manifest.json`              |

  # The deliberate narrowing. EVERY row below answers `200 text/html` with the app shell
  # on this origin today (measured) — that is the live asset-masking defect, and this
  # scenario is the one that removes it.
  Scenario Outline: the identical request returns 404 on the FLEET origin — today's unconditional fallback is narrowed by the same predicate
    When I request <path> on the fleet origin
    Then the response status is 404, not 200
    And the response does not carry `content-type: text/html`, and its body does not contain `<div id="root">`
    And the response body is JSON whose `ok` is false and whose `code` is "not-found"

    Examples:
      | case                                  | path                          |
      | a missing hashed JavaScript bundle    | `/assets/index-missing.js`    |
      | a missing hashed stylesheet           | `/assets/index-missing.css`   |
      | a sourcemap the build never emitted   | `/assets/index-abc123.js.map` |
      | a near-miss on a real asset's name    | `/assets/index-abc124.js`     |
      | a near-miss on a real extension       | `/assets/index-abc123.jsx`    |
      | a favicon that is not in the bundle   | `/favicon.ico`                |
      | a crawler probe                       | `/robots.txt`                 |
      | a web manifest that is not shipped    | `/manifest.json`              |
    # The two tables are deliberately the same list on purpose: "the same request, the
    # same answer, whichever origin you ask" is the claim, and a shorter fleet table
    # would leave the reader to assume the rest.

  # The regression guard. Narrowing the fallback must not cost a single real file — a
  # rule that 404s everything would pass both scenarios above.
  Scenario Outline: an asset that DOES exist is still served as itself, with its own content type, on every origin
    When I request <path> on the board origin, on the config-editor origin and on the fleet origin
    Then every response has status 200 with `content-type: <content-type>`
    And every response body is the file's own bytes, byte-identical to the file on disk
    And the two `/assets/...` rows are not HTML on any origin — neither carries `content-type: text/html`

    Examples:
      | case                       | path                       | content-type    |
      | the hashed JS bundle       | `/assets/index-abc123.js`  | text/javascript |
      | the hashed stylesheet      | `/assets/index-abc123.css` | text/css        |
      | the shell requested by name| `/index.html`              | text/html       |
    # `.svg` and `.json` are NOT in this table on purpose — the two `contentType` copies
    # disagree about them (see the header). Adding a row would bless the drift.

  # The operator's actual experience of the bug, walked end to end: this is what "a
  # broken deploy fails at its cause" means, and it is the one scenario that shows the
  # fallback and the 404 rule working TOGETHER.
  Scenario: a deploy that shipped without its JavaScript fails at the asset, not at the shell
    Given the same bundle with "assets/index-abc123.js" DELETED — a deploy that shipped its shell but not its script
    When I request `/board` on the board origin
    Then the response is 200 `text/html` and its body contains `<div id="root">`
    When I request the `src` the shell's own `<script type="module">` names, on that same origin
    Then the response status is 404
    And the response does not carry `content-type: text/html`, and its body does not contain `<div id="root">`
    And the same two requests on the config-editor origin and on the fleet origin give the same two answers
    # Before this story the second request answers `200 text/html` on the fleet origin,
    # which is what turns a missing file into `Uncaught SyntaxError: Unexpected token
    # '<'` in a console with no line of sight to the deploy.

  # A directory is not a file and is never enumerated. Guards against the other way a
  # static handler leaks: answering a directory request with its contents.
  Scenario: a request for a directory is never a listing on any origin
    When I request `/assets` and `/assets/` on the board origin, on the config-editor origin and on the fleet origin
    Then no response body contains the name of the unreferenced file "decoy-9f9f.js"
    And no response carries `content-type: application/octet-stream`
    And no response has a 5xx status
    # What these paths DO answer (the app shell, because they are extension-less) is
    # task 01's scenario 1. This scenario asserts only what they must never answer.

  # Hardening: the masking rule must not be escapable by spelling the dot differently.
  # No browser emits this — vite writes literal dots — so these rows exist to keep the
  # rule honest rather than to describe traffic.
  Scenario Outline: a missing asset cannot dodge the 404 by percent-encoding its extension
    When I request <path> on the board origin, on the config-editor origin and on the fleet origin
    Then every response status is 404
    And no response carries `content-type: text/html`, and no response body contains `<div id="root">`
    And the same request with a literal dot, <literal>, also answers 404 on all three (the control)

    Examples:
      | case                       | path                          | literal                    |
      | an encoded dot, uppercase  | `/assets/index-missing%2Ejs`  | `/assets/index-missing.js` |
      | an encoded dot, lowercase  | `/assets/index-missing%2ejs`  | `/assets/index-missing.js` |
    # DECISION, NOT MEASUREMENT — flagged so a later reader meets it. `new URL()` does
    # NOT decode `%2E`, so a predicate reading the RAW pathname sees no dot, calls this
    # extension-less, and answers the app shell — the masking guard bypassed by an
    # encoding. Written here as a 404, i.e. the rule is applied to the path the server
    # actually resolved. If the architect rules the predicate operates on the raw
    # pathname, this scenario becomes a documented known-limitation with its expected
    # values flipped — the case exists either way.

  # A miss is a miss, not damage. The house's "the server survived" check.
  Scenario: a run of misses leaves every origin serving normally
    When I request every path from the first scenario, in order, on each origin
    Then no response has a 5xx status and no origin closes the connection
    And a subsequent `GET /assets/index-abc123.js` on each origin is 200 with `content-type: text/javascript`
    And a subsequent `GET /` on each origin is 200 `text/html` containing `<div id="root">`
