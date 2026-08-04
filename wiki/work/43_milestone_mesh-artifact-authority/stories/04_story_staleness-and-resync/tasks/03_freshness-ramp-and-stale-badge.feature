<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the fifth ramp: one pure headless freshness module emits the state and
# both renderings, the board paints it as a dashed `muted` pill immediately LEFT of the
# status chip, and the badge appears WITHIN ONE SECOND of the crossing off the existing
# cosmetic clock tick — with no network, no motion and no reflow.
# LITMUS: every Then is confirmable from something the surface actually produces — the
# ramp module's return value for injected inputs, and the RENDERED element tree of the
# REAL, unmodified production board component mounted headlessly against a REAL board face
# with a CONTROLLABLE clock (the `test/support/fleet-app-harness.mjs` idiom, which
# esbuild-bundles the real component and stubs only what React itself would provide). No
# source read. Element text, `className` tokens, attributes, sibling ORDER and the count of
# fetches the app made are all read off that tree; PIXEL facts (does the chip's right edge
# really not move, does the badge really read as degraded) are NOT claimed here — they are
# task 09's `@uat` render verdict, exactly as m38's DG-13 lanes split.
#
# WHY THE CLOCK TICK IS LOAD-BEARING AND NOT A DETAIL. The board only re-polls its list
# while something is EXECUTING (`Board.tsx:183-188`). A settled item — the common case for
# a stale row, since it is stale precisely because its owner stopped reporting — would
# therefore never grow a badge until a manual `⟳ sync`. The badge must be recomputed
# against a live 1s tick, not against fetch time. The tick already exists in the product
# (`DetailPanel.tsx:563-596`, `Fleet.tsx:72`) but not yet at the item-surface level the
# badge needs; wiring it there is this task's real work, and "within 1s with zero network"
# is how that is confirmed rather than assumed.
#
# THE THRESHOLD AGREEMENT. The client predicate is strict `>` for the same reason the
# server's is (task 02): the two run on opposite sides of the wire against the same instant.
# The Examples below sample the same three boundary points task 02 samples, and assert the
# two verdicts MATCH — which is a behavioural claim the fitness function cannot make (it
# checks the client module's shape statically and the server predicate behaviourally, never
# the two together).

