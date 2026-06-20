@cli @planning @adapter @bug @finding-F3
Feature: readSeam reads the seam contract out of the REAL create-prd template, not just the hand-shaped fixture
  In order for `aof:shatter` to actually consume the bought planner's PRD (the milestone's headline seam)
  the `readSeam(prd)` rule that shatter step 1 binds to must extract the objective, the in/out scope,
  AND the milestone-sized chunks from the 8-section template the live pm-execution `create-prd` skill
  really emits — not only from a fixture hand-shaped with `## Scope` / `## Milestones` headings the real
  producer never writes.

  # Found at aof:verify 02 (@uat live create-prd → shatter round-trip — VERIFICATION.md Finding F3).
  # The prerequisite (the planner installed) is now green (F1+F2 resolved), so the live round-trip ran:
  # the installed `create-prd` skill (pm-skills v2.0.0, commit 5042ff61…) authored a well-formed
  # PRD-oncall-compass.md, `discoverPrd` auto-found it (PASS), and the produced milestone framing was
  # judged faithful by the PO (the @uat human sign-off PASSED). BUT `readSeam` over that REAL PRD
  # returned: objective ✓, scope { in: [], out: [] }, milestones [].
  #
  # Root cause: the real create-prd skill emits the 8-section template — Summary / Contacts /
  # Background / Objective / Market Segment(s) / Value Proposition(s) / Solution / Release — which has
  # NO `## Scope` heading and NO `## Milestones` heading. `extractScope`/`extractMilestones`
  # (src/planning-prd.mjs) find a section by title-matching `/scope/` and `/milestone/`, so they match
  # NOTHING in the real output. Both story-01 fixtures (`PRD-acme-notify.md` and `write-prd-output.md`)
  # were hand-shaped WITH `## Scope` + `## Milestones` headings, so the @manual read-out lane was green
  # against a PRD shape the bought planner does not produce. This is the same blind-spot class as F1/F2,
  # one layer out: a test fixture shaped to pass that does not exercise the real producer — caught only
  # by the live @uat. The genuine create-prd output is captured verbatim as the fix seed at
  # `fixtures/PRD-oncall-compass.real-create-prd.md`.
  #
  # Fix direction (PO triage 2026-06-19: BLOCKER — reopen story 01):
  #   1. Harden `readSeam` to the real 8-section template: derive the milestone-sized chunks from
  #      `## 7. Solution → 7.2 Key Features` (and corroborate against `## 8. Release`); derive the
  #      objective from `## 4. Objective` (already works); derive scope (in/out) from the Solution +
  #      `7.4 Assumptions` / `## 8. Release` ("first version" = in, "later"/out-of-v1 = out) rather than
  #      requiring a literal `## Scope` heading. Keep the existing `## Scope` / `## Milestones` and the
  #      `/write-prd` inline `In:`/`Out:` shapes working (don't regress the command-shaped path).
  #   2. Replace / augment the fixtures with a GENUINE create-prd output (the captured real PRD) and make
  #      it a first-class case in `test/planning-prd.test.mjs`, so "the seam read-out is consumable" is
  #      asserted against the shape the real planner emits, not a hand-shaped one.
  #   3. Architect: correct ADR-005 (its "representative pm-skills create-prd-shaped fixture" claim was
  #      false — the fixture was parser-shaped) and RESEARCH §7 (record the create-prd skill's actual
  #      section structure — the 8-section template — alongside the already-noted filename discrepancy).

  Background:
    Given the genuine create-prd 8-section PRD captured at "fixtures/PRD-oncall-compass.real-create-prd.md"

  @executable
  Scenario: readSeam extracts the objective from the real 8-section create-prd template
    When "readSeam" reads the real create-prd PRD
    Then the objective is the prose under the "Objective" section (non-empty)

  @executable
  Scenario: readSeam extracts milestone-sized chunks from the real create-prd template
    When "readSeam" reads the real create-prd PRD
    Then the milestone-sized chunks are derived from the "Solution / Key Features" section (non-empty)
    And there is one chunk per key feature the PRD lists (schedule model, rotation engine, notifications, calendar sync, web UI)

  @executable
  Scenario: readSeam still extracts in/out scope without a literal "## Scope" heading
    When "readSeam" reads the real create-prd PRD
    Then an in-scope set is derived (e.g. the first-version capabilities) — not empty
    And an out-of-scope set is derived (e.g. the explicitly-deferred / "later" items)

  @executable
  Scenario: the hand-shaped and command-shaped fixtures still read correctly (no regression)
    When "readSeam" reads the "## Scope" / "## Milestones" fixture and the inline "In:/Out:" fixture
    Then both still yield their objective, scope and milestone chunks as before

  @manual
  Scenario: a fresh live create-prd → shatter round-trip carries scope + milestones through the seam read-out
    Given the bought planner is installed (F1/F2 resolved)
    When a person runs create-prd for a sample initiative and "aof:shatter" consumes the produced PRD-*.md
    Then the seam read-out (objective / scope / milestone-chunks) is non-empty for the REAL produced PRD
    And the framed milestone SPECs reflect the chunks the read-out surfaced
