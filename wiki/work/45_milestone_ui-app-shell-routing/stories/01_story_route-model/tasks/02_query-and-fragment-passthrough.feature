<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY 45/01, ADR-006: THE PASSTHROUGH. The router is a PATH router: it
# reads exactly ONE query parameter (`mode`, only to delete it) and carries every other
# parameter and the fragment through untouched. This task holds the legacy translation
# constant and varies WHAT IS CARRIED — task 01 varies the legacy URL, task 00 varies the
# pathname.
#
# WHY THIS IS AN INVARIANT AND NOT A NICETY. The failure mode is banal and extremely
# common: a router that "normalises" the query string and quietly drops what it does not
# recognise, so a deep link works right up until the moment it is redirected. Three live
# contracts would break silently: `?scope=` (advertised by `mesh-ui-serve.mjs:143`, read
# back by `ui/src/fleet/scope.mjs:52`, compiled into the desktop app at
# `supervisor.rs:44`), `?group=` (read by `useGroupName()`, Fleet.tsx:1519), and the
# `#ref` fragment (`/api/mesh/board-url` returns `http://127.0.0.1:PORT/?mode=board#18`
# at `mesh-ui-serve.mjs:278`; `Fleet.tsx:514` navigates to it; `Board.tsx:585` reads the
# fragment back to select the item). ADR-006's rule is therefore COPY-AND-DELETE
# (preserve by default) and never build-from-a-known-list (drop by default) — and
# milestone 47's repo filter, which does not exist yet, must work through the router
# with no route change at all.
#
# LITMUS: every Then is confirmable by an outsider without reading source. This module is
# PURE and has NO CLI surface, so the black-box channel is `node:test` importing
# `ui/src/app/routes.mjs` and asserting on RETURNED VALUES — the house pattern
# (`test/fleet-scope.test.mjs` does exactly this for `ui/src/fleet/scope.mjs`, including
# its `withScopeParam` / `scopeFromSearch` round-trip, which is the closest existing
# analogue to everything below). Every Then is "hand these URL parts to
# `legacyRedirectFor`, read the answer back with `URLSearchParams`".
#
# NOT ASSERTED HERE — a PLACEMENT invariant owned by
# `test/arch/acd-route-logic-framework-free.test.mjs` (already written, expected-RED):
# that `routes.mjs` NAMES no query key but `mode` (a router that knows a parameter's name
# is a router that can drop it), and that it does not import `ui/src/fleet/scope.mjs`.
# The router not knowing `scope` exists is exactly what keeps m47's change local to the
# fleet — but "does not import" is a source read, so it stays in the arch test. What is
# behavioural, and is the whole of this task, is that the parameters actually survive.
#
# WHAT "UNMANGLED" HAS TO MEAN HERE, and it is NOT "byte-identical". ADR-006 prescribes
# the mechanism (copy the incoming `URLSearchParams`, delete `mode`) AND describes the
# result as surviving "byte-identically". Measured in plain node while authoring, the two
# cannot both hold: `URLSearchParams` re-serialises `%20` as `+`, an unencoded `/` in a
# value as `%2F`, and a value-less `debug` as `debug=`. Each is the SAME URL to every
# consumer that reads it — all of them do, through `URLSearchParams` or a server-side
# query parser — and a DIFFERENT string of bytes. The invariant asserted below is
# therefore the satisfiable one, and it is the one an outsider can confirm: every
# surviving key and value DECODES to the same text, in the same ORDER, with the same
# COUNT of entries, minus `mode`. FINDING F-45-01-B: ADR-006's "byte-identically" wants
# amending to "decodes identically, in order" — or the mechanism wants changing to raw
# query-text surgery, which would preserve bytes but hand-roll a parser. QA recommends
# amending the wording, not the mechanism.
#
# FEASIBILITY: nothing exists yet — the module IS this story's output, so every scenario
# is RED on day one and that is correct. Satisfiability was proven at refine
# (ARCHITECTURE §"Satisfiability was verified"). Every encoding row below was executed in
# plain node while authoring, so no expected value here is derived from reading a spec.

