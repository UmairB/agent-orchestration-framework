<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY 45/01, ADR-002: THE TABLE. Four paths name four distinct
# surfaces; every other pathname names one shared 404 surface and keeps its address;
# nothing under the built bundle's asset directory is a route at all. This task varies
# the PATHNAME and never touches the query string — the legacy translation is task 01
# and the passthrough is task 02.
#
# LITMUS: every Then is confirmable by an outsider without reading source. This module
# is PURE and has NO CLI surface, so the black-box channel is `node:test` importing
# `ui/src/app/routes.mjs` and asserting on RETURNED VALUES — no bundler, no DOM, no
# React harness (this repo has none at all). That channel is legitimate and it is the
# house pattern: `test/fleet-scope.test.mjs` does exactly this for
# `ui/src/fleet/scope.mjs`, whose own header states the rule ("render-logic node:test
# must exercise belongs in a plain .mjs helper the .tsx wires up"). Every Then below is
# "call this exported function with this input, read this returned value" — nothing
# else, and never a source read.
#
# NOT ASSERTED HERE — two PLACEMENT invariants that live in the arch test
# `test/arch/acd-route-logic-framework-free.test.mjs` (already written, expected-RED
# until this story lands): (a) the module imports no React/DOM and reaches for no
# `window` / `location` / `history` global; (b) it names no query key but `mode`. A Then
# saying "the function is pure" or "React is not imported" would be reading the source,
# which the LITMUS forbids. Purity is what makes every scenario below RUNNABLE; it is
# not one of them. Same division of labour as m43/01's task 00.
#
# THE TWO EXPORTS THIS TASK READS, spelled as ADR-001 §Decision and the arch test spell
# them:
#     routeFor(pathname)                            → a route entry, ALWAYS
#     legacyRedirectFor({ pathname, search, hash }) → { pathname, search, hash } | null
# The story brief calls the first `matchRoute`. ADR-001 and all five assertions in
# `acd-route-logic-framework-free.test.mjs` say `routeFor`, and that suite is committed
# and registered — so a build satisfying `matchRoute` would pass this feature and fail
# CI. `routeFor` is used throughout. FINDING F-45-01-A: reconcile the two names in ONE
# place before build starts.
#
# THE SURFACE NAMES — `landing` / `fleet` / `board` / `config` / `not-found` — are QA's
# proposal, not an ADR's. ADR-002 fixes WHICH four paths resolve and that one shared
# fifth entry answers for everything else; it names nothing, and a Then cannot be
# confirmed against an anonymous object. The names are therefore pinned here and become
# the contract the moment this feature is green. What is NOT negotiable whatever the
# spelling: five entries, pairwise distinct, exactly one shared not-found, stable across
# repeated calls, and `not-found` never equal to `/`'s entry.
#
# FEASIBILITY: nothing exists yet — `ui/src/app/routes.mjs` IS this story's output, so
# every scenario is RED on day one and that is correct (the m43 house convention: a
# contract, not a report on the present). Satisfiability was proven at refine —
# ARCHITECTURE §"Satisfiability was verified": a throwaway prototype of this exact
# module turned all 16 fitness assertions green and was reverted. Every pathname below
# is either an address a producer measurably emits at `eacbd57` or a string a browser
# can put in `location.pathname`.

