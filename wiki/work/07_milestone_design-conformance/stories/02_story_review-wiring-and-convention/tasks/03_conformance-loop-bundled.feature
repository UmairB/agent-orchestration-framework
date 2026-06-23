@cli @assets @design @executable
Feature: the design-conformance loop lands in the bundle source, guarded against drift
  In order that new aof projects inherit the loop and it can never silently regress to .claude/-only
  the design-conformance contract markers must be present in the src/bundle/ assets, a drift guard must
  assert it, and the derived manifest must stay consistent after the lift.

  # ADR-005 (bundle source-of-truth + drift guard). The loop was prototyped in .claude/ while src/bundle/
  # shipped the stale versions. This task lifts it into src/bundle/ and adds the NEW drift guard
  # (test/arch/acd-design-conformance-bundled.test.mjs, wired into scripts/test.mjs) that source-greps the
  # BUNDLED designer/QA agents + verify/continue/refine commands + DESIGN template for the contract
  # markers. The manifest is DERIVED — regenerate via scripts/generate-bundle-manifest.mjs; the existing
  # acd-bundle-manifest-hashes guards manifest↔bundle consistency.
  #
  # LITMUS: marker presence in the bundled assets and manifest consistency are confirmable statically →
  # @executable. The drift-guard's STRUCTURAL CLAIM "the markers live in the bundle" IS the arch-test
  # (acd-design-conformance-bundled) — so the scenarios assert the observable grep outcomes (each marker is
  # present in its bundled asset) and that the guard is wired into the runner, NOT the invariant restated.

  Scenario: the contract markers are present in the bundled assets, not only in .claude/
    Given the bundled assets under "src/bundle/"
    When the designer agent, the QA agent, the verify/continue/refine commands, and the DESIGN template are read
    Then the role-split markers (designer-judges / QA-runs-harness / orchestration-hands-off) are present in the bundled assets
    And the CONFORMS / GAPS / INCONCLUSIVE verdict markers are present in the bundled assets
    And the committed-mocks/ + binding-checklist convention markers are present in the bundled assets

  # The drift-guard's grep is a matrix of {bundled asset × the contract marker that asset must carry}. One
  # row per asset/marker pair keeps each grep target enumerated so a future edit that lifts a marker into
  # .claude/ but not src/bundle/ fails by name — this is the exact regression ADR-005 guards (prototyped in
  # .claude/, stale in the bundle). "present" = the marker appears in that BUNDLED asset under src/bundle/.
  # The asset/marker split mirrors how the milestone's fitness functions read each bundled asset; this
  # task's guard (acd-design-conformance-bundled) is the marker-PRESENCE roll-up across all five.
  Scenario Outline: each contract marker is present in its bundled asset under src/bundle/
    Given the bundled asset "<asset>"
    When its body is read
    Then the contract marker "<marker>" is present in that bundled asset

    Examples: the designer agent carries the judge-from-provided-screenshot + verdict markers
      | asset                              | marker                                       |
      | src/bundle/agents/aof-designer.md  | judges a provided screenshot (read-only)     |
      | src/bundle/agents/aof-designer.md  | CONFORMS / GAPS / INCONCLUSIVE verdict       |

    Examples: the QA agent carries the runs-the-harness markers
      | asset                         | marker                                  |
      | src/bundle/agents/aof-qa.md   | runs the Playwright harness              |
      | src/bundle/agents/aof-qa.md   | owns the toHaveScreenshot regression    |

    Examples: the verify/continue commands carry the render→hand-off markers
      | asset                            | marker                                       |
      | src/bundle/commands/verify.md    | render via npx playwright + hand to designer  |
      | src/bundle/commands/continue.md  | render via npx playwright + hand to designer  |

    Examples: the refine command + DESIGN template carry the committed-mock convention markers
      | asset                                        | marker                                          |
      | src/bundle/commands/refine.md                | elicits + commits a mock under mocks/            |
      | src/bundle/templates/milestone/DESIGN.md     | committed-mocks/ + mandatory binding-checklist   |

  Scenario: the drift guard is wired into the test runner
    Given the test runner "scripts/test.mjs"
    When its imported arch-tests are read
    Then "acd-design-conformance-bundled" is among them (so the guard runs in CI, not orphaned)

  # The guard is sound only if it actually trips when a marker is missing from the bundle (not merely green
  # because it asserts nothing). Each row removes one marker from its bundled asset and expects the named
  # guard to fail — the negative case that proves the guard guards. This is observed by mutating the
  # bundled asset under test and rerunning the guard (a developer-runnable @manual-by-nature check), so it
  # stays @executable only as the guard's own self-test: the guard SHOULD fail when its required marker is
  # absent. "removed" = the marker is deleted from its bundled asset.
  Scenario Outline: the drift guard fails when a required marker is removed from its bundled asset
    Given the bundled asset "<asset>" with the marker "<marker>" removed
    When "acd-design-conformance-bundled" runs
    Then it fails, naming the missing marker in that bundled asset

    Examples: removing any one marker trips the guard
      | asset                                     | marker                                       |
      | src/bundle/agents/aof-designer.md         | CONFORMS / GAPS / INCONCLUSIVE verdict       |
      | src/bundle/commands/verify.md             | render via npx playwright + hand to designer  |
      | src/bundle/templates/milestone/DESIGN.md  | committed-mocks/ + mandatory binding-checklist |

  Scenario: the derived bundle manifest is regenerated and consistent after the lift
    Given the bundle bodies have been edited and the manifest regenerated via scripts/generate-bundle-manifest.mjs
    When "acd-bundle-manifest-hashes" runs
    Then it passes (the shipped manifest matches the rendered bundle)
    And no story has hand-edited "src/bundle/manifest.json"
