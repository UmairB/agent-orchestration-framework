<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY task 00 (m45/ADR-004): the directory-traversal guard has ONE
# definition, observed as ONE BEHAVIOUR. `safeStaticPath` is defined twice today,
# byte-identically (`setup-ui.mjs:269-280` and `mesh-ui-serve.mjs:873-884`; `diff`
# exits 0) and folds into `src/static-serve.mjs` as a deletion plus an import at each
# site.
#
# THE PLACEMENT HALF IS NOT RESTATED HERE. "Defined exactly once in `src/`", "both
# servers import the leaf", "the leaf has no local imports" are PLACEMENT invariants
# and live in `test/arch/acd-spa-fallback-never-masks.test.mjs` (already written).
# What is behavioural — and is the whole of this task — is that the same request line
# gets the same refusal on every origin. A server that kept its own hand-rolled copy
# would pass these scenarios and fail the arch test; that is the correct division of
# labour, not a gap. Note only the delegation: `board-serve.mjs:20` hands the board
# origin to the SAME handler the config editor runs, so those two origins are one
# handler observed twice — which is why scenario 3 exists to prove it rather than
# assume it.
#
# LITMUS: every Then is a real HTTP request against a started server, asserting the
# status line, the `content-type` header, and whether the body carries (a) the marker
# text planted in a file OUTSIDE the served root, or (b) the app shell's `<div
# id="root">`. Never "the function returns null", never "the module exports X".
#
# MEASURED 2026-08-06 at `eacbd57` (macOS host, real HTTP against real
# `serveBoard` / `serveSetupUi` / `serveMeshUi`) — the rows below are measurements,
# not guesses, and no request on any origin today returned a byte from outside the
# served root:
#
#   - THE URL PARSER FLATTENS UNENCODED DOT SEGMENTS BEFORE THE HANDLER SEES THEM.
#     `new URL()` normalises `/../package.json` → `/package.json`, and it also treats
#     a whole segment of `%2e%2e` as a dot segment (`/%2e%2e/%2e%2e/package.json` →
#     `/package.json`). So those forms never reach the guard at all — they arrive as
#     plain missing files. The load-bearing vector is the one where the SLASH is
#     ENCODED (`%2f` / `%5c`), which keeps the traversal inside ONE segment past the
#     parser and only expands inside the guard's own `decodeURIComponent`. That is why
#     the encoded-slash rows carry the weight of scenario 1 and the flattened forms get
#     their own scenario (5) that says what they really are.
#   - THE MIXED-SEPARATOR ROW IS THE ONE THAT ALREADY ANSWERS THREE DIFFERENT WAYS.
#     `GET /%2e%2e%5cpackage.json` today: 404 `text/plain` on the board/config origin;
#     **200 `text/html` — the app shell — on the fleet origin** (measured, macOS); and
#     404 on BOTH on a Windows control node, where `path.sep` is `\` so the guard
#     actually fires. One request line, three answers across (origin x platform). The
#     two guard copies are identical; what diverges is what happens AFTER a miss, which
#     is the same class of defect one layer up. After ADR-004 it is 404 everywhere,
#     because the fallback is gated and `package.json` carries an extension.
#   - ORDERING IS A REAL DECISION AND IT IS PINNED IN SCENARIO 2. Several traversal
#     forms end in an extension-less segment (`…%2fetc%2fpasswd`). If the new handler
#     routes a REFUSED path into `shouldServeAppShell`, an attempted traversal answers
#     `200 text/html` instead of being refused. Both servers return AT the guard today
#     (measured 404) and must keep doing so: the guard is decided BEFORE the fallback.
#     The PO's word is "refused"; a 200 carrying the shell is not a refusal.
#   - THE REFUSAL'S RENDERING DIFFERS PER ORIGIN AND THIS STORY DOES NOT CHANGE IT.
#     The board/config origin answers `404 text/plain "Not found"`
#     (`setup-ui.mjs:130-134`); the fleet origin answers its coded JSON envelope
#     `{ ok:false, error, code:"not-found" }` (`mesh-ui-serve.mjs:565`). "Refused
#     identically" is therefore asserted as the DECISION (same status, no leak, never
#     the shell) and each origin's envelope is pinned as-is in scenario 4, so a later
#     unification is a deliberate act rather than an accident. Raised to the PO as a
#     design-gap, not fixed here.
#
# DELIBERATELY NOT IN ANY TABLE, with reasons (a platform-dependent row is a flaky row):
#   - an extension-less encoded-BACKSLASH form (`/%2e%2e%5cpackage`): kept out of the
#     tables, but the original reason is CORRECTED here (QA F-4, 2026-08-07). As
#     authored, this note claimed a platform SPLIT (posix: miss → shell; Windows:
#     refused). The shipped predicate makes the answer platform-UNIFORM 404: the
#     decoded last segment `..\package` contains a dot, so `shouldServeAppShell`
#     refuses it on posix, and on Windows the guard refuses it first — 404 by two
#     different mechanisms, same answer. Excluded now only because a row proved by
#     different mechanisms per platform documents less than it appears to; the
#     cross-platform invariant ("no byte from outside the root, ever") is already
#     carried by every row's marker assertion.
#   - a case-variant asset path (`/ASSETS/…`): 200 on macOS and Windows
#     (case-insensitive filesystems), 404 on Linux. Measured, and excluded for it.
#
# FEASIBILITY: nothing new is needed to author this RED. Both servers exist, both take
# a `uiRoot`/`repoRoot` fixture, and `test/setup-ui.test.mjs::keepsStaticPathsInsideUiRoot`
# and `test/board-serve.test.mjs` already start them exactly this way — this task
# extends that existing black-box channel rather than inventing one. Run focused and
# isolated: `AOF_GLOBAL_HOME=$(mktemp -d) node --test test/<file>`.

