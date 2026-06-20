@cli @work @round-trip @executable
Feature: aof work validate gates the seeded stream
  In order for the loop to lean on a real, deterministic gate
  validate must pass a clean seeded stream and report each class of seeded defect with a non-zero exit.

  # The loop's gate: before the agent layer (ADR-003 @uat) is trusted, the deterministic spine must
  # prove `aof work validate` accepts a well-formed seeded stream and rejects each defect class the
  # shipped validator detects. Every row below is a perturbation a test makes as a FIXTURE EDIT on the
  # seeded sample (ADR-004) — a folder rename, a frontmatter field, a feature tag, a `depends` list —
  # then asserts the finding the shipped `validateWork` returns and the non-zero exit. Black-box: the
  # outcome is a function of files-on-disk, not of validator internals.

  Background:
    Given a fresh isolated repo with the sample milestone seeded
    And the seeded stream is well-formed (folders agree with frontmatter, tags are in vocabulary, the depends graph resolves and is acyclic)

  Scenario: a clean seeded stream passes validation and exits 0
    When "aof work validate" is run in the repo
    Then no findings are reported
    And the command exits 0

  Scenario: any seeded defect makes the command exit non-zero for CI
    Given the seeded stream is perturbed with any single defect
    When "aof work validate" is run in the repo
    Then at least one finding is reported
    And the command exits non-zero

  # The case matrix — one row per defect CLASS the shipped validator emits, expressed as a single
  # fixture edit on the seeded sample. Three families: (1) folder↔frontmatter disagreement, (2) the
  # closed tag-vocabulary rules on a seeded task .feature, (3) the depends graph (a dangling edge AND
  # a cycle). The "reported problem" column is the substring of the finding a black-box reader sees.
  Scenario Outline: validate reports each seeded defect class and fails
    Given the seeded sample is perturbed so that "<perturbation>"
    When "aof work validate" is run in the repo
    Then a finding reports "<reported problem>"
    And the command exits non-zero

    Examples: folder ↔ frontmatter
      | perturbation                                              | reported problem                       |
      | a story folder's slug no longer matches its frontmatter   | slug ≠ folder                          |
      | a record doc's frontmatter type disagrees with its folder | type ≠ folder type                     |
      | a record doc's frontmatter number disagrees with its folder | number ≠ folder                      |
      | a record doc carries an invalid status value              | invalid status                         |
      | a record doc's frontmatter block is removed entirely      | missing or empty record doc            |

    Examples: closed tag vocabulary (on a seeded task .feature)
      | perturbation                                              | reported problem                       |
      | a seeded scenario is tagged with a token outside the vocabulary | unknown tag                      |
      | a seeded scenario is tagged "@milestone-04" (membership as a tag) | milestone membership is structural |
      | a seeded scenario's effective tags carry no verification lane | verification tags (need exactly 1) |
      | a seeded scenario's effective tags carry two verification lanes | verification tags (need exactly 1) |

    Examples: depends graph
      | perturbation                                              | reported problem                       |
      | the milestone's depends list points at a number no item has | does not resolve to a milestone/uat item |
      | two seeded drivers depend on each other (a cycle)         | depends cycle                          |
