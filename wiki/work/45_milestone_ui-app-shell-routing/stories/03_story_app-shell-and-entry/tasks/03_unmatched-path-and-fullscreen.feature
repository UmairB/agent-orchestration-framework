<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY 45/03, the two states that are NOT surfaces: an address that
# names nothing, and a surface that has escaped its box. They share this task because
# they share one rule — neither is allowed to touch the address bar. An unmatched path
# renders IN the shell at the path the operator typed, with the navigation right there;
# fullscreen is a transient view state that gets no path, no query parameter and no
# history entry, so Back is never the way out of it.
#
# WHY "NEVER REDIRECT TO `/`" IS A BINDING RAIL AND NOT A PREFERENCE (ADR-002, DESIGN
# binding rail 3). A redirect makes a typo, a stale bookmark and a broken in-app link
# indistinguishable from a working one — it destroys the evidence in the address bar at
# exactly the moment routing is newly introduced AND in-app links are newly rewritten.
# A milestone whose point is that URLs mean something cannot start by making one mean
# nothing. ADR-004 is deliberately built so a DEEP-LINKED unknown path lands here too
# (no-extension pathnames fall back to `index.html` with a 200), which is what makes
# this the ONE not-found experience rather than two.
#
# LITMUS: every Then is a returned VALUE from a framework-free `.mjs` module loaded by
# `node:test` with no bundler and no DOM — `routeFor` from `ui/src/app/routes.mjs`
# (ADR-001's named export), the entry's own decision plan, the shell's region/state
# model, and the fullscreen state machine that ADR-005 puts in
# `ui/src/app/shell-layout.mjs` in so many words: "the request/present/dismiss
# transitions live as a pure state machine in `shell-layout.mjs` so `node:test` drives
# them headlessly, in the house pattern." No source read, no browser.
#
# NOT ASSERTED HERE. That `routeFor` maps every unknown path to ONE shared not-found
# entry and never to `/`, and that `legacyRedirectFor` returns null for a canonical or
# unknown path, are pinned by `test/arch/acd-route-logic-framework-free.test.mjs`
# (already written, expected-RED). What is asserted here is the behaviour those two
# facts are FOR: that the entry writes no history for an unmatched address, that the
# shell renders the not-found state with its chrome and nav intact and nothing marked
# active, and that fullscreen never becomes an address.
#
# ISOLATION: `AOF_GLOBAL_HOME=$(mktemp -d) node --test test/<file>` — FOCUSED.

