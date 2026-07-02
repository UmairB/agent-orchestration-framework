@ui @work @distribution
Feature: the fleet view reflects a peer's change on poll refresh, within the presence bound
  In order to trust the fleet view as the current truth of what the group is doing,
  the view re-polls the one /api/mesh/status read — on the ⟳ refresh affordance and on its
  poll cadence — and reflects a peer's change without tearing the page,
  so that a node going live, going stale, or picking up a run shows up within milestone 23's
  KR1 presence bound (≤5s over the relay, ≤30s over git) plus one poll, with no WebSocket
  event-stream chrome anywhere on the client.

  # DESIGN's poll/refresh rail (documented default 4) + PRD §7.3: visibility is poll /
  # relay-presence, NOT a push event stream. The freshness underneath is m23's KR1 (measured
  # there — 23/02 task 02 owns the relay-vs-git timing spike; this feature does NOT re-measure
  # it). What THIS surface owns observably: the refresh affordance re-polls in place, the
  # updated aggregate re-renders without tearing (the m03 load({silent}) idiom), and the
  # "refreshed Ns ago" label tells the operator how fresh the view is. Scenarios are @manual
  # (rendered behaviour over a two-node fixture); the underlying read is task 00's.
  #
  # BROWSER LANE (QA-owned): the non-tearing refresh and the refreshed-ago label are
  # Playwright harness (functional) candidates — drive the ⟳, assert no loading-state flash
  # and the label reset. The @executable wire scenario runs under the same harness with
  # network interception. Tags stay as written.
  #
  # DEV (failed silent re-poll — flag resolved): KEEP-LAST-GOOD. The m03 load({silent})
  # precedent is decisive and directly reused: on a silent refresh a caught error does NOT
  # setError and does NOT setLoading — the catch is guarded `if (!silent) setError(...)`
  # (ui/src/board/Board.tsx:46-61), so a mid-session poll failure NEVER tears a populated view
  # down to the full-screen loading/error branch (that branch unmounts the subtree). The
  # populated fleet render stays; the failure is surfaced QUIETLY (the ⟳ freshness label stops
  # advancing / carries a quiet stale-refresh marker — task 04's "refreshed Ns ago" is the
  # freshness signal that shows the last successful poll is aging), never the accent
  # "Could not load the mesh: …" page-error state (that stays reserved for a FIRST-load
  # failure, DESIGN default 5). Only an explicit Retry / first load flips to the error state.
  # The scenario below (which QA declined to invent) is added to lock this outcome.
  Background:
    Given a fleet server running against records I plant
    And the operator has the fleet view open

  # The headline: a peer's presence change shows up after refresh — the view reflects the
  # records as they sync, no reload required. (The bound itself is m23's measured KR1;
  # this scenario judges arrival within it, it does not re-measure the transport.)
  @manual
  Scenario: a peer node's change is reflected on the next refresh
    Given a peer node currently rendered as live with one running board
    When that peer's presence and run records change and sync to this node
    And the view refreshes (by the ⟳ affordance or its poll cadence)
    Then the peer's card and its board's tile render the changed facts
    And the change arrived within the m23 presence bound plus one poll

  # The refresh is in-place and non-tearing: no flash to blank, no lost scroll — the m03
  # silent-reload idiom.
  @manual
  Scenario: the ⟳ refresh re-polls in place without tearing the page
    Given a populated fleet view
    When the operator clicks the ⟳ refresh affordance
    Then the view re-fetches /api/mesh/status and re-renders the changed cards in place
    And the page never flashes to its loading state while the poll is in flight
    And the operator's scroll position is preserved across the refresh

  # The freshness label: the top bar tells the operator how old the view is, and resets
  # on every successful poll.
  @manual
  Scenario: the top bar carries the refreshed-ago label and resets it on each poll
    Given a populated fleet view
    Then the top bar reads "⟳ refreshed Ns ago" with the age since the last successful poll
    When a refresh completes
    Then the label resets to the fresh age

  # A FAILED silent re-poll over a populated view keeps the last-good render and surfaces
  # the failure quietly — it does NOT tear the populated page down to the page-error state
  # (the m03 load({silent}) keep-last-good idiom, flag resolved above). The page-error state
  # ("Could not load the mesh: …" + Retry, DESIGN default 5) is reserved for a FIRST-load
  # failure, not a mid-session poll miss.
  @manual
  Scenario: a failed silent re-poll keeps the last-good render, not the page-error state
    Given a populated fleet view with a last successful poll
    When a subsequent silent poll of /api/mesh/status fails
    Then the view keeps its last-good cards rendered, not the accent "Could not load the mesh: …" page-error state
    And the failure is surfaced quietly — the "refreshed Ns ago" freshness label keeps aging from the last successful poll
    And an explicit Retry (or a subsequent successful poll) is what restores or refreshes the view

  # No push chrome: the client opens no event stream — refresh and poll are the only
  # freshness mechanisms (the PRD §7.3 boundary, observable on the wire). Scoped to /api
  # traffic: the page's static bundle fetches are not the assertion's subject.
  @executable
  Scenario: the fleet client opens no event stream
    Given the fleet server is running
    When the fleet page is loaded and left open across several poll cycles
    Then the client opened no WebSocket and no server-sent-event stream to the fleet server
    And every /api request on the wire was a GET poll of the one /api/mesh/status read
