<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the transform-scoped frontmatter WRITER (ADR-004), a NEW export
# in work.mjs (indicatively `applyItemFrontmatter(item, mutate)`). It rewrites
# ONLY the leading `---…---` frontmatter block (may add, rename, remove, or
# re-value keys) and reassembles the BODY byte-for-byte around it, using the same
# block-capture + slice idiom rollbackItemStatus uses (work.mjs:390-404) — NOT a
# parseFrontmatter+reserialize round-trip (that shared parser drops
# comments/order/formatting — 18/ADR-007). It persists via the atomic
# fs.mjs:writeText temp+rename seam. It runs only inside a registered transform;
# it does NOT widen rollbackItemStatus — the two are narrow writers, each bounded.
#
# LITMUS: every Then is confirmable by byte-diffing the record doc's raw bytes
# from the fixture BEFORE and AFTER the writer call (readFile — split on the
# closing `---` fence to isolate the body); the writer's landing is cross-checked
# through the story-01 reader; the rollback refusals are confirmed by the doc
# being byte-UNCHANGED after a rejected call plus the thrown error code. Full
# temp+rename crash-atomicity is an ADR-004 implementation guarantee (fitness
# `acd-migration-writer-body-preserving`), not restated behaviourally here — the
# observable half is only that the written doc re-reads whole. No source read.

@cli @work @work-stream @executable
Feature: the transform-scoped writer rewrites only the frontmatter block, leaving the record doc body byte-identical, while the status-only rollback writer's bound stays untouched
  In order that a migration transform can add or restate a version stamp without ever touching authored prose or another item's history
  the new writer must rewrite only the leading frontmatter block (body byte-for-byte identical), persist atomically, and coexist with rollbackItemStatus as a second narrow writer — never a widening of the first

  Background:
    Given a fixture item whose record doc I hand-author with a non-default frontmatter key order, a comment line inside the frontmatter block, and a body of prose plus an HTML comment block

  # Headline (the stamp transform's shape): adding the two version keys touches
  # only the leading block — the body and every pre-existing key are byte-identical.
  Scenario: adding the version keys leaves the body and every existing key byte-identical
    Given the item's record doc carries no version keys
    When the writer adds "schema: 1" and "aofVersion: 0.1.0" to its frontmatter
    Then the record doc's body — every byte after the closing "---" fence — is byte-identical to before
    And every pre-existing frontmatter key keeps its original value and position
    And the leading block now additionally declares "schema" and "aofVersion"

  # The 0 → 1 restamp move: re-valuing an existing key changes only that value
  # line — the body and all other keys are byte-identical.
  Scenario: re-valuing an existing key changes only that value line
    Given the item's record doc carries the line "schema: 0"
    When the writer re-values "schema" to 1
    Then the "schema" line now reads "schema: 1"
    And the record doc's body is byte-identical to before
    And no other frontmatter key's value changed

  # Body-preservation holds across every frontmatter operation the writer is
  # allowed (ADR-004: add / re-value / rename) — the body never moves regardless.
  Scenario Outline: whatever the frontmatter operation, the body stays byte-identical
    When the writer applies the operation "<operation>" to the item's frontmatter
    Then the record doc's body — every byte after the closing "---" fence — is byte-identical to before
    And the intended change is present in the new leading block
    And no unintended frontmatter key's value changed

    Examples:
      | operation                              |
      | add a new "schema" key                 |
      | add a new "aofVersion" key             |
      | re-value the existing "schema" key     |
      | rename a legacy key to its new name    |

  # The rollback writer's refusal to bump `updated` (work.mjs:373) generalises:
  # this writer does not gratuitously bump `updated` — only the transform's own
  # intended keys change, so a body-preserving stamp leaves `updated` alone.
  Scenario: the writer does not gratuitously bump updated
    Given the item's record doc carries an "updated" line
    When the writer adds a "schema" key without setting "updated"
    Then the "updated" line is byte-identical to before

  # No parseFrontmatter round-trip (18/ADR-007): comments, key order, and
  # formatting survive — a reserialize would drop the in-block comment and reorder
  # the keys, so their survival proves the surgical slice, not a re-render.
  Scenario: the writer preserves comments, key order, and formatting
    When the writer adds a "schema" key to the item's frontmatter
    Then the comment line inside the frontmatter block survives verbatim
    And the pre-existing keys keep their original relative order
    And the body HTML comment block is present, unchanged

  # The write landed and the doc re-reads whole (the observable half of atomic
  # persistence): after the stamp, the story-01 reader resolves the new schema and
  # the on-disk doc is a complete, well-formed record doc.
  Scenario: after the write the item resolves at its new schema and the doc re-reads whole
    Given the reader resolves the item's schema as 0
    When the writer stamps the item to schema 1
    Then the reader now resolves the item's schema as 1
    And the record doc on disk opens with "---", carries a closing fence, and its body is intact

  # ADR-004 / criterion 6: adding this writer does NOT widen rollbackItemStatus —
  # the rollback writer keeps its status-only bound. Two narrow writers, each
  # bounded, never one wide mutator.
  Scenario: the status-only rollback writer's bound is preserved
    Given the item's record doc status is "in-progress"
    When rollbackItemStatus rolls the item to "not-started"
    Then only the "status" line changed; the body and every other frontmatter key are byte-identical

  # The rollback writer still refuses the moves its bound forbids — proof the new
  # writer did not dissolve it into a general mutator.
  Scenario Outline: rollbackItemStatus still refuses the moves outside its bound, leaving the doc byte-unchanged
    Given the item's record doc status is "<from>"
    When rollbackItemStatus is asked to roll the item to "<target>"
    Then the call is rejected with "<code>"
    And the record doc is byte-unchanged from before the call

    Examples:
      | from        | target      | code                    |
      | in-progress | done        | forbidden-rollback      |
      | in-progress | in-review   | forbidden-rollback      |
      | not-started | not-started | rollback-not-applicable |
