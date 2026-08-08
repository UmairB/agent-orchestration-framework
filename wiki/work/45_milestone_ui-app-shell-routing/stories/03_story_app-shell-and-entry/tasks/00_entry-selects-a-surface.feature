<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY 45/03, the ENTRY half. `ui/src/main.tsx` stops being a surface
# and becomes three acts: mount, apply the legacy translation ONCE, render the shell
# around the surface the route table names. `<App>` — 1,260 of that file's 1,267 lines
# — moves to `ui/src/config/App.tsx`, its route's own name (ADR-002; ARCHITECTURE
# §Codebase health finding 1). A MOVE, not a re-skin: SPEC's "re-skinning the config
# editor is out of scope" is honoured exactly and not one view of `<App>` is touched.
#
# NOT ASSERTED HERE — two PLACEMENT invariants, already written and owned elsewhere.
# Do not restate them as scenarios:
#   - "the entry imports surfaces and DEFINES none", "there is exactly ONE route
#     table", "the render root reaches it and no second selector exists in `ui/src`" →
#     `test/arch/acd-ui-single-route-table.test.mjs` (expected-RED until this story);
#   - "the route module loads under plain node, imports no React/DOM, names no query
#     key but `mode`, and its translation is idempotent over its own output" →
#     `test/arch/acd-route-logic-framework-free.test.mjs` (same).
# What is BEHAVIOURAL, and is the whole of this task, is the WIRING those two cannot
# see: that the entry applies the translation exactly once, as a replace, BEFORE it
# selects anything, and that every address this system has ever advertised still lands
# on the surface it lands on today.
#
# LITMUS: every Then is a returned VALUE from a framework-free `.mjs` module that
# `node:test` loads with no bundler, no DOM and no browser — the house pattern
# (`ui/src/fleet/scope.mjs`'s own header states the rule; the canonical shape is
# `test/fleet-scope.test.mjs`). No source read, no screenshot, no `window`.
#
# FEASIBILITY — the one thing this task NEEDS to exist, stated plainly so the build
# meets a decision rather than an omission. `routeFor` and `legacyRedirectFor`
# (ADR-001's named exports on `ui/src/app/routes.mjs`) answer most of the Thens below.
# The "exactly once, before the first render" clauses need the ENTRY'S OWN decision to
# be a pure function too — the steps read a plan of the shape
# `{ replace: {pathname,search,hash}|null, surface }` derived from the incoming URL
# parts, exactly as `scope.mjs:42` hands `withScopeParam`'s result back for the caller
# to wire into `history`. The story names the export; `ui/src/app/` is its home.
# IF the build instead leaves that decision inline in `main.tsx`, these scenarios have
# NO headless channel and must be re-tagged `@manual` — say so at build. A scenario
# tagged `@executable` that needs a browser is the failure mode this milestone's whole
# test posture exists to avoid.
#
# ISOLATION: `AOF_GLOBAL_HOME=$(mktemp -d) node --test test/<file>` — FOCUSED, never
# the full suite (`global-work-propagation.test.mjs` binds `:4182`, which the live
# control daemon holds).

