@executable @ui @work @board @distribution
Feature: The work-item card's "assign to node" affordance renders from the REAL UI production — a worker-node picker sourced from the LIVE node roster, the assign action, and the resulting `assigned` chip — fed by the route payload, never a fixture-shaped snapshot
  In order that the assign affordance is a working feature and not dead code fed a convenient fixture (ADR-008's earned lesson,
  F9 — NodeCard was perfectly correct and perfectly irrelevant), the work-item card renders its "assign to node" affordance
  THROUGH the component production actually mounts: the picker's options are the SAME roster the real GET /api/mesh/status
  returns, and the resulting chip is the SAME assignmentChip projection milestone 35 / story 03 already renders over a REAL
  minted record.

  # ARCHITECTURE 38/ADR-008 — "a component must be tested through the component PRODUCTION RENDERS / INVOKES … establish, from
  # the producer, WHICH component the real payload mounts"; fitness acd-rendered-component-fed-by-route (derive the mounted
  # branch from the REAL route payload; no branch may host a dead feature path). ADR-012 — the resulting `assigned` chip is the
  # m35/story-03 read shape. This repo has NO React test harness: the render-logic under test lives in the pure fleet helpers
  # (ui/src/fleet/scope.mjs + assignments.mjs — the house pattern the production Fleet.tsx card renders the picker + chip from),
  # exercised by node:test over the REAL route payload. The FULL browser render (Playwright at the documented breakpoints + the
  # toHaveScreenshot baseline that locks the designer-approved render) is the QA-owned VISUAL lane, judged at Review — NOT this
  # @executable's job.
  #
  # @executable proves the DATA is PRODUCER-FED, not fixture-shaped: the roster the picker offers is derived from the REAL GET
  # /api/mesh/status payload (empty + populated), and the chip is derived from a REAL minted record — never a hand-built node
  # list nor a hand-built assignment object (STATE.md F1/F4/F9).

  Background:
    Given the REAL fleet face (serveMeshUi) over an isolated global-store seam
    And the affordance derives its picker + chip from the SAME pure fleet projection the production card renders from

  Scenario Outline: the node-picker offers exactly the assignable nodes the REAL roster carries — no invented, no dropped option
    Given a node roster of <roster> published into the store
    When the assign affordance derives its picker options from the REAL GET /api/mesh/status payload
    Then the picker offers exactly <options>
    And every offered option is a node carried by the route's roster (no invented / placeholder target)
    And no node the roster carries is silently dropped from the picker

    Examples:
      | case                 | roster                                        | options            |
      | empty roster         | no worker nodes registered                    | (none)             |
      | one worker           | worker-a (live)                               | worker-a           |
      | many, live + stale   | worker-a (live), worker-b (stale)             | worker-a, worker-b |
    # a stale-but-known node stays an option — the verb's node-known gate keys on a global_nodes row, NOT on liveness, so the
    # picker must not drop a target the verb would accept; repo-eligibility is enforced by the verb at assign time (task 01), a
    # coded refusal, not a hidden picker filter.

  Scenario: the empty-roster state renders a disabled / empty affordance — not a phantom option, not a crash
    Given no worker node is in the roster
    When the affordance derives from the REAL empty GET /api/mesh/status payload
    Then it renders its empty / disabled state (there is nothing to assign to)
    And it offers NO node option and NO invented "any" / placeholder target the verb would refuse
    # ADR-008 F9 — the branch the REAL empty payload mounts, never a fixture-populated one

  # ADDED 2026-07-24 (`aof:continue 38/04` review fix QA-a) — reproduced end-to-end in Chromium at review and confirmed at
  # source: the affordance remembered its selection in component state and never re-synced it when the roster changed under it.
  # The fleet face is a LONG-LIVED monitor that re-polls every poll interval, so when the selected node left the picker the
  # <select>'s DOM value coerced to the first surviving option while the state kept the DEPARTED id — the row DISPLAYED one
  # target and POSTED another, and the `Sent` acknowledgment then sat beside the wrong name (region 6 contradicting region 5 on
  # the same card). This is BLOCKER F21's defect class relocated to the NODE axis, and its lesson generalised: a seam whose
  # defect is a WRONG TARGET must be exercised with ≥2 candidates where the chosen one can STOP BEING VALID.
  Scenario: the target the row NAMES is the target the POST carries — a roster change under a mounted picker never splits the two
    Given the REAL production <Fleet/> mounted against the REAL fleet face, its picker producer-fed with TWO candidate nodes
    And the node the row is resting on then LEAVES the roster while the row stays mounted (its registry descriptor stops resolving)
    When the next poll lands and the operator clicks "Assign →"
    Then the value the picker renders is one of the options the picker renders — never a departed id held behind a coerced display
    And the POST the app actually sent carries the node the row NAMED
    And the REAL minted record targets that same node when read back through the REAL store
    And the departed node was still ASSIGN-ELIGIBLE at that moment (a mis-dispatch to it would have returned a plausible 200)
    # the picker is fed by queryGlobalRegistry (which drops a node whose descriptor no longer resolves) while the verb's
    # node-known gate reads global_nodes DIRECTLY — so a stale target is accepted, not refused, which is what makes it silent

  Scenario: the resulting `assigned` chip renders from the REAL minted record — the m35/story-03 read shape, closing the loop
    Given a REAL assign has minted an `assigned` record for "38/04" on "worker-a" (through the real route, task 00)
    When the work-item card derives its assignment chip from the REAL GET /api/mesh/status payload
    Then the chip is the m35/story-03 assignment read shape — state "assigned", target "worker-a"
    And the chip is produced by the SAME assignmentChip projection production renders (not a hand-built assignment object)
    # the affordance closes the loop back to the existing chip, fed by the real minted record — the visual fidelity of that
    # render is the designer's judgement at Review over the QA-run Playwright screenshot; this line asserts only the fed DATA
