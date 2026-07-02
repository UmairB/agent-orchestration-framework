@ui @work @distribution
Feature: the NODES region renders every node in the group with its presence, staleness, and active runs
  In order to see at a glance which machines in the fleet are alive and what each is running,
  the fleet view's NODES region renders one card per roster node — its identity, its
  presence-age line on the node-presence ramp, its active-run count, and its capability footer —
  under a summary line counting the fleet's liveness,
  so that an operator reads node-liveness as its own vocabulary (never confused with run-state or
  item-status), a stale or never-beat node is rendered degraded rather than dropped, and the page's
  own loading / error / empty states follow the board's established idioms.

  # DESIGN surface 1 (binding checklist items 2, 3, 6) is the conformance baseline until
  # mocks/mesh-ui.png lands (then the committed mock is the source of truth). The node-presence
  # ramp mapping is DESIGN's locked rail: live = teal filled dot + "♥ Ns ago"; stale =
  # muted hollow dot + "stale · Nm ago" (secondary, NOT destructive — degraded liveness, not
  # data loss); no-presence = dashed/muted dot + "no presence". Colour AND label always travel
  # together. The data is the /api/mesh/status aggregate (task 00) — the render adds no second
  # read. Rendered-view scenarios are @manual (the m21 convention).
  #
  # BROWSER LANE (QA-owned): scenarios marked [toHaveScreenshot candidate] are the
  # visual-regression set for this surface. Binding: once mocks/mesh-ui.png is committed and
  # the designer judges the rendered surface CONFORMS against it, that approved render becomes
  # the Playwright toHaveScreenshot baseline this lane locks against drift; until then DESIGN's
  # binding checklist is the interim baseline and these scenarios stay human-judged. The
  # verification tag does NOT change — the lane is a QA regression layered behind the @manual
  # judgement, not a re-tag.
  Background:
    Given a fleet server running against records I plant
    And the operator opens the fleet view

  # The headline: one card per node, the checklist anatomy (item 2), under the summary line.
  # The mixed fixture pins the summary-count boundary: a never-beat node counts in the node
  # total but as NEITHER live nor stale (it renders "no presence" — item 3, the m23 locked
  # rule: the aggregate omits its presence key and carries stale:false), so the live + stale
  # counts need not sum to the node total.
  # [toHaveScreenshot candidate]
  @manual
  Scenario: every roster node renders as a card with the checklist anatomy
    Given a roster of three nodes with mixed liveness — one live, one stale, one that never beat
    When the NODES region renders
    Then the region shows the uppercase NODES label and the summary line "3 nodes · 1 live · 1 stale"
    And each node renders one card: presence dot + its mono nodeId + its aofVersion chip, its presence-age line, its active-runs count, and its runtimes + skills footer
    And the machine the operator is on carries the quiet "this node" tag

  # The node-presence ramp — the locked three-state mapping (checklist item 3), colour and
  # label together. The liveness column is the aggregate FACT the card receives from the one
  # /api/mesh/status read (task 00): a presence record with stale:false, one with stale:true,
  # or NO presence key at all with stale:false (the m23 locked never-beat rule — you can only
  # be stale once you have beat). The card renders the flag; it never recomputes staleness.
  # [toHaveScreenshot candidate]
  @manual
  Scenario Outline: the node-presence ramp renders the locked mapping
    Given a node whose aggregate liveness fact is <liveness>
    When its card renders
    Then its presence dot is <dot>
    And its presence label reads <label>
    And the colour never appears without its label

    Examples:
      | liveness                                        | dot                         | label            |
      | a presence record with stale:false              | a teal (primary) filled dot | "♥ Ns ago"       |
      | a presence record with stale:true               | a muted hollow dot          | "stale · Nm ago" |
      | no presence key at all (never beat, stale:false) | a dashed muted dot          | "no presence"    |

  # Degraded is rendered, never dropped (checklist item 6, per-node degraded): the stale card
  # keeps its last-known facts. And stale is quiet (secondary, item 3), never alarm-red — red
  # on this surface is reserved for a failed run chip.
  # [toHaveScreenshot candidate]
  @manual
  Scenario: a stale node renders degraded — grey, present, with its last-known runs
    Given a node whose presence heartbeatAt is well past the staleness threshold
    When the NODES region renders
    Then that node's card is still present, showing "stale · Nm ago" and its last-known active-runs count
    And nothing on the card is painted in the destructive red

  # What it's running (checklist item 2, card row 3): the activeRuns count line, and "idle"
  # when empty — the 0/1/n matrix pins the pluralisation boundary.
  @manual
  Scenario Outline: the card's running line counts the node's active runs
    Given a node whose presence carries <activeRuns> active run ids
    When its card renders
    Then the card's running line reads "<line>"

    Examples:
      | activeRuns | line           |
      | 0          | idle           |
      | 1          | running 1 run  |
      | 2          | running 2 runs |

  # The page-level states follow the board's idioms (checklist item 6): a mono loading line,
  # an accent error line with Retry, and the dashed empty-fleet placeholder. A page-level
  # failure to load is DISTINCT from a stale node (which is normal rendered degradation).
  # [toHaveScreenshot candidate — each of the three states is its own baseline frame]
  @manual
  Scenario: the fleet page's loading, error, and empty-fleet states follow the board's idioms
    When the fleet view is first fetching /api/mesh/status
    Then it shows the mono "Loading fleet…" line
    When the /api/mesh/status request fails
    Then it shows an accent "Could not load the mesh: …" line with a Retry affordance
    When the aggregate answers an empty roster
    Then it shows the dashed placeholder inviting "aof mesh invite" / "aof mesh join"
    And none of these three states is conflated with a stale node's rendered card