@executable @cli @board @distribution
Feature: the directory-traversal guard is ONE rule, so a request one origin refuses is refused the same way on the other
  In order that hardening the guard once hardens every origin — instead of leaving the second copy, and the origin behind it, quietly unprotected
  the board, the config-editor and the fleet origins must all refuse the same traversal attempt with the same status, must never return a byte from outside the bundle they serve, and must never answer an attempted escape with the app shell

  Background:
    Given a built bundle on disk holding "index.html" (the app shell — its body carries `<div id="root">`), "assets/index-abc123.js" and "assets/index-abc123.css"
    And a file named "package.json" one directory ABOVE that bundle, carrying the marker text "OUTSIDE-THE-ROOT" (the target every `..` row below names)
    And the served bundle contains no file of its own named "package.json", so a 200 carrying that marker could only have come from outside the root
    And the board origin serving that bundle on 127.0.0.1 (the board server, which reaches the shared static handler by delegation)
    And the config-editor origin serving the same bundle on 127.0.0.1 (that same static handler, started directly against the built bundle)
    And the fleet origin serving the same bundle on 127.0.0.1

  # Headline: one request line, one answer, on every origin. Every row holds the
  # traversal as the ONLY variable — same server, same bundle, same method.
  Scenario Outline: the same traversal form is refused on every origin, and no byte from outside the served root is ever returned
    When I request <path> on the board origin, on the config-editor origin and on the fleet origin
    Then all three responses have status 404
    And no response body contains the marker text "OUTSIDE-THE-ROOT"
    And no response carries `content-type: text/html`, and no response body contains `<div id="root">`
    And each origin still answers `GET /assets/index-abc123.js` with 200 afterwards (the refusal did not damage the server)

    Examples:
      | case                                          | path                                                      |
      | encoded dot-dot with an encoded slash         | `/%2e%2e%2fpackage.json`                                  |
      | a partly-encoded two-level escape             | `/..%2f..%2fetc%2fhosts`                                  |
      | the mixed separator (backslash), extensioned  | `/%2e%2e%5cpackage.json`                                  |
      | an encoded ABSOLUTE path                      | `/%2fetc%2fhosts`                                         |
      | a Windows drive-letter absolute path          | `/C:/Windows/win.ini`                                     |
      | an encoded absolute path to a dotfile dir     | `/%2fUsers%2fnobody%2f.ssh%2fknown_hosts`                 |
      | double encoding is not a second decode pass   | `/%252e%252e%252fpackage.json`                            |
      | a malformed percent-escape                    | `/%E0%A4%A`                                               |
      | an invalid percent-escape                     | `/%ZZ`                                                    |
      | dots that are not a dot segment               | `/....//package.json`                                     |
    # Rows 3 and 5 are the ones that are NOT uniform today (macOS: 404 on the
    # board/config origin, 200 + the app shell on the fleet origin) — they are the
    # story's own red. Row 7 pins single-decode: a guard that looped
    # `decodeURIComponent` until stable would turn `%252e%252e%252f` back into `../`.

  # ORDERING. A refused path whose last segment happens to be extension-less must not
  # be handed to the history fallback: an attempted escape answers "refused", never
  # "here is the app shell". Both servers return AT the guard today; this keeps them
  # there once a fallback exists on both.
  Scenario Outline: an attempted escape is never converted into the app shell — the guard is decided BEFORE the fallback
    When I request <path> on the board origin, on the config-editor origin and on the fleet origin
    Then all three responses have status 404, not 200
    And no response carries `content-type: text/html`, and no response body contains `<div id="root">`
    And no response body contains the marker text "OUTSIDE-THE-ROOT"

    Examples:
      | case                                      | path                                                            |
      | an extension-less escape, one level       | `/%2e%2e%2fpackage`                                             |
      | an extension-less escape, six levels      | `/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd` |
      | an encoded absolute, extension-less       | `/%2fetc%2fpasswd`                                              |
      | a partly-encoded escape, extension-less   | `/..%2f..%2fetc%2fshadow`                                       |

  # The delegation, stated behaviourally: these are not two handlers that agree, they
  # are one handler reached twice. Any refusal that differed between them would mean
  # the delegation had been broken.
  Scenario: the board origin and the config-editor origin return the identical refusal for the identical request
    When I request `/%2e%2e%2fpackage.json` on the board origin and on the config-editor origin
    Then both responses have the same status, the same `content-type` and the same body bytes
    And both are 404 and neither contains the marker text "OUTSIDE-THE-ROOT"

  # The refusal's RENDERING is per-origin and pre-existing; pinning it here makes any
  # later unification a decision rather than a surprise — and pins the thing that
  # actually matters about a refusal body: it names nothing.
  Scenario: each origin refuses in its own established not-found envelope, and neither names a filesystem path
    When I request `/%2fetc%2fhosts` on the board origin and on the fleet origin
    Then the board origin answers 404 with `content-type: text/plain` and the body `Not found`
    And the fleet origin answers 404 with `content-type: application/json` and a body whose `ok` is false and whose `code` is "not-found"
    And neither body contains the served bundle's absolute directory path, an OS path prefix, or a stack trace

  # What the URL parser already flattened is a plain missing file — not a bypass, and
  # not evidence that the guard fired. Said out loud so nobody reads scenario 1's
  # green as covering the unencoded form.
  Scenario Outline: a path the URL parser has already flattened arrives as a plain missing file, and is still not served
    When I request <path> on the board origin, on the config-editor origin and on the fleet origin
    Then all three responses have status 404
    And no response body contains the marker text "OUTSIDE-THE-ROOT"
    And no response carries `content-type: text/html`

    Examples:
      | case                                     | path                          | what the handler actually receives |
      | an unencoded parent escape               | `/../package.json`            | `/package.json`                    |
      | an unencoded escape from a subdirectory  | `/assets/../../package.json`  | `/package.json`                    |
      | whole-segment encoded dot segments       | `/%2e%2e/%2e%2e/package.json` | `/package.json`                    |

  # Malformed input is answered, never crashed — the house's "the miss did not kill
  # the server" check, applied to the guard. The status is deliberately not pinned per
  # row (a NUL byte decodes cleanly and is a missing file, not an escape); what is
  # pinned is that nothing 5xxs, nothing leaks and the server keeps serving.
  Scenario Outline: malformed and control-character input is answered cleanly and the server keeps serving
    When I request <path> on the board origin, on the config-editor origin and on the fleet origin
    Then no response has a 5xx status
    And no response body contains a stack trace, an error class name, or the served bundle's absolute directory path
    And every origin still answers `GET /assets/index-abc123.js` with 200 and `content-type: text/javascript` afterwards
    And every origin still answers `GET /` with 200 and `content-type: text/html` afterwards

    Examples:
      | case                          | path             |
      | an invalid percent-escape     | `/%ZZ`           |
      | a truncated UTF-8 escape      | `/%E0%A4%A`      |
      | an encoded NUL byte           | `/%00`           |
      | a NUL byte inside a filename  | `/index%00.html` |

  # The guard refuses ESCAPE, not DEPTH — a nested file that genuinely lives inside the
  # served root is still served. Without this row a guard that refused everything would
  # pass every scenario above.
  Scenario: a file that legitimately lives inside the served root is still served on every origin
    When I request `/assets/index-abc123.js` on the board origin, on the config-editor origin and on the fleet origin
    Then all three responses have status 200 with `content-type: text/javascript` and the asset's own bytes
    And a request for `/assets/index-abc123.css` on all three answers 200 with `content-type: text/css`
