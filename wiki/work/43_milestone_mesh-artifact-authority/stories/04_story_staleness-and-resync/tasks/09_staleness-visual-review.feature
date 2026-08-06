<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the human gate. A person judges whether the freshness ramp reads as
# DEGRADED rather than BROKEN, region by region, against DESIGN.md's binding checklists, at
# every documented breakpoint, over a real browser render.
# LITMUS: every Then is confirmable from a RENDERED SCREENSHOT (and, for the two measured
# clauses, from a number QA reads off the same render) judged against a named checklist
# region — never from component source. Where no render exists, the honest verdict is
# INCONCLUSIVE naming the missing render.
#
# WHY THIS GATE EXISTS AT ALL, AND WHY IT IS `@uat`. DESIGN's whole thesis is a perceptual
# claim: "stale must never read as broken". A stale row is still the mesh's ONLY readable
# copy of that work, so a badge that reads as an error would over-alarm the exact condition
# this milestone exists to normalise. No element-tree assertion can settle that — tasks 03,
# 04, 05, 06, 07 and 08 pin the tokens, the text, the order and the names; whether the result
# READS calm is a judgement. And because the automated a11y lane is OFF in this repo
# (`.aof/aof.config.json`'s `work.tags.domains` lists no `a11y` entry, and there is no
# `work.ui.a11y` block), the perceptual accessibility clauses have no axe-core run behind
# them either — they land here. There is NO axe run in this story and NO a11y finding will
# come from one.
#
# NO MOCK EXISTS. This refine ran `--autonomous` with no operator present, so no mock could
# be requested or committed and there is no `mocks/` directory for milestone 43. Per
# 07/ADR-003 that makes DESIGN.md's binding checklists the MANDATORY conformance source of
# truth — they ARE the baseline, not a supplementary rubric — so a missing mock is NOT a
# reason to return INCONCLUSIVE. The regions below are DESIGN's own checklist regions, in
# DESIGN's own order.
#
# BROWSER LANE (QA-OWNED). QA runs the browser; the designer judges the render it is handed
# (it has no Bash). Per the design-render discipline, `npx playwright` is POLICY-BLOCKED
# here — the render drives the cached ms-playwright Chromium directly (`--headless=new
# --screenshot=<ABSOLUTE forward-slash path>`). The BOARD is served on an EPHEMERAL
# per-workspace port that changes on every daemon restart, so its base URL must be supplied
# to the render at capture time and NEVER hard-coded; the FLEET is the fixed-port surface.
# Breakpoints: 1280 (primary judgement width), 768, 390 — and 360 additionally for the fleet,
# because that surface's existing width findings were measured at 360–414px. Note (PO, on the
# designer's ruling, 2026-08-03): 360 is NOT there to watch a yield ladder fire — that ladder
# is withdrawn (see the pinned-forms scenario below). The fleet card is roughly the SAME width
# at 360 as at 1280, because its grid adds columns rather than width, so the two renders are a
# cross-check on each other: a fit at 360 means a fit everywhere, and a failure at 1280
# indicts the grid rather than the phone.
#
# THE BASELINE SEAM. Once the designer judges a render CONFORMS, that approved render becomes
# the baseline QA's `toHaveScreenshot` visual-regression guards against future drift. This
# task DEFINES that seam; building the baselines out into a hard gate is a QA-owned follow-on
# and is OUT OF SCOPE for this story. This surface is MOTION-FREE by design, so a screenshot
# is a complete lock on it — there is no animation to sample.

