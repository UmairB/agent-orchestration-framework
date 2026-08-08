<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY 45/04, the IN-APP half: the three hard-coded cross-links
# between the board and the fleet stop pointing at `?mode=` and point at the
# ADR-002 paths, each keeping whatever payload it carried.
# The three, measured 2026-08-06 at `eacbd57`:
#   `ui/src/board/Board.tsx:416`      — the dead-server banner's "the fleet" link,
#                                        `http://127.0.0.1:4181/?mode=fleet` → `/fleet`
#   `ui/src/board/DetailPanel.tsx:270` — "watch on the fleet →",
#                                        `…/?mode=fleet&scope=global` → `/fleet?scope=global`
#   `ui/src/fleet/Fleet.tsx:1398`      — the local board's "Open board →",
#                                        the RELATIVE `/?mode=board` → `/board`
#
# LITMUS — and a correction to the premise this task was handed with. These three
# links DO have a black-box runtime channel, and it is already built:
# `test/support/board-app-harness.mjs` and `test/support/fleet-app-harness.mjs`
# esbuild the REAL, unmodified `Board.tsx` / `Fleet.tsx` and mount them
# headlessly against a REAL running board / fleet face, over a minimal React
# (`test/support/mini-react.mjs`) with a controllable clock and an instrumented
# `fetch`. `findAll(tree, …)` walks the RENDERED tree, so an anchor's `href` prop
# is read out of production render output — not out of a source file, not out of a
# bundle grep, not out of a pure helper called directly. Every Then below is that
# read, plus the real face's own HTTP envelopes that put the component into the
# state where the link renders at all. m38/STATE F-38.06e is the reason this is
# the right instrument and a helper test is not: *"a state satisfied by calling
# the reducer directly proved nothing, because production could never drive it."*
#
# FEASIBILITY — all three links are CONDITIONAL renders, and reaching each state
# is the real work of this task. Measured:
#   - Board.tsx:79,101 — the banner needs `serverGone`, which flips after THREE
#     consecutive SILENT load failures (`load({ silent: true })`), or immediately
#     on a `TypeError` from a dispatch (:348). The harness owns the clock, so the
#     three silent polls are driven, not waited for; a face that stops answering
#     `/api/work/list` is the trigger.
#   - DetailPanel.tsx:270 — needs a selected item with
#     `execution.active === true` and NO `execution.sessionId`. That overlay comes
#     from the board face's own `/api/work/list` envelope, so an ACTIVE assignment
#     held by another node in the fixture store produces it — the same fixture
#     shape `test/support/item-lock-fixture.mjs` and the m43 board lanes already
#     build.
#   - Fleet.tsx:1381,1393 — `BoardDrillIn` splits on `board.local`; the LOCAL
#     branch renders the anchor and the PEER branch renders a copy-control with no
#     `href` at all. CORRECTED at review (QA F-45-04-QA-2/QA-3, 2026-08-07): this
#     note originally claimed both branches are reachable from the fleet face's
#     `/api/mesh/status` boards aggregate — MEASURED FALSE on both scopes: since
#     m34/ADR-006 that route's payload carries no `boards` key at all, so the
#     shipped surface always renders the empty placeholder and neither branch ever
#     mounts for an operator. The lanes are therefore PRODUCER-FED (real group
#     registry → real `mesh:status` → its real `boards` payload served verbatim
#     over HTTP → the real <Fleet/>) — honest evidence for the RENDER contract,
#     not for operator reachability. The reachability gap is pre-existing, out of
#     this story's scope, and routed to m47 (which owns the fleet surface).
#
# NOT ASSERTED HERE:
#  - "no `?mode=` literal survives in `ui/src`" — a PLACEMENT invariant owned by
#    `test/arch/acd-no-surface-mode-url-literal.test.mjs` (currently RED). What IS
#    asserted below is its behavioural neighbour, which the arch test cannot see: no
#    RENDERED anchor names `mode`, in any state these lanes drive. A link composed
#    at runtime from a variable would pass the arch gate and fail here.
#  - what `/fleet` and `/board` RENDER — 45/03's shell and entry.
#  - a live fetch of `http://127.0.0.1:4181/fleet`. Port 4181 is the fleet's fixed
#    port and is held by the operator's live daemon on the control node; a lane
#    that bound it would be flaky by construction and would violate the house test
#    isolation rule. Instead, the last scenario cross-checks the link against the
#    fleet's OWN advertisement (`aof mesh ui --json`, task 00's channel) — the two
#    must name the same path, which is the property that actually matters and needs
#    no fixed port. That `/fleet` resolves at all is task 00's third scenario.
#
# OBSERVED, DEFERRED, AND DELIBERATELY NOT CHANGED HERE (QA finding F-45-04-1, in
# m45 STATE.md, labelled F-45-04-1): `Fleet.tsx:1398`'s href is RELATIVE, so on the fleet origin
# (:4181) it resolves to the fleet's own origin — which answers 404 for
# `/api/work` (mesh-ui-serve.mjs:541-543). A local board's "Open board →"
# therefore lands on a board surface that cannot load its stream, TODAY, with
# `?mode=board`. This story must reproduce that behaviour EXACTLY, one character
# narrower (`/board`), and must not "fix" it: a URL migration that also changes
# where a link goes is two changes wearing one diff. The scenario below pins the
# relative form on purpose.

