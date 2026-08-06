<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — THE HUMAN GATE. A person judges whether the shell reads as ONE
# application where there were three pages, region by region, at every documented
# breakpoint plus the desktop app's own window, on all four routes and on an unmatched
# path — over a real browser render.
#
# LITMUS: every Then is confirmable from a RENDERED SCREENSHOT (and, for the measured
# clauses, from a number QA reads off that same render and hands over) judged against a
# named conformance source. Never from component source. Where no render exists, the
# honest verdict is INCONCLUSIVE naming the missing render.
#
# WHY THIS GATE EXISTS AT ALL, AND WHY IT IS `@uat`. The milestone's success condition
# is itself a perceptual claim: *"an outsider cannot tell what changed except that the
# address bar now means something and the three pages know about each other."* Tasks
# 00–03 pin the model — the region order, the chrome arithmetic, the nav items, the
# fullscreen state machine — as values a pure `.mjs` helper returns headlessly. NONE of
# them can settle whether the rendered result actually reads as one product, whether
# 88px of modelled chrome really leaves 432px of usable content in the Rust app's
# window, whether the bar survives the 390 squeeze, or whether "you are here" lands
# without colour. Those are pixel and perceptual facts and they belong to a person.
#
# THE CONFORMANCE SOURCE IS WHICHEVER IS CURRENT AT REVIEW TIME. `mocks/app-shell.png`
# is named as the source of truth and the operator is supplying it; it had NOT landed
# when this task was written. Until it does, DESIGN.md's binding checklists ARE the
# baseline — mandatory, not a supplementary rubric — so a review that runs before the
# mock arrives has something to judge and must NOT return INCONCLUSIVE on the grounds
# that no mock exists (07/ADR-003; the m03 lesson). When the mock lands it supersedes
# the checklists wherever the two differ, and DESIGN.md is amended in the same change:
# a checklist left contradicting a committed mock is a defect, not a nuance. A remote
# design-tool link is never a substitute — the reviewer is read-only and cannot open
# one; a baseline it cannot `Read` is not a baseline.
#
# BROWSER LANE (QA-OWNED). QA runs the browser and drives the harness; the designer
# judges the render it is handed and has no `Bash`. Per the house design-render
# discipline, `npx playwright` is POLICY-BLOCKED here — the render drives the cached
# ms-playwright Chromium directly (`--headless=new --screenshot=<ABSOLUTE forward-slash
# path>`). The FLEET is the fixed-port origin (`http://127.0.0.1:4181/`); the BOARD is a
# per-workspace server on an EPHEMERAL port that changes on every daemon restart
# (`Board.tsx:47-51`), so its base URL must be supplied to the render AT CAPTURE TIME
# and NEVER hard-coded; the config editor is the `setup-ui` origin.
#
# THE a11y LANE IS OFF, AND THAT IS THE DECISION, NOT AN OVERSIGHT. `.aof/aof.config.json`'s
# `work.tags.domains` carries no `a11y` entry and there is no `work.ui.a11y` block, so
# the opt-in automated lane is off: THERE IS NO axe-core RUN IN THIS STORY AND NO a11y
# FINDING WILL COME FROM ONE. DESIGN's accessibility requirements therefore bind this
# `@uat` review as HUMAN judgement — which is why the non-colour, focus-order,
# hit-target and skip-link clauses appear below rather than in an automated lane.
#
# NOT JUDGED HERE: anything tasks 00–03 already pin as a model value. This review does
# not re-assert the region ORDER or the nav's `href`s; it judges whether the rendered
# result of those models reads right.

