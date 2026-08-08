<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY 45/03, the SHELL half: DESIGN's five regions in one declared
# order, the chrome budget the desktop app's 760×520 window imposes, the bounded
# content box the surface owns scroll inside, and the two design gaps the shell closes
# (DG-45-1 one brand mark, DG-45-2 one z ladder).
#
# THE REGIONS ARE DESIGN'S, NOT THIS TASK'S TO INVENT. R1 notice rail (conditional,
# zero-height when empty, PUSHES rather than overlays) · R2 top bar (48px, never
# scrolls out of view) · R3 surface bar (conditional, ≤768, 40px) · R4 content — the
# one `<main>` and the one mount point · R5 overlay layer. ADR-005 collapses R1–R3
# into the contract name `chrome`, R4 into `content`, R5 into `overlay`, and requires
# the names to be IMPORTED CONSTANTS rather than strings typed twice, because
# milestones 46 and 49 bind to them.
#
# LITMUS: every Then is a returned VALUE from `ui/src/app/shell-layout.mjs` — the
# framework-free module ADR-005 names, loaded by `node:test` with no bundler and no
# DOM. The shell's LAYOUT is therefore tested as a MODEL: the region list and their
# order, each region's presence and height for a given input, the published chrome
# height, the declared content mode and its declared scroll owner, the z ladder, the
# landmark each region carries. No source read, no `className` archaeology.
#
# WHAT A MODEL CANNOT SETTLE, AND WHERE IT GOES INSTEAD. Whether the RENDERED page
# actually honours the model — whether 88px of chrome really leaves 432px of content
# in the Rust app's window, whether the page double-scrolls, whether the notice rail
# really pushes instead of overlaying, whether the bar survives the 390 squeeze
# without a horizontal scrollbar — is a browser fact and a pixel fact. Those are task
# 04's `@uat` render verdict, judged by a person against `mocks/app-shell.png` (or,
# until it lands, DESIGN's binding checklist) over renders QA drives. This split is
# the m43 precedent: the structural half here, the pixel half there. A `@executable`
# scenario that needs a browser is the failure mode; there are none below.
#
# NOT ASSERTED HERE: "the shell and the route table live in `ui/src/app/`, neither
# surface's folder" and "the layout module is React-free and node-loadable" are
# PLACEMENT invariants — `test/arch/acd-ui-single-route-table.test.mjs` and
# `test/arch/acd-route-logic-framework-free.test.mjs` own the second; the first is
# ARCHITECTURE §Codebase health finding 2's review rule ("a story that puts a shared
# primitive into `board/` or `fleet/` instead of `app/` should be refused at review").
# ALSO NOT ASSERTED: that no `z-50` literal survives anywhere else in `ui/src`. That
# is a source-read claim with no fitness function today — QA has flagged it as a
# recommended new arch test rather than smuggling it in here as a behavioural Then.
#
# ISOLATION: `AOF_GLOBAL_HOME=$(mktemp -d) node --test test/<file>` — FOCUSED.