@executable @ui @work @distribution
Feature: the three hard-coded cross-links between the board and the fleet are paths, and each one carries its payload — and its origin — across the move unchanged
  In order that the navigation between the two surfaces speaks the same address vocabulary the servers now advertise, instead of being the last place the legacy query form is minted
  the board's dead-server banner, the detail panel's watch link and the fleet's local-board drill-in must each render a path href, keep the scope / relativeness each already had, and add no parameter neither had

  Background:
    Given an isolated global mesh store (a fresh AOF_GLOBAL_HOME) holding one published workspace whose work stream contains milestone "34" with story "34/01"
    And the REAL production surface mounted headlessly against a REAL running face, over the house harnesses (`withBoardApp` / `withFleetApp`)
    And every href below is read from the RENDERED tree, never from a source file

  # Headline 1. The banner exists because a board server dies with every daemon
  # restart and its port is ephemeral; the fleet's port is fixed, which is the whole
  # reason this link is absolute and hard-coded. The migration must keep that.
  Scenario: the board's dead-server banner links the fleet at a path, on the fleet's own fixed origin
    Given the board is mounted against a real board face and has loaded its stream
    When the face stops answering `/api/work/list` and three consecutive silent refreshes fail
    Then the dead-server banner renders
    And its "the fleet" anchor's href parses with `new URL(...)` and its pathname is exactly "/fleet"
    And that href names no `mode` parameter
    And its host is "127.0.0.1" and its port is "4181" — the fleet's fixed port, unchanged, because a board port is ephemeral and a fleet port is not
    And it carries no `scope` parameter (this link never had one, and the migration must not invent one)
    And the banner's own text and its `underline` affordance are unchanged — this is a URL change, not a copy change

  # Headline 2. The watch link is the one in-app link carrying a query payload, and
  # it is the shape ADR-003 names as the bookmarked form that must survive intact.
  Scenario: the detail panel's "watch on the fleet" link is a path that still carries `scope=global`
    Given the board face's `/api/work/list` reports "34/01" with `execution.active` true, a holding node, and NO `execution.sessionId`
    And the detail panel is open on "34/01"
    Then the "watch on the fleet" anchor's href parses with `new URL(...)` and its pathname is exactly "/fleet"
    And its `scope` parameter, read via `searchParams.get("scope")`, is "global"
    And that href names no `mode` parameter
    And its pathname contains no "&" and no "?" — the glued-string failure (task 00 trap 1) is caught here too
    And its `target` is "_blank", its `rel` is "noreferrer" and its title still names the holding node — unchanged
    And the link is absent when the same item reports `execution.sessionId` (the pre-existing condition is untouched by the migration)

  # Headline 3. The fleet's drill-in, and the branch beside it. The peer branch is
  # here because a rewrite that "made both links paths" would turn a deliberate
  # copy-control into a dead href — the exact failure the two-case split exists to
  # prevent (Fleet.tsx:1373-1380).
  Scenario: the fleet's local-board drill-in is a RELATIVE path, and the peer-board control still has no href at all
    Given the fleet face's `/api/mesh/status` reports one board with `local` true and one peer board without it
    Then the local board's "Open board →" anchor's href is exactly "/board" — relative, with no scheme, no host and no port
    And it names no `mode` parameter and no `scope` parameter
    And the peer board's "Open board →" control is NOT an anchor and carries no href — it still copies the `aof work ui` command, attributed to its owner node
    And both still read "Open board →" (mock parity is unchanged by the migration)

  # The behavioural neighbour of the arch gate, and the half the arch gate cannot
  # see: a `mode` parameter composed at RUNTIME from a variable leaves no literal in
  # source. This sweeps every anchor the two surfaces render, across the states the
  # lanes above already stand up.
  Scenario Outline: across every state these lanes drive, no anchor either surface renders names a `mode` parameter
    Given <state>
    When I collect the href of every anchor in the rendered tree
    Then not one of them names a `mode` parameter, in its query or anywhere else
    And every href that is absolute names host "127.0.0.1" — no link points off-machine
    And the anchor COUNT for this state equals its pinned value — the three anchor-less states are PINNED-ZERO, not swept — and across all six states at least one anchor was collected and the full href set is exactly the three migrated links
    # AMENDED at review (QA F-45-04-QA-1, PO ruling 2026-08-07). As authored, "at least
    # one anchor was collected" bound every row — but three of these states render ZERO
    # anchors by measured design (the healthy board renders its links conditionally; the
    # peer branch is a <button>, which is exactly what scenario 3 protects). The
    # delivered reading is strictly stronger where it matters: per-state counts pinned
    # exactly (so an anchor APPEARING is as loud as one disappearing), the href set
    # closed over all six states, and non-vacuity held at the whole-sweep level where it
    # is true. For the three pinned-zero rows the mode-sweep clause is knowingly vacuous
    # — those rows prove the count, not the sweep.

    Examples:
      | case                             | state                                                                    |
      | the board, healthy               | the board mounted against a live face with its stream loaded             |
      | the board, server gone           | the board after three consecutive silent load failures                   |
      | the board, detail panel open     | the board with the detail panel open on an item held by another node     |
      | the board, deep-linked by hash   | the board mounted with hash "#34/01" (the drill-in's own landing state)  |
      | the fleet, a local board         | the fleet mounted with one `local` board in its status aggregate         |
      | the fleet, a peer board          | the fleet mounted with one peer board and no local board                 |

  # The property that actually matters and needs no fixed port: the in-app link and
  # the server that serves it must name the SAME path. Two independently edited
  # sites agreeing is what stops the board pointing at `/fleet` while the fleet
  # advertises `/fleet-view`.
  Scenario Outline: each in-app link names the same path the corresponding server advertises for itself
    Given <link> rendered by its surface, and <probe> run in the same workspace
    Then the pathname of the rendered href and the pathname of the probe's advertised URL are the same string
    And neither of them names a `mode` parameter

    Examples:
      | case                            | link                                     | probe                  |
      | the banner link vs the fleet    | the board banner's "the fleet" anchor    | `aof mesh ui --json`   |
      | the watch link vs the fleet     | the detail panel's "watch on the fleet"  | `aof mesh ui --json`   |
      | the drill-in vs the board       | the fleet's local-board "Open board →"   | `aof work ui --json`   |
    # The third row compares a RELATIVE href with an ABSOLUTE advertised URL, so it
    # compares pathnames only — which is the whole claim. Comparing whole strings
    # would fail for the correct implementation, and that is the trap this note
    # exists to disarm.
