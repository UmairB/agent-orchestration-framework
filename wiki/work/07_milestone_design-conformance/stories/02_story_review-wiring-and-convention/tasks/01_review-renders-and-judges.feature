@cli @assets @design
Feature: verify and continue render the surface, hand it to the designer, and run QA's harness
  In order to verify visual fidelity without the operator manually comparing screenshots
  the verify and continue commands must render each surface via npx playwright at the breakpoints, hand
  the screenshot to the designer to judge, spawn QA for the harness, and report INCONCLUSIVE when there is
  no render — with Playwright invoked on-demand, never a package dependency.

  # ADR-001 (orchestration renders + hands off) + ADR-002 (render contract + verdict). The orchestration
  # is the only party that bridges "run the browser" to "judge the result". Render target = --url if given
  # else work.ui.baseUrl, + each DESIGN surface Route, at breakpoints 390/768/1280 (DESIGN-overridable).
  # Playwright via `npx playwright screenshot …` — NOT in package.json. Owns
  # src/bundle/commands/{verify,continue}.md. Read by acd-design-role-split (orchestration slice) +
  # acd-conformance-verdict-contract (render-as-npx + no-Playwright-dependency).
  #
  # LITMUS: that the COMMANDS carry the render→hand-off step + the npx invocation + the INCONCLUSIVE rule,
  # and that Playwright is absent from package.json, are confirmable statically → @executable. A real
  # render painting the surface needs the browser + the served app → @manual. The structural CLAIM "the
  # split is enforced by the orchestration carrying the hand-off" is the ADR-001 invariant / fitness
  # function (acd-design-role-split) — the scenarios assert the observable grep outcomes, not the invariant.

  @executable
  Scenario: the review commands render via npx playwright at the breakpoints
    Given the bundled commands "src/bundle/commands/verify.md" and "src/bundle/commands/continue.md"
    When their bodies are read
    Then each renders a DESIGN surface via "npx playwright screenshot" against the base URL (--url or work.ui.baseUrl) + the surface Route
    And the render is taken at the defined breakpoints (the 390 / 768 / 1280 default)
    And the breakpoints are stated to be DESIGN-overridable per milestone

  # The render target is assembled from three documented parts and rendered at three documented
  # breakpoints; one row per part/breakpoint keeps each token enumerated so a future edit that drops the
  # Route append or a breakpoint fails by name. "present in the command body" = the token appears as part
  # of the documented render invocation.
  @executable
  Scenario Outline: the render invocation names its target parts and its breakpoints
    Given the bundled commands "src/bundle/commands/verify.md" and "src/bundle/commands/continue.md"
    When their bodies are read
    Then the render token "<token>" is present in the command body

    Examples: the render target = base URL (--url or work.ui.baseUrl) + the surface Route
      | token            |
      | npx playwright   |
      | --url            |
      | work.ui.baseUrl  |
      | Route            |

    Examples: the documented default breakpoints (mobile / tablet / desktop)
      | token |
      | 390   |
      | 768   |
      | 1280  |

  @executable
  Scenario: the review commands hand the screenshot to the designer and spawn QA
    Given the bundled commands "src/bundle/commands/verify.md" and "src/bundle/commands/continue.md"
    When their bodies are read
    Then they spawn the designer to JUDGE the rendered screenshot they pass it (the ADR-001 hand-off)
    And they spawn QA for the browser harness / regression / a11y
    And they do not instruct the designer to run the browser itself

  @executable
  Scenario: the review reports INCONCLUSIVE when there is no render or baseline
    Given the bundled commands "src/bundle/commands/verify.md" and "src/bundle/commands/continue.md"
    When their bodies are read
    Then they state the verdict is INCONCLUSIVE when no base URL / screenshot is available or no baseline exists
    And they state a DESIGN surface with no renderable Route collapses to INCONCLUSIVE naming the missing Route
    And they name the missing baseline as the gap rather than inferring from component code

  # The INCONCLUSIVE decision table — orchestration side, observed end-to-end (@manual per PO ruling: this
  # is the loop's routing BEHAVIOUR, not a grep of the command body — the grep-confirmable half is the
  # @executable rule-statement above). Same semantics as the designer-side no-baseline rule (story 00 /
  # acd-conformance-verdict-contract), seen from the wiring's standpoint: the orchestration is the party
  # that knows whether a base URL was resolved and whether a screenshot was produced, so it must
  # short-circuit to INCONCLUSIVE before it ever spawns the judge. The three inputs the wiring can observe
  # are {base URL resolved?, screenshot rendered?, baseline present?}. The verdict it ROUTES = what the
  # loop actually returns for that combination: only when ALL THREE hold can the path reach CONFORMS/GAPS
  # (the designer then judges which); ANY missing one MUST short-circuit to INCONCLUSIVE naming that gap —
  # the wiring never hands the designer a non-render to guess from. A surface with no renderable Route is
  # one driver of "no render" — it collapses into the not-rendered row, named as the missing Route.
  # "no baseline" = no committed mock AND no binding checklist (ADR-002/003). This observes the loop's
  # routed verdict on a real run, distinct from story 00's @uat judgment quality (which CONFORMS-vs-GAPS).
  @manual
  Scenario Outline: the loop routes the observed render inputs to the verdict it returns, short-circuiting to INCONCLUSIVE
    Given the loop runs for a surface where the base URL is "<base-url>", the screenshot is "<screenshot>", and the baseline is "<baseline>"
    When the design-conformance review runs for that surface
    Then the verdict the loop routes is "<routed-verdict>"
    And when it is INCONCLUSIVE the loop names the missing "<missing-gap>" rather than letting the designer guess from component code

    Examples: a render and a baseline both present — the judge is reached and can return a real verdict
      | base-url | screenshot | baseline | routed-verdict   | missing-gap |
      | resolved | rendered   | present  | CONFORMS or GAPS | —           |

    Examples: any missing input MUST short-circuit to INCONCLUSIVE naming that gap (never a guess)
      | base-url     | screenshot   | baseline | routed-verdict | missing-gap         |
      | absent       | not rendered | present  | INCONCLUSIVE   | render / base URL   |
      | resolved     | not rendered | present  | INCONCLUSIVE   | render              |
      | resolved     | no Route     | present  | INCONCLUSIVE   | Route               |
      | resolved     | rendered     | absent   | INCONCLUSIVE   | baseline            |
      | absent       | not rendered | absent   | INCONCLUSIVE   | render and baseline |

  @executable
  Scenario: Playwright is on-demand via npx, not a package dependency
    Given the root "package.json"
    When its "dependencies" and "devDependencies" are read
    Then neither lists "playwright" nor "@playwright/test"

  # ORCHESTRATION observable (PO ruling 5): the loop's behaviour — render happens, the screenshot is handed
  # off, and the non-INCONCLUSIVE path is REACHED — distinct from story 00's @uat lane, which judges whether
  # the verdict is the CORRECT CONFORMS-vs-GAPS call. Here we only observe that a real render + baseline lets
  # the loop reach a terminal CONFORMS/GAPS verdict at all (not which one, and not that it is right).
  @manual
  Scenario: against a served app the review renders, hands off, and reaches a non-INCONCLUSIVE verdict
    Given a project app served at the design-review base URL with a baseline for a surface
    When verify runs the design-conformance review for that surface
    Then the surface is rendered at the breakpoints and the screenshot handed to the designer to judge
    And the loop reaches a terminal CONFORMS or GAPS verdict (not INCONCLUSIVE — a render and baseline exist)
    And whether that verdict is the correct CONFORMS-vs-GAPS call is out of scope here (story 00's @uat)

  @manual
  Scenario: with no base URL resolvable the review honestly degrades to INCONCLUSIVE
    Given a UI surface but no --url given and no work.ui.baseUrl set
    When verify runs the design-conformance review for that surface
    Then no screenshot is rendered and the designer is not asked to guess from component code
    And the review reports INCONCLUSIVE naming the missing render / base URL as the gap