@executable @ui @work @distribution
Feature: the route table names exactly one surface for every path, and an unknown path is a 404 that keeps its address
  In order that every address this product has ever handed out has one stated meaning — and a typo, a stale bookmark and a newly-rewritten in-app link stay visibly different from a working one
  the route table must answer for EVERY pathname, resolve each of the four real paths to its own distinct surface, resolve everything else to ONE shared not-found surface, and rewrite nothing

  Background:
    Given `ui/src/app/routes.mjs` imported directly by `node:test` under plain node — no bundler, no DOM, no React
    And the built bundle emits its own JavaScript and CSS under `/assets/` (`ui/dist/assets/index-*.js`, verified on disk) on every origin that serves it
    And nothing in this task supplies a query string or a fragment — the pathname is the only input the table reads

  # Headline: four paths, four surfaces, one each. The `And` lines are what make
  # "exactly one" checkable rather than decorative.
  Scenario Outline: each of the four paths resolves to exactly one named surface
    When I call `routeFor(<pathname>)`
    Then the entry it returns is named <surface>
    And no OTHER path in the exported route table carries the name <surface>
    And calling `routeFor(<pathname>)` a second time returns an entry deep-equal to the first

    Examples:
      | case                                                                  | pathname  | surface   |
      | the shell landing — m49 replaces what it RENDERS, never the route     | "/"       | landing   |
      | the fleet surface, `<Fleet>` unchanged                                | "/fleet"  | fleet     |
      | the board surface, `<Board>` unchanged                                | "/board"  | board     |
      | the config editor `<App>` — its NEW address, deliberately not /assets | "/config" | config    |

  # An unknown path is the shell's 404 surface — ONE of them, shared — and the address
  # bar is left carrying the path that was typed. The last Then is the "not rewritten"
  # half of the PO's headline, read through the only channel a pure module has for it:
  # the redirect function declining to answer.
  Scenario Outline: an unknown path resolves to the shell's 404 surface, and the address is not rewritten
    When I call `routeFor(<pathname>)`
    Then the entry it returns is named not-found
    And it is deep-equal to the entry EVERY other unknown path returns — one 404 surface, never one per typo
    And it is NOT deep-equal to the entry `routeFor("/")` returns — an unknown path is never aliased or redirected to the landing
    And `legacyRedirectFor({ pathname: <pathname>, search: "", hash: "" })` returns null, so the entry issues no `history.replaceState` and the address bar keeps <pathname> verbatim

    Examples:
      | case                                                            | pathname          |
      | a near-miss typo of a real route                                | "/fleeet"         |
      | a path nothing has ever served                                  | "/nope"           |
      | a DOUBLE trailing slash — only a SINGLE one is tolerated        | "/fleet//"        |
      | the bare protocol-relative root — never normalised to landing   | "//"              |
      | a real route in the wrong case (URL paths are case-sensitive)   | "/Fleet"          |
      | a real route used as the PREFIX of a deeper path                | "/config/editor"  |
      | the board's item deep-link written as a PATH segment            | "/board/42"       |
      | a deep path no table row could ever cover                       | "/a/deep/path"    |
    # FINDING F-45-01-C — RESOLVED by PO ruling, recorded in ADR-002 [Amigos-6] and
    # STATE.md (2026-08-06): a SINGLE trailing slash is matched IN PLACE — it is a
    # punctuation variant of the same path, so "/fleet/" resolves to the fleet entry
    # with NO rewrite (the no-redirect rule is untouched; the matcher is tolerant, the
    # address bar keeps what was typed). This overturned the exact-match default this
    # row previously pinned; the row moved to its own scenario below. The DOUBLE-slash
    # row above pins the ruling's boundary: ADR-002 tolerates "a single trailing
    # slash", so "/fleet//" stays an unknown path. Case variants stay 404s too — the
    # asymmetry is deliberate (a case variant is a DIFFERENT path that happens to look
    # similar; ADR-002).
    #
    # THE "/board/42" ROW pins that the board's item deep-link stays a FRAGMENT
    # (`#42`, ADR-006 / Board.tsx:585) and never becomes a path segment. If m47 or m49
    # ever wants item paths, that is a table change with its own ADR — not something a
    # route module should start tolerating by accident.

  # F-45-01-C's resolution, pinned: the PO ruled (ADR-002 [Amigos-6]) that a single
  # trailing slash is understood in place. The last Then is the "no rewrite" half —
  # the redirect function declines, so the address bar keeps the slash the operator
  # typed and no second URL vocabulary appears.
  Scenario Outline: a single trailing slash on a real route is matched in place, and the address is not rewritten
    When I call `routeFor(<pathname>)`
    Then the entry it returns is named <surface>
    And it is deep-equal to the entry `routeFor(<canonical>)` returns — one entry, not a slash-variant twin
    And `legacyRedirectFor({ pathname: <pathname>, search: "", hash: "" })` returns null, so the entry issues no `history.replaceState` and the address bar keeps <pathname> verbatim

    Examples:
      | case                                   | pathname   | canonical | surface |
      | the fleet surface, pasted with a slash | "/fleet/"  | "/fleet"  | fleet   |
      | the board surface                      | "/board/"  | "/board"  | board   |
      | the config editor                      | "/config/" | "/config" | config  |

  # The `/assets` collision, made behavioural. ADR-002 forecloses `/assets` as a route
  # name because it IS the directory serving this bundle's own JavaScript; the second
  # Then is the sharp edge, because `assets` is simultaneously a live legacy MODE value
  # that task 01 maps onto `/config`.
  Scenario Outline: a request under the bundle's asset directory is not matched by the route table at all
    When I call `routeFor(<pathname>)`
    Then the entry it returns is named not-found
    And it is NOT named config — the legacy MODE value is `assets`, the PATH never is

    Examples:
      | case                                                    | pathname                      |
      | the asset directory itself                              | "/assets"                     |
      | the asset directory with a trailing slash               | "/assets/"                    |
      | the bundle's own hashed JavaScript                      | "/assets/index-DkR2xu9f.js"   |
      | the bundle's own hashed stylesheet                      | "/assets/index-B7yQ1a2c.css"  |
      | the bundle's entry document                             | "/index.html"                 |
      | a root-level static file                                | "/favicon.ico"                |
      | an API path — never the client's to answer              | "/api/mesh/status"            |
    # These pathnames mostly never reach the client at all: ADR-004's server-side
    # discriminator ("no file extension") 404s every extensioned request before the
    # shell loads. That is the SERVER's guard and it is story 45/02's to prove. This
    # table is the CLIENT's independent half of the same promise — belt and braces on a
    # rule whose failure mode (a hashed asset answered with `index.html`, arriving as
    # `Uncaught SyntaxError: Unexpected token '<'`) lands arbitrarily far from its cause.

  # Totality's real boundary. `location.pathname` is never empty in a browser, so every
  # row here is a caller mistake or a hostile input — and the answer to all of them is
  # the same shapeless-input discipline `ui/src/fleet/scope.mjs` already ships
  # ("an invalid scope param falls back to global, never throws").
  Scenario Outline: a shapeless or hostile pathname resolves to not-found and never throws
    When I call `routeFor(<pathname>)`
    Then the call returns the not-found entry
    And the call does not throw

    Examples:
      | case                                        | pathname                     |
      | an empty pathname                           | ""                           |
      | no pathname at all                          | null                         |
      | an undefined pathname                       | undefined                    |
      | a value that is not a string                | 42                           |
      | a pathname with no leading slash            | "fleet"                      |
      | a protocol-relative-looking path            | "//fleet"                    |
      | a path that names ANOTHER HOST              | "//evil.example.com/fleet"   |
    # THE LAST TWO ROWS ARE NOT PEDANTRY. `new URL("//evil.example.com/fleet",
    # "http://127.0.0.1:4181")` resolves to `http://evil.example.com/fleet` — measured.
    # A table that normalises its input by constructing a URL against the current origin
    # would silently accept a host swap as a "pathname", which is the open-redirect
    # shape one layer down. The table must treat both as ordinary unknown pathnames and
    # name no surface.

  # The three properties the PO's fourth headline names — total, deterministic,
  # single-valued — asserted over the exported table itself rather than one path at a
  # time, so a fifth row added by m47 or m49 cannot quietly break them.
  Scenario: the table is total, deterministic and single-valued
    When I read the exported route table and call `routeFor` across it
    Then the table holds exactly FOUR addressable entries plus ONE not-found entry
    And their five names are pairwise distinct — no path names two surfaces, and no surface is named by two paths
    And for every addressable entry, `routeFor` called with that entry's own path returns that same entry
    And calling `routeFor` twice in a row for each of "/", "/fleet", "/board", "/config" and "/nope" returns deep-equal answers both times — no memo, no hidden state, no dependence on call order
    And a caller that mutates an entry `routeFor` returned does not change what the next call answers
    And `routeFor("/board")` returns the same entry whether or not the caller passes any second argument — the table takes a pathname and nothing else, so there is no origin for an origin conditional to read
    # THE MUTATION LINE is the strict reading of "the same input always resolves the
    # same way", and it is the one an outsider can actually break: a table handed out by
    # reference is one careless `entry.name = …` away from a route that changes meaning
    # mid-session, in a way no other test would ever see. `Object.freeze` on the table
    # satisfies it for free.
    #
    # THE ORIGIN LINE is ADR-002's ORIGIN-BLIND rule made black-box. One bundle is
    # served from three origins with different API surfaces; the table must not learn
    # which. Asserting the answer is unchanged by ANY extra argument is the strongest
    # statement a pure function can make about a conditional it does not have.
