@cli @assets @round-trip @executable
Feature: installBundle runs the real aof work init into the isolated repo
  In order to prove the actual installer and not a hand-built fake
  installBundle must delegate to the shipped initWork and return its structured result.

  # "No re-implementation / byte-identical to a direct initWork" is the SOURCE+behavioural
  # invariant acd-roundtrip-reuses-shipped-code (ADR-002) — NOT restated here. This is the
  # harness-function smoke proof: the call performs a real install with an observable result.
  # The thorough install-completeness matrix (every member kind, every runtime, the stamp, the
  # capability matrix) lives in story 01 (install-proof) — deliberately NOT duplicated here.

  Background:
    Given a fresh isolated repo from createRoundTripRepo()

  Scenario: installBundle returns the structured install result
    When installBundle(dir) is called
    Then it returns a structured init result carrying the planned actions and a manifest
    And a manifest file is written under the repo's ".aof/" directory

  # QA added: pin the observable SHAPE of the shipped initWork result the harness returns —
  # the fields downstream story 01 asserts against. All black-box readable from the result
  # object + the filesystem. "manifestWritten true" + "guarded false" is the success face of
  # a first install (the guarded-refusal face is the outline below). The manifest path is the
  # unified lock under .aof/ (forward-slashed), the observable contract from milestone 01.
  Scenario: the structured result reports a written manifest at the unified lock path
    When installBundle(dir) is called
    Then the result's "actions" is a non-empty list
    And the result's "manifestWritten" is true
    And the result's "guarded" is false
    And the result's "manifestPath" ends with ".aof/aof.lock.json"

  Scenario: the install lands real, rendered bundle files in the repo
    When installBundle(dir) is called
    Then bundle agent files exist under the repo's runtime root
    And bundle command files exist under the runtime's "commands/aof/" directory

  Scenario: installBundle honours the requested runtimes
    When installBundle(dir, { runtimes: ["claude"] }) is called
    Then the rendered files appear under the "claude" runtime root

  # QA added: runtime-selection matrix — the opts.runtimes the frozen contract passes through to
  # initWork. Default (no opts) installs the "claude" runtime per ADR-005's documented default.
  # Observable: which runtime root the rendered files appear under. (Codex/multi-runtime breadth
  # is story 01's concern; here we prove the harness forwards the option, with the default case.)
  Scenario Outline: the requested runtime selects the runtime root the render lands under
    When installBundle is called with opts <opts>
    Then rendered bundle files appear under the <runtime-root> runtime root

    Examples:
      | opts                       | runtime-root |
      | (no opts — default)        | claude       |
      | { runtimes: ["claude"] }   | claude       |

  # QA added: the force re-install path. ADR-005's contract declares `force?: boolean`, and the
  # shipped initWork guards a second install on the existing `work` lock section unless force is
  # set. Both halves are black-box observable from the result object:
  #   - a second installBundle WITHOUT force returns guarded=true and writes nothing new;
  #   - a second installBundle WITH force re-renders (guarded=false, manifestWritten=true).
  # QA flag (developer amigo): confirm the harness's installBundle surfaces the guarded result
  # rather than throwing on the second no-force call — the shipped initWork RETURNS { guarded:true }
  # (it does not throw), so the harness must pass that result through for this to be observable.
  Scenario Outline: re-installing into the same repo is guarded unless force is given
    Given installBundle(dir) has already installed once into the repo
    When installBundle is called again with opts <opts>
    Then the result's "guarded" is <guarded>
    And the result's "manifestWritten" is <manifest-written>

    Examples:
      | opts               | guarded | manifest-written |
      | (no force)         | true    | false            |
      | { force: true }    | false   | true             |