@uat @ui @design @distribution
Feature: the freshness ramp reads as degraded rather than broken — a design-conformance judgement of the stale badge, the provenance line, the Resync outcomes and the legend against DESIGN.md's binding checklists
  In order to confirm that an operator meeting a stale cached row understands "this copy is late" and never "this item is
  wrong" — on a surface whose whole purpose is to make an old copy readable rather than to alarm about it
  the board and the fleet are rendered populated with stale, fresh and unknown items and with each Resync outcome standing,
  at every documented breakpoint, and judged region by region against DESIGN.md's binding checklists (CONFORMS / GAPS)

  Background:
    Given a populated fixture is planted carrying a stale item reported by "umairs-mac-mini", a fresh item, an item with an unknown `syncedAt`, and a BLOCKED item that is also stale
    And the board is rendered at its EPHEMERAL per-workspace base URL, supplied to the render at capture time, at 1280, 768 and 390
    And the fleet is rendered at its fixed-port URL at 1280, 768, 390 and 360
    And each render is produced through the cached ms-playwright Chromium to an absolute screenshot path — never `npx playwright`
    And the rendered screenshots are handed to the designer to judge against DESIGN.md's binding checklists

  # RENDER GATE — the review never guesses from code. This is the m35 precedent and it is
  # the one scenario that keeps the verdict honest when the harness fails.
  Scenario: absent a populated render the review degrades to INCONCLUSIVE naming the missing render
    Given the cached-Chromium render did not produce a screenshot of the populated board at a required breakpoint
    When the design-conformance review runs
    Then the verdict is INCONCLUSIVE
    And it names the missing render — the surface, the breakpoint and the fixture state it was supposed to show
    And it does not infer a verdict from the component source, and does not return INCONCLUSIVE on the grounds that no mock exists

  # THE THESIS. If this region fails, the milestone has missed its point regardless of how
  # many element assertions are green.
  Scenario: the stale row reads as DEGRADED, not as broken — nothing on a healthy stale item reads as an error
    When the designer judges the populated board against DESIGN §Intent and §"The three states"
    Then the stale item's badge reads as a quiet, degraded mark — dashed, grey, transparent — and not as a warning or an error
    And no red, `destructive` or `accent` treatment appears anywhere on a stale-but-otherwise-healthy item
    And the stale badge is visibly quieter and smaller than the status chip beside it, so what the item IS outranks how old the copy is
    And on the item that is BOTH blocked AND stale, the two facts read as two separate vocabularies — the red belongs to the status chip alone
    And the stale badge is visibly distinct from every other pill on the same screen (status chip, type chip, run chip, assignment chip, presence dot)
    And the verdict for this region is CONFORMS or names a specific GAP

  # CHECKLIST REGION 3 — the detail panel header row-1 cluster, and the anchor rule that
  # keeps the m03 header baselines intact.
  Scenario: the detail panel header carries the badge in the `ml-auto` cluster with the status chip keeping its right-edge anchor
    When the designer judges the detail panel header against DESIGN §1c and the binding checklist's region 3
    Then row 1 reads `ring · mono ref · type chip · [stale badge][status chip]`, with the cluster right-anchored
    And the status chip sits at exactly the same right edge as on the fresh item rendered beside it
    And the badge is in the gap immediately to the chip's LEFT, at the cluster's own gap rhythm
    And the ring, ref, type chip, title and tag are visually unchanged from the fresh item
    And the verdict for this region is CONFORMS or names a specific GAP

  # THE NO-MOVEMENT CLAIM, measured. Task 03 asserts DOM order and the anchor class; only a
  # pixel comparison can settle whether the row actually stayed still.
  Scenario: nothing moves at the threshold — two renders one tick apart put the status chip on the same pixel
    Given two renders of the same item captured one cosmetic tick apart, across the moment it crosses the window
    When the two are compared
    Then the status chip's right edge is at the identical x position in both
    And the ring, ref, type chip, title and tag are at identical positions in both
    And the row's height is identical in both
    And the only difference between the two renders is the badge's appearance and the provenance line's `stale ·` prefix
    And the verdict for this region is CONFORMS or names a specific GAP

  # CHECKLIST REGION 4 — the provenance box's second line, with all four Resync appearances.
  # The tone rule is the substance here: muted for "the world did not answer", destructive
  # for "the request was rejected", and a human is the only judge of whether that lands.
  Scenario Outline: the provenance line and each Resync outcome read in the intended tone
    Given the provenance box is rendered with the Resync episode in its <state> state
    When the designer judges it against DESIGN §1c's state table and the binding checklist's region 4
    Then the line reads `[stale · ]synced <age> · from <node>[ (this node)]` in the mono muted treatment
    And the Resync control renders as <button appearance>
    And the message slot reads <message appearance>
    And the cached facts on the line are legible and untruncated — a failed request never hides how old the copy is or whose it is
    And the verdict for this state is CONFORMS or names a specific GAP

    Examples:
      | state             | button appearance                                          | message appearance                                    |
      | idle              | a small bordered `⟳ Resync` in its quiet primary-tint outline, never teal-filled | empty, occupying its reserved slot   |
      | in-flight         | the SAME box with the tint dropped, reading `Resyncing…`   | empty                                                 |
      | accepted          | the same box reading `Requested`, muted                    | a muted "waiting for … to push"                       |
      | owner unreachable | back at `⟳ Resync`, enabled                                | a MUTED unreachable sentence — calm, not alarming     |
      | refused           | back at `⟳ Resync`, enabled                                | a DESTRUCTIVE, outcome-first refusal                  |
    # The unreachable row is the one to look hardest at: it is the most likely outcome in
    # production and the easiest to over-alarm. If it reads red, that is a GAP.

  # The exclusivity rule the board already lives by — the single teal-filled headline action.
  Scenario: Resync is visibly subordinate to the item's single headline action
    When the designer judges the panel with both `▸ Run agent` (or Continue) and a stale row's Resync visible
    Then the teal-filled treatment belongs to the headline action alone
    And Resync is a quiet bordered control at the smaller type scale, clearly subordinate
    And Resync sits inside the provenance box that makes the staleness claim, not in the footer actions strip
    And the verdict for this region is CONFORMS or names a specific GAP

  # CHECKLIST REGIONS 1 AND 2 — the two cards. The lane card's local placement rule and the
  # overview cluster.
  Scenario: the lane card and the overview milestone card carry the badge in their designated slots, with no interactive element inside either
    When the designer judges the lanes view and the overview grid against the binding checklist's regions 1 and 2
    Then the lane card's meta line carries the SHORT badge at its right end, opposite the short-status text or the barber bar
    And the overview card's row 1 carries the FULL badge in the `ml-auto` cluster before the status chip, the chip keeping its position
    And no `uat` gate bar carries a badge
    And neither card shows a Resync control or any other control inside it
    And the verdict for these regions is CONFORMS or names a specific GAP

  # CHECKLIST REGION 5 — the doc body's own provenance, above the markdown.
  Scenario: the doc body states its own provenance above the rendered markdown, and a cache miss reads as absent rather than as an error
    When the designer judges the doc region against DESIGN §1c and the binding checklist's region 5
    Then a single quiet provenance line sits at the TOP of the doc region, above the rendered markdown
    And on a doc older than the row that names it, that line carries its own `stale ·` prefix while the header's line does not
    And the doc region carries no second badge and no second Resync
    And a doc the cache does not have renders the dashed absent placeholder "No cached SPEC yet — <node> has not reported one.", not an error treatment
    And no surface anywhere still claims that this board bridges the item list but not its documents
    And the verdict for this region is CONFORMS or names a specific GAP

  # THE PINNED FORMS, at every width — does each surface's ONE form actually FIT?
  # REWRITTEN at review (PO on the designer's ruling, 2026-08-03). This scenario used to ask
  # whether a viewport-driven yield ladder fired in the right order. DESIGN has WITHDRAWN that
  # ladder — not deferred it — because it was keyed to the wrong variable: the fleet grid is
  # `repeat(auto-fill, minmax(320px, 1fr))`, so it adds COLUMNS rather than width and its card
  # sits in a ~300–370px band at EVERY breakpoint (narrower at 2560 than at 1280), which would
  # have made a viewport rule paint `full` at 2560 and `minimal` at 390 in cards of the same
  # size. m38's derived character budgets deliberately do NOT transfer either: those are honest
  # only because their datum is `mono`, where `ch` is the exact advance — the badge is fixed
  # strings in Inter, so a `ch` budget would be false precision. The binding rule is now
  # "the form is chosen by the SURFACE, not the viewport". So the question a person answers
  # here is no longer "did it yield correctly" but "does the ONE pinned form fit".
  Scenario Outline: each surface's pinned badge form FITS at every width, and the word `stale` is never truncated
    Given the <surface> is rendered at <width>
    When the designer judges the badge against DESIGN §"The form is chosen by the SURFACE, not the viewport"
    Then the badge is in that surface's PINNED form — <pinned form> — at this width as at every other
    And it fits: the row does not overflow, nothing is clipped, and no two elements occupy the same pixels
    And the word `stale` is never truncated, shrunk by a scale factor, or overprinted
    And the status chip still holds the row's right-edge anchor
    And <what to check hardest>
    And the verdict for this breakpoint is CONFORMS or names a specific GAP

    Examples:
      | surface | width | pinned form | what to check hardest                                                                 |
      | board   | 1280  | full        | THE HIGHEST-RISK CELL — the detail header is ~382px with nothing in row 1 able to shrink, so an over-wide row OVERFLOWS rather than compressing; use a `milestone` type chip and an `in-progress` status (the longest of each) |
      | board   | 768   | full        | the overview card row 1, whose cluster carries badge + chip together                   |
      | board   | 390   | full/short  | the lane card meta line: its barber bar is `min-w-0 flex-1` and the badge `shrink-0`, so the BAR must yield and the badge must not be crowded onto it |
      | fleet   | 1280  | short       | judge this WITH the 360 render — the card is ~the same width at both, so a fit here is a fit everywhere and a failure here indicts the grid, not the phone |
      | fleet   | 360   | short       | the uppercase `milestone` label must NOT drop: a label that vanishes only when a row happens to be stale becomes a covert second staleness signal (m38 DG-20) |
    # If a render shows an overflow, the REMEDY is to pin that surface one rung down
    # (full → short; nothing else drops) and record it — a finding against DESIGN, never a
    # runtime ladder, shrink factor, overprint or truncation. `minimal` is RESERVED and has no
    # painter in this milestone; its `role="img"` + `aria-label` contract still binds (task 08),
    # which is what keeps it safe to pin a future surface to.

  # THE LEGEND — a new ramp documents itself, painting the real component.
  Scenario: both legends carry a Freshness block painting the real badge, as their last section
    When the designer opens the board legend and the fleet legend and judges them against DESIGN §Surface 3
    Then the board legend carries a Freshness block below the five status rows, after a divider
    And the fleet legend carries the same block as its fourth section, after Assignment
    And each block pairs the REAL rendered badge with its label, and states the window (or its unquantified words form when the wire carried no window)
    And the swatch in the legend is visually identical to the badge painted on the board
    And the verdict for this region is CONFORMS or names a specific GAP

  # PERCEPTUAL ACCESSIBILITY — the half no element-tree assertion can settle, and the half
  # that would have been an axe run if this repo's a11y lane were on. It is not, so a person
  # judges it. (The programmatic half — roles, names, live regions — is task 08.)
  Scenario: the ramp survives a colour-blind and greyscale read, and its small text is legible against its background
    When the designer judges the populated render in greyscale and under a colour-vision simulation
    Then the stale item is still identifiable as stale from the word and the glyph alone
    And no fact anywhere in the ramp is carried by colour alone
    And the badge's 11px text is legible against the card and page backgrounds it sits on
    And the dashed border reads as decorative — nothing is lost when it is not perceived
    And the verdict for this region is CONFORMS or names a specific GAP

  # THE ONE MEASURED ACCESSIBILITY CLAUSE. `text-[11px] py-1` lands around 22px, so this must
  # be measured rather than assumed — and the fix must not change the control's visual weight
  # or the row's height rhythm.
  Scenario Outline: the Resync hit target measures at least 24×24 CSS pixels at every breakpoint, without changing the row's rhythm
    Given the board is rendered at <width> with a stale item's Resync control visible
    When QA measures the control's hit box on the render and hands the numbers to the designer
    Then both its width and its height are at least 24 CSS pixels
    And the control's visual weight is unchanged — same type scale, same tint, same border
    And the provenance box's height and the row rhythm around it are unchanged from the fresh item
    And the verdict for this breakpoint is CONFORMS or names a specific GAP

    Examples:
      | width |
      | 1280  |
      | 768   |
      | 390   |

  # MOTION — the ramp adds none, which is what makes a screenshot a complete lock on this
  # surface. Motion in this product means "something is happening now"; staleness is the
  # absence of something happening.
  Scenario: the freshness ramp introduces no motion anywhere
    When the designer audits the populated renders for animation
    Then no badge pulses, shimmers, fades or transitions
    And no Resync state change animates
    And the only motion still on the surface is the pre-existing in-progress pulse and shimmer, unchanged
    And `prefers-reduced-motion` gains no new surface
    And the verdict for this region is CONFORMS or names a specific GAP

  # THE BASELINE HAND-OFF. This is the seam, stated once, so the follow-on has somewhere to
  # attach.
  Scenario: an approved render becomes the visual-regression baseline
    Given the designer has judged the populated renders CONFORMS at every documented breakpoint
    When the approved renders are recorded
    Then each becomes the baseline QA's `toHaveScreenshot` visual-regression compares future renders against
    And a later render that drifts from an approved baseline is a QA finding, routed like any other
    And building those baselines out into a hard gate is a QA-owned follow-on, explicitly out of scope for this story
