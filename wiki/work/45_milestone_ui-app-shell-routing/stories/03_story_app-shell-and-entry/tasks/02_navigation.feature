<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY 45/03, the NAVIGATION half: the thing that has never existed.
# Four surfaces as real `<a href>` links in `<nav aria-label="Surfaces">`, the active
# one marked by three non-colour signals, the deep-link parameters the URL carries
# surviving a move, and a destination that cannot be resolved from this origin
# rendering visibly unavailable with the command to run — never a dead `href`.
#
# LITMUS: every Then is a returned VALUE from the shell's framework-free nav model — a
# `.mjs` module in `ui/src/app/` beside the route table, loaded by `node:test` with no
# bundler and no DOM. The model is PURE over the facts the shell hands it: the current
# address (pathname / search / hash), the viewport width, and whether each destination
# is resolvable from this origin. Everything a Then below reads — the item list and its
# order, each item's `href`, its label, its active state, its `aria-current`, its
# disabled state and the reason carried in `title`, the form the nav takes at a width —
# is a value that model returns. No source read; no browser; no screenshot.
#
# WHY RESOLVABILITY IS AN INPUT AND NOT SOMETHING THE MODEL DISCOVERS. The four
# surfaces do not share one origin: `/` and `/fleet` are the fixed `:4181` fleet
# server, the board is a per-workspace server on an EPHEMERAL port that changes on
# every daemon restart (`Board.tsx:47-51`), and the config editor is the `setup-ui`
# origin. Whether a board exists right now is a live probe the fleet already makes
# (`GET /api/mesh/board-url`, `mesh-ui-serve.mjs:278`) and already renders honestly for
# peer boards (`Fleet.tsx:1381-1419`). The shell does the asking; the model is pure
# over the answer, which is what keeps this whole task headless.
#
# WHAT IS NOT HERE. Whether the active marking READS as "you are here" without colour,
# whether the labels actually fit at 390, whether the nav reflows when a board appears
# — pixel and perceptual facts, judged by a person in task 04 over renders QA drives.
# And the ADDRESS-BAR half of a navigation (that clicking a link changes the path and
# nothing else) is the browser's own behaviour of a real `<a href>`: this task's job is
# to prove the `href` is right and real, not to re-test the browser.
#
# ISOLATION: `AOF_GLOBAL_HOME=$(mktemp -d) node --test test/<file>` — FOCUSED.

