<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the frontmatter rewrite discipline (ADR-001): mirroring
# rollbackItemStatus, the engine replaces ONLY the target line(s) (`number`, and any
# `depends`/`parent` pointing at a shifted item) and reassembles the record doc
# byte-for-byte around them — no parseFrontmatter round-trip/reserialize (18/ADR-007),
# no reformatting, no dropped comments, `updated` unchanged.
# LITMUS: every Then is confirmable by re-reading the record doc's raw bytes from the
# fixture stream after the engine call — no source read of the engine's own code.

@cli @work @work-stream @executable
Feature: the frontmatter rewrite is surgical — only the number/depends/parent lines change, everything else is byte-identical
  In order that a renumber never reformats a record doc a human hand-wrote
  the engine must replace only the target frontmatter line(s) via a targeted regex and leave every other byte — including comments and key order — unchanged

  Background:
    Given a fixture work stream with a milestone record doc whose frontmatter keys are in non-default order and includes a `depends` list
    And that record doc's body (after the closing frontmatter fence) carries prose and an HTML comment block

  # Headline: the only lines that change are the ones the shift actually touches.
  Scenario: a shifted item's record doc changes only its number line, leaving every other frontmatter key and the body untouched
    When I open a slot that shifts this item to a new number
    Then only the `number:` line in the record doc's frontmatter differs from before
    And every other frontmatter key (including its leading comment and key order) is byte-identical to before
    And the record doc's body is byte-identical to before

  # Headline: a rewritten depends/parent line changes only that line, not the whole block.
  Scenario: a rewritten depends value changes only the depends line, leaving surrounding frontmatter untouched
    Given a fixture item declares `depends: [3]` pointing at an item that will shift
    When I open a slot that shifts the depended-on item to a new number
    Then only the `depends:` line in the referencing item's frontmatter differs from before
    And every other frontmatter key of the referencing item is byte-identical to before

  # The `updated` field is never bumped by a renumber — a mechanical identity change,
  # not a content edit, mirroring rollbackItemStatus's "only the target field changes" bound.
  Scenario: a renumber never bumps the record doc's updated field
    When I open a slot that shifts this item to a new number
    Then the record doc's `updated` value is unchanged from before the shift

  # The rewrite never round-trips through parseFrontmatter + reserialize (18/ADR-007) —
  # observable as: key order and the body's HTML comment survive, which a reserialize
  # (which parses into an object and re-emits it) would drop or reorder.
  Scenario: frontmatter key order and the body's HTML comment survive the rewrite
    When I open a slot that shifts this item to a new number
    Then the frontmatter keys are still in their original order
    And the HTML comment block in the record doc's body is still present, unchanged