@executable @ui @work @board
Feature: an unmatched path renders inside the shell at the address the operator typed, and fullscreen is one shell-owned slot that is never a route
  In order that a typo, a stale bookmark and a broken in-app link stay TELLABLE APART — and that an operator who escapes a terminal to fullscreen gets out with `Esc` rather than with the back button
  an unknown path must select the shell's one not-found surface with the chrome and the navigation still present and nothing marked active, the address must not be rewritten, and entering or leaving fullscreen must add no history entry and change no path

  Background:
    Given the route module, the entry's decision helper and the shell's layout model loaded under plain `node` — no bundler, no DOM, no browser
    And the four routed paths of ADR-002's table: `/`, `/fleet`, `/board`, `/config`

  # HEADLINE. Every one of these is an address a real operator produces, and every one
  # of them keeps the evidence of what they typed.
  Scenario Outline: an unknown path selects the not-found surface and the entry asks for no rewrite at all
    Given the incoming address <address>
    When the entry's decision is taken for it
    Then the surface selected is <surface>
    And the plan asks for NO history rewrite — not a replace, not a push, not a redirect to "/"
    And the address the surface is handed is <address>, byte-identical to what arrived

    Examples:
      | case                                            | address        | surface           |
      | a plain typo                                    | /nope          | the not-found surface |
      | a near-miss of a real route                     | /fleeet        | the not-found surface |
      | scope as a PATH segment — it is a query param   | /fleet/local   | the not-found surface |
      | a board ref as a path — the ref is a fragment   | /board/42/03   | the not-found surface |
      | the bundle's own asset directory, bare          | /assets        | the not-found surface |
      | the legacy MODE value as a path                 | /config        | the config editor |
      | wrong case                                      | /Fleet         | ???               |
      | a trailing slash on a real route                | /fleet/        | ???               |
    # ROW 5 is ADR-002's naming collision seen from the client: the legacy MODE value is
    # `assets` but the PATH cannot be, because `ui/dist/assets/` is where the bundle
    # serves its own JavaScript from. `/assets` therefore means nothing to the route
    # table, and the honest answer is the not-found surface — never the config editor,
    # whose address is row 6's `/config`. (An EXTENSIONED asset request never reaches the
    # client at all: ADR-004's fallback serves the shell only for a pathname with no file
    # extension, so a missing `/assets/index-abc.js` 404s at its cause instead of
    # arriving as HTML.)
    # ROWS 7 AND 8 ARE THE TWO CONTESTED ROWS and are left unresolved on purpose — both
    # are matching-policy decisions with two defensible answers, and both are reachable
    # by a real operator. `/Fleet`: match case-insensitively, or 404 (paths are
    # case-sensitive on the web, and a lenient match makes two addresses mean one
    # surface). `/fleet/`: treat a trailing slash as the same route, or 404 (a browser
    # produces it, and so does a hand-typed URL). Settle both at build, fill the rows in,
    # and state the reason in the route module's header. WHAT IS NOT ACCEPTABLE for
    # either is a silent REDIRECT to the canonical form: that is the address-rewriting
    # this whole feature exists to forbid. If they match, they match in place.

  # DESIGN §Surface 1's "empty ≡ NO ROUTE MATCHED", and ADR-002's reason for it: the
  # navigation is right there, so recovery is one click.
  Scenario: the not-found surface renders INSIDE the shell, with the chrome and the navigation intact and fully usable
    Given the current address is `/nope`
    When the shell's regions and its nav are read
    Then the top bar renders exactly as it does on any other route — same mark, same wordmark, same identity chip, same divider, same nav
    And the nav offers all four surfaces as live links
    And no nav item is marked active, and no item carries `aria-current`
    And the surface slot is empty
    And the content mode is `content:page`
    And the not-found state occupies the content region — the one `<main>` — and nothing else about the shell differs from a matched route

  # THE TONE RULE. Nothing failed here. A path that is not a surface is not an error,
  # and dressing it as one teaches an operator to distrust their own address bar.
  Scenario: the not-found state names the path that did not match, points at the nav, and uses the not-yet language rather than the error language
    Given the current address is `/nope?scope=local`
    When the not-found state is read
    Then it carries the path that did not match, verbatim, as the operator typed it
    And it points at the navigation as the way on
    And it takes the established dashed empty-state form — the product's absent/not-yet primitive
    And it carries NO `accent` and NO `destructive` treatment: nothing failed, the path simply is not a surface
    And it is a DIFFERENT state from the shell's failed-to-load state, which names a surface and offers a Retry that re-attempts a mount

  # DESIGN §Surface 1's four shell states. They must be distinguishable, and exactly one
  # can be on screen — "the shell's is the outer one and yields the instant the surface
  # mounts."
  Scenario Outline: the shell has four content states, exactly one is selected at a time, and each is distinguishable from the others
    Given the shell is in the <situation> situation
    When the shell's content state is read
    Then the state is <state>
    And the content region holds that state and no other
    And <what marks it>

    Examples:
      | case                              | situation                                        | state       | what marks it                                                              |
      | no route matched                  | the address names no surface                     | not-found   | the dashed empty form naming the path; no nav item active                  |
      | the surface's code is in flight   | the surface's module has not loaded yet          | mounting    | ONE neutral pulse placeholder carrying `aria-busy` and a label naming the surface |
      | the surface is fetching its data  | the surface has mounted and is loading its data  | populated   | the shell shows NOTHING — the surface's own loading state owns the region  |
      | the surface failed to load        | the surface's module could not be loaded         | failed      | the `accent` treatment, copy naming the SURFACE, and a Retry that re-attempts the MOUNT |
      | normal                            | the surface is mounted and rendering             | populated   | the shell adds no wrapper padding, no max-width and no background of its own |
    # ROW 3 IS THE ONE THAT PREVENTS TWO SPINNERS. The shell's mount placeholder and the
    # surface's own loading state are different states of different owners, and if both
    # can be on screen at once the operator sees a skeleton inside a skeleton. ROW 4 is
    # never `destructive`: a chunk that did not arrive is a retryable transport condition,
    # not data loss. And in EVERY row the chrome is intact and usable — a failed surface
    # must never trap the operator on it.

  # ADR-005's third contract point and DESIGN's §`shell:fullscreen`. ONE mechanism,
  # owned by the shell — not the browser Fullscreen API (which takes the whole browser
  # chrome, is gesture-gated, and in the desktop webview changes what the operator's
  # WINDOW is), and not a `position: fixed` portal per surface (which is how two z
  # vocabularies and two `Escape` handlers appear — the duplication milestone 46 exists
  # to delete, reintroduced one layer up).
  Scenario Outline: the fullscreen slot holds exactly one occupant, and every transition is one of a closed set
    Given the fullscreen slot is <before>
    When <transition>
    Then the slot is <after>
    And the number of occupants is <occupants> — occupants never stack
    And the shell's chrome is <chrome>

    Examples:
      | case                                  | before          | transition                              | after           | occupants | chrome  |
      | nothing is presented                  | empty           | nothing has been requested              | empty           | 0         | visible |
      | a surface asks to be presented        | empty           | surface A requests the slot             | presenting A    | 1         | hidden  |
      | a SECOND request replaces the first   | presenting A    | surface B requests the slot             | presenting B    | 1         | hidden  |
      | the same occupant asks again          | presenting A    | surface A requests the slot again       | presenting A    | 1         | hidden  |
      | Esc dismisses                         | presenting A    | `Esc` is pressed                        | empty           | 0         | visible |
      | the visible control dismisses         | presenting A    | the exit control is activated           | empty           | 0         | visible |
      | Esc with nothing presented is a no-op | empty           | `Esc` is pressed                        | empty           | 0         | visible |
      | dismissing twice is a no-op           | empty           | the exit control is activated again     | empty           | 0         | visible |
    # "Chrome hidden" is not "chrome covered": a translucent overlay would put a
    # light-theme bar behind a dark terminal. The measurable consequence is task 01's —
    # while an occupant is presented the published chrome height is 0, so the occupant
    # gets the whole viewport rather than the whole viewport minus a bar nobody can see.

  # THE HEADLINE CLAUSE, and the one milestone 46 builds against: fullscreen is NOT a
  # route. "The address bar means which surface, and only that."
  Scenario: entering and leaving fullscreen adds no history entry, changes no path and invents no parameter
    Given the current address is `/board#42/03`
    When a surface is presented fullscreen, and then dismissed with `Esc`
    Then no transition yields a path, a query parameter, a fragment or a history operation of any kind
    And the address is `/board#42/03` before, during and after — byte-identical at every step
    And the route the shell resolves is unchanged throughout
    And Back is never the way out: the state machine has no transition that a history entry could drive
    And the same holds on every route, including an unmatched path — fullscreen is a property of one control instance, not of an address

  # DESIGN §`shell:fullscreen` + §Accessibility 10. The obligation the existing overlay's
  # `aria-modal="true"` already claims (`FleetTerminalView.tsx:402-424`), formalised as
  # the shell's rather than re-invented.
  Scenario: the presented occupant declares itself modal, traps focus, and hands focus back to the control that opened it
    Given the fullscreen slot is empty and a surface's enter control has focus
    When that surface is presented fullscreen and then dismissed
    Then while presented, the occupant declares `role="dialog"`, `aria-modal="true"` and an `aria-label` naming the session
    And focus is trapped inside the occupant while it is presented
    And on dismissal focus returns to the control that opened it, not to the document body
    And the occupant sits on the ladder's `fullscreen` rung, alone (DG-45-2)

  # "Exit is `Esc` AND a visible control" — both, always. A state that can only be left
  # by a key the operator has to know about is a trap for anyone who does not.
  Scenario: every presented state carries a visible way out, anchored where the way in was
    Given a surface is presented fullscreen
    When the presented state is read
    Then it carries a visible exit control — a presented state with no visible dismiss is unreachable
    And that control sits at the same anchor position as the control that entered fullscreen, so the eye does not have to search for the way out
    And `Esc` dismisses the same state the control dismisses, to the same result
    And neither route is the only one: removing either would leave the other as a single point of escape
