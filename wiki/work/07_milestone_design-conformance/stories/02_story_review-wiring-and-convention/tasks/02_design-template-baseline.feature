@cli @assets @design @executable
Feature: the bundled DESIGN template encodes the committed-mock convention and a mandatory binding checklist
  In order that every new UI milestone is born conformance-ready with a readable baseline
  the bundled milestone DESIGN template must reference a committed mocks/ dir as the source of truth and
  carry a mandatory binding-checklist section per surface, with no remote-link-only mock as the sole reference.

  # ADR-003 (committed-mock convention), durable carrier = the template. The current bundled template
  # (src/bundle/templates/milestone/DESIGN.md) is the simple one: a "Mockup: <Figma / image / design-bundle
  # link>" line and no binding checklist. This task upgrades it. Owns
  # src/bundle/templates/milestone/DESIGN.md. Enforced by acd-design-template-baseline.
  #
  # LITMUS: that the TEMPLATE carries the convention + the mandatory checklist section is confirmable by
  # reading the bundled template (the artifact under test) → @executable. The CONTENT of any given
  # milestone's filled-in mock / checklist is an authoring outcome, NOT an arch-test (the template carries
  # the convention; the per-milestone artifact is not asserted here).

  Scenario: the template references a committed mocks/ dir as the conformance source of truth
    Given the bundled template "src/bundle/templates/milestone/DESIGN.md"
    When its body is read
    Then it references a committed "mocks/" directory as the conformance source of truth
    And it requires a mock to be a locally-readable, committed artifact
    And it does not present a remote design-tool link as the SOLE mock reference

  Scenario: the template carries a mandatory binding-checklist section per surface
    Given the bundled template "src/bundle/templates/milestone/DESIGN.md"
    When its body is read
    Then each surface carries a mandatory binding-checklist section
    And the checklist enumerates the layout regions in order, the components each holds, the states (empty / loading / error / populated), and the design ramp each uses

  Scenario: the template states the no-mock case makes the checklist the source of truth
    Given the bundled template "src/bundle/templates/milestone/DESIGN.md"
    When its body is read
    Then it states that when no committed mock exists the binding checklist is mandatory and is the source of truth

  # The template's conformance contract is a set of required markers and a set of forbidden ones. One row
  # per marker keeps each enumerated so a future template edit that drops the binding-checklist section or
  # reintroduces a remote-link-only mock fails by name. "present" = the marker appears in the bundled
  # template body; "absent" = it does not. The forbidden row guards against regressing to the stale simple
  # template (the "Mockup: <link>"-only shape this task replaces).
  Scenario Outline: the bundled DESIGN template carries the conformance markers and not the stale ones
    Given the bundled template "src/bundle/templates/milestone/DESIGN.md"
    When its body is read
    Then the template marker "<marker>" is <presence>

    Examples: the committed-mock + mandatory-checklist convention is present (ADR-003)
      | marker                                                  | presence |
      | a committed mocks/ dir referenced as the source of truth | present  |
      | a mandatory binding-checklist section per surface        | present  |
      | the no-mock-makes-the-checklist-mandatory rule           | present  |

    Examples: the stale simple-template shape is gone (no remote-link-only mock)
      | marker                                          | presence |
      | a remote design-tool link as the SOLE mock ref   | absent   |

  # The mandatory binding checklist enumerates four fields per surface (the m03-demonstrated shape). One
  # row per field keeps the rubric enumerated so the template cannot ship a partial checklist (e.g.
  # regions but no states). "present in the checklist section" = the field appears as a checklist entry the
  # template requires per surface.
  Scenario Outline: the template's binding checklist requires each rubric field per surface
    Given the bundled template "src/bundle/templates/milestone/DESIGN.md"
    When its binding-checklist section is read
    Then the checklist field "<field>" is present in the checklist section

    Examples: the regions / components / states / ramp rubric (ADR-003)
      | field                                            |
      | layout regions in order                          |
      | the components each region holds                  |
      | the states (empty / loading / error / populated) |
      | the design ramp each uses                        |