@executable @ui @work @distribution
Feature: `?scope=`, every parameter the router has never heard of, and the `#ref` fragment survive the rewrite intact
  In order that a deep link an operator holds keeps working through the one moment it is most likely to break — the redirect — and so that milestone 47's repo filter arrives through the router for free
  the router must carry every query parameter but `mode`, in its original order and reading back as the same text, and must carry the fragment it never interprets

  Background:
    Given `ui/src/app/routes.mjs` imported directly by `node:test` under plain node — no bundler, no DOM, no React
    And `?scope=` is a live deep-link contract: `mesh-ui-serve.mjs:143` advertises `?mode=fleet&scope=${scope}`, `ui/src/fleet/scope.mjs:52` reads it back, and the desktop app opens `http://127.0.0.1:4181/?mode=fleet&scope=global`
    And `/api/mesh/board-url` returns `http://127.0.0.1:PORT/?mode=board#18` today, and `Board.tsx:585`'s `hashRef()` reads that fragment back to select the item
    And a surviving parameter is read back with `URLSearchParams`, in order — the same way every consumer in this codebase reads it

  # Headline 1: scope survives a redirect intact — and the router has no opinion about
  # its value, because `ui/src/fleet/scope.mjs` is its one home.
  Scenario Outline: `?scope=` survives a redirect intact, and the router neither validates nor defaults it
    When I call `legacyRedirectFor({ pathname: "/", search: <search>, hash: "" })`
    Then it returns a rewrite whose pathname is <to pathname>
    And its search reads back as exactly <to search>

    Examples:
      | case                                                                              | search                        | to pathname | to search        |
      | global — the desktop app's compiled constant and the fleet server's default       | "?mode=fleet&scope=global"    | "/fleet"    | "?scope=global"  |
      | local — the other half of the contract                                            | "?mode=fleet&scope=local"     | "/fleet"    | "?scope=local"   |
      | a scope value the router has no opinion about                                     | "?mode=fleet&scope=bogus"     | "/fleet"    | "?scope=bogus"   |
      | an EMPTY scope value — a present-but-empty key is still a key                     | "?mode=fleet&scope="          | "/fleet"    | "?scope="        |
      | scope on the BOARD's legacy URL, where nothing reads it — carried anyway          | "?mode=board&scope=local"     | "/board"    | "?scope=local"   |
    # THE "bogus" ROW IS THE POINT OF THE WHOLE SCENARIO. `scope.mjs:52` already defaults
    # an invalid scope to "global" when it READS it — pinned by `test/fleet-scope.test.mjs`
    # ("an invalid scope param falls back to global, never throws"). If the router ALSO
    # normalised it, `scope` would have two homes and they would disagree the first time
    # m47 changed one. The router carries the value it was given, exactly, and says
    # nothing about it.
    #
    # THE BOARD ROW is the same rule from the other side: the router carrying a parameter
    # onto a surface that does not read it is CORRECT. Deciding which surface cares about
    # which parameter is precisely the knowledge a path router must not have.

  # Headline 2: a parameter the router has never heard of survives — the router names
  # nothing but `mode`.
  Scenario Outline: a parameter the router has never heard of survives
    When I call `legacyRedirectFor({ pathname: "/", search: <search>, hash: "" })`
    Then it returns a rewrite whose pathname is "/fleet"
    And reading its search back yields exactly <surviving>, in that order

    Examples:
      | case                                                            | search                                | surviving                    |
      | milestone 47's repo filter, which does not exist yet            | "?mode=fleet&repo=aof"                | repo=aof                     |
      | a repo filter whose value carries a slash                       | "?mode=fleet&repo=owner%2Fname"       | repo=owner/name              |
      | `?group=`, read today by `useGroupName()` (Fleet.tsx:1519)      | "?mode=fleet&group=alpha"             | group=alpha                  |
      | a key repeated — BOTH copies survive, in order                  | "?mode=fleet&tag=a&tag=b"             | tag=a, tag=b                 |
      | a key with no value at all                                      | "?mode=fleet&debug"                   | debug= (present, empty)      |
      | a tracking parameter nobody in this repo has ever named         | "?mode=fleet&utm_source=slack"        | utm_source=slack             |
      | four unknown keys at once, none of them ever added to a list    | "?mode=fleet&a=1&b=2&c=3&d=4"         | a=1, b=2, c=3, d=4           |
    # THE VALUE-LESS `debug` ROW is the one that proves the mechanism rather than the
    # outcome, and it is also the row where "byte-identical" fails (see the header's
    # FINDING F-45-01-B): `new URLSearchParams("?debug").toString()` is `"debug="` —
    # measured. The key survives and reads back with the same empty value; the serialised
    # text gains one character. That is the honest expectation and it is what this row
    # asserts.
    #
    # THE REPEATED-KEY ROW guards a build that copies parameters through a plain object
    # or a `Map`, both of which silently collapse `tag=a&tag=b` to one entry.

  # Headline 4a: parameter ORDER survives — and it survives from every position `mode`
  # can occupy, which is what distinguishes a copy-and-delete from a rebuild.
  Scenario Outline: parameter ORDER survives, whatever position `mode` was in
    When I call `legacyRedirectFor({ pathname: "/", search: <search>, hash: "" })`
    Then it returns a rewrite whose pathname is "/fleet"
    And its search reads back as exactly <to search> — same keys, same values, same ORDER

    Examples:
      | case                          | search                                    | to search                 |
      | mode FIRST — the advertised shape | "?mode=fleet&scope=global&repo=aof"   | "?scope=global&repo=aof"  |
      | mode in the MIDDLE                | "?scope=global&mode=fleet&repo=aof"   | "?scope=global&repo=aof"  |
      | mode LAST                         | "?scope=global&repo=aof&mode=fleet"   | "?scope=global&repo=aof"  |
    # Order is preserved because a `URLSearchParams` copy preserves insertion order
    # (measured), which is what makes a bookmark comparison and a test assertion honest —
    # a URL surviving as TEXT rather than merely as a SET. A build that rebuilds the query
    # from a known list passes the SET assertions above and fails these three.

  # Headline 4b: percent-encoding comes through unmangled — under the satisfiable reading
  # stated in the header. Every row here was executed in node while authoring.
  Scenario Outline: every surviving value reads back as the same text it read as before
    When I call `legacyRedirectFor({ pathname: "/", search: <search>, hash: "" })`
    Then reading key <key> off the rewrite's search yields exactly <value read back>
    And no value is double-encoded, truncated at a reserved character, or dropped

    Examples:
      | case                                          | search                            | key   | value read back |
      | a percent-encoded space                       | "?mode=fleet&q=a%20b"             | q     | "a b"           |
      | a plus sign, which IS a space in query text   | "?mode=fleet&q=a+b"               | q     | "a b"           |
      | a percent-encoded ampersand inside a value    | "?mode=fleet&q=a%26b"             | q     | "a&b"           |
      | a percent-encoded equals inside a value       | "?mode=fleet&q=mode%3Dboard"      | q     | "mode=board"    |
      | a percent-encoded slash                       | "?mode=fleet&repo=owner%2Fname"   | repo  | "owner/name"    |
      | a percent-encoded hash inside a value         | "?mode=fleet&q=%2318"             | q     | "#18"           |
      | a non-ASCII value                             | "?mode=fleet&name=caf%C3%A9"      | name  | "café"          |
    # THE `%26` AND `%3D` ROWS are the ones that catch a hand-rolled `split("&")` /
    # `split("=")` stripper: it truncates the value at the encoded delimiter and hands the
    # surface half a string, which then fails somewhere else entirely. The `%23` row is
    # the same trap for anything that looks for the fragment by scanning for "#".

  # Headline 3: the fragment. This is the scenario the operator will actually notice if
  # it regresses — the drill-in from a fleet milestone card into a board item.
  Scenario: the board drill-in still lands on item 18 after the rewrite
    Given `/api/mesh/board-url` returned `http://127.0.0.1:PORT/?mode=board#18` and `Fleet.tsx:514` navigated the browser to it
    When the entry applies `legacyRedirectFor` to those URL parts once
    Then the rewrite's pathname is "/board"
    And its search is the EMPTY string — not a bare "?"
    And its hash is "#18", so `Board.tsx:585`'s `hashRef()` reads "18" and selects the same item it selects today
    And the address the browser is left on is `http://127.0.0.1:PORT/board#18`
    And `/api/mesh/board-url`'s response SHAPE is untouched by any of this — still `{ url, workspaceId, ref }`

  Scenario Outline: the `#ref` fragment survives whatever it carries, and the router never interprets it
    When I call `legacyRedirectFor({ pathname: "/", search: <search>, hash: <hash> })`
    Then it returns a rewrite whose hash is exactly <to hash>
    And its search reads back as exactly <to search>

    Examples:
      | case                                                            | search                     | hash      | to search      | to hash   |
      | a milestone ref — the measured shape                            | "?mode=board"              | "#18"     | ""             | "#18"     |
      | a story ref, whose slash is NOT a path separator                | "?mode=board"              | "#42/03"  | ""             | "#42/03"  |
      | a fragment alongside a surviving query parameter                | "?mode=fleet&scope=local"  | "#deep"   | "?scope=local" | "#deep"   |
      | a fragment that itself looks like a query string                | "?mode=board"              | "#a?b=c"  | ""             | "#a?b=c"  |
      | a percent-encoded fragment                                      | "?mode=board"              | "#a%20b"  | ""             | "#a%20b"  |
      | a fragment on a URL whose only parameter was `mode`             | "?mode=assets"             | "#x"      | ""             | "#x"      |
      | no fragment at all                                              | "?mode=board"              | ""        | ""             | ""        |
    # THE STORY-REF ROW is measured, not invented: `boardUrlForWorkspace`
    # (mesh-ui-serve.mjs:755) sets `url.hash = ref`, and a story ref is `42/03` — the
    # `URL` hash setter leaves the slash unencoded, giving `#42/03` (checked in node).
    # A fragment containing a `/` must never be mistaken for part of the path.
    #
    # A BARE "#" IS DELIBERATELY ABSENT from this table: `new URL("http://x/?a#").hash` is
    # the EMPTY string (measured), so a lone "#" can never reach this function from a real
    # browser. The last row covers what does arrive instead.
    #
    # ONLY THE CLIENT CAN DO THIS AT ALL. A fragment is never sent to the server, so a
    # server-side 3xx would be relying on browser-specific carry-over for `#18` — which is
    # one of ADR-003's own reasons for a client-side `replaceState`. These rows are that
    # reason made checkable.

  # The strongest passthrough statement a router can make is about the URLs it does not
  # touch at all.
  Scenario: a canonical URL carrying every exotic parameter at once is not touched
    Given the URL parts `{ pathname: "/fleet", search: "?scope=local&repo=owner%2Fname&tag=a&tag=b&debug&q=a%20b", hash: "#deep" }`
    When I call `legacyRedirectFor` on them
    Then it returns null — nothing is rewritten, so nothing can be normalised, reordered or dropped
    And the parts object handed in still reads back with all six parameters, in order, and its fragment "#deep"
    And `routeFor("/fleet")` still names the fleet surface, whatever that URL's query string carries — the table matches on PATHNAME only and has no query-parameter conditions