@executable @ui @work @design
Feature: the nav offers all four surfaces as real links, marks the active one by more than colour, carries the address's own parameters across a move, and never renders a destination it cannot reach as a live link
  In order that getting from "what is my fleet doing" to "open that board" stops being an act of URL archaeology — and that middle-click, Ctrl-click and "copy link address" all work on every one of them
  the shell's nav must yield one item per routed surface in the table's order on every route including an unmatched one, mark exactly one of them active with three signals of which colour is the fourth, preserve the deep-link parameters the current address carries without inventing any, and render an unresolvable destination present-but-unavailable with the command that would produce it

  Background:
    Given the shell's nav model loaded under plain `node` — no bundler, no DOM, no browser
    And the four routed surfaces of ADR-002's table in its declared order: the landing at `/`, `/fleet`, `/board`, `/config`
    And every destination resolvable from this origin unless a scenario says otherwise

  # HEADLINE. Four items, one per routed surface, on every route — including the one
  # where none of them is where you are.
  Scenario Outline: the nav offers all four surfaces as real links on every route, with exactly one — or, on an unmatched path, no — item marked current
    Given the current address is <address>
    When the nav model is read
    Then it yields exactly four items, in the route table's order, labelled `Terminals`, `Fleet`, `Board`, `Config`
    And every item is a link carrying an `href`, never a button that pushes state — middle-click, Ctrl-click and "copy link address" must all work
    And the item marked current is <current>
    And the number of items carrying `aria-current="page"` is <aria-current count>
    And no item is hidden, dropped or reordered on any of them

    Examples:
      | case                       | address           | current     | aria-current count |
      | the landing                | /                 | Terminals   | 1                  |
      | the fleet, deep-linked     | /fleet?scope=local| Fleet       | 1                  |
      | the board, with a fragment | /board#42/03      | Board       | 1                  |
      | the config editor          | /config           | Config      | 1                  |
      | no route matched           | /nope             | (none)      | 0                  |
    # The last row is DESIGN's binding clause and it is a lie-prevention rule, not a
    # nicety: on an unmatched path NO nav item is marked active, because none is, and
    # marking one would tell the operator they are somewhere they are not. Never two,
    # never zero on a matched route. Labels follow the route table's own names; DESIGN
    # fixes only that there are FOUR of them and that none exceeds 10 characters.

  # DESIGN binding rail 4 + §Accessibility 3. "Colour is emphasis on top of three
  # signals, not one of them." The test that matters: take the colour away and the
  # marking must still be there.
  Scenario: the active item is marked by shape, weight and a programmatic signal — with colour as the fourth, never the only one
    Given the current address is `/fleet`
    When the nav model is read
    Then the Fleet item's marking carries a 2px solid bottom rule (shape)
    And it carries the heavier of the two type weights (weight)
    And it carries `aria-current="page"` (programmatic)
    And with every colour token removed from its marking, two independent signals still distinguish it from every other item
    And an inactive-but-available item carries a transparent bottom rule of the SAME thickness, the lighter weight, and no `aria-current` — so the active mark is a change of appearance, never a change of size
    And no item's height changes with its state: every item fills the bar's full 48px, a hit target rather than a padded text run

  # HEADLINE. "Moving between surfaces preserves the deep-link parameters the URL
  # carries." The rule that delivers it is POSITIONAL, not per-parameter — and it has
  # to be, because ADR-006 forbids the shell from knowing that `scope` exists.
  Scenario Outline: the item pointing at the route you are on carries the address's own parameters; every other item is the bare path, and invents nothing
    Given the current address is <address>
    When the nav model is read
    Then the <item> item's `href` is <href>
    And it carries no parameter the current address does not carry, in no order the current address does not use
    And the model names no query key at all — `scope`, milestone 47's repo filter and an unknown key are indistinguishable to it

    Examples:
      | case                                              | address                          | item      | href                             |
      | the fleet's own item, deep-linked to local scope  | /fleet?scope=local               | Fleet     | /fleet?scope=local               |
      | the desktop app's entry address, unchanged        | /fleet?scope=global              | Fleet     | /fleet?scope=global              |
      | 47's future filter rides along, in order          | /fleet?scope=global&repo=aof     | Fleet     | /fleet?scope=global&repo=aof     |
      | the board's own item keeps its fragment           | /board#42/03                     | Board     | /board#42/03                     |
      | leaving the fleet for the board                   | /fleet?scope=local               | Board     | /board                           |
      | leaving the board for the fleet — INVENTS NOTHING | /board#42/03                     | Fleet     | /fleet                           |
      | from the landing                                  | /                                | Fleet     | /fleet                           |
      | from an unmatched path, nothing is carried        | /nope?scope=local                | Fleet     | /fleet                           |
    # THE RULE, and why it is the only one available. DESIGN: "the `/fleet` nav item
    # must carry the current `?scope=` when `/fleet` is the ACTIVE route, and must not
    # invent one when it is not." A rule that instead forwarded fleet parameters onto
    # the board would require the shell to know which parameters belong to which
    # surface — i.e. to know `scope` by name, which ADR-006 exists to prevent, and
    # which is precisely what keeps milestone 47's change local to the fleet. So: the
    # item for the CURRENT route carries the current search and fragment byte-identically
    # (clicking "you are here" is a no-op, and copying its address yields the address you
    # are on); every other item is its bare path. Rows 5, 6 and 8 are the ones that
    # would catch a build that forwarded everything, and row 6 is the one DESIGN names.

  # DESIGN §Cross-origin honesty — the nav is NOT four in-app links, and the failure
  # mode it forbids is specific: a live-looking link that dead-ends.
  Scenario Outline: a destination that cannot be resolved from this origin is present, unavailable and explained — never a dead link, and never a missing slot
    Given the current origin is <origin> and the <item> destination is <resolvable>
    When the nav model is read
    Then the <item> item is <rendering>
    And its `title` is <title>
    And the nav still yields four items in the same order, and the <item> item still occupies its own slot at its own width
    And nothing about the other three items changes

    Examples:
      | case                                          | origin  | item   | resolvable                    | rendering                                                | title                                  |
      | no board server is running                    | fleet   | Board  | not resolvable                | present, marked unavailable, with no live `href`         | names the command `aof work ui`         |
      | a board IS running on its ephemeral port      | fleet   | Board  | resolvable at an absolute URL | a live link to that absolute origin, identical in form to an in-origin item | (none) |
      | the config editor is not being served         | board   | Config | not resolvable                | present, marked unavailable, with no live `href`         | names the command `aof assets ui`       |
      | the fleet is always the fixed `:4181` origin  | board   | Fleet  | resolvable                    | a live link to the fixed fleet origin                    | (none)                                  |
      | the probe has not answered yet                | fleet   | Board  | not yet known                 | present, occupying its slot, NOT yet a live link         | the not-yet-known form — and NEVER `aria-disabled` |
    # THE NOT-YET-KNOWN ROW's marking, pinned at review (QA F-45-03-C, PO ruling
    # 2026-08-07): `aria-disabled="true"` belongs to the NOT-RESOLVABLE state alone. An
    # undetermined destination is not disabled — announcing "unavailable" for a surface
    # that is probably up, then silently becoming a link, is the pessimistic answer
    # sighted users are deliberately NOT given. UNKNOWN renders present, non-link, with
    # the not-yet-known title and no aria-disabled; the three states stay three states.
    # ROW 5 IS THE ONE TO SETTLE AT BUILD. DESIGN forbids both a dead `href` and a nav
    # that reflows when a board appears or disappears, which leaves exactly two honest
    # answers for the interval before the probe returns: hold the slot at its final
    # width without a live `href` (chosen above), or hold it live and risk one dead
    # click. It must not be a third thing — a spinner in the bar, a collapsed slot, or
    # an item that pops into existence. Whichever is chosen, the slot's WIDTH must not
    # change when the answer lands, or the nav moves under the operator's cursor.
    # AN ITEM THAT LEAVES THE ORIGIN RENDERS IDENTICALLY TO ONE THAT DOES NOT (row 2):
    # port topology is not the operator's problem.

  # DESIGN §Accessibility 4 — and the reason is exact: an item skipped by the keyboard
  # hides its explanation from precisely the users who need it.
  Scenario: an unavailable item stays focusable, states its reason without colour, and does not navigate
    Given the Board destination is not resolvable from this origin
    When the nav model is read
    Then the Board item carries `aria-disabled="true"` and is NOT removed from the tab order
    And activating it navigates nowhere and changes no address
    And its unavailable signal is the dashed bottom rule — the product's existing "not-yet / absent / degraded" primitive — plus `aria-disabled` plus the `title`, never colour alone
    And the reason it carries is a command the operator can run, not an apology or an error
    And it uses the SAME unavailable treatment the landing's destination row uses for the same condition — one rule, both places

  # DESIGN §Responsive form — whole discrete drops, and each "never" is a GAP whose fix
  # is the next whole drop, never a shrink factor.
  Scenario Outline: the nav's form drops in whole discrete steps, and the active surface stays visible at every one
    Given a viewport <width> wide and the current address `/fleet`
    When the nav model is read
    Then the nav's form is <form>
    And <what is visible>
    And no label is truncated, abbreviated or shrunk by a scale factor
    And no item is dropped from the model, and the nav never yields two rows or a horizontally-scrolling row

    Examples:
      | case                          | width | form                        | what is visible                                                     |
      | the primary judgement width   | 1280  | four items, full labels     | all four labels, and the active one marked                          |
      | the desktop-app proxy         | 768   | four items, full labels     | all four labels, and the active one marked                          |
      | mobile                        | 390   | one disclosure trigger      | the disclosure's label is the ACTIVE surface's name, so "you are here" survives the collapse |
    # A horizontally-scrolling nav is forbidden outright because the operator cannot see
    # that there is more. At 390 the disclosure takes the existing milestone-switcher
    # trigger shape (`BoardLanes.tsx:361-367`) and declares `aria-haspopup="menu"` +
    # `aria-expanded`; `Esc` closes it and returns focus to the trigger.

  # THE 390 EDGE CASE THE DISCLOSURE'S OWN RULE CREATES. Its label is defined as "the
  # active surface's name" — and on an unmatched path there is no active surface.
  Scenario: at 390 on an unmatched path the disclosure names no surface, because none is current
    Given a viewport 390 wide and the current address `/nope`
    When the nav model is read
    Then the disclosure's label names no surface — it does not fall back to the first item, to the landing, or to the last surface visited
    And no item inside the disclosure carries `aria-current`
    And opening it still offers all four surfaces, in the table's order
    # The fallback this forbids is the tempting one: labelling the trigger `Terminals`
    # because it is first would tell an operator who typed a bad URL that they are on
    # the terminals home. Whether the label reads as the not-found state or as a neutral
    # prompt is the build's call — that it names no SURFACE is not.

  # THE TRIPWIRE DESIGN ASKS FOR, so milestones 47 and 49 meet a decision rather than a
  # truncated label. "The bar is designed for four items. Five or more, or a label over
  # 10 characters, is a GAP whose fix is a shorter label or a table change."
  Scenario: the nav's budget is four items and ten characters, and exceeding it is reported rather than absorbed
    When the nav model is read
    Then it yields exactly four items
    And no label exceeds 10 characters
    And a route table carrying a fifth entry, or an entry whose label is longer than 10 characters, is REPORTED by the model
    And it is never absorbed by truncating a label, ellipsising one, shrinking the type, wrapping to a second row, or dropping an item
    # This is the guard that makes 47's and 49's route additions cheap: they add a table
    # row and meet this budget at the door, instead of discovering the bar's limits in a
    # screenshot review three milestones later.
