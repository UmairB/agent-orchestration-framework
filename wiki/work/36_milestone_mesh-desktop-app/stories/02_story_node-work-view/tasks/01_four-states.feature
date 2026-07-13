@executable @ui @design @distribution
Feature: The four-state selection logic — empty / loading / error / populated — always truthful, calm, and torn-view-free
  In order that an operator is never shown a stack trace or a torn view and always knows the fleet's real state,
  a pure state-selection function maps a `mesh status --json` payload (or a fetch outcome) to exactly ONE of four render states —
  empty (no nodes → an invite CTA whose copy reflects worker vs control), loading (first fetch → a skeleton reserving the SAME layout),
  error (`mesh status` failed → a calm inline banner, NEVER a stack trace; keep-last-good on a silent re-poll), populated (nodes, a stale one still rendered muted, never red, never dropped)
  so that every transition is a quiet, layout-stable, truthful selection off the one poll.

  # DESIGN §Surface 1 §States (all four) + §Review notes standing rules (stale-never-red, calm-error,
  # keep-last-good) + ADR-004 (the ONE `mesh status` poll feeds this; the corrected shape — `nodes` length,
  # `isControlNode` — is the selection input). The selection is a PURE function over `{ nodes, isControlNode }`
  # + a fetch outcome (ok / failed / first-fetch) + the last-good frame — no DOM, no clock, no I/O — so these
  # scenarios run headless. This task selects WHICH state renders; the per-node row mapping is task 00.
  #
  # SEAM SPLIT — this task is the STATE-SELECTION logic ONLY. The per-node row descriptors are task 00. The
  # no-write / read-only WIRE posture is task 02. That each rendered state LOOKS right against the mock +
  # checklist is the @uat design-conformance judgement (task 03). The a11y lane is OFF for this story (no
  # "a11y" in work.tags.domains — no axe-core run, no a11y finding).
  #
  # RESOLVED (developer-amigo): confirm the harness shape — this @executable state-machine is expected to be a
  # Rust `#[test]` (`cargo test`) over the `app/desktop/` state-selection fn, NOT a Node headless test. The
  # developer amigo confirms the exact runner and the last-good-frame representation the keep-last-good scenario
  # asserts against.

  Background:
    Given the pure state-selection function is imported with no DOM and no clock

  # THE CORE SELECTION — payload/fetch-outcome → one of the four states (DESIGN §States). first-fetch pending →
  # loading; a completed fetch with zero nodes → empty; a failed fetch (no prior good frame) → error; a
  # completed fetch with nodes → populated. Exactly one state; the selection is total.
  Scenario Outline: the payload / fetch outcome selects exactly one of the four states
    Given a fetch outcome "<outcome>" with node count "<nodes>" and a prior-good frame "<priorGood>"
    When the render state is selected
    Then the selected state is "<state>"

    Examples: the four-state selection (DESIGN §Surface 1 §States · ADR-004 one poll)
      | outcome      | nodes | priorGood | state     |
      | first-fetch  | (n/a) | none      | loading   |
      | ok           | 0     | none      | empty     |
      | ok           | 3     | none      | populated |
      | failed       | (n/a) | none      | error     |

  # EMPTY — zero nodes is NOT an error (DESIGN §States empty: "never call an empty fleet broken"). It is a calm
  # centred placeholder with an INVITE CTA whose copy reflects the role of THIS install (off top-level
  # `isControlNode`, ADR-004): a WORKER reads "join a control node"; a CONTROL node reads "invite a node /
  # start the server". The CTA commands render as copyable mono chips.
  Scenario Outline: an empty fleet is a calm invite CTA whose copy reflects worker vs control, never an error
    Given a completed fetch with zero nodes on a "<role>" node (isControlNode "<isControlNode>")
    When the render state is selected
    Then the selected state is "empty"
    And the invite copy reads "<copy>"
    And the placeholder is a calm centred invite, NOT an error banner
    And the invite command renders as a copyable mono chip

    Examples: role-reflected empty copy (DESIGN §States empty · ADR-004 isControlNode)
      | role    | isControlNode | copy                          |
      | worker  | false         | join a control node           |
      | control | true          | invite a node / start the server |

  # LOADING — the first fetch shows a STABLE skeleton that reserves the SAME region layout (control bar present,
  # body placeholder rows) so NOTHING reflows when data lands (DESIGN §States loading). The control-bar local
  # process pills MAY already be truthful during loading (they are a local signal, not gated on the poll —
  # the two ramps again: local pills need no fleet fetch).
  Scenario: loading reserves the same layout — the skeleton does not reflow when data lands
    Given the first `mesh status` fetch is still pending
    When the render state is selected
    Then the selected state is "loading"
    And the skeleton reserves the SAME region layout (control bar + body placeholder rows)
    And no region reflows or resizes when the real payload lands
    And the control-bar local process pills may already read truthfully during loading (a local signal, not the poll)

  # ERROR — `mesh status` failed with NO prior good frame → a CALM inline banner at the top of the body: an
  # attention-tone caution glyph + ONE plain sentence + the path/command to inspect + a Retry (DESIGN §States
  # error · §Review notes "errors are calm sentences, never stack traces"). NEVER a stack trace, a raw error
  # dump, or a scary full-window failure. The forbidden forms are asserted as gaps.
  Scenario: a failed status with no prior good frame renders a calm inline banner — never a stack trace
    Given a `mesh status` fetch failed with a raw error "Error: connect ECONNREFUSED 127.0.0.1:7777\n  at TCPConnectWrap..."
    And there is no prior good frame
    When the render state is selected
    Then the selected state is "error"
    And the error surface is a calm inline banner: one plain sentence plus a Retry affordance
    And it names the command/path to inspect in plain words
    And it renders NO stack trace, NO raw error dump, and NO full-window failure takeover

  # KEEP-LAST-GOOD — a failed *silent* re-poll does NOT blank a populated body (DESIGN §States error keep-last-
  # good · §Review notes). It keeps rendering the last-good populated frame, quietly STOPS advancing freshness
  # (and may show a thin "reconnecting" hint), and does NOT tear to the full-screen error. This is the anti-
  # torn-view rule the user story names ("never shown a stack trace or a torn view on a silent re-poll").
  Scenario: a failed silent re-poll keeps the last-good populated body — it does not blank or tear the view
    Given a populated last-good frame with several node rows is on screen
    And a subsequent SILENT re-poll of `mesh status` fails
    When the render state is selected
    Then the selected state stays "populated" (the last-good body is kept)
    And the populated body is NOT blanked and NOT replaced by the error banner
    And the freshness line quietly STOPS advancing (optionally a thin "reconnecting" hint)
    And no stack trace and no full-window error takeover appear over the live cards

  # POPULATED — a mix (DESIGN §States populated, "the mock's primary frame"): control + worker roles,
  # online + stale presence, running + idle work, with the local node tagged `this node`. The load-bearing
  # rule: a STALE node still RENDERS (degraded, muted — NEVER dropped, NEVER red, DESIGN §Review notes
  # "stale is never red"). The selection is populated and every node is present in the row set.
  Scenario: a populated mixed fleet renders every node — a stale node stays muted, never dropped, never red
    Given a completed fetch with a mixed fleet: control + worker roles, online + stale presence, running + idle work, the local node tagged
    When the render state is selected
    Then the selected state is "populated"
    And every node in the payload appears in the rendered row set — none is dropped
    And the stale node still renders, muted/degraded, NEVER red
    And the running node shows its work ref + running marker and the idle node reads "idle"
    And the local node carries the `this node` identity tag
