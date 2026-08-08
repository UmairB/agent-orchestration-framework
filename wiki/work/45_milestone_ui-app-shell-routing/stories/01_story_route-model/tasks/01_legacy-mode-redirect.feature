<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY 45/01, ADR-003: THE LEGACY TRANSLATION. Every `?mode=` URL this
# product has ever advertised becomes its path; `mode` is the only thing removed; a URL
# that already carries a path is returned UNCHANGED, so the rewrite is idempotent and
# cannot loop. This task varies the LEGACY URL and holds the passthrough constant —
# which parameters and fragments survive is task 02, and which pathname names which
# surface is task 00.
#
# WHY THE COVERAGE IS TOTAL RATHER THAN BEST-EFFORT, and it is a measurement, not a
# promise: EVERY advertised URL in this codebase carries a `mode` selector —
# `board-serve.mjs:41,62`, `mesh-ui-serve.mjs:143,736`, `commands/assets-ui.mjs:45,117`,
# `app/desktop/crates/app/src/supervisor.rs:44`, `Fleet.tsx:1398`, and the page URL
# `/api/mesh/board-url` returns. NOTHING advertises a bare `/`. Every row in the first
# Examples table below is one of those addresses read off the tree at `eacbd57`, not a
# hypothetical — which is what turns "no URL loses meaning" into a countable claim.
#
# LITMUS: every Then is confirmable by an outsider without reading source. This module
# is PURE and has NO CLI surface, so the black-box channel is `node:test` importing
# `ui/src/app/routes.mjs` and asserting on RETURNED VALUES — the house pattern
# (`test/fleet-scope.test.mjs` does exactly this for `ui/src/fleet/scope.mjs`). Every
# Then is "hand these URL parts to `legacyRedirectFor`, read the answer". The one thing
# an outsider must be told to read the answers correctly is stated in the Background:
# a NULL answer means the entry issues no `history.replaceState`, so the address bar is
# left exactly as the operator found it.
#
# NOT ASSERTED HERE — PLACEMENT invariants owned by
# `test/arch/acd-route-logic-framework-free.test.mjs` (already written, expected-RED):
# the module is React-free and DOM-free, and it names no query key but `mode`. Also NOT
# here: that the translation is applied EXACTLY ONCE at the entry and nowhere else —
# that is a property of `main.tsx` (story 45/03) and of `acd-ui-single-route-table` /
# `acd-no-surface-mode-url-literal`, not of this function. What IS asserted here is the
# property that makes "exactly once" safe to get wrong: applying it twice changes
# nothing.
#
# THE EXPORT THIS TASK READS, spelled as ADR-003 and the arch test spell it:
#     legacyRedirectFor({ pathname, search, hash }) → { pathname, search, hash } | null
# It takes URL PARTS, not a URL string (the story brief says `legacyRedirectFor(url)`);
# parts are what ADR-003 §Decision names and what the committed arch test calls. Like
# `scope.mjs`, the module touches no `location` of its own — the caller passes the parts
# in and wires the answer to `history`. FINDING F-45-01-A covers the same name/shape
# reconciliation for `routeFor` (see task 00's header).
#
# FEASIBILITY: nothing exists yet — the module IS this story's output, so every scenario
# is RED on day one and that is correct. Satisfiability was proven at refine
# (ARCHITECTURE §"Satisfiability was verified": a throwaway prototype turned all 16
# fitness assertions green, then was reverted). Every measured behaviour the Examples
# depend on was re-checked in plain node while authoring: `URLSearchParams.delete("mode")`
# removes EVERY occurrence; `.get("mode")` returns the FIRST; deleting the only
# parameter leaves an EMPTY string, never a bare "?"; a search with no leading "?" parses
# identically.