@executable @ui @work @design
Feature: the shell is five named regions in one order, inside a chrome budget of 88px, around a bounded content box whose scroll the surface owns
  In order that a 760×520 desktop window still shows an operator ≥432px of their work — and that milestones 46 and 49 can size a terminal to a box whose height is knowable without measuring the document
  the shell must yield its five regions in the declared order with the conditional ones at zero height when absent, publish the measured chrome height as one variable, declare exactly one scroll owner per content mode, paint one brand mark on every route, and hand out z rungs from one named ladder

  Background:
    Given the shell's layout model loaded under plain `node` — no bundler, no DOM, no browser
    And the region names are the constants ADR-005 requires, imported by every consumer rather than typed as strings

  # HEADLINE. One order, always. The conditional regions do not move the others when
  # they appear; they push, and they cost nothing when absent.
  Scenario Outline: the five regions are yielded in the declared order, and a conditional one absent occupies zero height
    Given a notice rail that is <notice> and a surface bar that is <surface bar>
    When the shell's regions are yielded
    Then their order is exactly: notice rail, top bar, surface bar, content, overlay
    And the notice rail's height is <R1 height> and the surface bar's height is <R3 height>
    And the content region is the fourth region in every combination — its position never depends on what is present above it
    And the overlay layer is out of flow and contributes zero to the height of anything

    Examples:
      | case                              | notice  | surface bar | R1 height | R3 height |
      | the ordinary desktop shell        | empty   | absent      | 0         | 0         |
      | the board's serverGone strip up   | present | absent      | measured  | 0         |
      | narrow, the slot has dropped      | empty   | present     | 0         | 40        |
      | both conditionals present         | present | present     | measured  | 40        |
    # "measured", not a constant: the strip is `px-4 py-2 text-xs` + a sentence, so its
    # height is content-driven and is an INPUT to the model, never a number the model
    # invents. A rail whose height the model guessed would be wrong by exactly the
    # amount that makes a fitted terminal overflow.

  # THE BUDGET, and it is binding: 88px of chrome, ≥432px of content, in the Rust
  # app's own 760×520 window (`app/desktop/ui/styles.css:50`). DESIGN: "A third chrome
  # row is a GAP, not a variant."
  Scenario Outline: the chrome budget holds at the desktop window's height, and the one combination that breaches it is reported rather than absorbed
    Given a viewport <width>×520 with a notice rail <notice> and a surface bar <surface bar>
    When the shell publishes its chrome height
    Then the chrome height is <chrome>
    And the content region's available height is <content>
    And the budget verdict is <verdict>

    Examples:
      | case                                   | width | notice     | surface bar | chrome | content | verdict                          |
      | one bar, the primary judgement width   | 1280  | empty      | absent      | 48     | 472     | within the 88px budget           |
      | the desktop-app proxy, slot dropped    | 768   | empty      | present     | 88     | 432     | AT the budget — the exact floor  |
      | mobile, slot dropped                   | 390   | empty      | present     | 88     | 432     | within                           |
      | a notice on a wide viewport            | 1280  | 33px strip | absent      | 81     | 439     | within                           |
      | a notice AND a surface bar             | 768   | 33px strip | present     | 121    | 399     | BREACHES — reported, see below   |
      | a fullscreen occupant is presented     | 768   | empty      | present     | 0      | 520     | chrome is hidden, not overlaid   |
    # ROW 5 IS THE EDGE CASE THIS TASK EXISTS TO SURFACE. DESIGN's 88px counts the two
    # BARS (48 + 40); the notice rail is a third chrome row, and DESIGN calls a third
    # row a GAP. But the rail is real and transient — it is the board's `serverGone`
    # strip, which must sit ABOVE the bars and push them down, and which is almost
    # never true. The model must therefore REPORT the breach (a value an outsider can
    # read), never silently absorb it and never reserve a blank band against it. If the
    # build finds it must do something else — clamp the rail, or let content dip below
    # 432 while a server is gone — that is a design gap to raise against DESIGN, with
    # this row as its evidence, not a quiet decision in CSS.
    # ROW 6 is the fullscreen interaction, and it is the reason the budget is a
    # published number rather than a constant: chrome GONE means the occupant gets the
    # whole viewport (task 03 owns the state machine that produces it).

  # ADR-005's derivable-box guarantee, and DESIGN §"The shell's layout primitives" 1.
  # The failure this prevents: every terminal surface re-deriving the chrome height and
  # disagreeing.
  Scenario: the chrome height is published as ONE variable in dynamic viewport units, never as the constant 48 and never in `vh`
    When the shell publishes the height a height-constrained surface sizes itself against
    Then it is published once, under one name, as the measured sum of every region above the content region
    And the sizing expression a surface is given subtracts that one name from `100dvh`
    And it names `dvh`, never `vh` — a mobile browser's collapsing URL bar changes the viewport, and a terminal sized to `vh` overflows the moment it does
    And it is never the literal 48, which is wrong in every combination where a notice rail or a surface bar is present
    And a surface can derive its available height from it without measuring the document

  # ADR-005's second contract point, and DESIGN's two content modes. `min-height: 0` is
  # load-bearing and non-obvious: a flex child defaults to `min-height: auto`, so an
  # overflowing child silently grows the parent and every "size to the box" calculation
  # is wrong in a way that only shows up with real content.
  Scenario Outline: each route declares one content mode, and the mode declares exactly one scroll owner — never the content region itself
    Given the route <route>
    When its content mode is read
    Then the mode is <mode>
    And the declared scroll owner is <owner>
    And the content region declares `min-height: 0` in BOTH modes
    And in `content:fixed` the content region is never itself the scroll owner — descendants own scroll or nothing does
    And the page root keeps its `overflow-x: hidden` backstop in both modes (DESIGN GAP D1, `index.css:27-36`) — the shell must not remove it

    Examples:
      | case                       | route            | mode          | owner                |
      | the landing                | /                | content:page  | the page             |
      | the fleet, as it is today  | /fleet           | content:page  | the page             |
      | the config editor          | /config          | content:page  | the page             |
      | the board, as it is today  | /board           | content:fixed | descendants only     |
      | no route matched           | an unknown path  | content:page  | the page             |
    # Neither mode is redesigned — `content:page` is what `Fleet.tsx:208` does today and
    # `content:fixed` is what `Board.tsx:409` does today. They are NAMED so the shell can
    # host both without either surface changing. BINDING for milestone 46: a surface that
    # hosts a terminal is always `content:fixed`, because a fitted xterm inside a
    # page-scrolling column has no stable height to fit to.

  # DESIGN §Accessibility 6 — and it is a NEW obligation, because persistent chrome
  # above every surface has never existed here. Two banners or two `<main>`s is the
  # regression the absorption of the surfaces' own headers could produce.
  Scenario: the shell owns exactly one banner and exactly one `<main>`, and the content region is the single mount point
    When the shell's regions are yielded with any surface mounted
    Then exactly one region declares the `banner` landmark — the top bar
    And exactly one region declares `main` — the content region
    And the content region holds exactly one mounted surface, or exactly one of the shell's own states, and never both
    And no routed surface contributes a second banner or a second `main`
    And the first focusable element in the document is the skip link, targeting the content region's id

  # BINDING RAIL 2 — "nothing in the shell moves as you navigate", applied to a bar
  # instead of a row. Everything left of the slot is byte-identical on every route;
  # the slot is right-anchored so its contents grow leftward and can never push the nav.
  Scenario Outline: everything left of the surface slot is identical on every route, and the slot's contents can never push the nav
    Given the route <route>
    When the top bar's model is read
    Then the content left of the surface slot is: skip link, brand mark, wordmark, identity chip, divider, nav — in that order
    And that left-of-slot content is byte-identical to every other route's, at every load state
    And the surface slot holds <slot contents>
    And the slot is right-anchored, so it is yielded AFTER the nav and can never displace it
    And the identity chip is a label and not a control — non-interactive, never focusable, never blank

    Examples:
      | case              | route           | slot contents                                          |
      | the landing       | /               | (empty)                                                |
      | the fleet         | /fleet          | the scope control, the freshness legend, the refresh button |
      | the board         | /board          | the status legend, the sync button                      |
      | the config editor | /config         | (empty)                                                 |
      | no route matched  | an unknown path | (empty)                                                 |
    # The scope control stays INSIDE `<Fleet>` (DESIGN §The scope-control ruling): the
    # shell owns the BAR, not scope semantics. `?scope=` is a fleet contract end to end
    # and would be inert on three of four routes — rendered-and-meaningless is a lie,
    # conditionally-hidden is chrome that moves as you navigate. Consequence accepted and
    # recorded: the bar is deliberately non-uniform to the RIGHT of the slot.

  # DG-45-1 — one product, one mark. Today the fleet paints a filled 24px tile
  # (`Fleet.tsx:283-285`) and the board paints a bare glyph (`Board.tsx:425-427`) in the
  # same bar position. The shell paints one, on every route.
  Scenario: the shell paints ONE brand mark and one wordmark, and no surface paints its own
    When the top bar's model is read on each of the four routes and on an unmatched path
    Then exactly one brand mark is yielded, and it is the same mark in all five
    And it is the fixed 24px filled tile — a mark whose optical size does not move with the bar's type ramp
    And it is decorative: it carries `aria-hidden` and contributes no accessible name
    And the wordmark reads `aof` alone on all five — the route words `Mesh` and `Work Board` are retired from the bar, because the nav names the route and a second word would say it twice
    And no routed surface contributes a brand mark or a wordmark of its own
    # RECORDED SO A REVIEWER DOES NOT LOG IT AS A REGRESSION: the board's bar GAINS a
    # filled mark it did not have, and both surfaces LOSE their second word. Three
    # knowing visible changes ship in this milestone — the nav appearing, the one mark,
    # the retired route word — and DESIGN names all three.

  # DG-45-2 — `z-50` currently means three unrelated things (`Board.tsx:528`,
  # `BoardLanes.tsx:373`, `FleetTerminalView.tsx:412`). Once a surface can go fullscreen
  # inside a shell, a toast on the same rung paints unpredictably.
  Scenario: the shell owns one named z ladder, fullscreen is alone on its top rung, and a rung that is not on the ladder cannot be asked for
    When the ladder is read
    Then it names its z-carrying rungs in ascending order: sticky chrome, popover, dock, toast, fullscreen
    And `content` is documented as the ladder's FLOOR — the absence of a rung (z auto), never a z-carrying value on the ladder itself
    # PO ruling, 2026-08-07 (routed by the architect's [Build-N] pass): this Then previously
    # listed SIX names with `content` among the rungs, which the committed arch test cannot
    # accept — `acd-shell-z-ladder-single-home` computes the rung set from the ladder's own
    # values and pins it to exactly {10,20,30,40,50}. DESIGN's table agrees once read
    # closely: its `content` row carries z `auto`, i.e. NO number. The test is the committed
    # contract, so the ladder object holds five numeric rungs and `content` is the floor —
    # named in the module's documentation, absent from the ladder's values.
    And the fullscreen rung is the highest, and the `shell:fullscreen` occupant is its ONLY occupant
    And the three things that share one rung today resolve to three DIFFERENT rungs: the dispatch toast to `toast`, the milestone switcher to `popover`, the fullscreen terminal to `fullscreen`
    And the notice rail, the top bar, the surface bar and in-surface sticky headers all resolve to the one `sticky chrome` rung
    And asking for a rung the ladder does not name is refused with the ladder's own names, never answered with an invented number — an element that needs a new rung is a GAP whose fix is to add the rung to the ladder first

  # R1's decision, and the reason it is a decision: a reserved blank band would cost
  # every surface ~33px for a condition that is almost never true.
  Scenario: the notice rail pushes the chrome down rather than overlaying it, and is never a reserved blank band
    Given the board's `serverGone` condition is standing
    When the shell's regions are yielded
    Then the notice rail is the FIRST region, above the top bar, and it is full-bleed
    And the chrome height grows by the rail's measured height, so the top bar moves down rather than being covered
    And the rail carries at most one notice at a time
    And with no notice standing the rail's height is exactly 0 — no reserved band, no minimum height, no empty border
    And the rail is contributed BY the surface: the shell provides the region and asserts nothing about what a notice means

  # DESIGN §Responsive form — whole discrete drops, keyed to the viewport because the
  # bar's width IS the viewport width. (This is the case m43's "the form is chosen by
  # the SURFACE, not the viewport" rule explicitly is not, and stating the distinction
  # is the point.) The nav's own form at each drop is task 02's.
  Scenario Outline: the surface bar appears in whole discrete drops, and never as a third bar at a width that already has one
    Given a viewport <width> wide and a surface that <declares>
    When the shell's regions are yielded
    Then the surface bar is <R3>
    And the surface slot is held by <slot home>
    And the slot's CONTENTS are the same components in the same order wherever the slot lives — the slot moves, its contents never change form
    And there is never more than one surface bar

    Examples:
      | case                                 | width | declares                  | R3      | slot home     |
      | the primary judgement width          | 1280  | declares no surface bar   | absent  | the top bar   |
      | the desktop-app proxy                | 768   | declares no surface bar   | present | the surface bar |
      | mobile                               | 390   | declares no surface bar   | present | the surface bar |
      | a surface that declares its own bar  | 1280  | declares a surface bar    | present | the surface bar |
