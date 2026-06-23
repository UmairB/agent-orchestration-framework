@cli @adapter @memory @executable
Feature: import materializes the frozen artifact pair into the .aof/ import store
  In order to freeze the artifact shape + store layout that the sibling stories (01 recovery, 02
  indexing, 03 fitness) fan out from, an import must materialize a recovered milestone as a legible
  SPEC.md plus an ARCHITECTURE.md/RETROSPECTIVE.md-shaped knowledge artifact (the 05 heading
  conventions) into a dedicated import store rooted under .aof/, OUTSIDE workDir, git-ignored, whose
  folder names are never NN_type_slug.

  # ADR-001: an import materializes a PAIR of legible .md — a SPEC.md (recovered intent) + a knowledge
  # artifact reusing the 05 doc conventions (ARCHITECTURE.md with "## ADR-NNN" blocks and/or
  # RETROSPECTIVE.md with "## R<n>" entries) so the EXISTING parsers index it with no new parser.
  # ADR-004: the materialized pair lives in a dedicated import store rooted under .aof/, OUTSIDE the
  # configured workDir, git-ignored via the nested-.gitignore idiom (src/aof-gitignore.mjs), and its
  # folder names are NOT NN_type_slug — so listItems(workDir) never enumerates it as managed work.
  # These scenarios materialize from a FIXED/stubbed recovery input (recovery heuristics are story 01)
  # over a local fixture, so the lane is @executable. This is where the artifact SHAPE + store LAYOUT
  # are FROZEN for the siblings.
  #
  # These are OBSERVABLE behaviours: which files exist in the import store after an import, that the
  # knowledge artifact carries the 05 headings, that the store path is not under workDir, that the
  # folder name does not match the work-item pattern, and that the store is git-ignored. The STRUCTURAL
  # invariants are story-03 arch-tests, NOT scenarios here: "every materialized record is produced by
  # the existing parseArchitecture/parseRetrospective and matches the frozen MemoryRecord; SPEC.md is
  # never an index record source; no new parser / no new record shape" is acd-import-artifact-shape;
  # "an import never appears as a resolvable work item via listItems/findWork/nextWork/validateWork" is
  # acd-import-not-a-work-item; "every record's source:line resolves in the import store and a re-import
  # reproduces the identical set" is acd-import-derived-index. Comment-only — do not restate as Thens.

  Background:
    Given a fixed recovery input for milestone "00" with intent, decisions, and outcomes
    When I import that fixed input into a fresh project

  Scenario: the import store holds the recovered SPEC.md
    Then the import store holds a "SPEC.md"
    And it records the recovered intent

  # ADR-001: the knowledge half reuses the 05 conventions so the existing parsers read it unchanged.
  Scenario: the import store holds a knowledge artifact in the 05 heading conventions
    Then the import store holds an "ARCHITECTURE.md" using the "## ADR-NNN" heading convention
    And the import store holds a "RETROSPECTIVE.md" using the "## R<n>" heading convention

  # Provenance frontmatter (post-acceptance amendment, surfaced by the voice-vox testbed): every
  # materialized artifact carries frontmatter denoting it is IMPORTED knowledge and naming its source
  # — "imported: true", "source: <slug>", "sourceRef: <ref>". Three constraints make this safe, not a
  # contract break: (1) the keys are DETERMINISTIC — NO timestamp / indexed-at — so a re-import stays
  # byte-identical (ADR-005, pinned by acd-import-derived-index); (2) they are ADDITIVE frontmatter the
  # EXISTING parseArchitecture/parseRetrospective ignore (ADR-001 — no new parser, no new record shape;
  # provenance is NOT a MemoryRecord field, the record's source:line already carries it); (3) they are
  # NOT work-item frontmatter — no type/number/status — so an import is still never mistaken for managed
  # work (ADR-004).
  Scenario: every materialized artifact carries deterministic import-provenance frontmatter
    Then each materialized artifact's frontmatter sets "imported: true" and names the "source" and "sourceRef"
    And the provenance frontmatter is NOT work-item frontmatter (no type/number/status)
    And the existing parsers still derive the same records (the frontmatter is additive)
    And re-importing the same input yields byte-identical artifacts (the provenance carries no timestamp)

  # ADR-004: the store is rooted under .aof/ and OUTSIDE workDir — the structural exclusion that keeps
  # an import out of the managed stream. The observable is the path, not the resolver wiring.
  Scenario: the import store is rooted under .aof/ and outside the configured workDir
    Then the import store path is under ".aof/"
    And the import store path is not under the configured workDir

  # ADR-004: even outside workDir the store avoids the NN_type_slug naming, reinforcing the boundary at
  # the tree level. The observable: the materialized milestone folder name does not match the pattern.
  Scenario: the materialized milestone folder is not an NN_type_slug work-item name
    Then the materialized milestone folder name does not match "^\d+_(milestone|story|task|uat)_[a-z0-9-]+$"

  # ADR-004: git-ignored via the SELF-CONTAINED nested .gitignore idiom (src/aof-gitignore.mjs), never
  # the repo-root .gitignore. Cleaner observable: a nested .gitignore covers the store AND nothing under
  # it shows in `git status --porcelain`.
  Scenario: the import store is git-ignored via a nested .gitignore
    Then a ".gitignore" exists at the import store root
    And "git status --porcelain" shows nothing under the import store

  # Recovered-input -> materialized-files mapping. The store ALWAYS holds a SPEC.md (intent half;
  # ADR-001 — absence of intent is recorded BY story 01, not here). The knowledge half is present per
  # what the FIXED input carries: decisions -> ARCHITECTURE.md, outcomes -> RETROSPECTIVE.md. Here we
  # assert only the file-materialization mapping for each fixed input (absence-handling behaviour is
  # story 01's @executable feature). "absent" = the file is not materialized.
  Scenario Outline: a recovered input materializes the corresponding artifact set
    Given a fixed recovery input that carries <recovered>
    When I import that fixed input into a fresh project
    Then the import store holds a "SPEC.md"
    And ARCHITECTURE.md is <architecture>
    And RETROSPECTIVE.md is <retrospective>

    Examples: intent only -> SPEC.md alone, knowledge artifact absent
      | recovered                       | architecture | retrospective |
      | intent only                     | absent       | absent        |

    Examples: intent + a half -> SPEC.md + the matching knowledge artifact
      | recovered                       | architecture | retrospective |
      | intent and decisions            | present      | absent        |
      | intent and outcomes             | absent       | present       |

    Examples: a full milestone -> all three
      | recovered                       | architecture | retrospective |
      | intent, decisions, and outcomes | present      | present       |