@executable @ui @work @distribution
Feature: the freshness ramp renders a dashed `muted` stale badge that appears within one second of the crossing off the cosmetic clock tick, with no network, no motion and nothing moving on the row
  In order that an operator reading a cached copy can see it has gone stale without refreshing the page — and can never mistake
  "this copy is late" for "this item is broken"
  one pure headless module turns `syncedAt` + `reportedBy` + the wire's `stalenessSeconds` + an injected `now` into a state and
  its renderings, and the board paints the stale state as a dashed `muted-foreground` pill immediately left of the status chip,
  which keeps its right-edge anchor

  Background:
    Given the REAL production board mounted headlessly against a REAL board face over an isolated global store, on a controllable clock
    And the board face is serving a mesh-enabled workspace whose list response carries `syncedAt`, `reportedBy` and `stalenessSeconds` = 300

  # HEADLINE (AC 7 / DESIGN §"The three states"). The ramp is a pure function of facts and
  # `now`; `fresh` renders NOTHING, which is the "absent, not false" discipline.
  Scenario Outline: the ramp module turns the wire's facts and an injected `now` into one of exactly three states, and only `stale` earns a mark
    Given a record whose `syncedAt` is <syncedAt> and whose `reportedBy` is "umairs-mac-mini"
    When the freshness ramp is evaluated with `stalenessSeconds` = 300 and an injected `now`
    Then the state is <state>
    And the badge rendering is <badge>
    And the provenance-label rendering is <label>

    Examples:
      | case              | syncedAt              | state   | badge                | label                                       |
      | freshly reported  | 10 seconds before now | fresh   | (none)               | synced 10s ago · from umairs-mac-mini       |
      | inside the window | 120 seconds before now| fresh   | (none)               | synced 2m ago · from umairs-mac-mini        |
      | past the window   | 720 seconds before now| stale   | ◌ stale · 12m ago    | stale · synced 12m ago · from umairs-mac-mini |
      | never stamped     | null                  | unknown | (none)               | synced time unknown · from umairs-mac-mini  |
    # `unknown` renders NO badge and an explicit words-form label: a fact slot degrades to
    # "unknown" (DESIGN GAP D2), an ASSERTION is withheld. Every relative age comes from the
    # product's one `relativeTime` formatter, so `10s ago` / `2m ago` / `12m ago` are its
    # words, not this ramp's.
    # CORRECTED at build (PO, 2026-08-03): the first row read `4 seconds` / `synced 4s ago`,
    # which that one formatter cannot produce — it renders anything under five seconds as
    # `just now` (`ui/src/board/runs.mjs:32`). The row's subject is a seconds-grain fresh
    # age, so the age moved rather than the vocabulary; the ramp's own claims are unchanged.

  # AC 4 — the two sides of the wire must agree AT the instant. Same three boundary points
  # task 02 samples on the server.
  Scenario Outline: the client ramp uses strict `>` and returns the SAME verdict as the server's shared predicate at the threshold instant
    Given a record whose age at the injected `now` is <age> seconds, with `stalenessSeconds` = 300
    When the client freshness ramp and the server's shared staleness predicate are each evaluated over that record at that same `now`
    Then the client's state is <state>
    And the server's verdict is the same state
    And the two never disagree at any of these points

    Examples:
      | case                  | age | state |
      | one second under      | 299 | fresh |
      | EXACTLY at the window | 300 | fresh |
      | one second over       | 301 | stale |

  # HEADLINE (AC 8) — the crossing is CLOCK-driven. The zero-network clause is the one that
  # proves it: if the badge only appeared after a fetch, a settled board would never show it.
  Scenario: the badge appears within one second of the crossing, driven by the cosmetic tick, with NO network request
    Given a settled item — nothing is executing, so the board is not re-polling its list — whose row is 299 seconds old and carries no badge
    And the number of requests the app has made so far is recorded
    When the controllable clock advances past the threshold and one cosmetic tick elapses
    Then the item's badge is present in the rendered tree, reading "◌ stale · 5m ago"
    And the app made ZERO additional requests across the crossing — no list fetch, no doc fetch, no probe
    And no new polling cadence was started: over the following minute the app makes exactly the requests it would have made anyway
    And the age on the provenance line continued counting on the same tick, gaining its `stale ·` prefix in that tick

  # AC 7 / DESIGN documented-default 3 — placement, and the reason for it: the m03 header
  # baselines must survive the threshold. This is the STRUCTURAL half (order and anchor
  # classes); the pixel half is task 09.
  Scenario: at the threshold the badge enters the cluster to the LEFT of the status chip, which keeps its right-edge anchor
    Given the detail panel is open on an item whose row is one second under the window
    When the clock advances past the threshold and one tick elapses
    Then in the header's row-1 cluster the badge is the sibling immediately BEFORE the status chip, in DOM order
    And the `ml-auto` anchor is carried by the cluster, so the status chip is still the last, right-anchored element of the row
    And the ring, the mono ref, the type chip, the title and the tag are unchanged — same text, same classes, same order
    And no element gained an animation, transition, pulse or shimmer class in the transition
    And no toast, banner, dialog or page-level message appeared

  # AC 7 — the TONE rail, which is the design's first binding rail. `destructive` stays
  # spoken for by `blocked` items and `failed` runs; a stale copy is neither.
  Scenario Outline: the badge is always the `muted` degraded ramp — never `destructive`, whatever the item's own status is
    Given an item whose status is <status> and whose row is 720 seconds old
    When the item's surfaces are rendered
    Then its stale badge carries the `muted-foreground` text token, a transparent background and a dashed `muted-foreground/45` border
    And the badge carries no `destructive` and no `accent` token
    And the `destructive` token on that item, if present at all, belongs to <destructive owner> and to nothing else
    And the badge's type is strictly below the status chip's, so status outranks freshness

    Examples:
      | case                    | status      | destructive owner                    |
      | an ordinary stale item  | in-progress | (nothing on the item)                |
      | a BLOCKED stale item    | blocked     | the status chip alone                |
      | a done stale item       | done        | (nothing on the item)                |
    # The blocked row is the one that matters: two degraded facts on one card must stay two
    # vocabularies, or the reader cannot tell "this work is blocked" from "this copy is old".

  # AC 7 — three forms and a pinned YIELD order (whole discrete drops, never a shrink
  # factor, never overprinting — the m38 DG-13/DG-19 lesson). Structure only; the 360px
  # pixel verdict is task 09.
  Scenario Outline: the badge has exactly three forms, chosen by a yield order of whole drops, and never spends its width on a node id
    Given a stale item rendered on <surface>
    When its badge is rendered
    Then the badge's form is <form> reading <text>
    And the badge does not contain the reporting node's id in its visible text
    And the full sentence naming the node, the local time, the age and the window is carried in the badge's `title`

    Examples:
      | case                       | surface                        | form    | text              |
      | detail panel header        | the detail panel header row 1  | full    | ◌ stale · 12m ago |
      | overview milestone card    | the overview card row 1        | full    | ◌ stale · 12m ago |
      | lane card meta line        | the lane card meta line        | short   | ◌ stale           |
      | fleet milestone card       | the fleet milestone card row 1 | short   | ◌ stale           |
    # The region-5 lesson applied pre-emptively: a chip that spends its width on a long node
    # id truncates the thing it exists to say. The node lives in `title` and on the
    # provenance line (task 04).
    # CORRECTED at review (PO on the designer's ruling, 2026-08-03): the last row read
    # `fleet card at its NARROWEST | minimal | ◌`, which assumed a viewport-driven yield
    # ladder. DESIGN has WITHDRAWN that ladder — not deferred it — because it was keyed to the
    # wrong variable: the fleet grid is `repeat(auto-fill, minmax(320px, 1fr))`, so it adds
    # COLUMNS rather than width and the card sits in a ~300–370px band at EVERY breakpoint
    # (it is narrower at 2560 than at 1280). A viewport rule would therefore paint `full` in a
    # ~345px card at 2560 and `minimal` in a ~330px card at 390. The binding rule is now
    # "the form is chosen by the SURFACE, not the viewport", so this card has ONE form at all
    # widths — `short`. `minimal` is RESERVED with no painter in this milestone; its
    # `role="img"` + `aria-label` contract still binds (task 08), which is what keeps it safe
    # to pin a future surface to.

  # AC 7 / DESIGN's per-region States checklist — the ABSENT cases. Freshness is never
  # asserted before it is known, and a page-level failure is not a freshness fact.
  Scenario Outline: no badge is rendered unless the row is known to be stale
    Given the board is in the <situation> situation
    When the item surfaces are rendered
    Then no stale badge appears anywhere on the lane card, the overview card, the detail header or the fleet card
    And <extra>

    Examples:
      | case                    | situation                                             | extra                                                                 |
      | first load              | the list request has not answered yet                 | no skeleton badge and no placeholder pill stands in for one           |
      | non-mesh workspace      | the workspace is not mesh-enabled                     | the board keeps its plain local default with no freshness vocabulary  |
      | unknown instant         | the row's `syncedAt` is null                          | the provenance line says so in words instead (task 04)                |
      | list fetch failed       | the list request errored                              | the existing page-level error line owns the failure, unchanged        |
      | fresh row               | the row is 60 seconds old inside a 300s window        | freshness is the norm and earns no mark                               |
      | a `uat` gate bar        | an overview `uat` gate bar is rendered                | no gate bar paints a badge — the ramp is an ITEM-SURFACE vocabulary; absent, not "fresh" |
    # CORRECTED at build (PO, 2026-08-03): the last row's stated reason was false, though its
    # outcome was right. It read "gates are local acceptance items with no cached provenance";
    # measured at the wire, a `uat` gate row DOES carry `reportedBy` + `syncedAt` like any
    # other row — `publishWorkspaceSnapshot` publishes it exactly as it publishes the rest.
    # The badge is absent because no gate-bar component paints one, which is a statement about
    # WHERE the ramp is rendered, not about what the cache holds. Left as a scenario because
    # the outcome is the contract; the reason is corrected so a future author does not build
    # on it. (If gates SHOULD be excluded from cache publication, that is a separate claim
    # this story never made and the implementation quietly disagrees with — flagged for retro.)

  # AC 9 / m38 ADR-012, the structural half that belongs with the BADGE: a card that is
  # itself a `<button>` may hold the badge, because the badge is not interactive. (The "one
  # Resync door" claim is task 05's.)
  Scenario: the badge inside a lane card or an overview card is a non-interactive element, because the card itself is a button
    Given a stale item rendered in the lanes view and in the overview grid
    When the two cards are rendered
    Then each card is itself a `<button>`
    And the badge inside it is a non-interactive element — no nested `<button>`, `<a>`, `role="button"`, `onClick` or `tabindex`
    And the card remains a single focus stop and a single activation target

  # DESIGN §"The threshold crossing" — the reverse crossing. The disappearance IS the
  # confirmation; a "refreshed!" flourish would be the success-toast mistake by another name.
  Scenario: when a fresher copy lands the badge simply disappears and the age resets — with no flourish
    Given a stale item whose badge is showing and whose line reads "stale · synced 12m ago · from umairs-mac-mini"
    When a list response arrives carrying a `syncedAt` of just now for that row
    Then the badge is gone from every surface that showed it
    And the provenance line reads "synced just now · from umairs-mac-mini" with no `stale ·` prefix
    And no toast, no banner, no highlight, no animation and no "refreshed" message appeared anywhere
    And no other element on the row changed
