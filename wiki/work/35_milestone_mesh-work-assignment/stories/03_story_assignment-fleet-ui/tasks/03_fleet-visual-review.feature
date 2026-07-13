@uat @ui @work @design
Feature: the populated fleet view renders the assignment lifecycle — a read-only design-conformance judgement against DESIGN.md's binding checklist
  In order to confirm an operator can read a dispatch advancing `assigned → accepted → running → done|failed`
  at a glance on a surface that adds NO interactive control,
  the read-only fleet view is rendered populated — at least a `running` and a `failed`/`reclaimed` assignment —
  and judged region-by-region against DESIGN.md's binding checklist (CONFORMS / GAPS),
  so that the assignment affordance reads in the ONE chip vocabulary the board already speaks and no write concept leaks onto the read-only dashboard.

  # DESIGN.md is the BINDING CONFORMANCE BASELINE — there is NO committed mock for milestone 35 (DESIGN header +
  # Review Notes: "this checklist IS the conformance source of truth … do not return INCONCLUSIVE-on-missing-
  # baseline"). The checklist regions this @uat review judges, in order:
  #   1. TOP BAR — the Legend gains an "Assignment" block (a third block below "Node liveness" and "Run state"),
  #      one row per lifecycle state (mark + label), so the ramp is self-documenting (DESIGN §1 item 1 / §4 note).
  #   2. PRIMARY — the assignment chip in the GlobalMilestoneCard ATTENTION ROW (left slot, replacing the muted
  #      `·` placeholder; BEFORE the in-review/accepted token; never displacing "Open board →"). Anatomy
  #      (DESIGN §2a): `<mark> <label> → <nodeId> · <relative-time> [· <note> when degraded]`; the pill is the
  #      run-chip primitive (`runChipClasses`), the `→ nodeId` / `· time` are chip-adjacent mono, not in the pill.
  #   3. SECONDARY — the NodeCard / GlobalNodePanel assignments line (DESIGN §2b): a compact muted summary
  #      `assignments: N running · N accepted · N assigned` (only non-zero listed; all-zero → the row is OMITTED,
  #      never "0 assignments"); a held failed/reclaimed shows `· 1 failed` in the destructive token.
  #   4. RAMP (DESIGN §4): assigned=muted hollow dot · accepted=secondary filled dot · running=primary PULSING
  #      dot · done=primary ✓ · failed=destructive `!` — colour AND label AND mark always agree; ONLY running
  #      pulses; reclaimed/stale = failed + trailing `· reclaimed` (NOT a sixth colour).
  #
  # BROWSER LANE (QA-owned): this @uat review is the design-conformance judgement handed to the designer — a
  # RENDERED screenshot of the populated fleet, judged region-by-region against the checklist above. QA runs the
  # browser; the designer judges the handed render (it has no Bash). Per the design-render discipline
  # (`design-render via headless Chromium` memory), `npx playwright` is POLICY-BLOCKED here — the render drives
  # the cached ms-playwright Chromium directly (`--headless=new --screenshot=<ABSOLUTE forward-slash path>`), NOT
  # `npx playwright`. This @uat gate is judged at `aof:verify`. Once the designer judges a render CONFORMS, that
  # approved render becomes the `toHaveScreenshot` baseline QA's visual-regression guards against drift (the seam
  # QA owns; building the baselines into a hard gate is a QA-owned follow-on, OUT OF SCOPE for this story). This
  # surface is MOTION-bearing — only `running` pulses — so the screenshot locks the PRESENCE of the pulsing-dot
  # mark; the pulse animation itself is a functional harness check, not a pixel assert.
  #
  # RENDER PRECONDITION: reaching CONFORMS/GAPS requires a render of the populated fleet showing at least the
  # `running` and a `failed`/`reclaimed` assignment (DESIGN Review Notes). Absent a render, the honest verdict is
  # INCONCLUSIVE NAMING the missing render — never a guess from component code.
  #
  # SEAM SPLIT — this task is the design-conformance (does it LOOK/READ right) judgement ONLY. The read SHAPE is
  # task 00 (@executable); the pure state→chip mapping is task 01 (@executable); the no-write WIRE posture is
  # task 02 (@executable). This @uat judges placement, the kit-reuse, the ramp appearances, and the read-only
  # RAIL visually — the functional/behavioural halves live in tasks 00-02. The a11y lane is OFF for this story
  # (no "a11y" in work.tags.domains — no axe-core run, no a11y finding).

  Background:
    Given a populated fleet fixture is planted with an active dispatch: at least one item in state "running" and one in state "reclaimed"
    And the read-only fleet view is rendered via the cached ms-playwright Chromium (not npx playwright) to an absolute screenshot path
    And the rendered screenshot is handed to the designer to judge against DESIGN.md's binding checklist

  # RENDER GATE — if no render is produced, the review does NOT guess from code (DESIGN Review Notes). The
  # populated render (with the running + reclaimed appearances) is the precondition for a CONFORMS/GAPS verdict.
  Scenario: absent a populated render the review degrades to INCONCLUSIVE naming the missing render
    Given the cached-Chromium render did not produce a screenshot of the populated fleet
    When the design-conformance review runs
    Then the verdict is INCONCLUSIVE
    And it names the missing render (the populated fleet showing the running and reclaimed assignments) as the gap
    And it does not infer a verdict from the component source

  # REGION 2 — PRIMARY: the running assignment chip in the GlobalMilestoneCard attention row. Placement (left
  # slot, replacing the muted `·`, before the in-review/accepted token, never displacing "Open board →"),
  # anatomy (mark + label + `→ nodeId` + `· relative-time`), the run-chip primitive, and the ONLY-running pulse.
  # [cached-Chromium screenshot candidate — the running assignment chip; the pulse is a functional harness check]
  Scenario: a running assignment renders the pulsing primary chip in the milestone card attention row
    When the designer judges the running item's GlobalMilestoneCard against DESIGN §2a and §4
    Then the assignment chip sits in the attention row's LEFT slot, before the in-review/accepted token
    And it renders "running" with a pulsing primary (teal) dot — the ONLY state that pulses
    And the chip reads `running → <nodeId> · <relative-time>` (the `→ nodeId` / `· time` are chip-adjacent mono, not inside the pill)
    And it never displaces the right-aligned "Open board →" drill-in
    And the pill reuses the run-chip primitive (runChipClasses tokens), not a fleet-local colour system
    And the verdict for this region is CONFORMS or names a specific GAP

  # REGION 4 (degraded) — the reclaimed/stale assignment reads as failed + `· reclaimed` (NOT a sixth colour,
  # NOT a vanished chip, NOT a silent reversion). "Degraded states must stay visible" (34/ADR-008), judged
  # visually: destructive `!` + `failed` label + the trailing mono `· reclaimed` note.
  # [cached-Chromium screenshot candidate — the reclaimed assignment reads failed + reclaimed note]
  Scenario: a reclaimed assignment renders visibly as failed with a `· reclaimed` note, never silently dropped
    When the designer judges the reclaimed item's card against DESIGN §4's degraded rule
    Then the chip renders "failed" with the destructive `!` mark and the red destructive token
    And a trailing mono `· reclaimed` note is present
    And the reclaimed state is NOT a sixth colour, NOT a vanished chip, and NOT a silent reversion to "assigned"
    And the verdict for this region is CONFORMS or names a specific GAP

  # REGION 3 — SECONDARY: the NodeCard / GlobalNodePanel assignments line. The compact muted summary lists only
  # non-zero states; a held failed/reclaimed shows `· 1 failed` in the destructive token so a degraded dispatch
  # is visible on the WORKER too; an all-zero node OMITS the line entirely ("absent, not false").
  # [cached-Chromium screenshot candidate — the node assignments summary line]
  Scenario: a worker node card summarises its held assignments, with a degraded one shown in the destructive token
    When the designer judges the worker NodeCard against DESIGN §2b
    Then the node's "what it's running" area carries a compact muted line summarising held assignments by state
    And only non-zero states are listed (e.g. `N running · N accepted`), never "0 assignments"
    And a held failed/reclaimed assignment shows `· 1 failed` in the destructive token
    And a node holding NO assignments omits the line entirely (absent, not a zero-count)
    And the verdict for this region is CONFORMS or names a specific GAP

  # REGION 1 — TOP BAR: the Legend gains an "Assignment" block so the new ramp is self-documenting exactly as the
  # two existing ramps are (DESIGN §1 item 1 / §4 legend-parity note). One row per lifecycle state (mark + label).
  # [cached-Chromium screenshot candidate — the legend Assignment block]
  Scenario: the top-bar legend gains a self-documenting Assignment block
    When the designer opens the legend and judges it against DESIGN §1 item 1
    Then the legend carries an "Assignment" block below "Node liveness" and "Run state"
    And the Assignment block lists one row per lifecycle state (mark + label) matching the §4 ramp
    And the verdict for this region is CONFORMS or names a specific GAP

  # THE READ-ONLY RAIL — the surface adds NO interactive control (DESIGN Non-negotiable framing + Review Notes):
  # no assign/accept/revoke button, no form, no picker. The only interactions remain the drill-in link + the `⟳`
  # refresh. The assignment affordance is pure lifecycle DISPLAY. (The wire-level no-write posture is task 02's
  # @executable proof; this is the VISUAL statement of the same rail — a leaked write control is a GAP.)
  Scenario: the surface stays strictly read-only — no assign/accept/revoke control appears on the render
    When the designer audits the full rendered fleet for interactive controls
    Then there is no assign, accept, or revoke button, and no assignment form or picker anywhere on the surface
    And the only interactions remain the board drill-in link and the `⟳` refresh (the m34 read-only surface, plus display only)
    And any assignment rendered by colour without its paired label/mark is a GAP (colour never travels alone)
    And a fleet-local chip vocabulary instead of the run-chip primitive is a GAP
    And the verdict for the read-only rail is CONFORMS or names a specific GAP

  # LIVE-BY-POLL, not a push (DESIGN Non-negotiable framing / ADR-007): the render is a SNAPSHOT of the 5s-poll
  # state — there is no UI WebSocket/SSE. A silent re-poll reuses keep-last-good, so the populated cards never
  # flip to a full-screen loading/error branch (a torn card on a silent poll is a GAP). Judged as: the populated
  # render carries no spinner on a chip and no page-level loading/error takeover over live assignment cards.
  Scenario: the live update is the 5s poll with keep-last-good — no push, no torn card
    When the designer judges the populated render's freshness affordance and card stability against DESIGN §3
    Then the render shows the `⟳ refreshed …` poll affordance, not a UI WebSocket/SSE indicator
    And no spinner appears on an assignment chip and no page-level loading/error branch covers the populated cards
    And the verdict for this region is CONFORMS or names a specific GAP