@executable @ui @work @distribution
Feature: every legacy `?mode=` URL becomes its path, `mode` is the only thing removed, and the rewrite cannot loop
  In order that no address this product has ever printed, bookmarked or compiled into the desktop app quietly stops working — and that the address bar then means one thing rather than two
  the one pure `legacyRedirectFor` must map every advertised `?mode=` value onto its path, delete `mode` and nothing else, and answer null for every URL that is already canonical

  Background:
    Given `ui/src/app/routes.mjs` imported directly by `node:test` under plain node — no bundler, no DOM, no React
    And `legacyRedirectFor({ pathname, search, hash })` returns the canonical `{ pathname, search, hash }`, or null when there is nothing to rewrite
    And the entry applies it EXACTLY ONCE, before the first render, as a `history.replaceState` — so a null answer means no rewrite is issued and the address bar is left exactly as it was
    And a rewrite is a REPLACE and never a PUSH, so the history stack stays as deep as the operator's own navigation made it

  # Headline: the full advertised set. Each row names the producer it was measured from,
  # so an outsider can re-derive the row from the tree rather than trusting the table.
  Scenario Outline: every `?mode=` URL the product has ever advertised maps onto its path
    When I call `legacyRedirectFor({ pathname: <pathname>, search: <search>, hash: <hash> })`
    Then it returns a rewrite whose pathname is <to pathname>
    And whose search reads back as <to search>
    And whose hash is <to hash>

    Examples:
      | case                                                                              | pathname | search                      | hash  | to pathname | to search        | to hash |
      | the fleet server's advertised URL AND the desktop tray's compiled constant        | "/"      | "?mode=fleet&scope=global"  | ""    | "/fleet"    | "?scope=global"  | ""      |
      | the same server advertising local scope                                           | "/"      | "?mode=fleet&scope=local"   | ""    | "/fleet"    | "?scope=local"   | ""      |
      | the fleet's bare advertised URL (mesh-ui-serve.mjs:736)                           | "/"      | "?mode=fleet"               | ""    | "/fleet"    | ""               | ""      |
      | the board server's advertised URL (board-serve.mjs:41,62)                         | "/"      | "?mode=board"               | ""    | "/board"    | ""               | ""      |
      | board-url's drill-in for a milestone (mesh-ui-serve.mjs:278 → Fleet.tsx:514)      | "/"      | "?mode=board"               | "#18" | "/board"    | ""               | "#18"   |
      | the in-app board cross-link (Fleet.tsx:1398)                                      | "/"      | "?mode=board"               | ""    | "/board"    | ""               | ""      |
      | the config editor's launcher (assets-ui.mjs:45,117)                               | "/"      | "?mode=assets"              | ""    | "/config"   | ""               | ""      |
      | an UNRECOGNISED mode value — main.tsx:1266's `else` branch, kept verbatim         | "/"      | "?mode=wat"                 | ""    | "/config"   | ""               | ""      |
      | an EMPTY mode value — `.get("mode")` is "" today, which is also the `else` branch | "/"      | "?mode="                    | ""    | "/config"   | ""               | ""      |
      | mode in the WRONG CASE — `"Fleet" !== "fleet"` today, so the `else` branch again  | "/"      | "?mode=Fleet"               | ""    | "/config"   | ""               | ""      |
      | mode given TWICE — the FIRST wins, and BOTH copies are removed                    | "/"      | "?mode=board&mode=fleet"    | ""    | "/board"    | ""               | ""      |
    # THE DOUBLE-MODE ROW IS THE LOOP GUARD, and it is the one row that can turn this
    # milestone into a defect that is worse than the thing it fixes. A rewrite that
    # removes only the FIRST occurrence answers `/board?mode=fleet` — which is a legacy
    # URL again. The entry would rewrite it on the next load, to `/fleet`, and the
    # address would flip between two surfaces forever. `URLSearchParams.delete("mode")`
    # removes every occurrence (measured); a hand-rolled string strip typically does not.
    #
    # THE EMPTY-MODE AND WRONG-CASE ROWS are HEAD behaviour read literally off
    # `main.tsx:1261-1266`, not a new rule: today ANYTHING that is not exactly "fleet"
    # or "board" renders `<App>`. ADR-003 keeps that `else` verbatim rather than letting
    # it silently become a 404 — a bookmark that renders the config editor today must
    # render the config editor tomorrow, however odd the mode value that got it there.
    #
    # THE BARE-FLEET ROW's empty `to search` is deliberate: with `mode` deleted, the
    # search must be the EMPTY string and never a bare "?" — a naked question mark in
    # the address bar is a second spelling of the same address, and it is exactly the
    # kind of drift a `toString()` on an emptied `URLSearchParams` produces if it is
    # prefixed unconditionally.

  # `mode` is the only thing removed — asserted against the parameter shapes most likely
  # to be eaten by a naive implementation, not just the polite ones.
  Scenario Outline: `mode` is the only parameter removed
    When I call `legacyRedirectFor({ pathname: "/", search: <search>, hash: "" })`
    Then it returns a rewrite whose pathname is "/fleet"
    And reading its search back with `URLSearchParams` yields exactly <surviving>
    And the key "mode" is absent from the answer

    Examples:
      | case                                                                  | search                          | surviving                  |
      | `?scope=` — a live deep-link contract with server-side consumers      | "?mode=fleet&scope=global"      | scope=global               |
      | `?group=` — read today by `useGroupName()` (Fleet.tsx:1519)           | "?mode=fleet&group=alpha"       | group=alpha                |
      | milestone 47's repo filter, which does not exist yet                  | "?mode=fleet&repo=aof"          | repo=aof                   |
      | a parameter this codebase has never heard of                          | "?mode=fleet&zz=1"              | zz=1                       |
      | keys whose NAMES merely CONTAIN "mode"                                | "?mode=fleet&modes=1&mode_hint=2" | modes=1, mode_hint=2     |
      | a key whose VALUE contains "mode="                                    | "?mode=fleet&q=mode%3Dboard"    | q=mode=board               |
      | `mode` is the only parameter — the result is an EMPTY search, never "?" | "?mode=fleet"                 | nothing at all             |
    # ROWS 5 AND 6 EXIST BECAUSE OF ONE SPECIFIC WRONG IMPLEMENTATION: a regex or
    # `String.replace` strip of `/mode=[^&]*/`. It eats `modes=1`, it eats the `mode=`
    # inside an encoded value, and it leaves a stray `&` behind. ADR-006's mandated
    # mechanism — copy the incoming `URLSearchParams`, delete `mode` — cannot get these
    # wrong; these two rows are what make that difference observable instead of
    # structural.

  # The pathname wins. A URL that already carries a path is returned unchanged, whatever
  # a stale `mode` on it says — otherwise a legacy query parameter would override a real
  # address, which is precisely backwards for a milestone whose point is that the address
  # bar is the truth.
  Scenario Outline: a URL that already carries a path is returned unchanged
    When I call `legacyRedirectFor({ pathname: <pathname>, search: <search>, hash: <hash> })`
    Then it returns null — no rewrite is issued, and the address bar keeps <pathname> <search> <hash> verbatim

    Examples:
      | case                                                                          | pathname   | search           | hash    |
      | a canonical fleet URL carrying its scope                                      | "/fleet"   | "?scope=global"  | ""      |
      | a canonical board URL carrying its drill-in fragment                          | "/board"   | ""               | "#18"   |
      | the canonical config editor                                                   | "/config"  | ""               | ""      |
      | a canonical path STILL carrying a stale `mode` — the PATH wins, never the param | "/fleet" | "?mode=board"    | ""      |
      | an UNKNOWN path carrying a legacy mode — never rescued into a surface          | "/nope"    | "?mode=fleet"    | ""      |
      | a path under the bundle's asset directory                                     | "/assets/index-DkR2xu9f.js" | "" | ""    |
    # THE STALE-MODE ROW (`/fleet?mode=board`) is undecided by every ADR and is pinned
    # here to the PO's headline wording — "a URL that already carries a path is returned
    # unchanged". The consequence, stated so it is met as a decision: a dead `mode=board`
    # can survive in the address bar of such a URL. That is harmless after this milestone
    # (nothing reads `mode` again — `acd-no-surface-mode-url-literal` forbids the literal
    # outside this module) and it is strictly safer than the alternative, in which a
    # query parameter can override a path and `/fleet?mode=board` renders the board.
    #
    # THE UNKNOWN-PATH ROW (`/nope?mode=fleet`) is the boundary between two rules that
    # both want it: ADR-003's "translate the mode" and ADR-002's "an unknown path renders
    # the 404 surface and is NEVER redirected". ADR-002 wins, because destroying the
    # evidence in the address bar is the exact failure it is written to prevent.

  # Idempotence, stated as the property that makes ADR-003's "exactly once" survivable if
  # anyone ever gets the "once" wrong.
  Scenario: applying the rewrite to its own output is a no-op — `replaceState` can never loop
    Given the desktop tray's compiled URL parts `{ pathname: "/", search: "?mode=fleet&scope=global", hash: "" }`
    When I call `legacyRedirectFor` on them
    Then it answers `{ pathname: "/fleet", search: "?scope=global", hash: "" }`
    When I call `legacyRedirectFor` on that answer
    Then it returns null
    And the same holds for the double-mode URL: `{ pathname: "/", search: "?mode=board&mode=fleet", hash: "" }` rewrites once to "/board" with an empty search, and a second call on that answer returns null
    And the same holds for board-url's drill-in: `{ pathname: "/", search: "?mode=board", hash: "#18" }` rewrites once to "/board#18", and a second call returns null

  # A bare `/` with no mode is not rewritten — including the two shapes that LOOK like a
  # mode and are not.
  Scenario Outline: a bare `/` carrying no `mode` is not rewritten
    When I call `legacyRedirectFor({ pathname: "/", search: <search>, hash: <hash> })`
    Then it returns null
    And the search and hash it was handed are left exactly as they are — a null answer touches nothing

    Examples:
      | case                                                         | search           | hash    |
      | the bare landing                                             | ""               | ""      |
      | the landing carrying a scope but no mode                     | "?scope=global"  | ""      |
      | the landing carrying only a fragment                         | ""               | "#18"   |
      | an UPPERCASE `MODE` key — `mode` is matched exactly          | "?MODE=fleet"    | ""      |
      | a key that merely STARTS with "mode"                         | "?modes=1"       | ""      |
    # ADR-003 names the ONE URL whose meaning changes in this milestone, and it is this
    # one: bare `/` on the config-editor origin stops rendering the config editor and
    # renders the shell landing. It is not in the advertised set (measured: every
    # producer emits `?mode=`), and `aof assets ui` moves its advertised URL to `/config`
    # in story 45/04. Recorded here so a reviewer meets it as a decision rather than
    # logging it as this feature's bug — and so that story 45/04 landing LATE is
    # recognisable as the real regression window.

  # The entry calls this once, before the first render, with whatever `location` gives
  # it. A throw at that point is a blank page — the worst failure this module can have,
  # and the one no other scenario would catch.
  Scenario Outline: a shapeless input is answered, never thrown at
    When I call `legacyRedirectFor` with <input>
    Then the call does not throw
    And its answer is <answer>

    Examples:
      | case                                        | input                                                | answer                        |
      | no argument at all                          | (nothing)                                            | null                          |
      | null                                        | null                                                 | null                          |
      | an empty object                             | {}                                                   | null                          |
      | a pathname only, no search or hash keys     | { pathname: "/" }                                    | null                          |
      | null search and null hash                   | { pathname: "/", search: null, hash: null }          | null                          |
      | a search with NO leading "?"                | { pathname: "/", search: "mode=fleet", hash: "" }    | a rewrite to "/fleet"         |
    # THE LAST ROW is not defensive padding: `location.search` always carries its "?",
    # but a caller composing parts by hand (a test, story 45/03's entry, a future
    # navigation helper) frequently does not. `new URLSearchParams` parses both
    # identically — measured — so answering them identically costs nothing and removes a
    # whole class of "works in the browser, not in the test" difference.

  # The caller's own record is not edited in place. The entry reads a `location`-shaped
  # object and may well reuse it.
  Scenario: the parts object handed in is never mutated
    Given the parts object `{ pathname: "/", search: "?mode=fleet&scope=global", hash: "#x" }`
    When I call `legacyRedirectFor` on it
    Then the object I handed in still reads pathname "/", search "?mode=fleet&scope=global" and hash "#x"
    And the answer is a NEW object, not the same object with its fields rewritten