@uat @ui @work @design
Feature: the shell reads as ONE application — a design-conformance judgement of the five regions, the nav, the chrome budget and the unmatched path at four viewports on every route
  In order to confirm that an operator meeting the new frame sees the product they already know plus a way to move around it — and never a re-skin, a second brand, a lost control or a page that scrolls twice
  the shell is rendered on all four routes and on an unmatched path at 1280, 768, 390 and at the desktop app's own 760×520 window, and judged region by region against `mocks/app-shell.png` where it is committed and DESIGN.md's binding checklists everywhere else (CONFORMS / GAPS)

  Background:
    Given the fleet origin is rendered at its fixed `http://127.0.0.1:4181/` for `/`, `/fleet`, `/fleet?scope=local` and an unmatched `/nope`
    And the board origin is rendered at its EPHEMERAL per-workspace base URL, supplied to the render at capture time
    And the config-editor origin is rendered at `/config`
    And each of those is captured at 1280, 768 and 390 wide, and at the desktop app's 760×520 window
    And each render is produced through the cached ms-playwright Chromium to an absolute screenshot path — never `npx playwright`
    And the rendered screenshots are handed to the designer, who judges them against whichever conformance source is current

  # RENDER GATE — the review never guesses from code, and never returns INCONCLUSIVE
  # for the wrong reason. This is the m35/m43 precedent and it is what keeps the verdict
  # honest when the harness fails.
  Scenario: absent a render the review degrades to INCONCLUSIVE naming the missing render — but a missing MOCK is never grounds for it
    Given the render did not produce a screenshot of a required route at a required breakpoint
    When the design-conformance review runs
    Then the verdict is INCONCLUSIVE
    And it names the missing render — the route, the origin, the breakpoint and the state it was supposed to show
    And it does not infer a verdict from component source
    And it does NOT return INCONCLUSIVE on the grounds that `mocks/app-shell.png` has not landed: DESIGN.md's binding checklists are the mandatory baseline until it does

  # WHICH BASELINE WAS JUDGED — recorded in the verdict, every time, because the answer
  # changes the moment the operator commits the file.
  Scenario Outline: the review names the conformance source it judged against, and the mock supersedes the checklist wherever the two differ
    Given `mocks/app-shell.png` is <mock status> at review time
    When the design-conformance review runs
    Then the verdict names <source> as the conformance source it judged against
    And <what happens to the checklist>

    Examples:
      | case                          | mock status                          | source                              | what happens to the checklist                                                     |
      | before the operator's mock    | absent                               | DESIGN.md's binding checklists      | they bind in full, and the review proceeds to a CONFORMS/GAPS verdict             |
      | after it lands, agreeing      | committed and consistent             | the committed mock                  | it still binds wherever the mock is silent                                        |
      | after it lands, differing     | committed and differing from a clause| the committed mock                  | the differing clause is a GAP AGAINST DESIGN.md, raised so the document is amended in the same change |
      | a link instead of a file      | offered as a remote design-tool link | DESIGN.md's binding checklists      | the link is refused as a baseline — the reviewer is read-only and cannot open one  |

  # THE RISK DESIGN FLAGS BY NAME. The terminal surfaces are already dark and milestone
  # 49 makes terminals the home screen, so a dark shell is a plausible mock and an
  # implausible milestone: this one ships the light ramp at `index.css:3-25` and adds no
  # token.
  Scenario Outline: a mock that reaches beyond this milestone's ramp comes back as its OWN design gap, never as a silent build
    Given the committed mock shows <what the mock shows>
    When the design-conformance review runs
    Then the review raises it as a NAMED design gap with <consequence>
    And it is not absorbed into this milestone's build
    And the built shell continues to ship the existing light ramp and adds no new token, no hex and no new palette

    Examples:
      | case                     | what the mock shows                          | consequence                                                                     |
      | THE FLAGGED RISK         | a DARK shell                                 | its own token work and its own milestone — a theme decision beyond this ramp     |
      | a new colour             | any colour outside `index.css:3-25`          | a token decision, raised before it is painted                                    |
      | a structural nav change  | a LEFT RAIL instead of underline tabs        | DESIGN.md is REWRITTEN, not patched — a rail changes the region order, the chrome budget and both content modes |
      | a second chrome row      | a surface bar present at 1280                | 40px off every surface's height at every width — raised, and costed, before it ships |
      | a bigger nav             | a fifth nav item, or a label over 10 characters | a table change or a shorter label — never a truncated nav label                 |
      | a brand call             | a second word beside the wordmark            | the cheapest of them: DESIGN's documented default 4 is amended and the build follows |
    # Rows 1–5 each cost a milestone-shaped decision; row 6 costs nothing and is the one
    # a mock is MOST likely to overrule, since "how the brand reads" is exactly a mock's
    # call. Sorting them this way is the point: the review must not treat them alike.

  # THE THESIS. If this fails, the milestone has missed its point however many model
  # assertions are green.
  Scenario: the shell reads as ONE application, and an outsider can see nothing else has changed
    When the designer judges the four routes side by side against DESIGN §Intent
    Then the four surfaces read as four views of one product, not three pages that now share a bar
    And everything left of the surface slot — mark, wordmark, identity chip, divider, nav — is the same on all four
    And each surface's own content is where it was, at the size it was, in the colour it was
    And nothing has been taken away: every control that was on a surface before is still on it
    And the ONE brand mark is painted on all four (the board's bare glyph is now the filled tile) and the wordmark reads `aof` alone (`Mesh` and `Work Board` are retired) — both are DESIGNED changes, recorded so they are not logged as regressions
    And the verdict for this region is CONFORMS or names a specific GAP

  # THE BUDGET, MEASURED — the browser half of task 01's model. This is the one number
  # the whole layout contract rests on, and the Rust app's window is where it bites.
  Scenario: in the desktop app's own 760×520 window the chrome measures no more than 88px and the content region measures at least 432px
    Given the shell is rendered at 760×520 — the desktop app's window (`app/desktop/ui/styles.css:50`) — on `/fleet`
    When QA measures the rendered chrome and content regions and hands the numbers to the designer
    Then the total chrome above the content region measures ≤88 CSS pixels
    And the content region measures ≥432 CSS pixels tall
    And there are at most two chrome rows — a third is a GAP, not a variant
    And the same holds on `/`, `/board`, `/config` and on the unmatched path
    And with the board's `serverGone` notice standing, the rail PUSHES the bars down rather than overlaying them, and the review records the measured total — the one combination task 01 predicts will exceed the budget
    And the verdict for this region is CONFORMS or names a specific GAP

  # BINDING RAIL 2, settled the only way it can be: two renders, one pixel comparison.
  # This is the m43 "nothing moves at the threshold" discipline applied to a bar.
  Scenario: nothing in the shell moves as you navigate — the same four elements land on the same pixels on every route
    Given renders of `/`, `/fleet`, `/board`, `/config` and `/nope` at the same width
    When the five are compared
    Then the brand mark, the wordmark, the identity chip and the divider are at identical positions in all five
    And each nav item's left edge is at the identical x position in all five
    And the bar's height is identical in all five
    And the ONLY differences left of the surface slot are the active item's marking and the identity chip's TEXT
    And the surface slot's contents grow leftward from the right edge and never displace the nav, on the route whose slot is fullest
    And the verdict for this region is CONFORMS or names a specific GAP

  # THE SQUEEZE. Each "never" below is a GAP whose fix is the next whole drop in
  # DESIGN's table — not a shrink factor, not an ellipsis, not a scrolling row.
  Scenario Outline: the bar survives every width in whole discrete drops, with nothing truncated and no page-level horizontal scrollbar
    Given the shell is rendered at <width> on <route>
    When the designer judges the bar against DESIGN §Responsive form
    Then the nav is in this width's declared form — <form>
    And every label is complete: nothing truncated, ellipsised, shrunk by a scale factor or overprinted
    And the active surface is visible and identifiable at this width
    And the page root has grown NO horizontal scrollbar — `index.css:27-36`'s `overflow-x: hidden` backstop is still in place and still doing its job
    And <what to check hardest>
    And the verdict for this breakpoint is CONFORMS or names a specific GAP

    Examples:
      | width | route            | form                    | what to check hardest                                                                                     |
      | 1280  | /fleet           | four items, full labels | the fullest slot on any route — scope control + legend + refresh — must still not touch the nav            |
      | 768   | /fleet           | four items, full labels | the slot has DROPPED to the surface bar: same components, same order, and the bar reads as a continuation rather than a new band |
      | 390   | /fleet           | the disclosure          | THE HIGHEST-RISK CELL — mark, wordmark, chip, divider and disclosure in 390px, with the chip truncating rather than the nav |
      | 390   | /board           | the disclosure          | the board's own fixed-height model inside the shell at the narrowest width                                 |
      | 760×520 | /board         | four items, full labels | the desktop app's real window: the board's lanes must still scroll inside the box, not the page            |

  # SCROLL OWNERSHIP, which is the one thing a screenshot cannot show and a scroll can.
  # DESIGN: "exactly one element owns scroll per axis per region."
  Scenario Outline: each route's declared scroll model holds in the browser, and the page never double-scrolls
    Given the shell is rendered at 760×520 on <route> with enough content to overflow
    When QA scrolls the render and hands the observation to the designer
    Then scroll is owned by <owner> and by nothing else
    And there is never a scrollbar on the page AND one inside the content region at the same time
    And the top bar <bar behaviour>
    And the verdict for this route is CONFORMS or names a specific GAP

    Examples:
      | route   | owner                        | bar behaviour                                        |
      | /fleet  | the page                     | stays put — it never scrolls out of view             |
      | /board  | the board's own descendants  | stays put — the board's lanes scroll beneath it      |
      | /config | the page                     | stays put                                            |
      | /       | the page (which never needs to) | stays put — the landing card fits every breakpoint |

  # "YOU ARE HERE", judged the way the rule is written: take the colour away.
  Scenario: the active surface is identifiable in greyscale and under a colour-vision simulation
    When the designer judges the rendered bar in greyscale and under a colour-vision simulation
    Then the active nav item is still identifiable from its rule and its weight alone
    And an item that is unavailable from this origin is still identifiable from its DASHED rule alone, and is distinguishable from both the active and the ordinary inactive item
    And no fact anywhere in the shell is carried by colour alone
    And the bar's small text is legible against the card background it sits on at every width
    And the verdict for this region is CONFORMS or names a specific GAP

  # THE CROSS-ORIGIN HONESTY RULE, seen. An item that leaves the origin must look
  # exactly like one that does not; an item that cannot be reached must not look live.
  Scenario: an unreachable destination is visibly present, visibly unavailable and carries the command to run
    Given the fleet is rendered with NO board server running, and again with one running
    When the designer compares the two renders
    Then the Board item occupies the same slot at the same width in both — the nav does not reflow when a board appears or disappears
    And in the no-board render it is visibly present and visibly unavailable, in the dashed treatment
    And hovering it shows the command that would produce it, and it does not look like a live link
    And in the board-running render it is indistinguishable in form from an in-origin item — port topology is not the operator's problem
    And the verdict for this region is CONFORMS or names a specific GAP

  # THE UNMATCHED PATH — DESIGN's "empty ≡ NO ROUTE MATCHED", and the address bar is
  # part of what is judged.
  Scenario: the unmatched path renders in-shell, reads as "not a surface" rather than as a failure, and the address bar still shows what was typed
    Given the shell is rendered at `/nope` at every breakpoint
    When the designer judges it against DESIGN §Surface 1's empty state
    Then the chrome is present and complete, and the nav is right there as the way on
    And NO nav item is marked active
    And the content region holds a centred dashed placeholder naming the path that did not match
    And nothing on screen reads as an error — no red, no `accent`, no `destructive`, no alarm
    And the address bar still reads `/nope` — it has not been rewritten to `/`
    And the verdict for this region is CONFORMS or names a specific GAP

  # THE `/` LANDING — a route with nothing behind it yet, which must not look like an
  # error, a loading state, or a product surface.
  Scenario: the landing is one centred dashed card that says what will live there, and is not a redirect
    Given the shell is rendered at `/` at every breakpoint
    When the designer judges it against DESIGN §Surface 2
    Then the address bar still reads `/` — it has NOT redirected to `/fleet`
    And the content region holds one centred dashed card: mark, one heading, one muted sub-line, one row of destination links
    And its copy names the thing rather than the milestone number
    And it shows no skeleton and no error treatment — nothing is coming and nothing failed
    And an unreachable destination in its link row takes the SAME unavailable treatment as the nav's — one rule, both places
    And the verdict for this region is CONFORMS or names a specific GAP

  # FULLSCREEN, seen at the size where it matters most.
  Scenario: a fullscreen occupant covers the chrome rather than sitting under a translucent one, and the way out is visible
    Given a surface is presented fullscreen at 760×520
    When the designer judges the render against DESIGN §`shell:fullscreen`
    Then the top bar is GONE, not dimmed, not blurred and not showing through
    And the occupant fills the window — no residual band where the chrome was
    And a visible exit control sits at the same anchor position as the control that entered fullscreen
    And no light-theme chrome is visible behind or around a dark terminal surface
    And the verdict for this region is CONFORMS or names a specific GAP

  # ACCESSIBILITY, JUDGED BY A PERSON — because the automated lane is OFF (see the
  # header). These are DESIGN's own requirements, and the chrome this milestone
  # introduces is what creates most of them.
  Scenario: the chrome's own accessibility obligations are visible in the render and in a keyboard pass
    When QA drives a keyboard pass over the rendered shell and hands the observations to the designer
    Then the FIRST focusable element is the skip link, visually hidden until focused and visible when it is
    And it moves focus to the content region
    And focus order follows visual order: skip link, nav in the table's order, surface slot, content
    And every nav item, the disclosure trigger and every slot control measures at least 24×24 CSS pixels — achieved by filling the bar's height, not by growing the bar
    And the focus indicator is visible on every one of them
    And an unavailable nav item is still reachable by keyboard and still states its reason
    And the identity chip is not focusable — it is a label, not a control
    And the verdict for this region is CONFORMS or names a specific GAP

  # MOTION — the shell adds none, which is what makes a screenshot a complete lock on
  # it. Route changes are instant; there is no transition to design.
  Scenario: the shell animates nothing
    When the designer audits the renders for animation
    Then no route change fades, slides or transitions — the change is instant
    And the bar does not animate when the surface bar appears or the notice rail arrives
    And the only motion anywhere is the pre-existing `animate-pulse` on load placeholders, unchanged
    And `prefers-reduced-motion` gains no new surface
    And the verdict for this region is CONFORMS or names a specific GAP

  # THE BASELINE HAND-OFF. Stated once, so the follow-on has somewhere to attach.
  Scenario: an approved render becomes the visual-regression baseline
    Given the designer has judged the renders CONFORMS on every route at every documented breakpoint
    When the approved renders are recorded
    Then each becomes the baseline QA's `toHaveScreenshot` visual-regression compares future renders against
    And a later render that drifts from an approved baseline is a QA finding, routed like any other
    And building those baselines out into a hard gate is a QA-owned follow-on, explicitly out of scope for this story
    And the shell is motion-free by design, so a screenshot is a complete lock on it — there is no animation to sample
