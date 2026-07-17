<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the 0→1 stamp transform (ADR-003) BACKSTAMPS an unstamped (schema-0)
# item: it writes `schema: 1` + an `aofVersion` provenance string onto the record-doc
# frontmatter through the atomic writer (ADR-004), leaves the authored body byte-identical,
# and leaves `aof work validate` green. Proven deterministically on a fixture stream
# (@executable); the real delivery — backstamping the live aof 00–39 stream — is the ONE
# @manual scenario the developer runs, recording the validate-green result in
# VERIFICATION.md.
# LITMUS (executable): every Then is confirmable from the fixture's on-disk record-doc
# frontmatter after the apply plus a fresh `aof work validate --json` reading zero
# findings. LITMUS (manual): a fresh `aof work validate --json` over the live 00–39 stream
# reports zero staleness. No source read.

@cli @work @work-stream
Feature: the 0→1 stamp transform backstamps an unstamped item to schema 1 with a provenance stamp and leaves validate green
  In order that a stream predating the version stamp is caught up by a command, not by hand
  `aof upgrade` must stamp every unstamped item `schema: 1` + `aofVersion` through the atomic writer, leave the authored body untouched, and leave `aof work validate` green

  Background:
    Given a fixture work stream whose items are unstamped — no `schema` key — and therefore read as the schema-0 baseline

  # The stamp works across every record-doc type recordDoc resolves (ADR-002): a
  # milestone's SPEC.md, a story's STORY.md, a uat session's SESSION.md, a spike, a chore.
  # Each gains the two frontmatter keys; each keeps its body byte-identical.
  @executable
  Scenario Outline: the 0→1 stamp backstamps an unstamped <type> to schema 1 with a provenance stamp
    Given an unstamped <type> whose record doc is "<doc>"
    When I run `aof upgrade` and apply over the fixture stream
    Then that item's "<doc>" frontmatter now reads `schema: 1`
    And it now carries an `aofVersion` provenance string
    And its record-doc body is byte-identical to before the stamp

    Examples:
      | type      | doc        |
      | milestone | SPEC.md    |
      | story     | STORY.md   |
      | uat       | SESSION.md |
      | spike     | SPIKE.md   |
      | chore     | CHORE.md   |

  # Backstamping the whole unstamped fixture stream leaves it validate-green.
  @executable
  Scenario: backstamping the unstamped fixture stream leaves it validate-green
    When I run `aof upgrade` and apply over the fixture stream
    Then every item's on-disk frontmatter now carries `schema: 1` and an `aofVersion` string
    And a fresh `aof work validate --json` over the fixture reports zero findings

  # The real delivery (criterion 7): backstamping the live aof 00–39 stream. @manual — it
  # mutates the live repo; the developer runs it and records the result in VERIFICATION.md.
  @manual
  Scenario: backstamping the live aof 00–39 stream leaves `aof work validate` green
    Given the aof repository's own work stream, items 00 through 39, authored before the version stamp existed
    When the developer runs `aof upgrade` and applies over the live aof stream
    Then every item 00 through 39 now carries `schema: 1` and an `aofVersion` provenance string
    And a fresh `aof work validate --json` over the live stream reports zero staleness
    And the developer records the validate-green result in VERIFICATION.md
