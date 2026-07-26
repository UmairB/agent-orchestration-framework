@docs @assets @scaffold @memory @executable
Feature: The OUTCOME.md bundle template ships with the pinned Delivered/Assumptions/Gaps grammar
  In order to give a completed work item somewhere to record what it now delivers, assumes, and left
  unfilled
  the aof bundle must ship an OUTCOME.md template — at driver level, milestone at minimum — carrying the
  three pinned sections in the milestone SPEC's section grammar, declared bundle-generated and pinned to
  LF, so aof:verify can instantiate a clean, byte-stable record doc at Accept.

  # Scope: the SHIPPED TEMPLATE only — its two on-disk locations, its section grammar, and the
  # marker/LF discipline every bundle template carries. It does NOT cover WHO writes it or WHEN
  # (01_verify-authors-outcome.feature) nor how it is indexed (story 02). The section grammar asserted
  # here is the contract pinned in wiki/work/39_milestone_delivery-memory-outcome/SPEC.md `## Stories`.
  # Per ADR-006 (driver-level, milestone-minimum) the milestone template is the load-bearing case;
  # per-story / other-type OUTCOME templates are a sanctioned follow-on and are NOT asserted here.

  Background:
    Given the aof bundle's work-item templates, sourced at `src/bundle/templates/<type>/` and bundled to `.aof/templates/work/<type>/`

  Scenario: the milestone OUTCOME.md template ships at both the source and bundled locations
    Then a template file exists at the source location `src/bundle/templates/milestone/OUTCOME.md`
    And a bundled template file exists at `.aof/templates/work/milestone/OUTCOME.md`

  Scenario: the template opens on the pinned title heading a completed item's OUTCOME carries
    When the milestone OUTCOME.md template is read
    Then its first content line — below the bundle marker — is a level-1 heading of the form "# NN · <Item Title> — Outcome"

  Scenario Outline: the template carries each pinned section in its section grammar
    When the milestone OUTCOME.md template is read
    Then it contains a "<heading>" section
    And that section carries <carries>

    Examples: the three pinned sections (SPEC `## Stories` grammar)
      | section     | heading        | carries                                                                                |
      | Delivered   | ## Delivered   | a `### ` capability heading followed by a one-line delivered statement                 |
      | Assumptions | ## Assumptions | a `- **<assumption>** — <condition>` bullet that qualifies the preceding capability     |
      | Gaps        | ## Gaps        | a `### ` surface heading with `**Status:**` (open \| discharged) and `**Discharge condition:**` |

  Scenario: the bundled template declares itself bundle-generated with the leading marker
    When the bundled milestone OUTCOME.md is read
    Then its first line is the bundle marker "<!-- aof-generated: bundle -->"

  # The observable outcome of the leading-marker strip every scaffolded doc carries. NOTE for the
  # developer: today's insert-shared stripBundleMarker anchors on a `(?=---)` frontmatter fence, and an
  # OUTCOME.md opens on `# NN · … — Outcome` (no frontmatter, per ADR-004) — so this asserts the TARGET
  # behaviour and is RED until the strip tolerates a non-frontmatter first content line.
  Scenario: stripping the bundle marker leaves the OUTCOME opening on its title heading
    Given the bundled milestone OUTCOME.md carrying the leading bundle marker
    When the leading bundle marker is stripped, as every scaffolded doc's is
    Then the resulting document's first line is the "# NN · <Item Title> — Outcome" title heading, not the marker

  # The `.aof/templates/**/*.md text eol=lf` pin — so the marker-strip and story-02 parser see the exact
  # bytes the author wrote, and a `core.autocrlf=true` Windows checkout cannot smuggle a CRLF that
  # defeats the strip.
  Scenario: the bundled OUTCOME.md template is byte-stable across platforms (LF line endings)
    When the bundled milestone OUTCOME.md is read as raw bytes
    Then it contains no CRLF line endings