@executable @ui @work @board
Feature: the entry mounts, translates a legacy address exactly once, and renders the surface the route table names — and defines no surface of its own
  In order that an outsider cannot tell what changed except that the address bar now means something — every URL this system has ever handed out still opening the page it opened yesterday
  the application entry must resolve an incoming address to exactly one surface through the ONE route table, rewriting a legacy `?mode=` address once and only once before anything renders, and adding no product behaviour of its own

  Background:
    Given the route module and the entry's decision helper loaded under plain `node` — no bundler, no DOM, no `window`, no browser
    And the four routed surfaces of ADR-002's table: the shell landing at `/`, `<Fleet>` at `/fleet`, `<Board>` at `/board`, and the config editor `<App>` at `/config`

  # HEADLINE. Four canonical addresses, four distinct surfaces, and nothing to rewrite
  # — a canonical address is already home, so the entry writes no history at all.
  Scenario Outline: each canonical path selects its own surface and asks for no rewrite
    Given the incoming address <address>
    When the entry's decision is taken for it
    Then the surface selected is <surface>
    And the plan asks for NO history rewrite
    And the surface's address is <address>, byte-identical to what the operator typed

    Examples:
      | case                     | address   | surface           |
      | the landing              | /         | the shell landing |
      | the fleet                | /fleet    | Fleet             |
      | the board                | /board    | Board             |
      | the config editor        | /config   | the config editor |
    # The four are DISTINCT — `/` and `/config` most of all. Today they are the same
    # thing: no `?mode=` renders `<App>` (`main.tsx:1266`), so on the config origin bare
    # `/` IS the config editor. That equality ending is the ONE URL whose meaning this
    # milestone changes, and ADR-003 names it rather than glossing it.

  # HEADLINE. The back-compat surface is TOTAL, because it was measured rather than
  # promised: every URL any producer has ever advertised carries `?mode=` (ADR-003).
  # So this table is not a sample — it is the whole advertised set.
  Scenario Outline: every advertised legacy address still lands on the surface it lands on today, rewritten exactly once
    Given the incoming address <address>
    When the entry's decision is taken for it
    Then the surface selected is <surface> — the same surface this address renders today
    And the plan asks for exactly ONE history rewrite, to <canonical>
    And that rewrite is a REPLACE, never a push — the history stack stays exactly as deep as the operator's own navigation made it

    Examples:
      | case                                                | address                     | surface           | canonical            |
      | the desktop tray's compiled constant (supervisor.rs:44) | /?mode=fleet&scope=global   | Fleet             | /fleet?scope=global  |
      | board-url's drill-in (mesh-ui-serve.mjs:278)        | /?mode=board#42/03          | Board             | /board#42/03         |
      | the assets launcher's announce (assets-ui.mjs:45)   | /?mode=assets               | the config editor | /config              |
      | an UNRECOGNISED mode — main.tsx:1266's else branch  | /?mode=wat                  | the config editor | /config              |
      | an empty mode value                                 | /?mode=                     | the config editor | /config              |
      | a legacy address on a path that is already canonical| /fleet?mode=board           | ???               | ???                  |
    # ROW 5 (`?mode=`) is the boundary the ternary answers by accident today: an empty
    # string is not `fleet` and not `board`, so it falls through to `<App>`. The
    # translation must keep that answer verbatim, not promote an empty value to a 404.
    # ROW 6 IS THE ONE CONTESTED ROW and is deliberately left unresolved here, because
    # it is a BUILD decision with two defensible answers: the path wins (`/fleet`, the
    # stray `mode` deleted) or the mode wins (`/board`). Nothing in the wild produces
    # it — no producer emits a canonical path AND a `mode` — so it is unreachable in
    # production and is a robustness choice, not a compatibility one. Settle it at
    # build, fill the row in, and state the reason in the module's header. What is NOT
    # acceptable is the third answer: a 404, which would make a URL that names a real
    # surface mean nothing.

  # ORDER IS THE WHOLE POINT. Selecting BEFORE rewriting would render the landing for
  # every legacy address in the table above, because their pathname is bare `/` — and
  # it would look like a "harmless" reordering in review.
  Scenario Outline: the surface is selected from the POST-rewrite address, never the one that arrived
    Given the incoming address <address>, whose pathname before translation is "/"
    When the entry's decision is taken for it
    Then the surface selected is <surface> — NOT the shell landing that bare "/" names
    And the address the surface is handed is <canonical>
    And no surface is selected, mounted or rendered from the pre-rewrite address

    Examples:
      | case                        | address                   | surface           | canonical           |
      | the desktop tray's URL      | /?mode=fleet&scope=global | Fleet             | /fleet?scope=global |
      | board-url's drill-in        | /?mode=board#42/03        | Board             | /board#42/03        |
      | the assets launcher's URL   | /?mode=assets             | the config editor | /config             |

  # ADR-003's "EXACTLY ONCE". A rewrite that can run twice is a rewrite that can loop,
  # and a `replaceState` loop is invisible until the address bar starts flickering.
  Scenario: the translation is applied once per load and re-deciding over its own output asks for nothing further
    Given the incoming address "/?mode=fleet&scope=global"
    When the entry's decision is taken, and then taken again over the address that decision produced
    Then the first decision asks for one rewrite, to "/fleet?scope=global"
    And the second asks for NO rewrite at all
    And both name the same surface, Fleet
    And landing directly on the already-rewritten address is indistinguishable from the second decision — the entry does nothing

  # THE DEEP-LINK CONTRACT, read through the surfaces' OWN helpers rather than through
  # the router's. This is the claim the fitness function cannot make: it pins what
  # `legacyRedirectFor` returns; this pins what the SURFACE then reads out of it.
  Scenario Outline: everything but `mode` reaches the surface untouched, in order, and the surface's own reader still finds it
    Given the incoming address <address>
    When the entry's decision is taken for it
    Then the surface selected is <surface>
    And the address it is handed carries <survives> — same keys, same values, same ORDER
    And <surface reads> reads its fact back unchanged
    And no parameter has been added, reordered, or dropped, and every surviving value DECODES to the same text it decoded to before

    Examples:
      | case                                  | address                                  | surface | survives                       | surface reads                                        |
      | the fleet's live scope contract       | /?mode=fleet&scope=local                 | Fleet   | ?scope=local                   | `scopeFromSearch` (ui/src/fleet/scope.mjs:50) → "local" |
      | milestone 47's future repo filter     | /?mode=fleet&scope=global&repo=aof       | Fleet   | ?scope=global&repo=aof         | `scopeFromSearch` → "global", and 47's filter is untouched |
      | a parameter nothing in this repo knows| /?mode=fleet&zz=1&scope=local            | Fleet   | ?zz=1&scope=local              | `scopeFromSearch` → "local", and `zz` is still first  |
      | the board's fragment contract         | /?mode=board#42/03                       | Board   | #42/03                         | the board's own fragment read (Board.tsx:585) → "42/03" |
      | a fragment AND a query together       | /?mode=board&scope=local#42/03           | Board   | ?scope=local#42/03             | the fragment read → "42/03", the query intact         |
      | an encoded value                      | /?mode=fleet&q=a%2Fb                     | Fleet   | ?q=a%2Fb                       | the value decodes to "a/b", as it does today          |
      | a percent-encoded space RE-SPELLS     | /?mode=fleet&q=a%20b                     | Fleet   | ?q=a+b (decodes "a b")         | the value decodes to "a b" — same text, new spelling |
      | a value-less flag gains its equals    | /?mode=fleet&debug                       | Fleet   | ?debug= (present, empty)       | `has("debug")` true, reads "" — present-and-empty either way |
      | sub-delimiters re-spell, decode same  | /?mode=fleet&q=~!*'()                    | Fleet   | ?q=%7E%21*%27%28%29            | the value decodes to "~!*'()" unchanged              |
    # Order and ENTRY COUNT are asserted, read back decoded — the ADR-006 [Amigos-3]
    # reading, restated at review (QA F-45-03-A, PO ruling 2026-08-07): the mandated
    # copy-and-delete mechanism round-trips through the urlencoded serialiser, which may
    # RE-SPELL a surviving parameter (`a%20b` → `a+b`; a value-less `debug` → `debug=`)
    # while every consumer — all of which read through `URLSearchParams` or a
    # server-side query parser — sees the same keys, same decoded values, same order.
    # This scenario's earlier "re-encoded" wording asked for byte-stability the chosen
    # mechanism cannot deliver and no consumer needs; the last three rows pin the
    # re-spellings EXPLICITLY so they are met as decisions, not filed as bugs. The rule
    # is still copy-the-incoming-params-and-delete-`mode`, never
    # build-a-fresh-set-from-a-known-list; the third row is the one that tells the two
    # apart, because a known-list builder drops `zz` and passes every other row.

  # AC — "the entry defines no surface of its own; the config editor is its own module
  # at its own path." The structural half is the arch test's. This is the OBSERVABLE
  # half: the two things that are one thing today are now two.
  Scenario: the landing and the config editor are two different surfaces at two different addresses
    When the entry's decision is taken for "/" and for "/config"
    Then the two name DIFFERENT surfaces
    And neither is reachable by the other's address
    And the config editor's surface is the same one every legacy `?mode=assets` and unrecognised-mode address resolves to
    And nothing about the config editor's own views changes — the entry moved it, and re-skinning it is explicitly out of this milestone's scope

  # ADR-002's origin-blind rule, stated as the sharpest observable there is: the
  # decision has nowhere to PUT an origin. A per-origin subset would have to be
  # re-decided by 46, 47 and 49 in turn.
  Scenario: the entry's decision takes no origin input at all — one bundle, one table, three origins
    Given the same address "/board" offered on the fleet origin, on a board origin and on the config-editor origin
    When the entry's decision is taken for each
    Then all three name the same surface
    And the decision accepts no origin, host, port or server-flag input by which they could differ
    And a surface reached on an origin that cannot serve its API degrades through its OWN existing error state, byte-identically to what `?mode=board` on the fleet origin does today

  # "This milestone delivers no new product behaviour." The check an outsider can run:
  # the surfaces are handed nothing new, and the suites that drive them do not move.
  Scenario: each surface is mounted with no new inputs, and the suites that already drive the surfaces stay green untouched
    When the route table's entry for each of `/fleet`, `/board` and `/config` is read
    Then it names the surface component and carries no per-surface configuration the surface must read to render
    And no surface is passed a route, a shell handle or a mode value it did not receive before
    And `test/support/fleet-app-harness.mjs` and `test/support/board-app-harness.mjs` still mount the surface COMPONENT directly, never through the entry, and need no edit for this story
    And every existing behavioural suite driving those two surfaces is green with no change to its expectations
