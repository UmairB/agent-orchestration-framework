<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — what is observably true when a spike/chore validates on its native shape.
# Litmus: every Then reads off `aof work validate --json` — a [{ path, problem }] array (empty ⇒ clean,
# exit 0; non-empty ⇒ exit 1). The `problem` strings below are the verbatim CLI-observable messages.
# The "no tasks/, no .feature is valid" invariant is FF-3704a/b in test/arch/ — asserted there, NOT here.
# recordDoc→SPIKE.md/CHORE.md mapping is FF-3703 — NOT restated as a scenario.

@cli @validate @work-stream @executable
Feature: a spike/chore folder validates on its native shape with no behavioural contract
  In order to hold spike/chore to the native identity schema and nothing heavier
  the system must validate a well-formed one clean and flag a malformed one on its own record doc

  Background:
    Given a work stream containing a spike folder and a chore folder at the stream root

  # Headline: a well-formed spike validates clean.
  Scenario: a well-formed spike passes validate clean
    Given the spike folder holds a SPIKE.md with valid frontmatter (type spike, matching number/slug,
      a valid status, created and updated dates) and has no tasks/ and no .feature
    When I run `aof work validate --json`
    Then no finding in the array has a `path` under the spike folder
    And the command exits zero

  # Headline: a well-formed chore validates clean.
  Scenario: a well-formed chore passes validate clean
    Given the chore folder holds a CHORE.md with valid frontmatter (type chore, matching number/slug,
      a valid status, created and updated dates) and has no tasks/
    When I run `aof work validate --json`
    Then no finding in the array has a `path` under the chore folder
    And the command exits zero

  # The malformed-frontmatter matrix: each row is one defect keyed on the type's own record doc.
  # `problem` values are the verbatim strings emitted on the --json contract.
  Scenario Outline: validate flags a malformed <type> on its native record doc
    Given the <type> folder's record doc is <mutation>
    When I run `aof work validate --json`
    Then some finding has `path` under the <type> folder
    And its `problem` <matches>
    And the command exits non-zero

    Examples:
      | type  | mutation                                            | matches                                                 |
      | spike | frontmatter type "task" (≠ folder type "spike")     | equals `frontmatter type "task" ≠ folder type "spike"`  |
      | chore | frontmatter type "spike" (≠ folder type "chore")    | equals `frontmatter type "spike" ≠ folder type "chore"` |
      | spike | status "wip" (not in the closed status set)         | equals `invalid status "wip"`                           |
      | chore | missing the `created` date                          | equals `missing created date`                           |
      | spike | missing the `updated` date                          | equals `missing updated date`                           |
      | chore | slug "wrong-slug" (≠ the folder slug)               | starts with `frontmatter slug`                          |
      | spike | `depends: [88]` where slot 88 has no driver         | starts with `depends "88" does not resolve`             |

  # A record doc missing (or empty) is flagged keyed off the type's own filename:
  # SPIKE.md for a spike, CHORE.md for a chore — the message names the expected file.
  Scenario Outline: validate flags a <type> whose record doc is missing or empty
    Given the <type> folder exists but its <doc> is absent (or has no frontmatter)
    When I run `aof work validate --json`
    Then some finding has `path` under the <type> folder
    And its `problem` equals `missing or empty record doc (<doc>)`
    And the command exits non-zero

    Examples:
      | type  | doc      |
      | spike | SPIKE.md |
      | chore | CHORE.md |
