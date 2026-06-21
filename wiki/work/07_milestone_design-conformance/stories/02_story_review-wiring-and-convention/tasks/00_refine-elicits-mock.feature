@cli @assets @design
Feature: refine elicits and commits a mock, or makes the binding checklist mandatory
  In order to give the read-only designer a baseline it can actually read
  the refine command's UI path must elicit mocks from the user, commit any that exist under the
  milestone's mocks/ dir referenced from DESIGN.md, and require the binding checklist when there is none.

  # ADR-003 (committed-mock convention). The root cause: m03's mock was a REMOTE claude.ai/design artifact
  # the read-only designer could not open. The fix: a mock, when one exists, is a COMMITTED, locally-
  # readable artifact under wiki/work/NN_milestone_<slug>/mocks/ referenced from DESIGN.md as the
  # conformance source of truth; with no mock, the DESIGN binding checklist is MANDATORY and is the source
  # of truth. Owns src/bundle/commands/refine.md. Going-forward only (m03 not backfilled).
  #
  # LITMUS: that the refine CONTRACT elicits the mock + commits to mocks/ + requires the checklist is
  # confirmable by reading the bundled command → @executable. That a run actually produced a committed
  # mock + DESIGN reference is a runtime outcome → @manual. (Read by acd-design-conformance-bundled for
  # the refine-side committed-mocks/ + binding-checklist markers.)

  @executable
  Scenario: the refine contract elicits mocks and fixes the committed-mocks convention
    Given the bundled command "src/bundle/commands/refine.md"
    When its body is read
    Then the UI / designer path elicits mocks from the user at refine
    And it states an existing mock is committed under the milestone's "mocks/" dir
    And it states the committed mock is referenced from DESIGN.md as the conformance source of truth
    And it states that with no mock the binding checklist is mandatory and is the source of truth

  # The refine UI path carries four contract obligations regardless of whether the user supplies a mock;
  # one row per obligation keeps each marker enumerated so a future edit that drops the "commit to mocks/"
  # step or the "checklist mandatory when no mock" rule fails by name. "present in the refine body" = the
  # obligation appears in the bundled command's UI / designer path.
  @executable
  Scenario Outline: the refine UI path states each committed-mock-convention obligation
    Given the bundled command "src/bundle/commands/refine.md"
    When its body is read
    Then the obligation "<obligation>" is present in the refine body

    Examples: the committed-mock convention obligations (ADR-003)
      | obligation                                                              |
      | elicit mocks from the user at refine                                     |
      | commit an existing mock under the milestone's mocks/ dir                 |
      | reference the committed mock from DESIGN.md as the conformance source    |
      | with no mock, the binding checklist is mandatory and is the source       |

  @manual
  Scenario: refining a UI milestone with a mock commits it and references it
    Given a UI milestone and a mock supplied by the user
    When the milestone is refined
    Then the mock is committed under the milestone's "mocks/" directory
    And DESIGN.md references that committed mock as the conformance source of truth
    And the committed mock is an artifact the read-only designer can Read (not a remote-link-only reference)

  @manual
  Scenario: refining a UI milestone with no mock makes the binding checklist the baseline
    Given a UI milestone for which the user supplies no mock
    When the milestone is refined
    Then DESIGN.md carries a mandatory binding checklist as the conformance source of truth
    And the surface still has a baseline to judge against (so its review need not be INCONCLUSIVE)

  # The runtime outcome of refine maps the user's mock-supply choice to the resulting baseline and the
  # verdict reachability it enables (closing the ADR-002/003 loop). Each row is an end-to-end @manual
  # observation: what refine commits and whether the surface ends with a baseline. "committed mock" = a
  # locally-readable file under mocks/ referenced from DESIGN.md; "checklist only" = no mock, the mandatory
  # binding checklist is the baseline; "neither" = a UI surface left with no mock AND no checklist, which is
  # the no-baseline case the review must report INCONCLUSIVE (ADR-002).
  @manual
  Scenario Outline: the user's mock-supply choice determines the surface's baseline at refine
    Given a UI milestone where the user supplies "<mock-supplied>"
    When the milestone is refined
    Then the conformance baseline for the surface is "<resulting-baseline>"
    And the surface's later review can reach a verdict other than INCONCLUSIVE is "<has-baseline>"

    Examples: supplying a mock vs relying on the mandatory checklist both yield a baseline
      | mock-supplied   | resulting-baseline               | has-baseline |
      | a local mock    | committed mock + binding checklist | yes          |
      | no mock         | binding checklist (mandatory)     | yes          |
