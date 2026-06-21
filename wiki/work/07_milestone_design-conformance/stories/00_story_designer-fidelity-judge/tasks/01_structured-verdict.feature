@cli @assets @design
Feature: the designer returns a structured region-by-region CONFORMS / GAPS / INCONCLUSIVE verdict
  In order to replace the vibe-check with an evidence-backed verdict the wiring can branch on
  the designer's contract must fix the three-value verdict vocabulary, the region-by-region rubric, and
  the honest INCONCLUSIVE-when-no-baseline rule.

  # ADR-002 (structured verdict) + ADR-003 (the baseline). The verdict is one of exactly three terminal
  # values — CONFORMS / GAPS(list) / INCONCLUSIVE — judged region-by-region against the committed mock
  # AND/OR the mandatory binding checklist; each GAP is a concrete design-gap (region · expected-vs-
  # observed · fix), never "looks fine". INCONCLUSIVE is mandatory when there is no committed mock AND no
  # binding checklist (no baseline), or when no render is available (no screenshot) — naming the missing
  # baseline. Grep target = the BUNDLED designer (ADR-005), read by acd-conformance-verdict-contract
  # (designer-side markers). The verify/continue command-side verdict text is story 03's slice of the
  # same test.
  #
  # LITMUS: that the CONTRACT fixes the vocabulary + the INCONCLUSIVE rule is confirmable by reading the
  # bundled asset (the artifact under test) → @executable (incl. the "INCONCLUSIVE mandatory when no
  # baseline" rule-statement scenario, whose no-mock-AND-no-checklist / no-screenshot clauses are
  # grep-confirmable). The INCONCLUSIVE DECISION TABLE below is the BEHAVIOUR that rule produces — an
  # operator runs the designer for each input combination and observes the verdict → @manual, not a static
  # grep. Whether a verdict is CORRECT for a real surface (CONFORMS vs the right GAPS) is judgement → @uat.

  @executable
  Scenario: the designer contract fixes the three-value verdict vocabulary
    Given the bundled agent "src/bundle/agents/aof-designer.md"
    When its body is read
    Then it names the verdict values "CONFORMS", "GAPS", and "INCONCLUSIVE"
    And it requires the verdict to be one of exactly those three

  # The three-value vocabulary is closed: each terminal value MUST be named as a verdict token, and the
  # contract MUST state the verdict is one of EXACTLY those three (the closed-set constraint, asserted in
  # the scenario above, is the sound guard against a fourth/"soft" verdict — a forbidding-grep on
  # arbitrary soft words like "partial" is brittle because such words can appear legitimately in good
  # prose, so closedness is asserted positively, not by enumerating banned tokens). This outline pins
  # that each of the three is present as a named verdict value.
  @executable
  Scenario Outline: each terminal verdict value is named as a verdict token
    Given the bundled agent "src/bundle/agents/aof-designer.md"
    When its body is read
    Then the verdict token "<token>" is present as a terminal verdict value

    Examples: the three terminal verdict values are named
      | token        |
      | CONFORMS     |
      | GAPS         |
      | INCONCLUSIVE |

  @executable
  Scenario: the designer contract requires a region-by-region, concrete GAP shape
    Given the bundled agent "src/bundle/agents/aof-designer.md"
    When its body is read
    Then it requires the judgement to be region-by-region against the committed mock and/or binding checklist
    And it requires each GAP to cite the region, the expected-vs-observed, and a concrete fix
    And it forbids a "looks fine" / unevidenced verdict

  # Each GAP is a structured design-gap finding, not prose. The contract MUST require all three parts —
  # the region, the expected-vs-observed pair, and a concrete fix — so a developer can act on it. One row
  # per required part keeps the GAP shape enumerated; a future edit that drops "the fix" fails by name.
  @executable
  Scenario Outline: a GAP finding carries every required part
    Given the bundled agent "src/bundle/agents/aof-designer.md"
    When its body is read
    Then the contract requires each GAP to carry "<part>"

    Examples: the three required parts of a concrete design-gap
      | part                       |
      | the region it occurs in    |
      | the expected-vs-observed   |
      | a concrete fix             |

  @executable
  Scenario: the designer contract makes INCONCLUSIVE mandatory when there is no baseline
    Given the bundled agent "src/bundle/agents/aof-designer.md"
    When its body is read
    Then it states the verdict is INCONCLUSIVE when there is no committed mock AND no binding checklist
    And it states the verdict is INCONCLUSIVE when no render (screenshot) is available
    And it states the review names the missing baseline as the gap
    And it forbids inferring CONFORMS/GAPS from component code in place of a render

  # THE INCONCLUSIVE DECISION TABLE (highest-value QA case work, ADR-002/003).
  # A CONFORMS-or-GAPS verdict is REACHABLE only when the designer has both (a) a rendered screenshot to
  # judge AND (b) at least one baseline to judge against (a committed mock OR a binding checklist — ADR-003
  # makes the checklist mandatory, so the mock-absent/checklist-present row is the common case). Any other
  # combination has "no baseline" by ADR-002's definition — (no mock AND no checklist) OR no render — and
  # the verdict MUST be INCONCLUSIVE (the missing input is the named gap). This Scenario Outline enumerates
  # the BEHAVIOUR that the @executable rule-statement above produces: given a real combination of inputs,
  # what verdict the designer actually reaches and (when INCONCLUSIVE) what it names. It is @manual — an
  # operator runs the designer for each row and observes the verdict — NOT a static grep of the asset (the
  # grep-confirmable half is the rule-statement scenario above). "reachable" = the designer can return a
  # CONFORMS/GAPS verdict for that combination; an INCONCLUSIVE row means the designer must return
  # INCONCLUSIVE and name the missing input. (The 2³ truth table is exhausted: a CONFORMS/GAPS verdict
  # needs screenshot=present AND (mock OR checklist)=present; every other row is INCONCLUSIVE.)
  @manual
  Scenario Outline: the INCONCLUSIVE decision table — what verdict each baseline combination produces
    Given a designer judging a surface with committed-mock <mock>, binding-checklist <checklist>, and rendered-screenshot <screenshot>
    When it produces its verdict
    Then the verdict is "<reachable>"
    And when the verdict is INCONCLUSIVE it names "<missing>" as the gap to close

    Examples: a render plus at least one baseline — CONFORMS/GAPS is reachable
      | mock    | checklist | screenshot | reachable        | missing |
      | present | present   | present    | CONFORMS or GAPS | nothing |
      | present | absent    | present    | CONFORMS or GAPS | nothing |
      | absent  | present   | present    | CONFORMS or GAPS | nothing |

    Examples: no baseline (no mock AND no checklist) — INCONCLUSIVE is required, missing baseline named
      | mock    | checklist | screenshot | reachable    | missing      |
      | absent  | absent    | present    | INCONCLUSIVE | the baseline |

    Examples: no render available — INCONCLUSIVE is required, missing render named
      | mock    | checklist | screenshot | reachable    | missing    |
      | present | present   | absent     | INCONCLUSIVE | the render |
      | present | absent    | absent     | INCONCLUSIVE | the render |
      | absent  | present   | absent     | INCONCLUSIVE | the render |

    Examples: neither a baseline nor a render — INCONCLUSIVE is required
      | mock    | checklist | screenshot | reachable    | missing                     |
      | absent  | absent    | absent     | INCONCLUSIVE | the baseline and the render |

  @uat
  Scenario: on a real surface the designer's verdict is correct
    Given a rendered screenshot of a built surface and its committed mock + binding checklist
    When the designer judges fidelity
    Then a surface that matches the baseline is judged CONFORMS
    And a surface with a real divergence is judged GAPS listing that divergence with a concrete fix
    And a reviewer agrees the verdict reflects what actually paints
